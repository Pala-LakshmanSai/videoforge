# VideoForge

VideoForge is a multi-user web application that turns a title, voiceover, selected reusable Avatar Profile, and selected reusable Image Style into a finished YouTube video. Users create named avatars once in the Avatar Hub and select them by image and name for future projects; the built-in image-style default is an authentic documentary/stock-footage look, while the Image Styles Hub can derive and store other visual styles from user-provided references.

The current phase is recorded in [project-context/CURRENT_STATE.yaml](project-context/CURRENT_STATE.yaml). The complete, AI-readable project handoff starts at [project-context/00_START_HERE.md](project-context/00_START_HERE.md).

The handoff is deliberately split into focused files so a new chat can load only the context relevant to its task. Root `AGENTS.md` and `CLAUDE.md` direct coding agents to the same source of truth.

## Local development

The accepted fixture production-console shell and provider-free local ASR/scheduler/FFmpeg walking
slice are implemented. The next milestone adds durable control-plane contracts while fixture mode
remains the default; normal development makes no provider calls and authorizes no external spend.

```bash
pnpm install --frozen-lockfile
pnpm doctor
pnpm doctor --json
pnpm dev
```

The strict hot-reload URL is [http://localhost:4173](http://localhost:4173). VideoForge will reuse only a healthy fixture-mode server on that port and will fail instead of silently choosing a different port.

Loopback is the default. For explicit fixture-only review from a phone on the same trusted Wi-Fi,
start `pnpm dev:lan`; `pnpm dev:status` reports a temporary `lanUrl` only for that deliberately
LAN-bound process. Local-media mode never permits LAN exposure, and no LAN route is a public
deployment.

Useful commands:

```bash
pnpm dev:status
pnpm dev:stop
pnpm dev:open
pnpm verify:fast
pnpm verify
pnpm context:validate
```

`pnpm verify:fast` is the provider-free local feedback gate. It runs formatting, linting,
typechecking, one non-duplicating package build/test graph, cross-language contract and worker tests,
context validation, secret scanning, and generated-file checks. It deliberately excludes local
Workerd and installed-Chrome journeys, so it is never release evidence.

`pnpm verify` is the canonical provider-free gate. It includes every `verify:fast` check, local
Workerd parity, and all installed-Chrome journeys. Workerd runs alongside the port-free fast checks;
installed Chrome runs afterward on the strict owned loopback port.

`pnpm doctor --json` emits the same checks as stable redacted JSON for automation. Environment
metadata contains names only. `pnpm dev:stop` is idempotent when stopped and signals a running
server only after its ownership record, process tree, strict ports, mode, commit, and provider-free
health identity all match; it never force-kills a foreign or ambiguous process.

Hosted CI owns five independent lanes: static/contracts/security, TypeScript, Python, local
Workerd, and installed Chrome. A sixth `required` job fails unless every lane succeeds. Browser
lanes publish JUnit/failure evidence, and every execution lane publishes timing artifacts.
