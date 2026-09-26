package bridge

// Browser is the OS-browser seam GitHubService.OpenPullRequestURL needs — each app declares its
// own Browser interface where it is consumed (Kira Studio's own bridge/browser.go carries the
// identical shape).
type Browser interface {
	OpenURL(url string) error
}
