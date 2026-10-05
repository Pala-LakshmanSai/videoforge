# Voiceover Hub filters — 5 October 2026

Checkpoint V2-09 / VF-10-09; profile v2_09_short_live_e2e. User requests useful voice filters and implementation through production. Base clean published release 610b7bed; preserve unrelated primary-checkout work. New generation and paid compute budget is USD 0.

## Product and data

Reuse the account-authorized full voice catalog, existing name-prefix search, Saved/Starred tabs, pagination, preview and preference mutations. Filter before pagination. Combine gender, explicit accent, language/region, style/tone and use case. Show available counts respecting the other selections, disable zero-match choices, retain selected choices, and expose removable selections plus Clear filters. More filters contains style/use case and preview availability. Sort by name ascending/descending or favorites. Use themed, labelled and responsive listbox menus for all five facets and sorting. The 17:14 user follow-up rejects the browser-native dropdown interior: show selected checks, separate count badges, readable unavailable choices, hover/keyboard states, bounded scrolling and above/below placement. Support arrows, Home/End, typeahead, Enter/Space, Escape, Tab and outside dismissal without changing filters until selection. Reuse the existing voice-picker interaction pattern; no new dependency.

Gender uses exact metadata tokens; Female never matches Male. Accent uses explicit catalog tags or descriptive name suffixes, never a personal name, supported-region list or presumed nationality. Unlabelled metadata remains discoverable through Not specified. Provider language fields contain country/region codes, often several per voice; display region names under Language / region, without claiming a specific language for multilingual countries. No guessed age, quality score, pitch measurement or compatibility guarantee. No provider/schema changes or new dependencies.

## Implementation and acceptance

1. Extend the existing voice-library helpers and Hub; keep the script dropdown behavior unchanged.
2. Runnable regressions cover exact gender, accent/region separation, conjunction, unknown metadata, counts, tabs/search/reset/sort, complete-catalog filtering and pagination reset. Run existing voice/Hub/picker/provider tests, Web and Worker types, changed-file lint, both builds and production bundle guards.
3. Exercise native Chrome against provider-free data at the stable port. Verify desktop and mobile controls, empty/reset behavior and existing preview/save behavior without synthesis.
4. Capture current Cloudflare source/config/traffic. Prepare an exact clean commit and immutable assets. Publish only the authorized UI release while preserving bindings, secrets, routes, workflows and current runtime pins. Abort if concurrent production source/config changes; rebase safely before continuing. Keep the previous version as rollback. Do not restart generation/paid workflows or launch compute.
5. Verify public asset hashes, authenticated real Chrome filter counts/combination/reset, unchanged catalog/save state and preview. Record exact release identities, validation limits, spend and compute state in CURRENT_STATE and acceptance evidence; update existing GPT Space context/index/coverage.

## Stop condition

Complete once focused checks and live production filter acceptance pass. Inherited full-CI, provider funding, Local/long-form, editorial and invoice gates remain separate; no paid canary is needed for catalog filtering.
