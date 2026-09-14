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
