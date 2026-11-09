"""Read-only Free Tier evidence regressions; all transport mocked."""
import json
import types
import unittest
from unittest.mock import patch

import audit_a1 as a
import free_tier_safety as f
import provision_a1 as p
from test_audit_a1 import Fake, NOW, ROOT, CHILD
from test_provision_a1 import FakeCLI, MemoryState, environment


class FreeTierTests(unittest.TestCase):
    def setUp(self):
        self.env = environment()
        self.fake = Fake()
        self.fake.override.update(instances=a.Page([]), volumes=a.Page([]), boot_volumes=a.Page([]))
        self.fake.override["limits"] = lambda op, region, args: a.Page({"used": 0, "available":
            {"standard-a1-core-count": 41, "standard-a1-memory-count": 277,
             "total-storage-gb": 30720}[args["limit_name"]]})
        self.http = patch("urllib.request.OpenerDirector.open", side_effect=AssertionError("Real HTTP forbidden"))
        self.process = patch("subprocess.run", side_effect=AssertionError("Real subprocess forbidden"))
        self.http.start(); self.process.start()
        self.addCleanup(self.http.stop); self.addCleanup(self.process.stop)

    def report(self):
        return a.Audit(a.Reader(self.fake), ROOT, CHILD, NOW).run()

    def assess(self, report=None, payload=None):
        return f.assess(report or self.report(), payload or f.launch_payload(self.env), self.env)

    def test_free_tier_requires_list_and_detail_and_retains_only_enums(self):
        self.fake.override["subscription"] = a.Page({"id": "subscription-test", "plan_type": "FREE_TIER",
            "billing_address": "PRIVATE-ADDRESS", "payment_options": "PRIVATE-CARD"})
        report = self.report()
        self.assertEqual(report["subscription"], {"plan_type": "FREE_TIER", "verified": True})
        self.assertNotIn("PRIVATE-", json.dumps(report))
        calls = [args for op, _, args in self.fake.calls if op in ("subscription", "subscriptions")]
        self.assertTrue(all(x["compartment_id"] == ROOT and x["osp_home_region"] == f.REGION for x in calls))
        result = self.assess(report)
        self.assertNotIn("FREE_TIER_subscription_not_verified", result["blockers"])
        self.assertFalse(result["launch_authorized"])

    def test_sdk_subscription_reader_uses_exact_read_methods_and_items_envelope(self):
        calls = []
        class Client:
            def list_subscriptions(self, **args):
                calls.append(("list", args))
                return types.SimpleNamespace(data={"items": [{"id": "s", "plan_type": "FREE_TIER"}]}, headers={}, status=200)
            def get_subscription(self, **args):
                calls.append(("get", args))
                return types.SimpleNamespace(data={"id": "s", "plan_type": "FREE_TIER"}, headers={}, status=200)
        backend = object.__new__(a.SDKBackend)
        backend.clients = {("subscription", a.REGION): Client()}
        backend.oci = types.SimpleNamespace(util=types.SimpleNamespace(to_dict=lambda x: x),
            exceptions=types.SimpleNamespace(ServiceError=type("ServiceError", (Exception,), {})))
        reader = a.Reader(backend)
        args = {"osp_home_region": a.REGION, "compartment_id": ROOT}
        self.assertEqual(reader.read("subscriptions", **args), [{"id": "s", "plan_type": "FREE_TIER"}])
        self.assertEqual(reader.read("subscription", subscription_id="s", **args)["id"], "s")
        self.assertEqual(calls, [("list", args), ("get", dict(args, subscription_id="s"))])

    def test_disabled_entrypoint_never_initializes_oci_or_state(self):
        import os
        import sys
        import io
        for value in ("false", ""):
            env = dict(environment(), OCI_A1_PROVISIONING_ENABLED=value,
                       GITHUB_ACTIONS="true", GITHUB_REPOSITORY=p.REPOSITORY)
            with patch.dict(os.environ, env, clear=True), patch.object(sys, "argv", ["provision_a1.py", "--execute"]), \
                    patch.object(p, "CLI") as cli, patch("sys.stderr", new=io.StringIO()):
                self.assertEqual(p.main(), 1)
                cli.assert_not_called()

    def test_missing_conflicting_paid_and_upgrading_plans_fail_closed(self):
        for value in (None, "PAYG", "UNKNOWN_ENUM_VALUE", "free_tier"):
            self.fake.override["subscription"] = a.Page({"id": "subscription-test", "plan_type": value})
            self.assertIn("FREE_TIER_subscription_not_verified", self.assess()["blockers"])
        for op, data in (("subscriptions", {"items": []}),
                         ("subscriptions", {"items": [{"id": "a"}, {"id": "b"}]}),
                         ("subscription", {"id": "wrong", "plan_type": "FREE_TIER"}),
                         ("subscription", {"id": "subscription-test", "plan_type": "FREE_TIER", "upgrade_state": "SUBMITTED"}),
                         ("subscription", {"id": "subscription-test", "plan_type": "FREE_TIER", "time_plan_upgrade": "2026-01-01"})):
            with self.subTest(data=data):
                self.fake = Fake()
                self.fake.override[op] = a.Page(data)
                self.assertFalse(self.report()["subscription"]["verified"])

    def test_subscription_permission_failures_and_pagination_fail_closed(self):
        for value in (a.AuditError("NotAuthorizedOrNotFound"), a.AuditError("TooManyRequests"),
                      a.Page({"items": []}, "repeated"), a.Page([]), a.Page({}, status=500)):
            self.fake.override["subscriptions"] = value
            self.assertFalse(self.report()["subscription"]["verified"])
        self.fake.override["subscriptions"] = lambda op, region, args: (a.Page({"items": [{"id": "a", "plan_type": "FREE_TIER"}]}, "next")
            if "page" not in args else a.Page({"items": [{"id": "b", "plan_type": "PAYG"}]}))
        self.assertFalse(self.report()["subscription"]["verified"])

    def test_exact_payload_rejects_drift_extra_options_and_boolean_numbers(self):
        for key, value in (("shape", "VM.Standard.A2.Flex"), ("availabilityDomain", "other"),
                           ("assignPublicIp", False), ("capacityReservationId", "reservation")):
            payload = f.launch_payload(self.env); payload[key] = value
            self.assertIn("launch_payload_not_exact_2_12_50_10", self.assess(payload=payload)["blockers"])
        for group, key, value in (("shapeConfig", "ocpus", 4), ("shapeConfig", "ocpus", True),
                                 ("shapeConfig", "memoryInGBs", 24), ("sourceDetails", "bootVolumeSizeInGBs", 51),
                                 ("sourceDetails", "bootVolumeVpusPerGB", 20)):
            payload = f.launch_payload(self.env); payload[group][key] = value
            self.assertIn("launch_payload_not_exact_2_12_50_10", self.assess(payload=payload)["blockers"])

    def test_current_free_tier_envelope_and_retained_storage_limits(self):
        for key, values, category in (
            ("known_allocated_ocpus", [1, 2, None], "A1_OCPU"),
            ("known_allocated_memory_gbs", [1, 12, float("nan")], "A1_memory"),
            ("home_region_known_boot_and_block_gbs", [151, 200, False], "storage")):
            for value in values:
                report = self.report(); report["observed_footprint_NOT_billing_usage"][key] = value
                self.assertTrue(any(x.startswith(category) for x in self.assess(report)["blockers"]))
        report = self.report(); report["observed_footprint_NOT_billing_usage"]["home_region_known_boot_and_block_gbs"] = 150
        self.assertFalse(any(x.startswith("storage_allocation") for x in self.assess(report)["blockers"]))

    def test_storage_inventory_counts_detached_volumes_and_other_compartments(self):
        self.fake.override["boot_volumes"] = lambda op, region, args: a.Page([{
            "id": "retained-" + args["compartment_id"] + region + args["availability_domain"],
            "size_in_gbs": 50, "vpus_per_gb": 10, "lifecycle_state": "AVAILABLE"}])
        report = self.report()
        self.assertGreater(report["observed_footprint_NOT_billing_usage"]["home_region_known_boot_and_block_gbs"], 150)
        self.assertTrue(all(x["attachment"] == "UNATTACHED" for x in report["volumes"]))
        self.assertIn("storage_allocation_exceeded_or_unknown", self.assess(report)["blockers"])

    def test_incomplete_visibility_and_missing_target_never_authorize(self):
        for op in ("compartments", "instances", "boot_volumes", "volumes"):
            self.fake = Fake(); self.fake.override[op] = a.AuditError("NotAuthorizedOrNotFound")
            self.assertIn("inventory_incomplete_or_ambiguous", self.assess()["blockers"])
        self.fake = Fake(); self.fake.override["compartments"] = a.Page([])
        self.assertTrue(any(e["category"] == "target_missing_from_subtree_inventory" for e in self.report()["errors"]))

    def test_wrong_home_and_missing_or_exhausted_quota(self):
        report = self.report(); report["home_region_verified"] = False
        self.assertIn("Paris_home_region_not_verified", self.assess(report)["blockers"])
        report = self.report(); report["service_limits"] = []
        self.assertTrue(any("quota_unverified" in x for x in self.assess(report)["blockers"]))
        report = self.report(); report["service_limits"][0]["available"] = 0
        self.assertTrue(any("quota_unverified" in x for x in self.assess(report)["blockers"]))
        report = self.report()  # available=41 is admission data, never a free ceiling.
        self.assertFalse(any("quota_unverified" in x for x in self.assess(report)["blockers"]))

    def test_unproven_billing_has_no_env_report_flag_or_zero_cost_override(self):
        self.env.update(OCI_A1_FREE_ELIGIBLE="true", OCI_A1_BILLING_VERIFIED="true", OCI_A1_EXPECTED_PLAN_TYPE="FREE_TIER")
        report = self.report()
        report.update(zero_cost_eligibility="VERIFIED", tenancy_wide_visibility_proven=True)
        result = self.assess(report)
        self.assertFalse(result["launch_authorized"])
        self.assertTrue(any("Balanced_VPU" in x for x in result["blockers"]))
        self.assertTrue(any("monthly_meter" in x for x in result["blockers"]))

    def test_actual_provision_boundary_never_writes_state_on_missing_evidence(self):
        env = environment(); store = MemoryState(); cli = FakeCLI(env)
        with patch.object(f, "collect", return_value=self.report()):
            with self.assertRaisesRegex(p.Unsafe, "Free Tier safety blocked"):
                p.provision(cli, env, store)
        self.assertFalse(cli.launches); self.assertFalse(store.history)

    def test_prelaunch_transient_failure_never_mutates_state_or_retries(self):
        for error in (p.OCIError("TooManyRequests"), p.OCIError("InternalError")):
            env = environment(); store = MemoryState(); cli = FakeCLI(env)
            cli.overrides[("compute", "instance", "list")] = error
            with self.assertRaises(p.OCIError): p.provision(cli, env, store)
            self.assertEqual(len(cli.calls), 1)
            self.assertFalse(cli.launches); self.assertFalse(store.history)

    def test_launch_rate_limit_or_transient_error_retains_pending(self):
        for code in ("TooManyRequests", "InternalError"):
            env = environment(); store = MemoryState(); cli = FakeCLI(env)
            cli.launch_result = p.OCIError(code)
            with patch.object(p, "require_free_tier_launch_safety"):
                with self.assertRaises(p.OCIError): p.provision(cli, env, store)
            self.assertEqual(len(cli.launches), 1)
            self.assertEqual(store.value["status"], "pending")
            with self.assertRaises(p.Unsafe): p.provision(FakeCLI(env), env, store)


if __name__ == "__main__":
    unittest.main()
