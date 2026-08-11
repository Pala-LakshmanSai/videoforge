# VF-8-02 — Runware runtime composition

Result: **PASS with live-provider availability noted**

The Node sandbox now composes the locked `deepseek:v4@flash` prompt writer and
`google:gemini@3.5-flash` style analyzer through one server-only HTTP transport and one combined
`$0.20` ledger. The credential is loaded only from macOS Keychain after exact sandbox enablement;
fixture/local remain provider-free.

Fake HTTP acceptance covers exact replay, changed-body conflict, cap exhaustion, timeout, malformed
success, definite 4xx release, usage/cost mapping, and secret-redacted failures. A live DeepSeek
smoke reached Runware with valid authentication and a corrected UUID-v4 request. Runware returned
HTTP 400 `providerUnavailable`; no provider cost settled. No Gemini call was needed or made.

The runtime is therefore wired and fail-closed. The earlier accepted GATE_LLM_001 live qualification
remains the model-contract proof; this task did not falsely convert temporary provider availability
into a product failure or spend retries blindly.
