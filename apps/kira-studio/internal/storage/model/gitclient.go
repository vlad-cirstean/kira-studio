package model

// GitClient is git_clients' public projection — what the Connected editors pane and
// bridge.GitClientsService.List ever see. It deliberately carries no token_hash/token_salt: the
// struct simply has no such fields, rather than one the mapper is trusted to skip (SPEC §3.3, G1
// D19).
type GitClient struct {
	ID         string `json:"id"`
	Label      string `json:"label"`
	CreatedAt  int64  `json:"createdAt"`
	LastSeenAt int64  `json:"lastSeenAt"`
	RevokedAt  *int64 `json:"revokedAt"`
}
