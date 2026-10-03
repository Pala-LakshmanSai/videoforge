# Voiceover-based MP4 download filename

Checkpoint V2-09, codex/seedance-video. Publication pending at this implementation commit.

Approved final downloads derive their name from the exact revision voiceover asset metadata, with tenant/workspace/project/asset/kind joins. Final `.mp3` or `.wav` becomes `.mp4`, case-insensitively. Project title is independent. UTF-8 Content-Disposition preserves non-ASCII names; control/path characters cannot inject headers. Historical missing metadata keeps videoforge-output.mp4. The browser no longer supplies a fixed filename. Preview inline disposition, explicit approval, immutable output checksum, private ownership, retention and byte-range gates remain.

404 product, R2 signer, Review and Library tests pass. MP3, WAV, multiple dots, apostrophe, Unicode and unsafe control examples exercise the authenticated output route with unchanged artifact bytes/checksum; existing range and preview regressions pass. Library signs the same voiceover-derived filename, including UTF-8 names, and neither screen overrides it. Web/Worker TypeScript, changed-file lint and both builds pass. Shared safe disposition handling and the exact Library revision/voiceover join add 1,766 measured bytes per static closure (production 2,809,255; staging 2,805,429). Exact ceilings follow these audited totals; no dependencies or provider/native quarantine exceptions were added. Final firewall/context and published owner/foreign download-header plus real Chrome proof follow.

Both firewalls, context validation and secret scan pass; existing optional context warnings remain. Production baseline range probes confirm both download paths served the original names before publication, unchanged eight-byte MP4 ranges/checksum headers and foreign-account 404. Published naming and real Chrome proof remain pending.

No provider request, project creation, render or compute start/stop is required. Native runtime and accepted media remain unchanged. This naming proof does not establish new render/editorial/performance/invoice acceptance.
