# Voice catalog filters acceptance — 5 October 2026

Checkpoint V2-09 / VF-10-09, read profile v2_09_short_live_e2e. User requests useful gender/accent filters and implementation through production. Feature commit `360a1b0944f8f12d36e3373a7e7ec5cf95d00ace`; executable release `77781a02c1aa6d73780d117b7bffbd700ca52738`, branch `codex/voice-filters`; Cloudflare version `7be46efd-14ad-43d9-bce5-0d55f55e4495` at 100%, verified 2026-10-05T11:42:25.700Z. Clean base `610b7bed`, prior production executable `4660b1b9` / version `9872d035-f9b0-47fb-81fb-b15d16155c03` is rollback. Unrelated dirty primary work and clean prior release worktree are preserved.

## Delivered behavior

- Native labelled Gender, Accent and Language / region selects; More filters contains Style / tone, Use case and Has audio preview. Name A–Z, Name Z–A and Favorites first sorting; the existing saved-first default retains favorite ordering.
- Selections combine with the existing normalized name-prefix search and All/Saved/Starred scope before pagination. Choices show counts considering every other filter, disable zero matches while retaining the selected choice, and keep unlabelled voices discoverable as Not specified. Removable chips, Clear filters and matching empty/reset states work together. Changing filters/search/sort/tab resets the visible page to 60. Successful import clears stale attribute filters.
- Exact tag parsing distinguishes Female from Male. Accent matches explicit tags or descriptive name suffixes, without using personal names or supported regions. Provider language metadata is region codes, displayed as region names; India does not imply Hindi or an Indian accent. Style / tone uses provider tags, not an acoustic quality evaluation. No guessed age, pitch or quality score.
- Reuses the authorized catalog and existing preview/preference paths. Script dropdown behavior and narration creation remain unchanged. No new endpoint, schema migration, dependency, model/provider call, generation or compute.

## Verification

39 focused tests passed across voice-library, VoiceoverHub/picker and provider/route suites. Regressions cover exact tags, explicit accent versus region, missing metadata, conjunction, counts/disabled options, tab/search/reset/preview filtering, sort defaults versus explicit alphabetical order, complete-catalog filtering beyond the first 60 voices and pagination reset. Existing save/star/import/narration request tests remain green.

Two installed-Chrome fixture journeys passed at 1280px and 390px: all five filters, preview-only empty state, clear/reset, sort, prefix search, no horizontal overflow and no narration POST. Web/Worker types, changed-file ESLint/Prettier, both builds and production bundle guard pass; context and secret scan pass. The context validator initially detected the inherited repository branch selector, which the release commit corrects. Full-repository CI is not newly claimed.

Real signed-in production Chrome shows 1,117 authorized voices: Male 742, Female 362, gender not specified 13. Female + British yields eight voices; adding Calm + United Kingdom yields three; Narrative Story yields two. Preview availability and descending sort retain two matches. Accent is unspecified for 1,052 catalog entries; explicit accent matches cover the rest, with possible overlapping descriptors. This is catalog metadata coverage, not audio analysis. Live prefix search for `a` under those filters yields only Annabel; a nonmatching prefix shows No matching voices. Clear search and Clear filters restore the library; Saved still contains the original A.J. and the saved/starred totals remain one each. Annabel preview played fully to ended=true/error=null at 9.613061 seconds in a separate signed-in Chrome tab. No preference mutations or synthesis were needed. Screenshot: primary checkout `.videoforge/voice-filters-20261005/production-filters.png`.

## Release preservation and limits

All 30 public client payload hashes match the built release. `.assetsignore` is build metadata excluded from public asset verification. Initial unbounded parallel readback encountered a network connection timeout; four-request read-only batches completed. Publication preserves all 55 bindings, 27 secret names, three Workflow identities, current runtime/media pins, routes/domain/crons, redaction and traffic controls. Uploaded source/config and post-deployment status/100% traffic were read back. The server bundle is exactly unchanged after normalization of esbuild source-path strings. No Workflow restart or trigger mutation was needed for this UI-only release. Anonymous voice catalog access remains HTTP 401.

Cloudflare OAuth initially expired; the existing Wrangler session refreshed normally, then exact read-only preflight succeeded. No new credential, account or permission was created. Publication captures immutable source/assets/config and aborts on concurrent source/traffic/config changes.

New paid generation and compute: USD 0. No compute was started or stopped; provider/Pod inventory was not refreshed for this UI change, so no new zero-Pod claim is made. Existing cleanup/resource lifecycle remains unchanged. Stable provider-free localhost4173/4174 development service restored to its original owned release checkout after isolated Chrome tests. Inherited broad CI, Local, representative long-form/concurrent throughput, funding/quotas, editorial and invoice gates remain separate.

Detailed private preparation/publication/hash readbacks live under the primary checkout `.videoforge/voice-filters-20261005/release2`; no credentials or private logs are committed. Product/release plan: `project-context/VOICE_FILTERS_PLAN.md`.


## 17:14 follow-up — dropdown interior polish

User requires the menu interior to match the application. Browser-native selects cannot provide
consistent macOS option styling; five facets and sorting now share a small themed listbox control,
reusing the script picker's interaction pattern without new dependencies. Dark panel, 42px rows,
selected checks, count badges, readable zero-match choices, hover/focus states and bounded scrolling
are included. Keyboard arrows skip disabled options; Home/End, typeahead, Enter/Space, Escape, Tab
and outside dismissal preserve selection until a valid choice. Above/below placement fits available
space. Script picker, preferences and narration generation remain unchanged.

- Source implementation `fa067845`; executable `3fe3eadd4b95ee87b5bed4d032a291fae33f985b`;
  production Worker `7a495e15-b324-4d15-992f-73833a4b57a6` at 100%, branch `codex/voice-filters`.
- Fresh preflight detected concurrent publication `abd49b6e` / Worker
  `89477b1c-dce3-49ab-9867-1316afc16fac`; merged that source before rebuilding. The centralized
  library's code/configuration is preserved. This prior Worker remains the rollback version.
- 44 focused tests pass (40 voice/provider/picker and four centralized-library checks).
  Installed Chrome workflows pass at 1280px and 390px, checking menu bounds, Escape/focus,
  combinations, counts, sorting/reset and no POST requests. Web/Worker types, owned lint,
  both builds and production bundle guard, context validation, tracked-secret scan and diff pass.
  Context warnings for optional assets and inherited read-profile budgets remain.
- Signed-in production: Saved gender menu displays Female0/Male1/Not specified0 with readable
  unavailable states. Arrow navigation skips them; Enter selects Male; Escape/Tab dismiss correctly.
  Full catalog1117, Female362, Female+British8, UK4, Calm3, Narrative Story2; reverse sort shows
  Isabel then Annabel. Region list is 300px tall for 1260px content; typeahead reaches UK.
  Empty/search/reset and Saved1 preservation pass; centralized navigation is still present.
- All 37 public asset bytes match; anonymous catalog401; 55 bindings, 27 secret names and three
  Workflow registration identities preserved. Server bundle equals current baseline after only
  source-path normalization. No schema change, migration, workflow restart or provider generation.
- Existing full preview acceptance above remains historical; preview was not rerun for this UI-only
  follow-up. Broad CI, Local, long-form, provider funding/quotas, editorial and invoice gates remain
  independent. New paid generation/compute USD0; no compute started/stopped or fresh inventory claim.

Private review screenshot: `.videoforge/voice-filters-20261005/production-dropdown-saved.png`.
Private guarded publication, byte proofs and Chrome summary: same folder's `release3/`.
Stable provider-free development server was restored after isolated Chrome checks.
