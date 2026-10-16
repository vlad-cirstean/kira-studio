// Package desknotify posts OS desktop notifications. The Wails sink compiles on every platform;
// each app registers the native service only on macOS (its notify_darwin.go).
package desknotify

// Note is one notification. Data round-trips through the OS so a click can find its target.
type Note struct {
	ID, Title, Body, Thread string
	Data                    map[string]string
}

// Sink posts and withdraws notifications.
type Sink interface {
	Send(Note) error
	// Remove withdraws a delivered or pending notification; unknown ids are a no-op.
	Remove(id string) error
}
