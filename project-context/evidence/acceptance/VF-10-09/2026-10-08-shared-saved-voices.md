# V2-09 / VF-10-09: shared saved voices

Status: LOCAL_VERIFIED_RELEASE_PENDING. Branch `codex/shared-saved-voices`, predecessor executable `e9c81467` / Worker `2e14f1a4` at 100%; native298.

## Decision and behavior

The user requests universal saved voices with user partitions. `DEC_VOICEOVER_SHARED_001` makes Saved open Everyone, a deduplicated union of admitted users' saved choices. Saved by also offers My saved voices and each other user's display-name collection. Search, metadata filters, counts, pagination and preview respect that selection. Stars change only the viewer's preferences; import discloses shared visibility and opens My saved voices. Empty collections are explicit.

The shared exception includes provider voice IDs and display names only. Generated speech, scripts, jobs, audio outputs, other presets, costs and credentials retain their private boundaries. Imported voices become available for preview, saving and both narration entrypoints only when shared, owned by the provider-library account, or already imported/saved by the viewer. A viewer's save retains availability after its source unstars it.

## Implementation and rollout

Additive migration0299 exposes `videoforge_shared_saved_voice_collections(account,workspace)` for authenticated account-scoped, admitted, verified, non-revoked users. It changes no existing row, RLS policy or preference writer. The existing private Saved API remains compatible. Apply the function before publishing the Worker; rollback uses the captured predecessor Worker and leaves the inert additive function and all saved preferences intact.

Catalog, preview, preference save, standalone narration and script-project intake use the same imported-voice authorization helper. No provider generation or resource launch is needed. Existing Workflow identities, CPU limit, runtime pins, bindings and secret names are guarded during publication. New workflow registrations may preserve existing definitions; no existing instance is restarted.

## Verification

- Full web suite: 3,360 passed, one existing skip; focused Hub/provider/script/metadata checks82 passed, final core66 passed. Tests cover each partition, personal star writes, source removal, imported-voice use in both generation paths, private job denial and no provider submission during browsing/intake.
- Database voice/job/library regressions8 pass. Migration chain/schema checks9 pass; one existing smoke assertion expects an obsolete Luna profile. The same named assertion fails on the unchanged `0d17e26c` baseline; migration0299 never alters that prompt function.
- Web/Worker TypeScript, changed-file ESLint, Web/Cloudflare/staging builds, production bundle graph, context/schema validation, secret scan and diff checks pass. Exact static closure increases are51 production /17 staging bytes from migration identity metadata; dynamic catalog/provider quarantine remains enforced.
- Native rollback qualification checks all active admitted users against the full saved selection set; raw runtime table reads remain denied, scoped function execution is granted, anonymous context is denied, all saved/auth/revocation row hashes, existing writer definitions/ACLs, RLS and historical journal remain exact. The transaction rolls back fully. Real runtime-role reads and authenticated live/browser acceptance are release gates.
- Read-only production preflight confirms9 admitted users,13 saved rows and13 distinct saved voices, native298 and exact predecessor source. Cloudflare authentication refreshed through the existing Wrangler session after an expired OAuth token; no credential was written to repository evidence.

## Spend and remaining gates

USD0 new inference, TTS generation, GPU, image, avatar, video or inspection work. No compute resource or existing Workflow instance starts/stops/restarts; existing jobs and cleanup retain their own authority. Production/native publication, authenticated two-account catalog/previews and Chrome desktop/mobile proof remain pending. Fresh paid generation, whole-film, invoice and inherited broad-CI gates are outside this catalog-only verification.
