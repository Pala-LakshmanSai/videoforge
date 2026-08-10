# GATE_LLM_001 — Runware account preflight

Result: **OPEN — account funding prerequisite blocked inference before spend**

On 2026-08-10 the authorized Sujal Google account created Runware workspace `videoforgesujal` and
an enabled qualification API key stored in macOS Keychain service
`com.videoforge.runware.qualification`. No credential value is in Git or this evidence.

The bounded runner at implementation commits `97d766b` and `2f5cb87` prepared five strict-schema
batches covering 40 owned/synthetic scenes and five styles. Runware rejected live inference at
account preflight with HTTP 400 / `thirdPartyInsufficientCredits`: external inference requires a
paid invoice or at least `$5` credit. Wallet remained `$0.05`; spend this month remained `$0.00`.
No model inference completed, no output was returned, and `GATE_LLM_001` remains open.

One initially displayed key entered tool output and was immediately deleted. A second unusable key
was also deleted. The current replacement was transferred directly from the browser DOM to macOS
Keychain without display. Secret scan passed.

Local acceptance remained green: provider-sandbox 40/40 tests, forced uncached `pnpm verify`, local
Workerd 1/1, and installed Chrome 38/38. Provider mode remains `fixture`.

Resume only after explicit authorization for Runware's `$5` account-funding prerequisite or a paid
invoice. That cash-flow requirement cannot be charged to or transferred from another provider
sub-cap by inference.

