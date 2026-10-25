# Nethra ↔ Codex bridge, 25 October 2026

The ongoing **Self Improvement** objective now has three native tools:

- `host_diagnostics` reports the host's current memory, Nethra's configured 4,096-token context and 1,100-token per-step thinking budget, and whether this PC's Codex CLI is signed in with ChatGPT. These are facts about configuration and a momentary memory sample, not response-time measurements.
- `consult_codex` is available only when the owner enables Codex for that objective on Windows. It sends one bounded question plus the objective and success criteria to a separate Codex CLI turn using GPT-5.6 Luna. The turn is read-only, ignores user configuration, and returns advice plus token usage. It does not edit code or measure speed. Reservations are capped at three consultations per UTC day across all Nethra objectives.
- `propose_code_work` is available only on a Windows task whose owner has enabled Codex work and approved the Junction read folder. It creates one scoped **draft** in Work Activity, reusing that draft on retries. The owner starts the development run; applying a verified result to the main checkout still requires review.

The first live handshake returned `NETHRA_CODEX_BRIDGE_OK` in 5.2 seconds through Junction's own client. The direct CLI smoke returned the same token in about 7 seconds and reported 14,246 input tokens and 12 output tokens. These checks prove the bridge, not a Nethra speed improvement.

The earlier measured Nethra baseline is in [NETHRA_DELIVERY_2026-10-25.md](NETHRA_DELIVERY_2026-10-25.md): one cold greeting took 73.6 seconds, the first post-warm-up greeting 7.5 seconds, and a warm greeting 6.8 seconds. These were single runs, not a statistical benchmark. Re-measure before claiming a speedup.

## Cost and authority

On this PC, `codex login status` confirms a ChatGPT sign-in, and the shell has no `OPENAI_API_KEY`. This CLI path consumes the owner's shared ChatGPT Codex allowance. It does not use separately billed OpenAI API-key tokens. Nethra can access it only on Windows objectives where the owner enables Codex advice and drafts. OpenAI says included usage is used first; purchased credits may extend use after the limit. The account's credit balance was zero when checked. The direct GPT-5.6 Luna smoke's token count is about **0.072 credits at the published post-allowance rate** (5 credits per million input tokens and 30 per million output tokens); that is a rate-card comparison, not an amount charged or a conversion to cash. Subscription usage is not calculated from that credit number. Consultations may have much larger outputs and costs.

Sources: [OpenAI pricing](https://learn.chatgpt.com/docs/pricing), [OpenAI authentication](https://learn.chatgpt.com/docs/auth).

`consult_codex` is advisory. Actual code changes use Junction's separate Work Activity/Codex worktree flow, with verification and review before changes reach the main checkout. Nethra can prepare its first development draft, then ask the owner to start it.
