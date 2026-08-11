# Golden context fixtures

These small owned/synthetic fixtures make the preimplementation contracts concrete. They are documentation and future cross-language test inputs, not generated media or production IDs.

- `avatar_profile_version.valid.json` is the immutable reusable source payload selected by the project.
- `create_project_request.valid.json` validates the v2 client input surface and carries only the exact Avatar Profile version ID—never raw avatar bytes or an image asset branch.
- `create_project_request.invalid.inline_avatar.json` is an intentional negative fixture proving the removed `IMAGE_ASSET`/project-local upload shape is rejected.
- `create_project_request.invalid.over_budget.json` is an intentional negative fixture proving the MVP request contract rejects a cap above `$2.00`.
- `project_revision_config.valid.json` is the trusted server-resolved v2 form of that same request, including the exact Avatar Profile binding.
- `project_revision_config.invalid.compatibility_mismatch.json` intentionally claims a `PASSED` preflight state with `FAILED` evidence; schema validation must reject it.
- `timeline_plan.valid.json` hash-links to the revision and covers all three allowed timeline compositions without generated asset IDs.
- `resolved_render_manifest.valid.json` hash-links to the revision/timeline and binds every required slot to an accepted asset/checksum plus the fixed output/render profile. Its full-avatar row exercises the AvatarForcing 832×480/25 profile, while its split row exercises the SkyReels 1280×720/25 profile and matching center crop.
- `resolved_render_manifest.invalid.avatar_profile_crop.json` intentionally declares a SkyReels source profile with AvatarForcing crop coordinates; schema validation must reject it.
- `production_manifest.valid.json` is the v2 final provenance index for prompts, attempts, QA, cost, selected avatar/style/models, render manifest, and output.

Together the valid files form one coherent synthetic golden chain; the revision/production binding includes a non-null immutable AvatarForcing compatibility-evidence snapshot and its exact preflight state. Hash fields use `SHA-256(RFC 8785 JCS(payload))` for JSON payloads. Phase 0A must validate these same bytes through JSON Schema, generated TypeScript/Zod, and Python/Pydantic contracts, while proving every intentional invalid fixture fails. Semantic tests additionally enforce request-to-revision field resolution, real hash linkage, contiguous frame/word coverage, matching IDs, exact asset-slot unions, model-specific renderer source-profile/crop coupling, compatibility-state/evidence agreement, the `$2.00` MVP cap ceiling, and source-audio duration tolerance.
