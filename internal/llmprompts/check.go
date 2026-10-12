package llmprompts

import (
	"fmt"
	"slices"

	"github.com/kirathecat/kira-studio/packages/theme/src/i18n"
)

// init verifies the registry is consistent; a violation is a programming error and panics.
func init() {
	seen := map[ID]bool{}
	for _, e := range registry {
		if seen[e.ID] {
			bad(e, "duplicate id")
		}
		seen[e.ID] = true
		if len(e.Apps) == 0 || e.Applies == "" || e.Default == "" || e.Kind == "" {
			bad(e, "apps, applies, kind and default are required")
		}
		checkKeys(e)
		checkParent(e)
		for _, f := range e.RequiredFragments {
			if _, ok := byID[f]; !ok {
				bad(e, "unknown required fragment "+string(f))
			}
			if !slices.Contains(directIncludes(e.Default), f) {
				bad(e, "default does not include required fragment "+string(f))
			}
		}
		if ps := validateText(e.ID, e.Default, defaultText); len(ps) > 0 {
			bad(e, "default is invalid: "+ps[0].Message)
		}
	}
}

func checkKeys(e *entry) {
	keyed := e.Kind != KindTool && e.Kind != KindArgument
	keys := []string{e.TitleKey, e.PurposeKey, e.UsedByKey}
	for _, k := range keys {
		if (k != "") != keyed {
			bad(e, "catalog keys belong to non-tool, non-argument entries only")
		}
		if k != "" {
			i18n.T(k, nil)
		}
	}
	if !keyed && e.Name == "" {
		bad(e, "tool and argument entries need a name")
	}
}

func checkParent(e *entry) {
	if e.Kind != KindArgument {
		if e.Parent != "" || e.Field != "" {
			bad(e, "only an argument has a parent")
		}
		return
	}
	p, ok := byID[e.Parent]
	if !ok || p.Kind != KindTool || e.Field == "" || !slices.Equal(p.Apps, e.Apps) || p.Applies != e.Applies {
		bad(e, "argument needs a tool parent with the same apps and applies")
	}
	if e.ID != ID(string(e.Parent)+".arg."+e.Field) {
		bad(e, "argument id must be parent.arg.field")
	}
}

func bad(e *entry, msg string) { panic(fmt.Sprintf("llmprompts: %s: %s", e.ID, msg)) }
