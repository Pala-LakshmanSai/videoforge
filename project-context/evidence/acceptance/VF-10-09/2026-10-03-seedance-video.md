# Seedance video layer — production audit

Subsequent Cloud-only qualification: [three-minute worker acceptance](2026-10-03-seedance-cloud-workers.md) supersedes the short canary as the latest Cloud technical proof. The153-second results below remain dated original implementation evidence.

Checkpoint V2-09; task SEEDANCE_VIDEO_PLAN. User authorized implementation, production deployment and a finite USD4 provider/compute budget. Existing projects and the shared checkout were preserved.

## Release and rollback

Application source `390daad69dc5d4e4127d5a08f35aa09c524acb9a`, Cloudflare version `4498a464-4911-4823-959e-5df740d27b0c`, 100%. Additive migrations240–247 applied. All three Workflow definitions were adopted without changing their IDs. Desktop0.1.46 and the qualified private Cloud renderer support both original v1 and mixed v2 manifests.

Rollback tag `pre-seedance-video-20261002` points to checkout `4d5af76c007b76f39cd6a715b26fefd71ee8e40a`. Previous production application source `f705d6c21bf7b6ab46ba1801fb30eff0b58729f0`, Worker `f8b36fdf-b445-4485-94a6-53f706bfc454`, and prior renderer/authority remain available. Disable fresh admission, reconcile exact submitted UUIDs and drain active v2 renders before reverting feature commits. Keep additive SQL and accepted artifacts; preserve unrelated later edits. See the task brief for the full procedure.

## Behavior and compatibility

Fresh revisions pin a deterministic up-to-7% selection of IMAGE_FULL frames; original stills remain. Seedance1.0ProFast `bytedance:2@2` uses the native720p16:9 preset1248×704 and USD0.01336 per output second. Four bounded Runware jobs overlap remaining image/avatar work; artifact acceptance stays serial. Existing account/global workload limits remain. The new Progress stage follows image generation; legacy projects retain11 stages.

Accepted clips replace only their selected scene prefixes, then hard-cut to the original smoothly zoomed still. Rendering retains1920×1080 output, original narration and existing avatar composition. Provider audio is excluded. No overlays, captions, decorative transitions or motion graphics are added.

Known definite, bounded terminal video failures retain the verified source still and actual paid cost. Unknown submission, invalid cost, price change, cancellation and missing source receipts remain blocking. Unknown paid requests never automatically replay. All-static fallback emits the original v1 manifest; a mixed film includes only accepted clips in v2. Progress displays actual coverage, fallback count and charges.

## Verified boundaries

- Meaningful adapter, executor, planning/replay, product/UI, contract and offline renderer checks pass; web/Worker types, lint, production/staging builds, bundle quarantine and context validation pass. Native SQL240–247 checks cover tenant/role access, immutable claims, cost fences, no replay, valid source receipts, render barriers and v1/v2 compatibility. Full repository green is not claimed: historical unrelated failures remain documented.
- Exact public assets and two authenticated accounts verify production publication, Natural Documentary defaults and tenant isolation. A retained legacy project still exposes34 images,12 avatars and11 stages.
- Actual workerd exposed unsupported `redirect:error` before network dispatch; the shared transport now uses manual redirects and rejects all3xx without forwarding bearer credentials. Native edge probes supplement Node mocks.
- The real R2 signer permits exact scene-video GETs and keeps deletion restricted to existing input/render paths. Strict H264, geometry, selected-prefix duration, cost and immutable stored-media checks remain.
- Migration245 restores only the existing reconciler's scoped ready-input reader permission, lost when migration240 renamed/recreated the function. The native regression reproduces the denial, proves positive ready inputs under both roles after245, and denies foreign tenants.
- The shared planner/materializer and SQL246 map immutable relational `segment:<UUID>` IDs to bare canonical timeline UUIDs without changing provider task keys. Forty-five focused pipeline/materializer checks pass, including mixed two-video/one-still fallback and bad aliases/hashes. The actual checksum-verified saved canary timeline planner also passes; simulated future receipt barriers remain explicitly distinguished from live materialization.
- SQL247 permits only exact MP4 scene-video worker-input paths while retaining the installed predicate, existing receipt admission, role policies and attempt FK. Native runtime INSERT checks cover acceptedVIDEO metadata, original lanes, malformed IDs/paths/MIME and foreign scope/attempt rejection. Each failed handoff was caught before any render Pod or extra paid generation.

## Live canary and spend

The live153.098-second film accepted29 Kie images and10 Fal avatar clips. Three Seedance requests yielded two accepted clips and one short-clip rejection: a1.3s request returned29frames at24fps (1.208333s), shorter than37/30s required. Its USD0.01614842 charge remains recorded; the original still is retained. The accepted clips cost USD0.06069578 and USD0.06737788; total reported Seedance cost USD0.14422208. Actual motion is284/4593 timeline frames,6.1833%, shown as6.18%. Fresh requests include0.1s headroom; existing pinned requests remain immutable.

All ten ASR/span/render test rentals are CLEAN with cleanup receipts; conservative Cloud budget debits total USD2.00. Direct authenticated RunPod inventory confirms zero Pods. All provider leases are released and test requests are terminal; the longest rental from reservation to verified cleanup was184.63 seconds, within its900-second/USD0.20 reserve. Conservative LLM/prior/current API bounds produce USD3.60 maximum including Cloud, below USD4. This is a liability bound, not a settled invoice. No further paid generation is required.

The original Workflow completed normally after the guarded fixes, with no new image/avatar/video inference. The live executed job and resolved manifest were read back from private R2 and checksum-verified: render-job-input/v2 and resolved-render-manifest/v2 bind the exact two accepted video assets, original source-image hashes,135+149 motion frames and the rejected scene's original still. The generation request is SUCCEEDED, runtime COMPLETE, CPU render SUCCEEDED and authenticated Progress is ready for review.

The authenticated preview GET returned the exact35,942,842-byte output checksum. Independent native FFprobe/full FFmpeg decode confirms H2641920×1080 at30fps,4593 frames,153.1 seconds and one AAC stream. The original153.098-second narration correlates0.998573754 after common16kHz decoding with zero sample offset; existing loudness normalization remains. The Cloud technical probe reports zero AV drift, full decode success and zero subtitle/data streams. Provider clip audio is absent from the render input's narration path.

Short live mixed-render, technical, narration, tenant HTTP and cleanup acceptance passes. Real Chrome workflow acceptance, clean-install Local worker acceptance, a fresh30-minute performance benchmark, editorial quality and settled invoices remain unverified; authenticated HTTP/component/offline proofs do not substitute for them. Retained historical unrelated test failures prevent a full-repository-green claim.

Private request identities, provider receipts, publication metadata and raw logs are retained under `.videoforge/seedance-video-20261003/`; credentials, signed URLs and customer identifiers are excluded from this report.
