# Oracle A1 capacity automation

The workflow is deployed; runtime status is determined from Actions and the durable issue, not this document.
The configured schedule is */10 * * * * and the activation variable remains the operator-controlled gate.

Files: [workflow](../.github/workflows/oracle-a1.yml), [provisioner](../scripts/oci/provision_a1.py), [mock tests](../scripts/oci/test_provision_a1.py).

## Unchanged target and cost controls

Only eu-paris-1 / hsNq:EU-PARIS-1-AD-1 / final-whistle-servers / VM.Standard.A1.Flex / 2 OCPU / 12 GB RAM / 50 GB boot / 10 VPU balanced storage. Existing final-whistle-vcn, final-whistle-public-subnet and Internet Gateway only; official Canonical Ubuntu 24.04 aarch64 platform image. No paid shape fallback, extra volumes, network creation or application deployment.

Paris must be the ready home region. Root and target service/quota headroom must both be readable. The A1 limit IDs are standard-a1-core-count and standard-a1-memory-count (AD-scoped); Paris remains restricted to exactly the expected one AD. These are admission limits, NOT a billing entitlement.

## PR #16: service-headroom correction and explicit billing interlock

The incorrect used + available <= cap comparison has been removed. available() now validates numeric usage and remaining >= requested independently in both reported scopes and returns the two usage values. Thus used=0 / available=41 is valid service headroom, not an error or an entitlement.

A separate allocation_ceiling() now rejects reported usage + requested above the conservative current Free Tier policy maxima: **2 A1 OCPUs, 12 GB RAM and 200 GB combined boot/block capacity**. This supersedes the earlier PR #16 4/24 guard. These maxima are additional safeguards, not a claim that any particular subscription grants them for free. Passing them does not prove complete tenancy-wide inventory, remaining monthly allowance or billing classification. The requested VM remains exactly 2/12 with a 50 GB Balanced 10 VPU/GB boot volume.

**New launches remain intentionally blocked.** `require_free_tier_launch_safety()` replaces the opaque interlock with read-only subscription/inventory/quota and exact-payload assessment. The unresolved billing requirements still block before the durable pending write or OCI launch. It is NOT a completed automated billing verifier. It has no environment, workflow input, estimator or rate-card override. Even service headroom of 2/12 or a root usage value of zero cannot pass it. Existing-instance detection and authorized no-launch reconciliation still operate normally. No old Work Request check is introduced.

The retry schedule, IAM/network/image checks and Issue #11 state-machine implementation are unchanged. Scheduled runs may repeat read-only preflight, but cannot launch while this interlock is closed. A complete eligibility/accounting verifier still needs a separately reviewed implementation before launch can be enabled; changing only the repository enable variable cannot bypass this interlock.

## Evidence reviewed on 2026-11-09

The operator-provided tenancy rate-card CSV was inspected locally and is NOT copied into Git (it contains private account metadata). Its rows list validity dates 6 November through 5 December 2026:

| SKU | Zero-price tier | Overage rate |
| --- | --- | --- |
| B93297 A1 OCPU | 3,000 OCPU-hours | CHF 0.0081 per OCPU-hour |
| B93298 A1 memory | 18,000 GB-hours | CHF 0.0012 per GB-hour |
| B91445 free block storage | CHF 0, quantity field blank | Not established by this row |

The CSV also lists paid capacity SKU B91961 and performance SKU B91962. Their presence does not prove that this proposed volume would incur a charge, just as the free SKU does not prove the whole volume is free. The validity dates are not proof of the billing-period reset date, trial-expiry timestamp or post-trial entitlement.

