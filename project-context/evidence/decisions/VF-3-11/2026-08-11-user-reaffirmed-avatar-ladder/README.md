# VF-3-11 avatar replacement decision

Checked: 2026-08-11

## Result

No replacement model was selected. The user explicitly reaffirmed the Brainstorm model ladder and
corrected an attempted reconsideration of LongCat Avatar 1.5: AvatarForcing remains the selected
primary, LongCat remains excluded, and the existing AvatarForcing commercial-license blocker stays
open.

The bounded replacement review stopped before any repository change, credential access, model
download, provider call, GPU/cloud mutation, or spend. No technical or commercial qualification was
claimed.

## Consequence

- `DEC_AVATAR_001` remains AvatarForcing, blocked by `GATE_AVATAR_003`.
- No Avatar primary may be downloaded, qualified, or exposed as a production profile.
- Independent implementation work may continue without changing the locked model ladder.
- Avatar provider work resumes only after authoritative commercial code-and-weights permission or a
  new explicit user model decision.

The explicit current-user decision is authoritative under `16_CONTEXT_MAINTENANCE.md`.
