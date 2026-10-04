package adeagent

import (
	"bufio"
	"os"
	"strings"
	"testing"
)

func feedFile(t *testing.T, name string) (lines []Line, todos []Todo) {
	t.Helper()
	f, err := os.Open("testdata/" + name)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	p := NewParser()
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 1<<20), 1<<20)
	for sc.Scan() {
		l, td := p.Feed(sc.Text())
		lines = append(lines, l...)
		if td != nil {
			todos = append(todos, *td)
		}
	}
	return lines, todos
}

func TestParserTaskCreateProgress(t *testing.T) {
	lines, todos := feedFile(t, "taskcreate.jsonl")
	want := []Todo{{0, 1}, {0, 2}, {1, 2}, {2, 2}}
	if len(todos) != len(want) {
		t.Fatalf("todos = %v, want %v", todos, want)
	}
	for i := range want {
		if todos[i] != want[i] {
			t.Fatalf("todos = %v, want %v", todos, want)
		}
	}
	text := joinLines(lines)
	for _, frag := range []string{"session 33f903aa", "▸ Bash echo hi", "▸ TaskCreate", "result: success · 7 turns", "Done."} {
		if !strings.Contains(text, frag) {
			t.Errorf("log lacks %q:\n%s", frag, text)
		}
	}
}

func TestParserTodoWriteReportsOnlyChanges(t *testing.T) {
	_, todos := feedFile(t, "todowrite.jsonl")
	if len(todos) != 2 || todos[0] != (Todo{0, 3}) || todos[1] != (Todo{1, 3}) {
		t.Fatalf("todos = %v", todos)
	}
}

func TestParserDeletedAndOutOfOrder(t *testing.T) {
	p := NewParser()
	use := func(id, name, input string) string {
		return `{"type":"assistant","message":{"content":[{"type":"tool_use","id":"` + id + `","name":"` + name + `","input":` + input + `}]}}`
	}
	res := func(id, text string) string {
		return `{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"` + id + `","content":"` + text + `"}]}}`
	}
	var last *Todo
	feed := func(s string) {
		if _, td := p.Feed(s); td != nil {
			last = td
		}
	}
	feed(use("a", "TaskCreate", `{"subject":"one"}`))
	feed(use("b", "TaskCreate", `{"subject":"two"}`))
	feed(res("b", "Task #2 created successfully: two")) // results arrive out of order
	feed(res("a", "Task #1 created successfully: one"))
	feed(use("c", "TaskUpdate", `{"taskId":"1","status":"completed"}`))
	feed(use("d", "TaskUpdate", `{"taskId":"2","status":"deleted"}`))
	if last == nil || *last != (Todo{1, 1}) {
		t.Fatalf("todo = %v, want {1 1}", last)
	}
}

func TestParserDenialAndOversize(t *testing.T) {
	lines, _ := feedFile(t, "denied.jsonl")
	text := joinLines(lines)
	for _, frag := range []string{"▸ Bash touch x", "denied: Bash", "✕ Permission to use Bash has been denied."} {
		if !strings.Contains(text, frag) {
			t.Errorf("log lacks %q:\n%s", frag, text)
		}
	}
	if strings.Contains(text, "rm y") || strings.Contains(text, "more") {
		t.Errorf("only the first line of a command / error belongs in the log:\n%s", text)
	}
	got, _ := NewParser().Feed(`{"type":"assistant","message":{"content":[{"type":"tex…`)
	if len(got) != 1 || got[0].Stream != StreamStdout {
		t.Fatalf("unparseable line = %v, want one raw stdout line", got)
	}
}

func TestLineWriterCapsLongLine(t *testing.T) {
	var got []string
	w := newLineWriter(func(s string) { got = append(got, s) })
	chunk := strings.Repeat("x", 1<<20)
	for i := 0; i < maxStreamLine>>20+2; i++ {
		_, _ = w.Write([]byte(chunk))
	}
	_, _ = w.Write([]byte("\nnext\n"))
	if len(got) != 2 || got[1] != "next" || !strings.HasSuffix(got[0], "…") || len(got[0]) > maxStreamLine+4 {
		t.Fatalf("got %d lines, first len %d", len(got), len(got[0]))
	}
}

func joinLines(lines []Line) string {
	var sb strings.Builder
	for _, l := range lines {
		sb.WriteString(l.Text)
		sb.WriteByte('\n')
	}
	return sb.String()
}
