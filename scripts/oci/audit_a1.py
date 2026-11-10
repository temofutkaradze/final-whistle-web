"""Read-only OCI evidence collection. NEVER authorizes or invokes provisioning."""
import argparse
import datetime as dt
import hashlib
import json
import math
import os
import re
import sys
import time
from dataclasses import dataclass
from pathlib import Path

REGION = "eu-paris-1"
SHAPE = "VM.Standard.A1.Flex"
SKUS = {"B93297", "B93298", "B91445", "B91961", "B91962"}
# Fixed SDK allowlist: Usage API POST is a read-only query, not a resource write.
OPERATIONS = {
    "regions": ("identity", "list_region_subscriptions", "list"),
    "quotas": ("quotas", "list_quotas", "list"),
    "quota": ("quotas", "get_quota", "object"),
    "subscriptions": ("subscription", "list_subscriptions", "items"),
    "subscription": ("subscription", "get_subscription", "object"),
    "compartments": ("identity", "list_compartments", "list"),
    "domains": ("identity", "list_availability_domains", "list"),
    "instances": ("compute", "list_instances", "list"),
    "compartment": ("identity", "get_compartment", "object"),
    "image": ("compute", "get_image", "object"),
    "shapes": ("compute", "list_shapes", "list"),
    "subnet": ("network", "get_subnet", "object"),
    "vcn": ("network", "get_vcn", "object"),
    "route_table": ("network", "get_route_table", "object"),
    "gateway": ("network", "get_internet_gateway", "object"),
    "security_list": ("network", "get_security_list", "object"),
    "boot_volumes": ("block", "list_boot_volumes", "list"),
    "volumes": ("block", "list_volumes", "list"),
    "boot_attachments": ("compute", "list_boot_volume_attachments", "list"),
    "volume_attachments": ("compute", "list_volume_attachments", "list"),
    "limits": ("limits", "get_resource_availability", "object"),
    "limit_services": ("limits", "list_services", "list"),
    "limit_definitions": ("limits", "list_limit_definitions", "list"),
    "usage": ("usage", "request_summarized_usages", "items"),
}


class AuditError(RuntimeError):
    """Static/sanitized categories only: never provider bodies or credentials."""
    def __init__(self, category, *, http_status=None, service=None, method=None):
        super().__init__(category)
        self.diagnostic = {}
        if type(http_status) is int and 100 <= http_status <= 599:
            self.diagnostic["http_status"] = http_status
        # Only values from our fixed allowlist, never exception URLs or bodies.
        if (service, method) in {(v[0], v[1]) for v in OPERATIONS.values()}:
            self.diagnostic.update(service=service, method=method)


def ref(value):
    return hashlib.sha256(str(value).encode()).hexdigest()[:16]


def numeric(value):
    if type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= 1e15:
        raise AuditError("missing_or_ambiguous_numeric_data")
    return value


@dataclass
class Page:
    data: object
    next_page: str | None = None
    status: int = 200


class Reader:
    """Bounded, explicit pagination; partial reads never become empty success."""
    def __init__(self, fetch, max_calls=2000, max_pages=100, max_items=20000, seconds=360):
        self.fetch = fetch
        self.max_calls, self.max_pages, self.max_items = max_calls, max_pages, max_items
        self.calls = 0
        self.items = 0
        self.deadline = time.monotonic() + seconds

    def read(self, operation, region=REGION, **kwargs):
        if operation not in OPERATIONS:
            raise AuditError("operation_not_read_only_allowlisted")
        kind = OPERATIONS[operation][2]
        items, seen, token = [], set(), None
        for _ in range(self.max_pages):
            if self.calls >= self.max_calls or time.monotonic() >= self.deadline:
                raise AuditError("audit_budget_exhausted")
            self.calls += 1
            args = dict(kwargs)
            if token:
                args["page"] = token
            page = self.fetch(operation, region, args)
            if not isinstance(page, Page) or page.status != 200:
                raise AuditError("invalid_response_status")
            if kind == "object":
                if not isinstance(page.data, dict) or page.next_page:
                    raise AuditError("malformed_object")
                return page.data
            rows = page.data.get("items") if kind == "items" and isinstance(page.data, dict) else page.data
            if not isinstance(rows, list) or not all(isinstance(x, dict) for x in rows):
                raise AuditError("missing_or_malformed_items")
            self.items += len(rows)
            items.extend(rows)
            if self.items > self.max_items:
                raise AuditError("item_budget_exhausted")
            token = page.next_page
            if token is None:
                return items
            if not isinstance(token, str) or not 1 <= len(token) <= 4096 or token in seen:
                raise AuditError("ambiguous_pagination")
            seen.add(token)
        raise AuditError("pagination_budget_exhausted")


