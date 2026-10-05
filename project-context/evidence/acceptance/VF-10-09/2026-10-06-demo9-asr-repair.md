# Repeated zero-duration transcription repair — 6 October 2026 IST

Checkpoint V2-09 / VF-10-09. User requests exact demo9 diagnosis, durable prevention and production publication. Production baseline is `34cdd788e802cb26b30dfecb4b2271ef86493c08` / Worker `052d3dd9-89e6-454f-bec0-f7e32bb6f8e8` at 100%. Preserve unrelated primary-checkout changes.

## Exact cause

The inspected 1,167,020 ms narration failed twice with `ASR_OUTPUT_INVALID`, using the same source checksum, Cloud image and runtime. Both original rentals are CLEAN with independently recorded cleanup timestamps. No scene-generation requests had begun.

Exact saved-source reproduction with pinned whisper.cpp 1.8.4/base.en and four CPU threads fails in chunk 0 at canonical word 828: `word 828 has no duration after source-bound clamping`. At 317,900 ms, Whisper emits two consecutive zero-duration words, then a 10 ms word followed by an ordinary positive-duration word. The existing parser inserts 10 ms for each zero-duration word, shifts the following short word's start beyond its unchanged end, then rejects its own repaired timestamps. A blind retry repeats the deterministic content-dependent failure. Browser/device origin is not the mechanism; no person-specific failure-rate claim is established by shared-account records.

## Repair and prevention

The shared parser carries only the existing bounded zero-duration repair into immediately consumed short-word intervals, until original timestamps catch up. All words remain ordered and present. Repair-origin propagation stops at 100 ms; backward movement before that origin, unrelated overlaps after catch-up, malformed offsets and source bounds remain rejected. A separated zero-duration group starts a new repair origin.

One positive job regression reproduces the failed sequence and verifies exact preserved words/times; negative parser regressions reject unrelated and unbounded overlaps. This parser serves both Cloud and personal-worker paths. Desktop release metadata advances consistently to 0.1.52; historical 0.1.51 installers remain immutable.

Local checks: 41 transcription tests pass after the exact new regression fails on baseline. Media-local checks: 120 run, 119 pass, one explicitly skipped platform check. Exact full saved-source transcription succeeds with 3,007 words across two chunks, original narration hash unchanged. Ruff and diff checks pass. The private Linux qualification archive reuses existing accepted span/render fixtures plus the exact failed narration; no public media, credential or signed capability is committed.

## Qualified production release

Reviewed parser/build source: `eb10804bee63fa4856a406a3c7e5c0ddad48fcf7`. Independent review adds the original-timestamp monotonicity guard so a genuine overlap cannot hide inside an active repair. Both actual saved raw chunks replay to the same 3,007-word result after that tightening.

