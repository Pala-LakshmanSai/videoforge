# Prompt content correction — 6 October 2026

Checkpoint V2-09 / VF-10-09. Base eb10804bee63 includes the separately owned ASR parser fix. Work is isolated on codex/sujal-prompt-fix; the dirty primary checkout is preserved.

## Confirmed cause

A 256-scene, 26-batch production plan saved 46 scenes in its first five batches. Batch six returned ten correctly identified scenes and valid JSON. Scene seven's required action requested marking a point on a paper sea chart. The original result reported USD 0.069174. Its one bounded replacement requested a hand-drawn paper sea chart with a compass rose in the required subject and reported USD 0.058104. Both violate the permanent no-graphics contract. Exact private receipt replay rejects only that scene in both responses; the other nine pass. This is a provider-content failure, not account/device-specific ASR, malformed JSON or an exhausted token budget.

The replacement reused the same system instructions and lacked corrective guidance. Financial adjudication safely ended the run at HOSTED_PROMPT_OUTPUT_INVALID, with USD 0.404473 cumulative known prompt cost settled and the rest of the USD 6.50 reservation released. The user subsequently cancelled generation. Cancellation and saved provider receipts remain authoritative.

## Repair

New plans select immutable no-graphics-v1 / request v28, inheriting physical-placement-v2 and explicitly excluding charts/maps/compass roses even as historical props. Navigation should use source-supported sailors, instruments, stars, ocean or shore. Existing v24–v27 requests, UUIDs, sealed plans and compiled prompts stay unchanged. Bounded replacements can append only the exact trusted corrective suffix and receive a distinct content-repair-v1 identity. Recovery and saved-prefix continuation reconstruct and compare exact canonical bytes/hash/UUID.

Additive migration 0278 changes only two existing request-comparison boundaries through a pure exact-match helper. Payload, model, output budget, price/settings, tenant, one replacement, owner-only one resume, known-cost settlement and reservation fences remain. No validation relaxation, arbitrary model prose repair, new retry loop or cancelled-generation revival is introduced.

## Verification

285 pipeline tests, 88 focused web/provider tests, 10 database tests, web/Worker/pipeline types and both production builds pass. Native PostgreSQL transaction rollback proves exact suffix allowed; model, messages, temperature and arbitrary added instructions rejected; original 46 saved scenes, settled run and cancellation remain byte-equivalent. Runtime/public operator resume access remains denied. Historical golden request/hash and sealed-plan recovery tests pass.

Context validation and secret scan pass. Canonical `pnpm verify` was run once: it remains blocked by 127 inherited formatting files and the missing repository-local uv 0.8.13 tool; no unrelated files were reformatted. Publication and real Chrome acceptance are pending. External provider compliance is probabilistic; the mandatory guard still blocks forbidden output. This change cannot guarantee every future provider call succeeds. Full-film, editorial, broad historical CI and invoice gates remain separate.
