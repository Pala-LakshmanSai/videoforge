# VF-1-07 account isolation, large upload, and avatar reuse

Status: technically verified; VF-1-07 complete

Commit `ffceb6319ff85f7207619df7e0ecd41d20b341d0` composes the provider-free Phase 1
authorization boundary with the metadata-only private artifact router, proves a structurally valid
9 MiB PCM WAV through signed multipart direct transfer, and verifies exact reuse of one immutable
ready Avatar Profile version in two locked project revisions without another upload, compatibility
assessment, generation task, or cost event.

## Isolation and transfer proof

- Two accepted local invitations, active identities, memberships, workspaces, and sessions authorize
  only their exact workspace. A session/header mismatch and an authorized-header/body mismatch both
  return the same non-leaking `WORKSPACE_ACCESS_REQUIRED` problem.
- Cross-workspace exact revision, Avatar Profile version, and artifact reads return generic
  `NOT_FOUND`; artifact binding and project/Avatar archive mutations also return generic
  `NOT_FOUND`; a content-address probe returns an empty result.
- Cross-workspace reviewer authorization is denied before any approval mutation and does not reveal
  the target project identifier. The frozen Phase 1 repository and route contracts expose no rename
  mutation, so a cross-workspace rename is unreachable rather than simulated or claimed.
- The 9,437,228-byte WAV is uploaded in three direct-transfer parts and downloaded through an exact
  hash-bound signed operation. The application handles metadata only: audit truth is 0 application
  body bytes, 9,437,228 direct upload bytes, 9,437,228 direct download bytes, six signed operations,
  and six direct operations.
- Installed Chrome proves Create Project selects an exact ready Avatar Profile version, exposes no
  project-local Avatar upload, and preserves all draft fields while navigating to and from the
  Avatar Hub. The full Chrome suite repeats these checks at desktop and compact widths.

## Audit

The post-implementation read-only audit found no provider, network, credential, secret, spend, or
rename surface in the change. Authorization runs before request-body reads; signed routes validate
the body workspace against the authenticated workspace; the application receives only the
`ArtifactControlPlanePort` and cannot access the byte-carrying direct-transfer facet. Repository
scope is explicit on every read and mutation exercised. No high or medium finding remained.

## Verification

The final uncached `TURBO_FORCE=true pnpm verify` exited 0 at the implementation commit with zero
Turbo cache hits. It passed format, JavaScript/Python lint, typecheck, the complete package and
worker suites, database checks, 47-file contract synchronization, context/schema validation,
tracked-file secret scan, generated-route/build stability, local Workerd parity (1/1), and installed
Chrome (36/36, zero skips). The control-plane suite passed 112/112, the pipeline suite passed 37/37,
and the web suite passed 148/148.

Focused installed-Chrome acceptance passed 2/2 for exact visual presets/no project-local Avatar
upload and Avatar/Image Style Hub draft round trips. Separate `pnpm context:validate`,
`pnpm secret:scan`, `pnpm audit:dependencies`, `git diff --check`, and clean-worktree checks also
passed. The dependency audit reported no known high-severity vulnerabilities.

All identities, workspaces, database rows, media, signatures, and transfer operations were local,
owned, and synthetic. Provider calls remained disabled, external spend was `$0`, and no remote,
cloud/account, credential, model-download, deployment, public-tunnel, or LAN mutation occurred.

