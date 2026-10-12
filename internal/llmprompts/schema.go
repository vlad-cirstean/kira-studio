package llmprompts

import (
	"fmt"
	"reflect"

	"github.com/google/jsonschema-go/jsonschema"
)

// InputSchema is the MCP input schema of tool's argument type T with each property described by
// its argument entry. A templated argument takes its vars from vars, keyed by field name. A
// property without an entry, or an entry without a property, panics: both are programming errors.
func InputSchema[T any](src Source, tool ID, vars map[string]any) *jsonschema.Schema {
	sch, err := jsonschema.For[T](nil)
	if err != nil {
		panic(fmt.Sprintf("llmprompts: schema of %s: %v", tool, err))
	}
	args := map[string]*entry{}
	for _, e := range registry {
		if e.Kind == KindArgument && e.Parent == tool {
			args[e.Field] = e
		}
	}
	for name, prop := range sch.Properties {
		e := args[name]
		if e == nil {
			panic(fmt.Sprintf("llmprompts: %s has property %q without an argument entry", tool, name))
		}
		prop.Description = renderArgument(src, e, vars[name])
		delete(args, name)
	}
	for name := range args {
		panic(fmt.Sprintf("llmprompts: %s has argument entry %q without a property", tool, name))
	}
	return sch
}

func renderArgument(src Source, e *entry, v any) string {
	if v == nil {
		v = reflect.New(e.varsType).Elem().Interface()
	}
	return Render(src, e.ID, v)
}
