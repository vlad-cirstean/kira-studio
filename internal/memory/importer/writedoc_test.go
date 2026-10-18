package importer

import (
	"strings"
	"testing"

	"github.com/kirathecat/kira-studio/internal/memory"
	"github.com/kirathecat/kira-studio/internal/memory/memfmt"
)

// TestRenderDocSections: a locator reason becomes a ### heading, per category and no reason line; a locator without a
// section after a heading, and any other reason, stay in full under the running section.
func TestRenderDocSections(t *testing.T) {
	project := "github.com/acme/billing"
	mem := func(n, fact, reason string) memory.Memory {
		return memory.Memory{LineageID: "km_00000000000" + n, Fact: fact, Kind: memory.KindFact, Reason: reason, Origin: memory.OriginAgent, Scope: memory.ScopeProject, Project: &project}
	}
	in := DocInput{GroupID: "kg_000000000000", Title: "Plan", FileName: "plan.md", Rel: "docs/plan.md", Updated: "2026-10-14",
		Prov: Provenance{Origin: memory.OriginAgent, Scope: memory.ScopeProject, Project: project}}
	mems := []memory.Memory{
		mem("1", "Before any heading.", "Stated in docs/plan.md"),
		mem("2", "First section.", "Stated in docs/plan.md, Plan > Amounts"),
		mem("3", "Same section.", "Stated in docs/plan.md, Plan > Amounts"),
		mem("4", "Own reason.", "Ops confirmed it in March"),
		mem("5", "Second section.", "Stated in docs/plan.md, Plan > Deploys"),
		mem("6", "Bare locator after a heading.", "Stated in docs/plan.md"),
		mem("7", "Other file.", "Stated in docs/other.md, Plan > Deploys"),
		mem("8", "Never skip it.", "Stated in docs/plan.md, Plan > Amounts"),
	}
	mems[7].Kind = memory.KindRule
	text, left, bad, err := RenderDoc(in, mems)
	if err != nil || left != 0 || bad != 0 {
		t.Fatalf("RenderDoc = %v left %d bad %d", err, left, bad)
	}
	want := "from: docs/plan.md\n"
	body := "---\n\n## Facts\n\n- km_000000000001 Before any heading.\n\n### Plan > Amounts\n\n- km_000000000002 First section.\n- km_000000000003 Same section.\n" +
		"- km_000000000004 Own reason.\n  Ops confirmed it in March\n\n### Plan > Deploys\n\n- km_000000000005 Second section.\n" +
		"- km_000000000006 Bare locator after a heading.\n  Stated in docs/plan.md\n- km_000000000007 Other file.\n  Stated in docs/other.md, Plan > Deploys\n\n## Rules\n\n### Plan > Amounts\n\n- km_000000000008 Never skip it.\n"
	if !strings.Contains(text, want) || !strings.HasSuffix(text, body) {
		t.Fatalf("doc =\n%s", text)
	}
	if _, _, ps := memfmt.ParseDoc([]byte(text)); len(ps) != 0 {
		t.Fatalf("render does not parse clean: %v", ps)
	}

	in.Rel = "docs: plan.md"
	text, _, _, err = RenderDoc(in, mems[:2])
	if err != nil || strings.Contains(text, "from:") || !strings.Contains(text, "  Stated in docs/plan.md, Plan > Amounts") {
		t.Fatalf("a Rel the header rejects must leave out from and keep reasons: %v\n%s", err, text)
	}
}
