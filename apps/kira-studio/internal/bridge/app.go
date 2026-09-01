package bridge

import (
	"runtime"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/appcore"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/buildinfo"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/config"
)

// AppInfo replaces packages/shared/protocol/ipc.ts's AppInfo.electron/.chrome fields with go/wails —
// there is no Chromium or Electron version to report under Wails (P52 §4.2), and no Node version
// either now that there is no vendored runtime to report on (P58f D11). Nothing in the current
// renderer reads AppInfo's fields (grepped for P52; re-checked for P58f — control.appInfo has zero
// renderer callers), so both are clean deletes rather than compatibility shims.
type AppInfo struct {
	AppVersion string `json:"appVersion"`
	Go         string `json:"go"`
	Wails      string `json:"wails"`
	KiraHome   string `json:"kiraHome"`
}

// AppService.Info is the direct analogue of today's IPC.appInfo (src/main/ipc/app.ts).
type AppService struct {
	Deps appcore.Deps
}

func (s *AppService) Info() (AppInfo, error) {
	return AppInfo{
		AppVersion: buildinfo.Version,
		Go:         runtime.Version(),
		Wails:      "v3.0.0-beta.15",
		KiraHome:   config.KiraHome(),
	}, nil
}
