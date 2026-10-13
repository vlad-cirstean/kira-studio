package importer

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/kirathecat/kira-studio/internal/memory"
	"github.com/kirathecat/kira-studio/internal/memory/memfmt"
)

// DocApplier stores a parsed kira-memory doc; *memory.Service is the real one.
type DocApplier interface {
	ApplyDoc(ctx context.Context, req memory.ApplyDocRequest) (memory.ApplyDocResult, error)
}

const maxDocProblems = 5

// isMemdoc reports whether a markdown or text file is a kira-memory doc: lines 1 and 2 are the
// fences the format requires.
func isMemdoc(kind, text string) bool {
	_, ok := parseMemdoc(kind, text)
	return ok
}

// parseMemdoc is isMemdoc plus the parsed doc, whose header provenance may be incomplete if the doc has problems.
func parseMemdoc(kind, text string) (memfmt.Doc, bool) {
	if kind != KindMarkdown && kind != KindText {
		return memfmt.Doc{}, false
	}
	doc, ok, _ := memfmt.ParseDoc([]byte(text))
	return doc, ok
}

// docError renders the first problems of a doc as one file reason.
func docError(ps []memfmt.Problem) string {
	var b strings.Builder
	for i, p := range ps {
		if i == maxDocProblems {
			fmt.Fprintf(&b, "; and %d more", len(ps)-maxDocProblems)
			break
		}
		if i > 0 {
			b.WriteString("; ")
		}
		fmt.Fprintf(&b, "line %d: %s", p.Line, p.Msg)
	}
	return b.String()
}

// finalizeDoc applies a memdoc file: parse, then store its facts as they are. No Claude call.
func (r *Runner) finalizeDoc(ctx context.Context, it finalItem) error {
	fail := func(msg string) error { return r.st.failFinalize(it, msg, usage{}) }
	if r.opts.Docs == nil {
		return fail("This runner cannot apply kira-memory docs.")
	}
	text, hash, skip, err := ReadText(it.Path, r.opts.Caps.MaxFileBytes)
	switch {
	case err != nil:
		return fail("Cannot read file: " + err.Error())
	case skip != "":
		return fail(skip)
	case hash != it.Hash:
		return fail("The file changed since it was read. Retry the file.")
	}
	doc, _, problems := memfmt.ParseDoc([]byte(text))
	if len(problems) > 0 {
		return fail(docError(problems))
	}
	res, err := r.opts.Docs.ApplyDoc(ctx, memory.ApplyDocRequest{Doc: doc, FileID: it.FileID})
	switch {
	case ctx.Err() != nil:
		return r.st.releaseFinalize(it, usage{})
	case err != nil && errors.Is(err, memory.ErrInvalid):
		return fail(strings.TrimPrefix(err.Error(), memory.ErrInvalid.Error()+": "))
	case err != nil:
		return fail(boundedMessage(err))
	}
	facts := map[string]string{}
	for _, f := range doc.Facts {
		facts[f.ID] = f.Fact
	}
	out := FinalizeOutput{GroupID: doc.Group, Orphaned: res.Orphaned,
		Prov: &Provenance{Origin: doc.Origin, SourceTag: doc.Source, Scope: doc.Scope, Project: doc.Project, Session: doc.Session}}
	for _, o := range res.Outcomes {
		if o.Action == memory.DocSkipped {
			out.Dropped = append(out.Dropped, DroppedFact{Fact: facts[o.ID], Why: o.Why})
		}
	}
	return r.st.finishFile(it, out, usage{})
}
