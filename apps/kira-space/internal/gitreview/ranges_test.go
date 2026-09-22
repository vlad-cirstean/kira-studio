package gitreview

import (
	"reflect"
	"testing"
)

func TestNormalize(t *testing.T) {
	cases := []struct {
		name string
		in   []LineRange
		want []LineRange
	}{
		{"empty", nil, nil},
		{"single", []LineRange{{5, 10}}, []LineRange{{5, 10}}},
		{"invalid dropped", []LineRange{{10, 5}, {1, 3}}, []LineRange{{1, 3}}},
		{"disjoint stays separate", []LineRange{{1, 3}, {10, 12}}, []LineRange{{1, 3}, {10, 12}}},
		{"touching merges", []LineRange{{1, 3}, {4, 6}}, []LineRange{{1, 6}}},
		{"overlapping merges", []LineRange{{1, 5}, {3, 8}}, []LineRange{{1, 8}}},
		{"contained merges away", []LineRange{{1, 10}, {3, 5}}, []LineRange{{1, 10}}},
		{"reversed input order", []LineRange{{10, 12}, {1, 3}}, []LineRange{{1, 3}, {10, 12}}},
		{
			"chain of overlaps collapses to one",
			[]LineRange{{1, 3}, {2, 5}, {4, 9}, {20, 21}},
			[]LineRange{{1, 9}, {20, 21}},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := Normalize(tc.in)
			if !reflect.DeepEqual(got, tc.want) {
				t.Errorf("Normalize(%v) = %v, want %v", tc.in, got, tc.want)
			}
		})
	}
}

func TestUnion(t *testing.T) {
	cases := []struct {
		name string
		a, b []LineRange
		want []LineRange
	}{
		{"both empty", nil, nil, nil},
		{"one empty", []LineRange{{1, 5}}, nil, []LineRange{{1, 5}}},
		{"disjoint", []LineRange{{1, 3}}, []LineRange{{10, 12}}, []LineRange{{1, 3}, {10, 12}}},
		{"overlapping", []LineRange{{1, 5}}, []LineRange{{3, 8}}, []LineRange{{1, 8}}},
		{"touching", []LineRange{{1, 3}}, []LineRange{{4, 6}}, []LineRange{{1, 6}}},
		{"contained", []LineRange{{1, 10}}, []LineRange{{3, 5}}, []LineRange{{1, 10}}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := Union(tc.a, tc.b)
			if !reflect.DeepEqual(got, tc.want) {
				t.Errorf("Union(%v, %v) = %v, want %v", tc.a, tc.b, got, tc.want)
			}
		})
	}
}

func TestSubtract(t *testing.T) {
	cases := []struct {
		name string
		a, b []LineRange
		want []LineRange
	}{
		{"empty a", nil, []LineRange{{1, 5}}, nil},
		{"empty b", []LineRange{{1, 5}}, nil, []LineRange{{1, 5}}},
		{"disjoint b leaves a untouched", []LineRange{{1, 5}}, []LineRange{{10, 12}}, []LineRange{{1, 5}}},
		{"b fully contains a", []LineRange{{3, 5}}, []LineRange{{1, 10}}, nil},
		{"a fully contains b: splits in two", []LineRange{{1, 10}}, []LineRange{{4, 6}}, []LineRange{{1, 3}, {7, 10}}},
		{"b removes a prefix", []LineRange{{1, 10}}, []LineRange{{1, 4}}, []LineRange{{5, 10}}},
		{"b removes a suffix", []LineRange{{1, 10}}, []LineRange{{7, 10}}, []LineRange{{1, 6}}},
		{"b touches a's start exactly", []LineRange{{5, 10}}, []LineRange{{1, 5}}, []LineRange{{6, 10}}},
		{
			"multiple b ranges carve up one a range",
			[]LineRange{{1, 20}},
			[]LineRange{{3, 5}, {10, 12}},
			[]LineRange{{1, 2}, {6, 9}, {13, 20}},
		},
		{
			"b spans across two a ranges",
			[]LineRange{{1, 5}, {10, 15}},
			[]LineRange{{4, 12}},
			[]LineRange{{1, 3}, {13, 15}},
		},
		{"unnormalized b input still works", []LineRange{{1, 10}}, []LineRange{{7, 10}, {4, 6}}, []LineRange{{1, 3}}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := Subtract(tc.a, tc.b)
			if !reflect.DeepEqual(got, tc.want) {
				t.Errorf("Subtract(%v, %v) = %v, want %v", tc.a, tc.b, got, tc.want)
			}
		})
	}
}

func TestExpand(t *testing.T) {
	cases := []struct {
		name      string
		lineCount int
		want      []LineRange
	}{
		{"zero", 0, nil},
		{"negative", -1, nil},
		{"positive", 42, []LineRange{{1, 42}}},
		{"single line", 1, []LineRange{{1, 1}}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := Expand(tc.lineCount)
			if !reflect.DeepEqual(got, tc.want) {
				t.Errorf("Expand(%d) = %v, want %v", tc.lineCount, got, tc.want)
			}
		})
	}
}

func TestCountLines(t *testing.T) {
	cases := []struct {
		name string
		in   []LineRange
		want int
	}{
		{"empty", nil, 0},
		{"single", []LineRange{{1, 10}}, 10},
		{"overlapping counted once", []LineRange{{1, 10}, {5, 15}}, 15},
		{"disjoint summed", []LineRange{{1, 3}, {10, 12}}, 6},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := CountLines(tc.in); got != tc.want {
				t.Errorf("CountLines(%v) = %d, want %d", tc.in, got, tc.want)
			}
		})
	}
}
