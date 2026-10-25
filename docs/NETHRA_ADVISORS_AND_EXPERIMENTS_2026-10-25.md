# Nethra advisors and measured experiments, 25 October 2026

Builds on [NETHRA_CODEX_BRIDGE_2026-10-25.md](NETHRA_CODEX_BRIDGE_2026-10-25.md) and [NETHRA_PROGRESS_TELEMETRY_2026-10-25.md](NETHRA_PROGRESS_TELEMETRY_2026-10-25.md).

The task toggle is now **Self-improvement**. It is still off by default, can only be enabled on Windows, and stays the single switch for advice, experiments and development drafts.

## Two advisors, governed by live usage

- `consult_codex` (GPT-5.6 Luna, read-only, user config ignored). This is unchanged except for the gate.
- `consult_claude` (Claude Code CLI, `sonnet` alias, currently `claude-sonnet-5-5`) is new. Each turn has no built-in tools (`--tools ""`), no MCP servers (`--strict-mcp-config`), no user, project or local settings or hooks (`--setting-sources ""`) and no saved session (`--no-session-persistence`). It uses a short advisor system prompt. The prompt is sent over stdin to the real `claude.exe`, with no shell. Only the objective, success criteria and Nethra's question are sent. Read roots, evidence and owner messages are not.

There is no fixed daily count any more. Before each consultation, Junction checks that advisor's live plan windows:

- **Codex:** `codex app-server` → `account/rateLimits/read`. This is a live query against the signed-in ChatGPT account. It does not spend usage and is cached for 60 seconds.
- **Claude:** the `rate_limit_event` that Claude Code emits on every turn (five-hour and seven-day utilization), saved after each consultation. Before the first reply there is no reading, so one attempt is allowed. A rejected turn is recorded too.

An advisor is available while every current window is below `100 − reserve` percent. The owner sets the reserve in **Settings → Self-improvement advisors**. The default is 10%, and the range is 0–50%; 0 means use everything up to the plan limit. A window past its reset time no longer blocks. When an advisor is resting, the tool error names the blocking window and the exact time it becomes available again. Nethra is told to `schedule_wake` for that time or continue without it. The **Check usage now** button shows both advisors' live state. Every consultation is still journaled (`CODEX_CONSULT_RESERVED` and `CLAUDE_CONSULT_RESERVED`).

Measured at delivery, live on this PC:
- Codex five-hour window 100%, seven-day 16%. It was correctly refused, available again at 23:52 UTC.
- One real `consult_claude` took 7.9 s and used 737 input and 200 output tokens. The Claude five-hour window read 29% afterwards, but that window is shared with the owner's other Claude use, including the development session that built this.

### Terms

Checked against [Claude Code legal and compliance](https://code.claude.com/docs/en/legal-and-compliance) on 25 October 2026. Junction runs the owner's own, **unmodified** Claude Code binary, signed in through Anthropic's own flow. It never reads, stores or forwards the OAuth token. The usage is billed to the owner's own subscription and is not offered to anyone else. The page explicitly permits an end user signing in to the unmodified binary with their own subscription. It forbids third-party apps offering Claude.ai login, or routing other users' requests through subscription credentials; Junction does neither. It also notes that advertised Pro/Max limits "assume ordinary, individual usage", so Anthropic's limits, not Junction's, are the outer bound. If Junction were ever distributed to other people, each person would need their own sign-in; nothing here shares one. The equivalent OpenAI position is in the Codex bridge note.

## Experiments: before/after verdicts computed by Junction

`experiment` has three actions:

1. `start` with `metric` and `hypothesis`, plus optional `changeKind` (`code` by default, or `setting` or `other`) and `workId`. This freezes a baseline from the last 7 days and needs at least 5 samples. Metrics:
   - `task_model_ms` (this objective's inference intervals)
   - `chat_response_ms` (local chat replies)
   - `chat_tokens_per_second`

   Chat baselines are pinned to their most common model, and after-samples from other models are ignored.
2. `mark_change` records when the change was applied, by Nethra. If `workId` names a Work Activity draft, the host instead uses the time Work Activity promoted the verified change into the checkout.
3. `evaluate` uses only samples after the change point. For `code` changes, the change point is the first Junction start after the change, which `host_starts` records at launch. Before that the verdict is `WAITING_FOR_RESTART`.

Verdicts:
- `IMPROVED` or `REGRESSED` require at least 5 after-samples, a two-sided Mann-Whitney U test with p < 0.05, and at least a 5% change in the median.
- Otherwise the verdict is `NO_CLEAR_CHANGE`, `INSUFFICIENT_DATA`, `WAITING_FOR_CHANGE` or `WAITING_FOR_RESTART`.

A definitive verdict concludes the experiment, and later samples cannot rewrite it. Raw values stay in the host database; tools and screens see counts, medians, p and the relative change. Concluded verdicts appear in the task's activity, attributed to Junction, on Windows and Android. Windows also shows an Experiments card on the task page.

Caveat: these are real workloads, not a controlled benchmark. A shift in what was asked can move medians, and the verdict text says so.

## Context budget

Nethra runs at a 4,096-token context with up to 1,536 generated tokens. Measured with Ollama's own prompt counts, using the real system prompt and a minimal user turn:

| Objective | Before | After |
|---|---:|---:|
| Self-improvement enabled (18 → 18 tools sent) | 1,557 | 1,609 |
| Ordinary task, no watched sources (16 → 14 tools) | 1,394 | 1,126 |

To pay for the new tools:
- Calendar and Gmail tools are only sent to tasks that watch those sources.
- Phone tools are only sent when a phone channel exists.
- Advisor and experiment tools are only sent to self-improvement tasks.
- The system prompt only carries instructions for tools that task has.

Hidden tools still refuse at execution.

## Not done

- Long multi-step wakes still grow the message list without a token check. A seed near its 4,000-character bound, plus several tool results, can approach the context limit, and Ollama truncates silently when it does. Raising `num_ctx` (e.g. to 8,192, roughly +0.4 GB of KV cache) or compacting older tool results would remove this risk. Both change the measured model setup, so neither was done here.
- No long live run of a self-improvement objective using both advisors and an experiment has been observed yet.
