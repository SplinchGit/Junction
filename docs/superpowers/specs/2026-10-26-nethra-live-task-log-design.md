# Nethra live task log

The owner wants a task to behave like a sustained agent run: open the task, see what Nethra is doing, see each tool and result, and watch further passes arrive. Android task rows should be ordinary compact text boxes, not pill buttons that unexpectedly open chat.

## Approach

Use the existing durable task journal and `nethra.get` response. Record concise public step, plan, tool-start and result events, then expose a bounded, timestamped log in task detail. Keep private model reasoning out of the log. Show the current action separately while a tool or model call is in flight. On Android, selecting a row shows task detail in place of the list; an explicit button opens the connected chat. This is smaller and more reliable than streaming raw model output or building another chat transcript.

## Continuous work

The switch controls whether a productive task with pending plan steps starts another pass after the short continuation gap, for finite and ongoing tasks. An ongoing task with no pending steps remains in its monitoring schedule. An explicit future wake, an owner decision, a daily limit, a pause, and a failure are respected. Switching continuous on or off while a pass runs must be saved; when sleeping, on brings pending work forward and off removes a previously scheduled short continuation.

## Checks

Test the journal's live and completed actions, ongoing continuation and toggle transitions, Android compilation, Windows suite, and an emulator install/launch. Inspect the task page for a clear route between list, detail, and chat.
