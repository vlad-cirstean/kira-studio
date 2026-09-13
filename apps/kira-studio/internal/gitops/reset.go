package gitops

// ResetArgs builds `reset --<mode> <target>` for the three user-selectable modes (§7.7).
func ResetArgs(mode, target string) []string {
	return []string{"reset", "--" + mode, target}
}

// ResetKeepArgs builds `reset --keep <target>` and exists ONLY for an undo replay (probe 9):
// --keep preserves unrelated local modifications and REFUSES (exit 128, changing nothing) rather
// than lose work, which is exactly the guarantee an undo needs and no user-selectable mode
// provides. §7.7 names three modes; a fourth would be a spec change, not an implementation choice,
// so this is deliberately NOT reachable through ResetArgs' own mode string.
func ResetKeepArgs(target string) []string {
	return []string{"reset", "--keep", target}
}
