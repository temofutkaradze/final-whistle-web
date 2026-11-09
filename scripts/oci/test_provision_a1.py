"""Local-only tests: OCI and HTTP calls are mocked; no cloud credentials required."""
import base64
import copy
import json
import io
from contextlib import redirect_stdout
import os
import struct
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import provision_a1 as p


def environment():
    kind = b"ssh-ed25519"
    public = base64.b64encode(struct.pack(">I", len(kind)) + kind + struct.pack(">I", 32) + b"x" * 32).decode()
    return {
        "OCI_REGION": p.REGION, "OCI_USER_OCID": "ocid1.user.oc1..test",
        "OCI_TENANCY_OCID": "ocid1.tenancy.oc1..test",
        "OCI_FINGERPRINT": "00:11:22:33", "OCI_PRIVATE_KEY": "-----BEGIN PRIVATE KEY-----\nTEST\n-----END PRIVATE KEY-----",
        "OCI_COMPARTMENT_OCID": "ocid1.compartment.oc1..test",
        "OCI_SUBNET_OCID": "ocid1.subnet.oc1.eu-paris-1.test",
        "OCI_IMAGE_OCID": "ocid1.image.oc1.eu-paris-1.test",
        "OCI_SSH_PUBLIC_KEY": "ssh-ed25519 " + public,
        "GITHUB_REPOSITORY": p.REPOSITORY, "GITHUB_RUN_ID": "1002",
        "GITHUB_ACTOR": "release-admin", "OCI_A1_STATE_ISSUE_NUMBER": "42", "GITHUB_TOKEN": "fake-token",
        "GITHUB_RUN_ATTEMPT": "1", "GITHUB_EVENT_NAME": "schedule",
    }


def instance(state="RUNNING"):
    return {"id": "ocid1.instance.oc1.eu-paris-1.test", "display-name": p.NAME,
            "lifecycle-state": state, "freeform-tags": p.TAG,
            "compartment-id": environment()["OCI_COMPARTMENT_OCID"],
            "availability-domain": p.AD, "shape": p.SHAPE,
            "shape-config": {"ocpus": 2, "memory-in-gbs": 12, "max-vnic-attachments": 2}}


class MemoryState:
    def __init__(self):
        self.value = p.initial_state()
        self.history = []
        self.fail_write = None

    def read(self):
        return copy.deepcopy(self.value)

    def save(self, before, after):
        p.valid_state(after)
        if self.fail_write == after["status"]:
            raise p.Unsafe("Simulated state persistence failure")
        if self.value != before:
            raise p.Unsafe("Simulated conflicting writer")
        self.value = copy.deepcopy(after)
        self.history.append(copy.deepcopy(after))

    def reviewer(self, actor):
        if actor != "release-admin":
            raise p.Unsafe("Not an authorized reviewer")


