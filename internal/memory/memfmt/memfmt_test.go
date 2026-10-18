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

func problemLines(ps []Problem) []int {
	var out []int
	for _, p := range ps {
		out = append(out, p.Line)
	}
	return out
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

func TestFormatRoundTrip(t *testing.T) {
	for _, f := range []string{"fact: x", "reason: x", "keywords: x"} {
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
	out, _ := FormatDoc(doc)
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

// TestRegexMatchesParser keeps the published regex aligned with the parser: every line a valid
// fixture holds matches, and every in-scope line the regex rejects in an invalid fixture is a problem.
func TestRegexMatchesParser(t *testing.T) {
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
