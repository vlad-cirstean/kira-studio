package jira

import (
	"encoding/json"
	"regexp"
	"strings"
	"testing"
)

var localID = regexp.MustCompile(`"localId":"[0-9a-f-]{36}"`)

func TestMarkdownADF(t *testing.T) {
	t0 := func(s string, marks ...string) string {
		m := make([]string, len(marks))
		for i, x := range marks {
			m[i] = x
		}
		out := "{"
		if len(m) > 0 {
			out += `"marks":[` + strings.Join(m, ",") + `],`
		}
		return out + `"text":` + jsonStr(s) + `,"type":"text"}`
	}
	p := func(inner ...string) string {
		return `{"content":[` + strings.Join(inner, ",") + `],"type":"paragraph"}`
	}
	d := func(blocks ...string) string {
		return `{"content":[` + strings.Join(blocks, ",") + `],"type":"doc","version":1}`
	}
	mk := func(typ string) string { return `{"type":"` + typ + `"}` }
	link := func(href string) string { return `{"attrs":{"href":"` + href + `"},"type":"link"}` }
	cases := []struct{ name, in, want string }{
		{"heading", "## T", d(`{"attrs":{"level":2},"content":[` + t0("T") + `],"type":"heading"}`)},
		{"nested marks", "**a _b_**", d(p(t0("a ", mk("strong")), t0("b", mk("strong"), mk("em"))))},
		{"strike", "~~x~~", d(p(t0("x", mk("strike"))))},
		{"code drops other marks", "**`x`**", d(p(t0("x", mk("code"))))},
		{"fence language", "```go\nfmt.Println()\n```", d(`{"attrs":{"language":"go"},"content":[` + t0("fmt.Println()") + `],"type":"codeBlock"}`)},
		{"ordered start", "3. a\n4. b", d(`{"attrs":{"order":3},"content":[` +
			`{"content":[` + p(t0("a")) + `],"type":"listItem"},{"content":[` + p(t0("b")) + `],"type":"listItem"}],"type":"orderedList"}`)},
		{"nested list", "- a\n  - b", d(`{"content":[{"content":[` + p(t0("a")) + `,{"content":[{"content":[` + p(t0("b")) +
			`],"type":"listItem"}],"type":"bulletList"}],"type":"listItem"}],"type":"bulletList"}`)},
		{"task list", "- [x] done\n- [ ] todo", d(`{"attrs":{"localId":"L"},"content":[` +
			`{"attrs":{"localId":"L","state":"DONE"},"content":[` + t0("done") + `],"type":"taskItem"},` +
			`{"attrs":{"localId":"L","state":"TODO"},"content":[` + t0("todo") + `],"type":"taskItem"}],"type":"taskList"}`)},
		{"table header row", "|a|b|\n|-|-|\n|1|2|", d(`{"content":[` +
			`{"content":[{"content":[` + p(t0("a")) + `],"type":"tableHeader"},{"content":[` + p(t0("b")) + `],"type":"tableHeader"}],"type":"tableRow"},` +
			`{"content":[{"content":[` + p(t0("1")) + `],"type":"tableCell"},{"content":[` + p(t0("2")) + `],"type":"tableCell"}],"type":"tableRow"}],"type":"table"}`)},
		{"unsafe link is text", "[x](javascript:alert(1))", d(p(t0("x")))},
		{"safe link", "[x](https://a.test/p)", d(p(t0("x", link("https://a.test/p"))))},
		{"image is linked alt", "![shot](https://a.test/s.png)", d(p(t0("shot", link("https://a.test/s.png"))))},
		{"raw html is literal text", "a <b>x</b>", d(p(t0("a "), t0("<b>"), t0("x"), t0("</b>")))},
		{"hard and soft breaks", "a  \nb\nc", d(p(t0("a"), mk("hardBreak"), t0("b"), t0(" "), t0("c")))},
		{"rule and quote", "---\n\n> q", d(mk("rule"), `{"content":[`+p(t0("q"))+`],"type":"blockquote"}`)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			raw, err := markdownADF(tc.in)
			if err != nil {
				t.Fatal(err)
			}
			got := localID.ReplaceAllString(string(raw), `"localId":"L"`)
			if got != tc.want {
				t.Errorf("got  %s\nwant %s", got, tc.want)
			}
		})
	}
	for _, in := range []string{"", "  \n\n"} {
		if _, err := markdownADF(in); err == nil {
			t.Errorf("%q: want error", in)
		}
	}
}

func jsonStr(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}
