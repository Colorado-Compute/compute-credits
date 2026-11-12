# catalog

`credits.json` is the one source of free compute credit facts for this repository. A fix lands here by pull request, never in a copy.

| File | What it is |
| --- | --- |
| `credits.json` | The credits, one row each, in canonical layout (sorted by kind, vendor, then name) |
| `check.py` | Guards the file: exact fields, plain text, https sources, dates, steps, no key in a command, no private fields |

## A row

| Field | Holds |
| --- | --- |
| `id` | A slug, unique |
| `vendor`, `name` | The names the vendor's page uses |
| `kind` | `gpu`, `cpu`, `inference`, `ci` or `hosting` |
| `form` | `free_tier` (an allowance that resets), `signup_credit` (a one-time amount) or `discount` (a price cut the page states) |
| `free_amount` | The free amount in the page's terms. Our own arithmetic carries "(computed here)" |
| `resets` | `daily`, `weekly`, `monthly`, `one_time`, `none` or `null`. A `signup_credit` is always `one_time` |
| `who_qualifies` | Who may use it, one line each, in the page's terms |
| `card_required` | `true` when the vendor wants a card, `false` when not, `null` when the page does not say |
| `overage` | `stops`, `bills` or `unknown`: what the page says happens at the limit |
| `setup_steps` | 2 to 5 steps, each under 25 words, that follow [the setup template](../guides/setup-template.md). No key value or key flag in a command |
| `source`, `checked` | The first-party page read, and the date it was read |

## What stays out

| Left out | Why |
| --- | --- |
| A row with no first-party `source` or no `checked` date | Every figure carries its vendor page and read date |
| A row from older research not re-read on the vendor's page | The `checked` date must mean the figures were read there that day |
| A closed free tier | Nothing to sign up for |
| A paid plan or pay-as-you-go rate | Not free; a `discount` row needs a price cut the vendor's page states |
| Some vendors, by policy | A publisher choice, not a judgment on the free tier |
| Account ids, emails, balances, `cs_*` and `evidence` fields | Private. `check.py` and `tools/checks.py` refuse them |

## Room for sign-up programs

The `no_incorporation` programs in `Colorado-Startups/startup-credits` (cloud trials and other credits that need no company) move here as `signup_credit` rows in a later pull request. Their `requirements` map to `who_qualifies`, and their `apply_steps` to `setup_steps`.

## Commands

| Command | What it does |
| --- | --- |
| `python3 -I catalog/check.py` | Every row passes; exit 1 names each finding |
| `python3 -I catalog/check.py --fix` | Rewrites the file in canonical layout, then checks it |
| `python3 -I catalog/check.py --self-test` | Seeded good and bad catalogs that must pass or fail |

The README tables are written from `credits.json`. A pull request that changes a row changes its README row too.
