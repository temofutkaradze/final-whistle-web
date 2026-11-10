"""Read-only activation audit: no CLI, LaunchInstance, or Issue write path."""
import argparse
import json
import os
from pathlib import Path

import audit_a1 as a
import free_tier_safety as f
import provision_a1 as p

# Exact read-only CLI-shaped calls needed by the shared target validator.
READS = {
    ("iam", "region-subscription", "list"): ("regions", {"--tenancy-id": "tenancy_id"}),
    ("iam", "availability-domain", "list"): ("domains", {"--compartment-id": "compartment_id"}),
    ("iam", "compartment", "get"): ("compartment", {"--compartment-id": "compartment_id"}),
    ("network", "subnet", "get"): ("subnet", {"--subnet-id": "subnet_id"}),
    ("network", "vcn", "get"): ("vcn", {"--vcn-id": "vcn_id"}),
    ("network", "route-table", "get"): ("route_table", {"--rt-id": "rt_id"}),
    ("network", "internet-gateway", "get"): ("gateway", {"--ig-id": "ig_id"}),
    ("network", "security-list", "get"): ("security_list", {"--security-list-id": "security_list_id"}),
    ("compute", "image", "get"): ("image", {"--image-id": "image_id"}),
    ("compute", "shape", "list"): ("shapes", {"--compartment-id": "compartment_id",
        "--availability-domain": "availability_domain", "--image-id": "image_id"}),
    ("compute", "instance", "list"): ("instances", {"--compartment-id": "compartment_id"}),
    ("limits", "resource-availability", "get"): ("limits", {"--compartment-id": "compartment_id",
        "--service-name": "service_name", "--limit-name": "limit_name", "--availability-domain": "availability_domain"}),
    ("limits", "service", "list"): ("limit_services", {"--compartment-id": "compartment_id"}),
    ("limits", "limit-definition", "list"): ("limit_definitions", {"--compartment-id": "compartment_id", "--service-name": "service_name"}),
}


def cli_keys(value):
    # Shared verifier consumes OCI CLI's kebab-case representation. Resource IDs,
    # names, tags and bodies stay in memory, never in the exported checklist.
    if isinstance(value, list):
        return [cli_keys(x) for x in value]
    if isinstance(value, dict):
        return {k.replace("_", "-"): cli_keys(v) for k, v in value.items()}
    return value


class ReadOnlyCLI:
    def __init__(self, reader):
        self.reader = reader

    def call(self, *args):
        if args[:3] not in READS:
            raise a.AuditError("operation_not_read_only_allowlisted")
        op, options = READS[args[:3]]
        values, i = {}, 3
        while i < len(args):
            if args[i] == "--all" and args[2] == "list":
                i += 1
                continue
            if args[i] not in options or i + 1 >= len(args) or options[args[i]] in values:
                raise a.AuditError("unsupported_read_parameters")
            values[options[args[i]]] = args[i + 1]
            i += 2
        if set(values) != set(options.values()):
            raise a.AuditError("incomplete_read_parameters")
        return cli_keys(self.reader.read(op, **values))

    def launch(self, *args):
        raise a.AuditError("launch_forbidden_in_read_only_audit")


class IssueReader:
    def __init__(self, env):
        self.state = p.GitHubState(env)
        def get_only(method, path, body=None):
            if method != "GET" or path != self.state.path or body is not None:
                raise a.AuditError("issue_write_or_other_endpoint_forbidden")
            return self.state.http(method, path)
        self.state.request = get_only

    def read(self):
        return self.state.read()


