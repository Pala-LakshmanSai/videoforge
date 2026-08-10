# VF-0C-08 subtle zoom rework

Status: replacement render ready for user review

On 2026-08-10 the user manually opened and played the previously downloaded Phase 0C MP4 in
installed Chrome. Playback worked, but the user rejected the image motion because the 4–8% zoom
was too strong and exposed visible crop shake.

Commit `d9bee0e` introduces `ffmpeg-render-v2`:

- full-image scenes zoom from 1.00 to 1.015, 1.02, or 1.025 according to scene length;
- split-right images zoom from 1.00 to 1.015;
- quintic smootherstep settles speed and acceleration at both endpoints;
- a 4× Lanczos working canvas reduces integer crop quantization before the final 1920×1080 sample;
- render and zoom profile versions are cross-bound by both canonical validators and the worker;
- `ffmpeg-render-v1` remains accepted only for deterministic replay of historical manifests.

`pnpm test:local-slice` passed with external providers disabled and `$0` spend. Attempt
`attempt_render_local_011` reproduced the same bytes as the first v2 render. The replacement review
copy is `/Users/lakshmansai/Downloads/videoforge-local-owned-slice-smooth-v2.mp4`.

The remaining checkpoint is human playback and seek of that replacement file in installed Chrome,
with explicit confirmation that the image motion now feels subtle and smooth.
