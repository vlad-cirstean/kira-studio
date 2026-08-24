# Working agreement

**Opus plans, Sonnet implements.**

- The **main session runs on Sonnet**. It implements directly — it does not delegate
  implementation to subagents.
- Each phase (see `docs/v1/SPEC.md` §10 phasing table) gets an Opus-authored plan
  committed under `docs/v1/plans/` before any implementation starts. Produce this by spawning an
  **Opus subagent** (`Agent` tool, `model: "opus"`) whose job is only to write that plan; the
  main Sonnet session then implements it.
- If a phase's plan is missing from `docs/v1/plans/`, do not implement from the spec directly —
  get the Opus plan written and committed first.
- Do not spawn implementation subagents (Sonnet or otherwise) for the core sequential work.
  Phases build on each other, so the main session needs continuity of what was decided and why;
  a fresh subagent starts cold and has to re-derive that context, which is the expensive path.
  Subagents are fine for genuinely independent, parallelizable, or throwaway research (e.g.
  "how does the `pg` driver handle cancellation?") — not for writing the phase's code.
- **The loop per phase:** check for a plan → spawn an Opus subagent to write one if missing →
  Sonnet implements the whole phase → **stop**. Do not roll on into the next phase automatically;
  each phase boundary is a checkpoint.
- No per-phase PRs. One feature branch for all of v1.
- **Best practices throughout, no shortcuts** — no stubbed error handling, no `TODO: fix later`,
  no skipped validation to make something demo. Scope left out of a phase is left out entirely,
  not half-implemented.
- **Comments: very concise, and only where truly necessary.** Add one only when the code cannot
  say it for itself — a non-obvious *why*, a constraint, a workaround. Never restate what the code
  already shows.
- **Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)** —
  `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`, etc., with a `!` or `BREAKING CHANGE:`
  footer for breaking changes.

## Docker (for `tests/db/` testcontainers)

- **Claude Code on the web's Linux containers**: the `docker` CLI is preinstalled but the daemon
  isn't running — there's no systemd (`PID 1` isn't systemd), so `systemctl start docker` doesn't
  work. Start it directly instead, as root: `nohup dockerd > /tmp/dockerd.log 2>&1 & disown`, then
  give it a few seconds and check `docker info` / `/tmp/dockerd.log` for `"API listen on
  /var/run/docker.sock"`. This has to be done once per fresh container/session — it doesn't
  persist.
- **The other dev environment (macOS) uses Colima** instead — `colima start` brings up the Docker
  daemon there; don't try the `dockerd`-directly approach on that box, and don't assume systemd
  either way.
- **On Claude Code's Linux web containers specifically**, the outbound network policy blocks
  `production.cloudfront.docker.com` (403, gateway policy denial) — the CDN host Docker Hub
  redirects every blob download to. `docker pull` therefore resolves manifests fine but can never
  actually fetch an image's layers, so `tests/db/`'s testcontainers-backed suites cannot run there
  at all (they hang/fail waiting on a container that never starts). This is an environment network
  policy limit, not a Docker config problem — don't spend time working around it.

## Electron binary (for `tests/ui/`)

- **Claude Code's Linux web containers**: `bun install` does not fetch the Electron binary —
  `node_modules/electron/install.js` downloads it via `@electron/get`, which fails in this
  environment with `AssertionError: assert(!this.paused)` deep inside undici's HTTP/1 parser (a
  proxy/streaming quirk with that specific downloader, not a blocked host — plain `curl -L` against
  the same `github.com/electron/electron/releases/download/vX.Y.Z/electron-vX.Y.Z-linux-x64.zip`
  URL succeeds). Fix by downloading with `curl` and installing manually:
  ```
  curl -sSL -o /tmp/electron.zip https://github.com/electron/electron/releases/download/v<version>/electron-v<version>-linux-x64.zip
  mkdir -p node_modules/electron/dist && cd node_modules/electron/dist && unzip -q /tmp/electron.zip && cd -
  chmod +x node_modules/electron/dist/electron node_modules/electron/dist/chrome-sandbox node_modules/electron/dist/chrome_crashpad_handler
  printf 'electron' > node_modules/electron/path.txt   # no trailing newline — install.js compares it verbatim
  ```
  `<version>` is `node_modules/electron/package.json`'s own `"version"` field. Verify with
  `node -e "console.log(require('electron'))"` — it should print the binary path with no
  "Downloading Electron binary..." message. This unlocks real `xvfb-run -a bunx playwright test`
  runs for every spec that doesn't need a `tests/db/`-style container (confirmed:
  `smoke.spec.ts`, `startup.spec.ts`, `workbench.spec.ts`, `connections.spec.ts`,
  `secrets.spec.ts` all pass) — most other specs still `test.skip()` cleanly via
  `isDockerAvailable()` rather than fail, per the Docker note above.

## Secrets / `KIRA_INSECURE_SECRETS` (for password-bearing `tests/ui/` specs, P25)

- Credentials are encrypted via Electron's `safeStorage`, which is Keychain-backed on macOS and
  has **no real backing store on Linux** — a bare Linux dev/CI container has no `gnome-keyring` or
  `kwallet` daemon (no systemd, see the Docker note above), so `safeStorage.isEncryptionAvailable()`
  is `false` there by default.
- **On Claude Code's Linux web containers and any other Linux dev machine**: set
  `KIRA_INSECURE_SECRETS=1` before launching the app (`bun run dev` or the Playwright harness) to
  opt into a Linux-only development fallback (Chromium's `basic_text` obfuscation — a hardcoded
  key, not real encryption). `tests/ui/fixtures.ts` already sets this for every test by default,
  so the normal `xvfb-run -a bun run test:ui` loop needs no extra step; it only matters for a
  manual `bun run dev` session or a one-off `electron out/main/index.js` launch outside the test
  harness.
- **On macOS**, this variable is ignored outright — `safeStorage` uses the real Keychain and
  `KIRA_INSECURE_SECRETS` can never weaken it, even if accidentally left set in an environment.
  `tests/ui/secrets.spec.ts`'s scenario 1 is the guard that this stays true: it fails loudly
  (never skips) if `available`/`backend` on `darwin` don't read `true`/`'keychain'`.
- Without the variable, Linux resolves to secret storage being **unavailable** — a password-bearing
  save fails visibly (the dialog's `connection-save-error`) rather than silently falling back to
  plaintext. This is deliberate (see `docs/v1/plans/P25-credential-keychain-encryption.md` D13),
  not a bug to work around.

Full spec: `docs/v1/SPEC.md`.
