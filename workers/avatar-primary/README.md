# CP-07 EchoMimicV3-Flash Turbo FP8 Pod worker

The active container is a persistent Pod service, not Serverless. `EchoMimicV3-Flash Turbo FP8` is
the VideoForge runtime-profile label for the accelerated official 8-step `EchoMimicV3-Flash` /
`echomimicv3-flash-pro` lineage plus the owned FP8 preparation; it is not a substituted upstream
checkpoint. It pins the first-party Echo source, Flash, Wan base, audio encoder, Torch, and TorchAO.
A separately authorized preparation command
downloads the pinned source files, derives the VideoForge-owned FP8 state, reopens it with
`weights_only=True`, hashes every source/prepared byte, and writes the completion marker last.

Ordinary boot is offline. It mounts only the Echo volume, verifies the complete exact manifest,
loads the prepared FP8 state, performs one real inference-path warm-up, and reports `model_ready`
only afterward. Model download, first-request material quantization, Long Video CFG, full voiceover,
repair, fallback, and Mage/cross-volume mounts are forbidden.

The qualification API accepts only owned, checksum-bound 2/4/6-second selected spans with the
scheduler's exact 500 ms context-padding and trim lineage. It writes to a project/revision/span/
attempt-isolated scratch root outside the model mount, trims padding back to the selected duration,
validates the native 25 fps MP4 A/V contract, and cleans scratch on success or failure.

```sh
python3 -m unittest discover -s tests
```

Immutable publish target: `ghcr.io/pala-lakshmansai/videoforge-echo-flash-turbo-cp07@sha256:<digest>`.
The workflow defaults to `publish=false`; publication is a separate paid-phase mutation.
