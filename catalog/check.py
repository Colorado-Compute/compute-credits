#!/usr/bin/env python3
"""The guard on catalog/credits.json: public fields only, first-party links, plain text, canonical bytes.

  python3 -I catalog/check.py              check credits.json; writes nothing
  python3 -I catalog/check.py --fix        check, then rewrite credits.json in canonical order and format
  python3 -I catalog/check.py --self-test  seeded rows that must pass and must fail; no files touched

credits.json is the one source of free compute credit facts, edited by pull request. Each row holds exactly
ROW_FIELDS: an allowlist, so a private column (a `cs_*` status, `evidence`, a balance, a note) is refused by default,
not by a block list. The layout mirrors Colorado-Startups/startup-credits catalog/check.py (read 2026-11-12); this
file is the definition for this repository. Standard library only.

Exit 0: clean. Exit 1: a finding. Exit 2: could not check (a missing or unreadable file: infrastructure).
"""
import json
import os
import re
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
CATALOG = os.path.join(HERE, "credits.json")

TOP_KEYS = ("version", "about", "checked", "kinds", "forms", "rows")
ROW_FIELDS = ("id", "vendor", "name", "kind", "form", "free_amount", "resets", "who_qualifies", "card_required",
              "overage", "setup_steps", "source", "checked")
KINDS = ("gpu", "cpu", "inference", "ci", "hosting")
# free_tier: an allowance that resets. signup_credit: a one-time amount at sign-up. discount: a price cut that a
# first-party page states (none seeded yet).
FORMS = ("free_tier", "signup_credit", "discount")
RESETS = {"daily", "weekly", "monthly", "one_time", "none", None}
OVERAGE = {"bills", "stops", "unknown"}
ID = re.compile(r"^[a-z0-9][a-z0-9-]*$")
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}")
DASHES = ("\u2014", "\u2013")  # em and en dash: a spaced en dash reads as an em dash
# A sentence with our own arithmetic must say so, or a reader credits the sum to the vendor.
COMPUTED = re.compile(r"\bsum\b|buys about|that is \$|twelve months", re.I)
COMPUTED_LABEL = "(computed here)"
SENTENCE = re.compile(r"(?<=[.;])\s+")
# A setup step never puts a key on a command line: sign in with the vendor's CLI or its console instead.
KEY_IN_COMMAND = re.compile(r"--(?:api[-_]?)?key\b|--token\b|--secret\b|\b[A-Z0-9_]*(?:KEY|TOKEN|SECRET)=\S")
STEPS_MIN, STEPS_MAX, STEP_WORDS = 2, 5, 25


class CannotCheck(Exception):
    """Infrastructure, not a finding."""


def strings(v):
    if isinstance(v, str):
        yield v
    elif isinstance(v, dict):
        for x in v.values():
            yield from strings(x)
    elif isinstance(v, list):
        for x in v:
            yield from strings(x)


def keys(v):
    """Every object key at any depth, so a private key nested anywhere is seen."""
    if isinstance(v, dict):
        for k, x in v.items():
            yield k
            yield from keys(x)
    elif isinstance(v, list):
        for x in v:
            yield from keys(x)


def text_list(v, allow_empty=True):
    return isinstance(v, list) and (allow_empty or v) and all(isinstance(s, str) and s.strip() for s in v)


def check_row(row, where):
    if not isinstance(row, dict):
        return [f"{where}: not an object"]
    out = []
    extra, missing = set(row) - set(ROW_FIELDS), set(ROW_FIELDS) - set(row)
    if extra:
        out.append(f"{where}: fields outside the public allowlist: {sorted(extra)}")
    if missing:
        out.append(f"{where}: missing fields: {sorted(missing)}")
    if not ID.match(str(row.get("id", ""))):
        out.append(f"{where}: id is not a lowercase slug")
    for k in ("vendor", "name", "free_amount"):
        if not isinstance(row.get(k), str) or not row[k].strip():
            out.append(f"{where}: {k} is not text")
    if row.get("kind") not in KINDS:
        out.append(f"{where}: kind {row.get('kind')!r} is not one of {list(KINDS)}")
    if row.get("form") not in FORMS:
        out.append(f"{where}: form {row.get('form')!r} is not one of {list(FORMS)}")
    resets = row.get("resets")
    if resets not in RESETS:
        out.append(f"{where}: resets {resets!r} is not one of {sorted(r for r in RESETS if r)} or null")
    elif row.get("form") == "signup_credit" and resets != "one_time":
        out.append(f"{where}: a signup_credit resets one_time")
    elif row.get("form") == "free_tier" and resets == "one_time":
        out.append(f"{where}: a one_time amount is a signup_credit, not a free_tier")
    if not text_list(row.get("who_qualifies"), allow_empty=False):
        out.append(f"{where}: who_qualifies is not a non-empty list of text")
    if row.get("card_required") not in (True, False, None):
        out.append(f"{where}: card_required is not true, false or null")
    if row.get("overage") not in OVERAGE:
        out.append(f"{where}: overage is not one of {sorted(OVERAGE)}")
    if not str(row.get("source") or "").startswith("https://"):
        out.append(f"{where}: source is not an https URL")
    if not DATE.match(str(row.get("checked") or "")):
        out.append(f"{where}: checked is not YYYY-MM-DD")
    steps = row.get("setup_steps")
    if not text_list(steps) or not STEPS_MIN <= len(steps) <= STEPS_MAX:
        out.append(f"{where}: setup_steps is not {STEPS_MIN} to {STEPS_MAX} steps of text")
    else:
        for n, s in enumerate(steps, 1):
            if len(s.split()) > STEP_WORDS:
                out.append(f"{where}: setup step {n} is over {STEP_WORDS} words")
            if KEY_IN_COMMAND.search(s):
                out.append(f"{where}: setup step {n} puts a key in a command; sign in with the vendor's CLI instead")
    for s in strings(row):
        if any(d in s for d in DASHES):
            out.append(f"{where}: an em or en dash (use a comma, colon or parentheses)")
            break
    for s in strings(row):
        if EMAIL.search(s):
            out.append(f"{where}: an email address in a public field")
            break
    for s in strings(row):
        for sent in SENTENCE.split(s):
            if COMPUTED.search(sent) and COMPUTED_LABEL not in sent:
                out.append(f"{where}: arithmetic without {COMPUTED_LABEL}: {sent[:80]!r}")
    return out


