package llmprompts

import (
	"fmt"
	"reflect"
	"slices"
	"strings"

	"github.com/google/jsonschema-go/jsonschema"
)

// InputSchema is the MCP input schema of tool's argument type T with each property described by
// its argument entry. A templated argument takes its vars from vars, keyed by field name. A
// property without an entry, or an entry without a property, panics: both are programming errors.
//
// A nested property of an array or object property is described by an entry whose field is
// "parent.child" (for example "items.fact"). Once a parent has any nested entry, every property of
// its item object needs one, under the same panic rule.
func InputSchema[T any](src Source, tool ID, vars map[string]any) *jsonschema.Schema {
	sch, err := jsonschema.For[T](nil)
	if err != nil {
		panic(fmt.Sprintf("llmprompts: schema of %s: %v", tool, err))
	}
	args := map[string]*entry{}
	nested := map[string]map[string]*entry{}
	for _, e := range registry {
		if e.Kind != KindArgument || e.Parent != tool {
			continue
		}
		if parent, child, ok := strings.Cut(e.Field, "."); ok {
			if nested[parent] == nil {
				nested[parent] = map[string]*entry{}
			}
			nested[parent][child] = e
			continue
		}
		args[e.Field] = e
	}
	for name, prop := range sch.Properties {
		e := args[name]
		if e == nil {
			panic(fmt.Sprintf("llmprompts: %s has property %q without an argument entry", tool, name))
		}
		prop.Description = renderArgument(src, e, vars[name])
		delete(args, name)
		if children := nested[name]; children != nil {
			describeNested(src, tool, name, itemSchema(prop), children, vars)
			delete(nested, name)
		}
	}
	for name := range args {
		panic(fmt.Sprintf("llmprompts: %s has argument entry %q without a property", tool, name))
	}
	for name := range nested {
		panic(fmt.Sprintf("llmprompts: %s has nested argument entries under %q without a property", tool, name))
	}
	return sch
}

// RequireNonEmpty sets minLength 1 (string) or minItems 1 (array) on each named top-level property.
// A name not in sch.Required, or not a string/array, panics: both are programming errors.
func RequireNonEmpty(sch *jsonschema.Schema, props ...string) *jsonschema.Schema {
	for _, name := range props {
		prop := sch.Properties[name]
		if prop == nil {
			panic(fmt.Sprintf("llmprompts: RequireNonEmpty: no property %q", name))
		}
		if !slices.Contains(sch.Required, name) {
			panic(fmt.Sprintf("llmprompts: RequireNonEmpty: property %q is not required", name))
		}
		// jsonschema-go types a slice ["null","array"]; null would skip minItems, so pin it to array.
		if prop.Type == "" && len(prop.Types) == 2 && slices.Contains(prop.Types, "null") && slices.Contains(prop.Types, "array") {
			prop.Type, prop.Types = "array", nil
		}
		switch prop.Type {
		case "string":
			prop.MinLength = jsonschema.Ptr(1)
		case "array":
			prop.MinItems = jsonschema.Ptr(1)
		default:
			panic(fmt.Sprintf("llmprompts: RequireNonEmpty: property %q has type %q %q, want string or array", name, prop.Type, prop.Types))
		}
	}
	return sch
}

// itemSchema is the object schema a nested entry describes: an array's item schema, else prop itself.
func itemSchema(prop *jsonschema.Schema) *jsonschema.Schema {
	if prop.Items != nil {
		return prop.Items
	}
	return prop
}

func describeNested(src Source, tool ID, parent string, obj *jsonschema.Schema, children map[string]*entry, vars map[string]any) {
	for name, prop := range obj.Properties {
		e := children[name]
		if e == nil {
			panic(fmt.Sprintf("llmprompts: %s has property %q.%q without an argument entry", tool, parent, name))
		}
		prop.Description = renderArgument(src, e, vars[parent+"."+name])
		delete(children, name)
	}
	for name := range children {
		panic(fmt.Sprintf("llmprompts: %s has argument entry %q.%q without a property", tool, parent, name))
	}
}

func renderArgument(src Source, e *entry, v any) string {
	if v == nil {
		v = reflect.New(e.varsType).Elem().Interface()
	}
	return Render(src, e.ID, v)
}
