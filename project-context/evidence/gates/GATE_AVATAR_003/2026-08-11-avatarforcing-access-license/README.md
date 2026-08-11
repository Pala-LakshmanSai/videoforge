# GATE_AVATAR_003 — AvatarForcing access/license preflight

Result: **OPEN — BLOCKED**

Checked 2026-08-11 at `2026-08-11T14:53:50Z` and `$0`. No credential, account, legal
acceptance, model weight/LFS/Xet object, model installation, provider call, GPU, RunPod resource,
or inference was used.

## Confirmed first-party facts

- The public `KlingAIResearch/AvatarForcing` repository was reachable at main revision
  `63b73e6c0f7bb42180ca6d7e1bf11c1de1a80b39` (commit time `2026-05-09T02:53:47Z`).
- Its pinned README identifies `lycui/AvatarForcing` as the AvatarForcing ODE/DMD weights source
  and labels the project `Apache-2.0`.
- Its pinned root `LICENSE.txt` has Git blob
  `4f099d8892d0d4b98a797f64076a285a32f173ca` and SHA-256
  `138fd1e58a72a7073c02c2fb5f772539d2b944519d4b17f60d3ecdc111228314`.
  The file names `RollingForcing`, Tencent, training/inference code, parameters, and weights, and
  limits that named work to academic use while prohibiting commercial or production use.
- GitHub classifies the repository license as `Other` / `NOASSERTION`, not Apache-2.0.
- The public, ungated `lycui/AvatarForcing` weights repository was reachable at revision
  `e2448919a7b535c29f34e07892884ae1a43c6ace` (last modified
  `2026-03-26T15:22:08Z`). Its model metadata and card contain no license field or license text.
- The pinned weights tree identifies `model.pt` as a 19,156,315,889-byte LFS object with SHA-256
  OID `63dd0b3841f4cd2e4f13f810b98ee4fa1695586c600b6ccd1e382477cbdbb2b3`, and
  `ode_audio_init.pt` as a 6,385,525,435-byte LFS object with SHA-256 OID
  `c785f0850b7924517df3740ed7f767b9715ead86559d8e345cf89caeaa67b238`. These
  identities were read from metadata only; no weight bytes or LFS pointers were downloaded.

## Resolution

Official artifacts remain contradictory and insufficient for intended commercial code-and-weights
use. The README's Apache-2.0 label conflicts with the committed restrictive license file, that
license names another project, and the weights repository supplies no governing license. Public
access and exact revision identity do not grant commercial permission.

`GATE_AVATAR_003` remains open. AvatarForcing stays blocked from weight download, paid
qualification, production profile, and commercial use. The sole successor is a bounded,
read-only primary-avatar replacement-model decision; it must not download or select around an
ambiguous license.

## Pinned official URLs

- https://github.com/KlingAIResearch/AvatarForcing
- https://github.com/KlingAIResearch/AvatarForcing/commit/63b73e6c0f7bb42180ca6d7e1bf11c1de1a80b39
- https://github.com/KlingAIResearch/AvatarForcing/blob/63b73e6c0f7bb42180ca6d7e1bf11c1de1a80b39/README.md
- https://github.com/KlingAIResearch/AvatarForcing/blob/63b73e6c0f7bb42180ca6d7e1bf11c1de1a80b39/LICENSE.txt
- https://huggingface.co/lycui/AvatarForcing
- https://huggingface.co/lycui/AvatarForcing/tree/e2448919a7b535c29f34e07892884ae1a43c6ace
- https://huggingface.co/lycui/AvatarForcing/blob/e2448919a7b535c29f34e07892884ae1a43c6ace/README.md

## Small-artifact hashes

- GitHub README SHA-256:
  `1df656ae4d24698df8e4039b2ec9fd1898c6bf6aecaa0b0c57a28c0f4e550112`
- GitHub `LICENSE.txt` SHA-256:
  `138fd1e58a72a7073c02c2fb5f772539d2b944519d4b17f60d3ecdc111228314`
- Hugging Face README SHA-256:
  `9f76aceebfa5206cbc9f196ef2a2f15cb8e45d7705ea4fd18395b4b9c94ffe4a`
- Hugging Face tree-metadata response SHA-256:
  `b87997e8d14e1812e15a28bce56e2802e6b1c6d075f9b72b81bb24da40f49dcf`
