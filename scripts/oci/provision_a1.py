"""Fail-closed Oracle A1 provisioner. Only main(--execute) may call OCI."""
import argparse
import base64
import hashlib
import json
import math
import os
import re
import struct
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
import uuid
from pathlib import Path

REGION = "eu-paris-1"
AD = "hsNq:EU-PARIS-1-AD-1"
SHAPE = "VM.Standard.A1.Flex"
NAME = "final-whistle-a1"
REPOSITORY = "temofutkaradze/final-whistle-web"
TAG = {"application": "final-whistle", "managed-by": "github-oracle-a1"}
REQUIRED = ("OCI_REGION", "OCI_USER_OCID", "OCI_TENANCY_OCID",
            "OCI_FINGERPRINT", "OCI_PRIVATE_KEY", "OCI_COMPARTMENT_OCID",
            "OCI_SUBNET_OCID", "OCI_IMAGE_OCID", "OCI_SSH_PUBLIC_KEY")
STATES = {"PROVISIONING", "STARTING", "RUNNING", "STOPPED", "STOPPING",
          "TERMINATING", "TERMINATED", "MOVING", "CREATING_IMAGE"}


class Unsafe(RuntimeError):
    """Messages must be static: never include raw provider output or secrets."""


class OCIError(Unsafe):
    def __init__(self, code="UNEXPECTED", capacity=False):
        super().__init__("OCI request failed: " + (code if re.fullmatch(r"[A-Za-z0-9_]{1,64}", code) else "UNEXPECTED"))
        self.capacity = capacity


def require(condition, message):
    if not condition:
        raise Unsafe(message)


def number(value):
    require(type(value) in (int, float) and math.isfinite(value) and value >= 0,
            "Missing or invalid numeric safety information")
    return value


def document(value):
    require(isinstance(value, dict), "Malformed OCI object")
    return value


def collection(value):
    require(isinstance(value, list) and all(isinstance(x, dict) for x in value),
            "Malformed OCI list")
    return value


def validate_environment(env):
    require(all(isinstance(env.get(k), str) and env[k].strip() for k in REQUIRED),
            "Missing required OCI secret")
    require(env["OCI_REGION"] == REGION, "Region must be eu-paris-1")
    for key in REQUIRED:
        if key not in ("OCI_PRIVATE_KEY", "OCI_SSH_PUBLIC_KEY"):
            require(not any(c in env[key] for c in "\r\n\0"), "Invalid configuration value")
    for key, kind in (("OCI_USER_OCID", "user"), ("OCI_TENANCY_OCID", "tenancy"),
                      ("OCI_COMPARTMENT_OCID", "compartment"),
                      ("OCI_SUBNET_OCID", "subnet"), ("OCI_IMAGE_OCID", "image")):
        require(env[key].startswith("ocid1." + kind + "."), "Invalid OCI identifier type")
    require("\n" not in env["OCI_SSH_PUBLIC_KEY"].strip() and
            "\r" not in env["OCI_SSH_PUBLIC_KEY"].strip(), "SSH public key must be one line")
    parts = env["OCI_SSH_PUBLIC_KEY"].strip().split()
    require(len(parts) >= 2 and parts[0] in ("ssh-ed25519", "ssh-rsa", "ecdsa-sha2-nistp256"),
            "Unsupported SSH public key")
    try:
        raw = base64.b64decode(parts[1], validate=True)
        length = struct.unpack(">I", raw[:4])[0]
        valid = raw[4:4 + length].decode("ascii") == parts[0] and len(raw) > 4 + length
    except (ValueError, UnicodeError, struct.error):
        valid = False
    require(valid, "Malformed SSH public key")
    key = env["OCI_PRIVATE_KEY"].strip()
    require(len(key) <= 20000 and
            re.match(r"-----BEGIN (?:RSA |EC )?PRIVATE KEY-----", key) is not None and
            re.search(r"-----END (?:RSA |EC )?PRIVATE KEY-----$", key) is not None,
            "Malformed OCI private key")


