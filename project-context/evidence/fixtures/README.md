# Golden context fixtures

These small owned/synthetic fixtures preserve the currently implemented pre-V2 machine contracts.
They remain documentation and replay/cross-language inputs, not the active Serverless-v3 production
shape or real IDs. V2-04 defines the new Serverless-v3 contracts and V2-05 firewalls the
global-session/Pod-era schemas without rewriting these bytes.

- `avatar_profile_version.valid.json` is the immutable reusable source payload selected by the project.
- `create_project_request.valid.json` validates the historical request shape and carries only the
  exact Avatar Profile version ID—never raw avatar bytes or an image asset branch.
- `create_project_request.invalid.inline_avatar.json` is an intentional negative fixture proving the removed `IMAGE_ASSET`/project-local upload shape is rejected.
- `create_project_request.invalid.over_budget.json` is an intentional negative fixture proving the MVP request contract rejects a cap above `$2.00`.
- `project_revision_config.valid.json` is the trusted server-resolved v2 form of that same request, including the exact Avatar Profile binding.
- `project_revision_config.invalid.compatibility_mismatch.json` intentionally claims a `PASSED` preflight state with `FAILED` evidence; schema validation must reject it.
- `timeline_plan.valid.json` hash-links to the revision and covers all three allowed timeline compositions without generated asset IDs.
- `generation_work_manifest.valid.json` binds complete deterministic image/prompt/avatar-span work,
  planned artifact IDs, 16 kHz mono padding/trim policy, and exact cost counts; the paired
  Echo-labeled `invalid.full_voiceover` fixture preserves the general rule that no avatar runtime
  receives the full voiceover. V3 replaces its lane identity with SoulX.
- `render_work_manifest.valid.json` binds every planned frame interval to hard cuts and required
  image zoom; the paired `invalid.transition` fixture proves decorative transitions are rejected.
- `resolved_render_manifest.valid.json` hash-links to the revision/timeline and binds every required
  slot to an accepted asset/checksum plus the fixed output/render profile. Its rows exercise
  historical AvatarForcing/SkyReels source-profile validation only; they are not active model paths.
- `resolved_render_manifest.invalid.avatar_profile_crop.json` intentionally declares a SkyReels source profile with AvatarForcing crop coordinates; schema validation must reject it.
- `production_manifest.valid.json` is the historical v2 final provenance index; V3 adds tenant,
  Serverless assignment/receipt, private artifact, and duplicate-cost lineage.

Together the valid files form one coherent historical synthetic chain; the AvatarForcing/SkyReels
bindings are replay-only regression coverage. Hash fields use `SHA-256(RFC 8785 JCS(payload))`.
Existing validators keep these immutable bytes valid and reject every intentional invalid fixture;
new V3 schemas/fixtures must prove tenant ownership, fair admission, Serverless authority/receipt,
private artifacts, SoulX profile coupling, the `$2.00` ceiling, and the same timing/render rules.
