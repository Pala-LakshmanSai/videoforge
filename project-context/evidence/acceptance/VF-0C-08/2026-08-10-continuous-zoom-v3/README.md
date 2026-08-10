# VF-0C-08 continuous zoom v3

Status: replacement render ready for user review

After reviewing the v2 replacement on 2026-08-10, the user requested exactly one percentage point
more endpoint zoom and even smoother motion. Commit `7d73c4e` introduces
`ffmpeg-render-v3` while retaining v1 and v2 for deterministic historical replay.

The current profile uses:

- 1.00→1.025 for short full-image and split-right scenes;
- 1.00→1.03 for typical full-image scenes;
- 1.00→1.035 for long full-image scenes;
- the same quintic smootherstep timing curve;
- per-frame floating-point source-corner coordinates with cubic interpolation, replacing integer
  crop stepping with continuous subpixel sampling.

`pnpm test:local-slice` passed through the real local API, ASR, scheduler, resolver, FFmpeg,
FFprobe, Range preview, approval, and exact download path with external providers disabled and
`$0` spend. The replacement review copy is
`/Users/lakshmansai/Downloads/videoforge-local-owned-slice-smooth-v3.mp4`.

The remaining checkpoint is human playback and seek of that exact file in installed Chrome, with
explicit confirmation that the motion now has the desired strength and smoothness.
