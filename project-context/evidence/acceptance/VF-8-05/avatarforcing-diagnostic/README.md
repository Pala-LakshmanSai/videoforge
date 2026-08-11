# VF-8-05 AvatarForcing diagnostic evidence

Status: diagnostic partial; no paid retry authorized

- Source commit: `8ceecb4add96e93c5f3892b28152e494e2c964bf`
- GitHub Actions build: `31527309243` (`success`)
- Immutable image: `ghcr.io/pala-lakshmansai/videoforge-avatar-primary@sha256:02022fad4b9c924d329925446968aad946db7b3578f78f0b925c9779d1396db7`
- Built-container smokes: dependency import, complete source compile, and exact one-call handler registration.
- Image: 14 layers, `3,811,349,878` compressed bytes; largest layer `3,112,877,283` bytes.
- Pinned required large model files: `43,465,049,947` bytes before smaller configs/tokenizer files.
- RunPod live inventory after VF-8-04: zero Pods, endpoints, templates, volumes, and workers.
- Spend in this diagnostic: `$0`.

The built linux/amd64 image imports the real handler and registers its exact callable without model
bootstrap. This closes a missing CI proof, but does not explain RunPod's exited allocation or qualify
AvatarForcing. The next paid attempt requires retained redacted endpoint/worker logs or another
concrete provider-capacity/configuration correction. `GATE_AVATAR_003` remains open.
