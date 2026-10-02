# Seedance video layer — production audit

Checkpoint V2-09; task SEEDANCE_VIDEO_PLAN. User authorized implementation, production deployment and a finite USD4 provider/compute budget. Existing projects and the shared checkout were preserved.

## Release and rollback

Application source `3f2310df1de96f1c1a4177f7a1d1db24ed22e628`, Cloudflare version `d4695e0e-8f71-4fc4-b97f-b0dccdd68901`, 100%. Additive migrations240–245 applied. All three Workflow definitions were adopted without changing their IDs. Desktop0.1.46 and the qualified private Cloud renderer support both original v1 and mixed v2 manifests.

Rollback tag `pre-seedance-video-20261002` points to checkout `4d5af76c007b76f39cd6a715b26fefd71ee8e40a`. Previous production application source `f705d6c21bf7b6ab46ba1801fb30eff0b58729f0`, Worker `f8b36fdf-b445-4485-94a6-53f706bfc454`, and prior renderer/authority remain available. Disable fresh admission, reconcile exact submitted UUIDs and drain active v2 renders before reverting feature commits. Keep additive SQL and accepted artifacts; preserve unrelated later edits. See the task brief for the full procedure.

## Behavior and compatibility

Fresh revisions pin a deterministic up-to-7% selection of IMAGE_FULL frames; original stills remain. Seedance1.0ProFast `bytedance:2@2` uses the native720p16:9 preset1248×704 and USD0.01336 per output second. Four bounded Runware jobs overlap remaining image/avatar work; artifact acceptance stays serial. Existing account/global workload limits remain. The new Progress stage follows image generation; legacy projects retain11 stages.

Accepted clips replace only their selected scene prefixes, then hard-cut to the original smoothly zoomed still. Rendering retains1920×1080 output, original narration and existing avatar composition. Provider audio is excluded. No overlays, captions, decorative transitions or motion graphics are added.

Known definite, bounded terminal video failures retain the verified source still and actual paid cost. Unknown submission, invalid cost, price change, cancellation and missing source receipts remain blocking. Unknown paid requests never automatically replay. All-static fallback emits the original v1 manifest; a mixed film includes only accepted clips in v2. Progress displays actual coverage, fallback count and charges.

## Verified boundaries

- Meaningful adapter, executor, planning/replay, product/UI, contract and offline renderer checks pass; web/Worker types, lint, production/staging builds, bundle quarantine and context validation pass. Native SQL240–245 checks cover tenant/role access, immutable claims, cost fences, no replay, valid source receipts, render barriers and v1/v2 compatibility. Full repository green is not claimed: historical unrelated failures remain documented.
- Exact public assets and two authenticated accounts verify production publication, Natural Documentary defaults and tenant isolation. A retained legacy project still exposes34 images,12 avatars and11 stages.
- Actual workerd exposed unsupported `redirect:error` before network dispatch; the shared transport now uses manual redirects and rejects all3xx without forwarding bearer credentials. Native edge probes supplement Node mocks.
- The real R2 signer permits exact scene-video GETs and keeps deletion restricted to existing input/render paths. Strict H264, geometry, selected-prefix duration, cost and immutable stored-media checks remain.
- Migration245 restores only the existing reconciler's scoped ready-input reader permission, lost when migration240 renamed/recreated the function. The native regression reproduces the denial, proves positive ready inputs under both roles after245, and denies foreign tenants.

## Live canary and spend

The live153.098-second film accepted29 Kie images and10 Fal avatar clips. Three Seedance requests yielded two accepted clips and one short-clip rejection: a1.3s request returned29frames at24fps (1.208333s), shorter than37/30s required. Its USD0.01614842 charge remains recorded; the original still is retained. The accepted clips cost USD0.06069578 and USD0.06737788; total reported Seedance cost USD0.14422208. Actual motion is284/4593 timeline frames,6.1833%, shown as6.18%. Fresh requests include0.1s headroom; existing pinned requests remain immutable.

At the current audit, all nine ASR/span test rentals are CLEAN with cleanup receipts; conservative Cloud budget debits total USD1.80. One render reserve of USD0.20 plus conservative LLM/prior/current API bounds produces USD3.60 maximum, below USD4. This is a liability bound, not a settled invoice. No further paid generation is required.

Final mixed render/technical check/Cloud shutdown acceptance is pending. Real Chrome workflow acceptance, clean-install Local worker acceptance and a fresh30-minute performance benchmark are unverified; authenticated HTTP/component/offline proofs do not substitute for them.

Private request identities, provider receipts, publication metadata and raw logs are retained under `.videoforge/seedance-video-20261003/`; credentials, signed URLs and customer identifiers are excluded from this report.
