# VideoForge runtime config

This package owns versioned, non-secret runtime profiles. The initial profile set is fixture-only: it cannot name a provider endpoint, select a GPU, reserve external spend, or claim a model is loaded.

`fixture-runtime.v1.json` deliberately maps all three user-facing generation modes to the same deterministic zero-spend workers. Production execution profiles will be separate immutable records created only after the relevant benchmark gates pass.

`execution-profile-catalog.v1.json` is the UI-facing catalog for the two primary parallel lanes. Each lane exposes one selectable immutable fixture profile named `Auto`; it has no provider endpoint, GPU assignment, or external spend. The documented Mage and AvatarForcing GPU candidates are separate, disabled `BENCHMARK_REQUIRED` metadata tied to `GATE_GPU_001`. They are planning priorities, never availability claims.

Both JSON documents are parsed and cross-validated at module load. Importers receive frozen validated values and can resolve generation modes through the exported helpers; the package does not publish unchecked JSON as a typed runtime object.

The exported worker-health contract separates process readiness from model readiness. A skeleton can be healthy while reporting `model_state: "not_loaded"`; no caller may interpret process health as permission to dispatch real inference.
