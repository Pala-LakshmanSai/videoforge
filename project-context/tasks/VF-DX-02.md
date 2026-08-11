# VF-DX-02 — CI and owned-development convergence

Status: exact provider-free implementation brief; dependency-ready after VF-DX-01

## Goal

Split hosted verification by responsibility and make local onboarding/ownership diagnostics
machine-readable without weakening the canonical gate or changing product behavior.

## Context read profile

Use `devex_ci_onboarding` from `MANIFEST.yaml`.

## In scope

- Split GitHub Actions into static/contracts/security, TypeScript, Python, Workerd, and installed-
  Chrome jobs plus one fail-closed aggregate job suitable for a single required check.
- Install Chrome and FFmpeg only in jobs that use them. Preserve pinned actions/tools, dependency
  audit, Gitleaks, exact fixture mode, and every current suite with zero new skips.
- Record job timing; publish JUnit when an existing runner can emit it without weakening output, and
  always publish bounded failure artifacts for Workerd/Chrome. Do not add a reporting dependency
  solely for formatting.
- Centralize non-secret environment-name metadata used by doctor/dev policy. Add stable
  `pnpm doctor --json` output with version, prerequisite, environment-name, provider-free, port, and
  ownership results; never include values/secrets.
- Add ownership-checked `pnpm dev:stop`: stop only the process recorded by VideoForge whose PID,
  commit/mode/health identity, and strict port ownership still match. Stale, foreign, or ambiguous
  state fails with recovery guidance.
- Refresh README/onboarding/playbook and add deterministic script tests.

## Out of scope

- No workflow dispatch, push, branch-protection change, required-check mutation, cloud resource,
  credential, provider, product/API/UI/schema/database/telemetry, model, GPU, or spend action.

## Ownership

- Integration owner owns `.github/workflows/**`, root scripts/manifest, docs, and context.
- `VF-REL-01` may edit only its telemetry module/tests in parallel; shared files serialize through
  the integration owner.

## Acceptance

- Workflow syntax and dependency graph are inspectable; every old check maps to exactly one owning
  job and the aggregate fails unless all required jobs pass.
- `pnpm doctor` remains human-readable; `pnpm doctor --json` is deterministic, valid JSON, redacted,
  and exit-code equivalent.
- `pnpm dev:stop` passes owned start/stop/restart tests and rejects foreign/stale processes without
  signalling them.
- `pnpm verify:fast`, forced `pnpm verify`, focused script tests, context/schema validation, secret
  scan, dependency audit, Prettier, and diff check pass at `$0`.
- Evidence: `evidence/acceptance/VF-DX-02/ci-onboarding-ownership`.

## Safety and rollback

- Provider calls, credentials, downloads, remote/cloud mutations, and external spend are forbidden.
- No push or hosted workflow run is required for local technical completion; hosted status remains
  unverified until separately authorized publication.
- Roll back with normal Git revert of narrow commits.
