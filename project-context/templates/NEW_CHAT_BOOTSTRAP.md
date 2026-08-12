# New-chat bootstrap prompt

```text
Continue VideoForge in /Users/lakshmansai/Documents/videoforge.

Keep responses concise and spend-conscious.

1. Read AGENTS.md.
2. Read project-context/00_START_HERE.md, MANIFEST.yaml, and CURRENT_STATE.yaml.
3. Require clean tracked HEAD descending from 2b7eb5b; preserve ignored private inputs.
4. Load only phase9_echomimic_v3_flash_digest_correction and tasks/VF-9-24C.md.

VF-9-22 is complete. EchoMimicV3-Flash is sole active avatar path. AvatarForcing, MuseTalk,
SkyReels, and their decisions/evidence are historical replay only; never dispatch them. LongCat
remains excluded.

VF-9-23 is green. VF-9-24 consumed its sole job authority, then stopped because RunPod created three
EXITED endpoint worker records before any output. No MP4 exists. Observed balance delta was $0 and
three independent cleanup reads proved absolute zero Pods, workers, endpoints, templates, and
volumes.

VF-9-24A completed state-aware worker accounting, durable journaling, startup/bootstrap
observability, exact-entrypoint smoke, verification, and a corrected pinned GHCR build. VF-9-24B
failed before model-ready because one tokenizer SHA-256 omitted its final `b`; it spent
`$0.0260412778` and cleanup is absolute zero. Implement only provider-free VF-9-24C: correct the pin,
test every digest length, publish one image, then request explicit second-attempt authority.
```

If this template disagrees with `CURRENT_STATE.yaml`, stop and reconcile; current state wins.
