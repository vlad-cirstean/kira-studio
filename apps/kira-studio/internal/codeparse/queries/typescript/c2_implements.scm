; C2-authored (docs/v1.5/plans/C2-code-graph.md §2.3) — not vendored from upstream. TypeScript's
; own tags.scm has no pattern for `implements`/`extends`; this recovers @reference.implementation
; for both so implementationsOf has something to read for this language.

(implements_clause
  (type_identifier) @name) @reference.implementation

(implements_clause
  (generic_type
    name: (type_identifier) @name)) @reference.implementation

(extends_type_clause
  type: (type_identifier) @name) @reference.implementation

(extends_clause
  value: (identifier) @name) @reference.implementation
