"""Activation audit capability boundary: no real HTTP, OCI CLI or writes."""
import copy
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import audit_activation as x
import audit_a1 as a
import provision_a1 as p
from test_audit_a1 import Fake, NOW
from test_provision_a1 import FakeCLI, MemoryState, environment


def sdk_keys(value):
    if isinstance(value, list): return [sdk_keys(v) for v in value]
    if isinstance(value, dict): return {k.replace("-", "_"): sdk_keys(v) for k, v in value.items()}
    return value


class Backend:
    def __init__(self, env):
        self.cli = FakeCLI(env)
        self.calls = []
        self.overrides = {}
        self.env = env

    def __call__(self, operation, region, args):
        self.calls.append((operation, region, copy.deepcopy(args)))
        if operation in self.overrides:
            result = self.overrides[operation]
            if isinstance(result, Exception): raise result
            return result
        if operation in ("volumes", "boot_volumes", "boot_attachments", "volume_attachments"):
            return a.Page([])
        if operation == "compartments":
            return a.Page([{"id": self.env["OCI_COMPARTMENT_OCID"]}])
        if operation in ("subscriptions", "subscription", "usage"):
            return Fake()(operation, region, args)
        for prefix, (op, options) in x.READS.items():
            if op == operation:
                values = [*prefix]
                for flag, key in options.items(): values.extend([flag, args[key]])
                return a.Page(sdk_keys(self.cli.call(*values)))
        raise AssertionError("Unexpected or write operation")


