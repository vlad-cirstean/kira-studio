package postman

import (
	"encoding/json"
	"testing"

	"github.com/google/go-cmp/cmp"
)

// TestDecodeVariableEntry runs one entry table through both the collection and environment
// decoders: one rule set, identical output.
func TestDecodeVariableEntry(t *testing.T) {
	tests := []struct {
		name         string
		entry        string
		want         []Variable
		wantDisabled int
		wantEmpty    int
	}{
		{name: "string default", entry: `{"key":"a","value":"x","type":"default","enabled":true}`,
			want: []Variable{{Name: "a", Value: "x", Type: "default"}}},
		{name: "secret", entry: `{"key":"a","value":"s","type":"secret"}`,
			want: []Variable{{Name: "a", Value: "s", Secret: true, Type: "secret"}}},
		{name: "api type any", entry: `{"key":"a","value":"x","type":"any"}`,
			want: []Variable{{Name: "a", Value: "x", Type: "any"}}},
		{name: "number", entry: `{"key":"a","value":3}`, want: []Variable{{Name: "a", Value: "3"}}},
		{name: "bool", entry: `{"key":"a","value":true}`, want: []Variable{{Name: "a", Value: "true"}}},
		{name: "object", entry: `{"key":"a","value":{ "a": 1 }}`, want: []Variable{{Name: "a", Value: `{"a":1}`}}},
		{name: "array", entry: `{"key":"a","value":[ 1, 2 ]}`, want: []Variable{{Name: "a", Value: `[1,2]`}}},
		{name: "null", entry: `{"key":"a","value":null}`, want: []Variable{{Name: "a"}}, wantEmpty: 1},
		{name: "absent", entry: `{"key":"a"}`, want: []Variable{{Name: "a"}}, wantEmpty: 1},
		{name: "empty string", entry: `{"key":"a","value":""}`, want: []Variable{{Name: "a"}}, wantEmpty: 1},
		{name: "enabled false", entry: `{"key":"a","value":"x","enabled":false}`, wantDisabled: 1},
		{name: "disabled true", entry: `{"key":"a","value":"x","disabled":true}`, wantDisabled: 1},
		{name: "enabled absent", entry: `{"key":"a","value":"x"}`, want: []Variable{{Name: "a", Value: "x"}}},
		{name: "empty key", entry: `{"key":"","value":"x"}`},
		{name: "non-scalar key", entry: `{"key":{},"value":"x"}`},
		{name: "description object", entry: `{"key":"a","value":"x","description":{"content":"d"}}`,
			want: []Variable{{Name: "a", Value: "x", Description: "d"}}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			arr := json.RawMessage("[" + tc.entry + "]")
			gotVars, gotDisabled, gotEmpty := decodeVariables(arr)
			if len(tc.want) == 0 {
				tc.want = []Variable{}
			}
			if diff := cmp.Diff(tc.want, gotVars); diff != "" {
				t.Fatalf("collection variables (-want +got):\n%s", diff)
			}
			if gotDisabled != tc.wantDisabled || gotEmpty != tc.wantEmpty {
				t.Fatalf("collection counts = %d disabled, %d empty; want %d, %d", gotDisabled, gotEmpty, tc.wantDisabled, tc.wantEmpty)
			}

			env := parseEnvironment(map[string]json.RawMessage{"values": arr})
			if diff := cmp.Diff(tc.want, env.Variables); diff != "" {
				t.Fatalf("environment variables (-want +got):\n%s", diff)
			}
			if env.Disabled != tc.wantDisabled || env.Empty != tc.wantEmpty {
				t.Fatalf("environment counts = %d disabled, %d empty; want %d, %d", env.Disabled, env.Empty, tc.wantDisabled, tc.wantEmpty)
			}
		})
	}
}