def decode_oci(result):
    if result.returncode:
        try:
            text = result.stderr
            start = text.index("{")
            error, _ = json.JSONDecoder().raw_decode(text[start:])
            code, status, message = error.get("code"), error.get("status"), error.get("message")
            capacity = (status == 500 and code == "InternalError" and
                        isinstance(message, str) and
                        re.match(r"^out of host capacity(?:\b|[.!])", message, re.I) is not None)
            raise OCIError(code if isinstance(code, str) else "UNEXPECTED", capacity)
        except (ValueError, AttributeError, TypeError):
            raise OCIError() from None
    try:
        payload = json.loads(result.stdout)
    except (ValueError, TypeError):
        raise Unsafe("OCI returned invalid JSON") from None
    require(isinstance(payload, dict) and "data" in payload,
            "OCI response missing data")
    return payload["data"]


class CLI:
    def __init__(self, env, directory):
        self.directory = Path(directory)
        self.env = {k: v for k, v in env.items()
                    if k not in ("OCI_PRIVATE_KEY", "OCI_SSH_PUBLIC_KEY", "GITHUB_TOKEN", "GH_TOKEN")}
        self.directory.mkdir(mode=0o700, exist_ok=True)
        os.chmod(self.directory, 0o700)
        self.write("key.pem", env["OCI_PRIVATE_KEY"])
        config = ("[DEFAULT]\nuser=" + env["OCI_USER_OCID"] +
                  "\ntenancy=" + env["OCI_TENANCY_OCID"] +
                  "\nfingerprint=" + env["OCI_FINGERPRINT"] +
                  "\nregion=" + REGION + "\nkey_file=" + str(self.directory / "key.pem") + "\n")
        self.write("config", config)
        self.env["OCI_CLI_CONFIG_FILE"] = str(self.directory / "config")
        self.launch_calls = 0

    def write(self, filename, value):
        p = self.directory / filename
        with p.open("x", encoding="utf-8") as file:
            os.chmod(p, 0o600)
            file.write(value)
        return p

    def call(self, *args):
        launch = tuple(args[:3]) == ("compute", "instance", "launch")
        if launch:
            self.launch_calls += 1
            require(self.launch_calls == 1, "Only one launch request is permitted")
        try:
            result = subprocess.run(
                ["oci", "--no-retry", "--connection-timeout", "10", "--read-timeout", "60",
                 "--region", REGION, "--output", "json", *args],
                env=self.env, capture_output=True, text=True, timeout=120, check=False)
        except (subprocess.TimeoutExpired, OSError):
            raise Unsafe("OCI timeout or CLI failure; outcome requires review") from None
        return decode_oci(result)

    def launch(self, payload, retry_token):
        file = self.write("launch.json", json.dumps(payload))
        return self.call("compute", "instance", "launch", "--from-json", "file://" + str(file),
                         "--opc-retry-token", retry_token)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


STATE_TITLE = "Oracle A1 provisioning safety state - DO NOT EDIT"
STATE_FIELDS = {"version", "repository", "revision", "status", "target", "token",
                "run_id", "run_attempt", "resolution"}
STATE_STATUSES = {"ready", "pending", "capacity_rejected", "created"}


def initial_state():
    return dict(version=1, repository=REPOSITORY, revision=0, status="ready",
                target=None, token=None, run_id=None, run_attempt=None, resolution=None)


def target_identity(env):
    values = [REPOSITORY, REGION, AD, SHAPE, 2, 12, 50, NAME,
              env["OCI_TENANCY_OCID"], env["OCI_COMPARTMENT_OCID"],
              env["OCI_SUBNET_OCID"], env["OCI_IMAGE_OCID"],
              env["OCI_SSH_PUBLIC_KEY"].strip()]
    return hashlib.sha256(json.dumps(values, separators=(",", ":")).encode()).hexdigest()


