package mobileweb

import (
	"bytes"
	"errors"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strings"
	"time"
)

// staticHandler serves the embedded mobile build: the exact file when present, else index.html for
// a page navigation (client-side routes), else 404. The shell holds no data, so it needs no auth:
// the pairing screen must load before a device exists.
func (s *Server) staticHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		serveAsset(s.cfg.Assets, w, r, true)
	})
}

// serveAsset serves one file from assets. spa enables the index.html fallback for navigations.
func serveAsset(assets fs.FS, w http.ResponseWriter, r *http.Request, spa bool) {
	clean := path.Clean("/" + r.URL.Path)
	if clean == "/api" || strings.HasPrefix(clean, "/api/") {
		http.NotFound(w, r)
		return
	}
	name := strings.TrimPrefix(clean, "/")
	if name == "" {
		name = "index.html"
	}
	data, err := fs.ReadFile(assets, name)
	if err != nil {
		if !errors.Is(err, fs.ErrNotExist) && !isDirErr(assets, name) {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		if !spa || path.Ext(name) != "" || !strings.Contains(r.Header.Get("Accept"), "text/html") {
			http.NotFound(w, r)
			return
		}
		name = "index.html"
		if data, err = fs.ReadFile(assets, name); err != nil {
			http.NotFound(w, r)
			return
		}
	}
	if strings.HasPrefix(name, "assets/") {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		w.Header().Set("Cache-Control", "no-cache")
	}
	if ct := mime.TypeByExtension(path.Ext(name)); ct != "" {
		w.Header().Set("Content-Type", ct)
	}
	http.ServeContent(w, r, name, time.Time{}, bytes.NewReader(data))
}

func isDirErr(assets fs.FS, name string) bool {
	info, err := fs.Stat(assets, name)
	return err == nil && info.IsDir()
}
