package model

// MobileDevice is mobile_devices' public projection, the Mobile access pane's list row. Like
// GitClient it has no token_hash/token_salt fields at all.
type MobileDevice struct {
	ID         string `json:"id"`
	Label      string `json:"label"`
	UserAgent  string `json:"userAgent"`
	CreatedAt  int64  `json:"createdAt"`
	LastSeenAt int64  `json:"lastSeenAt"`
	LastIP     string `json:"lastIp"`
	RevokedAt  *int64 `json:"revokedAt"`
	// ExpiresAt is epoch ms; the phone must pair again after it.
	ExpiresAt int64 `json:"expiresAt"`
	// CanWrite and CanAgentInput are the two desktop-granted permissions (P212 Part 2).
	CanWrite      bool `json:"canWrite"`
	CanAgentInput bool `json:"canAgentInput"`
}