def valid_state(value):
    require(isinstance(value, dict) and set(value) == STATE_FIELDS and
            type(value["version"]) is int and value["version"] == 1 and
            value["repository"] == REPOSITORY and type(value["revision"]) is int and
            value["revision"] >= 0 and value["status"] in STATE_STATUSES,
            "Invalid durable safety record; do not recreate or reset it")
    if value["revision"] == 0:
        require(value == initial_state(), "Invalid initial safety record")
    else:
        require(isinstance(value["target"], str) and
                re.fullmatch(r"[0-9a-f]{64}", value["target"]) is not None and
                isinstance(value["token"], str) and
                re.fullmatch(r"[0-9a-f-]{36}", value["token"]) is not None and
                isinstance(value["run_id"], str) and value["run_id"].isdigit() and
                isinstance(value["run_attempt"], str) and value["run_attempt"].isdigit(),
                "Incomplete durable launch identity")
        require(value["resolution"] is None or
                (isinstance(value["resolution"], dict) and
                 set(value["resolution"]) == {"actor", "evidence_sha256", "run_id"}),
                "Invalid reconciliation evidence")
    return value


class GitHubState:
    """One fixed issue, never auto-created/reset. Workflow concurrency is the writer lock."""
    def __init__(self, env, request=None):
        require(env.get("GITHUB_REPOSITORY") == REPOSITORY, "Unexpected repository")
        issue = env.get("OCI_A1_STATE_ISSUE_NUMBER", "")
        require(re.fullmatch(r"[1-9][0-9]{0,9}", issue) is not None,
                "Configure the existing dedicated safety issue before activation")
        require(bool(env.get("GITHUB_TOKEN")), "Missing GitHub safety-state access")
        self.env = env
        self.issue = issue
        self.path = "/repos/" + REPOSITORY + "/issues/" + issue
        self.request = request or self.http

    def http(self, method, path, body=None):
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request("https://api.github.com" + path, data=data, method=method,
            headers={"Authorization": "Bearer " + self.env["GITHUB_TOKEN"],
                     "Accept": "application/vnd.github+json",
                     "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json"})
        try:
            with urllib.request.build_opener(NoRedirect).open(req, timeout=30) as response:
                raw = response.read(65537)
            require(len(raw) <= 65536, "GitHub safety response too large")
            return json.loads(raw)
        except (OSError, ValueError):
            raise Unsafe("Cannot verify durable safety state; no automatic retry") from None

    def read(self):
        issue = self.request("GET", self.path)
        require(isinstance(issue, dict) and issue.get("number") == int(self.issue) and
                issue.get("title") == STATE_TITLE and issue.get("state") == "open" and
                "pull_request" not in issue and
                issue.get("repository_url") == "https://api.github.com/repos/" + REPOSITORY,
                "Dedicated safety issue missing, closed, or changed; stop and reconcile")
        try:
            body = json.loads(issue["body"])
        except (KeyError, TypeError, ValueError):
            raise Unsafe("Malformed durable safety record") from None
        return valid_state(body)

    def save(self, before, after):
        valid_state(before)
        valid_state(after)
        require(after["revision"] == before["revision"] + 1 and self.read() == before,
                "Safety record changed concurrently; stop")
        body = json.dumps(after, sort_keys=True, separators=(",", ":"))
        result = self.request("PATCH", self.path, {"body": body})
        require(isinstance(result, dict) and result.get("body") == body and self.read() == after,
                "Safety write not verified; no launch or automatic retry")

    def reviewer(self, actor):
        require(isinstance(actor, str) and re.fullmatch(r"[A-Za-z0-9-]{1,39}", actor) is not None,
                "Invalid reconciliation actor")
        result = self.request("GET", "/repos/" + REPOSITORY + "/collaborators/" + actor + "/permission")
        require(isinstance(result, dict) and (result.get("permission") == "admin" or result.get("role_name") == "maintain"),
                "Reconciliation requires a repository admin or maintainer")


