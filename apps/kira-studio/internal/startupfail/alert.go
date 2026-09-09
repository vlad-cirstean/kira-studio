package startupfail

import "time"

const (
	// alertTimeout bounds the whole osascript spawn (D8): a wedged or headless osascript can never
	// hold a dying app open longer than this. Short enough that an unattended machine is not stuck
	// forever; long enough that a human at the keyboard has time to read and dismiss the alert.
	alertTimeout = 60 * time.Second
	// gracefulStopDelay mirrors gitvsix/exec.go's own bound: the fixed grace window cmd.WaitDelay
	// gives a spawned process after context cancellation before its process group is killed
	// outright.
	gracefulStopDelay = 2 * time.Second

	// osascriptFallbackPath/pbcopyFallbackPath are used only when LookPath cannot resolve the
	// name — both ship at this fixed location on every macOS (D3's "Locating the binary" note).
	osascriptFallbackPath = "/usr/bin/osascript"
	pbcopyFallbackPath    = "/usr/bin/pbcopy"

	// buttonCopyDetails/buttonOK are the exact button labels `display alert` renders, and the
	// exact strings report.go's present() compares osascript's stdout against (D10). AppleScript
	// lays buttons out right-to-left, so listing Copy Details first puts the default OK on the
	// right, where macOS expects it.
	buttonCopyDetails = "Copy Details"
	buttonOK          = "OK"
)

// alertArgv builds osascript's argument list for D3's exact five-statement script:
//
//	-e "on run argv"
//	-e "activate"
//	-e "set r to display alert (item 1 of argv) message (item 2 of argv) as critical
//	    buttons {"Copy Details", "OK"} default button "OK""
//	-e "return button returned of r"
//	-e "end run"
//	--
//	<title>
//	<body>
//
// Every one of the five "-e" statements is a compile-time string constant with no format verb and
// no concatenation touching title or body (D4) — both travel purely as the final two argv
// elements, read back inside the script with `item 1 of argv` / `item 2 of argv`. This is the
// security-critical property this package exists to guarantee: an error string containing `"`,
// `\`, an embedded newline, or a leading `-` is data, never AppleScript source, by construction —
// there is no code path in this function that could fragment title or body into a "-e" string even
// by accident, because neither parameter is ever referenced inside one. alert_test.go's golden
// test asserts this argv byte for byte, including a hostile body carrying all four of those
// characters.
//
// "--" terminates osascript's own option parsing, so a body that happens to start with "-" can
// never be misread as a flag.
//
// `activate` foregrounds the osascript process so the alert is not buried behind whatever the user
// is looking at. `return button returned of r` makes osascript's stdout exactly the pressed
// button's label plus a trailing newline — no AppleScript record parsing, no locale sensitivity
// beyond our own English button labels. `as critical` gives the caution badge.
func alertArgv(title, body string) []string {
	return []string{
		"-e", "on run argv",
		"-e", "activate",
		"-e", `set r to display alert (item 1 of argv) message (item 2 of argv) as critical buttons {"Copy Details", "OK"} default button "OK"`,
		"-e", "return button returned of r",
		"-e", "end run",
		"--",
		title,
		body,
	}
}
