# Natural footage isolated comparison 5 October 2026

V2-09 / VF-10-09, branch `codex/natural-footage-tests`, base `4298834b361fa74c7a76218d7daa0f7a3aa80ca0`. This phase is complete and awaits user selection. Production remains `b5ed9f70d195b7bdb75fd9d17f3e6af3574f1e04`; no application source, database policy, project pipeline, media identity or deployment changed.

## Diagnosis

The shared Runware adapter at `apps/web/src/server/providers/runware-seedance-job.ts` and native migration0240 manifests pin `cameraFixed=true`. [Official Seedance documentation](https://runware.ai/docs/models/bytedance-seedance-1-0-pro-fast) confirms that this prevents pan, tilt and zoom. The existing video prompt also carries the entire photograph prompt with generic subject movement. This establishes a camera-control restriction; it does not prove that every static result has this single cause. Starting images substantially constrain the initial light and texture.

Both user reference videos were sampled in real Chrome, including watermelon and kitchen/window-light footage, without downloading reference media or sending it to a provider. Full reference films were not watched end to end. Desired cues: available light, ordinary exposure, soft unsharpened texture, restrained action and small imperfect camera movement. Approximately15% livelier clips is a proposed scene-supported mix, not a qualified production rule.

## Comparison and visual limits

Two accepted source stills use the same model, resolution, duration and seed per scene. Arms: current fixed-camera control, unlocked control, A casual handheld, B gentle pan, C forward/parallax prose, D one livelier kitchen probe. C garden invents visible filming equipment and another observer: visually rejected, without replaying its UUID. E is a fresh viewpoint-only correction with explicit equipment/observer exclusion. Six additional A/B/E clips use two fresh Kie z-image sources; A/B also explicitly exclude visible filming equipment. New compositions differ from originals, so this is exploratory source comparison, not a clean causal lighting experiment.

Preliminary sampled review: E is the gentlest; B offers clearer lateral camera movement but can increase hand activity; A has mild drift with some subject repositioning. The kitchen E knife moves without consistently completing the requested new slice. All new sources remain somewhat polished, and no candidate establishes reliable raw realism or anatomy/object continuity across arbitrary scenes. Do not label technical success as editorial acceptance. The user must choose a preferred strategy, then approve several held-out examples before implementation.

Original MP4s are unfiltered and ungraded. Local comparison and private receipts are at `/Users/lakshmansai/Documents/videoforge/.videoforge/natural-footage-20261005/`. The allowlisted loopback viewer is `http://127.0.0.1:8769/comparison.html`; no private receipt/credential routes or remote publication. Contact sheets are QA artifacts only. [Exact sanitized prompts, hashes and receipts](2026-10-05-natural-footage-tests.json).

## Validation and cost

All18 paid clip identities reconcile to successful original responses; all outputs verify SHA256, H2641248×704,5.041667seconds, full FFmpeg decode and zero audio streams. Two source images were checked before dispatch. Within-source seed/source checks pass. Chrome loads all18 outputs with valid durations/error=null; confirmed full plays cover original garden A/B, kitchen B and new-source garden B/E, kitchen A/E. No claim of full visual watch of all18 clips or production-wide regression acceptance.

Each Runware receipt isUSD0.06737788:18clips totalUSD1.21280184. Two Kie images each report0.8credits, estimatedUSD0.004 at the [current official rate](https://kie.ai/z-image): estimatedUSD0.008. Combined reported-plus-estimated subtotalUSD1.22080184; remaining cumulativeUSD4 allowanceUSD2.77919816. These are provider receipts/credit estimates, not settled invoices. Conservative initial reservation ceilingUSD1.72; no unresolved tasks, new rentals, retained resources or paid replay. Extra authority remains bounded to this experiment and the user-selected confirmation round; it does not transfer prior canary budgets or authorize a production default without the requested approval.

Context validation and diff/secret checks are the relevant repository gates for this context-only phase. Production status read returned200 at the retained source; this is status evidence, not a fresh full-app or long-form acceptance run. Future implementation must preserve immutable policies and saved bytes, opening/remainder coverage, normal Avatar On layouts, Avatar Off pipeline omission, billing, recovery and hard-cut/no-graphics grammar. Follow `NATURAL_FOOTAGE_EXPERIMENT_PLAN.md` through focused contracts/render checks, real Chrome, exact release/rollback and live acceptance after second-round approval.