def run(reader, env, issue_reader):
    report = a.Audit(reader, env["OCI_TENANCY_OCID"], env["OCI_COMPARTMENT_OCID"]).run()
    checks = {}
    def check(name, passed, reason):
        checks[name] = {"status": "PASS" if passed else "BLOCKED", "reason": reason}
    report["activation_checks"] = checks
    for name in ("configuration", "home_region", "compartment", "network", "image", "shape", "quotas"):
        check(name, False, "required_target_read_not_yet_verified")
    def checked(name):
        check(name, True, "shared_provisioner_target_checks_passed")
    cli = ReadOnlyCLI(reader)
    try:
        p.validate_environment(env)
        checked("configuration")
        p.verify_target(cli, env, checked)
    except Exception:
        # Never print arbitrary SDK/validation exception bodies.
        report["target_preflight"] = "BLOCKED_read_or_validation_failed"
    else:
        report["target_preflight"] = "PASS"
    check("subscription", report.get("subscription") == {"plan_type": "FREE_TIER", "verified": True},
          "requires_consistent_FREE_TIER_list_and_detail_without_upgrade")
    check("inventory_reads", report.get("inventory_read_status") == "ENUMERATED_SCOPES_READ",
          "all_enumerated_compartments_regions_and_retained_volumes_must_be_read")
    try:
        decision = f.assess(report, f.launch_payload(env), env)
    except Exception:
        decision = {"launch_authorized": False, "blockers": ["safety_assessment_unavailable"]}
    report["launch_assessment"] = decision
    check("exact_launch_payload", checks["configuration"]["status"] == "PASS" and
          "launch_payload_not_exact_2_12_50_10" not in decision["blockers"] and
          "safety_assessment_unavailable" not in decision["blockers"],
          "fixed_Paris_A1_2_OCPU_12_GB_50_GB_10_VPU_no_extra_launch_options")
    for name, prefix in (("a1_allocation", "A1_"), ("storage_allocation", "storage_allocation")):
        check(name, checks["inventory_reads"]["status"] == "PASS" and
              not any(x.startswith(prefix) or x == "unknown_resource_sizes" for x in decision["blockers"]),
              "observed_allocations_plus_fixed_target_within_2_12_200_not_a_billing_proof")
    for query in ("USAGE", "USAGE_ONLY", "COST"):
        check("api_" + query, report["billing"]["api_access"].get(query) == "READ_SUCCEEDED",
              "read_access_only_empty_rows_do_not_prove_unused_entitlement")
    monthly = decision.get("monthly_entitlement", {"status": "BLOCKED", "reason": "monthly_assessment_unavailable"})
    check("monthly_entitlement", monthly["status"] == "PASS", monthly["reason"])
    check("balanced_vpu_pricing", False, "prospective_capacity_AND_10_VPU_free_treatment_unproven")
    check("external_allocation_enforcement", report.get("allocation_control", {}).get("current_root_enforcement_verified") is True,
          "requires_exact_ACTIVE_tenancy_root_quota_not_a_compartment_or_headroom_assumption")
    try:
        existing = p.matching_instance(cli.call("compute", "instance", "list",
            "--compartment-id", env["OCI_COMPARTMENT_OCID"], "--all"))
        state = issue_reader.read()
        check("duplicate_state", existing is None and state["status"] in ("ready", "capacity_rejected")
              and state["target"] in (None, p.target_identity(env)), "existing_VM_or_pending_created_or_changed_target_blocks_new_launch")
        report["safety_issue"] = {"status": state["status"], "revision": state["revision"],
                                  "matching_instance_present": existing is not None}
    except Exception:
        check("duplicate_state", False, "instance_or_safety_issue_read_unverified")
    report["activation_ready"] = decision["launch_authorized"] and all(
        value["status"] == "PASS" for value in checks.values())
    report["read_calls"] = reader.calls
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute", action="store_true", help="Read-only API calls only")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        if not args.execute:
            raise a.AuditError("explicit_read_only_execution_required")
        env = dict(os.environ)
        report = run(a.Reader(a.SDKBackend(env)), env, IssueReader(env))
        with args.output.open("x", encoding="utf-8") as out:
            out.write(json.dumps(report, indent=2, allow_nan=False) + "\n")
        lines = ["### Oracle A1 read-only activation audit", "| Requirement | Result |", "|---|---|"]
        for name, value in report["activation_checks"].items():
            print(name + ": " + value["status"] + " ? " + value["reason"])
            lines.append("| " + name + " | " + value["status"] + " |")
        print("ACTIVATION BLOCKED; no launch or Issue write performed")
        summary = env.get("GITHUB_STEP_SUMMARY")
        if summary:
            with open(summary, "a", encoding="utf-8") as out:
                out.write("\n".join(lines) + "\n\nActivation BLOCKED; read-only audit.\n")
        # A completed audit can be green while eligibility is BLOCKED. Actual read
        # failures fail the step; unresolved pricing is a reported safety decision.
        return 2 if report["errors"] or report["target_preflight"] != "PASS" or "safety_issue" not in report else 0
    except Exception:
        print("Read-only activation audit failed; sensitive details withheld")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
