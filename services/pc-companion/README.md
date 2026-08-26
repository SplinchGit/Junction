# Junction PC companion foundation

This service is the first Windows-side Junction vertical slice. It is deliberately
small: an authenticated loopback API can discover its typed capabilities and read
a bounded snapshot of the foreground application's Windows UI Automation tree.
It cannot click, type, launch programs, run arbitrary commands, or access files.

The boundary mirrors Junction's Android safety architecture:

1. Every request becomes a typed proposal with explicit trigger provenance.
2. Only `OWNER` may initiate execution; unknown capabilities fail closed.
3. The sole capability is declared `read_only`, low-risk, and automatically allowed.
4. Window titles and element metadata are returned as `UNTRUSTED`; downstream model
   context must preserve that label.
5. Proposal and outcome events append to a local JSONL audit log. Observed UI text
   is intentionally excluded from the audit file.

## Requirements and start

- Windows 10 or 11
- Node.js 18 or newer
- Windows PowerShell 5.1 with UI Automation assemblies (included with Windows)

From this directory:

```powershell
npm test
$env:JUNCTION_PC_TOKEN = '<a-long-random-secret>'
npm start
```

If no token is supplied, a fresh token is printed at startup. The server always
binds to `127.0.0.1:43110`; it is never exposed to the LAN. Override the port with
`JUNCTION_PC_PORT`. The audit log defaults to
`%USERPROFILE%\.junction\pc-companion-audit.jsonl` and can be moved with
`JUNCTION_PC_AUDIT_PATH`.

## Try the vertical slice

Use the bearer token from startup for all calls. First create a proposal:

```powershell
$headers = @{ Authorization = "Bearer $env:JUNCTION_PC_TOKEN" }
$body = @{ capability = 'inspect_windows_context'; triggerProvenance = 'OWNER' } | ConvertTo-Json
$proposal = Invoke-RestMethod http://127.0.0.1:43110/v1/proposals -Method Post -Headers $headers -ContentType application/json -Body $body
Invoke-RestMethod "http://127.0.0.1:43110/v1/proposals/$($proposal.proposal.id)/execute" -Method Post -Headers $headers
```

`GET /v1/capabilities` describes the allowlist. `GET /v1/providers/ollama` safely
checks the local Ollama tags endpoint with a one-second timeout. Ollama is optional:
the service starts and inspection works when it is absent. No model is selected or
downloaded automatically; a later assistant adapter should let the owner choose an
installed small model and must keep model output separate from trusted proposals.

## Limitations and next seam

UI Automation coverage depends on the foreground app; games, elevated windows,
custom-rendered controls, and some Chromium surfaces may expose little metadata.
Snapshots are capped at 100 labelled elements, 500 characters per field, 1 MiB of
process output, and five seconds. Bounds are descriptive metadata only and are not
used for coordinate control.

The next safe increment is an Android/client adapter that consumes this API as a
platform capability and passes the `UNTRUSTED` result through Junction's existing
reader path. Any future state-changing Windows capability should be individually
allowlisted, require an OWNER-triggered proposal plus explicit confirmation, use a
stable UI Automation selector (not screen coordinates), verify a postcondition,
and write its decision and outcome to this same audit protocol.
