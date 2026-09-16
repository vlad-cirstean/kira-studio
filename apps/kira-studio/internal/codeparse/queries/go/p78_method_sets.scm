; P78-authored (docs/v1.8/plans/P78-code-navigation.md §3.1) — not vendored. The vendored tags.scm
; captures a method's own name but nothing about its receiver, an interface's own method_elem
; children, or an embedded interface/struct field's type — so a type's method set can't be
; assembled from stored rows at all (§2.1/§2.2/§2.3).

; The receiver type of a method declaration. Labelled `receiver` rather than left to tags.scm's
; blanket (type_identifier) @reference.type so "every method on T" is one indexed read
; (internal/codegraph/methodsets.go's own methodSet).
(method_declaration
  receiver: (parameter_list
    (parameter_declaration
      type: [
        (type_identifier) @name
        (pointer_type (type_identifier) @name)
        (generic_type type: (type_identifier) @name)
        (pointer_type (generic_type type: (type_identifier) @name))
      ]))) @reference.receiver

; An interface's own method set. Parented to the interface by extract.go's range containment, the
; same way Java's vendored file already parents an interface method.
(interface_type
  (method_elem
    name: (field_identifier) @name) @definition.method)

; Embedded interface element — `type ReadWriter interface { Reader; Writer }`.
(interface_type
  (type_elem
    [ (type_identifier) @name
      (qualified_type name: (type_identifier) @name) ]) @reference.embed)

; Embedded struct field — `type Dog struct { Animal }`. `!name` is what distinguishes it from a
; named field; m1c_fields.scm's own pattern requires `name` and so never matches this.
(source_file
  (type_declaration
    (type_spec
      type: (struct_type
        (field_declaration_list
          (field_declaration
            !name
            type: [
              (type_identifier) @name
              (pointer_type (type_identifier) @name)
              (qualified_type name: (type_identifier) @name)
              (generic_type type: (type_identifier) @name)
            ]) @reference.embed)))))

; The same embedded field as a symbol — M1c's own documented gap (m1c_fields.scm:9-10). A separate
; pattern, not a second capture on the one above: extract.go's switch (extract.go:125-168) takes the
; @definition branch first, so one match can never produce both a symbol and a reference.
(source_file
  (type_declaration
    (type_spec
      type: (struct_type
        (field_declaration_list
          (field_declaration
            !name
            type: [
              (type_identifier) @name
              (pointer_type (type_identifier) @name)
              (qualified_type name: (type_identifier) @name)
              (generic_type type: (type_identifier) @name)
            ]) @definition.field)))))
