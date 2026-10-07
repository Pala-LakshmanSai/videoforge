# Voice import repair — 2026-10-07

Checkpoint V2-09, task VF-10-09. User authorizes the repair, functional verification and production publication. Baseline executable `71af8de8` / Worker `5a201da0` served 100% traffic; unrelated primary-checkout edits are preserved.

## Cause and repair

Chrome's exact `lxYfHSkYm1EzQzGhdbfc` import returned HTTP 503 / `J1TTS_UNAVAILABLE` after 6.46 seconds. The configured provider already listed Jessica Anne Bogart. One metadata-only duplicate probe returned HTTP 400 with `failed[].error=already_imported` after 5.23 seconds. VideoForge unconditionally imported before private save, then masked the rejection with generic catalog copy.

The route now refreshes provider availability first and saves an existing exact ID privately. A new import submits once and reconciles exact availability after success, duplicate rejection or uncertain transport. Missing or different IDs never save. Ordinary catalog caching, tenant authorization, preferences and paid TTS identity/dispatch remain intact. Import failures use specific import copy. Private operator receipts remain in `.videoforge/voice-import-20261007`; credentials never enter tracked evidence.

## Qualification and production

Four regressions fail against the original implementation. The final web suite passes 3,327 tests across 228 suites, with one skipped; 91 nearest voice, script intake, archive and Library tests pass. Web/Worker types, focused lint, both builds, production bundle firewall, actual workerd provider boundary, context and tracked-file secret checks pass. Optional context-asset warnings remain; broad repository CI is not represented as green.

Executable `49f0267fa50a5b393060649d3e606c4441141378` / Worker `a342a0ea-9eb3-42a0-a514-e5af41edf24c` serves 100% traffic. All 37 public assets match size and SHA256. Native schema 294, 55 bindings, 27 secret names, qualified media-runtime pins and all three Workflow resource IDs are preserved. The branch `codex/voice-import-fix` is pushed.

Signed-in Chrome imports the exact voice with HTTP 200 in 2.47 seconds; the popover closes and Saved increases from 3 to 4. Repeat import returns 200 in 1.46 seconds without duplicate saved rows. Reload retains the voice. Its 9.9265-second preview plays to the end with readyState 4 and no media error. The studio picker exposes it as Saved without changing the selected voice or submitting narration. Library retains four MP3s; existing 1,720.71175-second narration plays beyond 37 seconds with readyState 4 and no error. Native and HTTP readback confirm the exact saved/imported ID, owner catalog 1,118, foreign catalog 1,117 without this imported ID, foreign preview 404 and anonymous 401.

## Operational limits and spend

Existing Workflows are registered against the qualified release; continuation registration is `aff6a911-4db4-4aff-ac50-d364fb8e8c2f`. The running `4928d96c` coordinator remains in place because an unrelated prompt run is DISPATCHING and due. No user job or coordinator was restarted and no instance was created. This patch changes the HTTP import branch; observer/dispatch code and ordinary reads used by Workflows retain their behavior. Idle adoption remains a later operational gate.

Provider generation usage stays at 7 before and after verification. No new TTS, video, inference or paid compute was started. The temporary credential file is removed. Existing jobs, accepted media and cleanup retain their own authority and lifecycle; no global shutdown or historical-liability resolution is claimed. No import-release gate remains; a fresh paid full-film canary and future provider availability are separate acceptance conditions.
