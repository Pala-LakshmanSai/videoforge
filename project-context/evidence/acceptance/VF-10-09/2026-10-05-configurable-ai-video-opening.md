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

Core production source470483ce / Worker5f91ff42 at100%, migration268 applied.
All55bindings27secrets3Workflow registrations and qualified Cloud pins were exact;
30public assets and anonymous private-catalog401 passed. The fresh180-second On
run accepted38images38clips, rendered5400frames at1920x1080/30fps, passed native
checksum/full decode and narration correlation0.99903 with zero offset. Real Chrome
played all180seconds to ended=true/error=null; approval and Library retention passed.
Both rentals are CLEAN. This closes this exact full-opening artifact gate.

The second Off20.333s/25% trial failed before rental or generation admission.
Its original Workflow lookup returned404; native preparation event, immutable job
hash and terminal failed attempt are preserved. Existing retry required a failed
generation request that did not exist yet. Additive269 admits only this exact
preparation-failure event with no rental/job/lease/provider identity/output/replay,
retaining every earlier ownership/latest-revision/cleanup/receipt guard. Three native
guard suites and an actual-failed-attempt rollback rehearsal passed with exact
function/row/ledger preimages; native apply changed only that helper, preserving ACLs.
Supported Chrome retry now advances the same saved project on scheduler-v7,
WHOLE_SCENE_V2/25%/0opening, without reupload or paid-task replay. Export remains running.

UI refinement255tests and all six Chrome tests pass, including418px screenshots,
hidden Off duration, retained custom value, zero-second submission and keyboard focus.
Both bundles/types/owned formatting pass. Refined UI publication remains pending.
Private execution evidence is retained under
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
