//go:build !darwin

package metrics

// responsiblePID has no equivalent outside macOS's XPC responsibility tracking. Returning -1
// (unknown) makes AppProcessSet include every helper-needle match unfiltered, which is correct on
// Linux specifically: P52 §2.3 confirmed WebKitGTK's WebProcess/NetworkProcess are true ppid
// children of this app there, so the cross-app false-positive risk this file's darwin counterpart
// exists to close does not arise on this platform.
func responsiblePID(pid int32) int32 {
	return -1
}
