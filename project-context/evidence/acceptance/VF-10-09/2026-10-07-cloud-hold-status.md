# Cloud hold and historical machine status — 7 October 2026

Checkpoint V2-09/VF-10-09. User requests repair and production publication, plus GPU/region fallbacks if capacity is unavailable. Baseline executable3b4ea555 / Workera259ef3d / native294, prior evidencef1a6ed25.

## Exact cause

The affected generation is RETRY_WAIT with available_at=infinity, intentionally held after prompt-only verification; its lease is RELEASED, all276 prompts are accepted, and there are no downstream media jobs or unsettled project rentals. Native readback confirms generation_held=true. The displayed RTX PRO4500 was the earlier ASR rental, already CLEAN. No current audio-span attempt exists and there is no provider capacity refusal. The API omitted indefinite-hold semantics and the frontend mapped a missing attempt to the generic Waiting for cloud status label.

## Repair and regression proof

Scoped project queue SQL derives generation_held only from RETRY_WAIT plus infinite availability. The response retains RETRY_WAIT, exposes HOSTED_GENERATION_HELD, and removes false position/ahead counts. Finite retries and existing cleanup blockers remain distinct. The frontend reports Paused, preserves saved work, blocks automatic/media-resume dispatch, and labels unstarted stages Not started rather than implying a missing Cloud heartbeat. Held prelaunch PLANNED/OUTBOXED Cloud attempts remain paused; running/submitted/reconciling work retains its status. Released compute says No active RunPod compute and Previous rental.

Original held/unstarted/machine-label regressions fail before the patch. Final UI283, projectAPI241 and existing placement157 checks pass; types, builds, focused lint/format and diff checks pass. Full web run reaches3333pass/1skip but four legacy local PGlite tests fail with no-space/active-portal errors; isolated recheck is recorded below. This is not a production capacity error. Context/secrets gates and independent review required before publication.

## GPU and region coverage

Existing GPU policy ranks18 types, admits other eligible NVIDIA catalog models, requires secure/non-MIG/minimum16GB/reported stock and bounded all-in GPU+disk rates. GPU creation has no dataCenterIds restriction, allowing provider placement across eligible Secure Cloud regions. Four bounded observations per step, three rounds and180-second placement deadline remain. Only a definite capacity refusal and complete empty inventory permit another create; unknown outcomes never replay. CPU fallback exists but is not enabled in production and requires separate qualification. No extra fallback activation is warranted for this held request. Provider-free placement tests157pass.

## Scope and release boundaries

No new inference, media generation, rental, database mutation, or release of the downstream hold is authorized/performed. No schema migration. Existing continuation code/configuration and all runtime pins remain unchanged; publication will preserve55bindings/27secrets,37public assets and threeWorkflow identities, refresh registrations and retain the healthy unchanged singleton. Verify native held state, complete saved prompts and real Chrome after release. Future provider stock and availability cannot be guaranteed.

Isolated rerun of the three affected legacy files passes all5checks. The first full-suite result remains recorded as non-green due to local resource errors; Mac reported3.9GiBfree. No unrelated database/runtime source was changed.
