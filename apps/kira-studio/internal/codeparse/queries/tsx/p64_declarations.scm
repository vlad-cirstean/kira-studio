; C2-authored (docs/v1.6/plans/P64-repo-map-type-aliases-and-read-symbol.md §2.2) — identical text
; to queries/typescript/p64_declarations.scm: TSX shares TypeScript's node kinds and fields for
; type_alias_declaration/enum_declaration/lexical_declaration/variable_declarator (verified against
; tsx's own node-types.json), but is compiled against its own *sitter.Language, so it gets its own
; file, same reason tsx/c2_implements.scm exists as its own file.
;
; Value list widened by P64b (docs/v1.6/plans/P64b-repo-map-go-and-javascript-constants.md §2.7) —
; see typescript/p64_declarations.scm's own header for why.

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
