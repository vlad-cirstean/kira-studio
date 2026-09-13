; C2-authored (docs/v1.5/plans/C2-code-graph.md §2.3) — not vendored from upstream. JavaScript's
; own tags.scm has no pattern for `class X extends Y`; this recovers @reference.implementation for
; a class's superclass so implementationsOf has something to read for this language.

(class_heritage
  (identifier) @name) @reference.implementation
