"""Quota/meter proofs cannot be replaced by headroom or assertion flags."""
import copy
import hashlib
import unittest
from unittest.mock import patch

import allocation_controls as c
import monthly_entitlement as m
import audit_a1 as a
import free_tier_safety as f
from test_audit_activation import Backend
from test_provision_a1 import environment
from test_audit_a1 import NOW

ROOT = environment()["OCI_TENANCY_OCID"]


def quota():
    return {"id": "ocid1.quota.oc1.test", "name": c.NAME, "compartment_id": ROOT,
            "lifecycle_state": "ACTIVE", "statements": c.statements(),
            "time_created": "2020-01-01T00:00:00Z"}


def limits():
    return [{"scope": scope, "domain_ref": hashlib.sha256(c.AD.encode()).hexdigest()[:16],
             "limit": name, "effective_quota_value": cap} for scope in ("root", "target")
            for name, cap in (("standard-a1-core-count", 2), ("standard-a1-memory-count", 12), ("total-storage-gb", 200))]


def billing():
    return {"generated_at": "2026-11-10T00:00:00Z", "billing": {
        "query_start": "2026-11-01T00:00:00Z", "query_end": "2026-11-09T00:00:00Z",
        "api_access": {"USAGE": "READ_SUCCEEDED", "USAGE_ONLY": "READ_SUCCEEDED", "COST": "READ_SUCCEEDED"},
        "rows": [{"query": q, "sku": sku, "unit": unit, "quantity": 100,
                  "time_started": "2026-11-01T00:00:00Z", "time_ended": "2026-11-09T00:00:00Z"}
                 for q in ("USAGE", "USAGE_ONLY", "COST") for sku, unit in (("B93297", "OCPU_HOURS"), ("B93298", "GB_HOURS"))]}}


