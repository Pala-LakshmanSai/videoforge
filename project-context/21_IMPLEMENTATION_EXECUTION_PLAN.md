# Implementation execution plan

Status: isolated persistent model-lane reset selected; implementation not started
Read when: selecting, implementing, integrating, or handing off one task.

## Authority

`CURRENT_STATE.yaml` selects exactly one task. Fixture mode stays default. A task may use only its
recorded provider/credential/spend authority; absence means `$0` and no external mutation. Private
inputs, outputs, weights, credentials, and provider resource IDs never enter Git.

The prior Serverless/ephemeral `VF-9-24I` retry is superseded. Its evidence remains immutable, but
its former `$8` ceiling and temporary-cache cleanup rules do not authorize the new architecture.
No old endpoint, Pod, template, or deleted temporary volume may be adopted as production state.

## Required order

1. **`VF-9-24J` — isolated model-lane architecture reset (`$0`, complete).**
   Reconciled product, architecture, RunPod, model, scheduler, cost, acceptance, context, templates,
   and task truth. No application/schema/provider implementation occurred.
2. **`VF-9-24K` — isolated model-lane contracts and fixtures (`$0`, proposed/paused).**
   Version two exact model-volume bindings, immutable manifests, expiring live-inventory receipts,
   independent exact GPU selections, Pod create/readiness/work/delete attempts, timings, durable
   output barriers, and cross-lane rejection. Current v1 machine contracts remain legacy and must
   fail closed before paid dispatch. Exercise concurrent lifecycle states in fixtures; no provider
   call, schema reinterpretation, cloud resource, or app production activation.
3. **Offline worker adaptation (`$0` plus separately authorized image publication later).**
   Reuse the working ImageForge Mage INT8 ConvRot model identity/ComfyUI workflow/offline load and
   warm-up mechanics without copying its resource IDs or volume. Adapt Echo FP8 to the same exact
   manifest/readiness boundary. Ordinary startup must not download weights, install dependencies,
   clone source, or repair storage.
4. **Persistent volume provisioning/preparation (separate explicit cloud/spend authority).**
   Derive each capacity from its exact manifest plus approved headroom, create two different
   `EU-RO-1` VideoForge volumes, prepare one model per volume, verify hashes, and write completion
   markers last. Delete preparation Pods; retain both volumes.
5. **Pod lifecycle and independent live GPU UI (provider-free first, then separately authorized).**
   Query fresh compatible inventory per lane, let the user choose each exact current offering,
   revalidate, create both Pods concurrently, verify actual Pod/GPU/volume/image/model identity,
   report truthful readiness, reconcile ambiguity, and delete each Pod without deleting its volume.
6. **Bounded lane samples (new caps required).**
   Run Mage INT8 owned prompts and normal owned Echo 2–6-second spans (opener maximum 7 seconds).
   The exact historical 10.12-second input is optional stress evidence only under separate explicit
   authority and cannot change production span policy. Return local
   artifacts with hashes/probes plus boot/load/warm-up/inference/upload/delete timings, exact GPU/rate,
   cost, manifest, attempt lineage, and zero-Pod/two-volume evidence. User reviews quality.
7. **Automated concurrent E2E.**
   One Generate starts both selected Pods while local preparation runs, then deletes each after its
   durable barrier, renders the deterministic 1080p MP4 with FFmpeg, verifies/downloads it locally,
   and shows it in real Chrome. No Premiere/manual import/alignment.
8. **Production qualification and hardening.**
   Run the Mage 40-prompt/300-image suite, Echo 12–20-clip exact-avatar suite, cold/warm fresh-Pod
   benchmarks, stale inventory/no-capacity/cancellation/ambiguous create-delete/recovery/cost tests,
   and close gates only from recorded evidence plus required user review.

## Locked lane identities

- Mage: `Comfy-Org/Mage-Flow@d8c99241f6fa80fbd453014234af2bf337ea21e6`, ImageForge
  `int8-convrot`, pinned stock ComfyUI, 4 steps, guidance 1.0, 1280×720.
- Echo: pinned EchoMimicV3-Flash FP8 derived from first-party Flash weights; short selected spans,
  no Long Video CFG, no uncarded third-party pickle, repair, fallback, or model substitution.
- Region: both volumes in `EU-RO-1`, but as distinct resources bound to distinct model lanes.
- Initial concurrency: at most one Pod per lane; at most two paid Pods total.

## Parallel and serialized work

After shared vNext contracts lock, Mage-worker and Echo-worker adaptation may proceed in parallel.
Fixture UI and provider adapter may proceed in parallel only when they own disjoint files. Shared
schemas, migrations, state machines, root composition, derived context, provider mutations, and
commits are serialized through one integration owner. Although Generate starts two Pods in
parallel, one controller owns both create/delete intents and budget lineage.

## Verification

- Focused tests, `pnpm verify:fast`, then canonical `CI=1 TURBO_FORCE=true pnpm verify` for a
  coherent implementation milestone.
- For context/contracts: `project-context/scripts/validate-context.sh`,
  `project-context/scripts/validate-schemas.sh`, `pnpm secret:scan`, formatting, dependency audit,
  and `git diff --check`.
- Provider work additionally requires immutable evidence, output hashes/probes, measured costs,
  exact Pod/volume/GPU/model identity, deletion and independent absence proof. Retained approved
  volume identity must also be proven; “zero resources” is no longer the desired production state.

## Stop conditions

Stop on unexplained tracked state, contract/manifest mismatch, cross-volume binding, runtime model
download, stale/vanished GPU offering, silent GPU/model/precision substitution, ambiguous create or
delete without exact reconciliation, cap risk, unverified durable output, Pod absence not proven,
unexpected volume deletion, failed validation, or missing authority for a provider/cloud action.

Historical AvatarForcing, MuseTalk, SkyReels, earlier BF16 Mage/Echo runs, and Serverless endpoints
remain evidence only. Reintroducing any requires a new explicit decision and task.
