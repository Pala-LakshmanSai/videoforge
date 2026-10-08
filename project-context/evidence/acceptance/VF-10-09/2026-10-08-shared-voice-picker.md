# Shared saved voices in creation — 8 October 2026

Checkpoint V2-09 / VF-10-09. Final source `30b8cf9708fbd3b50057fe7b01ce4de8fd8c0f77`, Worker `29f4bf7e-81b3-4619-af31-a555ed596201` at100%, native300. Branch `codex/shared-saved-voices`; dirty primary checkout preserved. The user explicitly requested production publication, then small email subtitles and a personal default. New inference/compute cap: USD0.

## Behavior

Hub and all three VoiceSelect callers default to My saved voices, including an empty personal list. Everyone provides the deduplicated shared union, and each other admitted user's collection is available with a display name, small email subtitle and count. All voices remains accessible. Collection browsing clears scoped search and stops samples without changing the chosen voice, script or accepted narration. Only explicit selection changes the voice. Duplicate names retain stable numbered labels. Stars/import writes and all generated speech/scripts/jobs/media/costs remain private.

VoiceSelect reuses the Hub's membership and label helpers. The Collection control stays above independently scrolling results. Nested Escape closes the collection menu, then the voice picker, preserving input. The popup height accounts for floating navigation, including on mobile. Preview footer margins no longer create horizontal overflow. No dependencies or new generation path were added.

## Data and compatibility

Migration0300 replaces the existing scoped security-definer function with the same signature and checks, adding only the verified user's email field. The old client ignores the additive field; the new client accepts its absence during rollback. No existing row, private write function, RLS policy or table grant changes. A rollback transaction checked every active identity, correct emails, narrow fields, private writers, RLS/ACLs and the exact preimage before the qualified commit. Nine actual runtime connections then verified identical13 saved IDs and correct identity emails, one self collection each, and denied anonymous, incorrect account/workspace and raw-table reads. The original13 preference rows retain their exact fingerprint after browser acceptance. Rollback may restore migration0299's function definition and a captured predecessor Worker while retaining the inert ledger entry.

## Verification

- Web229files:3362passed,1existing skip. Final focused UI/provider/script intake suites:78passed, including empty personal defaults, email labels, search, preview cleanup, script preservation, personal writes, shared imported-voice admission, nested Escape and floating-navigation bounds. Database voiceover suites:5passed.
- Web/Worker types, changed-file ESLint/Prettier, Web/Cloudflare builds, staging build of the email revision, bundle quarantine, context/schema/manifest validation, staged-file secret scan and diff checks pass. The final navigation-only client revision has a byte-identical server bundle to the email release. No closure ceiling was relaxed.
- Production readback verifies37 public asset lengths/SHA256s,55 bindings/27 secret names, CPU300000, existing three Workflow resource IDs/registrations/runtime pins, native300, QA defaults false/zero required rows/zero QA receipts, and private-project401. Anonymous voice catalog remains401.
- Real Chrome, two existing signed-in accounts: My saved defaults6/4 and Everyone13 in video creation; the Hub follows personal defaults; standalone narration uses the same6/13 collections. All catalog1124 remains reachable. Shared Jessica preview reaches ended9.9265s with no audio error. Scoped prefix search, explicit selection, sample cleanup, empty other-user collection, nested Escape and navigation draft persistence pass. No Create/Generate was clicked.
- On final390×844 mobile, document width375; menu bottom679.375 precedes navigation top686.125. The last personal voice is selectable. Email wrapping, bounded collection scroll and no horizontal overflow pass. Viewport, original signed-in account and title/script/voice are restored; the updated picker remains open for review. Browser error log is empty.

Screenshots remain local outside Git and Pages: `shared-voice-picker-emails.jpg` and `shared-voice-picker-emails-mobile.jpg` under this chat's visualization directory. Acceptance/Pages record only field-level decisions, with no real account emails or credentials.

## Spend and remaining gates

USD0 new paid synthesis/generation/compute. No Workflow registration/instance restart, resource launch/stop or retained-resource mutation. Existing work is preserved; its compute state was not reaudited. New full-film/provider execution, invoice and inherited broad-CI gates are separate. The full web suite predates the final isolated navigation-bound adjustment, which has its own78 passing focused checks, final types/builds and production mobile proof.
