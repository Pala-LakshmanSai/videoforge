# Progress wall-clock elapsed time — 2026-10-02

Checkpoint V2-09 / VF-10-09. User authorized timer repair and production publication. Base application source d3ca02764ab6afa53de613084fc79a67ded0aa22; isolated branch codex/progress-elapsed preserves the main checkout and the current avatar-progress release.

The old header summed stage durations, double-counting simultaneous image/avatar work and excluding queue/handoff waits. It now measures project creation (Prepare project start) to now during production, then freezes at the persisted production terminal timestamp. Human review is excluded. Render-only runs keep their own attempt start. Existing stage timers and provider/retry/cancellation logic are unchanged.

Regression: overlapping image 10:00–10:02 and avatar 10:01–10:02:30 now total 2m30s instead of 3m30s. A stopped run ending at10:12:30 from10:00 totals12m30s, including waits, instead of summed4m42s. Both assertions failed before the repair. Success/failure/cancellation and reload tests preserve the terminal duration and exclude later review. All183 hosted screen tests, web/Worker types and changed-file lint pass.

Chrome connection unavailable: runtime does not expose Chrome despite running browser, enabled extension and valid native host. Real Chrome visual acceptance remains unverified. GPT Space root reads failed twice with Internal error; no memory write or Obsidian fallback. No generation, workflow instance, provider restart, GPU resource or model download is required. Existing video and cleanup continue unchanged. Production publication is pending.
