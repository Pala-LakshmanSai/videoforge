# New-chat bootstrap prompt

```text
Continue VideoForge in /Users/lakshmansai/Documents/videoforge.

Keep responses concise and spend-conscious.

1. Read AGENTS.md.
2. Read project-context/00_START_HERE.md, MANIFEST.yaml, and CURRENT_STATE.yaml.
3. Preserve current HEAD/newer commits and ignored private inputs; never reset historical evidence.
4. Load only phase9_isolated_model_lane_contracts and tasks/VF-9-24K.md.

Current authority is $0/provider-free. Do not call RunPod/Runware, access credentials, download a
model, create a Pod/template/volume, publish an image, mutate cloud state, or spend.

The active design has two isolated persistent EU-RO-1 model volumes and two disposable Pods: exact
ImageForge Mage-Flow INT8 ConvRot for images, and EchoMimicV3-Flash FP8 for short selected avatar
spans. Never share/cross-adopt resources. User selects exact live compatible GPUs independently.
Generate starts both Pods concurrently while local preparation runs. Normal boot loads offline from
the verified lane volume and reports model_ready only after load/warm-up. Delete Pods after durable
outputs; retain both volumes.

VF-9-24I is superseded historical evidence. It produced no MP4. Its old $8 ceiling and ephemeral
cleanup design authorize nothing now. VF-9-24J completed only the architecture/context reset.
VF-9-24K is proposed but paused: do not change application code until the user explicitly
authorizes implementation. Even then it remains provider-free and $0.
```

If this template disagrees with `CURRENT_STATE.yaml`, stop and reconcile; current state wins.
