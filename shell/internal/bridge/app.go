package bridge

import (
	"runtime"

	"github.com/kirathecat/kira-studio/shell/internal/appcore"
	"github.com/kirathecat/kira-studio/shell/internal/config"
)

// AppInfo replaces src/shared/protocol/ipc.ts's AppInfo.electron/.chrome fields with go/wails/
// node — there is no Chromium or Electron version to report under Wails (P52 §4.2). Nothing in
// the current renderer reads AppInfo's fields (grepped for P52), so this is a clean rename rather
// than a compatibility shim.
type AppInfo struct {
	AppVersion string `json:"appVersion"`
	Go         string `json:"go"`
	Wails      string `json:"wails"`
	Node       string `json:"node"`
	KiraHome   string `json:"kiraHome"`
}

// AppService.Info is the direct analogue of today's IPC.appInfo (src/main/ipc/app.ts).
type AppService struct {
	Deps appcore.Deps
}

const appVersion = "0.0.0" // matches shell/build/config.yml's info.version.

func (s *AppService) Info() (AppInfo, error) {
	return AppInfo{
		AppVersion: appVersion,
		Go:         runtime.Version(),
		Wails:      "v3.0.0-beta.15",
		Node:       s.Deps.NodeVersion,
		KiraHome:   config.KiraHome(),
	}, nil
}
