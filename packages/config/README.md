# VideoForge runtime config

This package owns versioned, non-secret runtime profiles. The initial profile set is fixture-only: it cannot name a provider endpoint, select a GPU, reserve external spend, or claim a model is loaded.

`fixture-runtime.v1.json` deliberately maps all three user-facing generation modes to the same deterministic zero-spend workers. Production execution profiles will be separate immutable records created only after the relevant benchmark gates pass.

The exported worker-health contract separates process readiness from model readiness. A skeleton can be healthy while reporting `model_state: "not_loaded"`; no caller may interpret process health as permission to dispatch real inference.
