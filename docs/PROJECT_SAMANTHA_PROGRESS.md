# Project Samantha progress

## Evidence and remaining work

The implementation started from 66ef4f7. The attached build guide and the owner's expanded Claude collaboration and autonomy requirements govern the work. Provider execution is subscription-only.

| Milestone | Current evidence | Remaining acceptance work |
| --- | --- | --- |
| M0 baseline | Installed host completed audit 3ea1e942-1894-4d1e-af69-6f587f18e1f4 in one claim and 17.93 inference minutes. See PROJECT_SAMANTHA_BASELINE.md. | Ten substantive sessions were not demonstrated. Historical documentation was accepted as live evidence, and a draft was written despite the read-only instruction. |
| M1 survival | Source changes cover abandoned leases, downtime accounting, parent controls, draft reconciliation, and grouped missed wakes. Database tests cover five draft crash points and an approved replacement written before receipt completion. Recovery includes the completed approval in the model's next briefing. The installed package recovered a controlled abandoned lease in 738 ms, retained its checkpoint, and preserved 1 ms of recorded inference usage. | Exercise full PC restart and device scenarios, and audit outage notification bounds beyond the catch-up notice. |
| M2 progress | Evidence-only passes nudge at three and ask at six. Replies resume the saved task. Productive control has zero false stalls. Dependency wake tests pass. | Complete adversarial A15/A25 checks and live continuity verification. Test yield paths and receipt-based progress more thoroughly. The two baseline tool failures are too small a sample to justify a tolerant parser. |
| M3 coordination | Read-only live account query confirmed credits fields hasCredits, unlimited, and balance. Snapshot preservation implemented. Advisor dispatch waits five minutes to recheck unavailable capacity or a reached limit with no reset time. A Codex attempt during which the credit balance falls is blocked and recorded (unit test WP4b); the owner has since confirmed the account is subscription-only with no credits, so no credit display is planned. Owner decision D3 (2026-11-13): Claude is a resumable engineering session. Each task keeps a Claude session per directory, resumed on later handoffs with a fresh-session fallback; Claude still has no tools and writes only through the shared-writer patch path. A live CLI check on the subscription saved a session, resumed it with its earlier context, and returned the expected error for a missing session. A provider hold is shown once: one WAITING activity entry and one phone notification per hold, with later rechecks journaled as WAITING_RECHECK (database tests with mocked providers). Handoff scenarios covered by tests on real Git fixtures with mocked providers: Codex to Claude, a Claude rejection returning to the same task, both unavailable, owner Pause and Stop, restart during a wait, and a changed proposal. | Run the handoff both ways with live providers in the installed app, including a restart mid-handoff, and confirm one writer and one hold alert on the phone. Subscription-only dispatch audit. |
| M4 memory | Pending. | Thirty-question baseline, temporal records, shared recall, Android compatibility, repeat measurements. |
| M5 presence | Pending. | Journal digest, notification outcomes, two weeks of observations, incident grouping and delivery policy. |
| M6 voice | Pending. | One hundred scripted turns, conditional fixes, shared-task checks on phone. |
| M7 character | Pending. | Fixed probes, measured persona changes, usage visibility. |
| M8 longitudinal acceptance | Pending. | Week-long real PC and phone run with ten substantive sessions and all acceptance cases. |

M1 and M2 have not passed their complete exit criteria. The M3 account inspection and additive snapshot preparation do not establish provider-handoff acceptance. Existing M1/M2 gaps remain gates for the overall release.

## Installed build

The running host was replaced with nethra-agent-chat-20261022 after confirming that no objective lease or engineering project was active. The desktop shortcut and recovery scheduled task target that runtime. The app recorded a fresh host start and opened its LAN listeners.

The controlled recovery objective is 579d028f-4307-4eed-a1ed-4de8c5dfaadd. With the host stopped, the normal store API created a nonpersistent objective, claimed it with a 21-minute lease, saved a checkpoint, and recorded an inference heartbeat. Launching the packaged app recovered the unexpired lease in 738 ms, cleared it, preserved the checkpoint and 1 ms usage, and paused the nonpersistent objective. The paused fixture is retained as evidence. This exercises packaged host startup, not an operating-system reboot.

The package was rebuilt from 006c67c with no lease and no active engineering project, launched through the desktop shortcut `Nethra.lnk`, and opened its LAN listeners. The packaged `foreman.js` contains the provider-hold change. The older `Junction.lnk` on the desktop still targets `nethra-qwen3-next-q3km-20261106` and should not be used.

The Android doctor reported no attached device during this verification. Phone acceptance remains pending.

## Baseline findings to address

Enforce read-only task authority in the host, distinguish historical documentation from current verification, and design the final audit around ten separate substantive sessions. Preserve scope changes, Pause and Stop, exact approvals, and one shared writer throughout.
