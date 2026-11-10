"""Conservative A1 monthly observations. Missing metering evidence never passes."""
import calendar
import datetime as dt
import math

METERS = {"B93297": ("ocpu_hours", {"OCPU_HOURS", "OCPU HOURS"}, 2, 1500),
          "B93298": ("memory_gb_hours", {"GB_HOURS", "GB HOURS"}, 12, 9000)}


def timestamp(value):
    if not isinstance(value, str): raise ValueError("missing_date")
    value = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    if value.utcoffset() != dt.timedelta(0): raise ValueError("UTC_date_required")
    return value


def assess(report):
    result = {"status": "BLOCKED", "reported_usage": {}, "reason":
        "subscription_period_rate_validity_and_unreported_usage_bound_unproven"}
    try:
        now = timestamp(report["generated_at"])
        billing = report["billing"]
        start, end = timestamp(billing["query_start"]), timestamp(billing["query_end"])
        month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        if start != month_start or not start <= end <= now: raise ValueError("period")
        next_month = (month_start + dt.timedelta(days=32)).replace(day=1)
        future_hours = (next_month-now).total_seconds()/3600
        selected = next((q for q in ("USAGE", "USAGE_ONLY")
                         if billing.get("api_access", {}).get(q) == "READ_SUCCEEDED"), None)
        if selected is None: raise ValueError("access")
        rows = [x for x in billing["rows"] if x.get("query") == selected and x.get("sku") in METERS]
        for sku, (name, units, rate, cap) in METERS.items():
            meter = [r for r in rows if r.get("sku") == sku]
            if not meter: raise ValueError("empty_is_not_zero")
            used = 0
            for row in meter:
                quantity = row.get("quantity")
                first, last = timestamp(row.get("time_started")), timestamp(row.get("time_ended"))
                if (row.get("unit") not in units or type(quantity) not in (int, float)
                    or not math.isfinite(quantity) or quantity < 0 or not start <= first < last <= end):
                    raise ValueError("ambiguous_meter")
                used += quantity
            if not math.isfinite(used): raise ValueError("non_finite_total")
            # Sum all rows of ONE query type. Never add COST to usage or combine
            # USAGE + USAGE_ONLY (the same consumption reported twice).
            result["reported_usage"][name] = {"observed": used,
                "target_until_calendar_month_end": rate*future_hours,
                "unreported_usage_upper_bound": None, "conservative_monthly_cap": cap,
                "calendar_month_max_target_alone": rate*calendar.monthrange(now.year,now.month)[1]*24}
            if not math.isfinite(used) or used + rate*future_hours > cap:
                result["reason"] = "reported_plus_projected_calendar_month_usage_exceeds_conservative_cap"
                return result
        other_query = "USAGE_ONLY" if selected == "USAGE" else "USAGE"
        if billing.get("api_access", {}).get(other_query) == "READ_SUCCEEDED":
            other = [r for r in billing["rows"] if r.get("query") == other_query and r.get("sku") in METERS]
            # Compare like-for-like intervals/units, never sum both query types.
            # Distinct aggregation or delayed snapshots need review, not a guess.
            def signature(values):
                return sorted((r.get("sku"), r.get("unit"), r.get("time_started"),
                               r.get("time_ended"), r.get("quantity")) for r in values)
            if signature(rows) != signature(other):
                result["reason"] = "conflicting_or_incomparable_usage_query_results"
                return result
        # Positive rows and current quotas do not establish period reset, missing
        # historical resources or lag. Quota API has no modification history;
        # time_created cannot prove the present cap applied since month start.
        result["query_used"] = selected
    except (KeyError, TypeError, ValueError, OverflowError):
        result["reason"] = "monthly_meter_missing_ambiguous_or_unreadable"
    return result
