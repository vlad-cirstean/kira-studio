package memfmt

import (
	"reflect"
	"strings"
	"testing"
)

const (
	idA = "km_7h3kq9x2mfa4"
	idB = "km_2b8c4d6f8g0h"
	idC = "km_9c2d4e6f8g1h"
	grp = "kg_4m9xq2c7v8ab"
)

// wrap renders lines with a marker: "// x", "<!-- x -->", "/* x */".
func wrap(open, closer string, lines ...string) string {
	var b strings.Builder
	for _, l := range lines {
		b.WriteString(open + " " + l)
		if closer != "" {
			b.WriteString(" " + closer)
		}
		b.WriteString("\n")
	}
	return b.String()
}

var blockLines = []string{
	"kira-memory origin=user scope=project",
	idA + " Billing API listens on port 9090 in production.",
	"  Deploy manifest changed in March release.",
	"kira-memory origin=external source=slack scope=company",
	idB + " Staging deploys at 09:00 UTC.",
	"  Release calendar fixes it; see " + idA + ".",
	idC + " Deploys run on weekdays.",
}

func problemLines(ps []Problem) []int {
	var out []int
	for _, p := range ps {
		out = append(out, p.Line)
	}
	return out
}

func TestParseCommentsValid(t *testing.T) {
	cases := []struct{ path, open, closer string }{
		{"a.go", "//", ""}, {"a.py", "#", ""}, {"a.sql", "--", ""}, {"a.ini", ";", ""}, {"a.tex", "%", ""},
		{"a.html", "<!--", "-->"}, {"a.css", "/*", "*/"}, {"a.vue", "//", ""}, {"a.vue", "<!--", "-->"},
		{"Dockerfile", "#", ""}, {"go", "//", ""},
	}
	for _, c := range cases {
		src := "legacy := 1 // not ours\n" + wrap(c.open, c.closer, blockLines...) + wrap(c.open, c.closer, "just prose mentioning "+idA+" mid-sentence")
		blocks, ps := ParseComments(c.path, []byte(src))
		if len(ps) != 0 || len(blocks) != 2 {
			t.Fatalf("%s %s: blocks=%d problems=%v", c.path, c.open, len(blocks), ps)
		}
		if blocks[0].Origin != "user" || blocks[0].Scope != "project" || len(blocks[0].Facts) != 1 || blocks[0].Facts[0].ID != idA {
			t.Errorf("%s: block 0 = %+v", c.path, blocks[0])
		}
		if blocks[1].Source != "slack" || blocks[1].Facts[0].Reason != "Release calendar fixes it; see "+idA+"." || len(blocks[1].Facts) != 2 || blocks[1].Facts[1].Reason != "" {
			t.Errorf("%s: block 1 = %+v", c.path, blocks[1])
		}
	}
	if blocks, ps := ParseComments("a.txt", []byte("// "+idA+" fact: x")); blocks != nil || ps != nil {
		t.Error("unsupported path must scan nothing")
	}
}

