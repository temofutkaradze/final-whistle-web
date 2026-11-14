"""Evidence checks, not a prospective Oracle pricing oracle. No resource writes."""
import math
import monthly_entitlement

REGION = "eu-paris-1"
SHAPE = "VM.Standard.A1.Flex"
# Conservative current Free Tier-specific documentation, not service limits.
MAX_OCPUS, MAX_MEMORY_GB, MAX_STORAGE_GB = 2, 12, 200


def launch_payload(env):
    return {
        "availabilityDomain": "hsNq:EU-PARIS-1-AD-1",
        "compartmentId": env["OCI_COMPARTMENT_OCID"], "displayName": "final-whistle-a1",
        "shape": SHAPE, "shapeConfig": {"ocpus": 2, "memoryInGBs": 12},
        "subnetId": env["OCI_SUBNET_OCID"], "assignPublicIp": True,
        "sourceDetails": {"sourceType": "image", "imageId": env["OCI_IMAGE_OCID"],
                          "bootVolumeSizeInGBs": 50, "bootVolumeVpusPerGB": 10},
        "metadata": {"ssh_authorized_keys": env["OCI_SSH_PUBLIC_KEY"].strip()},
        "freeformTags": {"application": "final-whistle", "managed-by": "github-oracle-a1"},
    }


def finite(value):
    return type(value) in (int, float) and math.isfinite(value) and value >= 0


def account_context(report, trial_status="ACTIVE", payg_upgraded=False):
    """Owner context is labelled separately; it never authorizes a launch.

    FREE_TIER is an API plan, not proof that promotional credits have expired.
    An OSP failure establishes neither PAYG nor Always Free-only status.
    """
    subscription = report.get("subscription", {})
    verified = subscription == {"plan_type": "FREE_TIER", "verified": True}
    conflicting = (subscription.get("plan_type") not in (None, "UNVERIFIED", "FREE_TIER")
        or any(e.get("category") == "non_free_or_conflicting_subscription"
               for e in report.get("errors", [])))
    return {"owner_declared_trial": trial_status if trial_status in ("ACTIVE", "EXPIRED") else "UNVERIFIED",
            "owner_declared_payg_upgraded": payg_upgraded if type(payg_upgraded) is bool else None,
            "owner_confirmation_date": "2026-11-10",
            "api_plan": "CONFLICTING_OR_PAID" if conflicting else "FREE_TIER" if verified else "UNVERIFIED",
            "api_trial_phase": "UNVERIFIED", "always_free_only_verified": False,
            "published_Always_Free_resources_available_during_trial": True,
            "owner_context_is_not_billing_evidence": True}


def published_configuration(report, payload, env):
    """Configuration support, NOT remaining entitlement or launch permission."""
    import json
    exact = json.dumps(payload, sort_keys=True) == json.dumps(launch_payload(env), sort_keys=True)
    supported = exact and env.get("OCI_REGION") == REGION and report.get("home_region_verified") is True
    return {"status": "SUPPORTED_CONFIGURATION" if supported else "UNVERIFIED",
            "account_types_with_published_allowance": ["ACTIVE_FREE_TRIAL", "ALWAYS_FREE_ONLY", "PAID"],
            "project_policy_allows_paid_account": False,
            "target_31_day_ocpu_hours": 1488, "published_monthly_ocpu_hours": 1500,
            "target_31_day_memory_gb_hours": 8928, "published_monthly_memory_gb_hours": 9000,
            "home_region_combined_boot_block_capacity_gb": 200,
            "Balanced_is_documented_Free_Tier_default": True,
            "remaining_tenancy_allowance_verified": False,
            "image_and_network_require_shared_target_preflight": True,
            "launch_authorized_by_this_configuration_check": False}


