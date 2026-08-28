package repos

import (
	"database/sql"
	"fmt"
)

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

type FiltersRepo struct {
	DB *sql.DB
}

func (r *FiltersRepo) List(connectionID string) (TreeVisibility, error) {
	rows, err := r.DB.Query(
		`SELECT scope, value FROM connection_tree_filters WHERE connection_id = ?`, connectionID,
	)
	if err != nil {
		return TreeVisibility{}, fmt.Errorf("repos/filters: query: %w", err)
	}
	defer rows.Close()

	out := EmptyVisibility()
	for rows.Next() {
		var scope, value string
		if err := rows.Scan(&scope, &value); err != nil {
			return TreeVisibility{}, fmt.Errorf("repos/filters: scan: %w", err)
		}
		switch scope {
		case "kind":
			out.HiddenKinds = append(out.HiddenKinds, value)
		case "path":
			out.HiddenPaths = append(out.HiddenPaths, value)
		}
	}
	if err := rows.Err(); err != nil {
		return TreeVisibility{}, fmt.Errorf("repos/filters: rows: %w", err)
	}
	return out, nil
}