class EvidenceTests(unittest.TestCase):
    def setUp(self):
        self.http = patch("urllib.request.OpenerDirector.open", side_effect=AssertionError("HTTP forbidden"))
        self.process = patch("subprocess.run", side_effect=AssertionError("CLI forbidden"))
        self.http.start(); self.process.start()
        self.addCleanup(self.http.stop); self.addCleanup(self.process.stop)

    def test_exact_root_quota_and_effective_values_prove_current_not_historical_ceiling(self):
        result = c.verify(quota(), quota(), ROOT, limits())
        self.assertTrue(result["current_root_enforcement_verified"])
        self.assertFalse(result["historical_month_enforcement_verified"])
        self.assertNotIn("ocid1", str(result))

    def test_compartment_only_policy_cannot_prove_tenancy_wide_protection(self):
        for item in ("compartment_id", "id", "name", "lifecycle_state"):
            q = quota(); q[item] = "other"
            self.assertFalse(c.verify(quota(), q, ROOT, limits())["current_root_enforcement_verified"])

    def test_wrong_region_ad_caps_and_unset_or_reordered_statements_reject(self):
        base = c.statements()
        mutations = [base + ["unset compute-core quota standard-a1-core-count in tenancy"], list(reversed(base)),
                     [s.replace("to 2 ", "to 4 ") for s in base],
                     [s.replace(c.REGION, "eu-frankfurt-1") for s in base],
                     [s.replace(c.AD, "AD-OTHER") for s in base],
                     [s.replace("in tenancy", "in compartment final-whistle-servers") for s in base],
                     base[1:], [s.replace(" ", "\u2003") for s in base]]
        for rules in mutations:
            q = quota(); q["statements"] = rules
            with self.subTest(rules=rules):
                self.assertFalse(c.verify(q, q, ROOT, limits())["current_root_enforcement_verified"])

    def test_headroom_without_effective_quota_or_wrong_ad_cannot_pass(self):
        for values in ([], None, [{"effective_quota_value": 2}], limits()[:-1]):
            self.assertFalse(c.verify(quota(), quota(), ROOT, values)["current_root_enforcement_verified"])
        for field, value in (("effective_quota_value", None), ("effective_quota_value", 41),
                             ("effective_quota_value", True), ("domain_ref", "other")):
            rows = limits(); rows[0][field] = value
            self.assertFalse(c.verify(quota(), quota(), ROOT, rows)["current_root_enforcement_verified"])

    def test_quota_reads_are_allowlisted_and_do_not_create_or_update(self):
        self.assertEqual(a.OPERATIONS["quotas"], ("quotas", "list_quotas", "list"))
        self.assertEqual(a.OPERATIONS["quota"], ("quotas", "get_quota", "object"))
        reader = a.Reader(lambda *args: (_ for _ in ()).throw(AssertionError("transport")))
        for op in ("create_quota", "update_quota", "add_quota_lock", "delete_quota"):
            with self.assertRaises(a.AuditError): reader.read(op)

    def test_full_audit_observes_quota_control_without_weakening_billing(self):
        env = environment(); backend = Backend(env)
        backend.overrides["quotas"] = a.Page([quota()]); backend.overrides["quota"] = a.Page(quota())
        for name, cap in (("standard-a1-core-count", 2), ("standard-a1-memory-count", 12), ("total-storage-gb", 200)):
            backend.cli.limits[name]["effective_quota_value"] = cap
        report = a.Audit(a.Reader(backend), ROOT, env["OCI_COMPARTMENT_OCID"], NOW).run()
        self.assertTrue(report["allocation_control"]["current_root_enforcement_verified"])
        result = f.assess(report, f.launch_payload(env), env)
        self.assertFalse(result["launch_authorized"])
        self.assertFalse(any("external_allocation" in b for b in result["blockers"]))
        self.assertTrue(any("monthly_meter" in b for b in result["blockers"]))
        self.assertTrue(any("Balanced_VPU" in b for b in result["blockers"]))
        self.assertFalse(backend.cli.launches)

    def test_missing_multiple_or_unreadable_quota_fails_closed(self):
        for value in (a.Page([]), a.Page([quota(), quota()]), a.AuditError("NotAuthorizedOrNotFound")):
            env = environment(); backend = Backend(env); backend.overrides["quotas"] = value
            report = a.Audit(a.Reader(backend), ROOT, env["OCI_COMPARTMENT_OCID"], NOW).run()
            self.assertFalse(report["allocation_control"]["current_root_enforcement_verified"])

    def test_complete_positive_rows_do_not_prove_reporting_gap_or_period(self):
        r = m.assess(billing())
        self.assertEqual(r["status"], "BLOCKED")
        self.assertEqual(r["reported_usage"]["ocpu_hours"]["observed"], 100)
        self.assertIsNone(r["reported_usage"]["ocpu_hours"]["unreported_usage_upper_bound"])
        self.assertEqual(r["reported_usage"]["ocpu_hours"]["calendar_month_max_target_alone"], 1440)

    def test_usage_and_cost_are_not_double_counted(self):
        r = m.assess(billing())
        self.assertEqual(r["query_used"], "USAGE")
        self.assertEqual(r["reported_usage"]["ocpu_hours"]["observed"], 100)
        data = billing(); data["billing"]["api_access"]["USAGE"] = "READ_FAILED"
        self.assertEqual(m.assess(data)["query_used"], "USAGE_ONLY")

    def test_reported_plus_projection_exhaustion_rejects(self):
        for sku in ("B93297", "B93298"):
            data = billing()
            for row in data["billing"]["rows"]:
                if row["sku"] == sku: row["quantity"] = 10000
            self.assertIn("exceeds", m.assess(data)["reason"])

    def test_empty_missing_wrong_units_dates_and_ambiguous_values_never_pass(self):
        for value in (None, -1, True, float("nan"), float("inf")):
            data = billing(); data["billing"]["rows"][0]["quantity"] = value
            self.assertEqual(m.assess(data)["reason"], "monthly_meter_missing_ambiguous_or_unreadable")
        for key, value in (("unit", "UNKNOWN"), ("time_ended", "2026-12-01T00:00:00Z")):
            data = billing(); data["billing"]["rows"][0][key] = value
            self.assertEqual(m.assess(data)["reason"], "monthly_meter_missing_ambiguous_or_unreadable")
        data = billing(); data["billing"]["rows"] = []
        self.assertEqual(m.assess(data)["status"], "BLOCKED")
        self.assertEqual(m.assess({})["status"], "BLOCKED")

    def test_quota_age_cannot_be_used_as_month_long_enforcement_history(self):
        # Quota model exposes creation only, not modification history.
        self.assertFalse(c.verify(quota(), quota(), ROOT, limits())["historical_month_enforcement_verified"])
        self.assertEqual(m.assess(billing())["status"], "BLOCKED")


if __name__ == "__main__": unittest.main()
