//go:build !darwin

package agentsandbox

func parentPID(int) (int, bool) { return 0, false }
