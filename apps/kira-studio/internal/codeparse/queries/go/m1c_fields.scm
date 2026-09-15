; M1c-authored (docs/v1.7/plans/M1c-repomap-struct-field-fix.md §2.1) — not vendored.
; The vendored tree-sitter-go tags.scm has no field_declaration pattern, so a struct field is never
; a symbol, and it captures a selector_expression only in a call_expression's function position, so
; a plain `x.Field` read is never a reference. find_references and search_symbols therefore both
; answer nothing for a field reached only through a selector.

; Struct field declarations. Anchored at source_file through a named type_declaration, the same
; choice p64b_declarations.scm makes for const/var: a table test's anonymous
; `[]struct{ name string }{…}` and a function-local type never become symbols. An embedded field has
; no `name` field and is not matched.
(source_file
  (type_declaration
    (type_spec
      type: (struct_type
        (field_declaration_list
          (field_declaration
            name: (field_identifier) @name) @definition.field)))))

; `x.Field` — Field is used. @definition/@reference sits on the whole selector_expression with @name
; on the field_identifier, so the site's own name range is the field's and a cursor placed on it
; resolves. This also matches the selector inside `c.Greet()`, which tags.scm already captures as
; @reference.call at the identical name range; extract.go drops that duplicate (§2.6).
(selector_expression
  field: (field_identifier) @name) @reference.field