func TestParseCommentsRules(t *testing.T) {
	head := "// kira-memory origin=user scope=company\n"
	fact := "// " + idA + " A fact.\n"
	reason := "//   A reason.\n"
	cases := []struct {
		name, path, src string
		line            int
		msg             string
	}{
		{"1 bad key order", "a.go", "// kira-memory scope=company origin=user\n" + fact + reason, 1, "header must be"},
		{"1 source on user", "a.go", "// kira-memory origin=user source=x scope=company\n" + fact + reason, 1, "source is only"},
		{"1 external without source", "a.go", "// kira-memory origin=external scope=company\n" + fact + reason, 1, "needs source"},
		{"1 bad scope", "a.go", "// kira-memory origin=user scope=team\n" + fact + reason, 1, "header must be"},
		{"3 outside block", "a.go", fact + reason, 1, "without kira-memory header"},
		{"3 after blank line", "a.go", head + fact + reason + "\n" + "// " + idB + " B.\n", 5, "without kira-memory header"},
		{"4 empty block", "a.go", head + "x := 1\n", 1, "empty kira-memory block"},
		{"4 reason without fact", "a.go", head + reason, 1, "empty kira-memory block"},
		{"5 marker differs", "a.vue", head + fact + "<!--   R. -->\n", 3, "marker or indentation"},
		{"5 indent differs", "a.go", head + "\t" + fact, 2, "marker or indentation"},
		{"5 not closed", "a.html", "<!-- kira-memory origin=user scope=company -->\n<!-- " + idA + " A fact.\n", 2, "not closed"},
		{"6 closer in text", "a.css", "/* kira-memory origin=user scope=company */\n/* " + idA + " has */ inside */\n", 2, "contains */"},
		{"6 dashes in xml", "a.xml", "<!-- kira-memory origin=user scope=company -->\n<!-- " + idA + " a -- b -->\n", 2, "XML"},
		{"7 markup in fact", "a.go", head + "// " + idA + " Use **bold** text.\n", 2, "Markdown"},
		{"7 markup in reason", "a.go", head + fact + "//   Use `code` here.\n", 3, "Markdown"},
		{"7 malformed id", "a.go", head + "// " + idA + " See km_short.\n", 2, "malformed id"},
		{"7 empty text", "a.go", head + "// " + idA + " \n", 2, "empty"},
		{"7 bare id", "a.go", head + "// " + idA + "\n", 2, "must be"},
		{"8 duplicate id", "a.go", head + fact + head + fact, 4, "already a fact"},
		{"9 retired fact line", "a.go", head + "// " + idA + " fact: A fact.\n", 2, "retired P273"},
		{"9 retired reason line", "a.go", head + fact + "// " + idA + " reason: R.\n", 3, "retired P273"},
	}
	for _, c := range cases {
		_, ps := ParseComments(c.path, []byte(c.src))
		found := false
		for _, p := range ps {
			if p.Line == c.line && strings.Contains(p.Msg, c.msg) {
				found = true
			}
		}
		if !found {
			t.Errorf("%s: want line %d %q, got %v", c.name, c.line, c.msg, ps)
		}
	}

	// An indented line that is not the one reason after a fact is legacy: it ends the block unflagged.
	for name, src := range map[string]string{
		"second indented line":  head + fact + reason + "//   Another.\n",
		"indented after header": head + "//   Stray.\n",
		"three spaces":          head + fact + "//    Over-indented.\n",
		"after another comment": head + fact + "// prose\n" + reason,
	} {
		blocks, ps := ParseComments("a.go", []byte(src))
		if name == "indented after header" {
			if len(ps) != 1 || ps[0].Msg != "empty kira-memory block" {
				t.Errorf("%s: %v", name, ps)
			}
			continue
		}
		if len(ps) != 0 || len(blocks) != 1 || len(blocks[0].Facts) != 1 {
			t.Errorf("%s: blocks=%+v problems=%v", name, blocks, ps)
		}
	}
	if blocks, _ := ParseComments("a.go", []byte(head+fact+"//    Over-indented.\n")); blocks[0].Facts[0].Reason != "" {
		t.Error("three-space line must not be a reason")
	}
	if blocks, _ := ParseComments("a.go", []byte(head+fact+reason+"//   Another.\n")); blocks[0].Facts[0].Reason != "A reason." {
		t.Error("only the first indented line is the reason")
	}
}

func validDocText() string {
	return "---\nkira-memory: 2\ngroup: " + grp + "\ntitle: Billing deploys\nfrom: docs/billing.md\norigin: external\nsource: confluence\nscope: project\nproject: github.com/acme/billing\nkeywords: billing, deploy, release\nupdated: 2026-10-12\n---\n\n## Ports\n\n" +
		"- " + idA + " Billing API listens on port 9090 in production.\n  Deploy manifest changed in March release.\n- " + idB + " Staging deploys at 09:00 UTC.\n\n## Jobs\n\n- " + idC + " Jobs run nightly.\n"
}

