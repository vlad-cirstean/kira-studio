package memfmt

import "strings"

const locatorLead = "Stated in "

// Locator is the reason of a fact stated in the file at path, under section when it has one. The
// section loses inline Markdown and extra whitespace, so the result passes CheckText.
func Locator(path, section string) string {
	section = StripMarkup(section)
	if section == "" {
		return locatorLead + path
	}
	return locatorLead + path + ", " + section
}

// ParseLocator is the exact inverse of Locator for the same path: ok is true when reason is
// Locator(path, section) for the returned section. Any other reason, and any whose section Locator
// would rewrite, is not a locator.
func ParseLocator(reason, path string) (section string, ok bool) {
	head := locatorLead + path
	switch {
	case reason == head:
		return "", true
	case strings.HasPrefix(reason, head+", "):
		section = reason[len(head)+2:]
		if section != "" && Locator(path, section) == reason {
			return section, true
		}
	}
	return "", false
}
