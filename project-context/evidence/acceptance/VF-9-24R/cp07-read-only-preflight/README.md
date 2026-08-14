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

The active VideoForge runtime profile is `EchoMimicV3-Flash Turbo FP8`. First-party verification
found no separately named Turbo checkpoint: the exact upstream bytes remain official
`EchoMimicV3-Flash` / `echomimicv3-flash-pro` at the pinned revisions. Turbo labels the official
accelerated 8-step profile plus VideoForge's owned FP8 preparation; it does not authorize model
substitution. Current byte bounds still derive 50 GB with 22,027,682,265 bytes minimum headroom.
If preparation exceeds a bound, execution stops before mutation and replaces the proposal with the
next exact size and current retained-volume rate for explicit approval.

`CI=1 TURBO_FORCE=true pnpm verify` passed against current safety-fix context commit
`b7afb69efa2e31003f1b4408f51508ea38c05b3c`, including 28/28 forced package tasks, 285 web tests,
226 control-plane tests, all worker suites, Cloudflare runtime parity, and 42 installed-Chrome tests.
