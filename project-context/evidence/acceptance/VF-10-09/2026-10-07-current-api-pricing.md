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

## Qualification

- 509 tests across project-api-cost, product, screens and CloudCompute passed.
- Web/Worker TypeScript, web ESLint, both builds and bundle quarantine passed.
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
including native/cost-reader-private.json. Publication/readback is pending; final
receipt identities must be recorded after activation. Preserve existing Workflow
IDs and active jobs; singleton adoption only at the durable idle guard, with no
replacement instance. Do not claim runtime adoption from Worker publication alone.
