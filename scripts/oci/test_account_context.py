"""Account phase/configuration support never replace billing or launch proofs."""
import copy
import unittest
from unittest.mock import patch
import audit_a1 as a
import free_tier_safety as f
import monthly_entitlement as m
import provision_a1 as p
from test_evidence_controls import billing
from test_provision_a1 import environment, FakeCLI, MemoryState


def report():
    data = billing()
    data.update(home_region_verified=True, subscription={"plan_type":"FREE_TIER","verified":True},
        inventory_read_status="ENUMERATED_SCOPES_READ", errors=[],
        observed_footprint_NOT_billing_usage={"known_allocated_ocpus":0,"known_allocated_memory_gbs":0,
            "home_region_known_boot_and_block_gbs":0,"unknown_a1_allocation_count":0,
            "unknown_home_region_volume_size_count":0},
        service_limits=[{"scope":s,"limit":name,"used":0,"available":value}
            for s in ("root","target") for name,value in (("standard-a1-core-count",41),
                ("standard-a1-memory-count",277),("total-storage-gb",30720))])
    return data


class AccountContextTests(unittest.TestCase):
    def setUp(self):
        self.env=environment()
        self.http=patch("urllib.request.OpenerDirector.open",side_effect=AssertionError("HTTP forbidden"))
        self.process=patch("subprocess.run",side_effect=AssertionError("CLI forbidden"))
        self.http.start();self.process.start()
        self.addCleanup(self.http.stop);self.addCleanup(self.process.stop)

    def assess(self,data):return f.assess(data,f.launch_payload(self.env),self.env)

    def test_owner_confirmed_active_trial_is_not_labelled_expired_or_paid(self):
        data=report();data["subscription"]={"plan_type":"UNVERIFIED","verified":False}
        data["errors"]=[{"category":"NotAuthorizedOrNotFound"}]
        context=f.account_context(data)
        self.assertEqual(context["owner_declared_trial"],"ACTIVE")
        self.assertEqual(context["api_plan"],"UNVERIFIED")
        self.assertEqual(context["api_trial_phase"],"UNVERIFIED")
        self.assertFalse(context["always_free_only_verified"])
        self.assertTrue(context["published_Always_Free_resources_available_during_trial"])
        result=self.assess(data)
        self.assertEqual(result["published_configuration"]["status"],"SUPPORTED_CONFIGURATION")
        self.assertFalse(result["launch_authorized"])
        self.assertIn("FREE_TIER_subscription_not_verified",result["blockers"])

    def test_api_free_tier_accepts_promo_but_does_not_prove_trial_expiry(self):
        from test_audit_a1 import Fake,NOW,ROOT,CHILD
        fake=Fake()
        fake.override["subscription"]=a.Page({"id":"subscription-test","plan_type":"FREE_TIER","upgrade_state":"PROMO"})
        data=a.Audit(a.Reader(fake),ROOT,CHILD,NOW).run()
        self.assertTrue(data["subscription"]["verified"])
        self.assertEqual(f.account_context(data)["api_plan"],"FREE_TIER")
        self.assertFalse(f.account_context(data)["always_free_only_verified"])
        self.assertFalse(self.assess(data)["launch_authorized"])

    def test_expired_trial_context_is_distinct_from_api_phase_evidence(self):
        context=f.account_context(report(),trial_status="EXPIRED")
        self.assertEqual(context["owner_declared_trial"],"EXPIRED")
        self.assertEqual(context["api_trial_phase"],"UNVERIFIED")
        self.assertFalse(context["always_free_only_verified"])
        self.assertFalse(self.assess(report())["launch_authorized"])

    def test_paid_and_conflicting_plan_evidence_cannot_be_overridden_by_owner_context(self):
        for plan in ("PAYG","UNKNOWN_ENUM_VALUE"):
            data=report();data["subscription"]={"plan_type":plan,"verified":True}
            self.assertEqual(f.account_context(data)["api_plan"],"CONFLICTING_OR_PAID")
            self.assertIn("FREE_TIER_subscription_not_verified",self.assess(data)["blockers"])
        data=report();data["errors"]=[{"category":"non_free_or_conflicting_subscription"}]
        self.assertEqual(f.account_context(data)["api_plan"],"CONFLICTING_OR_PAID")
        self.assertIn("conflicting_subscription_evidence_requires_review",self.assess(data)["blockers"])

    def test_empty_usage_never_becomes_zero_and_owner_flags_never_open_the_gate(self):
        data=report();data["billing"]["rows"]=[]
        data.update(owner_confirmed=True,owner_declared_trial="ACTIVE",zero_cost_eligibility="VERIFIED")
        result=self.assess(data)
        self.assertEqual(result["monthly_entitlement"]["reported_usage"],{})
        self.assertEqual(result["monthly_entitlement"]["status"],"BLOCKED")
        self.assertFalse(result["launch_authorized"])
        for needle in ("external_allocation","monthly_meter","Balanced_VPU"):
            self.assertTrue(any(needle in b for b in result["blockers"]))

    def test_exceeded_and_unknown_allocations_stay_blocked_during_trial(self):
        for key,value in (("known_allocated_ocpus",1),("known_allocated_memory_gbs",1),
                ("home_region_known_boot_and_block_gbs",151),("unknown_a1_allocation_count",1)):
            data=report();data["observed_footprint_NOT_billing_usage"][key]=value
            self.assertFalse(self.assess(data)["launch_authorized"])
        data=report();data["inventory_read_status"]="PARTIAL"
        self.assertIn("inventory_incomplete_or_ambiguous",self.assess(data)["blockers"])

    def test_positive_target_sku_cost_is_an_explicit_conflict_not_a_free_trial_override(self):
        data=report()
        data["billing"]["rows"].append({"query":"COST","sku":"B93297","amount":0.01})
        self.assertIn("observed_positive_target_SKU_cost_requires_review",self.assess(data)["blockers"])

    def test_disagreeing_usage_queries_need_review_instead_of_choosing_the_lower_one(self):
        data=billing()
        next(r for r in data["billing"]["rows"] if r["query"]=="USAGE_ONLY")["quantity"]=200
        self.assertEqual(m.assess(data)["reason"],"conflicting_or_incomparable_usage_query_results")
        self.assertEqual(m.assess(data)["status"],"BLOCKED")

    def test_supported_target_does_not_make_pending_launch_safe_to_retry(self):
        store=MemoryState();before=store.read();pending=p.begin_attempt(store,before,self.env)
        previous=copy.deepcopy(store.read());cli=FakeCLI(self.env)
        self.assertEqual(f.published_configuration(report(),f.launch_payload(self.env),self.env)["status"],"SUPPORTED_CONFIGURATION")
        with self.assertRaises(p.Unsafe):p.provision(cli,self.env,store)
        self.assertFalse(cli.launches);self.assertEqual(store.read(),previous)
        self.assertEqual(store.value["token"],pending["token"])

    def test_changed_configuration_is_not_supported_by_the_configuration_check(self):
        payload=f.launch_payload(self.env);payload["sourceDetails"]["bootVolumeVpusPerGB"]=20
        self.assertEqual(f.published_configuration(report(),payload,self.env)["status"],"UNVERIFIED")
        data=report();data["home_region_verified"]=False
        self.assertEqual(f.published_configuration(data,f.launch_payload(self.env),self.env)["status"],"UNVERIFIED")


if __name__=="__main__":unittest.main()
