package memory

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

// fakeClaude writes a shell script that records argv, stdin, cwd and env to dir, then prints out.
func fakeClaude(t *testing.T, out string, exit int) (r *CLIRunner, dir string) {
	t.Helper()
	dir = t.TempDir()
	script := filepath.Join(dir, "claude")
	body := "#!/bin/sh\n" +
		`printf '%s\n' "$@" > '` + dir + `/argv'` + "\n" +
		`cat > '` + dir + `/stdin'` + "\n" +
		`pwd > '` + dir + `/cwd'` + "\n" +
		`env > '` + dir + `/env'` + "\n" +
		"cat <<'JSON'\n" + out + "\nJSON\n" +
		"echo 'login required' >&2\n" +
		"exit " + string(rune('0'+exit)) + "\n"
	if err := os.WriteFile(script, []byte(body), 0o755); err != nil {
		t.Fatal(err)
	}
	return &CLIRunner{lookPath: func(string) (string, error) { return script, nil }, stat: os.Stat}, dir
}

func TestCLIRunnerIsolation(t *testing.T) {
	t.Setenv("CLAUDECODE", "1")
	t.Setenv("CLAUDE_CODE_SESSION_ID", "abc")
	t.Setenv("ANTHROPIC_API_KEY", "sk-keep")
	r, dir := fakeClaude(t, `{"type":"result","is_error":false,"structured_output":{"ok":true}}`, 0)
	out, err := r.Run(context.Background(), Call{System: "sys", Input: `{"secret":"memory text"}`, Schema: []byte(`{"type":"object"}`)})
	if err != nil || string(out) != `{"ok":true}` {
		t.Fatalf("out=%s err=%v", out, err)
	}
	argv, _ := os.ReadFile(filepath.Join(dir, "argv"))
	args := strings.Split(strings.TrimSpace(string(argv)), "\n")
	for _, want := range []string{"-p", "--safe-mode", "--setting-sources", "--strict-mcp-config", "--tools",
		"--system-prompt", "--json-schema", "--model", "sonnet", "--no-session-persistence", "--disable-slash-commands"} {
		if !slices.Contains(args, want) {
			t.Errorf("argv missing %q: %v", want, args)
		}
	}
	if slices.Contains(args, "--bare") || strings.Contains(string(argv), "memory text") {
		t.Errorf("argv must not carry --bare or the input: %v", args)
	}
	if stdin, _ := os.ReadFile(filepath.Join(dir, "stdin")); string(stdin) != `{"secret":"memory text"}` {
		t.Errorf("stdin = %q", stdin)
	}
	if cwd, _ := os.ReadFile(filepath.Join(dir, "cwd")); strings.Contains(string(cwd), dir) {
		t.Errorf("cwd must be a fresh temp dir, got %s", cwd)
	}
	env, _ := os.ReadFile(filepath.Join(dir, "env"))
	if strings.Contains(string(env), "CLAUDECODE=") || strings.Contains(string(env), "CLAUDE_CODE_SESSION_ID=") {
		t.Error("session env leaked into the child")
	}
	if !strings.Contains(string(env), "ANTHROPIC_API_KEY=sk-keep") {
		t.Error("auth env dropped")
	}
}

func TestCLIRunnerErrorMapping(t *testing.T) {
	cases := []struct {
		name string
		out  string
		exit int
		want error
	}{
		{"budget", `{"is_error":true,"subtype":"error_max_budget_usd"}`, 1, ErrClaudeBudget},
		{"auth from stderr", `{"is_error":true,"result":""}`, 1, ErrClaudeAuth},
		{"is_error with exit 0", `{"is_error":true,"result":"please log in"}`, 0, ErrClaudeAuth},
		{"missing structured output", `{"is_error":false,"result":"text"}`, 0, ErrClaudeOutput},
		{"not json", `nope`, 0, ErrClaudeOutput},
	}
	for _, c := range cases {
		r, _ := fakeClaude(t, c.out, c.exit)
		_, err := r.Run(context.Background(), Call{System: "s", Input: "{}", Schema: []byte(`{}`)})
		if !errors.Is(err, c.want) {
			t.Errorf("%s: err = %v, want %v", c.name, err, c.want)
		}
	}
	r := &CLIRunner{lookPath: func(string) (string, error) { return "", errors.New("no") }, stat: func(string) (os.FileInfo, error) { return nil, errors.New("no") }}
	if _, err := r.Run(context.Background(), Call{}); !errors.Is(err, ErrClaudeNotFound) {
		t.Errorf("not found: %v", err)
	}
}
