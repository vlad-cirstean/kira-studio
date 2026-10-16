package ade

import (
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
)

func TestQueueCycle(t *testing.T) {
	br := func(id, name, base, queued string) model.AdeTaskBranch {
		return model.AdeTaskBranch{ID: id, CodeRepoID: "r", Name: name, Base: base, QueuedAfter: queued}
	}
	tests := []struct {
		name   string
		branch []model.AdeTaskBranch
		self   string
		after  string
		want   bool
	}{
		{"unrelated", []model.AdeTaskBranch{br("a", "fa", "", ""), br("b", "fb", "", "")}, "a", "b", false},
		{"queue chain back to self", []model.AdeTaskBranch{br("a", "fa", "", ""), br("b", "fb", "", "a")}, "a", "b", true},
		{"base chain back to self", []model.AdeTaskBranch{br("a", "fa", "fb", ""), br("b", "fb", "", "")}, "b", "a", true},
		{"queue link wins over base", []model.AdeTaskBranch{br("a", "fa", "", ""), br("b", "fb", "fa", "c"), br("c", "fc", "", "")}, "a", "b", false},
		{"base on another repo is not a parent", []model.AdeTaskBranch{br("a", "fa", "", ""), {ID: "b", CodeRepoID: "other", Name: "fb", Base: "fa"}}, "a", "b", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			byID := map[string]model.AdeTaskBranch{}
			for _, b := range tt.branch {
				byID[b.ID] = b
			}
			if got := queueCycle(byID, tt.self, byID[tt.after]); got != tt.want {
				t.Fatalf("queueCycle = %v, want %v", got, tt.want)
			}
		})
	}
}
