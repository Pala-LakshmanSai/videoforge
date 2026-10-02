# Avatar progress and repeated stop controls

Checkpoint V2-09 / VF-10-09. Parent source fc312257; isolated branch codex/natural-documentary. User requested reliability-preserving UI repair and parallel generation.

## Diagnosis

The screen rendered one stop button per cancellable CPU attempt. Twelve audio spans therefore produced twelve identical controls. The cancellation API remains per-attempt: grouping controls must preserve exact job selection and two-click confirmation.

Native read-only production records for the reported project prove image/avatar overlap: first image submitted 2026-10-02T16:17:40.982739Z; first four avatars submitted 16:17:41.534610Z–16:17:41.591774Z. Last image accepted 16:21:14.329237Z; first avatar accepted 16:23:13.354285Z; final avatar accepted 16:24:49.103345Z. All 34 images and 12 avatars succeeded. The project-detail generation ID is the runtime ID, not the generation-request ID; filtering API-job rows by project resolved this distinction.

The first four avatars required 331.8–352.9 seconds between persisted submission and accepted output; subsequent eight required 28.1–46.2 seconds. Read-only Fal status GETs for the original five requests returned COMPLETED and inference_time 6.3–9.8 seconds. Exact historical queue/start/download timings are unavailable; queue or cold-start diagnosis is an inference, not proven. No image-completion gate exists in the API scheduler. Existing eight-image/four-avatar caps, unknown-submit replay fences and sequential bounded media observation remain unchanged. All audio spans must currently be materialized before API dispatch; removing that independent barrier without complete-coverage gates would be unsafe and does not explain this screenshot.

## Repair

Group cancellable CPU attempts by operation; provide a labeled job selector when multiple jobs are present. The action cancels the selected exact job. Preserve selection across polling, two-click and timeout/state confirmation guards, cancellation recovery, and disable controls during the pending mutation. A synchronous fence blocks duplicate mutation clicks.

Expose optional API counts from already-read durable job states: SUBMITTED = sent/awaiting accepted results; PREPARED = waiting to send; SUBMITTING = being sent. Show these beside accepted progress. Do not invent exact provider queue state or poll the provider from the UI. Historical GPU progress retains its existing behavior.

## Validation and publication

179 UI tests plus the added failed-cancellation retry regression (seven focused cancellation checks), 111 product tests and 32 API scheduler/execution/span tests passed. Web/Worker TypeScript, touched-file lint, production build, bundle firewall and context validation passed; independent review found no blocking issues. A separate generation-query test fails because its fixture lacks segment.end_frame_exclusive; the same failure reproduced at unchanged HEAD 2a7d1296 in an external scratch checkout. Published source d3ca02764ab6afa53de613084fc79a67ded0aa22, Worker b127f9f1-9314-4841-a311-0e96a754e77c at 100%. Exact public hashes of four client assets and authenticated catalogs for two accounts passed. Live original-project progress includes all three new counts; accepted 34 images and 12 avatars remain intact; the other account is denied access. Fifty bindings, twenty-five secrets and three Workflow identities were preserved. No schema change or new Workflow instances. A stale public status response was reconciled with read-only uncached retries; no deployment replay. Private diagnostic records live under .videoforge/avatar-ui-stall-20261002; never publish raw sessions, credentials, provider IDs or customer media.

No new image/avatar inference, CPU/GPU launch, cancellation, workflow instance, or schema migration is required by this repair. Existing jobs and artifacts are preserved. Chrome transport is unavailable; real Chrome click acceptance remains unverified. GPT Space read/update unavailable (RPC UNAVAILABLE); no Obsidian fallback.
