# VideoForge agent instructions

Current phase, branch/server state, ownership, and last-green evidence live only in `project-context/CURRENT_STATE.yaml`.

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
