; P67f-authored (docs/v1.6/plans/P67f-repo-map-sync-and-references.md §3.3) — not vendored.
; Same gap as queries/go/p67f_reads.scm, one language family over: javascript/tags.scm and
; typescript/tags.scm capture a reference only as a call, a constructor or a type, so a value read
; produces no reference row. Registered on JavaScript, TypeScript and TSX alike — unlike P64b's
; own javascript/p64b_declarations.scm, these patterns exist in no other file, so multi-registration
; duplicates nothing.

; `for (const m of xs)` and `for (const k in xs)` — xs is read either way, so the operator field is
; deliberately not constrained.
(for_in_statement
  right: (identifier) @name @reference.read)

; `xs[k]` — xs is read.
(subscript_expression
  object: (identifier) @name @reference.read)
