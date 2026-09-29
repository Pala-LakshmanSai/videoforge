# Fresh sample observation — 2026-09-29

Checkpoint V2-09 / VF-10-09. A separately approved 44.6-second normal Cloud project
started once in signed-in regular Chrome after enabling the extension's file URL
permission through Computer Use. New provider generation is capped at USD0.25;
the existing USD1.60 Cloud authority remains limited to five rentals, USD0.80/hour,
temporary disk at least100GB, no retained volume, expiry2026-09-30T12:30Z.

## First concrete failure and repair

Cloud ASR succeeded on a verified NVIDIA L4 placement at USD0.503888889/hour including
100GB disk. Context extraction succeeded. Scene planning rejected the exact saved
Cloud template with `HOSTED_GENERATION_ASR_JOB_TEMPLATE_INVALID`: the planner admitted
only the personal-worker template. No Kie image or Fal avatar jobs had been created.

The repair validates Cloud template/runtime/tool hashes against the same tenant,
revision, attempt and verified reservation. Local template/model/version checks
remain intact. The immutable saved ASR result is reused; no retranscription or
provider regeneration is required. No migration or media runtime change is needed.

The actual saved input/output bytes reproduce the old failure. The repaired planner
produces11 segments,9 image tasks,3 avatar tasks,1338 frames with full and split avatar
compositions. This is correctness recovery, not a measured render-speed improvement.

## Focused validation and limits

Coordinator13 tests, web and Worker typechecks, changed-file lint, production builds
and production bundle/dispatch firewalls pass. The installed native CLIs were used;
the pnpm wrapper's dependency reinstall/no-TTY failure is a tooling limitation.
Existing broad-suite failures remain as recorded in CURRENT_STATE.yaml.

ASR phase telemetry: startup48.599s, input transfer8.294s, processing12.061s,
checking6.001s; exact acceptance/cleanup timings remain in private evidence.
RunPod system logs confirm the pinned image. Successful container command logs were
not emitted; phase telemetry is not claimed as detailed FFmpeg profiling. Independent
complete inventory verifies owned ASR Pod absence; unrelated compute was untouched.

The planning repair is published at source41f74259 / Cloudflareee91ee4c. The same
canonical continuation instance adopted the new definition and progressed without
a new project, ASR attempt or browser retry. Live settings contain50 total bindings:
25 secrets,19 plain variables and6 resource bindings; earlier41-count shorthand was
stale. All existing values/resources and23 client assets were preserved.

Nine prompts were accepted in55.901s with reported costUSD0.041855. All three Cloud
spans reused one RTXPRO4500BlackwellServer Pod atUSD0.733888889/hour including100GB.
All9 Kie images and3 Fal avatar clips were accepted once; the span Pod is independently
CLEAN while the APIs run. Final assembly is searching bounded qualifying capacity;
no render Pod had launched at14:38UTC.

The first render capacity search exhausted and failed cleanly with no Pod launch.
This exposed a Local-only retry status projection: Cloud recovery was supported by
the guarded preparation function but never advertised without a native failed lease.
Additive migration224 makes that read projection backend-aware, preserves Local
recovery, rejects unknown failures/uncertain cleanup/cross-tenant scope and retains
the five-attempt bound. The caller uses the selected backend's qualified source hash.
The existing preparation function remains authoritative; accepted media and manifest
are never regenerated. Local/Cloud projection PostgreSQL checks pass; real-source
function replacement and eligible Cloud status were verified inside ROLLBACK against
the exact206-row ledger before installation. No retained resource or budget mutation.
Migration224 was then installed once:207 rows, all206 old rows preserved. The actual
configured runtime role independently reads `eligible:true` without authorizing
provider calls. New source publication and one explicit render retry remain pending.

Two further narrow fixes are locally verified: capability lookup reuses the same
database pool for the tenant transaction, and progress prefers the actively executing
span over queued siblings. Controller126 tests and3 selected UI checks pass, plus
both typechecks, changed lint, production build and firewalls. Eight post-warmup
read-only requests to the exact cleaned ASR spec have a baseline median471.456ms.
The after measurement remains pending; this control-path benchmark is not a render
or end-to-end speed benchmark. No model, encoding or image publication changes.

Fresh sample completion, editorial review, matched speed/cost comparison and final
production readback remain pending. The source voiceover itself repeats its opening;
ASR also joined "scrape knee" into one token. Neither is a proven rendering defect.
Private scoped evidence: `.videoforge/cloud-media/sample-observation-20260929/`.