Linux offline qualification run [37362596639](https://github.com/Pala-LakshmanSai/videoforge/actions/runs/37362596639) passes exact saved-source ASR, accepted span/render fixtures, 41 ASR regressions, 77 transport/personal-worker checks and eight render/motion checks. The private qualified image is `ghcr.io/pala-lakshmansai/videoforge-cloud-media-runtime-private@sha256:fa7485d9e3363ee9bf8f3843107466620606c6298e20fe59f52fde845a8e5bff`; native source hash `sha256:1cb323d96d4d993b0759a9b527e7eeef324ed1f2d348cc61dfda53f8556f1207`, runtime hash `sha256:091b442ec55c06185c6b422d05279f91ee3788977d88897ebd66b7467c82df5c`. All 39 native source files, original tool hashes and pinned model match. Existing base image/tools/model are reused; no new GPU/model qualification is inferred.

Desktop run [37362588889](https://github.com/Pala-LakshmanSai/videoforge/actions/runs/37362588889) has successful Windows and macOS native tests, render/frozen smoke and packaging. Windows first failed to acquire a runner; its exact job rerun succeeded. The dependent publisher then failed runner acquisition after 15m02s with zero steps. The unchanged repository publisher was executed locally only after that terminal failure and actual release/tag 404 checks, using the two exact retained CI artifacts. This is successful manual publication, not a successful CI publisher job.

Immutable [Worker 0.1.52](https://github.com/Pala-LakshmanSai/videoforge/releases/tag/media-worker-v0.1.52) targets exact build source `eb10804` and execution bundle `sha256:4ca172897479d1c2be73d4371ed920799e49f1abcb65f9cd0620553c4afaf0f1`, independently recomputed from that clean checkout. Windows installer: 279,628,594 bytes, `sha256:ef655d89584afe4e3dda44e46eaa1c1daa913f472e52945d2d8760538ca0476e`, existing UNSIGNED_BETA trust. Mac installer: 414,292,812 bytes, `sha256:4d8431ea2e6e89391a2f812b301b2f21c67881c5620e28f2ac8372395f56d734`, existing AD_HOC_BETA trust. Both complete published HTTP bodies, GitHub asset digests and CI binaries match. The 916-byte release manifest hashes to `sha256:dd99873c0ea51d5962c8ef555a49f5257100bb551be37b5bf872e5a3da1f1a2e`. No notarization, Authenticode or fresh user-device installation is claimed.

## Combined deployment and prevention

Concurrent prompt repair was integrated by clean fast-forward through `178a809` and acceptance `e38f1b1`, preserving the dirty primary checkout. Combined executable source remains `178a809c59a7c0e555605847e7d889f2482aa9be`, native schema 278. Cloud first published at Worker `5a1e219b`; the combined prompt release at `f8c58190` retained it. Final Desktop-only promotion is Worker `9ddb099e-f984-4a1e-96fd-250d4b6aaf3a` at 100%, changing only `MEDIA_WORKER_RELEASE_MANIFEST_JSON`. All 55 bindings, 27 secret names, six resources, three Workflow IDs, Cloud pins and the prompt migration remain exact. Reused qualified web assets/bundle are preserved; the separate prompt acceptance retains its own canary and spend evidence.

Official triggers refresh the three existing definitions. With all active generations/leases/waiters/CPU attempts zero, only the idle canonical observer is refreshed with original parameters. It runs on registration `eb3418e9-ec3d-4c63-810e-f849cc8bdf74` with an observed successful error-null tick. No generation/provider Workflow is restarted. The final independent read-only audit verifies both active Worker bindings and current observer adoption. Real installed Chrome shows the incident account's Create page as Cloud ready; no project is submitted.

The common parser covers Cloud and personal workers. Promoting the 0.1.52 manifest also blocks older Local execution bundles with `MEDIA_WORKER_UPDATE_REQUIRED` before lease selection. Existing leases stay intact. Settings Connect performs the existing checksum/version-verified upgrade and reconnect; it is user initiated, not a silent device update.

## Original project and remaining gates

The incident project became ARCHIVED at `2026-10-05T19:22:41.735633Z`, before publication. Failure cleanup/retention does not archive projects; no staged operator archive receipt exists. Normal archival requires an authenticated DELETE, but the exact person/device is unverified because that path stores no actor receipt. Preserve the archive until the user confirms restoration. Production detail 404 correctly applies the ACTIVE-only private query; this is separate from the repaired ASR defect.

No supported production transcription retry or new full-video generation occurred. Original narration, revisions and both failed attempts remain unchanged; both original rentals remain CLEAN. This ASR repair starts no new provider inference, rentals or retained resources. The ongoing ordinary Cloud policy is cloned exactly into authority `2ecc3a9f-7ad9-4c91-8206-838d1bc94a29`; original no-replay, rate and cleanup rules remain. One unrelated historical UNKNOWN/no-Pod cleanup liability remains preserved and is not declared settled.

Remaining: user restore preference, then original saved-project production recovery/full-film acceptance; fresh Local device installation; editorial/invoice/throughput and external-provider gates. Canonical verify retains baseline failures: unsorted imports in unchanged frozen smoke, the same formatting warning set, and existing Chrome/UI assertions. Focused runtime qualifications pass; broad CI is not reported green. External outages and invalid provider output cannot be guaranteed absent.

Private operational evidence stays under `.videoforge/demo9-failure-20261006/`; no credential, signed capability, customer identifier, audio or raw provider receipt is committed. Durable evidence includes final Cloud/Desktop audits, strict raw-chunk replay, native CI/artifact/readback proofs, workflow adoption and archive provenance.
