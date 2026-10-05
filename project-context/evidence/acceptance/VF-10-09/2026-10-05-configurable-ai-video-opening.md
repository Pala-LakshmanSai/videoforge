# Configurable opening — V2-09 / VF-10-09

User-authorized implementation, tests and production publication, 5 October 2026.

Create defaults to Full video opening On and 3 minutes. Users can select 0.1–60 minutes
in 0.1-minute increments. On pins integer opening seconds, scheduler-v10/v11 and
OPENING_CONFIG_V4. Off pins the original scheduler-v6/v7 and WHOLE_SCENE_V2,
including its whole-film percentage denominator, scene spreading and fill behavior.
Historical scheduler-v8/v9 and OPENING_180_V3 remain fixed at 180 seconds.
Whole crossing scenes finish as video; their suffix consumes the remaining budget.
Required footage cannot fall back to an image or avatar. Hard cuts and original
narration remain required. New script, voiceover, preflight and continuation paths
pin the same controls; saved older requests retain their original identity.

## Validation before publication

- Web: 550 passing focused tests; pipeline: 275; TypeScript contracts: 115;
  Python contracts: 97; three PGlite native migration suites; Workerd parity: one.
- Type checks, owned lint/format, schema synchronization, context validation,
  secret scanning, production/staging bundles and quarantine checks passed.
- All six installed-Chrome hosted tests passed, including default/custom/Off,
  minute retention, coverage preservation, invalid input and provider-free controls.
- The broader installed-Chrome suite ran 44 cases on both the feature worktree and
  an unchanged eea53304 baseline with the same installed dependencies. Both had
  28 passes and the same 16 failures. The failing case lists match exactly;
  old fixture selectors/layout/runtime assertions remain separate from hosted proof.
- SQL268 rehearsal used the actual production ledger ending at 267. All historical
  source bytes matched. Explicit rollback restored exact table, function, column
  and ledger preimages. Historical five-argument pin and existing plans were exact;
  private helper ACL and new runtime overload were checked. No provider calls.
- The broad aggregate reports 133 inherited formatting failures and the inherited
  desktop frozen-render import-order failure. These unrelated files were preserved.
  Its owned-dev port conflict was resolved; separate Workerd parity passed.

Production publication and fresh provider artifact acceptance are pending in this
initial record. Private execution evidence is retained under
`.videoforge/configurable-opening-20261005`; credentials are excluded.
The production rollback target remains Worker38d3ea38. Returning to that older
worker requires no new V4 jobs or draining those jobs first; additive SQL268 can
remain for legacy compatibility. Native function/constraint preimages are retained
privately before application. Never replay accepted or uncertain paid work.

## Bounded production acceptance

At most two new projects, USD12 aggregate newly started/reserved liability, eight
temporary CPU rentals of at most 900 seconds each, no retained resources. Stop on
uncertain identity, price/cap risk, unsupported replay or unconfirmed cleanup.
Prior failed/cancelled projects and their USD4.934096 conservative liability remain
separate; the original UNKNOWN request and cost reserve are preserved. Fresh proof
does not establish 30–40-minute throughput or provider invoice totals.
