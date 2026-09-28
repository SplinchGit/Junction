# Windows launch contract

- A packaged Electron app is a directory runtime, not a standalone `Junction.exe`.
  `Junction.exe` must stay beside `resources/app.asar` and `resources/pc-companion`.
- A desktop launch must target the packaged runtime's `Junction.exe` and use that
  runtime directory as its working directory. Use `npm run desktop` after building
  with `npm run pack:workspace`, or use the NSIS installer from `npm run dist`.
- Never copy only `Junction.exe` to the Desktop. That creates a broken launch target.
- Normal launches must remain foreground launches. Only the explicit `--background`
  login-item path may hide the window.
- Startup failures must be recorded under the Electron user-data `logs/startup.log`
  and show a recovery window; do not turn startup errors into a silent quit.
- After changing packaging or startup code, run `npm test`, rebuild the package, run
  `npm run desktop`, and launch through the generated `Junction.lnk`.