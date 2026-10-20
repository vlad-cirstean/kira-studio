// Package claudemodel lists the Claude model aliases the app lets users pick.
package claudemodel

import "slices"

// Aliases are resolved by the claude CLI to the current model of that family.
var Aliases = []string{"haiku", "sonnet", "opus"}

// Default is the alias used when none is chosen.
const Default = "sonnet"

// Valid reports whether m is an allowed alias.
func Valid(m string) bool { return slices.Contains(Aliases, m) }
