# Script-first project pipeline acceptance

Checkpoint V2-09 / VF-10-09, profile `v2_09_j1tts_voiceover`; base `4289a047`.

One Create video action accepts either uploaded audio or a script and exact selected voice. The script path creates a private durable project immediately, waits for narration capacity, submits J1TTS once, records uncertain outcomes without replay, measures/stores completed MP3, then uses the existing revision/commit/ASR admission path. Script and voice remain pinned. Progress and Queue show narration first; temporary downstream failures retry the saved handoff. Uploaded-audio behavior, sample previews, saved/starred voices, and immutable presets remain intact.

Migration253 is additive: forced tenant RLS, immutable intake identity/audio receipt, queued cancellation, active narration archive guard, bounded due-project query, and retrieval-only observation of known provider jobs. Native PostgreSQL rollback rehearsal restored migration252 and the original observer; runtime grants and RLS verified. Application has not yet been published at this source checkpoint.

Validation: 473 focused web/server/Workflow tests; final250 affected tests after retry-copy changes; 3 native database privacy/cancellation/capacity/inventory tests; Web and Worker types, lint, production/staging quarantine, and context checks. Exact startup closures are2813301/2806268 bytes; provider and generated validators remain lazy, existing quarantine and CPU bounds unchanged. Real workerd streamed the existing J1TTS file to R2 with306408 bytes, duration19087ms matching FFprobe19.086803s, SHA256398d4b5332e337e74c77d4b4e6d6f98baca039d45621a0696be41c9654a49811. Synthetic16-second MP3 measured16000ms, including gapless metadata handling.

Real Chrome fixture: desktop script + favorite enables Create, no separate Generate voiceover button, accepted Create reaches durable-intake route and narration progress;390px mobile script controls inspected. Fixture proof is distinct from production provider proof. Current production Chrome account has no ready avatar; do not alter its account or unrelated project to manufacture acceptance.

Private receipts: `.videoforge/script-pipeline-20261004/` under the primary checkout. No credentials retained in repository evidence. Before publication no new paid work or compute was started. Remaining gates: native migration apply, exact configuration-preserving release, one short automatic script project and one direct-audio regression within USD2 finite acceptance cap, final artifact verification and owned-compute cleanup. J1TTS invoice pricing is not asserted.

## Production acceptance in progress

Application `c288e291095412233e06faacedeca0e0d3c53bb1` / Worker `b1d1a96c-9c9e-4964-800a-b4fa4dfce8be` published at100%. Migration253 applied with native RLS/grant proof.29 public asset hashes match;53 bindings,26 secrets,three Workflow registrations and native pins preserved. Chrome verifies script-first copy, no Generate voiceover action,41 B-name results and11.238458s sample playback ending cleanly.

Live script intake929b4802-ac01-4428-a317-82037230fc2d generated exactly one J1TTS job and saved289271-byte MP3, measured18019ms. Automatic materialization exposed a pre-existing missing runtime INSERT grant on project_inputs. Native rollback diagnosis reproduced SQLSTATE42501. Additive254 grants only INSERT; forced tenant RLS and existing write guards remain. Own-account insertion succeeds and foreign workspace insertion fails in regression coverage. Native grant rollback verified;254 applied without UPDATE/DELETE grants. Existing intake retries its saved MP3 without another provider POST. Full video and final cleanup remain pending.

## Short word-boundary correction

The same intake resumed automatically after254 and reached ASR SUCCEEDED and context COMPLETE without another TTS POST. Full MP3 decode and FFprobe18.018685s match the server18019ms; foreign project/audio requests return404. Planning then exposed an independent infeasible word-boundary case in immutable V4: no complete valid schedule fits20–24% with boundaries3.470s/4.440s. The test project is archived and its clean ASR/accepted narration retained as evidence; no historical revision was rewritten.

New scheduler-v5 is selected only for fresh10–30s revisions. It tries the original20–24% band first and only after failure allows at most26%, preserving whole-word cuts, scene duration envelopes and exact continuous source/frame coverage. V2/V3/V4 configs and old plan replay remain unchanged; longer-than30s still selects V2.16 scheduler tests include both real timing fixtures, deterministic replay, unchanged old-version plans and use of the original band when feasible.173 affected product/intake tests, Web/Worker types and both quarantine builds pass. Existing native Cloud/Desktop pins remain valid; the scheduler is the Worker-side planning code.

