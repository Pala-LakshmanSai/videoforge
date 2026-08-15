# New-chat bootstrap prompt

```text
Continue VideoForge in /Users/lakshmansai/Documents/videoforge.

Use concise, factual, development-focused updates.

1. Read AGENTS.md.
2. Read only project-context/00_START_HERE.md, MANIFEST.yaml, and CURRENT_STATE.yaml first.
3. Preserve current HEAD, newer commits, old migrations, historical evidence, private inputs, accepted outputs, and the two retained model volumes; never reset or reinterpret them.
4. Load only CURRENT_STATE's exact selected read profile and task brief.
5. Read only the selected V2 checkpoint in project-context/22_PROJECT_COMPLETION_CHECKPOINTS.md. If its narrow selectors are missing, create/select/validate them before implementation.
6. Verify the predecessor is committed and independently green. Work on the selected checkpoint only.

Production destination: a private invited product for 5-10 people. User-created data is account/workspace-private; explicit built-ins alone are global. Each account has at most one active provider workload and at most two different accounts run globally; ordinary videos retain one/account and two/global caps. Explicit Mage/SoulX preset previews use the same locks/slots below every eligible video and never alter the video fairness cursor. A database-controlled fair account rotation admits work; users may reorder/cancel only their own waiting entries without changing account rotation or another account's order. Waiting work calls no provider. Preserve the existing UI design, transcript, deterministic scheduler, prompts/styles, renderer, and Ranga three-composition hard-cut grammar.

GPU production uses two independent queue-based RunPod Serverless endpoints in EU-RO-1: exact Mage-Flow INT8 ConvRot and exact SoulX-FlashHead Pro BF16. Each uses its existing separate sealed 50 GB volume mounted at /runpod-volume, one GPU/Flex worker, workersMin=0, and a qualified bounded maximum. Model volumes are application-read-only; private tenant R2 carries inputs/outputs; mutable job-keyed local scratch is erased on every terminal path. Ordinary users never select GPUs or start/stop Pods.

The active transport is v3 two-phase authority: persist authority/outbox before /run, then bind the unique returned or reconciled RunPod job ID in `provider_assignment` before accepting status/output. A separate VideoForge-signed provenance receipt records observed runtime/output facts; it is not provider hardware attestation. RunPod does not guarantee exactly-once execution, client idempotency, or no duplicate billing. Reconcile /status, persist the durable receipt before the 30-minute async-result window expires, accept at most one canonical output, and expose bounded duplicate-compute/cost. Measure TTL, execution timeout, RUNPOD_INIT_TIMEOUT, scaling, polling, and idle values. Never use /purge-queue as routine recovery.

Default authority is provider-free fixture mode at $0. Historical approvals and caps never transfer. If the selected prompt permits read-only preflight, use configured credentials only for its exact identity/inventory/quota/current-rate lookups, print no secrets, and perform no mutation or spend. Finish safe local work first. At the first external mutation or paid boundary, stop once with one exact combined proposal covering operations, identities/configuration, current rates, recurring charges, cleanup/rollback, stop conditions, and request a numeric maximum cumulative finite external spend from the user. Never invent the cap. Continue after approval only while the proposal remains exact; stop on drift or cap risk.

At handoff run required tests/validators/diff check and real Chrome when visible behavior changed; update evidence/gates/CURRENT_STATE; make one bounded green commit; state exact commands/exits, remaining gates, provider/spend state, and active-worker/pending-request truth; then stop before the next checkpoint.
```

If this reusable template conflicts with `CURRENT_STATE.yaml` or the selected task brief, stop and
reconcile the repository sources; do not guess from chat history.
