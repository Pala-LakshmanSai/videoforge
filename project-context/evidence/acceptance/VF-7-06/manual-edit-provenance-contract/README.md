# VF-7-06 manual Image Style provenance contract evidence

Checked 2026-08-11 against decision commit
`cd2d74a3bbcd87dd55dc801ab991b20a54e11259`.

## Result

PASS at `$0` in provider mode `fixture`. No application code, migration, machine schema, generated
binding, route, UI, provider, credential, model, GPU, RunPod, staging, or deployment change occurred.

- `DEC_STYLE_007` selects preserve-and-detach. The exact VF-7-04 accepted analyzer artifact,
  response, evidence, alias/reference map, provider/model/settings, attempts, costs, consent, and
  completion facts remain immutable historical source-analysis truth.
- A successful pre-publication creative edit creates a new immutable derived
  `image-style-profile/v1` artifact in the same open version. It records root source, immediate
  parent, derived hash, authenticated actor/time, expected revision, idempotency identity, and
  server-computed creative changed pointers.
- The derived current profile uses `analysis_kind=MANUAL_EDIT`, `overall_confidence=null`, and empty
  evidence/uncertainty/outlier/leakage lists. Source analyzer evidence remains separately available
  and is never presented as describing edited bytes.
- Edit, provenance, pointer/revision movement, and review invalidation are one logical atomic
  mutation. Stale/conflicting/partial/incompatible cases fail without moving visible truth.
- Publication authenticates a new reviewer and pins the exact current artifact. Published and
  abandoned versions reject edits; post-publication changes require a new version and cannot alter
  an old project pin.

## Verification

- `project-context/scripts/validate-context.sh`: PASS.
- `project-context/scripts/validate-schemas.sh`: PASS.
- `pnpm context:validate`: PASS.
- `pnpm secret:scan`: PASS.
- Prettier check for every affected file: PASS.
- `git diff --check`: PASS.

The latest read-only hosted-CI refresh is run `31472597843`, green on public remote commit
`f1eccbe4ef636eb0f0de06953d84cd8d40b12403`. That refresh corrects the stale handoff snapshot; it
does not replace or rewrite historical VF-3-05 evidence and is not a deployment claim.

Manual-edit application behavior remains unimplemented. The next exact task is `VF-DX-01`, which
optimizes only the provider-free verification graph before further media/style implementation.