class SDKBackend:
    def __init__(self, env):
        import oci  # Already provided by the workflow's pinned oci-cli dependency.
        self.oci = oci
        names = {"user": "OCI_USER_OCID", "tenancy": "OCI_TENANCY_OCID",
                 "fingerprint": "OCI_FINGERPRINT", "key_content": "OCI_PRIVATE_KEY"}
        if not all(isinstance(env.get(n), str) and env[n].strip() for n in names.values()):
            raise AuditError("missing_oci_read_credentials")
        if env.get("OCI_REGION") != REGION:
            raise AuditError("unexpected_configured_region")
        self.config = {k: env[v] for k, v in names.items()}
        self.config["region"] = REGION
        oci.config.validate_config(self.config)
        self.clients = {}

    def __call__(self, operation, region, args):
        if operation not in OPERATIONS or not re.fullmatch(r"[a-z0-9-]{1,60}", region):
            raise AuditError("operation_or_region_not_allowed")
        family, method, _ = OPERATIONS[operation]
        key = (family, region)
        try:
            if key not in self.clients:
                if len(self.clients) >= 200:
                    raise AuditError("client_budget_exhausted")
                classes = {"identity": self.oci.identity.IdentityClient,
                           "compute": self.oci.core.ComputeClient,
                           "network": self.oci.core.VirtualNetworkClient,
                           "block": self.oci.core.BlockstorageClient,
                           "limits": self.oci.limits.LimitsClient,
                           "quotas": self.oci.limits.QuotasClient,
                           "usage": self.oci.usage_api.UsageapiClient,
                           "subscription": self.oci.osp_gateway.SubscriptionServiceClient}
                self.clients[key] = classes[family](dict(self.config, region=region),
                    timeout=(10, 60), retry_strategy=self.oci.retry.NoneRetryStrategy())
            args = dict(args)
            if operation == "usage":
                args["request_summarized_usages_details"] = self.oci.usage_api.models.RequestSummarizedUsagesDetails(
                    **args["request_summarized_usages_details"])
            response = getattr(self.clients[key], method)(**args)
            headers = {k.lower(): v for k, v in response.headers.items()}
            return Page(self.oci.util.to_dict(response.data), headers.get("opc-next-page"), response.status)
        except AuditError:
            raise
        except self.oci.exceptions.ServiceError as error:
            code = error.code if isinstance(error.code, str) and re.fullmatch(r"[A-Za-z0-9_]{1,64}", error.code) else "ServiceError"
            raise AuditError(code, http_status=getattr(error, "status", None),
                             service=family, method=method) from None
        except Exception:
            raise AuditError("sdk_read_failed", service=family, method=method) from None


