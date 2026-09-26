//go:build darwin

package metrics

/*
#include <unistd.h>
extern pid_t responsibility_get_pid_responsible_for_pid(pid_t pid);
*/
import "C"

// responsibilityTracked is true on darwin: responsiblePID's answer means something here, so
// AppProcessSet must fail closed on a -1 ("no distinct responsible process") answer rather than
// including the helper unfiltered (P2 R1).
const responsibilityTracked = true

// responsiblePID returns the pid macOS considers responsible for launching pid — the same
// mechanism Activity Monitor uses to group a WKWebView helper (com.apple.WebKit.WebContent etc.,
// reparented to launchd, ppid=1) under the app that actually asked for it, rather than under
// whatever spawned it in the kernel's own ppid sense. Not declared in a public header, but a
// long-stable libSystem symbol (also relied on by Chromium's process_metrics_mac.mm for the same
// reason). Returns -1 if the pid has no distinct responsible process (e.g. a normal top-level app).
func responsiblePID(pid int32) int32 {
	return int32(C.responsibility_get_pid_responsible_for_pid(C.pid_t(pid)))
}
