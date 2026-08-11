# VF-8-10 AvatarForcing A100-80GB resume evidence

Status: technical success, whole-frame quality failure; candidate not promoted

- Source commit: `26a63c1` using immutable image
  `sha256:e46c3a9d0d770905ca2d04aecf5623986425eca861f2e1ea9245a3fd5867f434`.
- One A100-80GB-only five-frame job completed: delay `336,173 ms`, execution `150,411 ms`.
- Output: H.264/AAC MP4, 624x624, 25 fps, 680 ms, 75,851 bytes,
  `sha256:6dbf892ac3680ba273b77b1a3267de8d863c0899ef84aa7443faea37e53a2da0`.
- Exact AvatarForcing source and weights revisions match locked lineage.
- Measured balance delta at cleanup: `$0` pending provider settlement; cap was `$1.00`.
- Final and independent RunPod inventories: zero Pods, endpoints, templates, volumes, and workers.

Frame contact review found severe whole-face identity/detail blur across generated frames, including
eyes, mouth, skin, and hair. This is a whole-frame failure, not an otherwise-good lip-only defect;
locked routing skips MuseTalk and uses SkyReels from original pinned source plus selected audio.
`GATE_AVATAR_003` and `GATE_FALLBACK_001` remain open.
