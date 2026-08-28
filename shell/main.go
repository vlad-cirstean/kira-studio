package main

import (
	"embed"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/kirathecat/kira-studio/shell/internal/appcore"
	"github.com/kirathecat/kira-studio/shell/internal/bridge"
	"github.com/kirathecat/kira-studio/shell/internal/enginehost"
	"github.com/kirathecat/kira-studio/shell/internal/storage"
	"github.com/kirathecat/kira-studio/shell/internal/storage/repos"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// Any files in frontend/dist are embedded into the binary — built by `bun run build:wails` from
// the real src/renderer (P52 §2.3), not by this scaffold's own removed demo frontend project.
//
//go:embed all:frontend/dist
var assets embed.FS

// blank is gate G1's configuration (1) (P52 §3.2): a static page making the one AppService.Info()
// call, measuring the floor cost of Wails + the webview + Go + the vendored Node child with no
// app in it. Selected via KIRA_G1_BLANK=1, never in normal operation.
//
//go:embed blank/index.html
var blankAssets embed.FS

func main() {
	db, err := storage.Open()
	if err != nil {
		log.Fatalf("kira-studio-shell: storage: %v", err)
	}
	defer db.Close()

	deps := appcore.Deps{
		DB:          db.DB,
		StartedAt:   time.Now().UnixMilli(),
		Settings:    &repos.SettingsRepo{DB: db.DB},
		Layout:      &repos.LayoutRepo{DB: db.DB},
		Tabs:        &repos.TabsRepo{DB: db.DB},
		Connections: &repos.ConnectionsRepo{DB: db.DB},
		Ops:         &repos.OpsRepo{DB: db.DB},
		Filters:     &repos.FiltersRepo{DB: db.DB},
	}

	// The engine memory cap mirrors today's advanced.engineMemoryCapMb setting (P51 §3.6); M1
	// reads it from the just-migrated (possibly still-default) settings row, same as production
	// would before any user override exists.
	settings, err := deps.Settings.GetAll()
	if err != nil {
		log.Fatalf("kira-studio-shell: read settings: %v", err)
	}

	nodeBin, engineScript, err := resolveEngine()
	if err != nil {
		log.Fatalf("kira-studio-shell: resolve engine: %v", err)
	}
	host, err := enginehost.Start(nodeBin, engineScript,
		fmt.Sprintf("--max-old-space-size=%d", settings.Advanced.EngineMemoryCapMb),
	)
	if err != nil {
		log.Fatalf("kira-studio-shell: start engine: %v", err)
	}
	defer host.Stop()
	deps.EngineHost = host
	deps.NodeVersion = nodeVersion(nodeBin)

	app := application.New(application.Options{
		Name:        "Kira Studio Shell",
		Description: "A visual database client for macOS (Wails/Go spike shell)",
		Services: []application.Service{
			application.NewService(&bridge.AppService{Deps: deps}),
			application.NewService(&bridge.SettingsService{Deps: deps}),
			application.NewService(&bridge.LayoutService{Deps: deps}),
			application.NewService(&bridge.TabsService{Deps: deps}),
			application.NewService(&bridge.ConnectionsService{Deps: deps}),
			application.NewService(&bridge.EngineService{Deps: deps}),
			application.NewService(&bridge.OpsService{Deps: deps}),
			application.NewService(&bridge.FiltersService{Deps: deps}),
		},
		Assets: application.AssetOptions{
			Handler: assetHandler(),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
		OnShutdown: func() {
			host.Stop()
		},
	})

	// P52 M1 window: minimal options only (P52 §3.2). Bounds-from-layout, the menu and the
	// quit-flush handshake are P56 work (§8.1-§8.3).
	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:            "Kira Studio",
		Width:            1280,
		Height:           800,
		MinWidth:         900,
		MinHeight:        600,
		BackgroundColour: application.NewRGB(0x1F, 0x1F, 0x1F),
		URL:              "/",
	})

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}

// resolveEngine locates the vendored Node runtime and the M1 walking-skeleton engine script.
// P52 §3.1 vendors the runtime to shell/runtime/node/ (git-ignored, fetched by
// scripts/vendor-node.sh); this checks next to the running executable first (the packaged shape)
// and falls back to the source tree (the `wails3 task dev` / `go run` shape).
func resolveEngine() (nodeBin, script string, err error) {
	scriptCandidates := []string{
		"testdata/engine-ping.mjs",
	}
	nodeCandidates := []string{
		"runtime/node/bin/node",
	}
	if exe, exeErr := os.Executable(); exeErr == nil {
		exeDir := filepath.Dir(exe)
		nodeCandidates = append([]string{filepath.Join(exeDir, "runtime", "node", "bin", "node")}, nodeCandidates...)
		scriptCandidates = append([]string{filepath.Join(exeDir, "testdata", "engine-ping.mjs")}, scriptCandidates...)
	}

	nodeBin, err = firstExisting(nodeCandidates)
	if err != nil {
		return "", "", fmt.Errorf(
			"vendored node runtime not found (looked in %v) — run scripts/vendor-node.sh first", nodeCandidates,
		)
	}
	script, err = firstExisting(scriptCandidates)
	if err != nil {
		return "", "", fmt.Errorf("engine-ping.mjs not found (looked in %v)", scriptCandidates)
	}
	return nodeBin, script, nil
}

func assetHandler() http.Handler {
	if os.Getenv("KIRA_G1_BLANK") == "1" {
		sub, err := fs.Sub(blankAssets, "blank")
		if err != nil {
			log.Fatalf("kira-studio-shell: blank assets: %v", err)
		}
		return application.AssetFileServerFS(sub)
	}
	return application.AssetFileServerFS(assets)
}

func firstExisting(candidates []string) (string, error) {
	for _, c := range candidates {
		if fi, err := os.Stat(c); err == nil && !fi.IsDir() {
			return c, nil
		}
	}
	return "", os.ErrNotExist
}

func nodeVersion(nodeBin string) string {
	out, err := exec.Command(nodeBin, "--version").Output()
	if err != nil {
		return "unknown"
	}
	return strings.TrimSpace(string(out))
}
