# Mobile relay and conversation sync verification

Verified 16 September 2026 on the connected Samsung SM-A528B and packaged Windows Junction.

- Sent “Who won the 2026 football World Cup?” inside the phone app using Qwen3.5 4B.
- PC audit recorded a successful `web_search` returning five sources, followed by PC Ollama inference and a completed answer in 142 seconds. Ollama reported CPU execution (`size_vram: 0`). The phone received and persisted the cited answer.
- Matched the phone conversation and messages with the PC store.
- Continued that phone conversation from the desktop; both new messages arrived in the phone database.
- Created a named conversation on the PC and confirmed it appeared on the phone.
- Deleted that test conversation on the phone and confirmed its absence on the PC.
- Deleted a separate test conversation on the PC and confirmed its absence on the phone.

Automated verification:

- Windows suite: streamed UTF-8 decoding; encrypted partial written before final completion; heartbeat and duplicate-claim protection during inference; bidirectional records, rename, deletion, stale resurrection prevention, pagination and long multilingual messages.
- Android unit tests and debug APK build pass, including persisted out-of-order Unicode message chunk assembly.
- Code review findings concerning oversized messages and lost first-upload acknowledgements were fixed and re-reviewed.
- Firestore relay rules compiled and deployed successfully.

Limits: live phone testing used the initial build 119 installation. USB disconnected before installing the final review fixes. Incremental stream delivery is covered by automated tests; a live partial-before-final observation on the phone remains outstanding. Google account sync was not the live transport: this PC was not signed in, so verification used the existing encrypted PC pairing. Sync requires both app processes and connectivity; it retries after reconnecting.