def prepare_attempt(store, env):
    record = store.read()
    target = target_identity(env)
    require(record["target"] in (None, target), "Target changed; reconcile the pinned safety record")
    token_input = env.get("OCI_A1_RECONCILE_TOKEN", "").strip()
    if token_input:
        require(env.get("GITHUB_EVENT_NAME") == "workflow_dispatch" and
                record["status"] == "pending" and token_input == record["token"],
                "Reconciliation must reference the exact pending token")
        evidence = env.get("OCI_A1_RECONCILIATION_EVIDENCE", "").strip()
        require(20 <= len(evidence) <= 1000,
                "Confirm no instance was created using OCI audit/support evidence")
        actor = env.get("GITHUB_ACTOR")
        store.reviewer(actor)
        # Caller already performed a fresh instance list; reconciliation never launches.
        updated = dict(record, revision=record["revision"] + 1, status="ready",
                       resolution={"actor": actor, "evidence_sha256":
                                   hashlib.sha256(evidence.encode()).hexdigest(),
                                   "run_id": env.get("GITHUB_RUN_ID")})
        store.save(record, updated)
        return None
    require(record["status"] in ("ready", "capacity_rejected"),
            "Unresolved or completed launch blocks provisioning; inspect the durable issue")
    run_id, attempt = env.get("GITHUB_RUN_ID", ""), env.get("GITHUB_RUN_ATTEMPT", "")
    require(run_id.isdigit() and int(run_id) > 0 and attempt.isdigit() and int(attempt) > 0,
            "Missing GitHub attempt identity")
    require((record["run_id"], record["run_attempt"]) != (run_id, attempt),
            "This workflow attempt already launched; no second request permitted")
    return record


def begin_attempt(store, before, env):
    target = target_identity(env)
    token = str(uuid.uuid5(uuid.NAMESPACE_URL,
                          json.dumps([target, env["GITHUB_RUN_ID"], env["GITHUB_RUN_ATTEMPT"]])))
    pending = dict(before, revision=before["revision"] + 1, status="pending",
                   target=target, token=token, run_id=env["GITHUB_RUN_ID"],
                   run_attempt=env["GITHUB_RUN_ATTEMPT"], resolution=None)
    store.save(before, pending)
    return pending


def finish_attempt(store, pending, status):
    store.save(pending, dict(pending, revision=pending["revision"] + 1, status=status))


def available(cli, env, service, limit, amount, cap=None, ad=None):
    # Root usage/headroom prevents counting just this compartment's free allocation.
    scopes = [env["OCI_TENANCY_OCID"], env["OCI_COMPARTMENT_OCID"]]
    for i, compartment in enumerate(scopes):
        args = ["limits", "resource-availability", "get", "--compartment-id", compartment,
                "--service-name", service, "--limit-name", limit]
        if ad:
            args += ["--availability-domain", ad]
        value = document(cli.call(*args))
        used, remaining = number(value.get("used")), number(value.get("available"))
        require(remaining >= amount, "Insufficient service limit/quota headroom")
        if i == 0 and cap is not None:
            require(used + amount <= cap and used + remaining <= cap,
                    "Cannot prove an enforced Always Free allocation ceiling")


def matching_instance(items):
    found = []
    for instance in collection(items):
        require(isinstance(instance.get("display-name"), str) and
                instance.get("lifecycle-state") in STATES and isinstance(instance.get("id"), str),
                "Incomplete existing-instance response")
        tags = instance.get("freeform-tags")
        require(isinstance(tags, dict), "Missing instance tag information")
        match = (instance["display-name"].lower().startswith("final-whistle") or
                 tags.get("application") == "final-whistle")
        if match and instance["lifecycle-state"] != "TERMINATED":
            found.append(instance)
    require(len(found) <= 1, "Multiple Final Whistle instances exist; operator review required")
    return found[0] if found else None


