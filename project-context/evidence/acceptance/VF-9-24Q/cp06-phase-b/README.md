# CP-06 Phase B acceptance

Status: `PASS`; user visual quality accepted; billing settled under cap; zero compute reconfirmed.

The exact Mage INT8 runtime passed its bounded live qualification on Sujal RunPod. The exact pinned
model was prepared once on the retained 50 GB EU-RO-1 network volume, the missing-volume and
wrong-volume-hash cases failed closed, and eight 1280x720 PNGs were generated across two fresh,
sequential RTX 4090 Pods. Every Pod and the private template were deleted and independently proven
absent. The only retained RunPod resource is the approved network volume at `$3.50/month`.

The ignored private output root is `apps/web/.videoforge/cp06-phase-b/outputs/`; the contact sheet is
`contact-sheet.png`. Raw provider IDs, credentials, prompts, model bytes, journal records, and PNGs
are intentionally excluded from Git. The sanitized proof is `acceptance.json`.

The original handoff captured partial billing and therefore retained its historical `null` settled
spend plus conservative `$1.110002` upper bound. The later authorized `$0` read-only audit in
`settlement-reaudit.json` observed stable billing for all 15 exact Pod hashes: 16 billing records,
1,682,267 billed milliseconds, and `$0.34927155333571136` settled under the `$3.00` cap. It also
reconfirmed zero Pods/endpoints/templates/active Serverless workers and exactly the intended retained
50 GB volume.

The user accepted the displayed contact-sheet image quality. CP-06 completion does not close broader
production image, style, GPU, RunPod, or cost gates. CP-07 is unauthorized.
