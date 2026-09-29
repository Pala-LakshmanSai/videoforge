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

Fresh sample completion, editorial review, matched speed/cost comparison and final
production readback remain pending. The source voiceover itself repeats its opening;
ASR also joined "scrape knee" into one token. Neither is a proven rendering defect.
Private scoped evidence: `.videoforge/cloud-media/sample-observation-20260929/`.