func TestParseDoc(t *testing.T) {
	d, in, ps := ParseDoc([]byte(validDocText()))
	if !in || len(ps) != 0 {
		t.Fatalf("in=%v problems=%v", in, ps)
	}
	if d.Group != grp || d.Version != 2 || d.From != "docs/billing.md" || d.Origin != "external" || d.Source != "confluence" || d.Project != "github.com/acme/billing" || len(d.Keywords) != 3 || d.Updated != "2026-10-12" {
		t.Errorf("doc = %+v", d)
	}
	if len(d.Facts) != 3 || d.Facts[0].Section != "Ports" || d.Facts[0].Reason != "Deploy manifest changed in March release." || d.Facts[1].Reason != "" || d.Facts[2].Section != "Jobs" {
		t.Errorf("facts = %+v", d.Facts)
	}
	if _, in, ps := ParseDoc([]byte("# Notes\n\nfree prose km_bad\n")); in || ps != nil {
		t.Error("legacy md must be out of scope")
	}
	if _, in, _ := ParseDoc([]byte("---\ntitle: x\n---\n")); in {
		t.Error("front matter without kira-memory: 2 must be out of scope")
	}

	// A kira-memory: 1 doc is the retired format: its group parses, nothing else is read.
	v1 := "---\nkira-memory: 1\ngroup: " + grp + "\ntitle: Old\norigin: user\nscope: company\n---\n\n" + idA + " fact: A.\n" + idA + " reason: B.\n"
	d, in, ps = ParseDoc([]byte(v1))
	if !in || d.Version != 1 || d.Group != grp || len(d.Facts) != 0 || len(ps) != 1 || !strings.Contains(ps[0].Msg, "retired P273 format; rewrite it as kira-memory: 2") {
		t.Errorf("v1: in=%v doc=%+v problems=%v", in, d, ps)
	}

	v := validDocText()
	cases := []struct {
		name, src, msg string
	}{
		{"9 missing title", strings.Replace(v, "title: Billing deploys\n", "", 1), "lacks title"},
		{"9 order", strings.Replace(v, "group: "+grp+"\ntitle: Billing deploys\n", "title: Billing deploys\ngroup: "+grp+"\n", 1), "out of order"},
		{"9 from after origin", strings.Replace(v, "from: docs/billing.md\norigin: external\n", "origin: external\nfrom: docs/billing.md\n", 1), "out of order"},
		{"9 repeated", strings.Replace(v, "scope: project\n", "scope: project\nscope: project\n", 1), "repeated"},
		{"9 source for user", strings.Replace(v, "origin: external", "origin: user", 1), "only for origin external"},
		{"9 project missing", strings.Replace(v, "project: github.com/acme/billing\n", "", 1), "needs project"},
		{"9 project forbidden", strings.Replace(v, "scope: project", "scope: company", 1), "only for scope project"},
		{"9 colon in value", strings.Replace(v, "title: Billing deploys", "title: Billing: deploys", 1), "': '"},
		{"9 hash in value", strings.Replace(v, "title: Billing deploys", "title: Billing #1", 1), "' #'"},
		{"9 yaml indicator", strings.Replace(v, "title: Billing deploys", "title: [Billing]", 1), "YAML indicator"},
		{"9 bad date", strings.Replace(v, "2026-10-12", "2026-13-40", 1), "YYYY-MM-DD"},
		{"9 not closed", strings.Replace(v, "---\n\n## Ports", "\n## Ports", 1), "not closed"},
		{"10 prose", v + "\nfree prose\n", "body allows only"},
		{"10 old list bullet", v + "\n* " + idB[:3] + "2b8c4d6f8g1k Another.\n", "body allows only"},
		{"11 reason after blank", strings.Replace(v, "  Deploy manifest", "\n  Deploy manifest", 1), "directly follow a fact"},
		{"11 reason after heading", strings.Replace(v, "## Jobs\n\n", "## Jobs\n  Stray.\n\n", 1), "directly follow a fact"},
		{"11 reason first in doc", strings.Replace(v, "## Ports\n\n", "## Ports\n\n  Stray.\n", 1), "directly follow a fact"},
		{"12 markup in fact", strings.Replace(v, "port 9090", "port `9090`", 1), "Markdown"},
		{"12 markup in reason", strings.Replace(v, "March release", "**March** release", 1), "Markdown"},
		{"13 duplicate", v + "- " + idA + " Again.\n", "already a fact"},
		{"14 group", strings.Replace(v, grp, "km_4m9xq2c7v8ab", 1), "kg_ id"},
		{"15 retired line", v + idA[:0] + idC + " fact: Old.\n", "retired P273"},
		{"16 bad from", strings.Replace(v, "from: docs/billing.md", "from: docs: billing.md", 1), "': '"},
	}
	for _, c := range cases {
		_, in, ps := ParseDoc([]byte(c.src))
		found := false
		for _, p := range ps {
			found = found || strings.Contains(p.Msg, c.msg)
		}
		if !in || !found {
			t.Errorf("%s: in=%v want %q, got %v", c.name, in, c.msg, ps)
		}
	}
}

