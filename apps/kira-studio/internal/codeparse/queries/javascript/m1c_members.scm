; M1c-authored (docs/v1.7/plans/M1c-repomap-struct-field-fix.md §2.3) — not vendored.
; javascript/tags.scm captures method_definition but not field_definition. JavaScript only: the
; TypeScript grammar renames this node public_field_definition and names the field `name` rather
; than `property`, so one shared file cannot compile against both — typescript/m1c_members.scm
; carries the TS/TSX half. Same split p64b_declarations.scm already lives with.
(field_definition
  property: (property_identifier) @name) @definition.field
