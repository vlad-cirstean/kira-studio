package oplog

import (
	"reflect"
	"strings"
	"testing"
)

func TestRedactArgv(t *testing.T) {
	in := []string{
		"-c", "http.extraheader=Authorization: bearer abc",
		"-chttp.proxy=http://u:pw@proxy:3128",
		"--config-env", "credential.helper=SECRET_ENV",
		"--password=hunter2",
		"--token", "keepsPositional",
		"clone", "https://user:tok@github.com/o/r.git", "plain",
	}
	want := []string{
		"-c", "http.extraheader=***",
		"-chttp.proxy=http://***@proxy:3128",
		"--config-env", "credential.helper=***",
		"--password=***",
		"--token", "keepsPositional",
		"clone", "https://***@github.com/o/r.git", "plain",
	}
	got := RedactArgv(in)
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %q\nwant %q", got, want)
	}
	if in[1] != "http.extraheader=Authorization: bearer abc" {
		t.Fatal("input modified")
	}
}

func TestRedactJSON(t *testing.T) {
	raw := []byte(`{"token":"s3","n":5,"url":"https://a:b@h/x","args":["push","-c","x.password=p","https://u:p@h/r"],"nested":{"authorization":"Bearer z","list":["https://a:b@h","https://ghp_tok@github.com/o/r.git"]}}`)
	got := RedactJSON(raw, 4096)
	for _, leak := range []string{"s3", "Bearer z", "a:b@", "u:p@", "ghp_tok", "x.password=p"} {
		if strings.Contains(got, leak) {
			t.Fatalf("leaked %q in %s", leak, got)
		}
	}
	if !strings.Contains(got, `"n":5`) {
		t.Fatalf("number changed: %s", got)
	}
	if cut := RedactJSON([]byte(`{"a":"ééééé"}`), 8); !strings.HasSuffix(cut, "…") || strings.ContainsRune(cut, '�') {
		t.Fatalf("bad truncation %q", cut)
	}
}
