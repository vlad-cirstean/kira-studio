; C2-authored (docs/v1.5/plans/C2-code-graph.md §2.3) — not vendored from upstream. Python's own
; tags.scm has no pattern for a base class; this recovers @reference.implementation for a class's
; superclasses so implementationsOf has something to read for this language.

(class_definition
  superclasses: (argument_list
    (identifier) @name)) @reference.implementation
