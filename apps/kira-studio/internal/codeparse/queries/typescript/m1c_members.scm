; M1c-authored (docs/v1.7/plans/M1c-repomap-struct-field-fix.md §2.2) — not vendored.
; typescript/tags.scm captures method_signature and abstract_method_signature but no data member, so
; an interface property, a type-literal property and a class field are all invisible to
; search_symbols and unresolvable by find_references.

; `interface X { a: T }` and `type X = { a: T }` — property_signature is the node in both bodies.
(property_signature
  name: (property_identifier) @name) @definition.field

; `class X { a = 1 }` — TypeScript's own name for javascript's field_definition. A `#private` field
; is deliberately not matched: it is a private_property_identifier, and so is every `this.#a` that
; reads it, so the symbol would have no reachable reference.
(public_field_definition
  name: (property_identifier) @name) @definition.field
