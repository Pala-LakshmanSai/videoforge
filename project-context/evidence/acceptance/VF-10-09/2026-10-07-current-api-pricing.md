# Current API cost calculator — 2026-10-07

Checkpoint V2-09 / VF-10-09. Baseline executable4b2c9f7d, context3d6fd1f8,
Worker c10de8bb at100%, native286. User requests current Luna/all API pricing
and continues the existing qualified publication authority. No provider inference,
media generation, paid compute launch/shutdown, schema migration or billing-record
mutation is needed. Unrelated primary edits and untracked =875 are preserved.

## Cause and correction

The API projection counted media only and omitted incurred context/scene prompts.
The incurred-cost reader discarded existing Luna PINNED_RATE_ESTIMATE metadata and
could display these estimates as provider-reported charges. The projection also
used a global Seedance literal instead of each sealed plan's rate.

The reader now labels GPT-6 Luna and propagates its estimate basis. All lifecycle
events remain aggregated together per attempt/task, including untagged reservations
and refunds; settled amounts take precedence over reports, refunds subtract once,
and reservations are not charges. The API projection adds known text costs once,
uses the sealed Seedance quote, and stays partial for incomplete text or unconfirmed
charges. Small positive text costs stay visible below one cent. Tenant/project
scope and historical amounts, model profiles, requests, provider guards and Cloud
rental accounting remain unchanged.

## Live verification found a separate preclaim failure

The current35-scene ordinary v39 project failed HOSTED_PROMPT_INPUT_INVALID with
0 accepted rows,0 paid claims,0 reported prompt cost and provider_may_have_charged=false.
Preparation hashed per-batch literal_character_limits; the duplicate dispatcher
serializer omitted those fields. All scene budgets compiled (minimum173), so
this was a binding disagreement rather than invalid scene content/provider output.
The prior qualification computed both sides from the dispatcher helper and missed
the actual preparation boundary.

The canonical document now lives once in runware-prompt-execution and is re-exported
by hosted-prompt-run. Route preparation, recovery and dispatch share the document.
A regression hashes through the real preparation primitives, reaches fake claim(false)
without HTTP, and rejects a changed scene cap before claim. Legacy hash goldens pass.
The exact current35-scene authority now reproduces its saved hash and reaches only
fake claim(false) offline; all original run/task/claim/cost records remain untouched.
Provider request bytes, model/profile9, budgets and retries are unchanged. No paid
qualification or failed-project retry occurred. Private input-diagnostic contains
before/after proof; source changes require matching Workflow registration/runtime
adoption only under the existing durable idle guard.

## Rates and limits

See normative 11_COST_SPEED_BUDGET.md for dated official sources. Runware Luna
public input is $0.10/M; output/cache charges use the existing pinned OpenAI
Standard reference (.50 output/.01 cached/.125 cache write) and are explicitly
estimates, not independently verified Runware invoice tariffs. Output already
contains reasoning. Gemma4-31b context reports provider cost (public .102 input,
.297 output/.012 cached). Kie .004/image and Fal ZImage .005/MP remain published
estimates. FlashHead public .005/second leaves billing unit/account debit unproven;
expected duration is a proxy. Seedance public .0134/second is rounded, existing
sealed .01336 stays exact. J1 monthly plans do not prove per-request cost, so
missing narration remains unknown. Shared infrastructure/preset analysis is
separate; Cloud retains recorded actual rates and confirmed uptime.

## Concurrent publication reconciliation

The initial release guard rejected live baseline drift before writing any upload
intent: bcc51708 / Worker1d029955 had replaced4b2c9f7d. The parallel prompt-binding
repair is now native287 and includes cancellation-compatible zero-claim manual
Retry. Merge2f0aa522 preserves that entire release. Prompt modules/tests, Retry
route, migration and native tests are byte-identical to that production source;
only seven calculator code/test files differ. No migration is applied by this task,
no retry resumes, and active/unknown work remains owned by its separate audit.
The stale local release plan/authority is archived as superseded (zero upload
intents); release-v2 captures a fresh exact baseline and requalifies the combined
source. Existing correct coordinator runtime must remain uninterrupted while busy.

