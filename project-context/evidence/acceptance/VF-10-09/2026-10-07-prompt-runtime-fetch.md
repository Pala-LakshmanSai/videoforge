# Prompt transport Cloudflare receiver failure

Checkpoint V2-09 / VF-10-09. The user requests a careful repeated-failure audit,
parallel agents, production repair and complete-stage verification under USD2.

## Proven cause

The fresh gardening project passed Stage4 input binding and committed its first
batch claim. The run failed 36ms after that claim with
`HOSTED_PROMPT_EXECUTION_UNKNOWN`. Original request hash:
`sha256:614a1a8422647a97f3d17d5123bd8c111aed1c4b4893fc3a4e95fe07260cde80`.
The claim uses current Luna v39/profile9, with34 scenes in4 planned batches.

The new transport retained global `fetch` as a class property and invoked it as
`this.fetcher(...)`. Cloudflare's native function rejects that receiver before
any outbound request. Its catch correctly fenced a possible network failure but
therefore surfaced the local programming error as an uncertain provider outcome.

Two independent reproductions bundled actual source in local workerd with the
original sealed request and a fully intercepted outbound service. Unchanged
source produced `post_outcome_unknown` with0 outbound calls. The fixed source
reached the local service exactly once. A success response passed accounting;
an independent HTTP400 response became the expected typed provider rejection.
No production inference was used for this causal proof.

## Repair and prevention

Invoke the captured function through a local variable, matching the already
qualified sibling Runware/RunPod transports. Preserve request bytes, model,
budgets, response validation, unknown-outcome fencing and stored identities.

The unit regression uses a receiver-sensitive global function. The permanent
`scripts/tests/runware-luna-worker-transport.test.mjs` bundles real production
source in Cloudflare workerd with its native default fetch and intercepts all
outbound traffic. It verifies successful dispatch, strict request settings,
settled accounting, invalid-usage fencing and no automatic repeated POST. It
runs in existing script CI and before the Cloudflare browser suite, with no new
dependency. Prior Node mocks did not enforce this platform calling convention.

The other agents audited native claims, runtime permissions, receipt recovery,
Workflow lifetime and active sibling transports. No evidence supports a four-
second provider timeout, batch-plan mismatch or malformed sealed request here.
Historical log retrieval is unavailable to the configured telemetry credential;
the original persisted claim plus deterministic runtime reproduction supplies
the causal evidence. Do not claim an original network trace was retrieved.

## Production receipt and correction audit

Executable fe30cba1481329b6cc0b017211518a40bf7ab855 merged the concurrent pricing
release24b89c50, passed608 focused Web tests plus real workerd tests, types,
lint/build/firewall/context/secrets checks, and deployed as Worker
6eac76b7-137c-4cfe-8e3d-256eeee2ba42 at100percent. All36public assets matched;
55bindings,27secret names, existing Workflow IDs and Cloud/Desktop pins survived.
The existing idle continuation singleton adopted version3139ccdc-e5b8-4d99-9d5e-7dfc1c452470.

The exact original first claim was recovered once under the user's USD2 cap.
Its response was saved privately before an idempotent native receipt write.
The native commit succeeded even though the private psql wrapper then failed
parsing boolean text `t`; read-only full-result/hash reconciliation proved the
receipt. No second POST occurred. Production accepted10scenes, cost1464microUSD.

The production Worker then submitted the next batch itself and saved a complete
provider response:8scenes,4973input/1479output tokens,1362microUSD estimate. This
proves the real native-fetch path now works. Three returned scenes exceeded
v39 literal character limits;5passed. Offline receipt replay reproduced that
specific quality failure with zero new HTTP requests.

The bounded correction exposed a second programming defect: its system-prompt
literal-budget table used only3failed scenes while the original sealed system
prompt contained all8. Native content-repair validation correctly forbids changing
that immutable envelope. Exact read-only native checks showed the receipt-grounded
scene-correction helper passed but outer content-repair matching failed. Deep
structural comparison ruled out a schema change; an earlier string comparison
only reflected JSON key order. Later native migrations already support the
literal-character reason, so no database migration or relaxed validator is needed.

Keep the original full-batch budget table in correction system instructions,
as already done for schema/token settings; the correction user payload still
contains only failed scenes and exact original evidence. Add regression proof
through the effective native matcher. Known, durably saved quality failures
should remain running during bounded correction instead of displaying a generic
unknown provider outcome; ensure receipt-based continuation has no15minute gap.
Transport ambiguity and failed durable writes retain their no-replay boundary.

## Full-route regressions found by the audit

A replacement's repair policy is sealed in its task UUID but Luna intentionally
omits historical repair suffixes from system instructions. Recovery previously
inferred policy from that missing suffix, rebuilt the wrong UUID and rejected
its own saved correction. Select among the bounded historical policy candidates
using byte-exact sealed request equality; keep UUID, hash and source receipt checks.

A real default-style completion fixture also exposed a legacy scalar character
limit injected during authority reconstruction. V39 owns per-scene limits;
validate its plan without that obsolete scalar while retaining v38 checks.

One-batch projects reserved250000microUSD, yet correction admission required
250000remaining after paying the original. Any nonzero original cost made that
impossible. Migration288 and the TypeScript helper use a500000minimum for fresh
runs only. Tests prove a paid original can admit its bounded correction and a
historical250000reservation cannot expand. No existing paid row is rewritten.

## Qualification and open acceptance

- Original transport qualification:608 focused Web tests, actual workerd tests,
 Web/Worker types, lint/format, both builds, firewall/context and secret scan pass.
- Canonical aggregate remains non-green on116 inherited formatting files and
 Python lint. This is not a full repository-green claim.
