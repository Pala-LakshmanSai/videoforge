# V2-09 / VF-10-09: shared saved voices

Status: PRODUCTION_VERIFIED. Executable `057cae940d1b41711908b3fd41a4224ce0dc25c1` / Worker `9c5572d5-09e7-4232-880f-1fb961b9d02d` at100%, native299. Branch `codex/shared-saved-voices`; predecessor `e9c81467` / Worker `2e14f1a4` at100%, native298.

## Decision and behavior

The user requests universal saved voices with user partitions. `DEC_VOICEOVER_SHARED_001` makes Saved open Everyone, a deduplicated union of admitted users' saved choices. Saved by also offers My saved voices and each other user's display-name collection. Duplicate display names have stable numbered labels without exposing emails. Search, metadata filters, counts, pagination and preview respect that selection. Stars change only the viewer's preferences; import discloses shared visibility and opens My saved voices. Empty collections are explicit.

The shared exception includes provider voice IDs and display names only. Generated speech, scripts, jobs, audio outputs, other presets, costs and credentials retain their private boundaries. Imported voices become available for preview, saving and both narration entrypoints only when shared, owned by the provider-library account, or already imported/saved by the viewer. A viewer's save retains availability after its source unstars it.

## Implementation and rollout

Additive migration0299 exposes `videoforge_shared_saved_voice_collections(account,workspace)` for authenticated account-scoped, admitted, verified, non-revoked users. It changes no existing row, RLS policy or preference writer. The existing private Saved API remains compatible. Apply the function before publishing the Worker; rollback uses the captured predecessor Worker and leaves the inert additive function and all saved preferences intact.

Catalog, preview, preference save, standalone narration and script-project intake use the same imported-voice authorization helper. No provider generation or resource launch is needed. Existing Workflow identities and registrations, CPU limit, runtime pins, bindings and secret names are preserved. No Workflow registration or instance restart is needed: the permission change occurs at HTTP intake before existing private job execution.

## Verification

- Full web suite: 3,360 passed, one existing skip; focused Hub/provider/script/metadata checks82 passed, final core66 passed. Tests cover each partition, personal star writes, source removal, imported-voice use in both generation paths, private job denial and no provider submission during browsing/intake.
- Database voice/job/library regressions8 pass. Migration chain/schema checks9 pass; one existing smoke assertion expects an obsolete Luna profile. The same named assertion fails on the unchanged `0d17e26c` baseline; migration0299 never alters that prompt function.
- Web/Worker TypeScript, changed-file ESLint, Web/Cloudflare/staging builds, production bundle graph, context/schema validation, secret scan and diff checks pass. Exact static closure increases are51 production /17 staging bytes from migration identity metadata; dynamic catalog/provider quarantine remains enforced.
- Native rollback qualification checks all active admitted users against the full saved selection set; raw runtime table reads remain denied, scoped function execution is granted, anonymous context is denied, all saved/auth/revocation row hashes, existing writer definitions/ACLs, RLS and historical journal remain exact. The transaction rolls back fully. After commit, all9 real runtime-role principals read identical13-voice selections; anonymous context and direct table access remain denied.
- Read-only production preflight confirms9 admitted users,13 saved rows and13 distinct saved voices, native298 and exact predecessor source. Cloudflare authentication refreshed through the existing Wrangler session after an expired OAuth token; no credential was written to repository evidence.

## Spend and remaining gates

USD0 new inference, TTS generation, GPU, image, avatar, video or inspection work. No compute resource or existing Workflow instance starts/stops/restarts; existing jobs and cleanup retain their own authority. Production/native publication, two signed-in Chrome accounts, shared imported-voice preview, personal save/remove restoration, user partitions, empty states, duplicate labels, keyboard End/Enter selection and390px mobile layout all pass. Fresh paid generation, whole-film, invoice and inherited broad-CI gates are outside this catalog-only verification.

## Production and browser proof

Initial feature source10553c69 / Worker85ec9d90 published with additive299. Native activation preserves all13 saved rows, auth/revocation row fingerprints, preference writer definitions/ACLs, forced RLS and historical journal through298. Nine actual runtime connections return the same roster and13 selections, one self marker each; runtime raw table reads and anonymous calls are denied.

Chrome confirms the original account's6 saves and the other account's4 remain personal, while both see Everyone13. The original account previews the other account's imported voice to ended=true/error=null at9.9265seconds, stars it (own6→7), then unstars it (own7→6). The source collection stays4; exact13-row preference fingerprint returns to its original value. The original browser identity is restored. Choosing empty collections shows No saved voices; End/Enter reaches the last partition. Full roster labels are present and same-name accounts are numbered. Mobile390×844 has document width375, without horizontal overflow; the viewport is reset afterward.

Final label-only source057cae94 / Worker9c5572d5 serves100%. Final Hub21 tests, changed lint/format and Web/Cloudflare builds pass. The entire server bundle is byte-identical to the initial feature release after generated module-path normalization. All37 public asset lengths/hashes,55 bindings/27 secret names, CPU300000, three existing Workflow resource IDs/registrations and runtime pins read back exactly. Anonymous catalog401 and private-project401 pass. No new Workflow registration/instance or paid provider/resource action occurs. Source and evidence are pushed; the primary checkout's unrelated edits remain untouched.

Desktop and mobile screenshots are retained as local chat artifacts, outside Git and Project Memory. The public report contains no user display names or account contact details. New TTS synthesis was deliberately not run under the USD0 catalog-verification scope; provider availability and invoice/whole-film gates retain their independent evidence.