class FakeCLI:
    def __init__(self, env):
        self.env = env
        self.calls = []
        self.instances = []
        self.second_instances = None
        self.lists = 0
        self.overrides = {}
        self.network_compartment = env.get("OCI_COMPARTMENT_OCID")
        self.launches = []
        self.launch_result = instance("PROVISIONING")
        self.limits = {
            "standard-a1-core-count": {"used": 0, "available": 2},
            "standard-a1-memory-count": {"used": 0, "available": 12},
            "total-storage-gb": {"used": 100, "available": 100},
        }

    def call(self, *args):
        self.calls.append(args)
        prefix = args[:3]
        if prefix in self.overrides:
            result = self.overrides[prefix]
            if isinstance(result, Exception):
                raise result
            return copy.deepcopy(result)
        if prefix == ("compute", "instance", "list"):
            self.lists += 1
            return self.instances if self.lists == 1 or self.second_instances is None else self.second_instances
        if prefix == ("compute", "instance", "get"):
            return instance()
        if prefix == ("iam", "region-subscription", "list"):
            return [{"region-name": p.REGION, "is-home-region": True, "status": "READY"}]
        if prefix == ("iam", "availability-domain", "list"):
            return [{"name": p.AD}]
        if prefix == ("iam", "compartment", "get"):
            return {"id": self.env["OCI_COMPARTMENT_OCID"], "name": "final-whistle-servers", "lifecycle-state": "ACTIVE"}
        if prefix == ("network", "subnet", "get"):
            return {"id": self.env["OCI_SUBNET_OCID"], "compartment-id": self.network_compartment,
                    "display-name": "final-whistle-public-subnet", "lifecycle-state": "AVAILABLE",
                    "prohibit-public-ip-on-vnic": False, "vcn-id": "ocid1.vcn.oc1.eu-paris-1.test",
                    "route-table-id": "ocid1.routetable.oc1.eu-paris-1.test",
                    "security-list-ids": ["ocid1.securitylist.oc1.eu-paris-1.test"]}
        if prefix == ("network", "vcn", "get"):
            return {"id": "ocid1.vcn.oc1.eu-paris-1.test", "compartment-id": self.network_compartment,
                    "display-name": "final-whistle-vcn", "lifecycle-state": "AVAILABLE"}
        if prefix == ("network", "route-table", "get"):
            return {"id": "ocid1.routetable.oc1.eu-paris-1.test", "compartment-id": self.network_compartment,
                    "vcn-id": "ocid1.vcn.oc1.eu-paris-1.test", "lifecycle-state": "AVAILABLE",
                    "route-rules": [{"destination": "0.0.0.0/0", "destination-type": "CIDR_BLOCK",
                                    "network-entity-id": "ocid1.internetgateway.oc1.eu-paris-1.test"}]}
        if prefix == ("network", "internet-gateway", "get"):
            return {"id": "ocid1.internetgateway.oc1.eu-paris-1.test", "display-name": "final-whistle-igw",
                    "compartment-id": self.network_compartment, "is-enabled": True,
                    "vcn-id": "ocid1.vcn.oc1.eu-paris-1.test", "lifecycle-state": "AVAILABLE"}
        if prefix == ("network", "security-list", "get"):
            return {"id": "ocid1.securitylist.oc1.eu-paris-1.test", "compartment-id": self.network_compartment,
                    "vcn-id": "ocid1.vcn.oc1.eu-paris-1.test", "lifecycle-state": "AVAILABLE",
                    "ingress-security-rules": [], "egress-security-rules": []}
        if prefix == ("compute", "image", "get"):
            return {"id": self.env["OCI_IMAGE_OCID"], "compartment-id": None,
                    "operating-system": "Canonical Ubuntu", "operating-system-version": "24.04",
                    "display-name": "Canonical-Ubuntu-24.04-aarch64-2026.10.01-0",
                    "lifecycle-state": "AVAILABLE", "size-in-mbs": 47694}
        if prefix == ("compute", "shape", "list"):
            return [{"shape": p.SHAPE, "is-flexible": True}]
        if prefix == ("limits", "resource-availability", "get"):
            return copy.deepcopy(self.limits[args[args.index("--limit-name") + 1]])
        raise AssertionError("Unexpected fake call")

    def launch(self, payload, token):
        self.launches.append((copy.deepcopy(payload), token))
        if isinstance(self.launch_result, Exception):
            raise self.launch_result
        return self.launch_result


