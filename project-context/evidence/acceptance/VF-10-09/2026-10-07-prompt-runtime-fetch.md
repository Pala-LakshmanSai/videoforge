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
