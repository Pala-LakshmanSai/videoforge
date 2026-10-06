# V2-09: New project draft survives dock navigation

User authorizes the fix and production publication on 2026-10-06. Isolated branch
`codex/create-draft-persistence` starts from latest production handoff `79197d15`,
whose executable `f98c5933` / Worker `40cc0991` includes the ASR, prompt and WebP fixes.
Primary workspace changes are preserved.

## Cause and repair

The hosted Create route owns all form inputs in component state. Dock navigation destroys
that component. Native signed-in Chrome reproduces an empty title and opening reset to 3
minutes after Settings and return. The new regression fails before repair at the empty title.

Reuse React memory within the admitted account/workspace lifetime. Retain every input,
including the original local File, script/voice, exact preset versions, composition, keywords,
seed, defaults-initialized flags and ambiguous Create body/key/lock/upload metadata. Store
subscriptions keep asynchronous request-state changes visible after remount. Readiness and
preflight remain fresh; no browser draft grants authority or submits work. Successful Create
replaces the draft store; old callbacks retain their old store. Changed admission and sign-out
unmount it, preventing another account from receiving the draft. No browser storage, provider,
server, schema, Desktop or Cloud image changes are needed. Reload/closed-tab persistence is
outside this navigation fix.

## Verification

Provider-free regressions cover voiceover/File remount, script/voice remount, opening and
coverage retention, original request identity after an uncertain response, successful reset,
and account isolation. All 298 nearby UI/auth/voice tests, types, touched-file lint, both builds and production
quarantine checks pass. Canonical `pnpm verify` remains blocked by inherited formatting and
missing local uv 0.8.13; it is not claimed green. Async mutation tests wait for the actual
retry/unlock controls to become enabled before proceeding. Installed-Chrome navigation exercises Queue, Voices, Avatar Hub,
Image Styles, Library and Settings at the stable localhost URL. Settings prepares its existing
connect commands; no project/provider/media action is submitted. Production Progress will be
included in signed-in final acceptance because the local fixture has no Progress dock entry.

Production publication, exact public assets and live acceptance are pending.

## Provider and shutdown state

USD 0 new paid generation/compute. No compute or Workflow instance is started, restarted or
terminated. Existing running user projects and cleanup identities remain untouched. Inherited
broad CI/tooling, full-film, provider, installed Local, editorial and invoice gates remain separate.
