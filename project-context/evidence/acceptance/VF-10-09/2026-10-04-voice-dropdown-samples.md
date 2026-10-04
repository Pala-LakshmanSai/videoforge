# Script dropdown voice samples

V2-09 / VF-10-09. User requests hearing each voice directly in the script dropdown, continuing the authorized UI and production work. Narrow changes own VoiceSelect, its shared stylesheet and focused tests; no backend/schema/provider/native changes.

Each voice has an independent play/pause sample button. A single audio element prevents overlap; loading, media error, retry and ended states are visible. The sticky sample status identifies the voice while leaving the query, selection and script unchanged. Closing, selecting, disabling or unmounting stops audio; request counters ignore stale play-promise failures. Voices without samples have a disabled control. Accessible combobox grid semantics allow interactive preview controls; arrows/Enter select, Tab reaches the highlighted play button, Alt+P previews, Escape dismisses.

247 affected tests pass across Hub, search, Create, shell and preset selectors. New regressions cover no selection/submission, one-player switching, pause, dismissal, unavailable samples, error/retry, disabled cleanup and stale rejection. Types, changed-file lint/format, production/staging builds, context and diff checks pass. Context warnings are the existing optional references and unrelated profile budgets. Real Chrome fixture desktop and a 390px mobile iframe verify inline playback, readable controls/status, script preservation and keyboard focus. Provider POST is forbidden in this fixture.

No new generation or compute; only existing sample playback. Production release and live readback follow below.

## Publication

Published 2026-10-04T03:33:42.182Z from `668fdcafea4d1ec89e04c20ed466b403fd93d30b` to Worker `5240a08e-e3f4-4fd9-9673-cd2ca939373b` at 100%. All 29 public assets match build hashes. Backend bundle is byte-identical to preceding production; 53 bindings, 26 secrets, three Workflow registrations, Cloud runtime pins and Desktop 0.1.48 are preserved. No provider generation/import job or paid compute started.

Authenticated production Chrome in a separate test tab verifies the initial A.J. selection, B-prefix filtering, Bader sample loading and actual playback through 11.238458 seconds to ended=true/error=null. Replay and Pause work. Escape removes the audio element and restores A.J. without selecting the previewed voice. The empty script is preserved; no Generate/Create operation was clicked. The user's original tab and pasted script were not touched.

Project Memory root, VideoForge, Project Index and Coverage guarded updates pass readback. Source and acceptance are committed/pushed on the isolated release branch. No remaining gate for this requested feature; broader historical product gates retain their original limits. Private receipts remain in `.videoforge/voiceover-hub-ux-20261004/dropdown-release/`, with the mobile fixture screenshot adjacent. No new provider/compute starts; the owned fixture server is stopped.
