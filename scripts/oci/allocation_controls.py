"""Conservative root-quota recognizer. Never writes quotas or IAM policies."""
import hashlib
import re
import math

REGION = "eu-paris-1"
AD = "hsNq:EU-PARIS-1-AD-1"
NAME = "final-whistle-free-tier-envelope"


def statements():
    # One policy: deny by default across regions/ADs, then permit only Paris AD1.
    # Shared A1 counters cover VM/BM/Container Instances; wildcard zero also
    # excludes A1 reservation quota names. Root caps include all descendants.
    where = " where request.region = '" + REGION + "' and request.ad = '" + AD + "'"
    return [
        "zero compute-core quotas /standard-a1-*/ in tenancy",
        "set compute-core quota standard-a1-core-count to 2 in tenancy" + where,
        "zero compute-memory quotas /standard-a1-*/ in tenancy",
        "set compute-memory quota standard-a1-memory-count to 12 in tenancy" + where,
        "zero block-storage quota total-storage-gb in tenancy",
        "set block-storage quota total-storage-gb to 200 in tenancy" + where,
    ]


def canonical(value):
    # Deliberately NOT a general quota parser. Exact documented syntax only;
    # extra/unset statements, reordered overrides and unknown constructs reject.
    if not isinstance(value, str) or not value.isascii() or len(value) > 500 or any(c in value for c in "\r\n\0"):
        return None
    return re.sub(r"\s+", " ", value.strip())


def verify(summary, detail, tenancy, limits):
    expected = statements()
    valid = (isinstance(summary, dict) and isinstance(detail, dict)
        and isinstance(summary.get("id"), str) and summary["id"].startswith("ocid1.quota.")
        and summary.get("id") == detail.get("id")
        and summary.get("name") == detail.get("name") == NAME
        and summary.get("compartment_id") == detail.get("compartment_id") == tenancy
        and summary.get("lifecycle_state") == detail.get("lifecycle_state") == "ACTIVE"
        and isinstance(detail.get("statements"), list)
        and [canonical(s) for s in detail["statements"]] == expected)
    domain_ref = hashlib.sha256(AD.encode()).hexdigest()[:16]
    for scope in ("root", "target"):
        for name, cap in (("standard-a1-core-count", 2), ("standard-a1-memory-count", 12), ("total-storage-gb", 200)):
            rows = [r for r in (limits if isinstance(limits, list) else []) if r.get("scope") == scope and r.get("domain_ref") == domain_ref and r.get("limit") == name]
            effective = rows[0].get("effective_quota_value") if len(rows) == 1 else None
            valid = valid and type(effective) in (int, float) and math.isfinite(effective) and 0 <= effective <= cap
    return {"current_root_enforcement_verified": bool(valid),
            "scope": "tenancy_all_descendants_all_regions_denied_except_Paris_AD1",
            "ocpu_ceiling": 2, "memory_gb_ceiling": 12, "storage_gb_ceiling": 200,
            "statement_sha256": hashlib.sha256("\n".join(expected).encode()).hexdigest(),
            # OCI Quota has time_created but NO time_updated/history proof.
            "historical_month_enforcement_verified": False,
            "trusted_admin_must_not_remove_or_relax_control": True}
