"""The seeded fakes of `python3 -I tools/reread_agent.py --self-test`, which starts this script. Every case fakes the
token fetch and the token exchange, so nothing reaches GitHub or Anthropic."""
import asyncio
import contextlib
import io
import json
import os
import tempfile
import unittest
import urllib.error
from unittest import mock

import reread_agent as agent

ENV = {"ANTHROPIC_FEDERATION_RULE_ID": "fdrl_x", "ANTHROPIC_ORGANIZATION_ID": "org-x", "ANTHROPIC_WORKSPACE_ID": " ",
       "ANTHROPIC_SERVICE_ACCOUNT_ID": "svac_x", "ANTHROPIC_API_KEY": "leftover"}
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def http_error(code):
    return urllib.error.HTTPError(agent.EXCHANGE_URL, code, "x", {}, io.BytesIO(b"{}"))


class Federation(unittest.TestCase):
    def run_setup(self, env, exchange):
        """setup_federation with the given environment, a fake token and a fake exchange. Returns (result, stdout, urlopen)."""
        out = io.StringIO()
        with tempfile.TemporaryDirectory() as tmp, mock.patch.dict(os.environ, env, clear=True), \
                mock.patch.object(agent, "fetch_identity_token", return_value="fake.jwt.value"), \
                mock.patch.object(agent.threading, "Thread"), \
                mock.patch("urllib.request.urlopen", side_effect=exchange) as urlopen, contextlib.redirect_stdout(out):
            result = agent.setup_federation(tmp)
            if result is not None:
                self.assertTrue(os.path.isfile(os.path.join(result, "identity-token")))
            seen = dict(os.environ)
        return result, out.getvalue(), urlopen, seen

    def test_unset_rule_id_skips_without_a_call(self):
        env = {k: v for k, v in ENV.items() if k != "ANTHROPIC_FEDERATION_RULE_ID"}
        result, out, urlopen, _ = self.run_setup(env, AssertionError("no call expected"))
        self.assertIsNone(result)
        self.assertIn("::notice title=Weekly re-read skipped::", out)
        urlopen.assert_not_called()

    def test_401_skips_with_a_notice(self):
        result, out, urlopen, _ = self.run_setup(ENV, http_error(401))
        self.assertIsNone(result)
        self.assertIn("::notice title=Weekly re-read skipped::", out)
        self.assertIn("No federation rule matches", out)
        urlopen.assert_called_once()

    def test_other_status_still_fails(self):
        with self.assertRaises(urllib.error.HTTPError):
            self.run_setup(ENV, http_error(500))

    def test_exchange_body_and_masking(self):
        ok = mock.MagicMock()
        ok.__enter__.return_value = ok
        result, out, urlopen, seen = self.run_setup(ENV, [ok])
        self.assertIsNotNone(result)
        body = json.loads(urlopen.call_args[0][0].data)
        self.assertEqual(body["federation_rule_id"], "fdrl_x")
        self.assertEqual(body["service_account_id"], "svac_x")
        self.assertNotIn("workspace_id", body)  # a blank variable is not sent
        self.assertIn("::add-mask::fake.jwt.value", out)
        self.assertEqual(out.count("fake.jwt.value"), 2)  # masked twice (check, then file), never printed bare
        self.assertNotIn("ANTHROPIC_API_KEY", seen)
        self.assertNotIn("ANTHROPIC_WORKSPACE_ID", seen)
        self.assertEqual(seen["ANTHROPIC_PROFILE"], "default")

    def test_main_returns_zero_on_skip_without_the_sdk(self):
        with mock.patch.dict(os.environ, {}, clear=True), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(agent.main(), 0)


class Agent(unittest.TestCase):
    def test_read_hook_allows_only_catalog_and_agents_md(self):
        with tempfile.TemporaryDirectory() as tmp:
            old = os.getcwd()
            os.chdir(tmp)
            try:
                def decision(path):
                    return asyncio.run(agent.only_catalog_reads({"tool_input": {"file_path": path}}, None, None))
                for allowed in ("catalog/plans.json", "AGENTS.md", os.path.join(os.path.realpath(tmp), "catalog", "README.md")):
                    self.assertEqual(decision(allowed), {}, allowed)
                for denied in ("README.md", "/etc/hosts", "../x", "catalog/../README.md", "catalogue/x"):
                    self.assertEqual(decision(denied)["hookSpecificOutput"]["permissionDecision"], "deny", denied)
            finally:
                os.chdir(old)

    def test_prompt_names_rows_that_exist_here(self):
        prompt = agent.PROMPT.format(repo="o/r", today="2026-11-24")
        self.assertIn("o/r", prompt)
        for name in ("Credit facts", "tools/catalog.py --check"):
            self.assertIn(name, prompt)
        with open(os.path.join(ROOT, "AGENTS.md")) as handle:
            self.assertIn("| Credit facts |", handle.read())
        for path in ("catalog/README.md", "catalog/plans.json", "tools/catalog.py"):
            self.assertTrue(os.path.isfile(os.path.join(ROOT, path)), path)


if __name__ == "__main__":
    unittest.main(verbosity=1)
