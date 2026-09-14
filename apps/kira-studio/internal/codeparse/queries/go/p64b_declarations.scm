; P64b-authored (docs/v1.6/plans/P64b-repo-map-go-and-javascript-constants.md §2.2) — not vendored.
; The vendored tree-sitter-go tags.scm captures a package-level const/var name with no @definition
; wrapper, so extract.go produces no row for either; and its var pattern cannot match a
; parenthesized `var ( … )` block at all, whose specs sit under a var_spec_list rather than
; directly under var_declaration.

; Package-level `const`. Anchored at source_file so a function-local const never becomes a symbol.
; @definition.constant sits on the const_spec, not the const_declaration, so each name in a
; `const ( … )` block gets its own span — the same choice the vendored file already makes for
; type_spec rather than type_declaration. A valueless spec (an iota block's 2nd and later names)
; still has a `name` field, so it is captured by the same pattern.
(source_file
  (const_declaration
    (const_spec
      name: (identifier) @name) @definition.constant))

; Package-level `var`, single-spec form.
(source_file
  (var_declaration
    (var_spec
      name: (identifier) @name) @definition.variable))

; Package-level `var ( … )`, whose specs sit one level deeper.
(source_file
  (var_declaration
    (var_spec_list
      (var_spec
        name: (identifier) @name) @definition.variable)))
