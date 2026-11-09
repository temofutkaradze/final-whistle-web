# Oracle A1 capacity automation

The workflow is deployed; runtime status is determined from Actions and the durable issue, not this document.
The configured schedule is */10 * * * * and the activation variable remains the operator-controlled gate.

Files: [workflow](../.github/workflows/oracle-a1.yml), [provisioner](../scripts/oci/provision_a1.py), [mock tests](../scripts/oci/test_provision_a1.py).

## Unchanged target and cost controls

Only eu-paris-1 / hsNq:EU-PARIS-1-AD-1 / final-whistle-servers / VM.Standard.A1.Flex / 2 OCPU / 12 GB RAM / 50 GB boot / 10 VPU balanced storage. Existing final-whistle-vcn, final-whistle-public-subnet and Internet Gateway only; official Canonical Ubuntu 24.04 aarch64 platform image. No paid shape fallback, extra volumes, network creation or application deployment.

Paris must be the ready home region. Root and target service/quota headroom must both be readable. The A1 limit IDs are standard-a1-core-count and standard-a1-memory-count (AD-scoped); Paris is currently restricted to exactly the expected one AD. These are admission limits, NOT a billing entitlement.

**Always Free eligibility correction is BLOCKED, not complete.** The existing conservative launch restriction remains in place. The 2/12 compute and 200 GB storage checks are not proof of free billing, even when they pass. Large headroom (for example used=0, available=41) is valid service-limit data; it is not 41 free OCPUs and it is not permission to launch. The diagnostic now identifies this unresolved billing boundary instead of claiming an enforced Always Free ceiling. Do not merge this change expecting it to unblock provisioning.

Unknown, malformed or insufficient headroom fails closed. Failed Limits lookups emit only allowlisted catalog metadata and safe command/error categories, never credentials or response bodies. No eligibility override, larger free ceiling, new repository variable, IAM change, or cloud modification is introduced.

### Why replacing the condition with used + requested <= 4 is unsafe

Reviewed on 2026-11-09:

- [Oracle ResourceAvailability](https://docs.oracle.com/en-us/iaas/tools/python/latest/api/limits/models/oci.limits.models.ResourceAvailability.html) describes current usage, service/quota availability and an optional effective quota. It does not report free billing entitlement or already consumed monthly free hours. Rounded values and missing/ambiguous data must not silently become zero.
- [Oracle Always Free Resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) currently lists 1,500 OCPU-hours and 9,000 GB-hours per month (2 OCPUs/12 GB continuously), while [Arm-Based Compute](https://docs.oracle.com/en-us/iaas/Content/Compute/References/arm.htm) still lists 3,000/18,000. The requested 4/24 maximum must not be substituted for verified tenancy terms. The existing stricter 2/12 restriction is retained pending that verification.
- [Oracle's price list](https://www.oracle.com/cloud/price-list/) describes the paid-tenancy A1 free usage pool as shared by virtual machines, bare metal and container instances. A VM-only inventory in one compartment is not sufficient evidence.
- [Cost Analysis](https://docs.oracle.com/en-us/iaas/Content/Billing/Concepts/costanalysisoverview.htm) can lag up to 48 hours. [Cost Reports](https://docs.oracle.com/en-us/iaas/Content/Billing/Concepts/costusagereportsoverview.htm) can lag up to 24 hours and receive corrections. Empty/zero reports cannot prove unused current-month entitlement. Terminated, resized or moved resources can have consumed monthly hours despite being absent from the current inventory.
- Trial credit availability is not Always Free eligibility. Service headroom and even a real hard quota constrain provisioning, not the accumulated month's bill. Budgets are alerts, not an atomic launch/billing guard.

### Remaining prerequisite and safe implementation design

No reliable automated entitlement proof was established from the currently queried APIs. Therefore the requested fail-closed fallback applies: preserve the launch restriction rather than deleting it or pretending usage arithmetic guarantees free billing.

Before implementing a launch-enabling change:

1. Obtain tenancy-specific confirmation of current A1 and storage eligibility, the applicable monthly pools and their scope from Oracle billing/subscription information or Support. Confirm the account remains on the intended plan; do not upgrade it. Resolve the conflicting 2/12 and 4/24 documentation. Do not put credentials, customer identifiers or billing exports in Git.
2. Establish complete resource visibility and accounting across root and all nested compartments and applicable regions/ADs, including A1 VMs, shared-meter bare-metal/container consumers, stopped/provisioning/terminating states, capacity reservations and retained boot/block volumes. Preserve existing duplicate checks; missing permissions, omitted pages, unknown states or unsupported consumers must block. Do not assume the current target-compartment list is this inventory or that a root usage number proves its completeness.
3. Separate service admission (remaining >= requested in every applicable scope) from aggregate allocation (existing + requested <= the verified free policy, never above the requested 4 OCPU/24 GB maximum). Retain exact A1.Flex 2/12 and 50 GB launch sizing and the combined 200 GB home-region boot/block envelope. Use the stricter applicable entitlement when lower. Do not count a reservation and its occupied instance twice or ignore unoccupied reservations.
4. Establish a conservative current-month consumption bound, including terminated/resized consumers and unreported usage, plus projected consumption for the intended runtime. An estimate based only on current instances or delayed reports is insufficient. This needs an independently reviewed accounting/enforcement design, not an automatic approval flag. If reliable bounds cannot be established, keep provisioning blocked.
5. Document how concurrent external provisioning is prevented or bounded by real enforcement across the relevant scopes. The GitHub concurrency lock protects this workflow only. Recheck admissibility immediately before the durable pending write; retain unchanged fail-closed handling of ambiguous launches.
6. Review/test the resulting accounting implementation separately before any launch-enabling merge. No old Work Request polling or cancellation requirement is added by this proposal.

The additional tests are **characterization/safety regressions**, not successful billing verification: 41-headroom is valid admission data in isolation, unproven launches remain blocked without issue writes, existing/exhausted allocation and malformed usage fail closed, and root headroom does not bypass an exhausted target quota.

The first cloud operation lists instances, then a second list immediately precedes launch. Any nonterminated Final Whistle name/tag prevents creation, including STOPPED and TERMINATING. Exactly one launch per workflow attempt; OCI automatic retries disabled. Existing resources are never changed.

## Existing cross-compartment network

The VM (and its new 50 GB boot volume) remains in final-whistle-servers. The configured public subnet and its existing VCN, route table, Internet Gateway and security lists may instead belong to the configured tenancy root. Only that root or the VM compartment is accepted; arbitrary third compartments are rejected.

Subnet ID must match OCI_SUBNET_OCID, and all existing network resources must have the expected identity/VCN association, the subnet's network compartment and AVAILABLE state. Known names remain final-whistle-public-subnet, final-whistle-vcn and final-whistle-igw. The default IPv4 route must lead to the enabled Internet Gateway. Referenced security lists are read and verified, never rewritten. Existing firewall rules are preserved; successful creation does not prove SSH/application reachability.

The API identity needs network read/use permissions in the network compartment in addition to compute/boot-volume permissions in final-whistle-servers. This is a read-only verification of existing networking; no network is moved, recreated or modified. Image identity/architecture, existing conservative allocation restrictions, exact sizing and all durable-state safeguards are unchanged.

## Durable safety record

A dedicated, manually initialized GitHub issue is the durable record. It is NOT an Actions cache, expiring artifact, run conclusion, or immediately preceding-run check. Only the issue body is updated; no commits, new branches, cloud storage, extra secrets or paid services are needed.

Before launch, the script writes a pending record containing the target fingerprint, exact retry token, run ID/attempt and revision, then reads it back. If persistence or verification fails, no launch follows. A stopped runner, timeout, ambiguous response, failed read-back or cancelled run leaves pending intact. Skipped/disabled/preflight-failed runs cannot clear it. Issue deletion/closure, malformed state, target changes or access failure stop provisioning; no automatic reset/recreation occurs.

After a structured HTTP 500/InternalError Out of host capacity rejection, capacity_rejected is persisted and verified. The next scheduled run (or new workflow retry attempt) gets a fresh deterministic UUID token based on target + run ID + run attempt. The exact same attempt cannot launch twice. Tokens are never rotated while pending; therefore their 24-hour expiry does not make an ambiguous outcome safe to retry.

Successful launch/read-back persists created. Existing-instance runs are no-ops and do not clear pending/created. Even after external termination, created blocks automatic replacement. Replacement requires a separate reviewed recovery plan.

GitHub's unchanged oracle-a1-provision concurrency group is the exclusive writer lock. State revisions and before/after reads detect stale snapshots, but the Issues API does not offer an atomic compare-and-swap lock here. Do not edit/reset the issue, change its configured number, run older/competing provisioners, or provision externally in parallel. Repository admins and write-enabled automation are trusted. Protect the workflow/default branch. These controls cannot provide a global OCI transaction against unrelated external operators.

## Setup after explicit approval

1. Review/reconcile upstream and the four local files. Commit/push/merge requires separate approval. Schedules run from the default branch.
2. Privately verify all nine existing OCI secrets. OCI_REGION must be eu-paris-1. IAM must permit tenancy region/AD/usage inspection and target instance/image/shape/network reads and the narrowly scoped instance/VNIC/boot-volume launch permissions.
3. Enable repository Issues if needed. After reviewing any earlier provisioning attempts and confirming no outstanding launch, manually create ONE open issue titled exactly:

   Oracle A1 provisioning safety state - DO NOT EDIT

   Its entire body must be the following JSON, without code fences:

~~~json
{"version":1,"repository":"temofutkaradze/final-whistle-web","revision":0,"status":"ready","target":null,"token":null,"run_id":null,"run_attempt":null,"resolution":null}
~~~

4. Set nonsecret repository variable OCI_A1_STATE_ISSUE_NUMBER to that issue's numeric number. Keep this fixed for the life of the automation. Never initialize a second issue to bypass pending/created.
5. The workflow now requires contents:read and issues:write for its existing GITHUB_TOKEN. No PAT or new secret is required. Permission denial fails closed. It cannot disable itself because actions:write is not granted.
6. Only after approval, set OCI_A1_PROVISIONING_ENABLED=true. Missing/false skips the job before any runner/OCI call; Python checks it again. OCI_A1_RETRY_GENERATION and the old resume_after_review input are obsolete and no longer used.
7. Run workflow_dispatch first with BOTH reconciliation inputs empty. Then monitor the */10 * * * * UTC schedule. GitHub may delay/drop schedule ticks; capacity/timing are not guaranteed.

## Reconcile an uncertain launch - no launch in the reconciliation run

1. Keep the pending record and token unchanged. Inspect the originating Actions run and OCI instance inventory/audit/support evidence, including in-flight requests and any boot-volume side effects. A single empty list is not proof that a timed-out request cannot still finish. Wait for the originating operation to settle. Never attest no instance while an earlier create might still complete.
2. If an instance exists, do NOT reconcile as absent. Existing-instance detection skips provisioning; investigate separately. No automated deletion or modification is performed.
3. Only after an admin/maintainer independently confirms that NO instance was created, dispatch manually with reconcile_token equal to the exact issue token and reconciliation_evidence containing a non-sensitive 20-1000 character attestation/reference to that investigation. Do not put credentials or private data into workflow inputs.
4. The script verifies the actor's repository admin/maintainer permission, target fingerprint, exact pending token, evidence and a fresh list with no matching instance. It persists ready with actor + evidence hash + reconciliation run ID. This run returns RECONCILED and NEVER launches. The next scheduled attempt may use a fresh token.
5. Failed verification leaves pending. GitHub cannot independently prove historical OCI noncreation; the authorized human's audit/support investigation is a required safety decision, not a checkbox that bypasses it.

Do not delete/reset state or use a new issue to work around errors. Missing state requires recovery/reconciliation, not automatic initialization.

## Monitor / disable

Actions -> Oracle A1 - Always Free capacity attempt:
- NO_CAPACITY: confirmed rejection AND durable release verified; next attempt may proceed.
- EXISTS: no launch or resource modification.
- CREATED: resource sizing read back; RUNNING, public IP, SSH and application readiness remain separate checks.
- RECONCILED: no launch; next schedule eligible.
- Failed: inspect the durable issue. Pending retains the token and blocks attempts indefinitely until explicit reconciliation.

After success, disable the workflow through Actions -> workflow menu -> Disable workflow, or set OCI_A1_PROVISIONING_ENABLED=false. Neither changes/deletes the VM. Scheduled no-ops still consume runner time; monitor private-repository Actions allowances.

## Local verification

~~~powershell
Set-Location C:\final-whistle-web
$env:PYTHONDONTWRITEBYTECODE = "1"
py -3 -m unittest discover -s scripts/oci -p "test_*.py" -v
~~~

51 mock-only tests passed locally for this proposal, including skipped/cancelled/failed intervening runs, state write/ack/read-back loss, capacity-token renewal, exact-attempt replay, retries with pending state, reconciliation authorization/evidence, existing-instance protection and unchanged resource restrictions. Python syntax and workflow YAML are checked separately. Tests prohibit real HTTP and OCI subprocess calls.

Pinned CLI 3.96.0 launch option source was inspected offline during preparation. Full Windows CLI installation hit long-path limitations; GitHub uses Ubuntu. Earlier deployed runs exercised GitHub and OCI reads; this proposal makes no live OCI calls and does not claim verified billing eligibility.

References:
- [Oracle Always Free](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
- [OCI retry tokens](https://docs.oracle.com/en-us/iaas/tools/python/latest/api/core/client/oci.core.ComputeClient.html)
- [GitHub issue updates](https://docs.github.com/en/rest/issues/issues#update-an-issue)
- [GitHub concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)

Limit identifiers and AD scope are based on [Oracle Compute Quotas](https://docs.oracle.com/en-us/iaas/Content/Quotas/Concepts/resourcequotas_topic-Compute_Quotas.htm). Invented regional limit names must not be restored. Numeric usage/headroom diagnostics contain no credentials.