def provision(cli, env, store=None):
    validate_environment(env)
    compartment = env["OCI_COMPARTMENT_OCID"]
    # First cloud operation is list; malformed/inaccessible lists are never treated as empty.
    existing = matching_instance(cli.call("compute", "instance", "list",
                                         "--compartment-id", compartment, "--all"))
    if existing:
        return "EXISTS: " + existing["lifecycle-state"] + "; no resources changed"
    store = store or GitHubState(env)
    record = prepare_attempt(store, env)
    if record is None:
        return "RECONCILED: no launch; next scheduled attempt may proceed"
    home = collection(cli.call("iam", "region-subscription", "list",
                               "--tenancy-id", env["OCI_TENANCY_OCID"], "--all"))
    require(sum(r.get("is-home-region") is True for r in home) == 1 and
            any(r.get("is-home-region") is True and r.get("region-name") == REGION and
                r.get("status") == "READY" for r in home), "Paris must be the ready home region")
    domains = collection(cli.call("iam", "availability-domain", "list",
                                  "--compartment-id", env["OCI_TENANCY_OCID"]))
    # Strict single-AD region avoids an unverified cross-AD storage aggregate.
    require(len(domains) == 1 and domains[0].get("name") == AD,
            "Unexpected availability domains; cannot establish storage envelope")
    comp = document(cli.call("iam", "compartment", "get", "--compartment-id", compartment))
    require(comp.get("id") == compartment and comp.get("name") == "final-whistle-servers" and
            comp.get("lifecycle-state") == "ACTIVE", "Unexpected target compartment")
    subnet = document(cli.call("network", "subnet", "get", "--subnet-id", env["OCI_SUBNET_OCID"]))
    require(subnet.get("id") == env["OCI_SUBNET_OCID"] and
            subnet.get("compartment-id") == compartment and
            subnet.get("display-name") == "final-whistle-public-subnet" and
            subnet.get("lifecycle-state") == "AVAILABLE" and
            subnet.get("prohibit-public-ip-on-vnic") is False,
            "Existing public subnet cannot be verified")
    require(isinstance(subnet.get("vcn-id"), str) and isinstance(subnet.get("route-table-id"), str),
            "Subnet network identifiers missing")
    vcn = document(cli.call("network", "vcn", "get", "--vcn-id", subnet["vcn-id"]))
    require(vcn.get("id") == subnet["vcn-id"] and vcn.get("compartment-id") == compartment and
            vcn.get("display-name") == "final-whistle-vcn" and
            vcn.get("lifecycle-state") == "AVAILABLE", "Unexpected existing VCN")
    route = document(cli.call("network", "route-table", "get", "--rt-id", subnet["route-table-id"]))
    rules = collection(route.get("route-rules"))
    gateways = [r.get("network-entity-id") for r in rules if r.get("destination") == "0.0.0.0/0" and
                r.get("destination-type") == "CIDR_BLOCK" and
                isinstance(r.get("network-entity-id"), str) and
                r["network-entity-id"].startswith("ocid1.internetgateway.")]
    require(len(gateways) == 1, "No unique existing IPv4 Internet Gateway route")
    gateway = document(cli.call("network", "internet-gateway", "get", "--ig-id", gateways[0]))
    require(gateway.get("is-enabled") is True and gateway.get("vcn-id") == vcn["id"] and
            gateway.get("lifecycle-state") == "AVAILABLE", "Internet gateway unavailable")
    image = document(cli.call("compute", "image", "get", "--image-id", env["OCI_IMAGE_OCID"]))
    require(image.get("id") == env["OCI_IMAGE_OCID"] and image.get("compartment-id") is None and
            image.get("operating-system") == "Canonical Ubuntu" and
            image.get("operating-system-version") == "24.04" and
            re.fullmatch(r"Canonical-Ubuntu-24\.04(?:-Minimal)?-aarch64-[A-Za-z0-9.-]+",
                         image.get("display-name", "")) is not None and
            image.get("lifecycle-state") == "AVAILABLE" and number(image.get("size-in-mbs")) <= 51200,
            "Cannot establish free platform Ubuntu 24.04 ARM64 image eligibility")
    shapes = collection(cli.call("compute", "shape", "list", "--compartment-id", compartment,
                                  "--availability-domain", AD, "--image-id", env["OCI_IMAGE_OCID"], "--all"))
    require(any(s.get("shape") == SHAPE and s.get("is-flexible") is True for s in shapes),
            "A1 image/shape compatibility not established")
    available(cli, env, "compute", "standard-a1-core-regional-count", 2, 2)
    available(cli, env, "compute", "standard-a1-memory-regional-count", 12, 12)
    available(cli, env, "compute", "standard-a1-core-count", 2, ad=AD)
    available(cli, env, "compute", "standard-a1-memory-count", 12, ad=AD)
    available(cli, env, "block-storage", "total-storage-gb", 50, 200, AD)
    # Recheck immediately before launch; external operators must not provision in parallel.
    if matching_instance(cli.call("compute", "instance", "list", "--compartment-id", compartment, "--all")):
        return "EXISTS: discovered during preflight; no launch"
    payload = {
        "availabilityDomain": AD, "compartmentId": compartment, "displayName": NAME,
        "shape": SHAPE, "shapeConfig": {"ocpus": 2, "memoryInGBs": 12},
        "subnetId": env["OCI_SUBNET_OCID"], "assignPublicIp": True,
        "sourceDetails": {"sourceType": "image", "imageId": env["OCI_IMAGE_OCID"],
                          "bootVolumeSizeInGBs": 50, "bootVolumeVpusPerGB": 10},
        "metadata": {"ssh_authorized_keys": env["OCI_SSH_PUBLIC_KEY"].strip()},
        "freeformTags": TAG,
    }
    # Durable write/read-back precedes the only side-effecting OCI request.
    pending = begin_attempt(store, record, env)
    token = pending["token"]
    try:
        launched = document(cli.launch(payload, token))
    except OCIError as error:
        if error.capacity:
            finish_attempt(store, pending, "capacity_rejected")
            return "NO_CAPACITY: one launch rejected; next scheduled run may retry"
        raise
    require(isinstance(launched.get("id"), str) and launched["id"].startswith("ocid1.instance.") and
            launched.get("lifecycle-state") in STATES - {"TERMINATED", "TERMINATING"},
            "Launch outcome uncertain; do not retry without review")
    confirmed = document(cli.call("compute", "instance", "get", "--instance-id", launched["id"]))
    require(confirmed.get("id") == launched["id"] and confirmed.get("compartment-id") == compartment and
            confirmed.get("shape") == SHAPE and confirmed.get("availability-domain") == AD and
            isinstance(confirmed.get("shape-config"), dict) and
            confirmed["shape-config"].get("ocpus") == 2 and
            confirmed["shape-config"].get("memory-in-gbs") == 12 and
            confirmed.get("lifecycle-state") in STATES - {"TERMINATED", "TERMINATING"},
            "Created instance verification failed; review before further attempts")
    finish_attempt(store, pending, "created")
    return "CREATED: " + confirmed["lifecycle-state"] + "; launch verified, application not deployed"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    env = dict(os.environ)
    try:
        require(args.execute and env.get("GITHUB_ACTIONS") == "true" and
                env.get("GITHUB_REPOSITORY") == REPOSITORY and
                env.get("OCI_A1_PROVISIONING_ENABLED") == "true",
                "Execution is disabled; approved GitHub activation required")
        validate_environment(env)
        with tempfile.TemporaryDirectory(prefix="oracle-a1-") as folder:
            result = provision(CLI(env, folder), env)
        print(result)
        summary = env.get("GITHUB_STEP_SUMMARY")
        if summary:
            with open(summary, "a", encoding="utf-8") as file:
                file.write("### Oracle A1 outcome\n" + result + "\n")
        return 0
    except Unsafe as error:
        print("::error::" + str(error), file=sys.stderr)
        return 1
    except Exception:
        print("::error::Unexpected failure; outcome requires review. No automatic retry.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
