# GATE_IMAGE_002 — Mage access/license preflight

Result: **OPEN — BLOCKED**

Checked 2026-08-11 at `$0`. No credential, model weight, LFS/Xet object, legal acceptance, account
mutation, GPU, RunPod resource, or inference call was used.

Direct official Hugging Face access did not establish an exact downloadable checkpoint:

- Anonymous HTTP requests to the model page, model API, and raw `LICENSE` each returned `401`.
- The existing Chrome session was not signed in to Hugging Face and showed the model URL as `404`.
- Therefore the current checkpoint revision, complete file inventory, gating state, and an exact
  license artifact governing its weight files could not be authenticated or pinned.

Supporting official facts do not close the gate:

- Microsoft’s public `microsoft/Mage` source repository was reachable at commit
  `76bec2bb3818863f470de7e867c2dc7f1d0bfd83`.
- Its repository license is MIT. The pinned `LICENSE` SHA-256 is
  `275b4dd619de4e16a017b10d0beec72abbbbf14ee8a2fc68f8bdb398e821f623`.
- Its pinned README links `microsoft/Mage-Flow-Turbo`, labels Mage-Flow MIT, and also says the
  models are research-only/not intended for product or service deployment. This is an unresolved
  official-policy ambiguity, not permission to guess commercial deployment authority.
- Search-indexed copies of official Hugging Face pages reported `License: mit`, a roughly 17.5 GB
  repository, and model-file identities. Because live official retrieval returned `401`, these are
  supporting cached facts only, not a current checkpoint/license lock.

`GATE_IMAGE_002` remains open. A later exact task may use an already-authenticated Hugging Face
session only after authority allows it, without accepting new terms, then record the exact revision,
file inventory, and governing license artifact before any weights or paid Mage benchmark.

Official URLs checked:

- https://huggingface.co/microsoft/Mage-Flow-Turbo
- https://huggingface.co/api/models/microsoft/Mage-Flow-Turbo
- https://huggingface.co/microsoft/Mage-Flow-Turbo/raw/main/LICENSE
- https://github.com/microsoft/Mage
- https://github.com/microsoft/Mage/blob/76bec2bb3818863f470de7e867c2dc7f1d0bfd83/README.md
- https://github.com/microsoft/Mage/blob/76bec2bb3818863f470de7e867c2dc7f1d0bfd83/LICENSE
