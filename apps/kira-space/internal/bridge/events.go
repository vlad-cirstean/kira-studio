package bridge

// ChannelCodeSearch is C7 D7's own push channel — a repository-wide search's coalesced file
// groups, delivered with EmitTo (one window only). Kira Studio's own bridge/events.go carries
// this alongside two dozen other app-wide channels this app has no equivalent of (connections,
// oplog, metrics, settings, layout, terminal, ...) — Part 2's own frontend work is what grows
// this file, not a wholesale copy of Kira Studio's own list now.
const ChannelCodeSearch = "kira:code:search"

// ChannelGitPairing and ChannelGitClientsChanged are G1's own two push channels — the pairing
// prompt's live queue snapshot, and the Connected editors pane's list. Kept here even though no
// caller in Part 1's own main.go wires the pairing-changed subscription yet (Part 1 lands the
// bridge services and gitsock itself; Part 2's own frontend/main.go work is what actually
// subscribes gitsock's OnPairingChanged/OnClientsChanged, since there is no window to push to
// until then) — codeworkspace.go's own precedent (ChannelCodeSearch above) for naming a channel
// where the service that would emit it lives, ahead of the caller that wires it.
const (
	ChannelGitPairing        = "kira:git:pairing"
	ChannelGitClientsChanged = "kira:git:clients"
)
