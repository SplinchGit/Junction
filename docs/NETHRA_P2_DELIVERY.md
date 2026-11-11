# Nethra shared continuation: implemented slice

This is a scoped P2 improvement, not completion of voice integration. Android local voice already sends recognized speech through `ChatManager.onLocalUtterance` and the ordinary message route with SPOKEN input mode and existing approval handling. This change strengthens the shared Windows owner-instruction route used by that path. It adds no voice agent, inference runtime, scheduler or memory store.

## Behavior and existing components

- A brief follow-up retains the conversation's linked completed task rather than selecting an unrelated active objective. Explicit task names take precedence; multiple possible linked tasks request clarification.
- Task reference resolution consumes the existing bounded API pages, so an older linked task remains reachable beyond the first 100 records.
- “Continue researching that” reopens the existing completed objective through `nethra.edit`, preserving its saved context, evidence, model and permissions. Active work stays in the existing scheduler.
- Continuation binds the original target, status and revision in the existing SQLite request table. A repeated turn cannot reopen work that subsequently finished, undo a later pause, or wake a different sleep episode. A direction write interrupted before persistence retains its original revision fence; later owner changes cause an explicit revision conflict.
- Generic continuation never answers an outstanding decision or grants approval. The existing `nethra.message` interface accepts optional `noteOnly: true` for control-associated instructions and optional `revision` for atomic stale-write rejection. Ordinary answers retain their existing behavior. Both optional fields participate in idempotency binding when supplied; legacy calls retain their prior binding shape.

No schema migration, new production module or parallel state authority was required. Internal continuation receipts use the existing durable request table and deletion replay fencing.

## Exact changed files in this slice

- `apps/windows/src/nethra-objectives.js`: conversation-linked reference priority.
- `apps/windows/src/nethra-conversation.js`: focus selection and shared continuation recognition.
- `apps/windows/src/nethra-chat.js`: paginated resolution, named target preference, continuation binding, gate preservation and revision-fenced control direction.
- `apps/windows/src/nethra-store.js`: existing request-table continuation binding and optional note-only/revision checks on chat turns.
- `apps/windows/src/nethra-api.js`: forward optional message semantics to the existing store.
- `apps/windows/test/nethra-objectives.test.js` and `nethra-conversation.test.js`: focus, pagination, continuation, ambiguity, input gates and retry/interruption regressions.
- `apps/windows/test/nethra-continuity.test.js` (new): native host integration cycle.
- `docs/ARCHITECTURE.md`, this report and the implementation ledger.

## Integration evidence and limits

The host integration test sends recognized owner text into `handleOwnerWorkInstruction`, resumes one saved objective, executes the real `NethraScheduler` and `NethraRunner` with scripted model tool responses, reads a workspace file with SHA-256 evidence, finishes the objective, posts the normal conversation report, enqueues one notification, pulls it through the Android API and opens the original conversation. Repeated owner turns and reports do not create another task or alert. The test uses real SQLite and native tool execution; model inference and signing are test doubles. It does not exercise microphone, speech recognition, TTS, OS background service, LAN/relay transport or a physical notification tap.

47 focused Windows tests pass (`artifacts/nethra-p2-continuation-focused.log`). Decision-race, late-pause retry and interrupted-direction regressions were reproduced failing before correction. Final full Windows `npm test` exited 0: 578 TAP tests (27 + 3 + 4 + 40 + 504), zero failures, plus preceding non-TAP commands (`artifacts/nethra-p2-windows.log`). `npm run pack` exited 0 (`artifacts/nethra-p2-package.log`). The rebuilt packaged-runtime smoke exited 0 and verified SQLite, deletion/restart fencing, notification retry deduplication, milestone grouping and owner actions (`artifacts/nethra-p2-package-smoke.log`). Read-only review found no further important issue after the interrupted-request fix. `git diff --check` passed (line-ending warnings only).

Android source did not change in this P2 slice. The preceding P1 build has 227 passing unit tests and successful app/instrumentation APK builds, version 101207/build 207. No emulator or physical-device execution is claimed.

## Remaining work

P2 still needs a bounded call-start project/task briefing, saved-project ambiguity handling across calls, realtime-backend parity verification and interrupted-call/audio-lifecycle acceptance. P3 opt-in voice invitations, P4 broader project/document context and P5 cross-objective awareness remain outside this slice. P1 reply/voice actions, cross-task coalescing and low-latency background wake integration remain; remind/dismiss are implemented. A complete microphone → background work → physical notification → conversation cycle is not yet demonstrated.

Optional manual verification: open a saved task conversation, start local voice, say “Continue researching that”, end the call and observe the same task continue on Windows. Confirm a single outcome notification opens that task and its original conversation. Repeat with a pending decision, a later owner pause, loss of connectivity and duplicated request delivery. Real-device verification is not a prerequisite for further implementation.


## Shared briefing correction (11 November)

The existing per-turn context path supplies local voice and desktop/Android chat. Auditing it found two concrete defects: it chose the first unfinished task when several shared a conversation, and truncating the finished briefing at 2,400 characters could remove approval counts, scheduler state and honesty guidance after verbose optional tool descriptions.

