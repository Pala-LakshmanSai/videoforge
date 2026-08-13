# Development plan

Status: isolated persistent-model architecture selected; implementation and provider activation not started
Read when: opening a coding chat, sequencing work, assigning ownership, or accepting a milestone.

## Current destination

VideoForge is a fully automated voiceover-to-video application. One Generate action must prepare
the narration locally, generate the required stills and short avatar clips on two independent GPU
lanes, compile the deterministic timeline, render the final MP4, and return it to the local app.
Premiere Pro, manual imports, and manual alignment are not part of the product path.

The two active model lanes are fixed:

| Lane | Exact model/runtime | Persistent compute boundary |
|---|---|---|
| Image | `Comfy-Org/Mage-Flow` revision `d8c99241f6fa80fbd453014234af2bf337ea21e6`, ImageForge `int8-convrot` profile, ComfyUI, 4 steps, guidance `1.0`, `1280x720` | One Mage-only `EU-RO-1` network volume and one disposable Mage Pod |
| Avatar | EchoMimicV3-Flash FP8, with its revision-pinned source/weight/base/audio-encoder manifest | One Echo-only `EU-RO-1` network volume and one disposable Echo Pod |

These boundaries are permanent architecture, not a deployment optimization:

- Never share a volume, Pod, manifest, model cache, active lease, or adoption path across the two
  models. A later Pod may reuse only the persistent volume for its same exact model profile.
- A normal Pod start is offline with respect to model acquisition. Pinned model files are prepared
  once on the lane's volume, verified against an exact manifest/checksums, and then treated as
  read-only model inputs by ordinary workers.
- `container_ready` is not `model_ready`. The authoritative ready transition occurs only after the
  expected volume is attached, the manifest is verified, the exact model is loaded into the
  selected GPU, and a bounded warm-up succeeds.
- The user independently chooses one currently available compatible GPU for each lane from live
  RunPod inventory. The app pins both selections and their price/availability receipts, then
  revalidates them immediately before Pod creation. It never silently substitutes another SKU.
- One Generate action starts both Pods concurrently. Local audio upload/validation, ASR, phrase and
  layout scheduling, prompt compilation, and selected-span audio materialization overlap Pod boot.
- Each Pod is deleted as soon as its lane outputs are durable and no retry needs the resident
  model. The two model volumes remain. Final local/control-plane rendering must not keep either GPU
  alive.

The desired model-ready cold start is as close to two minutes as practical. The user's ImageForge
experience of roughly three to four minutes is a comparison baseline, not verified VideoForge
performance. Boot, volume verification, load, warm-up, generation, upload, deletion, and measured
cost must be recorded separately before any promise is made.

## Delivery strategy

Work contract-first and provider-free by default. Each successor brief owns one bounded outcome,
disjoint files where parallel work is safe, exact acceptance evidence, and a green handoff in
`CURRENT_STATE.yaml`. Real RunPod calls, volume creation/preparation, Pod creation, or spend require
their own explicit task authority and cap.

Implementation order is mandatory:

1. **Contracts and fixture state.** Version lane bindings, model-volume manifests, live-inventory
   receipts, exact GPU selections, Pod lifecycle/attempt state, model-readiness evidence, durable
   result receipts, delete/absence proof, and cost events. Exercise both lanes at `$0` in fixtures.
2. **Offline workers and immutable manifests.** Adapt the ImageForge Mage INT8 implementation and
   the Echo FP8 implementation so ordinary startup cannot download weights, install packages, or
   compile source. Prove wrong/missing/cross-model volumes fail closed before generation.
3. **Separately authorized volume provisioning.** Create two new VideoForge volumes in `EU-RO-1`,
   prepare each exact model once, save its signed/checksummed manifest, and prove the other lane
   cannot adopt it. Do not copy ImageForge resource IDs, secrets, or its production volume.
