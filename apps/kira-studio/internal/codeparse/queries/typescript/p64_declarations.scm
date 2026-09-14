; C2-authored (docs/v1.6/plans/P64-repo-map-type-aliases-and-read-symbol.md §2.2) — not vendored
; from upstream. The vendored tree-sitter-typescript tags.scm has no pattern for a type alias, an
; enum, or a plain (non-arrow-valued) module-level const; this recovers all three.

; Type aliases — `type X = …`, exported or not, anywhere in the tree.
(type_alias_declaration
  name: (type_identifier) @name) @definition.type

; Enums — `enum X { … }` / `const enum X { … }`.
(enum_declaration
  name: (identifier) @name) @definition.enum

; Module-level `const` bound to a non-function value. Anchored at `program` (and at an
; export_statement directly under it) so a local inside a function body never becomes a symbol.
; The value list enumerates non-function expression kinds rather than excluding function ones:
; tree-sitter queries cannot negate a child, and javascript/tags.scm's own @definition.constant
; pattern already enumerates its value types the same way.
(program
  (lexical_declaration
    kind: "const"
    (variable_declarator
      name: (identifier) @name
      value: [
        (call_expression) (object) (array) (string) (template_string) (number)
        (new_expression) (member_expression) (identifier) (binary_expression)
        (unary_expression) (as_expression) (satisfies_expression)
        (true) (false) (null) (undefined)
      ])) @definition.constant)

(program
  (export_statement
    declaration: (lexical_declaration
      kind: "const"
      (variable_declarator
        name: (identifier) @name
        value: [
          (call_expression) (object) (array) (string) (template_string) (number)
          (new_expression) (member_expression) (identifier) (binary_expression)
          (unary_expression) (as_expression) (satisfies_expression)
          (true) (false) (null) (undefined)
        ]))) @definition.constant)
