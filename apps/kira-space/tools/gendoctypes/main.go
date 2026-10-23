// Command gendoctypes renders Kira Space's document types and imported UTIs from
// internal/filetypes into both Info plists, between the kira:doctypes markers.
// wails3's build-assets task drops the block; rerun this after it.
//
// Usage: go run ./apps/kira-space/tools/gendoctypes [--check]
package main

import (
	"bytes"
	"encoding/xml"
	"flag"
	"fmt"
	"os"
	"strings"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/filetypes"
)

const (
	beginMarker = "<!-- kira:doctypes:begin -->"
	endMarker   = "<!-- kira:doctypes:end -->"
)

var plists = []string{
	"apps/kira-space/build/darwin/Info.plist",
	"apps/kira-space/build/darwin/Info.dev.plist",
}

func main() {
	check := flag.Bool("check", false, "exit non-zero when a plist differs from the generated block")
	flag.Parse()
	block := render()
	drift := false
	for _, path := range plists {
		src, err := os.ReadFile(path)
		if err != nil {
			fatal(err)
		}
		out, err := splice(string(src), block)
		if err != nil {
			fatal(fmt.Errorf("%s: %w", path, err))
		}
		if out == string(src) {
			continue
		}
		if *check {
			fmt.Fprintf(os.Stderr, "gendoctypes: %s is out of date; run go run ./apps/kira-space/tools/gendoctypes\n", path)
			drift = true
			continue
		}
		if err := os.WriteFile(path, []byte(out), 0o644); err != nil {
			fatal(err)
		}
	}
	if drift {
		os.Exit(1)
	}
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, "gendoctypes:", err)
	os.Exit(2)
}

// splice replaces the marked block, or inserts it after the root dict's opening tag.
func splice(src, block string) (string, error) {
	if b := strings.Index(src, beginMarker); b >= 0 {
		e := strings.Index(src, endMarker)
		if e < b {
			return "", fmt.Errorf("end marker missing or before begin marker")
		}
		start := strings.LastIndex(src[:b], "\n") + 1
		end := e + len(endMarker)
		return src[:start] + block + src[end:], nil
	}
	const open = "\t<dict>\n"
	i := strings.Index(src, open)
	if i < 0 {
		return "", fmt.Errorf("root dict not found")
	}
	i += len(open)
	return src[:i] + block + "\n" + src[i:], nil
}

func esc(s string) string {
	var b bytes.Buffer
	if err := xml.EscapeText(&b, []byte(s)); err != nil {
		fatal(err)
	}
	return b.String()
}

// render returns the block at two-tab indent, without a trailing newline.
func render() string {
	var b strings.Builder
	w := func(depth int, format string, args ...any) {
		b.WriteString(strings.Repeat("\t", depth))
		fmt.Fprintf(&b, format, args...)
		b.WriteByte('\n')
	}
	w(2, "%s", beginMarker)
	w(2, "<key>CFBundleDocumentTypes</key>")
	w(2, "<array>")
	for _, g := range filetypes.Groups {
		w(3, "<dict>")
		w(4, "<key>CFBundleTypeName</key>")
		w(4, "<string>%s</string>", esc(g.TypeName))
		w(4, "<key>CFBundleTypeRole</key>")
		w(4, "<string>Viewer</string>")
		w(4, "<key>LSHandlerRank</key>")
		w(4, "<string>Alternate</string>")
		w(4, "<key>LSItemContentTypes</key>")
		w(4, "<array>")
		for _, u := range filetypes.UTIs(g.ID) {
			w(5, "<string>%s</string>", esc(u))
		}
		w(4, "</array>")
		w(3, "</dict>")
	}
	w(2, "</array>")
	w(2, "<key>UTImportedTypeDeclarations</key>")
	w(2, "<array>")
	for _, t := range filetypes.Imported() {
		w(3, "<dict>")
		w(4, "<key>UTTypeConformsTo</key>")
		w(4, "<array>")
		w(5, "<string>%s</string>", esc(t.ConformsTo))
		w(4, "</array>")
		w(4, "<key>UTTypeDescription</key>")
		w(4, "<string>%s</string>", esc(t.Description))
		w(4, "<key>UTTypeIdentifier</key>")
		w(4, "<string>%s</string>", esc(t.UTI))
		w(4, "<key>UTTypeTagSpecification</key>")
		w(4, "<dict>")
		w(5, "<key>public.filename-extension</key>")
		w(5, "<array>")
		for _, e := range t.Extensions {
			w(6, "<string>%s</string>", esc(e))
		}
		w(5, "</array>")
		w(4, "</dict>")
		w(3, "</dict>")
	}
	w(2, "</array>")
	b.WriteString("\t\t" + endMarker)
	return strings.TrimSuffix(b.String(), "\n")
}
