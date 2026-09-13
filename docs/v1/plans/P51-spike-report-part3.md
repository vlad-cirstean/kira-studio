# P51 — Spike report, part 3: a live dev server, and why curl couldn't reach it

> Continues parts 1–2. This part actually got `wails3 task dev` running and reachable — the thing
> two earlier attempts in part 2 failed at — and explains both the earlier failure and a genuine,
> newly-confirmed limitation on the *live* server, rather than a sandbox artifact.

## The earlier failure was self-inflicted, not a sandbox limit

Part 2 concluded that two attempts to background `wails3 task dev` failed for sandbox-specific
reasons. Re-run properly, the real cause was simpler: **the first build takes about 60 seconds**
(`go build` compiling the native GTK/WebKitGTK binary, Vite cold start, icon/binding generation), and
both earlier attempts gave up after 15–25 seconds. Started in one shell invocation, polled for
readiness in a loop instead of a fixed sleep, and given a long enough tool timeout, it comes up
cleanly:

```
xvfb-run -a wails3 task dev   # builds, then: "Connected to frontend dev server!"
```

`GET http://127.0.0.1:<port>/` returned the real app shell (HTTP 200, the actual generated
`index.html`), and `ps aux` showed the real native binary (`bin/p51spike`) running alongside Vite,
both alive. **This sandbox can run a Wails dev server and keep it alive within one command's
lifetime** — the earlier "background process lifecycle" theory doesn't hold once given enough time
inside one invocation. What genuinely does not survive across separate tool calls is *this shell's
ability to signal processes started by an earlier call* — `ps aux` in a later call still lists them,
but `pkill`/`kill` from a fresh call cannot reap them (confirmed: several `Xvfb`/`wails3 dev` zombies
from this investigation are still running, harmlessly, in `/tmp` scratch space, un-killable from a
later call). That's a real constraint worth knowing for future spike work in this sandbox, but it
never blocked the actual finding — it only cost cleanup hygiene, not the measurement, since every
substantive test in this report ran start-to-finish inside a single invocation.

## The new, real finding: `/wails/runtime` is not plain HTTP, even in dev mode

`POST http://127.0.0.1:<port>/wails/runtime` against the **live, confirmed-up** dev server returned
**HTTP 404** — reproducible on two different ports (9245, then a clean 9333 to rule out stale-process
contamination). This is not a mistake in the request; reading
`pkg/application/linux_cgo.go`/`linux_cgo_gtk3.go` explains why:

```go
C.webkit_web_context_register_uri_scheme(webContext, cScheme, ...)   // "wails://"
```

On Linux, the native window loads content through a **custom `wails://` URI scheme registered
directly with WebKitGTK** and intercepted in-process — not a real TCP listener. The `devServerURL`
the log prints (`AssetServer Info: ... devServerURL=http://localhost:9333`) is the Go asset server's
own **upstream** for fetching Vite's live-reloaded JS/CSS during dev, fetched *from inside the Go
process*; it is not itself the address the webview's `/wails/runtime` and `/wails/stream/*` calls
travel over. Those calls only exist behind the `wails://` scheme handler, reachable only from inside
a real, Wails-registered WebKitGTK webview — not from `curl`, and not from an arbitrary browser tab
pointed at the Vite port.

**This sharpens §3.8's already-decided conclusion rather than contradicting it.** The plan already
decided (unconditionally, before this was checked) that the UI test suite moves to Playwright's
isolated `webkit` tier with a hand-built stand-in for the bridge, because Apple ships no WebDriver
for WKWebView. This finding adds a concrete, Linux-side reason the same shape of problem exists one
layer earlier than expected: even the GitHub-discussion-sourced idea of "just point Playwright's
browser at the dev URL and call real bindings" does not work as stated — a plain browser tab is not
a `wails://`-registered webview, so it cannot reach `/wails/runtime` either, regardless of platform.
The decision to fake the bridge for tests was already made for the right reasons; this is one more
piece of concrete evidence for it, not a new decision.

## What this does and doesn't change

- Does not touch §3.4/§3.5/§3.7 — still macOS-only, still unmeasured.
- Firms up §3.8: the "browser-against-dev-URL" idea from the GitHub discussion is now known not to
  reach real bindings, at least on this platform's transport (`wails://` scheme interception). Worth
  re-checking specifically on macOS's WKWebView transport before assuming it generalizes, since the
  scheme-registration code is platform-specific (`linux_cgo.go` vs. whatever the macOS equivalent
  does) — but the Linux evidence does not support relying on it.
- Confirms the toolchain itself (build, hot reload, native launch) works cleanly in this sandbox for
  as long as a single command needs it to, which is all that was really required to validate §3.1.
