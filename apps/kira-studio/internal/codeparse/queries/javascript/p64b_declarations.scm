; P64b-authored (docs/v1.6/plans/P64b-repo-map-go-and-javascript-constants.md §2.5) — not vendored
; from upstream. javascript/tags.scm captures an arrow/function-valued const as @definition.function
; (correct) and has one @definition.constant pattern for `export default (X = …)` only, which
; matches no ESM `export const X = …` and no bare module-level const. Same shape as P64's own
; typescript/p64_declarations.scm, minus (as_expression)/(satisfies_expression), which exist only
; in the TypeScript grammar — see that file's own value list, kept in step with this one.

; Module-level `const` bound to a non-function value. Anchored at `program` (and at an
; export_statement directly under it) so a local inside a function body never becomes a symbol.
; The value list enumerates non-function expression kinds rather than excluding function ones:
; tree-sitter queries cannot negate a child.
(program
  (lexical_declaration
    kind: "const"
    (variable_declarator
      name: (identifier) @name
      value: [
        (call_expression) (object) (array) (string) (template_string) (number)
        (new_expression) (member_expression) (identifier) (binary_expression)
        (unary_expression) (regex) (ternary_expression) (await_expression)
        (subscript_expression)
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
          (unary_expression) (regex) (ternary_expression) (await_expression)
          (subscript_expression)
          (true) (false) (null) (undefined)
        ]))) @definition.constant)