def canonical(doc):
    """The document in canonical order: rows by kind, vendor, name. Same facts, same bytes."""
    rank = {k: i for i, k in enumerate(KINDS)}
    rows = sorted(doc["rows"], key=lambda r: (rank.get(r.get("kind"), len(KINDS)),
                                              str(r.get("vendor")).lower(), str(r.get("name")).lower()))
    out = {k: doc.get(k) for k in TOP_KEYS}
    out["rows"] = [{k: r.get(k) for k in ROW_FIELDS if k in r} | {k: v for k, v in r.items() if k not in ROW_FIELDS}
                   for r in rows]
    return out


def render(doc):
    return json.dumps(doc, indent=1, ensure_ascii=False) + "\n"


def check_doc(doc, text=None):
    """Findings for the whole document. `text` is the file as read, for the canonical-bytes check."""
    if not isinstance(doc, dict):
        return ["credits.json is not a JSON object"]
    out = []
    if set(doc) != set(TOP_KEYS):
        out.append(f"top-level keys are not exactly {list(TOP_KEYS)}: {sorted(set(doc) ^ set(TOP_KEYS))}")
    if doc.get("version") != 1:
        out.append("version is not 1")
    if not isinstance(doc.get("about"), str):
        out.append("about is not text")
    if not DATE.match(str(doc.get("checked") or "")):
        out.append("top-level checked is not YYYY-MM-DD")
    if doc.get("kinds") != list(KINDS):
        out.append(f"kinds is not {list(KINDS)}")
    if doc.get("forms") != list(FORMS):
        out.append(f"forms is not {list(FORMS)}")
    rows = doc.get("rows")
    if not isinstance(rows, list) or not rows:
        return out + ["rows is empty or not a list"]
    for k in keys(doc):
        if k.startswith("cs_") or k == "evidence":
            out.append(f"a private key {k!r} is in the document")
    seen = set()
    for i, row in enumerate(rows):
        rid = row.get("id") if isinstance(row, dict) else None
        where = f"row {i} ({rid or '?'})"
        out += check_row(row, where)
        if rid in seen:
            out.append(f"{where}: duplicate id")
        seen.add(rid)
        if isinstance(row, dict) and str(row.get("checked") or "") > str(doc.get("checked") or ""):
            out.append(f"{where}: checked is after the top-level checked date")
    if text is not None and not out and render(canonical(doc)) != text:
        out.append("credits.json is not in canonical order and format: run python3 -I catalog/check.py --fix")
    return out


def load(path):
    try:
        with open(path, encoding="utf-8") as f:
            text = f.read()
    except FileNotFoundError as e:
        raise CannotCheck(f"{path} is missing") from e
    except (OSError, UnicodeDecodeError) as e:
        raise CannotCheck(f"{path} cannot be read ({e})") from e
    try:
        return json.loads(text), text
    except ValueError as e:
        return None, f"credits.json does not parse as JSON ({e})"


def run(path, fix=False):
    doc, text = load(path)
    if doc is None:
        return [text]
    out = check_doc(doc, None if fix else text)
    if fix and not out:
        with open(path, "w", encoding="utf-8") as f:
            f.write(render(canonical(doc)))
    return out


