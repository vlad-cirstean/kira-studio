package oplog

import (
	"bytes"
	"encoding/json"
	"regexp"
	"strings"
	"unicode/utf8"
)

const redacted = "***"

var (
	secretKey   = regexp.MustCompile(`(?i)extraheader|password|token|secret|authorization|credential`)
	urlUserinfo = regexp.MustCompile(`([a-zA-Z][a-zA-Z0-9+.-]*://)[^/\s@]+@`)
)

// RedactText masks URL credentials in free text (stderr tails, arguments).
func RedactText(s string) string {
	if !strings.Contains(s, "://") {
		return s
	}
	return urlUserinfo.ReplaceAllString(s, "${1}"+redacted+"@")
}

// RedactArgv masks secrets in a git argv: URL userinfo, secret-keyed `-c`/`--config-env` values
// and `--password=`-style flags. The input is not modified.
func RedactArgv(argv []string) []string {
	out := make([]string, len(argv))
	for i, a := range argv {
		switch {
		case i > 0 && (argv[i-1] == "-c" || argv[i-1] == "--config-env"):
			out[i] = redactKeyValue(a)
		case strings.HasPrefix(a, "--config-env="):
			out[i] = "--config-env=" + redactKeyValue(strings.TrimPrefix(a, "--config-env="))
		case strings.HasPrefix(a, "-c") && len(a) > 2 && strings.Contains(a, "="):
			out[i] = "-c" + redactKeyValue(a[2:])
		case strings.HasPrefix(a, "--") && strings.Contains(a, "="):
			name, val, _ := strings.Cut(a, "=")
			if secretKey.MatchString(name) {
				out[i] = name + "=" + redacted
			} else {
				out[i] = name + "=" + RedactText(val)
			}
		default:
			out[i] = RedactText(a)
		}
	}
	return out
}

func redactKeyValue(kv string) string {
	key, val, ok := strings.Cut(kv, "=")
	if !ok {
		return RedactText(kv)
	}
	if secretKey.MatchString(key) {
		return key + "=" + redacted
	}
	return key + "=" + RedactText(val)
}

// RedactJSON renders MCP tool arguments for display: values of secret-keyed fields masked, `args`
// arrays through RedactArgv, URL credentials masked, truncated to maxBytes.
func RedactJSON(raw []byte, maxBytes int) string {
	var v any
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var s string
	if err := dec.Decode(&v); err != nil {
		s = RedactText(string(raw))
	} else {
		b, err := json.Marshal(redactValue("", v))
		if err != nil {
			s = RedactText(string(raw))
		} else {
			s = string(b)
		}
	}
	return truncateRunes(s, maxBytes)
}

func redactValue(key string, v any) any {
	switch t := v.(type) {
	case map[string]any:
		for k, x := range t {
			if secretKey.MatchString(k) {
				if _, isStr := x.(string); isStr {
					t[k] = redacted
					continue
				}
			}
			t[k] = redactValue(k, x)
		}
		return t
	case []any:
		if key == "args" && allStrings(t) {
			strs := make([]string, len(t))
			for i, x := range t {
				strs[i] = x.(string)
			}
			red := RedactArgv(strs)
			for i := range t {
				t[i] = red[i]
			}
			return t
		}
		for i, x := range t {
			t[i] = redactValue("", x)
		}
		return t
	case string:
		return RedactText(t)
	}
	return v
}

func allStrings(a []any) bool {
	for _, x := range a {
		if _, ok := x.(string); !ok {
			return false
		}
	}
	return true
}

// truncateRunes cuts s to at most max bytes on a rune boundary and appends an ellipsis.
func truncateRunes(s string, max int) string {
	if len(s) <= max {
		return s
	}
	cut := max
	for cut > 0 && !utf8.RuneStart(s[cut]) {
		cut--
	}
	return s[:cut] + "…"
}

// tail keeps the last max bytes of s on a rune boundary.
func tail(s string, max int) string {
	if len(s) <= max {
		return s
	}
	cut := len(s) - max
	for cut < len(s) && !utf8.RuneStart(s[cut]) {
		cut++
	}
	return "…" + s[cut:]
}
