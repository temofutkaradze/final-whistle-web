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
    control = report.get("allocation_control", {})
    # Only the allowlisted root List/GetQuota path produces this evidence; no
    # environment flag or observed free headroom may substitute for the policy.
    if control.get("current_root_enforcement_verified") is not True:
        blockers.append("complete_tenancy_visibility_and_external_allocation_enforcement_unproven")
    monthly = monthly_entitlement.assess(report)
    if monthly["status"] != "PASS":
        blockers.append("monthly_meter_reporting_gap_and_rate_validity_unproven")
    # No supported prospective capacity AND VPU tariff verifier is available.
    blockers.append("prospective_boot_capacity_AND_Balanced_VPU_free_treatment_unproven")
    return {"launch_authorized": not blockers, "blockers": blockers,
            "monthly_entitlement": monthly}


def collect(env):
    # SDK uses the existing CLI dependency; bounded read-only allowlist, no retry,
    # TLS verification stays enabled. No subscription/payment objects are logged.
    from audit_a1 import Audit, Reader, SDKBackend
    return Audit(Reader(SDKBackend(env)), env["OCI_TENANCY_OCID"],
                 env["OCI_COMPARTMENT_OCID"]).run()
