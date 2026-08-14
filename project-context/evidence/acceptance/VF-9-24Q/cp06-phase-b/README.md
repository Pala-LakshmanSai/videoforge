# CP-06 Phase B acceptance

Status: runtime/cleanup `READY_FOR_USER_REVIEW`; settled-cost handoff pending.

The exact Mage INT8 runtime passed its bounded live qualification on Sujal RunPod. The exact pinned
model was prepared once on the retained 50 GB EU-RO-1 network volume, the missing-volume and
wrong-volume-hash cases failed closed, and eight 1280x720 PNGs were generated across two fresh,
sequential RTX 4090 Pods. Every Pod and the private template were deleted and independently proven
absent. The only retained RunPod resource is the approved network volume at `$3.50/month`.

The ignored private output root is `apps/web/.videoforge/cp06-phase-b/outputs/`; the contact sheet is
`contact-sheet.png`. Raw provider IDs, credentials, prompts, model bytes, journal records, and PNGs
are intentionally excluded from Git. The sanitized proof is `acceptance.json`.

RunPod billing is still partial: the final refresh observed 5 of 15 Pod attempts and `$0.1184386462`.
The checkpoint therefore records settled spend as `null` and uses the conservative `$1.110002`
accounted upper bound, below the `$2.70` internal stop and `$3.00` authorization cap.

Technical acceptance does not approve image quality and does not close the production image, style,
GPU, RunPod, or cost gates. The user must review the displayed contact sheet. CP-07 is unauthorized.
