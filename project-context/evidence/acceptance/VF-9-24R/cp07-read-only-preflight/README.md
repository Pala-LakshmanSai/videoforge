# CP-07 provider-free/read-only preflight

This directory records the `$0`, zero-mutation CP-07 Phase A boundary at implementation commit
`c89acef78d4a4bbbbac118ca9c658b6180d68fc8` plus byte-budget/native-FP8 GPU safety fix
`75c852bb891dbe205ee43d2b73e74765bc336373`.

It proves canonical provider-free verification, local contracts, exact pinned lineage, immutable
image definition, private 2/4/6-second
qualification inputs, current Sujal `EU-RO-1` GPU choices/rates, current network-volume pricing, zero
compute, one retained Mage volume, and absence of an Echo volume. It does not prove a container
build, published digest, model preparation, Echo volume, GPU compatibility, inference, MP4 output,
crop acceptance, settled paid cost, or production readiness.

Before the safety fix, `CI=1 TURBO_FORCE=true pnpm verify` passed against context commit
`73fba9ab06b06cb80b536597269a78a034f76517`, including 28/28 forced package tasks, 285 web tests,
226 control-plane tests, all worker suites, Cloudflare runtime parity, and 42 installed-Chrome tests.
Current canonical verification is recorded only after the safety-fix context commit passes.
