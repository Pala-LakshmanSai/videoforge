# Prompt-stage reliability follow-up — 7 October 2026

Checkpoint V2-09 / VF-10-09. Source `88e54f5b4f71072bb71049506c93085a38a8833e`
is pushed on `codex/gpt6-luna-prompt-writer`. Native migrations284–286 are live.
Production Worker remains `aa60628f-571d-4503-bef1-7ab31a314bc1`, executable
`eae84263703aa8900bf3aeca466bc90d53d03612`, requestv38/profile8. Candidatev39/profile9
is not yet provider-qualified or published.

## Causes and preventive changes

- A grounded174-character scene was rejected by the shared168-character scalar even though
  its actual Kie prompt was777/800. Fresh immutablev39 derives each exact scene ceiling from
  its pinned compiler, style, role, layout and extra keywords. The follow-up replay exposed optional
  negative-style filler counted as mandatory by the tiny baseline. Freshv39 now excludes only
  optional filler: the same scene has a196-character safe budget and remains777/800 downstream.
  Existingv38 defaults and golden request bytes stay sealed.
- An actual production progress request produced nineHTTP500s: runtime permission to read
  `execution_profiles` was absent. Migration286 grants only `id` and `revision`; table-wide,
  configuration and account columns remain denied under forced account RLS. The same progress
  page now loads, and its existing final video plays and accepts a native seek in Brave.
- Receipt persistence retries only exact idempotent database writes after transient/lost-COMMIT
  failures, at most three attempts. Integrated tests require one provider POST and zero replay.
- Migration284 serializes all prompt-claim paths against cancellation. Unresolved paid work
  cannot be discarded by cancellation. Profile8/9 automatic continuation requires a durable
  receipt; an UNKNOWN outcome without that receipt requires attention and cannot resubmit.

## Verification

The prior source passed121 focused prompt/recovery tests,324 pipeline tests, all21 package build/lint/typecheck tasks,
49 downstream Web tests,44 installed-Chrome desktop/compact journeys and native/PGlite
0284–0286 tests pass. Native PostgreSQL tests cover both claim/cancellation transaction winners.
The earlier source-only formatting pass changed no behavior; its superseded198-file manifest was
`sha256:f3f38d04867e527ae3a1b0c33fb127c5fd5aec4ea31dd0318b2619939d584d6b`.

The required-only follow-up additionally passes76 Kie/prompt/recovery tests and Web typechecks;
independent source review found no blocker. Its archived174 replay uses zero provider calls.

Production migration application used a rollback-only dry run and fresh idle guard. Existing
profile/run/claim/checkpoint/request row hashes, historical journal entries, capability ACLs and
forced RLS survived unchanged. Private evidence is retained under
`.videoforge/prompt-pipeline-20261007/` in the primary checkout:

| Evidence | SHA-256 |
| --- | --- |
| Native rollback-only proof | `36398bdbfabff769f31082cf06b66dd03208434cfcf0c3aea786dcb73323881b` |
| Native committed/readback proof | `1cc9aa736161fa659fe87312b55cd8c521ab285552a36136cf63979c002c3ec8` |
| Actual progress permission failure | `6c292f2031872c4983e8b36aa729e4cd09adc8f225e8e264599816f46365ae9a` |
| Frozen121-test output | `5ceb1968372825f315ada68715e76d235c00f6c83013a553bfcfc3192bfb0746` |
| Frozen324-test output | `f7f516a002aa736ffe4d506879343161a003cc457ef1b769bd37f8031db8fd5b` |
| Frozen build/lint/types output | `5e54c37e06bd4e2ac92416341651bb515f6a4ba52c9e8ef643f8176fda0d3f95` |

## Remaining gates and spend

The user approved the USD0.35 incremental cap, then reduced fresh qualification to50 scenes.
The first50 image-prompt authority scenes retain the full152-scene source context:5 batches,
at most10 POSTs, one targeted correction per batch, USD0.099840 conservative wire/token ceiling.
The old152 launch stopped before any POST because its private harness passed a per-request
reservation instead of stage remainder; that launch is retired and preserved. The corrected
50-scene actual-dispatch mock reaches one fake POST and persists one claim/receipt before
intentional local output rejection; no network or credential use. Fresh live qualification and
Worker/Workflow publication remain pending. Stop on UNKNOWN, invalid correction or cap risk;
never replay unresolvedv34.
No new inference or GPU launch occurred. Prior liability-inclusive prompt-test bound remains
USD3.099707. Complete RunPod inventory was zero Pods at2026-10-07T02:05UTC; historical
STOPPING/UNKNOWN cleanup and liability remain unresolved. Owned fixture server, disposable
PostgreSQL container and Colima profile were stopped/removed; global Docker context staysdefault.

Canonical CI remains non-green from classified baseline formatting/Python/script and historical
unpublished Mage/SoulX image-pin gates. Those pins were preserved. Fresh full-film, generated-image
visual/editorial, installed Local0.1.52, external availability, throughput and invoices are separate
unproven gates. Existing-film playback and fixture journeys do not prove a freshv39 film. Ordinary
project spend remains intentionally uncapped under DEC_COST_001/DEC_CLOUD_BILLING_001; this does
not remove finite operator qualification caps. Do not promise that external services cannot fail.