def self_test():
    good = {"id": "c1", "vendor": "Acme", "name": "Acme Free", "kind": "gpu", "form": "free_tier",
            "free_amount": "10 GPU hours a month.", "resets": "monthly", "who_qualifies": ["Anyone with an account."],
            "card_required": False, "overage": "stops",
            "setup_steps": ["Create an account on the source page.", "Sign in with acme login."],
            "source": "https://acme.example/pricing", "checked": "2026-11-12"}

    def env(rows, **top):
        d = {"version": 1, "about": "a", "checked": "2026-11-12", "kinds": list(KINDS), "forms": list(FORMS),
             "rows": rows}
        d.update(top)
        return d

    def v(**kw):
        r = json.loads(json.dumps(good))
        r.update(kw)
        return r

    def without(k):
        return {x: y for x, y in good.items() if x != k}

    cases = [  # name, document, wants a finding
        ("a clean row passes", env([good]), False),
        ("a signup credit that resets one_time passes", env([v(form="signup_credit", resets="one_time")]), False),
        ("a cs_status field is refused", env([v(cs_status="have")]), True),
        ("an evidence field is refused", env([v(evidence=[{"url": "https://acme.example", "quote": "q"}])]), True),
        ("an account balance field is refused", env([v(balance=12)]), True),
        ("a private top-level key is refused", env([good], cs_summary="x"), True),
        ("a missing source is refused", env([without("source")]), True),
        ("a missing checked date is refused", env([without("checked")]), True),
        ("an http source fails", env([v(source="http://acme.example")]), True),
        ("a bad date fails", env([v(checked="12 Nov 2026")]), True),
        ("a row checked after the file date fails", env([v(checked="2026-12-01")]), True),
        ("a bad kind fails", env([v(kind="storage")]), True),
        ("a bad form fails", env([v(form="trial")]), True),
        ("a signup credit that resets monthly fails", env([v(form="signup_credit")]), True),
        ("a free tier that resets one_time fails", env([v(resets="one_time")]), True),
        ("an unknown overage fails", env([v(overage="maybe")]), True),
        ("an empty who_qualifies fails", env([v(who_qualifies=[])]), True),
        ("unlabeled arithmetic fails", env([v(free_amount="$30 a month; $360 is twelve months of it.")]), True),
        ("labeled arithmetic passes", env([v(free_amount="$12 covers 2,000 minutes (computed here).")]), False),
        ("an em dash fails", env([v(free_amount="one \u2014 two")]), True),
        ("an en dash in a step fails", env([v(setup_steps=["Open it \u2013 now.", "Run."])]), True),
        ("an email in a public field fails", env([v(who_qualifies=["write to x" + "@" + "acme.example"])]), True),
        ("one setup step is too few", env([v(setup_steps=["Sign up."])]), True),
        ("six setup steps are too many", env([v(setup_steps=["Do it."] * 6)]), True),
        ("a setup step over 25 words fails", env([v(setup_steps=["word " * 26, "Run."])]), True),
        ("a key flag in a step fails", env([v(setup_steps=["Sign up.", "Run acme login --token abc."])]), True),
        ("a key assignment in a step fails", env([v(setup_steps=["Sign up.", "Run ACME_API_KEY=abc acme."])]), True),
        ("a key named without a value passes", env([v(setup_steps=["Sign up.", "Store ACME_API_KEY in a keychain."])]),
         False),
        ("a duplicate id fails", env([good, good]), True),
        ("an empty catalog fails", env([]), True),
        ("an uppercase id fails", env([v(id="C1")]), True),
        ("a wrong kinds list fails", env([good], kinds=["gpu"]), True),
    ]
    bad = 0
    for name, doc, want in cases:
        got = bool(check_doc(doc))
        ok = got == want
        bad |= not ok
        print(f"self-test: {'ok   ' if ok else 'WRONG'} {name}")
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, "credits.json")
        doc = env([v(id="c2", vendor="Zed", kind="hosting"), v(id="c0", vendor="Ace", kind="gpu"), good])
        with open(p, "w", encoding="utf-8") as f:
            json.dump(doc, f)
        unsorted = bool(run(p))
        fixed = run(p, fix=True) == [] and run(p) == []
        with open(p, encoding="utf-8") as f:
            ids = [r["id"] for r in json.load(f)["rows"]]
        ok = unsorted and fixed and ids == ["c0", "c1", "c2"]
        bad |= not ok
        print(f"self-test: {'ok   ' if ok else 'WRONG'} a file out of order fails, and --fix sorts it by kind, vendor")
        with open(p, "w", encoding="utf-8") as f:
            f.write("not json")
        ok = bool(run(p))
        bad |= not ok
        print(f"self-test: {'ok   ' if ok else 'WRONG'} bytes that are not JSON are a finding")
        try:
            run(os.path.join(d, "missing.json"))
            ok = False
        except CannotCheck:
            ok = True
        bad |= not ok
        print(f"self-test: {'ok   ' if ok else 'WRONG'} a missing file is infrastructure (exit 2), not a finding")
    print("self-test passed" if not bad else "self-test FAILED")
    return 1 if bad else 0


def main(argv):
    args = argv[1:]
    if args == ["--self-test"]:
        return self_test()
    if args not in ([], ["--fix"]):
        print(__doc__)
        return 2
    try:
        out = run(CATALOG, fix=bool(args))
    except CannotCheck as e:
        print(f"catalog: could not check ({e}); infrastructure, not a finding")
        return 2
    for line in out:
        print(f"catalog: {line}")
    if out:
        print(f"catalog: {len(out)} finding(s)")
        return 1
    with open(CATALOG, encoding="utf-8") as f:
        n = len(json.load(f)["rows"])
    print(f"catalog: clean, {n} credits{', rewritten in canonical form' if args else ''}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