Acceptance is bounded to two new TTS jobs and three short project attempts including the archived V4 probe, within the same total USD2 finite cap. This correction requires one fresh script run because the old revision's scheduler identity is immutable; direct upload is the other regression run. No uncertain paid POST is replayed.

## Cloud queue render deadlock correction

V5 application b9ab22233ce9ac4853e4534c9353359bd76ef009 / Worker dd986e66-5063-43ce-a646-6773b4eda5e3 is live. Fresh script63aed0ae-faa6-4140-9f11-68777e439fa6 automatically completed narration, ASR, context, planning, prompts, span audio and all four Kie/Fal jobs. Direct-upload1059deb2-418d-4908-9596-5248f22537f7 queued its original ASR without TTS. All ASR/span rentals are CLEAN.

Final render exposed legacy0033 treating the waiting Cloud ASR as active personal CPU capacity: exact persisted render submission returned409 HOSTED_CPU_ACCOUNT_PROJECT_ACTIVE.255 excludes queued Cloud PLANNED/OUTBOXED attempts from this legacy personal guard. Actual Cloud execution still requires the independent reservation, VIDEO admission and provider capacity fences; running Cloud and Local project limits remain. Focused guard regression and19 full-schema privacy/admission/inventory tests pass; native PostgreSQL trigger and rollback verified against the actual queued lineage. Migration apply and resume of the same errored API Workflow remain pending at this source checkpoint. Accepted media will not be regenerated.

## Final application publication and recovered script artifact

Final application2086a71c7351eb5006121d73beb122f74c043acc / Workerd86e7757-8f10-461d-b675-99fdb4493de8 has100% traffic.255 is applied;53 bindings,26 secrets,three Workflow identities/native pins and29 exact public assets verify.247 affected UI tests rerun green, both production/staging quarantine builds pass. The final small file-input correction clears a superseded read before rejecting a replacement file.

The script canary needed operator-assisted recovery of the pre-fix render deadlock. A partial Workflow restart retained its prior failed step; an exact persisted CPU submission then returned202, and a full restart of the same API Workflow read all four accepted assets and completed RENDER_SCHEDULED without new generation. This is recovered production evidence, not an uninterrupted post-fix script run. Uploaded-audio regression continues automatically and separately proves the normal final handoff.

Script renderacaaf843-9190-4c5a-9185-13be18b65d08 is SUCCEEDED/CLEAN:18.033008s,1920x1080,H26430fps,AAC48kHz,3823125bytes,SHA25657befc64f66a068b97063a14a9da6137ee260ed850bdedcf215d4b1165abe938. Full FFmpeg decode passes. Real Chrome played the exact downloaded artifact from a private loopback player continuously to ended=true without error. This is distinct from product-page playback: the connected production Chrome account has no ready avatar, so live Create requests use the authorized operator API; fixture browser Create and live form/voice preview are separately verified.

Fresh deployed Chrome confirms no Generate voiceover button, script-and-voice readiness and41 B-prefix results. The unrelated missing avatar remains correctly blocking. No auth bypass or cross-account browser impersonation was used.

## Final acceptance and cleanup

Direct-upload project1059deb2-418d-4908-9596-5248f22537f7 proceeded from its waiting ASR through all automatic stages, without TTS or manual stage continuation. Render e77dff77-da3c-43ac-9351-62c4037fa945 succeeded:19.100000s,1920x1080,H26430fps,AAC48kHz,3902339bytes,SHA2564da99c27815f874c80e220a8f1891e02552a4d704b062b07d7fdc446f6fb5aad. Full decode, sampled frames and continuous real Chrome loopback playback to ended=true pass. Both exact artifacts pass owner200,1024-byte range206, foreign404, authorized test Review approval and final download200.

All seven test Cloud reservations are CLEAN with cleanup timestamps; owned active CPU/TTS/Cloud/provider leases are zero. Full provider inventory at final check contains zero Pods. Conservative rounded-minute Cloud estimate is USD0.0978518519, not an invoice; two new J1TTS jobs total, no duplicate or uncertain-generation replay, bounded two media canaries plus archived timing probe. J1TTS per-call pricing and final invoices remain unverified. Local playback server/test tabs closed; unrelated work preserved.

Final focused checks also include247 UI tests after the final input correction,20 queue/privacy/admission/schema checks and10 existing Cloud access/recovery checks. These overlap earlier suites and are not a whole-repository CI claim. Context validation retains known optional-reference warnings. Historical full Local device, long-form editorial/performance and invoice gates remain separate. See [structured receipt](2026-10-04-script-pipeline-release.json).
