# Oracle A1 capacity automation

The workflow is deployed; runtime status is determined from Actions and the durable issue, not this document.
The configured schedule is */10 * * * * and the activation variable remains the operator-controlled gate.

Files: [workflow](../.github/workflows/oracle-a1.yml), [provisioner](../scripts/oci/provision_a1.py), [mock tests](../scripts/oci/test_provision_a1.py).

## Unchanged target and cost controls

Only eu-paris-1 / hsNq:EU-PARIS-1-AD-1 / final-whistle-servers / VM.Standard.A1.Flex / 2 OCPU / 12 GB RAM / 50 GB boot / 10 VPU balanced storage. Existing final-whistle-vcn, final-whistle-public-subnet and Internet Gateway only; official Canonical Ubuntu 24.04 aarch64 platform image. No paid shape fallback, extra volumes, network creation or application deployment.

Paris must be the ready home region. Root and target service/quota headroom must both be readable. The A1 limit IDs are standard-a1-core-count and standard-a1-memory-count (AD-scoped); Paris remains restricted to exactly the expected one AD. These are admission limits, NOT a billing entitlement.

## PR #16: service-headroom correction and explicit billing interlock

The incorrect used + available <= cap comparison has been removed. available() now validates numeric usage and remaining >= requested independently in both reported scopes and returns the two usage values. Thus used=0 / available=41 is valid service headroom, not an error or an entitlement.

A separate allocation_ceiling() rejects reported usage + requested above the policy maxima: 4 A1 OCPUs, 24 GB RAM and 200 GB combined boot/block capacity. These maxima are additional safeguards, not a claim that any particular subscription grants them for free. Passing them does not prove complete tenancy-wide inventory, remaining monthly allowance or billing classification. The requested VM remains exactly 2/12 with a 50 GB Balanced 10 VPU/GB boot volume.

**New launches remain intentionally blocked.** require_zero_cost_billing_evidence() is an explicit closed interlock; it currently always raises before the durable pending write or OCI launch. It is NOT a completed automated billing verifier. It has no environment, workflow input, estimator or rate-card override. Even service headroom of 2/12 or a root usage value of zero cannot pass it. Existing-instance detection and authorized no-launch reconciliation still operate normally. No old Work Request check is introduced.

The retry schedule, IAM/network/image checks and Issue #11 state-machine implementation are unchanged. Scheduled runs may repeat read-only preflight, but cannot launch while this interlock is closed. A real eligibility/accounting verifier needs a separately reviewed implementation before launch can be enabled; changing only the repository enable variable cannot bypass this interlock.

## Evidence reviewed on 2026-11-09

The operator-provided tenancy rate-card CSV was inspected locally and is NOT copied into Git (it contains private account metadata). Its rows list validity dates 6 November through 5 December 2026:

| SKU | Zero-price tier | Overage rate |
| --- | --- | --- |
| B93297 A1 OCPU | 3,000 OCPU-hours | CHF 0.0081 per OCPU-hour |
| B93298 A1 memory | 18,000 GB-hours | CHF 0.0012 per GB-hour |
| B91445 free block storage | CHF 0, quantity field blank | Not established by this row |

The CSV also lists paid capacity SKU B91961 and performance SKU B91962. Their presence does not prove that this proposed volume would incur a charge, just as the free SKU does not prove the whole volume is free. The validity dates are not proof of the billing-period reset date, trial-expiry timestamp or post-trial entitlement.

