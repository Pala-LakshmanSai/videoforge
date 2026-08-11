# VF-8-05 AvatarForcing diagnostic evidence

Status: diagnostic partial; no paid retry authorized

- Source commit: `8ceecb4add96e93c5f3892b28152e494e2c964bf`
- GitHub Actions build: `31527309243` (`success`)
- Immutable image: `ghcr.io/pala-lakshmansai/videoforge-avatar-primary@sha256:02022fad4b9c924d329925446968aad946db7b3578f78f0b925c9779d1396db7`
- Built-container smokes: dependency import, complete source compile, and exact one-call handler registration.
- OCI config: `linux/amd64`, entrypoint `/opt/videoforge/entrypoint.sh`, working directory
  `/opt/avatarforcing`, 14 rootfs layers, and no overriding `Cmd`.
- Image: 14 layers, `3,811,349,878` compressed bytes; largest layer `3,112,877,283` bytes.
- Pinned required large model files: `43,465,049,947` bytes before smaller configs/tokenizer files.
- RunPod live inventory after VF-8-04: zero Pods, endpoints, templates, volumes, and workers.
- Spend in this diagnostic: `$0`.

The built linux/amd64 image imports the real handler and registers its exact callable without model
bootstrap. This closes the container-start contract. The four provider attempts instead show
allocation churn/stall while only L40S was allowed. The concrete resume correction is one endpoint,
one concurrent worker, and an exact `NVIDIA L40S` + `NVIDIA A100 80GB PCIe` capacity allowlist with
the existing five-minute no-running-pod timeout and a `$4.50` attempt cap. This does not qualify
AvatarForcing; `GATE_AVATAR_003` remains open.
