# Product requirements

Status: approved MVP requirements  
Read when: scoping product work, adding a feature, or evaluating whether an implementation belongs in MVP.

## User and problem

The primary user is a non-developer YouTube automation business owner. The application will also be used by a partner and virtual assistants, for about 5–10 invited users total. They need a dependable production tool, not a developer console.

The app must automate a visually simple but quality-sensitive edit. Quality comes from exact narration relevance, faithful adherence to the selected image style, and a trustworthy avatar—not effects or complex editing. The built-in default remains photorealistic documentary imagery.

## Required happy path

1. Sign in with an approved Google account.
2. Create or choose a named reusable presenter in the Avatar Hub, then select it from the project form by image and name.
3. Create a project with a title and voiceover audio; no avatar image is re-uploaded for that video.
4. Select a published Image Style; Authentic Documentary Stock is already selected by default.
5. Optionally enable project-wide extra image-prompt keywords.
6. Review live compatible `EU-RO-1` inventory and explicitly choose one tested current GPU offering
   for the Mage image Pod and one for the Echo avatar Pod. Suggestions may be highlighted, but never
   become selections without user confirmation.
7. See preflight validation, effective avatar/style settings, estimated cost, and a configurable spend cap.
8. Select **Generate video** once. That one action starts one disposable Mage Pod and one disposable Echo Pod concurrently, each attached to its own retained model volume.
9. Watch truthful parallel durable upload/local preparation, Pod boot, volume verification,
   model-ready, image, and avatar progress, plus queue position, ETA, cost, retries, and blockers.
10. Review a lightweight segment strip; regenerate or replace only a failed asset if needed.
11. Preview the automatically assembled 1080p video/contact sheet, fix any visible generated-pixel defect, approve it, and download the final MP4 with its provenance manifest.

The happy path must not require a nonlinear editor, RunPod console, shell, model knowledge, or prompt writing.

## Inputs

Required:

- `title`: 1–240 characters after trimming.
- `voiceover`: English-language final WAV, MP3, M4A/AAC, or FLAC; 10 seconds to 60 minutes and at most 1 GB in MVP; validate duration, decodeability, channels, and sample rate before revision creation.
- `avatar_profile_version_id`: one accessible `READY` reusable Avatar Profile version whose parent is `ACTIVE`, selected from the Avatar Hub. The selector shows its private thumbnail and name. There is no direct avatar-image upload in Create Project.
- `image_style_version_id`: one published immutable Image Style version. The form automatically supplies `documentary_stock_v1`, so this does not create extra work on the default path.

Optional:

- `optional_script`: backward-compatible API-only field. The first-shell web UI does not expose it and sends `null`, so local ASR text is canonical there. If another versioned client supplies it, its normalized text remains canonical while ASR supplies timing.
- `extra_prompt_keywords`: up to 500 characters of image-only refinements such as `ultra realistic, no AI look`.
- `apply_extra_prompt_keywords`: explicit boolean, default false. Text is preserved while off but excluded from all generation requests.
- `user_seed`: advanced reproducibility setting; normally generated automatically.
- `gpu_selections`: two required compute-run selections, one `image_media` and one
  `avatar_primary`, each resolved from a fresh compatible `EU-RO-1` inventory receipt and pinned to
  its immutable tested model/container/volume profile before Pod creation. This is a planned vNext
  field; the checked-in legacy request schema does not yet authorize paid dispatch. A planned or
  unavailable GPU may be shown disabled for orientation but cannot be selected before
  `GATE_GPU_001` passes.
- `spend_cap_usd`: suggested default is `min(max($0.10, $1.50 × duration / 30 minutes), $2.00)`; the user may lower it no further than `$0.10`, while the MVP schema always rejects values above `$2.00`.

## Output

- One playable H.264/AAC MP4, 1920×1080, 16:9, 30 fps, no letterboxing.
- Continuous final voiceover, aligned to the supplied audio.
- Full-screen avatar, full-screen AI image, and 50/50 avatar-left/image-right only.
- AI images follow the pinned selected style and move with a slow, smooth zoom-in.
- Automatic final assembly; no manual import, alignment, crop, or timeline work in Premiere Pro or another nonlinear editor is required.
- A JSON `production-manifest/v2` provenance index binding the revision/timeline/render manifests, prompt components, selected avatar/style versions and hashes, extra-keyword toggle, models, seeds, attempts, costs, QA lineage, and final output.

## Functional capabilities

- Invite-only Google authentication and role-aware access.
- Workspace/project ownership and safe multi-user isolation.
- Durable queue with fairness, retries, cancellation, recovery, and clear state.
- Parallel image and avatar lanes whose disposable Pods start together from the single Generate action while local upload, ASR, timeline, prompt, and selected-span preparation continue.
- Automatic RunPod Pod creation, volume attachment, readiness verification, dispatch, drain, deletion, and reconciliation through API. Container health is not model readiness; no generation task is dispatched until its lane reports authoritative `model_ready` for the exact pinned runtime.
- A dedicated retained Mage model volume and a separate retained Echo model volume in `EU-RO-1`.
  Ordinary workers treat verified model files as immutable/read-only application data and write
  scratch/results elsewhere; provider-enforced read-only mounting is not assumed. Deleting a
  disposable Pod never deletes either model volume.
