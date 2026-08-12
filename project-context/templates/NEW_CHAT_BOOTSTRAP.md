# New-chat bootstrap prompt

```text
Continue VideoForge in /Users/lakshmansai/Documents/videoforge.

Keep responses concise and spend-conscious.

1. Read AGENTS.md.
2. Read project-context/00_START_HERE.md, MANIFEST.yaml, and CURRENT_STATE.yaml.
3. Require clean tracked HEAD descending from 2b7eb5b; preserve ignored private inputs.
4. Load only phase9_echomimic_v3_flash_worker and tasks/VF-9-23.md.

VF-9-22 is complete. EchoMimicV3-Flash is sole active avatar path. AvatarForcing, MuseTalk,
SkyReels, and their decisions/evidence are historical replay only; never dispatch them. LongCat
remains excluded.

Implement one pinned production-shaped EchoMimicV3-Flash worker in workers/avatar-primary. Preserve
secure generic job/result, signed transfer, checksum, cancellation, deadline, redaction, cost,
unique-output, cleanup, and independent-zero boundaries. Exact source/runtime manifest is under
evidence/gates/GATE_AVATAR_004/2026-08-12-echomimic-v3-flash-preflight/. Weights stay outside image,
bootstrap once into ephemeral /models, verify exact files, and reject incomplete/mutated cache.
Use RTX 4090 only in later sample task; no silent fallback.

VF-9-23 permits local code/tests, Git push, hosted CI, and one GHCR image build after local green.
Provider calls, RunPod mutation, model downloads, GPU use, and provider spend are $0/unauthorized.
After full local/hosted green and pinned digest, refresh state to exactly VF-9-24. Stop on any
manifest mismatch, failed test/build, unexplained tracked dirt, or nonzero RunPod inventory.
```

If this template disagrees with `CURRENT_STATE.yaml`, stop and reconcile; current state wins.
