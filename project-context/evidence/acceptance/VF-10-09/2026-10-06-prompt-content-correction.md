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

Context validation and secret scan pass. Canonical `pnpm verify` was run once: it remains blocked by 127 inherited formatting files and the missing repository-local uv 0.8.13 tool; no unrelated files were reformatted. External provider compliance is probabilistic; the mandatory guard still blocks forbidden output. This change cannot guarantee every future provider call succeeds. Full-film, editorial, broad historical CI and invoice gates remain separate.

## Published acceptance

Executable `178a809c59a7c0e555605847e7d889f2482aa9be` / Worker `f8c58190-13dd-4350-b154-166694fff1f1` was verified at 100% traffic. Native migration 278 matches manifest checksum `sha256:f6cba6628c011246ae655eb348674f23f887e1d359131763a5b79e844276c474`; no customer rows were mutated. All 55 bindings, 27 secret names, three Workflow identities, qualified Cloud pins and Desktop 0.1.51 remain. Thirty-six public application asset hashes match; `.assetsignore` and `.vite/manifest.json` are excluded build-control files. Anonymous private project access returns 401. Registration refresh preserves routes/domains/crons, and the canonical idle driver runs on new registration `2b0c4e72-a19a-4a05-be12-03de7a24378f` with an error-null successful tick. No new Workflow instances; the existing observer was restarted only after all four active-workload counts were zero. Historical unsettled Cloud ownership remains unchanged.

One distinct v28 provider canary uses the exact failed ten-scene input, with no original generation revival. One HTTP post, no retry, reported USD 0.064365 under the finite USD 0.25 cap. All ten outputs pass the unchanged writer and image compiler. The formerly invalid seventh scene now describes a wooden ship's bow cutting through dark ocean water on a pitch-black night sea. All canary work is terminal; no image/video inference, GPU/Pod/resource creation or compute start/stop. This proves this request's acceptance, not universal provider compliance or image quality.

Real signed-in Chrome verifies Queue, Local/Cloud-ready Create, Library and retained Review navigation. Existing 180-second 1920×1080 output reaches readyState4/error-null and plays from 0.157354 to 10.884938 seconds without error; retained 20.333008-second media also loads valid metadata. No new video was created. Final native readback deep-compares the original settled prompt run and cancelled generation with their private preimages and confirms all 46 scenes remain. The user's later cancellation is preserved; resume preference is pending and no paid replay/resume occurred.

The other chat's ASR fix is included through ancestor eb10804; its Desktop 0.1.52 promotion is separately owned and must fresh-capture this publication before changing its single manifest binding. No force push or dirty-primary-checkout edit. [Sanitized acceptance](2026-10-06-prompt-content-correction.json).
