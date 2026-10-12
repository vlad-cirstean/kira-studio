package gitclient

// ShortSHALen is the abbreviated commit id length shown to people and used in labels.
const ShortSHALen = 7

// ShortSHA abbreviates a commit id to ShortSHALen characters.
func ShortSHA(sha string) string {
	if len(sha) > ShortSHALen {
		return sha[:ShortSHALen]
	}
	return sha
}
