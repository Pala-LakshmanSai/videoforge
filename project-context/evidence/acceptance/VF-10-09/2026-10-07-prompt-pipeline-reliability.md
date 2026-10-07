# Prompt-stage reliability release — 7 October 2026

Checkpoint V2-09 / VF-10-09. Executable `8d0d334f82dfbbc8b46c26c762501418953f95cf`
is pushed on `codex/gpt6-luna-prompt-writer` and published as Worker
`9ae57da8-33d2-4df9-a610-365460800f3c` at100% traffic. Native284–286 are live.
Fresh image-prompt work uses Runware `openai:gpt@6-luna`, Chat Completions,
low reasoning, requestv39/profile9 / `runware-luna-grounded-v2`.

## Exact causes and preventive changes

- The old shared168-character ceiling rejected a grounded174-character prompt whose actual
  Kie request was777/800. A further replay found that the tiny per-scene baseline counted
  optional negative-style filler as mandatory. Freshv39 now budgets required content only,
  including full source, framing, style, exclusions, role/hand guidance and enabled keywords.
  The archived scene gets a196-character safe allowance and keeps the original777-character
  image request. Existingv38 builder defaults, request bytes/UUIDs and golden hash stay unchanged.
- Production progress actually returned HTTP500 because the runtime could not read execution
  profile revisions. Native286 grants only id/revision under forced account RLS; configuration,
  account fields and table-wide reads remain denied. The same real progress page now loads.
- Exact normalized receipt persistence retries only bounded idempotent database writes after
  transient/lost-COMMIT failures, at most3 attempts. Provider POSTs are outside that retry.
- Native284 serializes prompt claims against cancellation. UNKNOWN paid claims cannot be
  discarded or replayed. Native285 admits freshprofile9 alongside immutableprofile8; both
  automatic continuations require a durable saved receipt.

## Fresh50 qualification and spend

User approved USD0.35 incremental within USD6 cumulative, then selected50 scenes. The first50
image scenes were selected after full152-scene authority parsing; global context was retained.
Five batches completed through7 paid POSTs and2 targeted correction requests. Independent
review checked all50 source/context/writer/compiler/Kie tuples with zero grounding, duplicate
or truncation findings. Kie prompts are686–791/800 characters. Each correction changed only
2 failed rows and preserved8 valid originals byte-exactly (16 retained total).

Offline replay of the two initial failures confirmed3 true scene-budget overflows
(217/199,205/196,210/193 characters) and1 required-fact failure at145/199; these were not
remaining shared-budget false rejections. Corrected rows passed the unchanged validator.
Five saved-response recovery checks made zeroHTTP calls. Raw and normalized receipts were
saved before validation; no UNKNOWN request was replayed.

New pinned-rate estimate USD0.009479 is below the approved USD0.35 cap and conservative
USD0.099840 worst-case bound (maximum10POSTs). Prior liability-inclusiveUSD3.099707 plus this
estimate isUSD3.109186 ofUSD6; unresolvedv34 USD0.006429 remains preserved. These are
liability/usage estimates, not a settled invoice. The preceding152-scene private launch stopped
before any POST because its harness supplied per-request reservation instead of stage remainder;
it is retired, preserved and costsUSD0. The fresh50 dispatch mock proved the corrected binding
with one fake POST/one claim/one receipt, no network or credentials.

Final198-file runtime manifest:
`sha256:f163a43eef24b0de086c56d237358558fbfce6f3e9bd4fe0b8df9ede1d5831ef`.
Plan `sha256:a31cc48d8b2438ac7ca3233147ec1a69ef022d62883e78eb61c2cb4c7ba19528`;
harness `sha256:2e70361420c00b50ee4e411e84d398d546abc92f8d379a718cc8cf9c52c7c658`.

## Production and functionality

Fresh build, bundle quarantine and CLI dry run passed before publication. Upload/deploy each
occurred once with write-ahead intents and readback. Cloudflare settings reflect uploaded
candidate variables before active traffic switches; guards compare those separately from the
old active version. A settings-order comparison and initial propagation delay were reconciled
using GETs only; neither upload nor deployment was repeated.