def assess(report, payload, env):
    """Return bounded, non-sensitive reasons. Never infer eligibility from absence.

    No caller-supplied flag can certify prospective performance pricing, metering
    lag or complete IAM visibility. Those unresolved requirements stay closed
    until an independently reviewed authoritative verifier is implemented.
    """
    blockers = []
    if env.get("OCI_REGION") != REGION or report.get("home_region_verified") is not True:
        blockers.append("Paris_home_region_not_verified")
    # JSON representation prevents Python bool==1 equivalence and extra options.
    import json
    if json.dumps(payload, sort_keys=True) != json.dumps(launch_payload(env), sort_keys=True):
        blockers.append("launch_payload_not_exact_2_12_50_10")
    if report.get("subscription") != {"plan_type": "FREE_TIER", "verified": True}:
        blockers.append("FREE_TIER_subscription_not_verified")
    if report.get("inventory_read_status") != "ENUMERATED_SCOPES_READ":
        blockers.append("inventory_incomplete_or_ambiguous")
    footprint = report.get("observed_footprint_NOT_billing_usage", {})
    for key, amount, cap, category in (
        ("known_allocated_ocpus", 2, MAX_OCPUS, "A1_OCPU_allocation"),
        ("known_allocated_memory_gbs", 12, MAX_MEMORY_GB, "A1_memory_allocation"),
        ("home_region_known_boot_and_block_gbs", 50, MAX_STORAGE_GB, "storage_allocation"),
    ):
        used = footprint.get(key)
        if not finite(used) or used + amount > cap:
            blockers.append(category + "_exceeded_or_unknown")
    if (footprint.get("unknown_a1_allocation_count") != 0 or
            footprint.get("unknown_home_region_volume_size_count") != 0):
        blockers.append("unknown_resource_sizes")
    limits = report.get("service_limits", [])
    for scope in ("root", "target"):
        for name, amount in (("standard-a1-core-count", 2),
                             ("standard-a1-memory-count", 12), ("total-storage-gb", 50)):
            rows = [x for x in limits if x.get("scope") == scope and x.get("limit") == name]
            if not rows or any(not finite(x.get("used")) or not finite(x.get("available"))
                               or x["available"] < amount for x in rows):
                blockers.append(scope + "_" + name + "_quota_unverified")
    # Verified FREE_TIER is account-plan evidence, not a remaining monthly meter
    # or a free capacity+VPU tariff. Do not downgrade these to warning/override.
    if account_context(report)["api_plan"] == "CONFLICTING_OR_PAID":
        blockers.append("conflicting_subscription_evidence_requires_review")
    control = report.get("allocation_control", {})
    # Only the allowlisted root List/GetQuota path produces this evidence; no
    # environment flag or observed free headroom may substitute for the policy.
    if control.get("current_root_enforcement_verified") is not True:
        blockers.append("complete_tenancy_visibility_and_external_allocation_enforcement_unproven")
    monthly = monthly_entitlement.assess(report)
    if monthly["status"] != "PASS":
        blockers.append("monthly_meter_reporting_gap_and_rate_validity_unproven")
    # Published Free Tier includes the default 50 GB boot volume and documents
    # Balanced storage. This remaining guard is about tenancy-specific free
    # allocation/performance treatment, not a claim that Balanced is always paid.
    blockers.append("prospective_boot_capacity_AND_Balanced_VPU_free_treatment_unproven")
    if any(row.get("query") == "COST" and finite(row.get("amount")) and row["amount"] > 0
           for row in report.get("billing", {}).get("rows", [])):
        blockers.append("observed_positive_target_SKU_cost_requires_review")
    return {"launch_authorized": not blockers, "blockers": blockers,
            "monthly_entitlement": monthly, "account_context": account_context(report),
            "published_configuration": published_configuration(report, payload, env)}


def collect(env):
    # SDK uses the existing CLI dependency; bounded read-only allowlist, no retry,
    # TLS verification stays enabled. No subscription/payment objects are logged.
    from audit_a1 import Audit, Reader, SDKBackend
    return Audit(Reader(SDKBackend(env)), env["OCI_TENANCY_OCID"],
                 env["OCI_COMPARTMENT_OCID"]).run()
