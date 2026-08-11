# VF-REL-01 — Vendor-neutral correlated telemetry port

Status: exact provider-free implementation brief; dependency-ready after VF-DX-01

## Goal

Add a runtime-neutral telemetry contract and deterministic in-memory proof for correlated lifecycle,
latency, retry, cost, and redaction-safe failure events without choosing or calling a vendor.

## Context read profile

Use `reliability_telemetry_foundation` from `MANIFEST.yaml`.

## In scope

- Define an injected telemetry port for request, workspace/project, task, attempt, stage, provider
  operation, retry, queue-wait, duration, cost, event-sequence, outcome, and redaction-safe error
  fields. Optional correlation remains explicit; no ambient global singleton.
- Validate bounded names/values, finite non-negative timing/cost, monotonic per-stream sequence, and
  canonical plain-data snapshots. Reject raw prompts, media bytes, URLs, headers, stack traces,
  credentials, or secret-shaped fields.
- Provide no-op and deterministic in-memory adapters. Instrument one fixture/local orchestration
  seam without changing decisions, persistence, wire DTOs, or provider behavior.
- Add focused unit/adversarial tests for ordering, concurrent streams, retry/cost lineage, failure
  redaction, immutability, and adapter failure isolation.

## Out of scope

- No telemetry vendor/SDK/exporter, network call, metrics backend, dashboard, alert, route/UI, schema
  migration, product behavior, credential, cloud resource, provider call, model/GPU action, or spend.

## Ownership

- Lane owns a new control-plane telemetry module and focused tests only. Root scripts, lockfiles,
  shared contracts, route composition, CI, docs, and context remain integration-owned by VF-DX-02.

## Acceptance

- Focused telemetry tests pass with exact event assertions, zero network activity, and injected
  failing-sink proof that domain state remains correct.
- Existing control-plane tests, `pnpm verify:fast`, forced `pnpm verify`, context/schema validation,
  secret scan, Prettier, and diff check pass at `$0` after integration.
- Evidence: `evidence/acceptance/VF-REL-01/vendor-neutral-telemetry`.

## Safety and rollback

- Provider calls, credentials, downloads, remote/cloud mutations, and external spend are forbidden.
- Roll back with normal Git revert; no external cleanup exists.