`apps/windows/src/assistant-environment.js` now resolves only a unique conversation-linked objective, preferring unfinished linked work and preserving a completed linked objective when appropriate. Multiple candidates produce bounded names and an explicit clarification instruction. The briefing prioritizes call state, linked task progress/model/owner decision, approval counts, scheduler state and unchanged permission boundaries. Optional capability details fit only as whole facts; no sentence is cut halfway. The character budget remains 2,400. `apps/windows/src/main.js` supplies that focus and selected task model through the existing LAN, relay and desktop situation builder. No new context store, API, inference call or Android component was added.

`apps/windows/test/nethra-briefing.test.js` covers busy-call budget retention, ambiguous associations, completed/unlinked conversations and actual runtime prompt construction for both supported model profiles with stubbed inference. The first three regression tests were observed failing before correction; 18 briefing/awareness tests now pass. This is refreshed context on each local-voice turn, not a new unsolicited call-start greeting. Realtime backend context parity and saved project retrieval across conversations remain pending. Existing memory/history/project snapshot assembly remains in place.


The same briefing now retrieves a saved Foreman project when the owner names it in the current message, including from a different conversation. Matching uses whole words and requires a unique saved name. If multiple saved projects match, the prompt requests clarification and withholds project details. Existing conversation associations supply the fallback. This lookup is read-only and does not relink conversations or tasks. Short aliases and durable project associations for follow-up turns remain to be implemented.
`npm test` passed 583 Windows TAP tests. `npm run pack` and the rebuilt packaged smoke passed, including deletion fencing after restart and notification deduplication. Logs are in `artifacts/nethra-p2-project-windows.log`, `artifacts/nethra-p2-project-package.log` and `artifacts/nethra-p2-project-smoke.log`.

An immediate confirmation such as “Yes, draft the funding section” now carries forward an explicitly named project from the preceding owner turn when an assistant reply follows that turn. The desktop, LAN and relay paths pass their existing conversation history into the same lookup. Explicit names in the current turn take priority. The lookup does not scan older turns, change task ownership, or grant permissions. Regression coverage checks confirmation, unrelated requests, assistant-only mentions and an intervening topic change.

New objectives created through the shared native start_objective tool now store an optional projectId when the host briefing resolves one existing Foreman project. The runtime passes that identifier through internal tool context and the API adapter. Public create payloads and model tool arguments cannot set it. The existing SQLite task record and request binding persist the association without a schema migration. Same-goal deduplication in a conversation includes the project association. This slice does not reassign existing objectives or surface project navigation.

The briefing now resolves saved project IDs from tasks in the current conversation, including completed tasks. Desktop, LAN and relay share this lookup. An explicit project name takes precedence. Multiple linked projects produce a clarification prompt, and a missing project contributes no context. The lookup reads the existing task and Foreman records without editing either.

## Paired calls and invitations

When the paired PC provider is selected, a call uses the existing Android local voice lane and the shared PC task route, even if Realtime Voice is the saved backend preference. The preference still applies to calls with other providers. The hosted realtime connection does not receive paired chat history. Paired calls use the Android speech engine and skip the optional Azure voice. Platform speech recognition availability still depends on the phone. A queued utterance is checked against the active call before dispatch.

The shared notification policy now supports opt-in voice invitations for a single persisted blocking owner decision. Answer opens the task’s verified conversation and shows a separate foreground Start Nethra call control. Later and Decline use existing durable notification choices. The app requests microphone permission only after the foreground call action. It checks the target conversation again when the permission prompt returns. Paired-device call and notification acceptance remain to be exercised.

## Nethra research agents

Research agents are off by default. Enable them in Android Tasks under Research agents or in Windows Settings under Model readiness and updates. An authorized task may delegate a bounded research step to a child using the same selected local model. The child can search public sources and read files within the parent’s existing scope. It cannot write, delegate again, approve an action, or finish the parent objective. The parent reviews the result.

The parent task shows recent agents, their scope, status and report. Stop agent fences that child while preserving the parent task. Turning research agents off stops active children and prevents new delegation. Start with a typed objective describing the research and expected result. A paired voice call uses the same instruction path and permissions.

Android Answer now passes the signed delivery identity to the existing `nethra.openChat` route. The host validates the delivery state, device, task, question, expiry and current policy before recording the owner acknowledgement. Retries return the same acceptance without answering the task question. A declined, expired or wrong-device invitation cannot open a call. The app clears the accepted alert and still requires a separate foreground Start call action.

## Full task agents

Open a top-level task and choose Task agents → Launch task agent. The assignment creates a regular persistent task with its own chat, workspace, scheduler state, checkpoints, approvals and stop controls. Its parent and project links are durable. The agent starts with the parent's model. File roots, document grants, watched sources and coding authorization remain scoped to each task. A private parent also keeps its agent on the private tool policy. Existing short read-only research delegation remains separately controlled.

This slice supports explicit owner launch and individual task control. Model-proposed full agents, owner approval for that delegation and a bulk stop for full agents remain open. Full agents are independent tasks, so stopping or deleting the parent does not stop them automatically.