class ActivationAuditTests(unittest.TestCase):
    def setUp(self):
        self.env = environment(); self.backend = Backend(self.env); self.state = MemoryState()
        self.http = patch("urllib.request.OpenerDirector.open", side_effect=AssertionError("Real HTTP forbidden"))
        self.process = patch("subprocess.run", side_effect=AssertionError("Real CLI forbidden"))
        self.http.start(); self.process.start()
        self.addCleanup(self.http.stop); self.addCleanup(self.process.stop)

    def run_audit(self):
        # Freeze clock for deterministic complete-month fixture intervals.
        original = a.Audit
        with patch.object(a, "Audit", side_effect=lambda reader, root, target: original(reader, root, target, NOW)):
            return x.run(a.Reader(self.backend), self.env, self.state)

    def test_complete_read_checks_pass_but_billing_remains_blocked_and_no_writes(self):
        before = self.state.read()
        with patch.object(p, "provision", side_effect=AssertionError("Provision forbidden")), \
                patch.object(p, "CLI", side_effect=AssertionError("CLI forbidden")), \
                patch.object(p, "begin_attempt", side_effect=AssertionError("State write forbidden")):
            report = self.run_audit()
        for name in ("configuration", "exact_launch_payload", "subscription", "home_region", "compartment", "network", "image", "shape", "quotas", "inventory_reads", "a1_allocation", "storage_allocation", "duplicate_state", "api_USAGE", "api_USAGE_ONLY", "api_COST"):
            self.assertEqual(report["activation_checks"][name]["status"], "PASS", name)
        for name in ("monthly_entitlement", "balanced_vpu_pricing", "external_allocation_enforcement"):
            self.assertEqual(report["activation_checks"][name]["status"], "BLOCKED")
        self.assertFalse(report["activation_ready"])
        self.assertFalse(report["launch_assessment"]["launch_authorized"])
        self.assertFalse(self.backend.cli.launches); self.assertFalse(self.state.history)
        self.assertEqual(self.state.read(), before)
        for secret in (self.env["OCI_PRIVATE_KEY"], self.env["OCI_SSH_PUBLIC_KEY"], "fake-token"):
            self.assertNotIn(secret, json.dumps(report))

    def test_every_write_or_unrecognized_parameter_is_rejected_before_transport(self):
        cli = x.ReadOnlyCLI(a.Reader(self.backend))
        for args in (("compute", "instance", "launch"), ("network", "subnet", "update"),
                     ("bv", "volume", "delete"), ("compute", "image", "get", "--image-id", "i", "--query", "x"),
                     ("compute", "image", "get"), ("compute", "image", "get", "--image-id", "a", "--image-id", "b")):
            with self.subTest(args=args), self.assertRaises(a.AuditError): cli.call(*args)
        with self.assertRaises(a.AuditError): cli.launch({})
        self.assertFalse(self.backend.calls)

    def test_invalid_image_network_or_region_never_looks_passed(self):
        for op, value, category in (("image", {"id": "WRONG"}, "image"),
                                     ("subnet", {}, "network"), ("regions", [], "home_region")):
            self.backend = Backend(self.env); self.backend.overrides[op] = a.Page(value)
            report = self.run_audit()
            self.assertEqual(report["activation_checks"][category]["status"], "BLOCKED")
            self.assertEqual(report["target_preflight"], "BLOCKED_read_or_validation_failed")
            self.assertFalse(self.state.history)

    def test_unreadable_usage_inventory_and_subscription_are_explicitly_blocked(self):
        for op, key in (("usage", "api_COST"), ("subscription", "subscription"), ("boot_volumes", "inventory_reads")):
            self.backend = Backend(self.env); self.backend.overrides[op] = a.AuditError("NotAuthorizedOrNotFound")
            report = self.run_audit()
            self.assertEqual(report["activation_checks"][key]["status"], "BLOCKED")
            self.assertFalse(report["activation_ready"])

    def test_subscription_denial_does_not_falsely_label_successful_resource_reads_partial(self):
        self.backend.overrides["subscriptions"] = a.AuditError("NotAuthorizedOrNotFound")
        report = self.run_audit()
        self.assertEqual(report["activation_checks"]["subscription"]["status"], "BLOCKED")
        self.assertEqual(report["activation_checks"]["inventory_reads"]["status"], "PASS")
        self.assertTrue(any(e["operation"] == "subscriptions" for e in report["errors"]))
        self.assertFalse(report["launch_assessment"]["launch_authorized"])

    def test_existing_vm_pending_and_created_state_never_reset_or_launch(self):
        for status in ("pending", "created"):
            self.state.value["status"] = status
            before = self.state.read()
            report = self.run_audit()
            self.assertEqual(report["activation_checks"]["duplicate_state"]["status"], "BLOCKED")
            self.assertEqual(self.state.read(), before); self.assertFalse(self.state.history)
        self.state = MemoryState()
        from test_provision_a1 import instance
        self.backend.cli.instances = [instance()]
        report = self.run_audit()
        self.assertTrue(report["safety_issue"]["matching_instance_present"])
        self.assertEqual(report["activation_checks"]["duplicate_state"]["status"], "BLOCKED")

    def test_issue_reader_forbids_patch_and_other_endpoints_even_if_called_accidentally(self):
        with patch.object(p.GitHubState, "http", return_value={}) as http:
            reader = x.IssueReader(self.env)
            for method, path, body in (("PATCH", reader.state.path, {}), ("GET", "/other", None), ("GET", reader.state.path, {})):
                with self.assertRaises(a.AuditError): reader.state.request(method, path, body)
            http.assert_not_called()
            reader.state.request("GET", reader.state.path)
            self.assertEqual(http.call_count, 1)

    def test_main_exports_sanitized_report_summary_and_never_overwrites(self):
        report = self.run_audit()
        import sys
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder)/"report.json"; summary = Path(folder)/"summary.md"
            args = ["audit_activation.py", "--execute", "--output", str(output)]
            with patch.object(sys, "argv", args), patch.object(x, "run", return_value=report), \
                    patch.object(a, "SDKBackend"), patch.object(x, "IssueReader"), \
                    patch.dict(os.environ, {"GITHUB_STEP_SUMMARY": str(summary)}), patch("sys.stdout", new=io.StringIO()) as log:
                self.assertEqual(x.main(), 0)
                before = output.read_bytes()
                self.assertEqual(x.main(), 2)
                self.assertEqual(before, output.read_bytes())
                self.assertIn("ACTIVATION BLOCKED", log.getvalue())
                self.assertIn("balanced_vpu_pricing", summary.read_text())
                self.assertNotIn("fake-token", output.read_text())

    def test_workflow_audit_has_only_read_permissions_and_never_invokes_provisioner(self):
        text = (Path(__file__).resolve().parents[2]/".github/workflows/oracle-a1.yml").read_text()
        audit = text.split("\n  audit:\n", 1)[1]
        self.assertIn("issues: read", audit); self.assertNotIn("issues: write", audit)
        self.assertIn("audit_activation.py --execute", audit)
        self.assertNotIn("provision_a1.py --execute", audit)
        self.assertNotIn("OCI_A1_PROVISIONING_ENABLED:", audit)
        self.assertIn('cron: "*/10 * * * *"', text)
        self.assertIn("inputs.audit_only", text)


if __name__ == "__main__": unittest.main()