func TestCheckText(t *testing.T) {
	legal := []string{"Uses snake_case names", "Glob *.go files", "a * b is 4", "x_ and _y", "Port 9090", "See " + idA + " and " + grp + ".", "plain-text", "a < b and c > d", "pkg_name is fine"}
	for _, s := range legal {
		if msg := CheckText(s); msg != "" {
			t.Errorf("%q flagged: %s", s, msg)
		}
	}
	bad := []string{"", " lead", "trail ", "two\nlines", "a **b** c", "a __b__ c", "a *b* c", "a _b_ c", "a `b` c", "a ~~b~~ c", "a [b](c) d", "a <b> c", "see km_abc", "see kg_4m9xq2c7v8abx", "see km_7h3kq9x2mfa4z"}
	for _, s := range bad {
		if CheckText(s) == "" {
			t.Errorf("%q must be flagged", s)
		}
	}
	for _, s := range []string{"a **b** and `c`", "a _b_ and ~~c~~", "see [x](y) <b>z</b>", "a __b__ *c*"} {
		if got := StripMarkup(s); CheckText(got) != "" {
			t.Errorf("StripMarkup(%q) = %q still flagged: %s", s, got, CheckText(got))
		}
	}
}

func clearLines(blocks []Block) {
	for i := range blocks {
		blocks[i].Line = 0
		for j := range blocks[i].Facts {
			blocks[i].Facts[j].Line = 0
		}
	}
}

