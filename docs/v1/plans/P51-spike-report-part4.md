# P51 — Spike report, part 4: a real macOS arm64 machine, a signed app, and the Kafka addon

> Continues parts 1–3. §5 Q4 asked whether a macOS arm64 machine was available for the spike —
> parts 1–3 ran entirely from a Linux sandbox and could not touch §3.4, §3.5 or §3.7 for exactly
> that reason. **This installment answers Q4: yes.** This report was produced from a real Apple
> Silicon Mac (arm64, macOS 26.5.2). Scoped down by the repo owner before starting: this round
> covers §3.4 (packaging/signing) and the §2.2 Kafka-addon question, using a real
> `@confluentinc/kafka-javascript` engine subprocess as the concrete case. **§3.5 (Keychain
> library) and §3.7 (RAM measurement) were explicitly deferred, by instruction, and remain open.**

## What was built, for real, on real hardware

- **Go 1.27.0** and the **`wails3` v3.0.0-beta.15 CLI**, both installed via `brew install go` and
  `go install .../wails3@latest`. `wails3 doctor` reports a clean environment. Confirms parts 1–3's
  finding generalizes: `wails.io`/`v3.wails.io` are **still 403-blocked from this machine too**
  (reconfirmed — this is this environment's organizational proxy policy, not a sandbox artifact),
  but `proxy.golang.org` and `nodejs.org` are both reachable, which is all installing the toolchain
  and vendoring a real Node runtime actually needs.
- A real `wails3 init -t vanilla` **macOS** project (`p51spike`, `CFBundleIdentifier
  com.kirathecat.p51spike`), built end to end with `wails3 generate bindings` → `npm run build` →
  `task darwin:package`. This re-confirms §3.2's binding-model finding mechanically again, on the
  real target OS this time: **2 services, 3 methods** generated (`GreetService.Greet`, plus the two
  added below), one Go method → one generated TS export, service structs — not a generic dispatch
  method.
- **A real vendored Node runtime**, not the system `node` — downloaded directly:
  `https://nodejs.org/dist/v24.20.0/node-v24.20.0-darwin-arm64.tar.gz`, extracted, used as-is. This
  is exactly §1.2's "the ordinary kind anyone downloads from nodejs.org," not a system binary
  standing in for one.
- **`@confluentinc/kafka-javascript@1.10.0`** installed against that vendored Node with plain
  `npm install` (after approving npm's newer default-deny install-script gate — see "New
  environment gotcha" below) — no Electron, no `electron-rebuild`, no ABI-matching step of any
  kind.
- **The Go↔Node transport**: `enginehost.go` in the real `p51spike` Go module, reusing — not
  reinventing — the exact length-prefixed framing and `PortRequest`/`PortResponse` shapes prototyped
  standalone in `docs/v1/plans/p51-spike-artifacts/gonode/main.go` (part 1). Spawns the vendored
  `node` binary via `os/exec`, `StdinPipe`/`StdoutPipe`, no `MessagePort`, no sidecar mechanism —
  exactly as §3.1/§3.3 said it would have to be hand-rolled. Wired into a real `EngineService`
  Wails service (`engineservice.go`) with two bound methods: `Ping()` and `KafkaCheck()`.
- **`engine/index.js`** — the real engine-side entry point, `require()`-ing
  `@confluentinc/kafka-javascript` at startup and answering `kafka-check` over the same framed
  stdio channel, reporting which of the module's exports (`AdminClient`, `KafkaJS.Kafka`, …) loaded.
  No broker connection attempted or needed — the question this round is whether the **native addon
  loads under a vendored Node with no Electron in the loop**, not whether Kafka itself works.

## The core finding: the Kafka addon is a downloaded prebuild, not a local compile

This is the concrete answer to §2.2's claim, checked directly rather than inferred:

- `npm install`'s own warning named the exact mechanism before anything ran: `@confluentinc/
  kafka-javascript@1.10.0 (install: node-pre-gyp install --fallback-to-build)` — `node-pre-gyp`
  tries a **prebuilt binary download first** and only compiles from source as a fallback.
- The resulting `confluent-kafka-javascript.node` (9.5 MB, Mach-O bundle arm64) carries a
  **preserved mtime from before this session** (`Jul 1 16:20`, not the build timestamp `npm rebuild`
  ran at) — the signature of a downloaded, extracted tarball, not a fresh local `node-gyp` compile.
- `otool -L` on it shows exactly two linked libraries: `/usr/lib/libc++.1.dylib` and
  `/usr/lib/libSystem.B.dylib`. No vendored librdkafka `.dylib`, no Electron-specific anything.
- **It loads and runs cleanly** — proven twice, not just asserted: first headlessly (`go test`
  spawning `EngineHost`, `ping` then `kafka-check` both round-tripped correctly, `hasAdminClient:
  true`, `hasKafkaJS: true`, `hasKafkaJSKafkaCtor: true`), then again through the **real, signed,
  packaged `.app`'s actual native window** — the repo owner clicked "Check Kafka engine" in the
  running app and confirmed the same JSON came back (`hasAdminClient:true…`).

This directly confirms §2.2's prediction: **the Electron-ABI-matching complexity
(`native-electron-build.sh`, reading `node_modules/electron/abi_version`, `electron-rebuild`) is
gone under a stock vendored Node.** What's left is the boring, well-supported case — a standard
Node ABI Confluent already publishes prebuilds for — and it required zero special handling beyond
an ordinary `npm install`.

## §3.4 — packaging and signing, done for real

- **`task darwin:package` already produces a real, ad-hoc-signed `.app` on its own** — this refines
  §3.4's original wording slightly. The claim that "Wails has no built-in automation for signing a
  second embedded binary" is confirmed as written, but it undersold what Wails **does** automate:
  its own `darwin:codesign:adhoc` task runs `codesign --force --deep --sign -` on the whole bundle
  after assembling it, without being asked. The gap is specifically the **second, nested**
  executable this design adds (the vendored `node` binary) plus anything else dropped into
  `Resources` after that point — those are outside what `--deep` catches correctly once files are
  added post-signing, and needed two explicit extra commands.
- **The two extra commands, concretely**: after copying the vendored `node` binary and the Kafka
  `.node` addon into `Contents/Resources/engine/`, both needed their own
  `codesign --force --sign -`, and then the whole bundle needed re-signing
  (`codesign --force --deep --sign -` again) to reseal its resource manifest around the new files.
  Four lines of shell, not a framework feature — matching §3.4's prediction exactly.
- **Verification passes cleanly**: `codesign --verify --deep --strict "$APPDIR"` →
  `valid on disk` / `satisfies its Designated Requirement`. `codesign -dv` on the main executable
  shows `Identifier=com.kirathecat.p51spike`, confirming §3.4's A5 expectation
  (`CFBundleIdentifier` survives as-is) against a real signed artifact, not just the `Info.plist`
  source.
- **No self-extraction, no runtime `dlopen` of a staged temp file, anywhere.** The vendored `node`
  binary and the Kafka `.node` addon sit in `Contents/Resources/engine/` as ordinary files from
  build time, exactly as §1.3/§3.4 said this design should produce — confirmed by inspecting the
  finished bundle, not assumed from the plan.

### App size, measured (not the RAM number — that's still §3.7, still deferred)

| Component | Size |
|---|---|
| Go binary (`Contents/MacOS/p51spike`) | 9.2 MB |
| Vendored Node runtime, as downloaded (`engine/node-runtime/`) | 198 MB |
| Kafka native addon + rest of `node_modules` (`engine/node_modules/`) | 40 MB |
| **Total `.app` on disk** | **251 MB** |

Against Electron's own recorded baseline (`docs/PERF.md` L-D, 252 MB for today's `--dir` arm64
build) — **essentially the same size**, in this unoptimized configuration. One concrete,
easy-to-take optimization surfaced by actually measuring it: the raw `nodejs.org` tarball's
`include/` (64 MB of C headers, needed only for compiling native addons *against* this Node, never
at runtime) and `lib/node_modules/npm` (17 MB, npm's own CLI, not needed to run a fixed
`engine/index.js`) together account for 81 MB of the 198 MB vendored-runtime figure. A real ship
script that keeps only `bin/node` would land close to **170 MB total**, under Electron's number —
worth doing, though per §1.3 install size is still explicitly not a constraint driving the decision
either way.

## What this round did not touch, by instruction

- **§3.5 (Keychain library choice)** — not attempted this round. `zalando/go-keyring` vs.
  `99designs/keyring` vs. calling Security.framework via cgo remains fully open.
- **§3.7 (real RAM measurement)** — not attempted this round. No OS-level memory instrument was run
  against this build; the app-size table above is disk size, not RSS, and should not be mistaken
  for one.
- Both were explicitly deferred by the repo owner before this session's work started, not
  skipped by omission.

## New environment gotcha, worth recording once

`npm install` on a package with an install script now **default-denies it** on this npm version
(`npm warn install-scripts … not yet covered by allowScripts`) — `@confluentinc/kafka-javascript`'s
`node-pre-gyp install --fallback-to-build` postinstall silently did not run on the first `npm
install` until `npm install-scripts approve @confluentinc/kafka-javascript` was run explicitly.
Worth knowing before assuming a bare `npm install` is sufficient to provision this dependency on a
machine with a newer npm.

## Net effect on §5

**Q4 is resolved: a macOS arm64 machine is available (this one).** §3.4 is now answered with a real
build rather than inference. §3.5 and §3.7 remain the two genuinely open items — both need this same
machine, both were deliberately left for a future round.

Reproducible end to end from documented commands: `brew install go`, `go install
github.com/wailsapp/wails/v3/cmd/wails3@latest`, `wails3 init -t vanilla`, download the
`nodejs.org` tarball above, `npm install` (with the approval step above) in a directory with
`@confluentinc/kafka-javascript` as its only dependency, then `task darwin:package` plus the four
`codesign` lines. The generated build artifacts (the vendored Node tarball, the built `.app`, both
`node_modules` trees) are not committed — only the hand-written source
(`enginehost.go`, `engineservice.go`, `engine/index.js`, the Wails scaffold) remains under
`docs/v1/plans/p51-spike-artifacts/gonode-macos/`, mirroring part 1's `gonode/` pattern.
