# Script dropdown voice samples

V2-09 / VF-10-09. User requests hearing each voice directly in the script dropdown, continuing the authorized UI and production work. Narrow changes own VoiceSelect, its shared stylesheet and focused tests; no backend/schema/provider/native changes.

Each voice has an independent play/pause sample button. A single audio element prevents overlap; loading, media error, retry and ended states are visible. The sticky sample status identifies the voice while leaving the query, selection and script unchanged. Closing, selecting, disabling or unmounting stops audio; request counters ignore stale play-promise failures. Voices without samples have a disabled control. Accessible combobox grid semantics allow interactive preview controls; arrows/Enter select, Tab reaches the highlighted play button, Alt+P previews, Escape dismisses.

247 affected tests pass across Hub, search, Create, shell and preset selectors. New regressions cover no selection/submission, one-player switching, pause, dismissal, unavailable samples, error/retry, disabled cleanup and stale rejection. Types, changed-file lint/format, production/staging builds, context and diff checks pass. Context warnings are the existing optional references and unrelated profile budgets. Real Chrome fixture desktop and a 390px mobile iframe verify inline playback, readable controls/status, script preservation and keyboard focus. Provider POST is forbidden in this fixture.

No new generation or compute; only existing sample playback. Production release and live readback follow below.
