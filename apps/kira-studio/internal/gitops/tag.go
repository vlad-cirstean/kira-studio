package gitops

// TagCreateArgs builds `git tag [-f] [-a -m <message>] <name> <target>`. message present ⇒
// annotated; `-f` on an already-annotated tag MUST re-supply -a -m or git silently downgrades it
// to lightweight (probe P3) — this builder re-supplies it whenever a message is present, force or
// not, so that hazard cannot occur through this argv builder.
func TagCreateArgs(name, target string, message *string, force bool) []string {
	argv := []string{"tag"}
	if force {
		argv = append(argv, "-f")
	}
	if message != nil {
		argv = append(argv, "-a", "-m", *message, name, target)
		return argv
	}
	return append(argv, name, target)
}

// TagDeleteArgs builds `git tag -d <name>`.
func TagDeleteArgs(name string) []string {
	return []string{"tag", "-d", name}
}

// UndoTagArgs restores a deleted tag's ref straight at sha (probe P3): for an annotated tag, sha
// is the TAG OBJECT's own sha (still resolvable in the object database after `tag -d`, which only
// removes the ref); for a lightweight tag, sha is the commit it named. One function, not
// upstream's two (undoAnnotatedTagArgs/undoLightweightTagArgs) — their bodies are identical, and
// what differs is only which sha the caller captured, which is the caller's own decision.
func UndoTagArgs(name, sha string) []string {
	return []string{"update-ref", "refs/tags/" + name, sha}
}
