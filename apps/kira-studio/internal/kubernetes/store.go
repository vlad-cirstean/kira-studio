package kubernetes

import "time"

// ClusterRecord is one stored cluster row: a stable id for a (context, server) pair.
type ClusterRecord struct {
	ID         string
	Context    string
	Server     string
	CreatedAt  time.Time
	LastSeenAt time.Time
}

// ClusterStore persists cluster identities. The Studio repos package implements it, so this
// package never imports storage.
type ClusterStore interface {
	// Ensure returns the row for (context, server), creating it on first sight and bumping last_seen_at.
	Ensure(context, server string, now time.Time) (ClusterRecord, error)
	Get(id string) (ClusterRecord, bool, error)
}
