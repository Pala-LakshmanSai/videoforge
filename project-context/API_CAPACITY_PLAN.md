# Shared API capacity and throttle recovery

Checkpoint V2-09 / VF-10-09, 4 October 2026. User authorizes fixing priority 1 only: API capacity and temporary rejection handling, with a plan through production. Base: c85ccc3ddd8bdc2b741f50adb79b3809b2961664, including production beeaa223 and its image/media-review safeguards. Worktree: codex/api-capacity. No paid test allowance has been granted for this task.

## Outcome and boundaries

Ten accounts may continue independent videos, one active video per account. New paid tasks share durable provider capacity. Available work starts immediately; only excess tasks wait. Confirmed unaccepted Kie, Fal and J1TTS rate-limit responses wait and retry the same immutable input. Runware confirmed refusals retain the exact task identity and require reconciliation; this release does not assume that reusing or replacing a Runware task UUID is free. An uncertain submission never becomes retryable merely because time passed. Existing paid jobs remain observable while new submissions wait.

Preserve models, prompts, scene and avatar counts, quality, tenant privacy, accepted artifacts, costs, cleanup, Local/Cloud selection and existing recovery holds. No additional provider accounts, subscription purchases, GPU changes, shared-credit admission feature or general recovery rewrite. Provider availability and zero latency cannot be guaranteed. This change adds database operations; unchanged inference counts/rates do not establish identical total infrastructure cost.

## Design

1. Reuse Postgres and existing Workflows. Serialize a small durable provider gate before each paid claim. Store only non-secret provider identity, policy, wait order and cooldown. No new queue service or in-memory-only global counter.
2. Separate provider rate, outstanding-task capacity and per-video limits. Kie gets account-wide start pacing. Fal keeps its provider queue with bounded application backlog. Runware uses appropriate model lanes rather than pretending it has a universal published concurrency limit. J1TTS gets narration concurrency and generation rate matching the actual subscription.
3. Order waiting work fairly across accounts. Recheck ownership, cancellation and original job eligibility inside the claim transaction. Do not hold transactions during network calls. Continue status/result observation even when submission capacity is unavailable.
4. Distinguish confirmed rejection from uncertainty. Only documented, positively unaccepted throttles can release a submission claim. Persist an exact claim-fenced rejection receipt and a bounded Retry-After/backoff deadline. Never reset timeout, malformed acknowledgment, missing ID, 5xx or failed ID persistence into a fresh paid attempt.
5. Keep waiting/cooldown durable across Worker restarts. Queued work has truthful nonterminal progress. Cancelled unsent work produces zero provider POSTs; submitted and uncertain work retains its existing reconciliation requirements.

## Ownership and implementation order

- Coordinator: provider clients/adapters, configuration, integration, context, release and final verification.
- Capacity agent: additive media capacity migration and SQL tests; hosted image/avatar/video dispatch and regeneration coverage.
- Voice agent: additive narration state/claim migration, shared J1 submission path, observers and tests.
- Runware text agent: prompt/context/style paid entry points, throttling classification and existing continuation integration.

Shared schema contracts are agreed before dependent edits. Agents use GPT-6.1 Sol. Migrations are additive and registered by the coordinator; no historical migration edits. Review final code and database privileges independently of agent assertions.

## Verification gates

1. Reproduce existing 429 failure behavior with fixtures. Verify typed responses and Retry-After seconds/date/missing/invalid cases.
2. Database: ten tenants, same-job claim races, aggregate rate/capacity, fair admission, cancel-before-submit, stale claim rejection, persisted cooldown, unknown occupancy, foreign-tenant denial and runtime grants. Run native concurrent-session tests where available; PGlite tests alone are not native concurrency proof.
3. Integration: ordinary images, avatars, scene clips, image regeneration, narration from both entry points, Runware prompts and context. A blocked submission must not starve paid-result observation. 429 must not cause a paid quality-replacement attempt.
4. Faults: 429 then success, prolonged throttling, provider failure, POST timeout, lost acknowledgment, task-ID persistence failure, duplicate continuation, restart and cancellation. Assert exact paid POST counts and preserved request/input identity.
5. Existing focused tests, web/Worker types, lint, context/secret checks, both deployable builds and bundle firewalls. Run canonical provider-free verification; record unrelated baseline failures separately and do not label aggregate green if it fails.
6. Real Chrome: existing projects/media, Create upload/script forms, progress and cancellation behavior, no new console/network errors. Provider-free tests establish congestion behavior; a production readback alone is not a ten-user throughput benchmark.

## Production sequence and rollback

1. Capture actual current deployment identity, migration ledger, non-secret binding names, Workflow identities and runtime pins. Stop publication if another release changed the baseline; merge that release and rerun affected checks.
2. Verify account-specific quota settings. Apply new schema in a rolled-back native transaction first. Confirm old application behavior remains compatible with the additive schema. Test migration rollback strategy without deleting existing provider identities or accepted media.
3. Produce immutable reviewed build, migration/grant list, verification evidence and rollback identity. User already requested the path through production; ask only for any additional paid qualification scope with exact finite cap and stop conditions once concrete.
4. Apply additive schema and publish the application with existing secrets, bindings and Workflows preserved. Do not create replacement workflows or resume held paid projects as a deployment side effect.
5. Activate capacity policy with verified values, verify actual database claim behavior, deployed assets/status, private access and Chrome. Observe existing work without replaying it. If regression occurs, disable new admissions for the affected provider while keeping observations, then use a compatible prior build; never roll back schema by dropping active queue/claim data.
6. Bounded real-provider canary and 2/5/10-account qualification require explicit test scope and spend authority. If not authorized, report the precise live proof gap. Do not claim ten-user production throughput from mocked tests.

## Remaining inputs

The user confirms J1TTS costs USD35/month with unlimited generations; concurrent generation and RPM remain unknown. Account-specific Fal/Kie/Runware allowances remain unverified. Initial operational policies are Kie100 outstanding and550ms between starts (published default20 starts/10sec), Fal4 outstanding shared across avatars and image regeneration with250ms starts, Runware video4 outstanding with250ms starts, J1TTS1 outstanding with60sec starts. Fal4 is an application backlog ceiling, not a claim about purchased processing slots. Text model policies enforce shared cooldowns and do not invent a universal concurrency quota. These values are configurable by the database owner; higher verified account limits require no code change. New provider accounts are outside this implementation.

Backups retain immutable rejection receipts. Live policies, cooldowns and fairness tickets belong to native database backup/PITR; a portable restore requires quota configuration and provider reconciliation before admissions resume. Retry-After scheduling hints are bounded to24h and share exponential backoff up to15min; an oversized hint is not evidence that the request was unaccepted.

Rollback keeps migrations and existing identities. The original J1 start/record functions remain compatible during rollout; new intake uses a versioned queue function. Reverting to the prior binary is allowed only when no WAITING narration remains. Otherwise pause new admissions for the affected provider using its durable cooldown while a queue-compatible fix is deployed; continue observing accepted tasks. Never drop queue or rejection records to make rollback possible.

## Completion record

CURRENT_STATE.yaml and the task evidence own commit, commands, results, production identity, remaining gates, provider spend and compute state. Update GPT Space only with verified durable outcomes.
