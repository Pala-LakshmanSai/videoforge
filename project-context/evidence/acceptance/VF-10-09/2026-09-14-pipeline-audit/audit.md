# Pipeline audit — 2026-09-14

Checkpoint: V2-09. Scope: evidence-led repair of the failed production flow and shared stage boundaries. No new inference, GPU job, deployment, migration, endpoint change, or model download was performed.

## First failure

The user project `bd11943b-b63d-4eb6-9768-bbc2ab01989d` has 1,091,553 ms of narration (18 minutes 11.553 seconds). Input preparation and ASR completed. The context attempt persisted `UNKNOWN` with `VOICEOVER_CONTEXT_INVALID`; planning and later stages never started. The original result failed local context validation. Its exact invalid field or bound cannot be proven from the available archive.

Read-only R2 retrieval verified the ASR checksum, attempt identity, and transcript checksum. Reconstructing the unchanged v9 request matched the durable request hash. Runware `getTaskDetails` returned HTTP 200 for that exact task, but its response text contains `REDACTED 518 bytes`. The later `VOICEOVER_CONTEXT_JSON_INVALID` shown during recovery is therefore an archive-validation symptom, not proof of the original response shape. Cloudflare historical telemetry requests returned 403; no original invocation log is claimed.

## Repairs

- Normalize surrounding whitespace before counting a fenced JSON object; independent objects remain rejected.
- Bind new provider task IDs to the persisted context identity, so separate projects with identical narration do not collide. Old v9 request hashes remain retrievable through an exact legacy reconstruction.
- Remove a delay-only retry loop that returned the same cached ambiguous transport result. No new automatic inference retry was introduced.
- Classify context validation failures using static reasons plus response length/hash, without logging transcript or provider text. Show known validation failure separately from an uncertain network result.
- Accept already-active span-audio attempts when a worker claims the job between retries.
- Verify MP4s when R2 omits the SHA header using streamed hashing and an exact ETag cache. Large files never use the buffered compatibility path.
- Keep completed, approved projects on the final stage and preserve their approved status. Do not offer a misleading generation resume when Mage/SoulX attempts exist.
- Repair server and test type inconsistencies without changing tenant, qualification, spending, or immutable-result rules.

## Stage coverage and limits

| Stage | Evidence |
| --- | --- |
| Prepare / transcribe | Failed project completed both; ASR artifact identity and bytes verified read-only. |
| Context | Original failure and archive retrieval inspected; parser, task identity, no-redispatch and diagnostics regressions. |
| Plan / prompts | Call-chain audit and existing 37-second accepted run; failed project did not reach these stages. |
| Images / avatar | Dispatch and receipt audit, typechecks and focused backend checks; no new GPU run. |
| Assembly / technical check | Span replay and streaming-checksum regressions; existing accepted MP4 replayed through its end. |
| Review | Actual Chrome approval state, final playback and UI regressions. |

The existing MP4 reached currentTime=duration=37.166016 seconds, ended=true, readyState=4, and media error=null. Approval remained recorded and disabled in the UI. Browser console inspection reported no errors. See `approved-video.png` and `browser-observations.json`.

The 30–60-second duration assertion is in the short certification CLI, not the ordinary browser dispatch path. It is not a proven blocker for this 18-minute input. Conversely, the existing short-video acceptance does not prove that the full 18-minute flow succeeds.

## Remaining live gates

Publish and activate the repaired source, then perform one fresh explicitly bounded end-to-end attempt. The original UNKNOWN attempt must not be redispatched or rewritten. A new inference requires a new context identity and finite spend authority. No full-MVP, long-video, concurrency, or release acceptance is claimed by this provider-free audit.

Current provider inventory/rate evidence is in `provider-inventory.json`; existing retained volumes were unchanged. Terminal EXITED records and stale throttled health counters are distinguished from running compute.
