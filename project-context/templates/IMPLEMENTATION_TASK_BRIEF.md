# Implementation task brief template

## Identity and dependencies

- Task ID:
- Milestone:
- Status:
- Dependencies:
- Decision IDs:
- Open gate IDs:
- Base commit/branch:
- Current clean HEAD/ancestor check:

## Goal

One concrete outcome.

## Context read profile

Name the `MANIFEST.yaml` profile and any one extra file genuinely needed.

## In scope

- Bounded deliverables.

## Out of scope

- Adjacent features and refactors.

## Files/ownership

- Expected files or module boundary.
- Other agent ownership/collision notes.
- Explicit shared files that must be serialized.
- Maximum lanes and integration order when parallel work is allowed.

## Acceptance

- Automated test/evidence.
- Live Chrome behavior if visible.
- Baseline journey and expected after-change journey, including console/network checks.
- Cost/model evidence if provider-facing.
- Exact validation commands.
- Live URL/route and fixture scenario.
- Expected `pnpm doctor`, `pnpm dev:status`, and `pnpm verify` outcome.
- Expected commit(s) and evidence path.
- Exact next `CURRENT_STATE.yaml.recommended_next_task` after success.

## Safety and budget

- Checkpoint implementation request and timestamp; this may authorize bounded local code/context
  changes and provider-free activation without authorizing external execution.
- `provider_authority.mode: none | read_only | paid` (`none` by default).
- `provider_calls_authorized: false` in `none`; `true` only for recorded `read_only` or `paid` scope.
- `read_only` scope: exact provider, allowlisted inventory/rate operations, existing-credential
  access, authorization timestamp, `remote_or_cloud_mutations_authorized: false`,
  `model_downloads_authorized: false`, publication/GPU/retention flags false, and cap `0`.
- `paid` scope: exact provider/model/resources/operations, positive numeric maximum cumulative
  spend, non-transferable flag, authorization timestamp, and matching current-state cap.
- Exact selected GPU offering ID/name and current rate/ceiling when applicable.
- Exact endpoint/config/image/model/region/volume identities, scaler, handler concurrency,
  worker bounds, and measured init/execution/TTL/idle settings when Serverless-facing.
- Existing retained-volume identity, capacity, recurring rate, and consent; any proposed retained-
  resource change requires separate exact approval. State that recurring billing is outside the
  finite checkpoint-action cap.
- One combined paid-authorization proposal after local/read-only preflight; record the user's exact
  approval. Ask again only for changed scope/rate/cap/capacity or cap risk.
- Persist outbox/dispatch authority before `/run`; accept at most one canonical output and record
  possible duplicate compute/cost. Never promise provider exactly-once execution or billing.
- Exact request cancellation/reconciliation, zero pending jobs, scale-down to zero workers, and
  independent provider-state proof. Report fixed retained-volume billing separately.
- Endpoint-wide queue purge, model-volume mutation, cross-mount, runtime download, and unqualified
  GPU fallback are forbidden unless a later explicit decision changes the architecture.
- Private-data/asset constraints.

## Rollback

- Reversible boundary and recovery command/commit.

## Context update

- `none`, or list the decision/gate files to update after user approval.
- Update `CURRENT_STATE.yaml` at handoff with server PID/owner, route, fixture, commit, last green commands, and latest user checkpoint.
