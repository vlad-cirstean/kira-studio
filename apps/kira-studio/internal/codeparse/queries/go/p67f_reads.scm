; P67f-authored (docs/v1.6/plans/P67f-repo-map-sync-and-references.md §3.2) — not vendored.
; The vendored tree-sitter-go tags.scm captures a reference only in a call_expression's function
; position or as a type_identifier, so a value read — the only way a package-level allowlist map is
; ever used — produces no reference row at all and find_references answers "no references found".
; The capture sits on the identifier itself, the same shape the vendored file already uses for
; `(type_identifier) @name @reference.type`, so the reference's own range and its name range
; coincide and a cursor placed on the name resolves.

; `for k, v := range m` / `for range m` — m is read.
(range_clause
  right: (identifier) @name @reference.read)

; `m[k]` — m is read. A non-identifier operand (`a.b[k]`, `f()[k]`) is deliberately not captured:
; the name that would be recorded is not the operand's own.
(index_expression
  operand: (identifier) @name @reference.read)

; P69b (docs/v1.6/plans/P69b-repo-map-bare-identifier-reads.md §4.1) — the commonest read shape of
; all, a bare identifier passed as a call argument or used as a comparison/arithmetic operand.

; `f(x)` — x is read. argument_list has no field name; a non-identifier argument (a call, a
; selector, a composite literal) is not captured, same rule as the two patterns above.
(argument_list (identifier) @name @reference.read)

; `a < b`, `a + b` — both operands are read. Comparison and arithmetic share one node kind, so the
; operator is deliberately not constrained.
(binary_expression left: (identifier) @name @reference.read)
(binary_expression right: (identifier) @name @reference.read)

; `raw[:n]` — n is read. start/end/capacity only; `operand` is already covered by index_expression
; above for the non-slice form and is captured here for the slice form too.
(slice_expression start: (identifier) @name @reference.read)
(slice_expression end: (identifier) @name @reference.read)
(slice_expression capacity: (identifier) @name @reference.read)
(slice_expression operand: (identifier) @name @reference.read)