func TestFormatRoundTrip(t *testing.T) {
	blocks := []Block{
		{Provenance: Provenance{Origin: "user", Scope: "project"}, Facts: []Fact{{ID: idA, Fact: "Port is 9090.", Reason: "Manifest."}, {ID: idC, Fact: "Jobs run nightly."}}},
		{Provenance: Provenance{Origin: "external", Source: "slack", Scope: "company"}, Facts: []Fact{{ID: idB, Fact: "Deploys at 09:00.", Reason: "Calendar."}}},
	}
	for _, path := range []string{"a.go", "a.py", "a.html", "a.css", "a.sql", "a.xml", "a.tex"} {
		ms, _ := MarkersFor(path)
		out, err := FormatComment(ms[0], blocks)
		if err != nil {
			t.Fatal(err)
		}
		for _, l := range strings.Split(strings.TrimSuffix(out, "\n"), "\n") {
			if !CommentLine.MatchString(l) {
				t.Errorf("%s: line %q does not match CommentLine", path, l)
			}
		}
		got, ps := ParseComments(path, []byte(out))
		if len(ps) != 0 || len(got) != 2 {
			t.Fatalf("%s: %v", path, ps)
		}
		clearLines(got)
		if !reflect.DeepEqual(got, blocks) {
			t.Errorf("%s: round trip = %+v", path, got)
		}
	}
	css, _ := MarkersFor("a.css")
	out, _ := FormatComment(css[0], blocks[1:])
	if !strings.Contains(out, "/*   Calendar. */\n") || !strings.Contains(out, "/* "+idB+" Deploys at 09:00. */\n") {
		t.Errorf("css layout = %q", out)
	}
	html, _ := MarkersFor("a.html")
	if _, err := FormatComment(html[0], []Block{{Provenance: blocks[0].Provenance, Facts: []Fact{{ID: idA, Fact: "a --> b"}}}}); err == nil {
		t.Error("closer in text must be refused")
	}
	svg, _ := MarkersFor("a.svg")
	if _, err := FormatComment(svg[0], []Block{{Provenance: blocks[0].Provenance, Facts: []Fact{{ID: idA, Fact: "a -- b"}}}}); err == nil {
		t.Error("double dash in svg must be refused")
	}
	for _, f := range []string{"fact: x", "reason: x", "keywords: x"} {
		if _, err := FormatComment(css[0], []Block{{Provenance: blocks[0].Provenance, Facts: []Fact{{ID: idA, Fact: f}}}}); err == nil {
			t.Errorf("fact text %q reads as a retired line and must be refused", f)
		}
		if _, err := FormatDoc(Doc{Group: grp, Title: "T", Provenance: Provenance{Origin: "user", Scope: "company"}, Facts: []Fact{{ID: idA, Fact: f}}}); err == nil {
			t.Errorf("doc fact text %q must be refused", f)
		}
	}

	doc := Doc{Group: grp, Title: "Billing deploys", From: "docs/billing.md", Version: 2, Keywords: []string{"billing", "deploy"}, Updated: "2026-10-12",
		Provenance: Provenance{Origin: "external", Source: "confluence", Scope: "project", Project: "github.com/acme/billing"},
		Facts: []Fact{
			{ID: idA, Fact: "Port is 9090.", Reason: "Manifest.", Section: "Ports"},
			{ID: idB, Fact: "Deploys at 09:00.", Section: "Ports"},
			{ID: idC, Fact: "Jobs run nightly.", Reason: "Cron.", Section: "Jobs"},
		}}
	for _, variant := range []string{"full", "no sections", "minimal front matter"} {
		d := doc
		d.Facts = append([]Fact(nil), doc.Facts...)
		switch variant {
		case "no sections":
			for i := range d.Facts {
				d.Facts[i].Section = ""
			}
		case "minimal front matter":
			d.From, d.Keywords, d.Updated = "", nil, ""
		}
		out, err := FormatDoc(d)
		if err != nil {
			t.Fatal(err)
		}
		for _, l := range strings.Split(strings.TrimSuffix(out, "\n"), "\n") {
			if !DocLine.MatchString(l) {
				t.Errorf("%s: line %q does not match DocLine", variant, l)
			}
		}
		got, in, ps := ParseDoc([]byte(out))
		if !in || len(ps) != 0 {
			t.Fatalf("%s: %v", variant, ps)
		}
		for i := range got.Facts {
			got.Facts[i].Line = 0
		}
		if !reflect.DeepEqual(got, d) {
			t.Errorf("%s: doc round trip = %+v", variant, got)
		}
	}
	out, _ = FormatDoc(doc)
	if !strings.Contains(out, "\n## Ports\n\n- "+idA+" Port is 9090.\n  Manifest.\n- "+idB+" Deploys at 09:00.\n\n## Jobs\n\n- "+idC) {
		t.Errorf("doc layout = %q", out)
	}
	bad := doc
	bad.Facts = []Fact{{ID: idA, Fact: "x", Section: "A"}, {ID: idB, Fact: "y"}}
	if _, err := FormatDoc(bad); err == nil {
		t.Error("a section cannot end")
	}
}

