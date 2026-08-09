# `@videoforge/pipeline`

Pure, provider-free domain boundaries for VideoForge transcript, scheduling, accepted-asset,
and render-planning work.

Canonical project-revision, timeline, and resolved-render documents stay field-opaque here. This
package imports their names and JSON/hash primitives from `@videoforge/contracts`; it does not
copy their schema shapes or validate them independently. The contracts package remains the sole
schema authority.

The package has no filesystem, process, media-tool, network, storage, provider, wall-clock, or
random-number implementation. Callers inject deterministic clocks and ID factories and implement
the declared ports at an adapter boundary.

```sh
pnpm --filter @videoforge/pipeline lint
pnpm --filter @videoforge/pipeline typecheck
pnpm --filter @videoforge/pipeline test
pnpm --filter @videoforge/pipeline build
```