All55 bindings,27 secret names,6 resource bindings,3 Workflow IDs and qualified Cloud/Desktop
0.1.52 pins survive. Registrations now use video69ba9691-fbba-435e-bff8-59ec15980a01,
pairc108a3ed-bb38-4929-b10c-7caa3d132f2d, and continuation03898683-56ec-444b-9d94-6c3ff36b8208.
The existing idle singleton adopted the continuation version with original parameters and a
successful error-null tick (dispatch0,observers0,cloud1). No new Workflow instance or provider
job was created. The Cloud count is the existing historical cleanup path; its stable identity,
FAILED attempt and liability survive, and cleanup remains unverified. Prompt/task/cost/API
preimages remain exact. Workflow source linkage is inferred from the frozen active Worker and
registration update; registered-version runtime adoption is positively verified.

All36 public assets match size/SHA256 (37 manifest entries including excluded.assetsignore);
anonymous private projects return401. Actual Brave checks passed new-project controls,
CloudReady, retained-project progress10/10 with229 saved prompts, LibraryReady, existing final
video play/native seek0:31/time advance0:50, then pause/unmute. Original new-project Local
selection was restored without Create submission. Existing-film playback does not prove a new film.

## Checks, evidence and remaining gates

The predecessor88e54 source passed121 prompt/recovery,324 pipeline,21 package build/lint/types,
49 downstream Web,44 installed-Chrome fixture journeys and native/PGlite284–286 tests including
both claim/cancellation transaction winners. The final required-only patch additionally passes
76 Kie/prompt/recovery tests, Web typechecks/lint, independent source review, exact174 replay,
fresh50 live/output review, final production build/quarantine/dryrun and actual browser acceptance.
No UI behavior changed in this final source patch. Broad canonical CI remains non-green from
classified baseline formatting/Python/script and historical unpublished Mage/SoulX pin gates;
those immutable pins were preserved.

Private evidence under `.videoforge/prompt-pipeline-20261007/` in the primary checkout:

| Evidence | Relative path | SHA256 |
| --- | --- | --- |
| Archived174 no-POST replay | `exact-174-required-only-regression-private.json` | `240e44e74484de77cb89faaa8acfca235c4ac192535e800f204e2773772a92ef` |
| Fresh50 completion | `live-v39-50/qualification-complete-private.json` | `45cff4d3134cdb1562031d51a9bad18036e622b8b4bfe895da9a8679a9808942` |
| Accepted50 tuples | `live-v39-50/accepted-records-for-review-private.json` | `a48dfc9633eff58eb316cfc128ed5187648cb6b627d46832d714721c9d7306fe` |
| Independentall50 review | `live-v39-50/independent-quality-review-private.json` | `de30bae7199505ac87b6b37282c819aeba3d422084473722019510709ffeb25b` |
| Initial correction audit | `live-v39-50/initial-correction-audit-final-private.json` | `df967bc48e6189ac9725c878fd4fed65a6b556190aca3eab592bdf1ac2ed590e` |
| Native committed/readback | `native-release-committed-private.json` | `1cc9aa736161fa659fe87312b55cd8c521ab285552a36136cf63979c002c3ec8` |
| Worker deploy/readback | `release-v39/deployed-v39-private.json` | `7b216d148bf2c8d9e7dc90629e1fc5f1a59a7ac36f079189e81b0a43db5d3559` |
| Workflow registrations | `release-v39/workflow-registration-v39-proof-private.json` | `38ac9beb58278e448f55c807cee38453a02ea7d6121886cdc407ab63edecd06c` |
| Existing idle driver adoption | `release-v39/workflow-driver-v39-promotion-proof-private.json` | `a6e2463de36ccc34e368c6c5d673de4b88d6e7c0f550ac0a21e15399eb8fd75a` |
| Production assets/private401 | `release-v39/postpublish-v39-verify-private.json` | `1ebeb79aa7aca2e625c6dce5de4ed922505a07a3a9175666f8b5919f1589603d` |
| Actual Brave acceptance | `release-v39/production-brave-acceptance-private.json` | `1f7899b268558d01cda73ee24c1e6ecdd12d741d283b4732df9373f52b833834` |

No new media generation or GPU launch occurred. Complete RunPod inventory was zero Pods at
2026-10-07T02:05UTC; historical STOPPING/UNKNOWN cleanup and liability remain unresolved.
Owned fixture server, disposable PostgreSQL container and Colima profile were stopped/removed.
No active task-owned paid compute remains. Fresh full-film, generated-image visual/editorial,
installed Local0.1.52, external availability, concurrency/throughput and invoices remain separate
unproven gates. Ordinary project spending remains intentionally uncapped under DEC_COST_001 /
DEC_CLOUD_BILLING_001; operator qualification caps are finite. Never promise zero provider errors.
