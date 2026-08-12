# VF-9-17 provider-render checkpoint

Status: in-progress checkpoint  
Code commit: `95ff125`  
External spend: `$0`  
Provider/GPU activity: none

## Completed

- Added a pure provider-acceptance barrier before render asset resolution.
- Required exact Mage-image or durable Avatar acceptance schema, acceptance fingerprint, attempt ID,
  asset ID/checksum equality, `PASSED` QA, and `ACCEPTED` disposition.
- Preserved the existing generic fixture resolver and FFmpeg v3 manifest behavior.
- Added fail-closed tests for rejected QA/disposition, identity drift, and invalid fingerprints.
- Focused pipeline build, typecheck, lint, and tests passed: 116 tests, zero failures.
- Forced canonical verification passed builds, lint, typecheck, contracts, 212 control-plane tests,
  212 web tests, 116 pipeline tests, 43 provider-sandbox tests, Workerd 1/1, secret scan, context,
  schemas, and all 38 installed-Chrome journeys. Playwright then failed to exit after all journey
  results, so the command was interrupted and is not recorded as a completed green canonical run.

## Not yet complete

- Durable image and Avatar repositories are not yet composed into this barrier.
- Provider lineage is not yet carried through the local media runner into one render attempt.
- Restart/replay, cancellation, checksum-drift, FFmpeg output, installed-Chrome playback, approval,
  download, and download-hash evidence remain required.
- Rejected real evidence from `VF-9-13` and `VF-8-10` must remain excluded.
- Diagnose the installed-Chrome teardown hang, then rerun canonical verification to exit code 0.

## Cost safety

No RunPod/Runware call or mutation occurred. Last independent session inventory check recorded zero
pods, workers, endpoints, templates, and volumes. Resume remains `$0`; do not access credentials or
start provider resources.