class ProvisionTests(unittest.TestCase):
    def setUp(self):
        self.network = patch("provision_a1.urllib.request.OpenerDirector.open",
                             side_effect=AssertionError("Real HTTP forbidden"))
        self.process = patch("provision_a1.subprocess.run",
                             side_effect=AssertionError("Real CLI forbidden"))
        self.network.start()
        self.process.start()
        self.addCleanup(self.network.stop)
        self.addCleanup(self.process.stop)
        self.env = environment()
        self.store = MemoryState()
        self.cli = FakeCLI(self.env)

    def run_fake(self):
        return p.provision(self.cli, self.env, self.store)

    def test_root_network_keeps_instance_and_boot_in_target_compartment(self):
        self.cli.network_compartment = self.env["OCI_TENANCY_OCID"]
        self.assertTrue(self.run_fake().startswith("CREATED"))
        payload = self.cli.launches[0][0]
        self.assertEqual(payload["compartmentId"], self.env["OCI_COMPARTMENT_OCID"])
        self.assertEqual(payload["subnetId"], self.env["OCI_SUBNET_OCID"])
        self.assertTrue(payload["assignPublicIp"])
        self.assertEqual(payload["shapeConfig"], {"ocpus": 2, "memoryInGBs": 12})
        self.assertEqual(payload["sourceDetails"]["bootVolumeSizeInGBs"], 50)
        self.assertIn(("network", "security-list", "get", "--security-list-id",
                       "ocid1.securitylist.oc1.eu-paris-1.test"), self.cli.calls)

    def test_foreign_network_compartment_never_launches_or_writes_state(self):
        self.cli.network_compartment = "ocid1.compartment.oc1..unapproved"
        with self.assertRaises(p.Unsafe):
            self.run_fake()
        self.assertFalse(self.cli.launches)
        self.assertFalse(self.store.history)

    def test_root_network_rejects_wrong_id_names_states_and_associations(self):
        cases = {
            ("network", "subnet", "get"): [
                {"id": "ocid1.subnet.oc1.eu-paris-1.wrong"}, {"display-name": "wrong"},
                {"lifecycle-state": "TERMINATING"}, {"prohibit-public-ip-on-vnic": True},
                {"route-table-id": ""}, {"vcn-id": ""}, {"security-list-ids": []},
                {"security-list-ids": ["ocid1.securitylist.x"] * 2}],
            ("network", "vcn", "get"): [
                {"id": "ocid1.vcn.wrong"}, {"display-name": "wrong"},
                {"lifecycle-state": "TERMINATING"}, {"compartment-id": "ocid1.compartment.foreign"}],
            ("network", "route-table", "get"): [
                {"id": "ocid1.routetable.wrong"}, {"vcn-id": "ocid1.vcn.wrong"},
                {"lifecycle-state": "TERMINATING"}, {"compartment-id": "ocid1.compartment.foreign"},
                {"route-rules": []}, {"route-rules": [{"destination":"0.0.0.0/0",
                    "destination-type":"CIDR_BLOCK","network-entity-id":"ocid1.natgateway.x"}]}],
            ("network", "internet-gateway", "get"): [
                {"id": "ocid1.internetgateway.wrong"}, {"display-name": "wrong"},
                {"is-enabled": False}, {"vcn-id": "ocid1.vcn.wrong"},
                {"lifecycle-state": "TERMINATING"}, {"compartment-id": "ocid1.compartment.foreign"}],
            ("network", "security-list", "get"): [
                {"id": "ocid1.securitylist.wrong"}, {"vcn-id": "ocid1.vcn.wrong"},
                {"lifecycle-state": "TERMINATING"}, {"compartment-id": "ocid1.compartment.foreign"},
                {"ingress-security-rules": None}, {"egress-security-rules": None}]
        }
        for command, changes in cases.items():
            for change in changes:
                with self.subTest(command=command, change=change):
                    self.cli = FakeCLI(self.env)
                    self.cli.network_compartment = self.env["OCI_TENANCY_OCID"]
                    self.store = MemoryState()
                    original = self.cli.call(*command)
                    self.cli.overrides[command] = dict(original, **change)
                    with self.assertRaises(p.Unsafe):
                        self.run_fake()
                    self.assertFalse(self.cli.launches)
                    self.assertFalse(self.store.history)

    def test_root_network_permission_error_remains_a_real_failure(self):
        self.cli.network_compartment = self.env["OCI_TENANCY_OCID"]
        self.cli.overrides[("network", "security-list", "get")] = p.OCIError("NotAuthorizedOrNotFound")
        with self.assertRaises(p.OCIError):
            self.run_fake()
        self.assertFalse(self.cli.launches)
        self.assertFalse(self.store.history)

    def test_real_a1_limit_ids_scope_and_root_ceiling_are_preserved(self):
        self.run_fake()
        calls = [args for args in self.cli.calls if args[:3] ==
                 ("limits", "resource-availability", "get") and
                 args[args.index("--service-name") + 1] == "compute"]
        self.assertEqual(len(calls), 4)
        self.assertEqual({args[args.index("--limit-name") + 1] for args in calls},
                         {"standard-a1-core-count", "standard-a1-memory-count"})
        for args in calls:
            self.assertEqual(args[args.index("--availability-domain") + 1], p.AD)
        for name, excessive in (("standard-a1-core-count", 3), ("standard-a1-memory-count", 13)):
            self.cli = FakeCLI(self.env)
            self.store = MemoryState()
            self.cli.limits[name] = {"used": 0, "available": excessive}
            with self.assertRaises(p.Unsafe):
                self.run_fake()
            self.assertFalse(self.cli.launches)
            self.assertFalse(self.store.history)

    def test_no_capacity_is_clean_and_only_one_attempt(self):
        self.cli.launch_result = p.OCIError("InternalError", capacity=True)
        self.assertTrue(self.run_fake().startswith("NO_CAPACITY"))
        self.assertEqual(len(self.cli.launches), 1)

    def test_all_nonterminated_states_skip_without_other_cloud_calls(self):
        for state in p.STATES - {"TERMINATED"}:
            with self.subTest(state=state):
                self.cli = FakeCLI(self.env)
                self.cli.instances = [instance(state)]
                self.assertTrue(self.run_fake().startswith("EXISTS"))
                self.assertEqual(len(self.cli.calls), 1)
                self.assertFalse(self.cli.launches)

    def test_alias_or_tagged_existing_instance_is_recognized(self):
        for alias in ("Final-Whistle", "final-whistle-server"):
            self.cli.instances = [dict(instance(), **{"display-name": alias})]
            self.assertTrue(self.run_fake().startswith("EXISTS"))
        self.cli.instances = [dict(instance(), **{"display-name": "renamed"})]
        self.assertTrue(self.run_fake().startswith("EXISTS"))

    def test_terminated_instance_does_not_block(self):
        self.cli.instances = [instance("TERMINATED")]
        self.assertTrue(self.run_fake().startswith("CREATED"))

    def test_two_existing_matches_fail_without_creation(self):
        self.cli.instances = [instance(), instance("STOPPED")]
        with self.assertRaises(p.Unsafe):
            self.run_fake()
        self.assertFalse(self.cli.launches)

    def test_successful_launch_has_exact_resources_and_repeatable_attempt_identity(self):
        self.assertTrue(self.run_fake().startswith("CREATED"))
        payload, token = self.cli.launches[0]
        self.assertEqual(payload["shape"], "VM.Standard.A1.Flex")
        self.assertEqual(payload["shapeConfig"], {"ocpus": 2, "memoryInGBs": 12})
        self.assertEqual(payload["sourceDetails"]["bootVolumeSizeInGBs"], 50)
        self.assertEqual(payload["sourceDetails"]["bootVolumeVpusPerGB"], 10)
        self.assertEqual(payload["availabilityDomain"], p.AD)
        self.assertEqual(payload["subnetId"], self.env["OCI_SUBNET_OCID"])
        self.assertTrue(payload["assignPublicIp"])
        self.assertNotIn("createVnicDetails", payload)
        self.assertNotIn("launchVolumeAttachments", payload)
        other = FakeCLI(self.env)
        p.provision(other, self.env, MemoryState())
        self.assertEqual(token, other.launches[0][1])

    def test_second_list_prevents_racing_creation(self):
        self.cli.second_instances = [instance("PROVISIONING")]
        self.assertTrue(self.run_fake().startswith("EXISTS"))
        self.assertFalse(self.cli.launches)

    def test_authentication_and_quota_errors_are_not_capacity(self):
        for code in ("NotAuthenticated", "NotAuthorizedOrNotFound", "LimitExceeded", "InvalidParameter"):
            self.store = MemoryState()
            self.cli = FakeCLI(self.env)
            self.cli.launch_result = p.OCIError(code)
            with self.assertRaises(p.OCIError):
                self.run_fake()
            self.assertEqual(len(self.cli.launches), 1)

    def test_malformed_existing_list_is_never_empty(self):
        for value in (None, {}, "[]", [None], [{}]):
            self.cli = FakeCLI(self.env)
            self.cli.overrides[("compute", "instance", "list")] = value
            with self.assertRaises(p.Unsafe):
                self.run_fake()
            self.assertFalse(self.cli.launches)

    def test_missing_secrets_fail_before_cli(self):
        for name in p.REQUIRED:
            env = environment()
            del env[name]
            cli = FakeCLI(env)
            with self.assertRaises(p.Unsafe):
                p.provision(cli, env, MemoryState())
            self.assertFalse(cli.calls)

    def test_wrong_region_fails(self):
        self.env["OCI_REGION"] = "eu-frankfurt-1"
        with self.assertRaises(p.Unsafe):
            self.run_fake()
        self.assertFalse(self.cli.calls)

    def test_invalid_home_image_shape_or_network_fail_before_launch(self):
        overrides = [
            (("iam", "region-subscription", "list"), [{"region-name": "elsewhere", "is-home-region": True, "status": "READY"}]),
            (("compute", "image", "get"), {"id": self.env["OCI_IMAGE_OCID"], "compartment-id": None,
                "operating-system": "Canonical Ubuntu", "operating-system-version": "24.04",
                "display-name": "Canonical-Ubuntu-Pro-24.04-aarch64-2026", "lifecycle-state": "AVAILABLE", "size-in-mbs": 100}),
            (("compute", "shape", "list"), [{"shape": "VM.Standard.A2.Flex", "is-flexible": True}]),
            (("network", "subnet", "get"), {"prohibit-public-ip-on-vnic": True}),
        ]
        for key, value in overrides:
            self.cli = FakeCLI(self.env)
            self.cli.overrides[key] = value
            with self.assertRaises(p.Unsafe):
                self.run_fake()
            self.assertFalse(self.cli.launches)

    def test_insufficient_or_unbounded_free_limits_fail(self):
        for name, value in (
            ("standard-a1-core-count", {"used": 0, "available": 1}),
            ("standard-a1-memory-count", {"used": 0, "available": 11}),
            ("total-storage-gb", {"used": 151, "available": 49}),
            ("standard-a1-core-count", {"used": 0, "available": 24}),
            ("total-storage-gb", {"used": 0, "available": 10000}),
            ("standard-a1-core-count", {"available": 2}),
            ("standard-a1-memory-count", {"used": False, "available": 12}),
        ):
            self.cli = FakeCLI(self.env)
            self.cli.limits[name] = value
            with self.assertRaises(p.Unsafe):
                self.run_fake()
            self.assertFalse(self.cli.launches)

    def test_malformed_launch_is_failure_not_capacity(self):
        for value in (None, {}, {"id": "ocid1.instance.x", "lifecycle-state": "UNKNOWN"}):
            self.store = MemoryState()
            self.cli = FakeCLI(self.env)
            self.cli.launch_result = value
            with self.assertRaises(p.Unsafe):
                self.run_fake()
            self.assertEqual(len(self.cli.launches), 1)

    def make_pending(self):
        self.cli.launch_result = p.Unsafe("Unknown OCI outcome")
        with self.assertRaises(p.Unsafe):
            self.run_fake()
        self.assertEqual(self.store.value["status"], "pending")
        return self.store.value["token"]

    def test_skipped_cancelled_failed_runs_never_clear_pending(self):
        token = self.make_pending()
        for conclusion in ("skipped", "cancelled", "failure", "success", None):
            # Run conclusions are deliberately not trusted or consumed.
            self.env.update(GITHUB_RUN_ID=str(int(self.env["GITHUB_RUN_ID"]) + 1),
                            GITHUB_PREVIOUS_CONCLUSION=str(conclusion))
            cli = FakeCLI(self.env)
            with self.assertRaises(p.Unsafe):
                p.provision(cli, self.env, self.store)
            self.assertFalse(cli.launches)
            self.assertEqual(self.store.value["token"], token)
            self.assertEqual(self.store.value["status"], "pending")

    def test_pending_survives_elapsed_time_and_workflow_retry(self):
        token = self.make_pending()
        self.env.update(GITHUB_RUN_ATTEMPT="2", OCI_A1_RETRY_GENERATION="arbitrary-ignored")
        with self.assertRaises(p.Unsafe):
            p.provision(FakeCLI(self.env), self.env, self.store)
        self.assertEqual(self.store.value["token"], token)

    def test_capacity_rejection_allows_fresh_token_on_next_scheduled_run(self):
        self.cli.launch_result = p.OCIError("InternalError", capacity=True)
        self.assertTrue(self.run_fake().startswith("NO_CAPACITY"))
        first = self.store.value["token"]
        self.assertEqual(self.store.value["status"], "capacity_rejected")
        self.env["GITHUB_RUN_ID"] = "1003"
        next_cli = FakeCLI(self.env)
        self.assertTrue(p.provision(next_cli, self.env, self.store).startswith("CREATED"))
        self.assertNotEqual(first, next_cli.launches[0][1])
        self.assertEqual(len(next_cli.launches), 1)

    def test_capacity_rejection_allows_new_workflow_retry_attempt(self):
        self.cli.launch_result = p.OCIError("InternalError", capacity=True)
        self.run_fake()
        first = self.store.value["token"]
        self.env["GITHUB_RUN_ATTEMPT"] = "2"
        next_cli = FakeCLI(self.env)
        p.provision(next_cli, self.env, self.store)
        self.assertNotEqual(first, next_cli.launches[0][1])

    def test_exact_attempt_cannot_launch_twice_after_capacity_rejection(self):
        self.cli.launch_result = p.OCIError("InternalError", capacity=True)
        self.run_fake()
        cli = FakeCLI(self.env)
        with self.assertRaises(p.Unsafe):
            p.provision(cli, self.env, self.store)
        self.assertFalse(cli.launches)

    def test_pending_is_persisted_before_launch(self):
        original = self.cli.launch
        def launch(payload, token):
            self.assertEqual(self.store.value["status"], "pending")
            self.assertEqual(self.store.value["token"], token)
            return original(payload, token)
        self.cli.launch = launch
        self.run_fake()
        self.assertEqual([r["status"] for r in self.store.history], ["pending", "created"])

    def test_failed_pending_write_prevents_launch(self):
        self.store.fail_write = "pending"
        with self.assertRaises(p.Unsafe):
            self.run_fake()
        self.assertFalse(self.cli.launches)

    def test_failed_capacity_write_keeps_pending_block(self):
        self.cli.launch_result = p.OCIError("InternalError", capacity=True)
        self.store.fail_write = "capacity_rejected"
        with self.assertRaises(p.Unsafe):
            self.run_fake()
        self.assertEqual(self.store.value["status"], "pending")

    def test_auth_errors_and_malformed_launches_retain_pending(self):
        for response in (p.OCIError("NotAuthenticated"), p.OCIError("InvalidRetryToken"),
                         p.Unsafe("timeout"), {}, None):
            self.store = MemoryState()
            self.cli = FakeCLI(self.env)
            self.cli.launch_result = response
            with self.assertRaises(p.Unsafe):
                self.run_fake()
            self.assertEqual(self.store.value["status"], "pending")

    def test_existing_instance_never_clears_pending(self):
        token = self.make_pending()
        cli = FakeCLI(self.env)
        cli.instances = [instance("PROVISIONING")]
        self.assertTrue(p.provision(cli, self.env, self.store).startswith("EXISTS"))
        self.assertEqual(self.store.value["status"], "pending")
        self.assertEqual(self.store.value["token"], token)

    def test_reconciliation_requires_exact_token_evidence_and_authorized_actor(self):
        token = self.make_pending()
        base = dict(self.env, GITHUB_EVENT_NAME="workflow_dispatch", GITHUB_RUN_ID="1003",
                    OCI_A1_RECONCILE_TOKEN=token,
                    OCI_A1_RECONCILIATION_EVIDENCE="OCI audit/support confirms no instance was created")
        for change in ({"OCI_A1_RECONCILE_TOKEN":"wrong"},
                       {"OCI_A1_RECONCILIATION_EVIDENCE":""},
                       {"GITHUB_EVENT_NAME":"schedule"},
                       {"GITHUB_ACTOR":"not-admin"}):
            env = dict(base, **change)
            cli = FakeCLI(env)
            with self.assertRaises(p.Unsafe):
                p.provision(cli, env, self.store)
            self.assertFalse(cli.launches)
            self.assertEqual(self.store.value["status"], "pending")
        cli = FakeCLI(base)
        self.assertTrue(p.provision(cli, base, self.store).startswith("RECONCILED"))
        self.assertFalse(cli.launches)
        self.assertEqual(self.store.value["status"], "ready")
        self.assertEqual(self.store.value["token"], token)
        self.assertEqual(self.store.value["resolution"]["actor"], "release-admin")
        self.assertNotIn("OCI audit/support", str(self.store.value))
        env = dict(self.env, GITHUB_RUN_ID="1004")
        next_cli = FakeCLI(env)
        p.provision(next_cli, env, self.store)
        self.assertNotEqual(token, next_cli.launches[0][1])

    def test_reconciliation_refuses_when_instance_exists(self):
        token = self.make_pending()
        self.env.update(GITHUB_EVENT_NAME="workflow_dispatch", OCI_A1_RECONCILE_TOKEN=token,
                        OCI_A1_RECONCILIATION_EVIDENCE="OCI audit confirms no instance was created")
        cli = FakeCLI(self.env)
        cli.instances = [instance()]
        self.assertTrue(p.provision(cli, self.env, self.store).startswith("EXISTS"))
        self.assertEqual(self.store.value["status"], "pending")

    def test_success_record_blocks_replacement_even_after_termination(self):
        self.run_fake()
        self.env["GITHUB_RUN_ID"] = "1003"
        cli = FakeCLI(self.env)
        cli.instances = [instance("TERMINATED")]
        with self.assertRaises(p.Unsafe):
            p.provision(cli, self.env, self.store)
        self.assertFalse(cli.launches)

    def test_target_changes_do_not_rotate_away_pending(self):
        token = self.make_pending()
        self.env["OCI_IMAGE_OCID"] += "changed"
        with self.assertRaises(p.Unsafe):
            p.provision(FakeCLI(self.env), self.env, self.store)
        self.assertEqual(self.store.value["token"], token)

    def test_stale_snapshot_cannot_overwrite_pending(self):
        before = self.store.read()
        p.begin_attempt(self.store, before, self.env)
        with self.assertRaises(p.Unsafe):
            p.begin_attempt(self.store, before, dict(self.env, GITHUB_RUN_ID="1003"))

    def test_state_api_missing_closed_malformed_and_unverified_writes_fail(self):
        body = p.initial_state()
        issue = {"number":42, "title":p.STATE_TITLE, "state":"open",
                 "repository_url":"https://api.github.com/repos/" + p.REPOSITORY,
                 "body":json.dumps(body)}
        for change in ({"body":"invalid"}, {"state":"closed"}, {"number":43},
                       {"pull_request":{}}, {"body":"{}"}):
            store = p.GitHubState(self.env, lambda *args: dict(issue, **change))
            with self.assertRaises(p.Unsafe):
                store.read()
        for mode in ("ok", "write-fails", "applied-lost-response", "wrong-ack", "readback-stale"):
            current = copy.deepcopy(issue)
            def request(method, path, data=None):
                if method == "GET":
                    return copy.deepcopy(current)
                if mode == "write-fails":
                    raise p.Unsafe("Lost write response")
                if mode != "readback-stale":
                    current["body"] = data["body"]
                if mode == "applied-lost-response":
                    raise p.Unsafe("Response lost after persistence")
                return {"body":"wrong"} if mode == "wrong-ack" else data
            store = p.GitHubState(self.env, request)
            self.assertEqual(store.read(), body)
            if mode == "ok":
                pending = p.begin_attempt(store, body, self.env)
                self.assertEqual(store.read(), pending)
            else:
                with self.assertRaises(p.Unsafe):
                    p.begin_attempt(store, body, self.env)
                if mode == "applied-lost-response":
                    self.assertEqual(store.read()["status"], "pending")
                    with self.assertRaises(p.Unsafe):
                        p.prepare_attempt(store, self.env)

    def test_missing_state_configuration_and_changed_target_fail_closed(self):
        for change in ({"OCI_A1_STATE_ISSUE_NUMBER":""}, {"GITHUB_TOKEN":""}):
            with self.assertRaises(p.Unsafe):
                p.GitHubState(dict(self.env, **change))
        self.run_fake()
        self.env["OCI_IMAGE_OCID"] += "changed"
        with self.assertRaises(p.Unsafe):
            p.prepare_attempt(self.store, self.env)

    def test_cli_parsing_capacity_auth_and_no_secret_echo(self):
        secret = "PRIVATE-SENTINEL"
        bad = subprocess.CompletedProcess([], 1, "", 'ServiceError:\n' + json.dumps(
            {"status": 401, "code": "NotAuthenticated", "message": secret}))
        with self.assertRaises(p.OCIError) as caught:
            p.decode_oci(bad)
        self.assertNotIn(secret, str(caught.exception))
        self.assertFalse(caught.exception.capacity)
        capacity = subprocess.CompletedProcess([], 1, "", 'ServiceError:\n' + json.dumps(
            {"status": 500, "code": "InternalError", "message": "Out of host capacity."}))
        with self.assertRaises(p.OCIError) as caught:
            p.decode_oci(capacity)
        self.assertTrue(caught.exception.capacity)
        for value in ("", "not json", "{}", '{"data":'):
            with self.assertRaises(p.Unsafe):
                p.decode_oci(subprocess.CompletedProcess([], 0, value, ""))

    def test_blank_cli_instance_list_requires_sdk_confirmation(self):
        for data in ([], [instance()]):
            with tempfile.TemporaryDirectory() as folder:
                cli = p.CLI(self.env, folder)
                responses = [subprocess.CompletedProcess([], 0, "", ""),
                    subprocess.CompletedProcess([], 0, json.dumps({"data": data}), "")]
                with patch("provision_a1.subprocess.run", side_effect=responses) as call:
                    self.assertEqual(cli.call("compute", "instance", "list",
                        "--compartment-id", self.env["OCI_COMPARTMENT_OCID"], "--all"), data)
                self.assertEqual(call.call_count, 2)
                self.assertEqual(call.call_args_list[1].args[0][1:3], ["-c", p.SDK_INSTANCE_LIST])

    def test_blank_cli_list_does_not_hide_sdk_auth_failure_or_bad_response(self):
        for verified in (subprocess.CompletedProcess([], 1, "", '{"code":"NotAuthenticated","status":401}'),
                         subprocess.CompletedProcess([], 0, "", ""),
                         subprocess.CompletedProcess([], 0, '{"data":{}}', ""),
                         subprocess.CompletedProcess([], 0, '{"data":null}', "")):
            with tempfile.TemporaryDirectory() as folder:
                cli = p.CLI(self.env, folder)
                with patch("provision_a1.subprocess.run", side_effect=[
                    subprocess.CompletedProcess([], 0, "", ""), verified]):
                    with self.assertRaises(p.Unsafe):
                        cli.call("compute", "instance", "list",
                                 "--compartment-id", self.env["OCI_COMPARTMENT_OCID"], "--all")

    def test_empty_or_malformed_other_commands_remain_fail_closed(self):
        for words in (("compute", "instance", "get"), ("compute", "instance", "launch"),
                      ("compute", "shape", "list")):
            with tempfile.TemporaryDirectory() as folder:
                cli = p.CLI(self.env, folder)
                with patch("provision_a1.subprocess.run",
                           return_value=subprocess.CompletedProcess([], 0, "", "")) as call:
                    with self.assertRaises(p.Unsafe):
                        cli.call(*words)
                    self.assertEqual(call.call_count, 1)

    def test_diagnostics_identify_command_exit_and_format_without_sensitive_bytes(self):
        out = io.StringIO()
        with redirect_stdout(out):
            p.command_diagnostic(("compute", "instance", "list", "--compartment-id", "SECRET-ID"),
                                subprocess.CompletedProcess([], 0, "", "SECRET-KEY"))
            p.command_diagnostic(("compute", "instance", "launch", "--from-json", "SECRET-PAYLOAD"),
                                subprocess.CompletedProcess([], 1, "<html>SECRET-TOKEN</html>", "SECRET-PRIVATE"))
        log = out.getvalue()
        self.assertIn("command=compute instance list exit=0 stdout_format=empty", log)
        self.assertIn("command=compute instance launch exit=1 stdout_format=non-json", log)
        self.assertNotIn("SECRET", log)
        self.assertNotIn("<html>", log)

    def test_valid_instance_json_does_not_add_an_sdk_request(self):
        with tempfile.TemporaryDirectory() as folder:
            cli = p.CLI(self.env, folder)
            with patch("provision_a1.subprocess.run",
                       return_value=subprocess.CompletedProcess([], 0, '{"data":[]}', "")) as call:
                self.assertEqual(cli.call("compute", "instance", "list", "--all"), [])
                self.assertEqual(call.call_count, 1)

    def test_cli_disables_retries_and_enforces_one_launch(self):
        with tempfile.TemporaryDirectory() as folder:
            cli = p.CLI(self.env, folder)
            response = subprocess.CompletedProcess([], 0, '{"data":{}}', "")
            with patch("provision_a1.subprocess.run", return_value=response) as call:
                cli.call("compute", "instance", "launch")
                self.assertIn("--no-retry", call.call_args.args[0])
                self.assertNotIn("OCI_PRIVATE_KEY", call.call_args.kwargs["env"])
                with self.assertRaises(p.Unsafe):
                    cli.call("compute", "instance", "launch")
            if os.name == "posix":
                self.assertEqual((cli.directory / "key.pem").stat().st_mode & 0o777, 0o600)

    def test_configuration_injection_and_bad_ssh_are_rejected(self):
        for key, value in (("OCI_USER_OCID", "ocid1.user.x\nregion=elsewhere"),
                           ("OCI_SSH_PUBLIC_KEY", "ssh-ed25519 invalid!")):
            env = dict(self.env)
            env[key] = value
            with self.assertRaises(p.Unsafe):
                p.validate_environment(env)


if __name__ == "__main__":
    unittest.main()
