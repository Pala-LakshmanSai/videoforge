# VideoForge

VideoForge is a multi-user web application that turns a title, voiceover, selected reusable Avatar Profile, and selected reusable Image Style into a finished YouTube video. Users create named avatars once in the Avatar Hub and select them by image and name for future projects; the built-in image-style default is an authentic documentary/stock-footage look, while the Image Styles Hub can derive and store other visual styles from user-provided references.

The current phase is recorded in [project-context/CURRENT_STATE.yaml](project-context/CURRENT_STATE.yaml). The complete, AI-readable project handoff starts at [project-context/00_START_HERE.md](project-context/00_START_HERE.md).

The handoff is deliberately split into focused files so a new chat can load only the context relevant to its task. Root `AGENTS.md` and `CLAUDE.md` direct coding agents to the same source of truth.

## Local development

The first application slice is a fixture-backed production-console shell. It makes no provider calls and authorizes no external spend.

```bash
pnpm install --frozen-lockfile
pnpm doctor
pnpm dev
```

The strict hot-reload URL is [http://localhost:4173](http://localhost:4173). VideoForge will reuse only a healthy fixture-mode server on that port and will fail instead of silently choosing a different port.

Useful commands:

```bash
pnpm dev:status
pnpm dev:open
pnpm verify
pnpm context:validate
```

`pnpm verify` runs formatting, linting, typechecking, cross-language contract and fixture tests, context validation, a production build, and the Chrome smoke journeys.
