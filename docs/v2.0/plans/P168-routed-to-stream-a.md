# P168 routed to Stream A

Findings from other parts that need a Stream A-owned file. Part 8 fixer picks them up.

## From Part 14 F4 (low): `localsock.Serve` calls `wg.Add` concurrently with `Close`'s `wg.Wait`

`internal/localsock/localsock.go:87-91,102-104`. `Serve` does `Accept` then `wg.Add(1)`. `Close`
closes the listener then `wg.Wait()`. A connection accepted just before `Close` can reach
`wg.Add(1)` after `Wait` saw a zero counter. `sync.WaitGroup` requires a positive `Add` at zero to
happen before `Wait`.

Scenario: app shutdown (`main.go:227` `askpassBroker.Close()`) while a helper connects. `Wait`
returns, `os.RemoveAll(Dir)` deletes the socket and shim, `handleConn` keeps running past
`Close`'s "waits for every in-flight one" contract (up to `b.timeout+5s` on an unanswered prompt).
Same shape in `agenthooks`. Low impact: handler only answers a prompt.

Fix: guard `Add` and the closed flag with one mutex. `Serve` takes the lock, checks `closed`,
`Add`s, unlocks; `Close` sets `closed` under the lock before `Wait`. A conn accepted after `closed`
is closed without a handler. Add a `-race` test: connect in a loop while calling `Close`.
