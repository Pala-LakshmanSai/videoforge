# Team access review handoff — 2026-10-01

Checkpoint: V2-09 / VF-10-09. Branch: `codex/team-access`, based on application review base `c809c697` (production source `3932c982`).
Implementation identity: the Git commit containing this report. Review PR targets the current
published `codex/cloud-pay-per-video` branch because default `main` contains bootstrap code.

## Behavior and scope

Frontier 5's `hosting/worker.mjs` and `hosting/pages.mjs` are the behavior reference: one-use
email-bound Google invitations, member list, revoke and restore, with a private studio per assistant.
Only the two user-selected manager identities can administer admission; workspace ADMIN membership
is insufficient. UI visibility, authenticated API checks, and PostgreSQL independently enforce this.

- Native account disclosure with Team access and existing sign-out behavior.
- Responsive invitation/member cards; code copy/dismiss, member search, refresh and confirmation dialog.
- 72-hour random single-use codes; raw codes stay in the issuing browser and never reach PostgreSQL.
- Replacement invitations revoke the previous code and preserve its immutable history.
- Revocation deletes all browser sessions, fences fresh sign-in/session scope, and preserves tenant data.
- Restoration returns the existing private studio after a fresh Google sign-in. Owners are protected.
- Existing jobs, worker leases, accepted artifacts and provider cleanup are preserved.

## Validation

- `pnpm --filter @videoforge/web exec vitest run src/server/hosted/team-access.test.ts src/hosted/TeamAccessScreen.test.tsx src/hosted/HostedStagingApp.test.tsx src/components/AppShell.hosted.test.tsx src/server/hosted/invite-redemption.test.ts src/server/hosted/product.test.ts`: 142 passing.
- `node --test packages/control-plane/tests/hosted-team-access.test.mjs packages/control-plane/tests/schema-inventory.test.mjs packages/control-plane/tests/hosted-invite-code-redemption.test.mjs`: 10 passing, including full schema application and existing exact-code admission regressions.
- `pnpm --filter @videoforge/web typecheck`: web and Worker pass.
- Focused ESLint and formatting checks pass. Dependency packages build successfully.
- `pnpm --filter @videoforge/web build:cloudflare`: production Worker/client build and unchanged bundle quarantine pass. Tenant/account administration routes load on demand to preserve the static Worker entry budget; the budget was not relaxed.
- Real installed Chrome against an isolated local harness using the actual API handler and PGlite PostgreSQL migration: both owner entries, assistant direct-route refusal and hidden entry, invitation creation/copy/dismiss, member revoke/restore, pending-code revoke, Escape/outside dismissal, and responsive layout. Local identities are explicit disposable fixtures; this does not prove production Google OAuth.
- `node scripts/context-validate.mjs`: selected task/profile/branch and evidence pass; inherited optional-reference/profile-size warnings remain.

Screenshots contain disposable member data and no invitation code:

![Desktop account menu and Team access](team-access/desktop.png)
![Narrow Team access](team-access/narrow.png)

## Release and remaining gates

Migration `0238_hosted_team_access.sql` and runtime EXECUTE grant are prepared. Production database,
real invitations/sessions/permissions, Cloudflare deployment, providers and personal workers were
not changed. No paid generation/compute or external provider call occurred. No compute started by
this task needs shutdown; concurrent work and pre-existing reconciliation are untouched.

User review and merge approval remain required. After approval, apply 0238 with normal migration-owner
tooling, verify the configured runtime has EXECUTE, publish the reviewed application, and check both
real Google owner sessions plus a disposable assistant invite/revoke/restore flow. Do not call the
production feature qualified before those checks. Rollback the app while retaining the migration and
revocation fences; do not drop revocations or re-enable deleted sessions during rollback.
