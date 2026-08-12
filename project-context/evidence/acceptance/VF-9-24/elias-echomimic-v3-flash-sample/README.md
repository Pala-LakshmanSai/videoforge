# VF-9-24 Elias EchoMimicV3-Flash sample

One bounded RunPod job was dispatched with the pinned EchoMimicV3-Flash image and exact private
10.12-second Elias inputs. The provider created three `EXITED` endpoint worker records before any
inference result or reviewable output appeared. This crossed the task's one-worker/no-retry guard,
so the operator immediately stopped the runner. No second job was dispatched.

The forced stop preceded the runner's normal `finally` evidence serialization. Emergency cleanup
purged the one endpoint queue and deleted the one endpoint and one private template. Independent
inventories at `2026-08-12T15:50:15.348Z`, `2026-08-12T15:51:00.369Z`, and
`2026-08-12T15:52:50.125Z` proved absolute zero Pods, running Pods, active serverless workers,
endpoints, private templates, and network volumes.

The runner read the starting balance before mutation, but the forced stop prevented durable capture.
Post-cleanup balance reads at `2026-08-12T15:50:36.910Z` and `2026-08-12T15:52:50.779Z` were both
`$16.3399985241`, with provider-reported current spend `$0/hour`. The measured balance delta is `$0`
at API precision; this evidence does not reconstruct a missing persisted starting sample.

No MP4 was produced. Result is `STOPPED_PROVIDER_WORKER_RETRY_LIMIT`, not technically accepted and
not ready for user review. Private input bytes remain untracked. Retry is not authorized.
