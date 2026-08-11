# VF-9-01 Mage-Flow-Turbo worker preflight evidence

Status: source/runtime pinned; exact weight revision remains inaccessible; RunPod absolute zero

- Official source `microsoft/Mage` is pinned at commit
  `76bec2bb3818863f470de7e867c2dc7f1d0bfd83` (tree
  `75b1925a3094fad80c2d672bbb49be905c45a83b`, 2026-08-10).
- Exact pinned source-file hashes and Git blob IDs are in `acceptance.json`.
- Official source identifies `microsoft/Mage-Flow-Turbo` as the 4B, four-step text-to-image model.
  Runtime is BF16, four steps, CFG 1.0, deterministic per-sample seeds, native 512–2048 dimensions
  divisible by 16, and packed prompt batches. At CFG 1.0 its code does not apply the separate
  negative branch, so mandatory absence constraints remain in the trusted positive prompt.
- First technical qualification target is one deterministic 1024x1024 PNG on one RTX 4090, followed
  by full/split crop and 1080p zoom review. Production chunking remains 32–64 images only after the
  single-image path passes.
- Live anonymous official Hugging Face model page/API/config checks still return HTTP 401/404.
  Therefore no exact model revision or file inventory can be pinned and no runnable image may claim
  model readiness yet. This is the sole technical access blocker; licensing is not used as a blocker
  per user direction.
- No credential, model byte, provider mutation, GPU, dispatch, or spend occurred. RunPod remained
  absolute zero.
