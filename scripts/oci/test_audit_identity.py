"""Offline diagnostic tests; no credentials or real Oracle/HTTP calls."""
import contextlib
import io
import json
import os
from pathlib import Path
import types
import unittest
from unittest.mock import patch

import audit_identity as a

USER = "ocid1.user.oc1.." + "a" * 60
OTHER = "ocid1.user.oc1.." + "b" * 60
FP = ":".join(["12"] * 16)
OTHER_FP = ":".join(["ab"] * 16)


class IdentityTests(unittest.TestCase):
    def setUp(self):
        self.env = {"OCI_USER_OCID": USER, "OCI_FINGERPRINT": FP}
        self.expected = a.identity_digest(USER, FP)
        self.owner = {"id": USER, "lifecycle_state": "ACTIVE"}
        self.keys = [{"user_id": USER, "fingerprint": FP}]
        self.factory = unittest.mock.Mock(side_effect=lambda env: lambda user: (self.owner, self.keys))
        self.http = patch("urllib.request.OpenerDirector.open", side_effect=AssertionError("Real HTTP forbidden"))
        self.http.start()
        self.addCleanup(self.http.stop)

    def result(self):
        return a.diagnose(self.env, self.expected, self.factory)

    def test_explicit_expected_identity_and_registered_key_match(self):
        self.assertEqual(self.result(), "MATCH")
        self.factory.assert_called_once_with(self.env)

    def test_owner_or_fingerprint_mismatch_never_queries_oracle(self):
        for user, fp in ((OTHER, FP), (USER, OTHER_FP)):
            self.env.update(OCI_USER_OCID=user, OCI_FINGERPRINT=fp)
            self.assertEqual(self.result(), "MISMATCH")
        self.factory.assert_not_called()

    def test_missing_malformed_expected_digest_is_unknown_not_inferred(self):
        for value in (None, "", " ", "x" * 64, self.expected + "\n", USER, FP):
            self.assertEqual(a.diagnose(self.env, value, self.factory), "UNVERIFIED")
        self.factory.assert_not_called()

    def test_missing_or_malformed_secrets_are_unknown(self):
        for key, value in (("OCI_USER_OCID", None), ("OCI_USER_OCID", "bad\nuser"),
                           ("OCI_FINGERPRINT", None), ("OCI_FINGERPRINT", "12")):
            with self.subTest(key=key, value=value):
                env = dict(self.env, **{key: value})
                self.assertEqual(a.diagnose(env, self.expected, self.factory), "UNVERIFIED")
        self.factory.assert_not_called()

    def test_canonicalization_and_domain_separation(self):
        self.assertEqual(a.identity_digest(" " + USER + " ", FP.upper()), self.expected)
        self.assertNotEqual(a.identity_digest(USER, OTHER_FP), self.expected)
        self.assertNotEqual(a.identity_digest(OTHER, FP), self.expected)
        self.assertEqual(a.diagnose(self.env, self.expected.upper(), self.factory), "MATCH")

    def test_missing_registered_key_and_different_owner_mismatch(self):
        self.keys = []
        self.assertEqual(self.result(), "MISMATCH")
        self.keys = [{"user_id": USER, "fingerprint": OTHER_FP}]
        self.assertEqual(self.result(), "MISMATCH")
        self.owner["id"] = OTHER
        self.assertEqual(self.result(), "MISMATCH")

    def test_ambiguous_or_malformed_remote_records_fail_closed(self):
        for keys in (None, {}, [None], [{}], self.keys * 2, self.keys * 4,
                     [{"user_id": OTHER, "fingerprint": FP}], [{"user_id": USER, "fingerprint": "bad"}]):
            self.keys = keys
            self.assertEqual(self.result(), "UNVERIFIED")
        self.keys = [{"user_id": USER, "fingerprint": FP}]
        for owner in ({}, None, {"id": USER, "lifecycle_state": "INACTIVE"}):
            self.owner = owner
            self.assertEqual(self.result(), "UNVERIFIED")

    def test_denials_timeouts_and_sdk_errors_are_unknown_without_error_body(self):
        for error in (PermissionError(USER + FP), TimeoutError("private key"), RuntimeError("NotAuthorizedOrNotFound")):
            self.factory.side_effect = error
            self.assertEqual(self.result(), "UNVERIFIED")

    def test_main_prints_only_enum_even_if_dependency_writes_sensitive_errors(self):
        def noisy(*args):
            print(USER, FP)
            print("PRIVATE KEY", file=__import__("sys").stderr)
            return "UNVERIFIED"
        out, err = io.StringIO(), io.StringIO()
        with patch.object(a, "diagnose", side_effect=noisy), contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            self.assertEqual(a.main(), 0)
        self.assertEqual(out.getvalue(), "UNVERIFIED\n")
        self.assertEqual(err.getvalue(), "")

    def test_workflow_only_exposes_digest_input_to_separate_read_only_audit_step(self):
        text = (Path(__file__).resolve().parents[2] / ".github/workflows/oracle-a1.yml").read_text()
        provision, audit = text.split("\n  audit:\n", 1)
        self.assertNotIn("run: python scripts/oci/audit_identity.py", provision)
        self.assertIn("OCI_EXPECTED_IDENTITY_SHA256: ${{ inputs.expected_identity_sha256 }}", audit)
        self.assertIn("issues: read", audit)
        self.assertIn('cron: "*/10 * * * *"', text)
        self.assertNotIn("LaunchInstance", Path(a.__file__).read_text())

    def test_reader_uses_only_fixed_signed_gets_bounded_timeouts_and_no_retries(self):
        calls = []
        class Client:
            def __init__(self, config, **kwargs):
                calls.append(("init", kwargs))
            def get_user(self, **kwargs):
                calls.append(("get_user", kwargs))
                return types.SimpleNamespace(status=200, headers={}, data={"id": USER, "lifecycle_state": "ACTIVE"})
            def list_api_keys(self, **kwargs):
                calls.append(("list_api_keys", kwargs))
                return types.SimpleNamespace(status=200, headers={}, data=[{"user_id": USER, "fingerprint": FP}])
        sdk = types.SimpleNamespace(config=types.SimpleNamespace(validate_config=lambda c: None),
            identity=types.SimpleNamespace(IdentityClient=Client),
            retry=types.SimpleNamespace(NoneRetryStrategy=lambda: "NONE"),
            util=types.SimpleNamespace(to_dict=lambda d: d))
        env = dict(self.env, OCI_REGION="eu-paris-1", OCI_TENANCY_OCID="test-tenancy", OCI_PRIVATE_KEY="test-key")
        with patch.dict("sys.modules", {"oci": sdk}):
            self.assertEqual(a.diagnose(env, self.expected), "MATCH")
        self.assertEqual(calls, [("init", {"timeout": (10, 30), "retry_strategy": "NONE"}),
                                 ("get_user", {"user_id": USER}), ("list_api_keys", {"user_id": USER})])

    def test_reader_rejects_partial_or_unexpected_status(self):
        reader = object.__new__(a.OwnKeyReader)
        for status, headers in ((403, {}), (200, {"OPC-NEXT-PAGE": "more"})):
            response = types.SimpleNamespace(status=status, headers=headers, data=[])
            reader.client = types.SimpleNamespace(get_user=lambda **kw: response, list_api_keys=lambda **kw: response)
            with self.assertRaises(ValueError):
                reader(USER)


if __name__ == "__main__":
    unittest.main()