class Audit:
    def __init__(self, reader, tenancy, target_compartment, now=None):
        self.reader, self.tenancy, self.target = reader, tenancy, target_compartment
        self.now = now or dt.datetime.now(dt.timezone.utc)
        self.resource_ids = set()
        self.report = {"version": 1, "read_only": True, "zero_cost_eligibility": "UNVERIFIED",
            "generated_at": self.now.isoformat(), "compartments": [], "regions": [], "instances": [],
            "volumes": [], "service_limits": [], "billing": {}, "errors": [],
            "missing_evidence": ["complete_metered_consumption_and_reporting_gap_bound",
                "tenancy_visibility_and_concurrent_external_usage_enforcement",
                "shared_container_and_reserved_capacity_accounting",
                "free_boot_capacity_AND_balanced_performance_classification",
                "billing_period_reset_and_post_trial_rate_validity"],
            "risks": ["inventory_is_not_an_atomic_snapshot", "zero_or_absent_cost_is_not_free_entitlement",
                "resource_metadata_does_not_prove_future_billing", "rate_card_is_not_remaining_allowance"]}

    def error(self, operation, scope, category, query=None, diagnostic=None):
        if len(self.report["errors"]) < 500:
            entry = {"operation": operation, "scope_ref": ref(scope), "category": category}
            if query in ("USAGE", "USAGE_ONLY", "COST"):
                entry["query"] = query
            if diagnostic:
                entry["diagnostic"] = diagnostic
            self.report["errors"].append(entry)

    def read(self, operation, region=REGION, **args):
        try:
            return self.reader.read(operation, region, **args)
        except AuditError as error:
            query = args.get("request_summarized_usages_details", {}).get("query_type")
            self.error(operation, [region, args.get("compartment_id")], str(error), query, error.diagnostic)
            return None

    def unique(self, rows, key, operation):
        result, seen = [], set()
        for row in rows or []:
            value = row.get(key)
            if not isinstance(value, str) or not value or value in seen:
                self.error(operation, operation, "missing_or_duplicate_identity")
                continue
            seen.add(value)
            result.append(row)
        return result

    def subscription(self):
        # Subscription data includes payment/address PII. Export only enums, never
        # the source objects or subscription identifiers into reports or logs.
        self.report["subscription"] = {"plan_type": "UNVERIFIED", "verified": False}
        self.report["subscription_diagnostics"] = {"api": "osp_gateway.SubscriptionServiceClient", "api_version": "20191001",
            "request_region": REGION, "osp_home_region": REGION, "scope": "tenancy_root",
            "read_status": "UNVERIFIED", "account_status_inference": "NONE"}
        rows = self.read("subscriptions", osp_home_region=REGION, compartment_id=self.tenancy)
        if rows is None:
            self.report["subscription_diagnostics"]["read_status"] = "LIST_FAILED_PLAN_NOT_OBSERVED"
            return
        self.report["subscription_diagnostics"]["read_status"] = "LIST_SUCCEEDED"
        if len(rows) != 1 or not isinstance(rows[0].get("id"), str) or not rows[0]["id"]:
            self.error("subscriptions", "subscription", "missing_or_ambiguous_subscription")
            return
        summary = rows[0]
        detail = self.read("subscription", subscription_id=summary["id"],
                           osp_home_region=REGION, compartment_id=self.tenancy)
        if detail is None:
            self.report["subscription_diagnostics"]["read_status"] = "DETAIL_FAILED_PLAN_NOT_VERIFIED"
            return
        self.report["subscription_diagnostics"]["read_status"] = "LIST_AND_DETAIL_SUCCEEDED"
        if (detail.get("id") != summary["id"] or summary.get("plan_type") != "FREE_TIER"
                or detail.get("plan_type") != "FREE_TIER"
                or detail.get("time_plan_upgrade") is not None
                or summary.get("time_plan_upgrade") is not None
                or detail.get("upgrade_state") not in (None, "PROMO")
                or summary.get("upgrade_state") not in (None, "PROMO")):
            self.error("subscription", "subscription", "non_free_or_conflicting_subscription")
            return
        self.report["subscription"].update(plan_type="FREE_TIER", verified=True)

    def inventory(self):
        compartments = self.read("compartments", compartment_id=self.tenancy,
                                 compartment_id_in_subtree=True, access_level="ANY")
        ids = [self.tenancy]
        for comp in self.unique(compartments, "id", "compartments"):
            if comp["id"] != self.tenancy:
                ids.append(comp["id"])
        if self.target not in ids:
            self.error("compartments", "target", "target_missing_from_subtree_inventory")
        if len(ids) > 200:
            raise AuditError("compartment_budget_exhausted")
        self.report["compartments"] = [ref(x) for x in ids]
        regions = self.read("regions", tenancy_id=self.tenancy)
        regions = self.unique(regions, "region_name", "regions")
        if not 1 <= len(regions) <= 40:
            raise AuditError("missing_or_excessive_region_inventory")
        self.report["home_region_verified"] = (sum(r.get("is_home_region") is True for r in regions) == 1
            and any(r.get("is_home_region") is True and r["region_name"] == REGION and r.get("status") == "READY" for r in regions))
        if not self.report["home_region_verified"]:
            self.error("regions", REGION, "home_region_not_verified")
        for region in regions:
            name = region["region_name"]
            if region.get("status") != "READY" or not re.fullmatch(r"[a-z0-9-]{1,60}", name):
                self.error("regions", name, "region_not_ready_or_invalid")
                continue
            self.report["regions"].append(name)
            domains = self.read("domains", name, compartment_id=self.tenancy)
            domains = self.unique(domains, "name", "domains")
            if not 1 <= len(domains) <= 10:
                self.error("domains", name, "missing_or_excessive_domains")
                continue
            for compartment in ids:
                self.resources(name, compartment, domains)
            if name == REGION:
                for domain in domains:
                    self.limits(name, domain["name"])

    def resources(self, region, compartment, domains):
        scope = {"region": region, "compartment_ref": ref(compartment)}
        instances = self.read("instances", region, compartment_id=compartment)
        for item in self.unique(instances, "id", "instances"):
            if not isinstance(item.get("shape"), str):
                self.error("instances", item["id"], "missing_shape")
                continue
            if not item["shape"].startswith(("VM.Standard.A1.", "BM.Standard.A1.")):
                continue
            if item["id"] in self.resource_ids:
                self.error("instances", item["id"], "duplicate_or_moving_resource")
                continue
            self.resource_ids.add(item["id"])
            config = item.get("shape_config")
            if not isinstance(config, dict):
                config = {}
            state = item.get("lifecycle_state")
            if state not in ("PROVISIONING", "STARTING", "RUNNING", "STOPPED", "STOPPING", "TERMINATING", "TERMINATED", "MOVING", "CREATING_IMAGE"):
                self.error("instances", item["id"], "missing_or_unknown_state")
                state = "UNKNOWN"
            record = dict(scope, ref=ref(item["id"]), state=state, shape=item["shape"])
            for key in ("ocpus", "memory_in_gbs"):
                try:
                    record[key] = numeric(config.get(key))
                except AuditError:
                    record[key] = None
                    self.error("instances", item["id"], "missing_shape_allocation")
            self.report["instances"].append(record)
        attachments = self.read("volume_attachments", region, compartment_id=compartment)
        volumes = self.read("volumes", region, compartment_id=compartment)
        self.volumes(volumes, attachments, "block", scope)
        for domain in domains:
            args = {"compartment_id": compartment, "availability_domain": domain["name"]}
            attachments = self.read("boot_attachments", region, **args)
            volumes = self.read("boot_volumes", region, **args)
            self.volumes(volumes, attachments, "boot", dict(scope, domain_ref=ref(domain["name"])))

    def volumes(self, volumes, attachments, kind, scope):
        active, attachment_complete = set(), attachments is not None
        for attachment in attachments or []:
            identity = attachment.get("boot_volume_id" if kind == "boot" else "volume_id")
            state = attachment.get("lifecycle_state")
            if not isinstance(identity, str) or state not in ("ATTACHING", "ATTACHED", "DETACHING", "DETACHED"):
                attachment_complete = False
                self.error("attachments", scope, "ambiguous_attachment")
            elif state != "DETACHED":
                active.add(identity)
        for item in self.unique(volumes, "id", kind + "_volumes"):
            if item["id"] in self.resource_ids:
                self.error(kind + "_volumes", item["id"], "duplicate_or_moving_resource")
                continue
            self.resource_ids.add(item["id"])
            state = item.get("lifecycle_state")
            if state not in ("PROVISIONING", "RESTORING", "AVAILABLE", "TERMINATING", "TERMINATED", "FAULTY"):
                self.error(kind + "_volumes", item["id"], "missing_or_unknown_state")
                state = "UNKNOWN"
            record = dict(scope, ref=ref(item["id"]), kind=kind, state=state,
                attachment=("UNKNOWN" if not attachment_complete else "ATTACHED_OR_TRANSITIONING" if item["id"] in active else "UNATTACHED"),
                billing_eligibility="UNVERIFIED")
            for key in ("size_in_gbs", "vpus_per_gb"):
                try:
                    record[key] = numeric(item.get(key))
                except AuditError:
                    record[key] = None
                    self.error(kind + "_volumes", item["id"], "missing_size_or_performance")
            # Even exact 50/10 metadata is not a free-VPU billing classification.
            record["matches_target_size_and_base_vpu"] = record["size_in_gbs"] == 50 and record["vpus_per_gb"] == 10
            tuned = item.get("auto_tuned_vpus_per_gb")
            record["auto_tuned_vpus_per_gb"] = tuned if type(tuned) in (int, float) and math.isfinite(tuned) else None
            self.report["volumes"].append(record)

    def limits(self, region, domain):
        for compartment in dict.fromkeys((self.tenancy, self.target)):
            if not compartment:
                self.error("limits", region, "missing_target_compartment")
                continue
            for service, name in (("compute", "standard-a1-core-count"),
                                  ("compute", "standard-a1-memory-count"),
                                  ("block-storage", "total-storage-gb")):
                value = self.read("limits", region, compartment_id=compartment,
                    service_name=service, limit_name=name, availability_domain=domain)
                if value is None:
                    continue
                try:
                    used, available = numeric(value.get("used")), numeric(value.get("available"))
                    self.report["service_limits"].append({"limit": name, "scope_ref": ref(compartment),
                        "domain_ref": ref(domain), "scope": "root" if compartment == self.tenancy else "target",
                        "used": used, "available": available,
                        "effective_quota_value": value.get("effective_quota_value") if type(value.get("effective_quota_value")) in (int, float) and math.isfinite(value["effective_quota_value"]) and value["effective_quota_value"] >= 0 else None,
                        "billing_entitlement": False})
                except AuditError:
                    self.error("limits", compartment, "ambiguous_limits_data")

    def allocation_controls(self):
        import allocation_controls as controls
        self.report["allocation_control"] = {"current_root_enforcement_verified": False,
            "historical_month_enforcement_verified": False}
        rows = self.read("quotas", compartment_id=self.tenancy)
        if rows is None:
            return
        if len(rows) > 50:
            self.error("quotas", "root", "quota_review_budget_exhausted")
            return
        matches = [q for q in rows if q.get("name") == controls.NAME]
        self.report["allocation_control"]["quota_read_status"] = "LIST_SUCCEEDED"
        self.report["allocation_control"]["expected_name_match_count"] = len(matches)
        if len(matches) != 1:
            self.error("quotas", "root", "required_root_quota_name_missing" if not matches
                       else "required_root_quota_name_ambiguous")
            return
        item = matches[0]
        if not isinstance(item.get("id"), str) or not item["id"].startswith("ocid1.quota."):
            self.error("quotas", "root", "quota_identity_invalid")
            return
        detail = self.read("quota", quota_id=item["id"])
        result = controls.verify(item, detail, self.tenancy, self.report["service_limits"])
        self.report["allocation_control"] = result
        if not result["current_root_enforcement_verified"]:
            self.error("quota", "root", "quota_scope_state_or_statements_not_exact")

    def billing(self):
        start = self.now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        end = self.now.replace(hour=0, minute=0, second=0, microsecond=0)
        self.report["billing"] = {"query_start": start.isoformat(), "query_end": end.isoformat(),
            "window": "calendar_month_to_last_utc_midnight_NOT_verified_subscription_period",
            "reports_are_delayed": True, "remaining_free_allowance": "UNVERIFIED", "api_access": {}, "response_row_counts": {}, "rows": []}
        if start >= end:
            self.error("usage", "billing", "no_completed_daily_interval")
            return
        for query in ("USAGE", "USAGE_ONLY", "COST"):
            details = dict(tenant_id=self.tenancy, time_usage_started=start, time_usage_ended=end,
                granularity="DAILY", query_type=query, group_by=["skuPartNumber", "unit", "region"])
            rows = self.read("usage", request_summarized_usages_details=details)
            self.report["billing"]["api_access"][query] = "READ_SUCCEEDED" if rows is not None else "READ_FAILED"
            if rows is None:
                continue
            self.report["billing"]["response_row_counts"][query] = len(rows)
            if not rows:
                self.error("usage", query, "no_billing_rows_NOT_zero_usage", query=query)
            matched = False
            for row in rows:
                sku = row.get("sku_part_number")
                if not isinstance(sku, str):
                    self.error("usage", query, "missing_sku")
                    continue
                if sku not in SKUS:
                    continue
                matched = True
                try:
                    unit = row.get("unit")
                    if not isinstance(unit, str) or not re.fullmatch(r"[A-Za-z0-9 _/().-]{1,80}", unit) or row.get("is_forecast") is True:
                        raise AuditError("ambiguous_billing_row")
                    first = dt.datetime.fromisoformat(row.get("time_usage_started", "").replace("Z", "+00:00"))
                    last = dt.datetime.fromisoformat(row.get("time_usage_ended", "").replace("Z", "+00:00"))
                    if not (first.tzinfo and last.tzinfo and start <= first < last <= end):
                        raise AuditError("ambiguous_billing_interval")
                    entry = {"query": query, "sku": sku, "unit": unit,
                             "quantity": numeric(row.get("computed_quantity")),
                             "time_started": first.isoformat(), "time_ended": last.isoformat()}
                    if query == "COST":
                        currency = row.get("currency")
                        if not isinstance(currency, str) or not re.fullmatch(r"[A-Z]{3}", currency):
                            raise AuditError("missing_billing_currency")
                        entry.update(amount=numeric(row.get("computed_amount")), currency=currency)
                    self.report["billing"]["rows"].append(entry)
                except (AuditError, TypeError, ValueError, AttributeError):
                    self.error("usage", query, "ambiguous_billing_row")
            if not matched and rows:
                self.error("usage", query, "target_skus_absent_NOT_zero_usage", query=query)

    def run(self):
        self.subscription()
        before_inventory_errors = len(self.report["errors"])
        try:
            self.inventory()
        except AuditError as error:
            self.error("inventory", "inventory", str(error))
        inventory_errors = len(self.report["errors"]) - before_inventory_errors
        self.report["inventory_read_status"] = "PARTIAL" if inventory_errors else "ENUMERATED_SCOPES_READ"
        self.report["tenancy_wide_visibility_proven"] = False
        self.billing()
        self.allocation_controls()
        totals = {}
        for row in self.report["billing"]["rows"]:
            key = (row["query"], row["sku"], row["unit"], row.get("currency"))
            total = totals.setdefault(key, dict(query=key[0], sku=key[1], unit=key[2], currency=key[3], quantity=0, amount=0 if key[0] == "COST" else None))
            total["quantity"] += row["quantity"]
            if row["query"] == "COST":
                total["amount"] += row["amount"]
        self.report["billing"]["observed_totals_by_exact_unit_and_currency"] = list(totals.values())
        instances = [x for x in self.report["instances"] if x["state"] != "TERMINATED"]
        volumes = [x for x in self.report["volumes"] if x["state"] != "TERMINATED" and x["region"] == REGION]
        self.report["observed_footprint_NOT_billing_usage"] = {
            "nonterminated_a1_count": len(instances),
            "known_allocated_ocpus": sum(x["ocpus"] or 0 for x in instances),
            "known_allocated_memory_gbs": sum(x["memory_in_gbs"] or 0 for x in instances),
            "unknown_a1_allocation_count": sum(x["ocpus"] is None or x["memory_in_gbs"] is None for x in instances),
            "home_region_known_boot_and_block_gbs": sum(x["size_in_gbs"] or 0 for x in volumes),
            "unknown_home_region_volume_size_count": sum(x["size_in_gbs"] is None for x in volumes),
            "home_region_unattached_volume_count": sum(x["attachment"] == "UNATTACHED" for x in volumes),
            "coverage": "only_successfully_read_resources_not_proven_complete_tenancy"}
        self.report["read_calls"] = self.reader.calls
        return self.report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute", action="store_true", help="Permit read-only OCI API queries")
    parser.add_argument("--output", type=Path, help="New local JSON file; never overwrite")
    args = parser.parse_args()
    try:
        if not args.execute:
            raise AuditError("explicit_read_only_execution_required")
        env = dict(os.environ)
        backend = SDKBackend(env)
        report = Audit(Reader(backend), env["OCI_TENANCY_OCID"], env.get("OCI_COMPARTMENT_OCID")).run()
        text = json.dumps(report, indent=2, allow_nan=False)
        if args.output:
            with args.output.open("x", encoding="utf-8") as out:
                out.write(text + "\n")
        print(text)
        # Successful collection never means eligibility PASS. Partial reads fail CI.
        return 2 if report["errors"] else 0
    except AuditError as error:
        print("Read-only audit failed: " + str(error), file=sys.stderr)
        return 2
    except Exception:
        print("Read-only audit failed; credentials and provider details withheld", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
