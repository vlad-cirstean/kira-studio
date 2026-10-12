package memfmt

import (
	"reflect"
	"strings"
	"testing"
)

const (
	idA = "km_7h3kq9x2mfa4"
	idB = "km_2b8c4d6f8g0h"
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
	idA + " fact: Billing API listens on port 9090 in production.",
	idA + " reason: Deploy manifest changed in March release.",
	"kira-memory origin=external source=slack scope=company",
	idB + " fact: Staging deploys at 09:00 UTC.",
	idB + " reason: Release calendar fixes it; see " + idA + ".",
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
		if blocks[1].Source != "slack" || blocks[1].Facts[0].Reason != "Release calendar fixes it; see "+idA+"." {
			t.Errorf("%s: block 1 = %+v", c.path, blocks[1])
		}
	}
	if blocks, ps := ParseComments("a.txt", []byte("// "+idA+" fact: x")); blocks != nil || ps != nil {
		t.Error("unsupported path must scan nothing")
	}
}

func TestParseCommentsRules(t *testing.T) {
	head := "// kira-memory origin=user scope=company\n"
	fact := "// " + idA + " fact: A fact.\n"
	reason := "// " + idA + " reason: A reason.\n"
	cases := []struct {
		name, path, src string
		line            int
		msg             string
	}{
		{"1 bad key order", "a.go", "// kira-memory scope=company origin=user\n" + fact + reason, 1, "header must be"},
		{"1 source on user", "a.go", "// kira-memory origin=user source=x scope=company\n" + fact + reason, 1, "source is only"},
		{"1 external without source", "a.go", "// kira-memory origin=external scope=company\n" + fact + reason, 1, "needs source"},
		{"1 bad scope", "a.go", "// kira-memory origin=user scope=team\n" + fact + reason, 1, "header must be"},
		{"2 fact without reason", "a.go", head + fact, 2, "no reason line"},
		{"2 reason first", "a.go", head + reason + fact, 2, "reason line without fact"},
		{"2 reason id differs", "a.go", head + fact + "// " + idB + " reason: R.\n", 3, "differs"},
		{"3 outside block", "a.go", fact + reason, 1, "without kira-memory header"},
		{"3 after blank line", "a.go", head + fact + reason + "\n" + "// " + idB + " fact: B.\n// " + idB + " reason: C.\n", 5, "without kira-memory header"},
		{"4 empty block", "a.go", head + "x := 1\n", 1, "empty kira-memory block"},
		{"5 marker differs", "a.vue", head + fact + "<!-- " + idA + " reason: R. -->\n", 3, "marker or indentation"},
		{"5 indent differs", "a.go", head + "\t" + fact + reason, 2, "marker or indentation"},
		{"5 not closed", "a.html", "<!-- kira-memory origin=user scope=company -->\n<!-- " + idA + " fact: A fact.\n<!-- " + idA + " reason: R. -->\n", 2, "not closed"},
		{"6 closer in text", "a.css", "/* kira-memory origin=user scope=company */\n/* " + idA + " fact: has */ inside */\n/* " + idA + " reason: R. */\n", 2, "contains */"},
		{"6 dashes in xml", "a.xml", "<!-- kira-memory origin=user scope=company -->\n<!-- " + idA + " fact: a -- b -->\n<!-- " + idA + " reason: R. -->\n", 2, "XML"},
		{"7 markup", "a.go", head + "// " + idA + " fact: Use **bold** text.\n" + reason, 2, "Markdown"},
		{"7 malformed id", "a.go", head + "// " + idA + " fact: See km_short.\n" + reason, 2, "malformed id"},
		{"7 empty text", "a.go", head + "// " + idA + " fact:\n" + reason, 2, "must be"},
		{"7 bad line", "a.go", head + "// " + idA + " note: x\n", 2, "must be"},
		{"8 duplicate id", "a.go", head + fact + reason + head + fact + reason, 5, "already a fact"},
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
}

func validDocText() string {
	return "---\nkira-memory: 1\ngroup: " + grp + "\ntitle: Billing deploys\norigin: external\nsource: confluence\nscope: project\nproject: github.com/acme/billing\nkeywords: billing, deploy, release\nupdated: 2026-10-12\n---\n\n## Ports\n\n" +
		idA + " fact: Billing API listens on port 9090 in production.\n" + idA + " reason: Deploy manifest changed in March release.\n" + idA + " keywords: billing-api, port, production\n\n" +
		idB + " fact: Staging deploys at 09:00 UTC.\n" + idB + " reason: Release calendar fixes it.\n"
}

func TestParseDoc(t *testing.T) {
	d, in, ps := ParseDoc([]byte(validDocText()))
	if !in || len(ps) != 0 {
		t.Fatalf("in=%v problems=%v", in, ps)
	}
	if d.Group != grp || d.Origin != "external" || d.Source != "confluence" || d.Project != "github.com/acme/billing" || len(d.Keywords) != 3 || d.Updated != "2026-10-12" {
		t.Errorf("doc = %+v", d)
	}
	if len(d.Facts) != 2 || d.Facts[0].Section != "Ports" || !reflect.DeepEqual(d.Facts[0].Keywords, []string{"billing-api", "port", "production"}) || d.Facts[1].Keywords != nil {
		t.Errorf("facts = %+v", d.Facts)
	}
	if _, in, ps := ParseDoc([]byte("# Notes\n\nfree prose km_bad\n")); in || ps != nil {
		t.Error("legacy md must be out of scope")
	}
	if _, in, _ := ParseDoc([]byte("---\ntitle: x\n---\n")); in {
		t.Error("front matter without kira-memory: 1 must be out of scope")
	}

	v := validDocText()
	cases := []struct {
		name, src, msg string
	}{
		{"9 missing title", strings.Replace(v, "title: Billing deploys\n", "", 1), "lacks title"},
		{"9 order", strings.Replace(v, "group: "+grp+"\ntitle: Billing deploys\n", "title: Billing deploys\ngroup: "+grp+"\n", 1), "out of order"},
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
		{"11 no reason", v + "\n" + idB[:3] + "2b8c4d6f8g1k fact: Another.\n", "no reason line"},
		{"11 no separation", strings.Replace(v, idA+" keywords: billing-api, port, production\n\n", idA+" keywords: billing-api, port, production\n", 1), "blank line or heading"},
		{"11 keywords first", strings.Replace(v, idA+" reason: Deploy manifest changed in March release.\n"+idA+" keywords: billing-api, port, production\n", idA+" keywords: x\n"+idA+" reason: R.\n", 1), "keywords line must follow"},
		{"12 markup", strings.Replace(v, "port 9090", "port `9090`", 1), "Markdown"},
		{"13 duplicate", v + "\n" + idA + " fact: Again.\n" + idA + " reason: Again.\n", "already a fact"},
		{"14 group", strings.Replace(v, grp, "km_4m9xq2c7v8ab", 1), "kg_ id"},
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

func TestFormatRoundTrip(t *testing.T) {
	blocks := []Block{
		{Provenance: Provenance{Origin: "user", Scope: "project"}, Facts: []Fact{{ID: idA, Fact: "Port is 9090.", Reason: "Manifest."}}},
		{Provenance: Provenance{Origin: "external", Source: "slack", Scope: "company"}, Facts: []Fact{{ID: idB, Fact: "Deploys at 09:00.", Reason: "Calendar."}}},
	}
	for _, c := range []struct{ path string }{{"a.go"}, {"a.py"}, {"a.html"}, {"a.css"}, {"a.sql"}} {
		ms, _ := MarkersFor(c.path)
		out, err := FormatComment(ms[0], blocks)
		if err != nil {
			t.Fatal(err)
		}
		for _, l := range strings.Split(strings.TrimSuffix(out, "\n"), "\n") {
			if !CommentLine.MatchString(l) {
				t.Errorf("%s: line %q does not match CommentLine", c.path, l)
			}
		}
		got, ps := ParseComments(c.path, []byte(out))
		if len(ps) != 0 || len(got) != 2 {
			t.Fatalf("%s: %v", c.path, ps)
		}
		for i := range got {
			got[i].Line = 0
			for j := range got[i].Facts {
				got[i].Facts[j].Line = 0
			}
		}
		if !reflect.DeepEqual(got, blocks) {
			t.Errorf("%s: round trip = %+v", c.path, got)
		}
	}
	html, _ := MarkersFor("a.html")
	if _, err := FormatComment(html[0], []Block{{Provenance: blocks[0].Provenance, Facts: []Fact{{ID: idA, Fact: "a --> b", Reason: "r"}}}}); err == nil {
		t.Error("closer in text must be refused")
	}
	svg, _ := MarkersFor("a.svg")
	if _, err := FormatComment(svg[0], []Block{{Provenance: blocks[0].Provenance, Facts: []Fact{{ID: idA, Fact: "a -- b", Reason: "r"}}}}); err == nil {
		t.Error("double dash in svg must be refused")
	}

	doc := Doc{Group: grp, Title: "Billing deploys", Keywords: []string{"billing", "deploy"}, Updated: "2026-10-12",
		Provenance: Provenance{Origin: "external", Source: "confluence", Scope: "project", Project: "github.com/acme/billing"},
		Facts: []Fact{
			{ID: idA, Fact: "Port is 9090.", Reason: "Manifest.", Keywords: []string{"port", "billing-api"}, Section: "Ports"},
			{ID: idB, Fact: "Deploys at 09:00.", Reason: "Calendar.", Section: "Ports"},
		}}
	out, err := FormatDoc(doc)
	if err != nil {
		t.Fatal(err)
	}
	for _, l := range strings.Split(strings.TrimSuffix(out, "\n"), "\n") {
		if !DocLine.MatchString(l) {
			t.Errorf("line %q does not match DocLine", l)
		}
	}
	got, in, ps := ParseDoc([]byte(out))
	if !in || len(ps) != 0 {
		t.Fatalf("%v", ps)
	}
	for i := range got.Facts {
		got.Facts[i].Line = 0
	}
	if !reflect.DeepEqual(got, doc) {
		t.Errorf("doc round trip = %+v", got)
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
			"kira-memory origin=team scope=company", idA+" fact:", idA+" note: x", "km_short fact: x",
			"kira-memory scope=company origin=user", idA+" fact: ok text")
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
	bad := validDocText() + "\nfree prose\n" + idA + " note: x\n" + "title: late\n" + "####### seven\n" + idB + " fact:\n"
	_, _, ps := ParseDoc([]byte(bad))
	flagged := map[int]bool{}
	for _, l := range problemLines(ps) {
		flagged[l] = true
	}
	lines := strings.Split(strings.TrimSuffix(bad, "\n"), "\n")
	for i := 10; i < len(lines); i++ {
		if !DocLine.MatchString(lines[i]) && !flagged[i+1] {
			t.Errorf("regex rejects doc line %d (%q) but parser accepts it", i+1, lines[i])
		}
	}
}
