# Shared saved voices — 8 October 2026

Checkpoint V2-09 / VF-10-09; profile `v2_09_shared_saved_voices`. The user requests the same saved voice catalog for every user, with partitions for each user's list. Base release source `e9c81467`, evidence head `0d17e26c`; isolate the change from the dirty primary checkout. New provider generation and paid compute budget: USD 0.

## Behavior and ownership

Saved defaults to My saved voices. Everyone remains a deduplicated union of saved voices. A themed Saved by selector offers My saved voices and every other admitted user's display-name collection, including empty lists. Repeated display names receive stable numbered labels. Existing name search, metadata filters, sort, pagination and previews operate within the chosen collection. Stars modify only the viewer's preferences. Import saves into the viewer's list and opens My saved voices; its shared visibility is stated before import.

The read-only database exception exposes only display names, account emails, account identifiers and saved voice IDs for admitted, verified, non-revoked identities. No scripts, jobs, audio outputs, avatars, styles, costs or credentials enter the shared catalog. Unsaved imported voices retain their existing owner/import authorization. Shared imported voices are available to preview, save, video narration and standalone narration; a viewer's own save preserves availability after the source unstars it.

## Rollout and verification

Add migration 0299 without modifying existing rows, preference writers or RLS. Apply the additive function before the new Worker; the previous Worker ignores it. Rollback the Worker to the captured predecessor; preserve all saved preferences and the inert additive function. Publication must compare the current live source/config with the qualified baseline and preserve bindings, workflow identities and runtime pins. No Workflow restart or paid generation is required.

Verify the two-user catalog boundary and private writes with database checks; cover UI partitions, filters, empty states and personal stars; cover imported-voice authorization in both generation entrypoints without submission. Run types, relevant tests, changed-file lint, builds, bundle/context/secret checks and real Chrome desktop/mobile acceptance. Record exact source/version/native migration, live proof, remaining gates and zero new paid work in CURRENT_STATE and the acceptance report.

## Creation picker extension

The video and standalone narration pickers reuse the Hub's collection membership and duplicate-name labels. A fixed Collection control sits above the independently scrolling voice list: Everyone, My saved voices, every other user (with counts), and All voices. Default to My saved voices, including an explicit empty state. Name search stays within the current collection. Switching collections clears search and stops samples, without changing the selected voice, script, or accepted narration. Empty collections offer Browse all voices. Keyboard selection, preview retry, Escape, outside dismissal, input locking and mobile scrolling retain their current behavior.

Implement once in VoiceSelect and pass the existing catalog collections through all three callers. The user follow-up explicitly permits account email subtitles for admitted users; migration0300 adds that field to the existing read-only function. Private preference ownership is unchanged. Verify collection browsing and sample playback cause no generation or narration invalidation; selection alone changes the voice. Run existing video intake and standalone tests, types/builds/lint/context/bundle checks, then real Chrome desktop/mobile acceptance and publish against source0ad3f241 / Workerd2ebbaf9, native299→300, preserving runtime configuration and resources. USD0 new inference/compute.

Migration0300 preserves the function signature, authorization checks, table data, RLS and write functions. Dry-run it with all active identities inside a rollback transaction, verify the exact preimage, then apply it before the new client. Rollback may restore the previous function definition and application Worker; the inert journal entry can remain. Verify each collection email matches its verified auth identity, anonymous/foreign scope remains denied, and the runtime role has no raw-table read grant. Default personal collections and email subtitles apply to both Hub and every creation picker.
