# VideoForge agent instructions

Current phase, branch/server state, ownership, and last-green evidence live only in `project-context/CURRENT_STATE.yaml`.

## Pinned, token-efficient project context

“Pinned” means repository-indexed, not injected into every prompt. Only this compact `AGENTS.md` is automatic. Never preload the full context pack, roadmap, prompt pack, Ranga evidence, PDFs, or all files under a directory.

For each task:

1. Read the three startup files below.
2. Resolve the current checkpoint and selected profile/brief from them.
3. Read only that checkpoint's section in `project-context/22_PROJECT_COMPLETION_CHECKPOINTS.md` and only the selected profile/brief files. If the user did not paste the matching prompt, extract only that prompt from `project-context/templates/CHECKPOINT_CHAT_PROMPTS.md`.
4. Load domain evidence only when required. For style, scheduling, or visual-quality work, use `03_REFERENCE_VIDEO_FORENSICS.md`, `04_VISUAL_IDENTITY_AND_PROMPTS.md`, and the exact needed file under `references/ranga/`; do not load the entire folder.

Use heading/range searches to extract narrow sections. Stay within `MANIFEST.yaml`'s profile word budget. Repository truth replaces cross-chat memory and reattached PDFs. Never ask the user to reattach material already stored here.

The prompt pack is an entrypoint, not higher authority. Reconcile stale prompt conflicts. Every implementation or audit handoff must state checkpoint, commit, validations, remaining gates, provider/spend state, and paid-compute shutdown state.

## Paid-checkpoint bootstrap and authority

When the user pastes or clearly invokes an implementation prompt for `CP-06` through `CP-12`, that
request authorizes the prompt's bounded provider-free activation, local code/context work, tests,
and narrowly scoped read-only inventory/rate lookups through already configured credentials. If the
selected task brief or read profile is missing, create and select the narrow checkpoint brief/profile
first, validate the context, and continue in the same chat. Missing selectors are not a reason to
return the work to the user.

That initial request does not authorize remote mutation, publication, model download, paid compute,
or spend. Complete all safe local work and the authorized read-only preflight, then stop only at the
first external mutation or paid boundary. Ask once with a combined proposal containing the exact
operations, numeric finite-action spend cap, selected GPU offering and current rate when applicable,
derived volume size, recurring retained-volume rate and retention consent when applicable, and stop
conditions. The finite cap covers checkpoint actions through handoff; ongoing retained-volume
billing is disclosed and approved separately. After the user approves that exact proposal, record
the authority and continue without another confirmation unless scope, rate, capacity, or cap risk
changes.

Before doing any VideoForge work:

1. Read `project-context/00_START_HERE.md`.
2. Read `project-context/MANIFEST.yaml` and `project-context/CURRENT_STATE.yaml`, then follow one narrow read profile for the task.
3. Follow the precedence in the manifest. Its decision list is a derived index; the decision ledger and primary domain file are normative. Any mismatch is a blocker to reconcile, never something to guess through.
4. Do not start application implementation merely because the context pack exists. Implementation begins only when the user asks for it.

Non-negotiable output rule: VideoForge must never add motion graphics, text overlays, captions, lower-thirds, decorative graphics, borders, watermarks, title cards, or decorative transitions. Hard cuts only. A slow, smooth zoom on an AI image is required and is not considered motion graphics.

Image styles are reusable, immutable published versions. The built-in default is `documentary_stock_v1`. Reference-image vision analysis runs only when a new draft style version is explicitly analyzed—never for each video or generated image. Project revisions pin `image_style_version_id`, `style_profile_hash`, `extra_prompt_keywords`, and `apply_extra_prompt_keywords`.

Avatars are reusable workspace presets. Ordinary project creation must select an exact ready `avatar_profile_version_id` from the Avatar Hub; never add a per-project avatar upload bypass. Project revisions pin the resolved Avatar Profile/version/hash, canonical runtime source asset/checksum, and exact compatibility state/evidence snapshot used at preflight.

When the user changes a decision, update the context pack in the same change. Follow `project-context/16_CONTEXT_MAINTENANCE.md`; do not leave contradictory copies. Do not silently convert an unresolved benchmark gate into a confirmed fact.

During application development, follow `project-context/19_IMPLEMENTATION_PLAYBOOK.md`: reuse the stable hot-reload URL in the user's real Chrome, default provider mode to fixture/no spend, make small green commits, and update `CURRENT_STATE.yaml`.