4. **Pod lifecycle and live GPU selection.** Query current compatible Secure inventory per lane,
   let the user select exact GPUs independently, create each Pod against its own volume, expose
   truthful readiness, reconcile ambiguity, and delete the exact Pod without deleting its volume.
5. **Lane qualification.** Run a bounded Mage image sample and normal 2–6-second owned Echo spans
   (opener maximum 7 seconds). The previously requested exact 10.12-second input may be run only as
   a separately labeled stress qualification under its own later authority; it is not a production
   span policy. Preserve local outputs, hashes, probes, timing, GPU/rate, cost, revision,
   manifest, attempt lineage, and zero-Pod proof.
6. **Concurrent sample and end-to-end render.** One Generate action starts both lanes, overlaps
   local preparation, accepts durable lane outputs, deletes Pods independently, compiles the
   deterministic timeline, renders/probes the MP4, and presents it in real Chrome for user review.
7. **Production hardening.** Add fair scheduling, exact caps, cancellation, stale-inventory and
   no-capacity handling, crash/ambiguous-create reconciliation, partial-result recovery,
   backup/restore, and repeated fresh-Pod measurements without weakening lane isolation.

No step may claim that fixture/local evidence proves a production RunPod path. No later step may
bypass the versioned task/attempt/outbox/cost contracts established earlier.

## Target execution flow

~~~mermaid
flowchart LR
    A["Generate"] --> B["Pin revision, styles, avatar, two live GPU selections"]
    B --> C["Local ASR, schedule, prompts, span audio"]
    B --> D["Mage Pod + Mage volume"]
    B --> E["Echo Pod + Echo volume"]
    D --> F["Verify, load, warm up, generate stills"]
    E --> G["Verify, load, warm up, generate avatar clips"]
    F --> H["Durable stills; delete Mage Pod"]
    G --> I["Durable clips; delete Echo Pod"]
    C --> J["Resolve deterministic manifest"]
    H --> J
    I --> J
    J --> K["FFmpeg render and probe"]
    K --> L["Final MP4 in app"]
~~~

The output grammar remains `IMAGE_FULL`, `AVATAR_FULL`, and `AVATAR_SPLIT_IMAGE` with hard cuts
and a slow smooth zoom on every still. No model chooses timing or layout; deterministic code does.

## Milestones

### A. Provider-free contract reset

- Replace active Serverless endpoint/worker-count concepts with model-volume and disposable-Pod
  state while retaining historical records as history only.
- Add exact independent Mage/Echo GPU selections and inventory expiry/revalidation semantics.
- Make lane state explicit: volume binding, Pod create ambiguity, container ready, manifest
  verified, model loading, warm-up, model ready, generating, uploading, durable, deleting, absent.
- Keep fixture/local paths green and add cross-volume/adoption rejection fixtures.

Exit: browser, TypeScript, and Python contracts agree; fixture Generate shows both concurrent
lanes and reaches a provider-free MP4 without implying real provider success.

### B. Exact offline worker images

- Reuse or closely adapt ImageForge's current Mage INT8 model identity, ComfyUI workflow,
  local-files-only loading, GPU verification, readiness, and warm-up behavior.
- Pin Echo FP8 source, weights, Wan base, audio encoder, Python/CUDA/PyTorch/runtime dependencies,
  image digest, input contract, and deterministic output/probe contract.
- Bake code and dependencies into small pinned images; do not bake large weights into them.
- Verify only the expected lane volume/mount/manifest. A cache miss is an error during normal boot,
  never permission to download.

Exit: both workers pass provider-free manifest/cross-adoption tests and separately authorized GPU
smokes when that later authority exists.

### C. Persistent volume preparation

- Create two distinct `EU-RO-1` network volumes under explicit provider authority.
- Use one-time preparation tooling to place exact model files and a canonical manifest on each.
- Verify every required relative path, size, checksum, model revision/profile, and preparation tool
  version before marking the volume ready.
