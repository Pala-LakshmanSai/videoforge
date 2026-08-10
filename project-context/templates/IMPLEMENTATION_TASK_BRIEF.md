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

- `provider_calls_authorized: false` by default; absence means no calls.
- Exact provider/model if authorized.
- Maximum test spend (default `$0`).
- Cleanup/scale-to-zero requirement.
- Private-data/asset constraints.

## Rollback

- Reversible boundary and recovery command/commit.

## Context update

- `none`, or list the decision/gate files to update after user approval.
- Update `CURRENT_STATE.yaml` at handoff with server PID/owner, route, fixture, commit, last green commands, and latest user checkpoint.