The dated tenancy-specific compute tiers are stronger evidence for this subscription than conflicting generic pages. [Oracle Always Free Resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) currently lists 1,500/9,000 monthly hours, while [Arm-Based Compute](https://docs.oracle.com/en-us/iaas/Content/Compute/References/arm.htm) lists 3,000/18,000. Do not replace the CSV's current-period evidence with a smaller generic tier, or extend it beyond its validity dates without renewed evidence.

Alone, 2 OCPUs/12 GB operating for a full 31-day month contribute 1,488 OCPU-hours and 8,928 GB-hours. This establishes the target's contribution only; it does not establish unused shared allowance.

[Oracle's storage documentation](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) describes a combined 200 GB home-region boot/block allowance for eligible tenancies. [Block Volume Performance](https://docs.oracle.com/en-us/iaas/Content/Block/Concepts/blockvolumeperformance.htm) identifies Balanced as 10 VPU/GB. We have not verified the subscription's free classification of this specific capacity/performance combination or how much free storage is already consumed. A Cost Estimator is a forecast, not proof of an actual charge or a zero-cost entitlement.

## Precise remaining blockers

1. **Existing and historical consumption:** complete read-only inventory and usage evidence for every consumer sharing these meters, across root and nested compartments and applicable regions/ADs. Include terminated/resized/moved consumers, stopped/provisioning/terminating resources, relevant container/bare-metal meters, reservations and retained boot/block volumes. The current target-compartment VM inventory and per-scope Limits API reads are not a complete metered-usage verifier. Missing permissions, omitted pages, unknown states or unsupported consumers must block.
2. **A conservative unreported-usage and future-usage bound:** verify the metering period/reset and total consumption, then account for the reporting gap and projected target/other-consumer use. [Cost Analysis](https://docs.oracle.com/en-us/iaas/Content/Billing/Concepts/costanalysisoverview.htm) can lag 48 hours; [Cost Reports](https://docs.oracle.com/en-us/iaas/Content/Billing/Concepts/costusagereportsoverview.htm) can lag 24 hours and receive corrections. A zero report is not proof of zero usage. A suitable bound must satisfy consumed + unreported upper bound + projected total <= the verified OCPU-hour and GB-hour tiers, not just current used + requested <= 4/24.
3. **Storage billing classification:** verify the actual 50 GB boot volume at Balanced 10 VPU/GB falls under the subscription's free capacity AND performance treatment, plus available combined home-region allocation including detached/retained volumes. Neither a blank CSV quantity nor an estimate provides that evidence.
4. **Validity and trial transition:** establish terms after 5 December or any earlier trial expiry, including remaining credits not being treated as free entitlement. An evidence-validity check must stop new launches when stale. It cannot protect an already running VM by itself; continued eligibility must be confirmed before crossing that boundary. No PAYG upgrade or billing change is authorized.
5. **Concurrency enforcement:** establish real enforcement or a conservative bound preventing unrelated provisioning/resizing from consuming the shared pool. The workflow concurrency lock protects only this automation; quotas bound concurrent allocation, not already accumulated monthly hours, and budgets are soft alerts. Do not count a reservation and its occupied instance twice.

No reliable automated verifier for these facts is implemented yet, and this proposal must not be described as ready to create a VM. The closed interlock is the fail-closed outcome, not a claim that free provisioning is impossible. Use verified tenant terms and complete accounting to replace it in a separately reviewed change. Duplicate protection and ambiguous-launch handling must remain unchanged.

## Test scope

Service-admission and allocation tests cover 41-OCPU headroom, high memory/storage headroom, both scopes, exhaustion, malformed and missing data. Full provision-path tests with the REAL billing interlock prove both small and large service limits stop without launch or state mutation; arbitrary environment flags cannot bypass it.

Existing capacity/retry/state/launch tests explicitly MOCK the closed billing interlock to exercise preserved downstream behavior. They do not prove production eligibility, and their simulated CREATED/NO_CAPACITY results must not be reported as real OCI outcomes.

The first cloud operation lists instances, then a second list immediately precedes launch. Any nonterminated Final Whistle name/tag prevents creation, including STOPPED and TERMINATING. Exactly one launch per workflow attempt; OCI automatic retries disabled. Existing resources are never changed.

## Existing cross-compartment network

The VM (and its new 50 GB boot volume) remains in final-whistle-servers. The configured public subnet and its existing VCN, route table, Internet Gateway and security lists may instead belong to the configured tenancy root. Only that root or the VM compartment is accepted; arbitrary third compartments are rejected.

Subnet ID must match OCI_SUBNET_OCID, and all existing network resources must have the expected identity/VCN association, the subnet's network compartment and AVAILABLE state. Known names remain final-whistle-public-subnet, final-whistle-vcn and final-whistle-igw. The default IPv4 route must lead to the enabled Internet Gateway. Referenced security lists are read and verified, never rewritten. Existing firewall rules are preserved; successful creation does not prove SSH/application reachability.

The API identity needs network read/use permissions in the network compartment in addition to compute/boot-volume permissions in final-whistle-servers. This is a read-only verification of existing networking; no network is moved, recreated or modified. Image identity/architecture, separate allocation restrictions and the closed billing interlock, exact sizing and all durable-state safeguards are unchanged.

## Read-only eligibility audit (PR #16)

[audit_a1.py](../scripts/oci/audit_a1.py) is a standalone evidence collector. It does not import the provisioner, call its billing interlock, access Issue #11 or perform any cloud writes. It always reports zero_cost_eligibility: UNVERIFIED. An exit code of 0 means the enumerated reads completed, NOT that free billing was established; exit 2 means missing/partial/ambiguous evidence or an operational failure.

The existing workflow now has an optional boolean workflow_dispatch input audit_only (default false). With audit_only=true the provisioning job is unconditionally excluded regardless of OCI_A1_PROVISIONING_ENABLED. The separate audit job has contents:read only, no issue-write permission and no safety-state token passed to its script. Scheduled runs retain exactly */10 * * * * and their existing provisioning enable gate. Running the audit does not enable provisioning or bypass its closed billing interlock.

After the branch is pushed, select the existing Oracle workflow, choose branch fix/oci-free-allocation-accounting, and set audit_only=true. Do not supply reconciliation inputs. The audit uses the existing OCI identity and secrets; IAM scope is not elevated or changed. It installs the already-pinned oci-cli dependency (SDK 2.190.0) and calls only the explicit read SDK allowlist. Usage API requests use HTTP POST to query summaries; they do not change billing or resources. No Work Request API is called.

Evidence collection:

- Enumerate root plus nested compartments using access_level=ANY and compartment_id_in_subtree=true, then attempt reads in each. Inspect every READY subscribed region and its ADs. Listing succeeds only for enumerable scopes; even a successful list is not a proof of full tenancy permissions. Denied compartments are recorded as partial coverage, never silently treated as empty.
- List A1 VM/bare-metal instances and boot/block volumes independently of attachments and instance lifetime. Retained and detached volumes are included in the volume lists. ATTACHED/ATTACHING/DETACHING are distinguished from UNATTACHED; failed attachment reads yield UNKNOWN. Unknown metadata is reported, not replaced with a zero-size assumption. The inventory is not a historical usage ledger or an atomic snapshot.
- Query target-region root/target service usage/headroom separately in every enumerated AD. A response of 41 available cores remains ordinary admission information and is explicitly marked not a billing entitlement.
- Query tenancy-level unfiltered USAGE and COST summaries (with a read-only USAGE_ONLY fallback if the full USAGE read is denied, keeping the denial and missing COST evidence visible) grouped by SKU, unit and region, from calendar-month start to the last completed UTC midnight. This is an explicit observation window, not a verified subscription billing/reset period. Quantities/costs are kept separate by exact unit and currency; absent rows, missing fields, negative/corrective or forecast ambiguity and permission errors never become proof of zero consumption. No remaining-free balance is calculated from delayed reports.
- Boot-volume metadata can confirm observed size and base/auto-tuned VPU settings; the official model has no property that proves future free capacity AND performance billing. Matching 50 GB/10 VPU, a free capacity SKU, existing zero-cost records and an estimator are not sufficient to classify a new volume as free. Complete storage allocation and the subscription's capacity/performance treatment remain necessary.

The JSON report hashes resource/compartment IDs and excludes names, account identifiers, subscription IDs, tags, credentials, response bodies and private keys. It records observed footprint, coverage failures, per-SKU usage/cost evidence and missing billing prerequisites. A redacted artifact oracle-a1-read-only-audit is retained seven days, including when some reads fail. No generated report is committed. Do not upload the original rate-card CSV to Git.

Pagination is explicit for every supported response and fails on repeated/missing tokens or malformed pages. Limits: 100 pages per operation, 20,000 items across the entire audit, 2,000 read calls, 200 compartments, 40 regions, 10 ADs per region, 200 cached clients, a six-minute read budget and SDK connection/read timeouts of 10/60 seconds with automatic retries disabled. Budget exhaustion is partial coverage, not approval.

For an already provisioned read-only local environment (do not put secrets into terminal history):

~~~powershell
py -3 scripts/oci/audit_a1.py --execute --output "$env:TEMP\final-whistle-oci-audit.json"
~~~

The command requires OCI_REGION, OCI_USER_OCID, OCI_TENANCY_OCID, OCI_FINGERPRINT, OCI_PRIVATE_KEY and OCI_COMPARTMENT_OCID from a privately prepared process environment. It refuses to overwrite an existing report. No local OCI configuration was available during preparation, so live verification uses the isolated audit-only workflow if GitHub permits branch dispatch.

Tests explicitly prohibit real HTTP/subprocess calls. They cover nested scopes/regions/ADs, unattached volume enumeration, partial permissions, missing metadata, later-page failures, repeated tokens, budgets, ambiguous/zero billing and workflow job exclusivity. The production billing interlock and downstream state-machine tests are unchanged.

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

75 mock-only tests passed locally for this proposal, including skipped/cancelled/failed intervening runs, state write/ack/read-back loss, capacity-token renewal, exact-attempt replay, retries with pending state, reconciliation authorization/evidence, existing-instance protection and unchanged resource restrictions. Python syntax and workflow YAML are checked separately. Tests prohibit real HTTP and OCI subprocess calls.

Pinned CLI 3.96.0 launch option source was inspected offline during preparation. Full Windows CLI installation hit long-path limitations; GitHub uses Ubuntu. Earlier deployed runs exercised GitHub and OCI reads; this proposal makes no live OCI calls and does not claim verified billing eligibility.

References:
- [Oracle Always Free](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
- [OCI retry tokens](https://docs.oracle.com/en-us/iaas/tools/python/latest/api/core/client/oci.core.ComputeClient.html)
- [GitHub issue updates](https://docs.github.com/en/rest/issues/issues#update-an-issue)
- [GitHub concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)

Limit identifiers and AD scope are based on [Oracle Compute Quotas](https://docs.oracle.com/en-us/iaas/Content/Quotas/Concepts/resourcequotas_topic-Compute_Quotas.htm). Invented regional limit names must not be restored. Numeric usage/headroom diagnostics contain no credentials.

### Live read-only verification, 2026-11-09

[Audit run 42558281901](https://github.com/temofutkaradze/final-whistle-web/actions/runs/42558281901) executed from the PR branch; the provisioning job was SKIPPED and no state-write permission was granted to the audit job. All 74 tests at that revision passed in the runner. The redacted JSON was successfully [preserved as an artifact](https://github.com/temofutkaradze/final-whistle-web/actions/runs/42558281901/artifacts/13648835032).

Confirmed: Paris is the home region; two compartments (root and target) and one subscribed region/AD were enumerated; no A1 instance was returned by their instance lists. Root and target service reads each reported used=0, available=41 OCPUs / 277 GB memory / 30,720 GB storage. These are service limits, not remaining free allowance.

Incomplete evidence: all eight volume/attachment reads in root and target, plus USAGE and COST queries, returned NotAuthorizedOrNotFound. Thus the empty volume/billing arrays and observed footprint zeroes are NOT evidence of no volumes or no historical usage. The audit exits 2 and labels inventory PARTIAL. Oracle's official API endpoints include Paris for Usage; the query uses documented SKU/unit/region grouping and calendar-day bounds, so changing to an arbitrary region or treating these denials as empty data is inappropriate. The USAGE_ONLY fallback is probed separately when available.

An OCI administrator must review existing API-user group access; this proposal makes no IAM changes. The documented read-only permissions needed for the denied operations are VOLUME_INSPECT, VOLUME_ATTACHMENT_INSPECT and INSTANCE_INSPECT in each audited scope, and USAGE_REPORT_READ at tenancy level for full cost/usage queries. Existing successful instance reads already provide instance visibility in the enumerated scopes. If only USAGE_ANALYSIS_READ is granted, USAGE_ONLY can provide quantity evidence but cannot replace the missing COST read.

Example policy statements for the actual API-user group, ONLY if separately approved by the operator:

~~~text
Allow group <OCI_API_GROUP> to inspect volumes in tenancy
Allow group <OCI_API_GROUP> to inspect volume-attachments in tenancy
Allow group <OCI_API_GROUP> to read usage-report in tenancy
~~~

Verify INSTANCE_INSPECT is already covered in the same scopes. Do not request manage permissions or billing upgrades for this audit. See [Oracle Core API permissions](https://docs.oracle.com/en-us/iaas/Content/Identity/policyreference/corepolicyreference_topic-Permissions_Required_for_Each_API_Operation.htm) and [Cost Analysis IAM/query types](https://docs.oracle.com/en-us/iaas/Content/Billing/Concepts/costanalysisoverview.htm).
