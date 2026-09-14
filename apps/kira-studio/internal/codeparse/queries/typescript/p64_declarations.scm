; C2-authored (docs/v1.6/plans/P64-repo-map-type-aliases-and-read-symbol.md §2.2) — not vendored
; from upstream. The vendored tree-sitter-typescript tags.scm has no pattern for a type alias, an
; enum, or a plain (non-arrow-valued) module-level const; this recovers all three.
;
; Value list widened by P64b (docs/v1.6/plans/P64b-repo-map-go-and-javascript-constants.md §2.7):
; the original list missed regex-, ternary- and await-valued consts (47 real ones in this repo).
; subscript_expression added too, to keep this list identical to tsx/p64_declarations.scm's and
; javascript/p64b_declarations.scm's own — it matches 0 here but can never hold a function literal,
; so it cannot produce a duplicate function/constant pair. parenthesized_expression was considered
; and excluded: it can wrap an arrow function and would create exactly that duplicate.

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
        (regex) (ternary_expression) (await_expression) (subscript_expression)
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
          (regex) (ternary_expression) (await_expression) (subscript_expression)
          (true) (false) (null) (undefined)
        ]))) @definition.constant)
