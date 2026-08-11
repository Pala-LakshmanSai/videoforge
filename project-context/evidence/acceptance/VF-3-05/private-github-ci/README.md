# VF-3-05 GitHub/CI evidence

Checked 2026-08-11 against local/remote source commit
`c23ab438b44e2b68751be341b0dac17a6fcc5dc1`.

## Result

PASS — public remote exact; hosted CI green.

- `Pala-LakshmanSai/videoforge` has `PUBLIC` visibility under the user's explicit 2026-08-11
  override and default branch `main`.
- `origin` is the sole remote. Local `main` and `origin/main` matched the checked source commit.
- Hosted run [`31451226265`](https://github.com/Pala-LakshmanSai/videoforge/actions/runs/31451226265)
  completed successfully: full `pnpm verify`, installed Chrome, Gitleaks, and dependency audit.
- The first executable public run exposed missing FFmpeg. The next exposed shallow-history and
  local-optional-asset validation defects, then Linux Chrome exposed font-dependent dock width.
  Commits `ca8a528`, `15c5aad`, and `c23ab43` fixed those repository-owned causes without skipping
  or weakening a gate.
- The exact dock regression passed both installed-Chrome projects locally before the final hosted
  run; fresh-clone context validation also downgraded only declared local-optional assets to
  warnings.
- No provider call, deployment, credential exposure, paid runner, or external spend occurred.
