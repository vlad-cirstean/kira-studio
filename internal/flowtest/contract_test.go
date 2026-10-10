package flowtest

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestNormalizeContract(t *testing.T) {
	type row struct {
		ID, Parent, Path string
		At               string
		N                int
		Pid              int
		Tags             []string
	}
	a, b := "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"
	got := []row{
		{ID: a, Parent: "", Path: "/tmp/x/home/a.txt", At: "2026-01-02T03:04:05.123Z", N: 7, Pid: 99, Tags: []string{b, a}},
		{ID: b, Parent: a, Path: "/tmp/x/home", At: "2026-01-02T03:04:05.123Z"},
		{ID: "33333333-3333-4333-8333-333333333333", At: "2026-02-02T00:00:00+02:00"},
	}
	norm := NormalizeContract(t, got, Replace("/tmp/x/home", "<home>"), Replace("/tmp/x", "<tmp>"), Mask("Pid"))
	raw, _ := json.Marshal(norm)
	var wantV any
	want := `[{"At":"<time:1>","ID":"<id:1>","N":7,"Parent":"","Path":"<home>/a.txt","Pid":"<masked>","Tags":["<id:2>","<id:1>"]},` +
		`{"At":"<time:1>","ID":"<id:2>","N":0,"Parent":"<id:1>","Path":"<home>","Pid":"<masked>","Tags":null},` +
		`{"At":"<time:2>","ID":"<id:3>","N":0,"Parent":"","Path":"","Pid":"<masked>","Tags":null}]`
	_ = json.Unmarshal([]byte(want), &wantV)
	if !reflect.DeepEqual(wantV, norm) {
		t.Fatalf("got\n%s\nwant\n%s", raw, want)
	}
}