The dated tenancy-specific compute tiers are stronger evidence for this subscription than conflicting generic pages. [Oracle Always Free Resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) currently lists 1,500/9,000 monthly hours, while [Arm-Based Compute](https://docs.oracle.com/en-us/iaas/Content/Compute/References/arm.htm) lists 3,000/18,000. The dated CSV remains current-period pricing evidence only. The new allocation guard deliberately uses the smaller **2/12** Free Tier-specific envelope; it does not reinterpret the CSV or extend its validity. Neither source proves unused monthly entitlement.

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
- Query tenancy-level unfiltered USAGE, USAGE_ONLY and COST summaries explicitly on every audit, recording API access separately from empty or missing usage data grouped by SKU, unit and region, from calendar-month start to the last completed UTC midnight. This is an explicit observation window, not a verified subscription billing/reset period. Quantities/costs are kept separate by exact unit and currency; absent rows, missing fields, negative/corrective or forecast ambiguity and permission errors never become proof of zero consumption. No remaining-free balance is calculated from delayed reports.
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
6. **Do not enable provisioning with this proposal.** Only after the unresolved billing/evidence requirements below have a separately reviewed solution and explicit activation approval may the operator set OCI_A1_PROVISIONING_ENABLED=true. Missing/false skips the job before any runner/OCI call; Python checks it again. OCI_A1_RETRY_GENERATION and the old resume_after_review input are obsolete and no longer used.
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

76 mock-only tests passed locally for this proposal, including skipped/cancelled/failed intervening runs, state write/ack/read-back loss, capacity-token renewal, exact-attempt replay, retries with pending state, reconciliation authorization/evidence, existing-instance protection and unchanged resource restrictions. Python syntax and workflow YAML are checked separately. Tests prohibit real HTTP and OCI subprocess calls.

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

### Rerun after read-only IAM additions

[Run 42632668335](https://github.com/temofutkaradze/final-whistle-web/actions/runs/42632668335) on 2026-11-09 confirmed that root/target volume and attachment reads now succeed. No A1 instances, boot volumes, block volumes or unattached volumes were returned. Observed allocated storage is 0 GB in those enumerated scopes; the planned 50 GB would be below the 200 GB capacity maximum. This is not evidence of performance-charge exemption or complete historical consumption.

USAGE and COST both succeeded but returned no rows for 1 November through 9 November 00:00 UTC. The old fallback-only USAGE_ONLY path was therefore not exercised. The audit now explicitly probes all three query types and distinguishes READ_SUCCEEDED with no rows from READ_FAILED. Empty billing data remains unknown monthly consumption, not a zero balance. No billing interlock, provisioning logic, IAM policy or cloud resource was changed by this adjustment.


## Free Tier evidence preparation (2026-11-10) ? NOT READY TO ENABLE

The attached deep-research report was read and critical claims checked against
current official Oracle documentation. Its suggested account-plan gate is useful,
but its Proposition B is a **narrower policy**, not proof that monthly entitlement
is unused or that the prospective Balanced performance component is zero-rated.
We did not silently substitute that weaker contract for the requested strict gate.
No `OCI_A1_EXPECTED_PLAN_TYPE` operator flag is needed: a configured assertion
cannot replace the plan returned by Oracle.

### Implemented checks

- [Read-only audit](../scripts/oci/audit_a1.py) calls OSP Gateway
  `list_subscriptions(osp_home_region="eu-paris-1", compartment_id=tenancy)` with
  explicit bounded pagination, then `get_subscription` for the unique returned
  identity. Both must report `FREE_TIER`, with matching IDs, no recorded upgrade
  date and no ambiguous/in-progress upgrade state. PAYG, unknown values, conflicts,
  missing detail, permission denial and malformed pagination fail closed.
  The list response is **SubscriptionCollection.items**, not a bare list.
- Subscription payment/address data and IDs never enter the redacted report or
  logs. Only `plan_type` and verification boolean are exported. Existing SDK
  allowlisting, TLS verification, read budgets and no automatic retries remain.
- The root plus full compartment subtree (`ANY`, subtree=true), all subscribed
  regions and each returned AD are inventoried using the existing bounded reader.
  The intended target must appear in the subtree. Inaccessible/partial reads,
  unknown allocations and retained/unattached volume sizes never count as zero.
- [Safety assessment](../scripts/oci/free_tier_safety.py) checks observed A1
  allocations + target against **2 OCPU / 12 GB**, and retained home-region
  boot+block allocations + 50 against **200 GB**. It checks root/target quota
  headroom separately; 41 available OCPUs is valid headroom, not free entitlement.
- The entire payload must equal the fixed 2/12/50/10, A1, Paris AD, existing subnet,
  Ubuntu image ID, public-IP, SSH metadata and tags payload. Extra launch options
  or booleans substituted for numeric dimensions fail validation. Existing image,
  network, IAM and service-limit checks remain in the provisioner.
- Every unresolved evidence failure stops before Issue #11 pending writes or OCI
  launch. The assessment deliberately always returns launch_authorized=false
  while the requirements below lack a trustworthy verifier. Mocked downstream
  state-machine tests do not claim a live successful eligibility decision.

### Exact unresolved requirements

1. Authoritative **prospective capacity AND 10 VPU/GB performance** free treatment
   for this subscription. Oracle documents the default 50 GB volume and 200 GB
   capacity allowance, and Balanced=10, but separately describes VPUs as purchased
   performance. Neither resource metadata nor the supplied free-capacity SKU
   establishes the future performance SKU exemption.
2. A verified billing-period/reset, current entitlement validity and conservative
   bound for delayed/unreported monthly A1 usage (including deleted resources).
   The current calendar-month Usage/Cost audit is retrospective. Empty or zero
   records do not prove unused entitlement. Full-month target contribution is
   1,488 OCPU-hours / 8,928 GB-hours at 31 days; prior usage may consume the rest.
3. Successful full-scope reads plus an enforceable or conservative treatment of
   unrelated concurrent allocations and subscription changes. Inventory is not
   an atomic snapshot or a cloud-wide allocation lock. GitHub concurrency and
   Issue #11 protect this workflow only.

The first two cannot presently be certified by the available resource/limits/
usage responses. Therefore **this is evidence preparation, not a ready-to-enable
provisioner**. Oracle Support can clarify the exact capacity/performance terms
and applicable billing period; those facts then need a reviewed verification/
enforcement design. Do not create a variable, checkbox, synthetic report flag or
issue reset to bypass them. If Oracle cannot provide suitable evidence, the
safe alternative is to leave automation disabled and use the existing read-only
audit; a manually reviewed Console launch would require separate authorization
and still must not be represented as proven free by this script.

### IAM, configuration and operator checks

All nine existing required secret names were found through GitHub metadata;
values were not retrieved. The observed variable is
`OCI_A1_PROVISIONING_ENABLED=false`, state issue variable is `11`; the issue is
open with the expected title, status ready, revision 0. No setting/state changed.
No OCI calls or workflow dispatch were performed during this preparation.

The API identity needs root/subtree compartment/region/AD inspection and instance,
volume/attachment, Limits and Usage reads in **every** inventoried scope, plus OSP
subscription list/get reads. Existing launch/network permissions remain necessary
only for a future authorized launch. OSP access has not been live verified; an
administrator must check the applicable subscription-service IAM support for this
identity, rather than granting broad billing/payment/update privileges. No policy
changes, new secrets, upgrade, or payment operations are implemented here.

The workflow remains unchanged: exact `*/10 * * * *`, absent/false enable gate,
contents:read + issues:write only for provisioning, read-only audit job, shared
non-cancelling concurrency. Confirmed capacity rejection still releases the
attempt with a fresh next-run token. A preflight 429/5xx changes no state and may
be checked on the next schedule; a launch 429/5xx without a confirmed capacity
rejection stays pending and blocks new launches until the existing authorized
reconciliation procedure. Successful creation still records created and skips
subsequent launches. No old Work Request check was added.

### Validation and references

**90 mock-only tests passed**, with Python AST syntax and workflow YAML/schedule/permission assertions also passing. Tests cover plan detail/list conflicts, upgrade states, pagination,
permissions, exact payload mutations, 2/12 and 200 GB boundaries, retained volumes,
quota vs pricing, unavailable evidence, rate limits and ambiguous launches. The
existing capacity-retry, completed-launch, duplicate and durable-state suites
remain. No actual launch or zero-cost eligibility is claimed by passing tests.

- [Current Free Tier envelope and storage](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
- [Conflicting general A1 monthly allowance](https://docs.oracle.com/en-us/iaas/Content/Compute/References/arm.htm)
- [Subscription plan values](https://docs.oracle.com/en-us/iaas/tools/python/latest/api/osp_gateway/models/oci.osp_gateway.models.Subscription.html)
- [Subscription read API](https://docs.oracle.com/en-us/iaas/tools/python/latest/api/osp_gateway/client/oci.osp_gateway.SubscriptionServiceClient.html)
- [Balanced default and VPU pricing distinction](https://docs.oracle.com/en-us/iaas/Content/Block/Concepts/blockvolumeperformance.htm)
- [Full compartment subtree parameters](https://docs.oracle.com/en-us/iaas/tools/oci-cli/latest/oci_cli_docs/cmdref/iam/compartment/list.html)


## Complete read-only activation audit (PR after #23)

PR #23 was confirmed merged into main at `0e559b9`. Work continues from that
revision without modifying the original dirty Windows checkout.

Manual Actions dispatch with **audit_only=true** now runs
[audit_activation.py](../scripts/oci/audit_activation.py). It reuses the shared
read-only target validator from the provisioner, through an SDK-only allowlisted
adapter. There is no OCI CLI subprocess or call to `provision()` in this path.
The adapter rejects launch/update/delete operations and unknown parameters before
transport, and the SDK backend independently restricts operation names to reads.
The only POST is the existing Usage API query, not a resource creation.

The audit job has `contents:read` and **issues:read**, never issues:write. Its Issue
reader admits only GET of the configured issue and rejects other methods/paths;
it does not call pending/reconciliation/state-save code. Existing credentials are
reused; subscription/payment bodies, key material, SSH keys and raw OCI errors
are never exported. Root/compartment/resource IDs remain hashed in the artifact.

The redacted report and Actions summary give PASS/BLOCKED for configuration,
FREE_TIER subscription, home region, compartment, network associations/routing,
Ubuntu 24.04 ARM64 image and A1 compatibility, quotas, inventory, observed A1 and
retained-storage allocations, three usage/cost API access checks, monthly
entitlement, Balanced pricing, external-allocation enforcement and duplicate
state. PASS for API access or current footprint is explicitly NOT billing approval.
Skipped downstream target checks remain BLOCKED, never fabricated PASS.

The artifact remains `oracle-a1-read-only-audit`, retained seven days. A successful
collection can have a green step while activation is BLOCKED; permission/read/
validation failures fail the step but still preserve the report. The launch gate
remains closed. No enabled variable, Issue schema, retry behavior or cron changes
are needed. Audit-only dispatch excludes provisioning even if a repository
operator later changes the enable variable. Scheduled provisioning retains its
existing false/absent gate and shared non-cancelling concurrency.

### Live evidence before this enhancement

[Read-only run 42701886705](https://github.com/temofutkaradze/final-whistle-web/actions/runs/42701886705)
ran against main with audit_only=true. Provisioning was SKIPPED. The artifact
confirmed Paris as home region; root and target resource lists returned no A1
instances or retained boot/block volumes. Root/target headroom was 41 OCPUs,
277 GB memory and 30,720 GB storage, all with used=0. These are admission limits,
not free entitlements. USAGE, USAGE_ONLY and COST all read successfully but
returned no rows for November 1 through November 9 00:00 UTC; unused monthly
allowance remains unverified. OSP list_subscriptions returned
NotAuthorizedOrNotFound, so FREE_TIER account type was NOT verified.

A reporting defect was found: subscription-read errors were included in the
inventory-error count and made successful resource enumeration appear PARTIAL.
This is corrected by counting only errors added during inventory. The subscription
failure still blocks overall activation and fails the audit; no permission check
or pricing requirement is relaxed.

### Required operator actions ? not performed here

1. Have the OCI tenancy administrator resolve the OSP subscription list/get
   NotAuthorizedOrNotFound response for the actual API-user group and root
   tenancy. Confirm whether this account supports the OSP interface. Oracle's
   [Billing Tools permissions](https://docs.oracle.com/en-us/iaas/Content/Billing/Concepts/billingtoolsoverview.htm)
   document subscription-related reads; do not assume Usage API access grants
   OSP access or grant account/payment management just to silence a denial.
   Validate the precise supported read policy with Oracle if needed.
2. Obtain written Oracle confirmation applicable to this tenancy and current
   terms for free **capacity AND 10 VPU/GB boot performance**, including post-trial
   treatment. The [performance documentation](https://docs.oracle.com/en-us/iaas/Content/Block/Concepts/blockvolumeperformance.htm)
   describes VPUs separately from capacity. Its zero-VPU Lower Cost tier is for
   block volumes, **not boot volumes**; changing boot VPU to zero is not a valid
   workaround for the requested configuration.
3. Establish billing reset/remaining A1 consumption and a conservative reporting-
   gap bound, plus externally enforced or conservatively bounded shared resource
   allocation. Empty/zero usage and one inventory snapshot cannot establish these.
4. Review this PR and the sanitized live audit before separately approving merge
   and any eventual activation. Keep OCI_A1_PROVISIONING_ENABLED=false and Issue
   #11 unchanged. There is no reset/attestation override for billing evidence.

Local validation for the complete activation-audit change: **99 mock-only tests
passed**, Python AST syntax passed, workflow YAML and cron/permission/concurrency
assertions passed. No application test/build, production service or cloud write
was needed.


### Enhanced live audit verified on the PR branch

[Run 42703019928](https://github.com/temofutkaradze/final-whistle-web/actions/runs/42703019928)
executed the new SDK-only audit from `feat/oci-read-only-activation-audit` at
`3888014`. The audit's 99 mocked regression tests passed in GitHub; the ordinary
PR CI `check` also passed. The provision job was SKIPPED. The enhanced JSON
artifact and per-requirement Actions summary were produced successfully.

PASS: environment structure, Paris home region, target compartment, existing
public network/routing/security-list associations, Canonical Ubuntu 24.04 ARM64
image, flexible A1 compatibility, service/quota checks, enumerated resource reads,
exact fixed launch payload, observed A1/storage envelopes, all three Usage/Cost
API access checks and duplicate safety state. No matching VM or A1 allocation was
returned, retained home-region boot/block allocations totalled 0 GB, and Issue #11
remained ready at revision 0.

BLOCKED: OSP account plan (NotAuthorizedOrNotFound on list_subscriptions), remaining
monthly entitlement (all three APIs return no rows), prospective Balanced VPU
free treatment and external-allocation enforcement. The audit step/run correctly
failed for required missing evidence; that is not proof of a provisioning/software
failure or a green eligibility result. No LaunchInstance or Issue write was made.
The observed enable variable remains false. A merge of this audit enhancement
would not enable provisioning or resolve the listed billing prerequisites.


## Exact remaining control setup ? November 10 review

The new research report was read before changes. PRs #23/#24 are merged; this
work starts from main `1f6882f`. No cloud policy, secret, billing setting, Issue
state or enable variable is changed by these repository edits.

### Minimum OSP permission and exact Console steps

Oracle's [Subscriptions IAM reference](https://docs.oracle.com/en-us/iaas/Content/Identity/policyreference/subsinvoicepaymenthistoryreference.htm)
explicitly maps **both ListSubscriptions and GetSubscription** to
`SUBSCRIPTION_INFO_READ`, provided by `read subscription`. `inspect` grants none
for this resource. This is separate from Usage/Cost report access.

An OCI tenancy administrator performs these steps (not executed by this PR):

1. Identity & Security -> Domains -> the API user's identity domain -> Users.
   Locate the existing user corresponding to the private `OCI_USER_OCID` secret;
   verify which existing group contains that user. Do not create/rotate a key or
   add it to Administrators. Open that group and copy its group OCID privately.
   For legacy IAM, use Identity & Security -> Groups instead.
2. Identity & Security -> Policies. Select the **tenancy root compartment**.
3. Create Policy named `final-whistle-subscription-read`; use a non-sensitive
   description. Select the manual policy editor and add exactly this statement,
   replacing only the group placeholder with the real group OCID:

   ```text
   Allow group id <EXISTING_API_GROUP_OCID> to read subscription in tenancy
   ```

4. Create the policy, wait for IAM propagation, then dispatch the existing Oracle
   workflow with `audit_only=true`. Keep provisioning disabled. Require consistent
   `FREE_TIER` from list AND detail; unknown/PAYG/upgrading/multiple results block.
5. If NotAuthorizedOrNotFound persists, verify the same user/group, root tenancy
   and OSP interface/account support with Oracle Support. This error alone does
   not prove which IAM grant is missing. Do not widen to manage billing/accounts,
   invoices, payments, rate cards or all-resources to suppress it.

The [group OCID syntax](https://docs.oracle.com/en-us/iaas/Content/Identity/Concepts/policysyntax.htm)
avoids guessing the user's identity-domain/group name. Subscription resource is
singular (`subscription`), not Notifications `ons-subscriptions`.

### Enforced allocation envelope, not a snapshot lock

[allocation_controls.py](../scripts/oci/allocation_controls.py) recognizes one
strict, root-scoped, ACTIVE quota policy named
`final-whistle-free-tier-envelope`. It requires matching List/Get identities,
exact ordered statements (no extras, unset overrides, relaxed caps, child-only
scope or alternate AD/region), plus effective quota values at root AND target
for the exact Paris AD: CPU <=2, RAM <=12 and storage <=200.
Missing/unsupported effective-quota metadata fails closed even when available
service headroom is 41 OCPUs. This is a verifier, not a quota/IAM writer.

**Separate administrator review/approval required:** the following policy is
TENANCY-WIDE and prevents A1 and new boot/block capacity outside the allowed AD,
including unrelated provisioning. It does not delete existing resources or undo
historical usage. Do not apply blindly if the tenancy is shared.

After approval, Billing & Cost Management -> Limits, Quotas and Usage -> Quota
Policies (or search Console for Quota Policies). Select the root compartment,
Create Quota Policy with the exact name above, and paste these six statements in
this order into ONE policy:

```text
zero compute-core quotas /standard-a1-*/ in tenancy
set compute-core quota standard-a1-core-count to 2 in tenancy where request.ad = 'hsNq:EU-PARIS-1-AD-1'
zero compute-memory quotas /standard-a1-*/ in tenancy
set compute-memory quota standard-a1-memory-count to 12 in tenancy where request.ad = 'hsNq:EU-PARIS-1-AD-1'
zero block-storage quota total-storage-gb in tenancy
set block-storage quota total-storage-gb to 200 in tenancy where request.ad = 'hsNq:EU-PARIS-1-AD-1'
```

Also grant the existing audit group **read-only quota inspection**, if absent:

```text
Allow group id <EXISTING_API_GROUP_OCID> to read quotas in tenancy
```

The automation principal must NOT be able to create/update/delete quotas or
remove enforcement. Restrict its existing launch permissions to the target
compartment/network and keep unrelated automation from using its credentials.
Administrator/root control remains trusted: no software can prevent a tenancy
administrator from removing a quota or upgrading the account. Do not claim this
as protection against a malicious administrator or a permanent billing lock.

Oracle documents [root/child usage, statement precedence and region/AD syntax](https://docs.oracle.com/en-us/iaas/Content/Quotas/Concepts/quota_policy_syntax.htm),
[ordered zero/set allowlists](https://docs.oracle.com/en-us/iaas/Content/Quotas/Concepts/sample_quotas.htm),
[shared A1 compute/container counters](https://docs.oracle.com/en-us/iaas/Content/Quotas/Concepts/resourcequotas_topic-Compute_Quotas.htm),
[boot+block storage quota](https://docs.oracle.com/en-us/iaas/Content/Quotas/Concepts/resourcequotas_topic-Block_Volume_Quotas.htm)
and [quota read permissions](https://docs.oracle.com/en-us/iaas/Content/Identity/Reference/quotaspolicyreference.htm).
Quota enforcement constrains concurrent allocation; it does NOT reserve an OCI
instance, prove a monthly balance or classify performance charges. After manual
setup, rerun the audit to verify API acceptance, ACTIVE policy and effective
values; until that live verification succeeds the control is BLOCKED.

### Conservative monthly gate and a discovered evidence limitation

[monthly_entitlement.py](../scripts/oci/monthly_entitlement.py) validates explicit
UTC current-calendar-month intervals, known SKU/unit pairs and finite quantities,
selects ONE usage query source (never doubles USAGE + USAGE_ONLY + COST), and
compares reported consumption + the fixed VM's remaining-month projection with
1,500 OCPU-hours / 9,000 GB-hours. Exhaustion, missing rows, unknown units,
malformed/negative values and invalid intervals reject. The report includes
observed quantities and an explicitly unknown unreported-usage bound.

**This is a necessary rejection gate, not a complete positive authorization.**
A correct billing reset/period, authoritative rate validity and an upper bound
for delayed/missing consumption are still required. Positive or zero rows and a
new quota cannot prove these. The pinned Oracle SDK's `Quota` model has
`time_created`, but NO `time_updated`/modification history. Therefore neither an
old creation date nor current quota values can prove month-long enforcement;
we do not fabricate such a history. A separately verified complete Oracle audit
history or account-applicable authoritative meter is required before using a
historical allocation bound. No manual boolean/report/env override is added.

### Balanced 10 VPU finding and report qualification

Oracle's [Free Tier storage allowance](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
clearly covers capacity, and [Block Volume performance](https://docs.oracle.com/en-us/iaas/Content/Block/Concepts/blockvolumeperformance.htm)
defines the default boot performance as Balanced, 10 VPU/GB. The latest
[first-instance tutorial](https://docs.oracle.com/en-us/iaas/Content/Compute/tutorials/first-linux-instance/overview.htm)
also lists 50 GB/Balanced, but that explicit table is in **section 5, optional
Block Volume**, not a tenancy-specific guarantee for the requested boot-volume
performance SKU. This qualifies the report's characterization of that example.
The tutorial is supporting product context, not a prospective billing decision.
Zero-VPU Lower Cost is unavailable for boot volumes. Neither this repository nor
the report supplies account-specific performance treatment or post-trial terms.
Keep this gate BLOCKED until Oracle provides current applicable evidence and a
reviewed verifier consumes it; do not replace it with an attestation checkbox.

### Activation checklist ? no activation authorized here

- [ ] Minimum subscription-read policy applied by an authorized administrator;
      fresh list+detail both FREE_TIER, no upgrade/conflict.
- [ ] Root quota policy and effective values live-verified; API principal cannot
      relax quotas; administrator agrees to preserve the enforcement.
- [ ] Complete current inventory/limits/network/image checks PASS, exact target
      remains Paris A1 / 2 OCPU / 12 GB / Ubuntu ARM64 / 50 GB / 10 VPU.
- [ ] Oracle-applicable billing period/rates and conservative missing-usage bound
      established, including deleted resources; monthly gate reviewed to permit
      a positive decision only from that authoritative evidence.
- [ ] Free capacity AND Balanced performance treatment established for this
      tenancy/current and post-trial terms; reviewed verifier implemented.
- [ ] Full mocked safety suite and read-only audit all mandatory checks PASS.
- [ ] Issue #11 ready/capacity_rejected, no matching VM or unresolved launch;
      retain pending/created protections and existing retry identity rules.
- [ ] PR independently reviewed/merged only with separate approval; run fresh
      main audit after merge; then obtain separate explicit activation approval.
- [ ] Only AFTER that approval change enable variable; never use this checklist
      as permission to upgrade, launch, change secrets or alter Issue #11.

Current work preserves the cron and hard billing gate. External enforcement can
become PASS from exact authoritative quota reads; monthly/billing remain BLOCKED
where evidence is missing. No cloud or IAM policy has been applied by this PR.


Quota syntax note: the prepared policy uses the documented **single request.ad**
condition with the complete tenancy-specific Paris AD name, rather than assuming
an undocumented boolean-AND quota grammar. The preceding global zero leaves no
allowance in other ADs/regions; target preflight independently verifies that this
exact AD belongs to the ready Paris home region. Console acceptance and effective
quota reads remain mandatory before any enforcement claim for the real tenancy.
