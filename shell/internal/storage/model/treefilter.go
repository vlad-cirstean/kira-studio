package model

// TreeVisibility mirrors src/shared/domain/tree-filter.ts's treeVisibilitySchema — a set of
// hidden node kinds and hidden paths, not a rule list (P28 D12).
type TreeVisibility struct {
	HiddenKinds []string `json:"hiddenKinds"`
	HiddenPaths []string `json:"hiddenPaths"`
}

// EmptyVisibility mirrors src/shared/domain/tree-filter.ts's EMPTY_VISIBILITY.
func EmptyVisibility() TreeVisibility {
	return TreeVisibility{HiddenKinds: []string{}, HiddenPaths: []string{}}
}