- Compatibility-filtered live GPU inventory and independent Mage/Echo selection. Each selected GPU, price snapshot, Pod, volume, model profile, and readiness evidence is pinned in attempt lineage.
- Mage image generation uses the ImageForge-compatible active contract: `Comfy-Org/Mage-Flow@d8c99241f6fa80fbd453014234af2bf337ea21e6`, pinned ComfyUI, `int8-convrot`, four steps, guidance `1.0`, and 1280×720 output.
- Avatar generation uses the pinned EchoMimicV3-Flash FP8 runtime and only the scheduler-selected speech spans.
- Per-project estimated and actual cost, with hard enforcement.
- Workspace Avatar Hub with named private profiles, one-time source upload, immutable ready versions, crop/rights validation, optional explicit compatibility tests, archive/version controls, and required project selection.
- Workspace Image Styles Hub with private references, one-time multimodal analysis, rights/provider-retention disclosure, human review, immutable published versions, duplicate/test/archive, durable cover fallback, and a non-deletable built-in default.
- Required project style selector plus optional extra-keyword textarea/toggle that affects images only.
- Lightweight per-segment review/regeneration.
- Technically valid generated assets are selected as draft outputs by default after the exact model/profile acceptance gate; the user may flag or replace any asset before final approval. The automated job ends `READY_FOR_REVIEW`; only explicit user approval creates the creative `APPROVED` state. Subjective avatar/image defects are not silently inferred by an unapproved QA model.
- Final library, archive, signed download, and retention controls.
- Admin settings for team allowlist, credentials, GPU profiles, storage, scheduler defaults, and budgets.

## UX requirements

- The interface must feel snappy even while generation is slow.
- Every asynchronous user action immediately shows a pending state or concrete blocker.
- Progress is authoritative and stage-based; do not fabricate smooth percentages.
- Technical detail is available but progressively disclosed.
- Error messages explain what failed, what was charged, what will retry, and what the user can do.
- Development changes remain visible in the user's real Chrome through hot reload and small working commits.

## Cost and performance requirements

- Required fixed web/app subscription cost: $0 while free tiers suffice.
- RunPod network-volume cost is accepted and reported separately. Model storage is an intentional fixed cost; VideoForge must not trade it away for repeated model downloads.
- Creating a new Image Style may spend roughly $0.03–$0.07 once; it is shown separately and never repeated for each video using that style.
- Creating/selecting an Avatar Profile uses no LLM. Any explicitly requested one-time compatibility preview is estimated and charged to the Avatar Profile version, not the video; a ready profile adds no onboarding cost per project.
- Project compute cost is calculated from the two selected live Pod rates and measured boot/inference time. Historical Serverless estimates do not qualify this Pod architecture; representative cold/warm Pod measurements must replace them before production claims.
- Operational approval threshold: pause before projected cost exceeds $1.50 by default; the MVP project contract has a hard $2 ceiling. Raising that ceiling later requires an explicit decision and versioned contract change.
- Cold, no-fallback 30-minute isolated-service p50 goal: at or below 30 minutes; p90 goal at or below 45 minutes; report queue wait separately.
- Mage and Echo Pods start concurrently. Local preparation overlaps their boot, each lane begins only after authoritative model readiness, and each Pod drains and is deleted independently as soon as that lane's accepted assets are durable.

## Multi-user requirements

- Initial scale: 5–10 invited users, not public signup.
- One or two active projects per workspace by default; additional projects remain visible in a fair queue.
- One user's backlog must not monopolize either model lane.
- The same project cannot be mutated concurrently without an explicit revision/lease.
- Users see owner, current worker, active revision, and permitted actions.
- Cancellation is cooperative and truthful; already-billed work is recorded.

## Non-goals for MVP

- AI-generated B-roll video.
- Stock-footage search/download.
- Motion graphics or text of any kind in output.
- Full nonlinear timeline editor.
- Automated creative choice of layout by an LLM.
- Automated high-cost multimodal QA on every image.
- Per-video or per-image reference-style analysis; style understanding occurs only when a new draft style version is explicitly analyzed.
- Automatic Style LoRA training or reference-conditioned image generation.
- Mobile-first production editing.
- Public customer billing, subscriptions, or payment processing.
- Self-hosted LLM inference.
- Paid ASR provider.

## Definition of a decent MVP

The MVP is decent when one invited non-developer can create and reuse a named Avatar Profile, create/review a reusable Image Style, select both in a real project without re-uploading the avatar, choose independent compatible Mage/Echo GPUs, select Generate once, follow truthful boot/generation progress, recover from a failed asset, and download a relevant, style-faithful, correctly structured final video without manual editing or developer help. The two retained model volumes must survive disposable Pod deletion, later Pods must reuse them without downloading model weights again, two or more users must queue work safely, the style analyzer/Mage/exact-avatar acceptance suites and Chrome E2E must pass, and measured cost must remain within the configured budget.
