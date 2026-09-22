package gitaskpass

// ShouldInterpose reports whether the broker's own shim should be installed as GIT_ASKPASS/
// SSH_ASKPASS for one spawn. Ported verbatim from upstream's shouldInterposeAskpass (D10): a user
// who configured their own core.askPass, or who already has GIT_ASKPASS set in the environment
// this process inherited, has already solved credential prompting — deferring to it is this
// chapter's own config-fidelity posture, applied here.
func ShouldInterpose(coreAskPass, inheritedGitAskpass string) bool {
	return coreAskPass == "" && inheritedGitAskpass == ""
}
