; M1c-authored (docs/v1.7/plans/M1c-repomap-struct-field-fix.md §2.4) — not vendored.
; The same gap as queries/go/m1c_fields.scm one language family over: a member_expression is
; captured only in a call_expression's function position, so `obj.prop` as a value produces no
; reference row. Registered on JavaScript, TypeScript and TSX alike — and so on Vue/Svelte's own
; injected blocks — the same multi-registration javascript/p67f_reads.scm already uses, since
; member_expression and property_identifier are plain syntax all three grammars share.
; A member call matches this too, at the same name range as tags.scm's own @reference.call;
; extract.go drops the duplicate (§2.6).
(member_expression
  property: (property_identifier) @name) @reference.field