- Known new provider receipt estimates total2826microUSD so far. The fixed
 finite-action allowance is1.304158USD, below the approved2USD total; invoice
 accounting remains distinct from pinned-rate estimates.
- Current original ASR rental is CLEAN. The older paused project is untouched.
- Correction regression, final candidate release, complete34scene production
 acceptance, Chrome and downstream film/cleanup checks are still in progress.

## Production Stage4 acceptance

Final executable8d5fea19bd9750cd40f7cb5e8842ccb5b93aa1b8 is published at100percent
as Worker5553bfdb-fef8-4cfd-ab60-848c1abd8ccb. Additive native288 committed after
rollback rehearsal; historical rows/journal/ACL/RLS were preserved.36public asset
hashes and private401 pass;55bindings/27secret names, all3Workflow resource IDs
and Cloud/Desktop pins survive. New registered versions: video
be905fba-95ad-463b-9b00-66002cd3b72f;pairc64333d8-9517-4b5b-8083-ef03bdbd1324;
continuation1c001f77-36d6-4658-a599-e523de76b76b.

Production completed the original fresh project's34scenes/4batches using4original
claims,1replacement and5complete receipts. Estimated prompt cost sums6005microUSD,
including the invalid original response. All34request/response hashes and compiled
bytes reproduce exactly from durable receipts. Only3failed scenes were corrected;
5valid originals in that batch remained byte-identical. Final Kie request prompts
are686–786characters, below800. Independent manual review of all34source/visual
triples found no critical source contradiction. This verifies prompt text, not
all generated-image anatomy or editorial quality.

Actual Chrome shows Stage4 COMPLETE,34/34prompts,4/4batches and saved full prompt/
Avoid text expansion. Production screenshot remains private incident evidence.

A guarded incident coordinator refresh was considered, but its preflight found
DUE0 because real work had already progressed; it aborted before writing an
intent or sending any restart. The original singleton still runs version3139ccdc.
The deployed Worker also has an active scheduled-handler code path; invocation
attribution is unavailable, so do not claim HTTP ingress or new singleton
adoption from this success. Adopt the registered coordinator at ordinary idle
when paid work finishes.

Audio preparation completed all11SPAN jobs in3rentals (up to4jobs per rental).
At06:35:56UTC all3new audio rentals and the prior ASR rental were CLEAN with
verified cleanup;45image/avatar jobs and7scene-video jobs were progressing.
The corrected conservative whole-project ceiling is1.838055USD, including old
ASR/context,3SPAN+1RENDER at0.20USD each, current media rate bounds and6005microUSD
prompts. The native Cloud authority is ongoing, not an aggregate2USD gate; enforce
finite counts and stop on a fourthSPAN, secondRENDER, extra paid attempt or unknown
liability. The user's2USD cap remains unchanged. Final film acceptance, render
cleanup and coordinator adoption were still in progress at this intermediate check; both completed as recorded below.

## Complete original film and shutdown

At06:45:52UTC the same generation was SUCCEEDED:34images,11avatars and7scene
videos all SUCCEEDED, with no extra paid retries. Final runtime is COMPLETE.
All5rentals (priorASR,3audioSPAN,1render) are CLEAN with verified cleanup.
Read-only complete provider inventory at06:46:35UTC contains0Pods and confirms
all5exact project Pod IDs absent. Historical unrelated uncertain liabilities
remain unchanged.

The authoritative private MP4 contains68940477bytes, SHA256
`40261c0b597ad150401214fb7ab1e7b2b4277b02de9804dd1d36fb84b305fa77`.
One bounded private R2GET matched native content type, size and complete checksum.
FFprobe confirms1920×1080/H264/30fps/5400frames/180seconds and oneAAC audio stream.
Full FFmpeg video+audio decoding passed with exit0 and no error output. Actual
Chrome Progress shows100percent and all9stages COMPLETE, with View video and
Download MP4 links; the final player loads180s/1080p and plays without an error.
Full natural-speed Chrome playback reached currentTime180/duration180, ended=true, paused=true, readyState4 and error=null at1080p; proof and screenshot are retained privately.

Read-back estimates: prompt0.006005;context0.000118;34Kie images0.136;
38.07sFal0.19035;7Runware clips provider-reported0.45605359;new rentals at confirmed
hourly rates over reservation-created-to-cleanup intervals0.11007824;priorASR
0.01347950. New-work subtotal0.89860483USD conservatively includes the earlier
context charge; all-in subtotal0.91208433USD. These are response/pinned-rate/
confirmed-rate interval estimates, not invoices. Conservative finite-action
ceiling1.838055USD remained below the user's2USD cap. No new resource, inference,
manual regeneration or media retry is authorized after this accepted run.


## Final runtime release and remaining limits

After the finished film and all cleanup were verified, the old coordinator was
terminal with Cloudflare WorkflowInternalError (provider internal-workflow error,
not a failed paid job). A guarded readback established0DUE work,0active requests/
leases/CPU/provider waiters, exact original claims/accepted prefix and unchanged
archived liabilities. The existing singleton was restarted once with identical
parameters, using the same supported terminal-driver recovery as the watchdog;
no user job, paid media request or resource was restarted. Its registered target
is1c001f77-36d6-4658-a599-e523de76b76b. Final readback confirms this version RUNNING, error=null, and a successful tick (dispatched0, observers0, cloud1, error=null). The cloud1 action belongs to preserved historical cleanup; no new generation was started. Runtime proof is retained privately.

The source/runtime/full-stage/full-film/Chrome/compute-cleanup acceptance is
complete. Unused USD2 authority is retired. Existing broad CI formatting/Python
lint failures, provider invoices, universal generated-image/editorial quality,
external service availability and unrelated historical unknown liabilities are
not claimed resolved by this repair.
