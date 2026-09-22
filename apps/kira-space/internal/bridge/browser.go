package bridge

// Browser is the OS-browser seam GitHubService.OpenPullRequestURL needs — Kira Studio's own
// bridge.Browser (update.go), copied here rather than imported: that file also declares
// UpdateService, which this app has no equivalent of yet.
type Browser interface {
	OpenURL(url string) error
}
