# VS Code Modern UI redesign mockup

Workbench redesign mockup for Kira Studio, restyled to match VS Code's
`workbench.experimental.modernUI` ("Modern UI preview") feature (v1.129):
24px rounded-pill tabs, a 4/6/8px corner-radius tier system, rounded
status-bar and list-row items, and flat/no-shadow chrome — grounded in the
actual Modern UI CSS modules shipped in `microsoft/vscode`, not approximated.

Published artifact (live, interactive canvas):
https://claude.ai/code/artifact/dea3e184-0589-4eb7-b9db-a24809725de6

## Files

- `Main.dc.html` — workbench, connection with a color assigned (red accent).
- `MainNoColor.dc.html` — workbench, connection with no color assigned
  (plain default chrome, no accent).
- `ConnectionDialog.dc.html` — "New Connection" modal.
- `SettingsDialog.dc.html` — Settings modal.
- `canvas.json` — layout manifest for the design canvas editor.

These are source artboards for the Claude design-canvas workflow, not
production Vue components — they're a visual reference for implementing the
real redesign in `src/renderer/`.
