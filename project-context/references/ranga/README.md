# Ranga reference pack

Private research reference only. These frames teach cadence, framing, and documentary evidence selection; they are not product assets and must never appear in VideoForge output or model training.

Their visual treatment seeds only the built-in `documentary_stock_v1` Image Style. Custom styles are allowed to use other intentional still-image media; the edit cadence and no-graphics rules remain universal.

## Sources

- [Watermelon / Old Amish Way](https://www.youtube.com/watch?v=6jZ7ib2Edes), 18:52, video ID `6jZ7ib2Edes`.
- [Mosquito / Amish Way](https://www.youtube.com/watch?v=cVotLLx5bNs), 24:42, video ID `cVotLLx5bNs`.
- Retrieved/audited: 2026-08-08; independently rechecked 2026-08-13 by classifying every fifth
  native frame across both complete videos.
- Excluded wrong link: `5JCQbwj0Kso`.

## Compact cadence sheets

Watermelon opening: full avatar → full evidence → 50/50 → full evidence.

![Watermelon opening rhythm](frames/ranga-watermelon-opening-rhythm.jpg)

Mosquito opening: full avatar → full evidence → 50/50 → macro evidence.

![Mosquito opening rhythm](frames/ranga-mosquito-opening-rhythm.jpg)

## Measured edit grammar

| Metric | Mosquito | Watermelon |
|---|---:|---:|
| Avatar visible | 21.60% | 21.97% |
| Full avatar | 10.53% | 11.08% |
| 50/50 avatar | 11.07% | 10.90% |
| Avatar appearances | 86 | 66 |

- Combined mean avatar appearance: approximately 3.74 seconds.
- Typical appearance: 2–6 seconds.
- Median non-avatar gap: approximately 11.2 seconds.
- Hard cuts dominate.
- Full and split cumulative shares are almost equal.
- Near-alternation is frequent; strict alternation is a VideoForge rule, not a claim of zero source exceptions.

## What to learn from the individual frames

- `00m01s-full-avatar`: centered, direct-to-camera visual home base.
- `00m04s/00m05s-broll`: immediate literal real-world context.
- `00m10s/00m16s-50-50`: avatar left, evidence right, clean seam, aggressive crop, no border.
- `00m13s/00m24s`: close physical evidence instead of arrows or graphics.
- `05m44s-broll-context`: environment supplies credibility.
- `07m04s-broll-detail`: tactile close detail supplies proof.

Exact timestamp/provenance is in `frames/frames.csv`. Measurement values are in `measurements.csv` and `../../evidence/reference_metrics.json`.

The 2026-08-13 recheck classified 15,685 samples at six samples per second and manually reviewed
all 151 classified avatar-interval midpoint cards. It found 21.63% combined avatar time, 10.62%
full avatar, 11.01% split avatar, and a 3.745-second mean appearance. The narrow difference from
the earlier independent 5-fps estimates is classifier uncertainty, not a style change. Details are
in `every-fifth-frame-audit.json`; the locked 21–22%, near-even full/split, 2–6-second grammar stays.

## Borrow vs exclude

Borrow:

- Short avatar home-base appearances.
- Nearly equal full/split use.
- Hard-cut rhythm.
- Hands/action/detail/environment shot variation.
- Literal voiceover relevance.
- Authentic consumer-camera/documentary feel.

Exclude:

- Third-party people/footage/branding.
- Webpage and sponsor screenshots.
- Source watermarks/subtitles.
- Arrows, circles, infographics, text, multi-panel graphics.
- Decorative transitions.

The source sometimes contains excluded elements. They are observations, not output requirements.

## Rights

`rights_status=third_party_reference_only` means:

- Keep local/private.
- Do not redistribute or publicly commit without permission.
- Do not include in builds, demos, generated videos, or training data.
- Generate original Mage-Flow images instead.

This is a project provenance policy, not a legal determination.
