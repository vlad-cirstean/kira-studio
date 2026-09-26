package bridge

// Browser is the OS-browser seam LinkService needs — each app declares its own Browser interface
// where it is consumed (Kira Space's own bridge/browser.go carries the identical shape). Used to
// live in update.go, alongside UpdateService.OpenReleasePage (P66) — moved out when P119 commit 8
// removed that method, since LinkService is now this interface's only consumer.
type Browser interface {
	OpenURL(url string) error
}