## Qualification

- Combined merged605 tests across calculator, screens/Cloud and prompt
  preparation/dispatch/manual Retry passed. Earlier509 calculator checks pass.
- Additional96 prompt route/run/Luna transport checks passed, including legacy
  goldens and new preparation-binding regression. Final builds/types/lint and
  bundle quarantine passed again after this source change.
- Installed Chrome cost regression passed at desktop1440 and mobile390/320,
  including small text visibility, partial projection, total arithmetic and frozen
  stopped-rental cost. No provider dispatch; fixture auth proxy noise is inherited.
- Production restricted-runtime read-only SQL matches owner cost aggregates and
  excludes foreign-account projects. Native cost_events.details SELECT is allowed.
- Context validation and tracked-file secret scan passed; known optional-asset and
  unrelated profile-budget warnings remain. Broad CI's prior116format/Pythonlint
  failures remain separate; no full-pipeline invoice/editorial claim is made.
- Independent cost review found no remaining math/tenant/identity issue. Release
  helpers separately guard source/build/config/asset identity and no replay.

Private proof root: .videoforge/current-api-pricing-20261007 (primary checkout),
including native/cost-reader-private.json. Publication and signed-in readback are complete; final receipt identities are
recorded below. Preserve existing Workflow
IDs and active jobs; singleton adoption only at the durable idle guard, with no
replacement instance. Do not claim runtime adoption from Worker publication alone.

## Published result

Executable24b89c501a4ca8c617ebfcfc86ba1cbf31401a1b is pushed and active at100%,
Worker588916b9-5f39-465b-b0d5-da90575505f7. Bundle SHA-256
dbfae4ecc3dc85eecc6758fbecaa8e5f30df2c8e0bba5e38fa00a36ee9519b04.
All36 public assets match hash/size; .assetsignore remains metadata, private
projects returns401. All55 bindings,27 secret names,six resources and
Cloud/Desktop0.1.52 pins remain exact. Native287 is inherited without mutation.
The existing three Workflow IDs/configuration are preserved and registered:
video2cd50fa5-c35f-4bdb-80b4-3798e6085506,
paird0e2ab91-7e13-47f9-b160-89cab47b3cc7,
continuationd1669661-1ff8-4137-8f95-1b80641df828.
The correct bcc dispatcher remains running at ef82327a with error-null; no singleton
or user-job restart, no new instance. No execution-source difference from bcc
exists, so calculator delivery does not require interrupting current work. The
new registration's Worker linkage is inferred where the API exposes no pointer.

Real Chrome verifies current private project HTTP200, visible four-decimal text
cost, partial forecast and partial API-plus-stopped-Cloud total, zero console
errors. The old project URL returned404; read-only database status confirms ARCHIVED.
Its complete failed run/task/attempt/cost fingerprint remains exact,0claims/no
provider-may-have-charged. It was not retried by this task. The newer prompt
UNKNOWN outcome is owned by the separate active audit; this calculator does not
clear it or claim full pipeline/invoice reliability. Screenshot/private browser
proof live in the task's primary private directory.

Worker upload and deployment each ran once; each existing Workflow PUT ran once.
Several private metadata checks failed closed before remote operations: concurrent
baseline drift, branch selector merge, logging filename mismatch and stale helper
path/URL/status-field schema. Correct source/context or recorded byte-identical/
fresh-read normalization resolved them; raw records and old authorities remain
preserved. Never replay a submitted publication to repair local proof metadata.
Private release-v2/readback-private.json, workflow-registration-proof-private.json
and final-runtime-private.json retain exact readbacks. Main publication authority
is immutable; a separately hashed registration authority references it. Existing
provider uncertainty, account invoice/discounts, broadCI117format/Pythonlint,
full-film/editorial/throughput and historical cleanup gates remain open.
New inference/media/compute actions by this task:0. No fresh Pod inventory claim.
