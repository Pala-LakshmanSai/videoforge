# Avatar quality worker

Pinned cold SkyReels V3 whole-frame fallback. It always starts from the immutable original Avatar
Profile runtime image plus selected span audio; failed AvatarForcing/MuseTalk bytes are forbidden.

- Source: `SkyworkAI/SkyReels-V3@28c771e8456341be6a213e3d1133ed1fd19bf75d`
- Model: `Skywork/SkyReels-V3-A2V-19B@fdad4053f492aba389b5a8c3c6982118c6a1ecf3`
- Output: `skyreels-centered-960x960p25-v2`
- RunPod: one scale-zero worker only; weights download lazily into ephemeral storage.

Process health deliberately reports `model_state=not_loaded`; readiness is proven per job.
Workers emit safe bootstrap, inference, 60-second heartbeat, and output-validation progress. Inference
fails closed after 2,550 seconds, leaving 150 seconds for a 2,700-second endpoint to return evidence
and drain before platform termination.