func TestLocator(t *testing.T) {
	cases := []struct{ path, section, want string }{
		{"docs/a.md", "", "Stated in docs/a.md"},
		{"docs/a.md", "Plan > Decisions", "Stated in docs/a.md, Plan > Decisions"},
		{"docs/a.md", "Fields, limits and `Max`", "Stated in docs/a.md, Fields, limits and Max"},
		{"docs/a.md", "  A   **B**  ", "Stated in docs/a.md, A B"},
		{"a.md", "Sec", "Stated in a.md, Sec"},
	}
	for _, c := range cases {
		got := Locator(c.path, c.section)
		if got != c.want || CheckText(got) != "" {
			t.Errorf("Locator(%q, %q) = %q (%s), want %q", c.path, c.section, got, CheckText(got), c.want)
		}
		sec, ok := ParseLocator(got, c.path)
		if !ok || Locator(c.path, sec) != got {
			t.Errorf("ParseLocator(%q) = %q, %v", got, sec, ok)
		}
	}
	for _, c := range []struct{ reason, path string }{
		{"Stated in a.md.bak, Sec", "a.md"},
		{"Stated in a.md2", "a.md"},
		{"Stated in b.md, Sec", "a.md"},
		{"Stated in a.md, ", "a.md"},
		{"Stated in a.md,Sec", "a.md"},
		{"Stated in a.md, A **B**", "a.md"},
		{"Stated in a.md, A  B", "a.md"},
		{"stated in a.md", "a.md"},
		{"Manifest changed", "a.md"},
		{"", "a.md"},
	} {
		if sec, ok := ParseLocator(c.reason, c.path); ok {
			t.Errorf("ParseLocator(%q, %q) = %q, want not a locator", c.reason, c.path, sec)
		}
	}
	// A path that is a prefix of another keeps its own sections apart.
	if sec, ok := ParseLocator("Stated in a.md, b.md, Sec", "a.md"); !ok || sec != "b.md, Sec" {
		t.Errorf("prefix path: %q %v", sec, ok)
	}
	if _, ok := ParseLocator("Stated in a.md, b.md, Sec", "a.md, b.md"); !ok {
		t.Error("longer path must match its own locator")
	}
}

// TestRegexMatchesParser keeps the published regexes aligned with the parsers: every line a valid
// fixture holds matches, and every in-scope line the regex rejects in an invalid fixture is a problem.
func TestRegexMatchesParser(t *testing.T) {
	for _, tc := range []struct{ path, open, closer string }{{"a.go", "//", ""}, {"a.html", "<!--", "-->"}, {"a.css", "/*", "*/"}, {"a.sql", "--", ""}} {
		valid := wrap(tc.open, tc.closer, blockLines...)
		if _, ps := ParseComments(tc.path, []byte(valid)); len(ps) != 0 {
			t.Fatalf("%s: %v", tc.path, ps)
		}
		for _, l := range strings.Split(strings.TrimSuffix(valid, "\n"), "\n") {
			if !CommentLine.MatchString(l) {
				t.Errorf("valid line rejected by regex: %q", l)
			}
		}
		invalid := wrap(tc.open, tc.closer,
			"kira-memory origin=team scope=company", idA, "km_short x", "kira-memory scope=company origin=user", idA+" ok text")
		_, ps := ParseComments(tc.path, []byte(invalid))
		flagged := map[int]bool{}
		for _, l := range problemLines(ps) {
			flagged[l] = true
		}
		for i, l := range strings.Split(strings.TrimSuffix(invalid, "\n"), "\n") {
			if !CommentLine.MatchString(l) && !flagged[i+1] {
				t.Errorf("%s: regex rejects line %d (%q) but parser accepts it", tc.path, i+1, l)
			}
		}
	}

	if _, _, ps := ParseDoc([]byte(validDocText())); len(ps) != 0 {
		t.Fatal(ps)
	}
	for _, l := range strings.Split(strings.TrimSuffix(validDocText(), "\n"), "\n") {
		if !DocLine.MatchString(l) {
			t.Errorf("valid doc line rejected by regex: %q", l)
		}
	}
	bad := validDocText() + "\nfree prose\n" + idA + " fact: x\n" + "title: late\n" + "####### seven\n- " + idB + "\n"
	_, _, ps := ParseDoc([]byte(bad))
	flagged := map[int]bool{}
	for _, l := range problemLines(ps) {
		flagged[l] = true
	}
	lines := strings.Split(strings.TrimSuffix(bad, "\n"), "\n")
	for i := 11; i < len(lines); i++ {
		if !DocLine.MatchString(lines[i]) && !flagged[i+1] {
			t.Errorf("regex rejects doc line %d (%q) but parser accepts it", i+1, lines[i])
		}
	}
}
