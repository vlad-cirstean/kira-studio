package githost

import (
	"fmt"
	"testing"
)

func TestNormalizeCapsKeepNewest(t *testing.T) {
	d := ChangeRequestDetail{}
	for i := 1; i <= DetailMaxComments+5; i++ {
		d.Threads = append(d.Threads, Thread{
			ID: fmt.Sprintf("c%03d", i), Kind: ThreadComment,
			Comments: []Comment{{ID: "x", CreatedAt: int64(i)}},
		})
	}
	d.Threads = append(d.Threads, Thread{ID: "r1", Kind: ThreadReview, Comments: []Comment{{CreatedAt: 3}}})
	var many []Comment
	for i := 1; i <= DetailMaxThreadComments+2; i++ {
		many = append(many, Comment{ID: fmt.Sprint(i), CreatedAt: int64(i), URL: "http://x"})
	}
	d.Threads = append(d.Threads, Thread{ID: "k", Kind: ThreadCode, Comments: many})
	d.Labels = []Label{{Name: "a", Color: "zzzzzz"}, {Name: "b", Color: "A1b2C3"}}
	d.Normalize()

	var comments int
	for _, th := range d.Threads {
		if th.Kind == ThreadComment {
			comments++
			if th.Comments[0].CreatedAt <= 5 {
				t.Errorf("oldest comment thread %s kept", th.ID)
			}
		}
	}
	if comments != DetailMaxComments || !d.ThreadsTruncated {
		t.Errorf("comments=%d truncated=%v", comments, d.ThreadsTruncated)
	}
	for i := 1; i < len(d.Threads); i++ {
		if firstCreated(d.Threads[i-1]) > firstCreated(d.Threads[i]) {
			t.Fatalf("threads not oldest first at %d", i)
		}
	}
	var code Thread
	for _, th := range d.Threads {
		if th.ID == "k" {
			code = th
		}
	}
	if len(code.Comments) != DetailMaxThreadComments || !code.CommentsTruncated || code.Comments[0].CreatedAt != 3 {
		t.Errorf("thread comments cap wrong: %d %v first=%d", len(code.Comments), code.CommentsTruncated, code.Comments[0].CreatedAt)
	}
	if code.Comments[0].URL != "" {
		t.Error("non-https comment URL kept")
	}
	if d.Labels[0].Color != "" || d.Labels[1].Color != "A1b2C3" {
		t.Errorf("label colours: %+v", d.Labels)
	}
	if d.Assignees == nil || d.Reviewers == nil || d.Checks == nil {
		t.Error("nil slices survive")
	}
}
