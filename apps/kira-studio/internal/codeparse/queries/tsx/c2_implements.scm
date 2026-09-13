; C2-authored (docs/v1.5/plans/C2-code-graph.md §2.3) — not vendored from upstream. Identical text
; to queries/typescript/c2_implements.scm: TSX shares TypeScript's node kinds and fields for
; implements_clause/extends_type_clause/extends_clause/generic_type (verified against tsx's own
; node-types.json), but is compiled against its own *sitter.Language, so it gets its own file.

(implements_clause
  (type_identifier) @name) @reference.implementation

(implements_clause
  (generic_type
    name: (type_identifier) @name)) @reference.implementation

(extends_type_clause
  type: (type_identifier) @name) @reference.implementation

(extends_clause
  value: (identifier) @name) @reference.implementation
