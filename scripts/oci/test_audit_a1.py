"""Offline audit boundary tests: no OCI credentials, subprocess or HTTP permitted."""
import datetime as dt
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

import audit_a1 as a


NOW = dt.datetime(2026, 11, 9, 12, tzinfo=dt.timezone.utc)
ROOT, CHILD, OTHER = "ocid1.tenancy.private", "ocid1.compartment.child", "ocid1.compartment.nested"


class Fake:
    def __init__(self):
        self.calls = []
        self.override = {}

    def __call__(self, op, region, args):
        self.calls.append((op, region, args))
        if op in self.override:
            result = self.override[op]
            if isinstance(result, Exception):
                raise result
            return result(op, region, args) if callable(result) else result
        if op == "subscriptions":
            return a.Page({"items": [{"id": "subscription-test", "plan_type": "FREE_TIER"}]})
        if op == "subscription":
            return a.Page({"id": "subscription-test", "plan_type": "FREE_TIER"})
        if op == "regions":
            return a.Page([{"region_name": a.REGION, "is_home_region": True, "status": "READY"},
                           {"region_name": "eu-frankfurt-1", "is_home_region": False, "status": "READY"}])
        if op == "compartments":
            return a.Page([{"id": CHILD}, {"id": OTHER}])
        if op == "domains":
            return a.Page([{"name": region + "-AD-1"}, {"name": region + "-AD-2"}])
        if op == "instances":
            return a.Page([{"id": "private-instance" + args["compartment_id"] + region, "shape": a.SHAPE, "lifecycle_state": "STOPPED",
                            "shape_config": {"ocpus": 2, "memory_in_gbs": 12}}])
        if op in ("volumes", "boot_volumes"):
            return a.Page([{"id": op + args["compartment_id"] + region + args.get("availability_domain", ""),
                            "size_in_gbs": 50, "vpus_per_gb": 10, "lifecycle_state": "AVAILABLE"}])
        if op in ("volume_attachments", "boot_attachments"):
            return a.Page([])
        if op == "limits":
            return a.Page({"used": 0, "available": 41})
        if op == "usage":
            query = args["request_summarized_usages_details"]["query_type"]
            row = {"sku_part_number": "B93297", "unit": "OCPU_HOURS", "computed_quantity": 100,
                   "computed_amount": 0, "currency": "CHF",
                   "time_usage_started": "2026-11-01T00:00:00Z", "time_usage_ended": "2026-11-02T00:00:00Z"}
            if query == "USAGE":
                row.pop("computed_amount")
            return a.Page({"items": [row]})
        raise AssertionError("Unexpected operation")


