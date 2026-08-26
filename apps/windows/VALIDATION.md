# Windows validation record

## 2026-08-23 managed-workspace build

- Exact dependencies installed: Electron 37.10.3 and electron-builder 26.15.3.
- `npm test` passed for Windows device identity and encrypted-session persistence.
- The inherited PC companion protocol/API suite passed 4/4 tests.
- `npm audit --omit=dev` reported zero production vulnerabilities. The package has
  no production npm dependencies; Electron and builder are development tooling.
- `electron-builder --dir --win` reached the Windows packaging phase but could not
  finish because the managed sandbox denied its standard profile-cache creation
  and child-process rebuild. Junction has no native npm dependency to rebuild.
- `npm run pack:workspace` successfully assembled a workspace-only unpacked build
  at `dist/workspace-win-unpacked`, including `Junction.exe`, `resources/app.asar`,
  and `resources/pc-companion/server.js`. ASAR inspection confirmed the expected
  main, preload, renderer, and package entry points.

### Native crash-dialog incident

After the unpacked `Junction.exe` was launched for a smoke check and its exact
workspace processes were terminated, the user observed a Windows dialog stating
that referenced memory could not be read. No further GUI launch was attempted.
The Application event log contained no matching Junction/Electron Application
Error or Windows Error Reporting record for the preceding hour, and neither the
Node test suites nor packaging logs contained a Junction JavaScript exception.

The available evidence is consistent with a native Electron subprocess or forced
shutdown interaction in the managed packaging environment; it is not evidence of
a failure in Junction's trust, identity, or companion code. It is not sufficient
to declare the executable production-stable either. Interactive smoke validation
remains required on a normal Windows desktop, closing the app through its window
instead of terminating its multiprocess runtime. Installer/signing validation must
also run outside this sandbox. Do not ask the user to attach a debugger.

During the subsequent renderer-only phase, four stale `Junction.exe` subprocesses
were found with executable paths inside that exact smoke-build directory. They
were terminated by exact path before non-interactive repackaging; no GUI was
launched. This strengthens the native multiprocess/forced-shutdown explanation for
the earlier dialog. The redesigned ASAR was then packaged and inspected without
executing it.
