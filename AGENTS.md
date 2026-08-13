# VideoForge agent instructions

Current phase, branch/server state, ownership, and last-green evidence live only in `project-context/CURRENT_STATE.yaml`.

## Pinned project context for every task

Treat these repository files as persistent project context for every new VideoForge task. Repository truth replaces cross-chat memory or reattached PDFs:

- startup authority: `project-context/00_START_HERE.md`, `project-context/MANIFEST.yaml`, and `project-context/CURRENT_STATE.yaml`;
- completion order and checkpoint acceptance: `project-context/22_PROJECT_COMPLETION_CHECKPOINTS.md`;
- copy-ready implementation and audit prompts: `project-context/templates/CHECKPOINT_CHAT_PROMPTS.md`;
- current work scope: the exact read profile and task brief selected by `MANIFEST.yaml` and `CURRENT_STATE.yaml`;
- Ranga evidence for style, scheduling, or visual-quality work: `project-context/03_REFERENCE_VIDEO_FORENSICS.md`, `project-context/04_VISUAL_IDENTITY_AND_PROMPTS.md`, and `project-context/references/ranga/`.

At the start of each task, read the startup authority, identify the current checkpoint, then read only that checkpoint section, its matching prompt, and the selected profile/brief. Load the Ranga evidence or other domain files only when the task needs them. Do not preload the whole context pack; do not ask the user to reattach material already stored here.

The prompt pack is an entrypoint, not higher authority. If a copied prompt conflicts with current repository state, stop and reconcile the context pack instead of following stale text. Every implementation or audit handoff must state the checkpoint, exact commit, validations, remaining gates, provider/spend state, and whether all paid compute is stopped.

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
