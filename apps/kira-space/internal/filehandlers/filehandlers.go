// Package filehandlers reads and changes which app opens Kira Space's file types. LaunchServices
// is the source of truth: every call re-reads it, and the only stored state is the handler an
// extension had before Kira Space took it, so switching off can give it back.
package filehandlers

import (
	"errors"
	"fmt"
	"path/filepath"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/filetypes"
)

// App is an application bundle.
type App struct {
	Path     string `json:"path"`
	BundleID string `json:"bundleId"`
	Name     string `json:"name"`
}

// ErrUnsupported is what a Registry without OS support reports.
var ErrUnsupported = errors.New("default apps can be changed only in the installed macOS app")

// Registry is the OS seam over the default-app database.
type Registry interface {
	Supported() bool
	// Resolve maps ext to its content type. dynamic means the system has no declared type for it,
	// which is what an app never registered with LaunchServices sees.
	Resolve(ext string) (uti string, dynamic bool)
	// Default returns the app that opens uti; the zero App means none.
	Default(uti string) (App, error)
	SetDefault(uti, appPath string) error
	Self() App
}

// Unsupported is the Registry of a build or platform without default-app control.
type Unsupported struct{}

func (Unsupported) Supported() bool                 { return false }
func (Unsupported) Resolve(string) (string, bool)   { return "", true }
func (Unsupported) Default(string) (App, error)     { return App{}, ErrUnsupported }
func (Unsupported) SetDefault(string, string) error { return ErrUnsupported }
func (Unsupported) Self() App                       { return App{} }

// Row states.
const (
	StateSelf        = "self"
	StateOther       = "other"
	StateNone        = "none"
	StateUnavailable = "unavailable"
)

type ExtStatus struct {
	Ext     string `json:"ext"`
	UTI     string `json:"uti"`
	State   string `json:"state"`
	Handler *App   `json:"handler"`
}

type Group struct {
	ID         string      `json:"id"`
	Extensions []ExtStatus `json:"extensions"`
}

type StatusResult struct {
	Supported bool    `json:"supported"`
	Groups    []Group `json:"groups"`
}

type SetArgs struct {
	Exts []string `json:"exts"`
	On   bool     `json:"on"`
}

type SetResult struct {
	Unrestored []string `json:"unrestored"`
}

// PreviousStore persists the app an extension had before Kira Space took it.
type PreviousStore interface {
	Get(ext string) (appPath string, ok bool, err error)
	Put(ext, appPath, bundleID string) error
	Delete(ext string) error
}

// Service implements the pane's two calls.
type Service struct {
	Registry Registry
	Previous PreviousStore
}

func isSelf(self, app App) bool {
	if app.Path == "" {
		return false
	}
	if self.BundleID != "" && app.BundleID == self.BundleID {
		return true
	}
	return self.Path != "" && filepath.Clean(app.Path) == filepath.Clean(self.Path)
}

// Status reads the live handler of every associated extension.
func (s *Service) Status() (StatusResult, error) {
	out := StatusResult{Supported: s.Registry.Supported(), Groups: []Group{}}
	if !out.Supported {
		return out, nil
	}
	self := s.Registry.Self()
	for _, g := range filetypes.Groups {
		group := Group{ID: g.ID, Extensions: []ExtStatus{}}
		for _, e := range filetypes.ByGroup(g.ID) {
			row := ExtStatus{Ext: e.Ext, State: StateUnavailable}
			uti, dynamic := s.Registry.Resolve(e.Ext)
			row.UTI = uti
			if !dynamic {
				app, err := s.Registry.Default(uti)
				switch {
				case err != nil || app.Path == "":
					row.State = StateNone
				case isSelf(self, app):
					row.State, row.Handler = StateSelf, &app
				default:
					row.State, row.Handler = StateOther, &app
				}
			}
			group.Extensions = append(group.Extensions, row)
		}
		out.Groups = append(out.Groups, group)
	}
	return out, nil
}

// Set makes Kira Space (on) or the saved previous app (off) the default for exts. An extension
// that cannot be given back stays on Kira Space and comes back in Unrestored.
func (s *Service) Set(args SetArgs) (SetResult, error) {
	res := SetResult{Unrestored: []string{}}
	if !s.Registry.Supported() {
		return res, ErrUnsupported
	}
	for _, ext := range args.Exts {
		if _, ok := filetypes.Lookup(ext); !ok {
			return res, fmt.Errorf("unknown file extension %q", ext)
		}
	}
	self := s.Registry.Self()
	if args.On {
		return res, s.turnOn(self, args.Exts)
	}
	for _, ext := range args.Exts {
		restored, err := s.turnOff(self, ext)
		if err != nil {
			return res, err
		}
		if !restored {
			res.Unrestored = append(res.Unrestored, ext)
		}
	}
	return res, nil
}

func (s *Service) turnOn(self App, exts []string) error {
	// Read every current handler before the first write: extensions sharing one type would
	// otherwise see Kira Space as the handler and skip saving the app it replaced.
	type target struct {
		ext, uti string
		current  App
	}
	var targets []target
	for _, ext := range exts {
		uti, dynamic := s.Registry.Resolve(ext)
		if dynamic {
			continue
		}
		cur, err := s.Registry.Default(uti)
		if err != nil {
			cur = App{}
		}
		targets = append(targets, target{ext: ext, uti: uti, current: cur})
	}
	for _, t := range targets {
		if isSelf(self, t.current) {
			continue
		}
		_, saved, err := s.Previous.Get(t.ext)
		if err != nil {
			return err
		}
		if !saved && t.current.Path != "" {
			if err := s.Previous.Put(t.ext, t.current.Path, t.current.BundleID); err != nil {
				return err
			}
		}
		if err := s.Registry.SetDefault(t.uti, self.Path); err != nil {
			return fmt.Errorf("set default for .%s: %w", t.ext, err)
		}
	}
	return nil
}

// sharing returns every extension that resolves to uti, ext included. LaunchServices keys the
// default by type, so a row saved for one of them restores them all.
func (s *Service) sharing(ext, uti string) []string {
	out := []string{ext}
	for _, e := range filetypes.All() {
		if e.Ext == ext {
			continue
		}
		if u, dynamic := s.Registry.Resolve(e.Ext); !dynamic && u == uti {
			out = append(out, e.Ext)
		}
	}
	return out
}

// turnOff reports whether ext is off Kira Space afterwards. It restores from the saved row of ext
// or, failing that, of an extension sharing its type.
func (s *Service) turnOff(self App, ext string) (bool, error) {
	uti, dynamic := s.Registry.Resolve(ext)
	if dynamic {
		return true, nil
	}
	cur, _ := s.Registry.Default(uti)
	var (
		prevPath string
		saved    []string
	)
	for _, e := range s.sharing(ext, uti) {
		p, ok, err := s.Previous.Get(e)
		if err != nil {
			return false, err
		}
		if ok {
			if prevPath == "" {
				prevPath = p
			}
			saved = append(saved, e)
		}
	}
	if !isSelf(self, cur) {
		// A Finder change already moved it; the saved rows are stale.
		return true, s.deleteRows(saved)
	}
	if len(saved) == 0 {
		return false, nil
	}
	if err := s.Registry.SetDefault(uti, prevPath); err != nil {
		return false, nil
	}
	return true, s.deleteRows(saved)
}

func (s *Service) deleteRows(exts []string) error {
	for _, e := range exts {
		if err := s.Previous.Delete(e); err != nil {
			return err
		}
	}
	return nil
}