- Preparation Pods are also disposable and must be deleted; volumes stay.

Exit: two durable, exact, isolated ready-volume records exist and there are zero running Pods.

### D. Live Pod control

- Fetch live compatible GPU inventory for Mage and Echo separately; expose exact GPU ID/name, VRAM,
  current rate, region/security constraints, and expiry.
- Require explicit user choice for each lane, then revalidate availability/rate before creation.
- Attach only the selected lane volume at the exact mount; verify actual GPU, image digest, region,
  and volume after create.
- Journal create/delete attempts so timeouts or lost responses reconcile by exact identity instead
  of dispatching duplicates.
- Delete only the Pod after durable results. Independently prove absence; never delete the model
  volume during routine Stop or cleanup.

Exit: repeated fresh Pods reach authoritative `model_ready`, generate, delete, and reuse their same
model volumes with measured timings and no cross-model state.

### E. Real lane samples

- Mage: representative `1280x720` prompts through the exact four-step guidance-1.0 INT8 workflow.
- Echo: user-owned ready Avatar Profile image plus deterministic 2–6-second voiceover spans through
  the exact FP8 worker, with no repair, fallback, or model substitution. A separate 10.12-second
  stress case remains optional and explicitly non-production.
- Store source/output hashes, ffprobe/image probe, model/container/volume manifests, GPU selection
  receipt, load/generation timing, cost, and delete/zero-Pod proof.
- A technically valid output is still `NEEDS_REVIEW` until the user inspects it.

Exit: user-visible sample artifacts exist and the user decides whether each model is acceptable.

### F. Automated VideoForge completion

- Stream image work and avatar-span work after deterministic scheduling; avatar clips normally use
  short selected spans rather than the whole narration.
- Resolve one immutable render manifest only from accepted, durable assets.
- Render 1080p30 H.264/AAC with original narration, hard cuts, exact crops, and still-image zoom;
  probe, checksum, play/seek, review, approve, and download from the app.
- Measure isolated queue wait, Pod boot, model ready, generation, upload, render, and total wall time.

Exit: voiceover + ready style/avatar produces a complete MP4 without manual editing.

## Historical implementation evidence

The following is preserved as completed history, not current provider architecture:

- Provider-free phases built the schema foundation, fixture UI, local ASR/scheduler/FFmpeg slice,
  durable PGlite control-plane behavior, prompt/style lifecycle, and Chrome acceptance through the
  recorded VF-1/VF-2/VF-4/VF-5/VF-7 tasks.
- Earlier Mage-shaped and avatar-shaped fixture workers remain useful contract evidence. They do
  not prove the current exact Mage INT8 or Echo FP8 production workers.
- Earlier RunPod Serverless endpoint/`workersMin`/`workersMax` plans and ephemeral no-volume Pod
  attempts are superseded. They grant no current dispatch authority and must not be revived.
- AvatarForcing, MuseTalk, and SkyReels research/gates remain historical evidence only. They are not
  active production lanes, repairs, fallbacks, or permission to dispatch.
- Prior Echo attempts did not produce the required reviewable MP4. Preserve their spend/log/output
  evidence; do not reinterpret them as acceptance of the new persistent-volume path.

## Safe parallel ownership

Safe after shared contract lock:

- Mage offline worker versus Echo offline worker.
- Live inventory/control-plane adapter versus disjoint fixture UI.
- One-time Mage volume preparation versus one-time Echo volume preparation, but only under explicit
  provider authority and with one owner per exact volume.
- Targeted tests versus implementation modules they do not edit.

Serialize shared schemas, state machines, migrations, root UI shell, decision/context authority,
and integration commits. Provider mutations are serialized through the exact task owner even when
the two authorized Pods boot concurrently.

## Deferred AI B-roll video

Do not implement. A future extension requires its own user decision, model/license/cost bakeoff,
worker and isolated volume, prompt/QA contract, and timeline enums. Still images remain default.