class AuditTests(unittest.TestCase):
    def setUp(self):
        self.http = patch("urllib.request.OpenerDirector.open", side_effect=AssertionError("Real HTTP forbidden"))
        self.process = patch("subprocess.run", side_effect=AssertionError("Real subprocess forbidden"))
        self.http.start()
        self.process.start()
        self.addCleanup(self.http.stop)
        self.addCleanup(self.process.stop)
        self.fake = Fake()

    def run_audit(self, **reader_options):
        return a.Audit(a.Reader(self.fake, **reader_options), ROOT, CHILD, NOW).run()

    def test_all_compartments_regions_domains_and_unattached_volumes(self):
        result = self.run_audit()
        comps = next(args for op, _, args in self.fake.calls if op == "compartments")
        self.assertEqual(comps["access_level"], "ANY")
        self.assertTrue(comps["compartment_id_in_subtree"])
        self.assertEqual({args["compartment_id"] for op, _, args in self.fake.calls if op == "instances"}, {ROOT, CHILD, OTHER})
        self.assertEqual({region for op, region, _ in self.fake.calls if op == "instances"}, {a.REGION, "eu-frankfurt-1"})
        self.assertEqual(len(result["instances"]), 6)
        self.assertEqual(len(result["volumes"]), 18)
        self.assertTrue(all(v["attachment"] == "UNATTACHED" for v in result["volumes"]))
        self.assertTrue(all(v["billing_eligibility"] == "UNVERIFIED" for v in result["volumes"]))
        self.assertEqual(result["zero_cost_eligibility"], "UNVERIFIED")
        self.assertFalse(result["tenancy_wide_visibility_proven"])
        self.assertEqual(result["inventory_read_status"], "ENUMERATED_SCOPES_READ")

    def test_permission_failures_are_partial_not_empty_or_free(self):
        for op in ("compartments", "instances", "boot_volumes", "volumes", "domains", "limits"):
            with self.subTest(op=op):
                self.fake = Fake()
                self.fake.override[op] = a.AuditError("NotAuthorizedOrNotFound")
                report = self.run_audit()
                self.assertEqual(report["inventory_read_status"], "PARTIAL")
                self.assertTrue(any(x["operation"] == op for x in report["errors"]))
                self.assertEqual(report["zero_cost_eligibility"], "UNVERIFIED")

    def test_attachment_permission_failure_never_labels_detached(self):
        self.fake.override["boot_attachments"] = a.AuditError("NotAuthorizedOrNotFound")
        report = self.run_audit()
        self.assertTrue(all(v["attachment"] == "UNKNOWN" for v in report["volumes"] if v["kind"] == "boot"))

    def test_malformed_and_missing_volume_metadata_is_partial(self):
        for value in ({}, {"id": "v", "size_in_gbs": None},
                      {"id": "v", "size_in_gbs": False, "vpus_per_gb": 10},
                      {"id": "v", "size_in_gbs": 50, "vpus_per_gb": 10, "lifecycle_state": "NEW_UNKNOWN"}):
            with self.subTest(value=value):
                self.fake.override["boot_volumes"] = a.Page([value])
                report = self.run_audit()
                self.assertEqual(report["inventory_read_status"], "PARTIAL")

    def test_pagination_follows_all_pages_and_usage_items_envelope(self):
        for op, data in (("instances", [{"id": "one"}]), ("usage", {"items": [{"id": "one"}]})):
            calls = []
            def fetch(operation, region, args):
                calls.append(args)
                return a.Page(data, "second" if "page" not in args else None)
            self.assertEqual(len(a.Reader(fetch).read(op)), 2)
            self.assertEqual(calls, [{}, {"page": "second"}])

    def test_pagination_loop_budget_and_missing_pages_fail_closed(self):
        for fetch in (lambda *args: a.Page([], "same"),
                      lambda *args: a.Page([], ""),
                      lambda *args: a.Page(None),
                      lambda *args: a.Page({"data": []}),
                      lambda *args: a.Page([], status=403)):
            with self.subTest(fetch=fetch), self.assertRaises(a.AuditError):
                a.Reader(fetch, max_pages=2).read("instances")
        self.fake.override["volumes"] = lambda op, region, args: (a.Page([{"id": "partial"}], "next")
            if "page" not in args else (_ for _ in ()).throw(a.AuditError("permission_lost")))
        report = self.run_audit()
        self.assertEqual(report["inventory_read_status"], "PARTIAL")
        self.assertFalse(any(v["ref"] == a.ref("partial") for v in report["volumes"]))

    def test_global_budgets_are_bounded_and_report_incomplete(self):
        report = self.run_audit(max_calls=2)
        self.assertLessEqual(report["read_calls"], 2)
        self.assertTrue(report["errors"])
        with self.assertRaises(a.AuditError):
            a.Reader(lambda *args: a.Page([{}, {}]), max_items=1).read("instances")
        with self.assertRaises(a.AuditError):
            a.Reader(self.fake, seconds=-1).read("instances")

    def test_ambiguous_cost_data_is_never_zero_cost_evidence(self):
        rows = ([], [{}], [{"sku_part_number": "OTHER"}],
            [{"sku_part_number": "B93297", "unit": "OCPU_HOURS", "computed_quantity": None}],
            [{"sku_part_number": "B93297", "unit": "OCPU_HOURS", "computed_quantity": 5, "computed_amount": -1, "currency": "CHF"}],
            [{"sku_part_number": "B93297", "unit": "OCPU_HOURS", "computed_quantity": 5, "is_forecast": True}])
        for items in rows:
            with self.subTest(items=items):
                self.fake.override["usage"] = a.Page({"items": items})
                report = self.run_audit()
                self.assertTrue(any(x["operation"] == "usage" for x in report["errors"]))
                self.assertEqual(report["billing"]["remaining_free_allowance"], "UNVERIFIED")

    def test_empty_success_explicitly_checks_all_three_access_types(self):
        self.fake.override["usage"] = a.Page({"items": []})
        report = self.run_audit()
        self.assertEqual(report["billing"]["api_access"],
                         {"USAGE": "READ_SUCCEEDED", "USAGE_ONLY": "READ_SUCCEEDED", "COST": "READ_SUCCEEDED"})
        queries = [args["request_summarized_usages_details"]["query_type"] for op, _, args in self.fake.calls if op == "usage"]
        self.assertEqual(queries, ["USAGE", "USAGE_ONLY", "COST"])
        self.assertEqual(report["billing"]["remaining_free_allowance"], "UNVERIFIED")
        self.assertEqual({e.get("query") for e in report["errors"] if e["operation"] == "usage"}, set(queries))

    def test_usage_permission_failure_does_not_prevent_inventory_report(self):
        self.fake.override["usage"] = a.AuditError("NotAuthorizedOrNotFound")
        report = self.run_audit()
        self.assertTrue(report["volumes"])
        self.assertEqual(report["billing"]["rows"], [])
        self.assertTrue(any(x["operation"] == "usage" for x in report["errors"]))

    def test_usage_only_permission_collects_quantity_without_hiding_cost_denial(self):
        def query(op, region, args):
            kind = args["request_summarized_usages_details"]["query_type"]
            if kind in ("USAGE", "COST"):
                raise a.AuditError("NotAuthorizedOrNotFound")
            return a.Page({"items": [{"sku_part_number": "B93297", "unit": "OCPU_HOURS",
                "computed_quantity": 10, "time_usage_started": "2026-11-01T00:00:00Z",
                "time_usage_ended": "2026-11-02T00:00:00Z"}]})
        self.fake.override["usage"] = query
        report = self.run_audit()
        self.assertEqual([x["query"] for x in report["billing"]["rows"]], ["USAGE_ONLY"])
        self.assertEqual({e.get("query") for e in report["errors"] if e["operation"] == "usage"}, {"USAGE", "COST"})
        self.assertEqual(report["zero_cost_eligibility"], "UNVERIFIED")

    def test_zero_cost_and_exact_50_10_metadata_do_not_prove_future_free_vpu(self):
        report = self.run_audit()
        self.assertTrue(all(v["matches_target_size_and_base_vpu"] for v in report["volumes"]))
        self.assertTrue(all(v["billing_eligibility"] == "UNVERIFIED" for v in report["volumes"]))
        costs = [r for r in report["billing"]["rows"] if r["query"] == "COST"]
        self.assertTrue(costs)
        self.assertTrue(all(r["amount"] == 0 for r in costs))
        self.assertEqual(report["zero_cost_eligibility"], "UNVERIFIED")

    def test_41_service_headroom_is_separate_from_billing(self):
        report = self.run_audit()
        self.assertTrue(all(r["available"] == 41 and not r["billing_entitlement"] for r in report["service_limits"]))
        self.assertEqual(report["zero_cost_eligibility"], "UNVERIFIED")

    def test_billing_window_is_unfiltered_tenancy_not_verified_reset_or_balance(self):
        report = self.run_audit()
        queries = [args["request_summarized_usages_details"] for op, _, args in self.fake.calls if op == "usage"]
        self.assertEqual({q["query_type"] for q in queries}, {"USAGE", "USAGE_ONLY", "COST"})
        self.assertTrue(all(q["tenant_id"] == ROOT and "filter" not in q for q in queries))
        self.assertTrue(all(q["time_usage_started"].day == 1 and q["time_usage_ended"].hour == 0 for q in queries))
        self.assertTrue(report["billing"]["reports_are_delayed"])
        self.assertIn("NOT_verified", report["billing"]["window"])

    def test_report_omits_raw_ids_account_metadata_and_provider_bodies(self):
        report = self.run_audit()
        text = json.dumps(report)
        for raw in (ROOT, CHILD, OTHER, "private-instance", "GITHUB_TOKEN", "PRIVATE KEY"):
            self.assertNotIn(raw, text)

    def test_unknown_operations_never_reach_transport(self):
        reader = a.Reader(self.fake)
        for op in ("launch", "delete_volume", "update_instance", "work_request"):
            with self.assertRaises(a.AuditError):
                reader.read(op)
        self.assertFalse(self.fake.calls)
        self.assertTrue(all(name.startswith(("list_", "get_")) or name == "request_summarized_usages"
                            for _, name, _ in a.OPERATIONS.values()))

    def test_sdk_allowlist_cannot_be_bypassed_directly(self):
        backend = object.__new__(a.SDKBackend)
        with self.assertRaises(a.AuditError):
            backend("launch", a.REGION, {})

    def test_missing_billing_dates_do_not_look_like_complete_monthly_usage(self):
        self.fake.override["usage"] = a.Page({"items": [{"sku_part_number": "B93297", "unit": "OCPU_HOURS",
                                                      "computed_quantity": 0, "computed_amount": 0, "currency": "CHF"}]})
        report = self.run_audit()
        self.assertFalse(report["billing"]["rows"])
        self.assertTrue(any(e["category"] == "ambiguous_billing_row" for e in report["errors"]))

    def test_usage_only_does_not_imply_zero_cost_or_remaining_balance(self):
        report = self.run_audit()
        totals = report["billing"]["observed_totals_by_exact_unit_and_currency"]
        self.assertTrue(all(x["amount"] is None for x in totals if x["query"] == "USAGE"))
        self.assertEqual(report["zero_cost_eligibility"], "UNVERIFIED")

    def test_sdk_backend_uses_pinned_read_methods_and_disables_retries(self):
        created = []
        class Client:
            def __init__(self, config, **kwargs):
                created.append(kwargs)
            def list_instances(self, **args):
                return types.SimpleNamespace(data=[], headers={}, status=200)
        sdk = types.SimpleNamespace(config=types.SimpleNamespace(validate_config=lambda c: None),
            identity=types.SimpleNamespace(IdentityClient=Client),
            osp_gateway=types.SimpleNamespace(SubscriptionServiceClient=Client),
            core=types.SimpleNamespace(ComputeClient=Client, BlockstorageClient=Client),
            limits=types.SimpleNamespace(LimitsClient=Client), usage_api=types.SimpleNamespace(UsageapiClient=Client),
            retry=types.SimpleNamespace(NoneRetryStrategy=lambda: "NONE"),
            exceptions=types.SimpleNamespace(ServiceError=type("ServiceError", (Exception,), {})),
            util=types.SimpleNamespace(to_dict=lambda d: d))
        env = {key: "PRIVATE-SENTINEL" for key in ("OCI_USER_OCID", "OCI_TENANCY_OCID", "OCI_FINGERPRINT", "OCI_PRIVATE_KEY")}
        env["OCI_REGION"] = a.REGION
        with patch.dict(sys.modules, {"oci": sdk}):
            backend = a.SDKBackend(env)
            self.assertEqual(backend("instances", a.REGION, {"compartment_id": ROOT}).data, [])
        self.assertEqual(created, [{"timeout": (10, 60), "retry_strategy": "NONE"}])

    def test_main_requires_explicit_execution_and_never_overwrites_report(self):
        with patch.object(sys, "argv", ["audit_a1.py"]), patch("sys.stderr", new=io.StringIO()):
            self.assertEqual(a.main(), 2)
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "evidence.json"
            output.write_text("existing", encoding="utf-8")
            with patch.object(sys, "argv", ["audit_a1.py", "--execute", "--output", str(output)]), \
                    patch.object(a, "SDKBackend", return_value=self.fake), \
                    patch.dict(os.environ, {"OCI_TENANCY_OCID": ROOT, "OCI_COMPARTMENT_OCID": CHILD}), \
                    patch("sys.stderr", new=io.StringIO()):
                self.assertEqual(a.main(), 2)
            self.assertEqual(output.read_text(), "existing")

    def test_workflow_dispatch_audit_job_cannot_select_provisioning(self):
        workflow = (Path(__file__).resolve().parents[2] / ".github/workflows/oracle-a1.yml").read_text()
        self.assertIn("cron: \"*/10 * * * *\"", workflow)
        self.assertIn("if: ${{ vars.OCI_A1_PROVISIONING_ENABLED == 'true' && !(github.event_name == 'workflow_dispatch' && inputs.audit_only) }}", workflow)
        audit_job = workflow.split("\n  audit:\n", 1)[1]
        self.assertIn("if: ${{ github.event_name == 'schedule' || (github.event_name == 'workflow_dispatch' && inputs.audit_only) }}", audit_job)
        self.assertNotIn("provision_a1.py --execute", audit_job)
        self.assertNotIn("issues: write", audit_job)
        self.assertNotIn("GITHUB_TOKEN", audit_job)
        self.assertIn("audit_a1.py --execute", audit_job)


if __name__ == "__main__":
    unittest.main()
