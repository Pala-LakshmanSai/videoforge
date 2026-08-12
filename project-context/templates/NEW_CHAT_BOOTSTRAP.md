# New-chat bootstrap prompt

```text
Continue VideoForge in /Users/lakshmansai/Documents/videoforge.

Keep responses concise and spend-conscious.

1. Read AGENTS.md.
2. Read project-context/00_START_HERE.md, MANIFEST.yaml, and CURRENT_STATE.yaml.
3. Require clean tracked HEAD descending from 2b7eb5b; preserve ignored private inputs.
4. Load only phase9_echomimic_v3_flash_sample and tasks/VF-9-24.md.

VF-9-22 is complete. EchoMimicV3-Flash is sole active avatar path. AvatarForcing, MuseTalk,
SkyReels, and their decisions/evidence are historical replay only; never dispatch them. LongCat
remains excluded.

VF-9-23 is green. Use only the pinned GHCR digest in CURRENT_STATE. Verify exact private source,
voiceover, and 10.12-second derivative hashes. Prove RunPod absolute zero, then dispatch exactly one
native EchoMimicV3-Flash job on RTX 4090. Use 100 GB ephemeral disk, no network volume, 253 frames,
8 steps, BF16, Flow_Unipc, TeaCache 0.1, seed 43, and the exact task prompt.

VF-9-24 permits one attempt and maximum $0.50. Queue stop 10 minutes; active stop at 25 minutes or
projected $0.45, whichever comes first. No retry. Persist private MP4 and redacted evidence, cleanup
in finally, independently prove zero, check play/seek/audio/duration in installed Chrome, return
READY_FOR_USER_REVIEW, then stop. Never self-approve or create a successor.
```

If this template disagrees with `CURRENT_STATE.yaml`, stop and reconcile; current state wins.
