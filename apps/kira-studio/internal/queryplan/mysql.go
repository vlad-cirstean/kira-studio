package queryplan

import (
	"encoding/json"
	"fmt"
)

// mysql.go ports planParsers/mysql.ts verbatim: MySQL's `EXPLAIN FORMAT=JSON` — one row, one
// column, a query_block whose real content sits under `table` (single-table), `nested_loop` (a
// join — same key MariaDB's own JSON uses, but a genuinely different schema underneath, F13), or a
// wrapping grouping_operation/ordering_operation/duplicates_removal block around either.

type mysqlRawTable struct {
	TableName                *string            `json:"table_name"`
	AccessType               *string            `json:"access_type"`
	PossibleKeys             []string           `json:"possible_keys"`
	Key                      *string            `json:"key"`
	RowsExaminedPerScan      *float64           `json:"rows_examined_per_scan"`
	AttachedCondition        *string            `json:"attached_condition"`
	UsingTemporaryTable      *bool              `json:"using_temporary_table"`
	UsingFilesort            *bool              `json:"using_filesort"`
	CostInfo                 json.RawMessage    `json:"cost_info"`
	MaterializedFromSubquery *mysqlMaterialized `json:"materialized_from_subquery"`
}

type mysqlMaterialized struct {
	UsingTemporaryTable *bool           `json:"using_temporary_table"`
	QueryBlock          json.RawMessage `json:"query_block"`
}

type mysqlRawBlock struct {
	CostInfo          *mysqlCostInfo   `json:"cost_info"`
	Table             json.RawMessage  `json:"table"`
	NestedLoop        []mysqlLoopEntry `json:"nested_loop"`
	GroupingOperation json.RawMessage  `json:"grouping_operation"`
	OrderingOperation json.RawMessage  `json:"ordering_operation"`
	DuplicatesRemoval json.RawMessage  `json:"duplicates_removal"`
}

type mysqlLoopEntry struct {
	Table json.RawMessage `json:"table"`
}

type mysqlCostInfo struct {
	QueryCost *string `json:"query_cost"`
}

var mysqlTableTypedKeys = map[string]bool{
	"table_name": true, "access_type": true, "possible_keys": true, "key": true,
	"rows_examined_per_scan": true, "attached_condition": true, "materialized_from_subquery": true,
	// cost_info is special-cased below (expanded into cost_info.<subkey> metrics), never emitted
	// as a single metric of its own.
	"cost_info": true,
}

func mysqlTableMetrics(rawMap map[string]json.RawMessage) []Metric {
	out := make([]Metric, 0, len(rawMap))
	for key, value := range rawMap {
		if key == "cost_info" {
			for subKey, subValue := range decodeRawObject(value) {
				out = append(out, Metric{Label: "cost_info." + subKey, Value: formatMetricValue(subValue)})
			}
			continue
		}
		if mysqlTableTypedKeys[key] {
			continue
		}
		out = append(out, Metric{Label: key, Value: formatMetricValue(value)})
	}
	return sortMetricsByLabel(out)
}

func mysqlTableLabel(table mysqlRawTable) string {
	name := "?"
	if table.TableName != nil {
		name = *table.TableName
	}
	if table.AccessType != nil && *table.AccessType == "ALL" {
		return fmt.Sprintf("Full scan on %s", name)
	}
	if table.AccessType != nil {
		return fmt.Sprintf("%s access on %s", *table.AccessType, name)
	}
	return name
}

func mysqlTableNode(raw json.RawMessage, thresholdRows int, scans *[]float64) Node {
	var table mysqlRawTable
	_ = json.Unmarshal(raw, &table)
	rawMap := decodeRawObject(raw)

	var cost *Cost
	if table.CostInfo != nil {
		var costInfo struct {
			PrefixCost *string `json:"prefix_cost"`
		}
		_ = json.Unmarshal(table.CostInfo, &costInfo)
		if costInfo.PrefixCost != nil {
			cost = &Cost{Total: parseFloatCell(*costInfo.PrefixCost)}
		}
	}

	node := Node{
		Label:         mysqlTableLabel(table),
		EstimatedRows: table.RowsExaminedPerScan,
		Cost:          cost,
		Metrics:       mysqlTableMetrics(rawMap),
		Issues:        []Issue{},
		Children:      []Node{},
	}
	if table.TableName != nil {
		node.Relation = *table.TableName
	}
	if table.AttachedCondition != nil {
		node.Detail = *table.AttachedCondition
	}

	relationOrPlaceholder := "?"
	if table.TableName != nil {
		relationOrPlaceholder = *table.TableName
	}

	// D15: full scan.
	if table.AccessType != nil && *table.AccessType == "ALL" {
		node.Issues = append(node.Issues, Issue{
			Severity: "warn", Code: "full-scan",
			Message: fmt.Sprintf("full table scan on %q — no index was used", relationOrPlaceholder),
		})
	}
	// D15: an index existed and was not chosen.
	if len(table.PossibleKeys) > 0 && table.Key == nil {
		node.Issues = append(node.Issues, Issue{
			Severity: "warn", Code: "unused-index",
			Message: fmt.Sprintf("%q has an index (%s) the planner did not choose", relationOrPlaceholder, joinStrings(table.PossibleKeys)),
		})
	}
	// D15: filesort, when the flag sits on the table itself rather than an ordering_operation
	// wrapper (both are real shapes).
	if table.UsingFilesort != nil && *table.UsingFilesort {
		node.Issues = append(node.Issues, Issue{
			Severity: "warn", Code: "filesort",
			Message: fmt.Sprintf("%q was sorted with a temporary file (filesort)", relationOrPlaceholder),
		})
	}
	// D15: a derived table materialized into a temp table.
	materializedTemp := table.MaterializedFromSubquery != nil && table.MaterializedFromSubquery.UsingTemporaryTable != nil && *table.MaterializedFromSubquery.UsingTemporaryTable
	if (table.UsingTemporaryTable != nil && *table.UsingTemporaryTable) || materializedTemp {
		node.Issues = append(node.Issues, Issue{
			Severity: "warn", Code: "temp-table",
			Message: fmt.Sprintf("%q was materialized into a temporary table", relationOrPlaceholder),
		})
	}

	if table.MaterializedFromSubquery != nil && table.MaterializedFromSubquery.QueryBlock != nil {
		node.Children = append(node.Children, mysqlBlockNodes(table.MaterializedFromSubquery.QueryBlock, thresholdRows, scans)...)
	}

	if table.RowsExaminedPerScan != nil {
		*scans = append(*scans, *table.RowsExaminedPerScan)
		pushWideScanIssue(&node, *table.RowsExaminedPerScan, thresholdRows)
	}
	return node
}

func mysqlWrap(label string, children []Node, issues []Issue) Node {
	if issues == nil {
		issues = []Issue{}
	}
	if children == nil {
		children = []Node{}
	}
	return Node{Label: label, Metrics: []Metric{}, Issues: issues, Children: children}
}

func joinStrings(ss []string) string {
	out := ""
	for i, s := range ss {
		if i > 0 {
			out += ", "
		}
		out += s
	}
	return out
}

func mysqlBlockNodes(raw json.RawMessage, thresholdRows int, scans *[]float64) []Node {
	if raw == nil {
		return []Node{}
	}
	var block mysqlRawBlock
	_ = json.Unmarshal(raw, &block)

	if block.OrderingOperation != nil {
		var op struct {
			UsingFilesort *bool `json:"using_filesort"`
		}
		_ = json.Unmarshal(block.OrderingOperation, &op)
		var issues []Issue
		if op.UsingFilesort != nil && *op.UsingFilesort {
			issues = []Issue{{Severity: "warn", Code: "filesort", Message: "a temporary sort file (filesort) was used"}}
		}
		return []Node{mysqlWrap("Sort", mysqlBlockNodes(block.OrderingOperation, thresholdRows, scans), issues)}
	}
	if block.GroupingOperation != nil {
		return []Node{mysqlWrap("Group by", mysqlBlockNodes(block.GroupingOperation, thresholdRows, scans), nil)}
	}
	if block.DuplicatesRemoval != nil {
		return []Node{mysqlWrap("Duplicates removal", mysqlBlockNodes(block.DuplicatesRemoval, thresholdRows, scans), nil)}
	}
	if block.NestedLoop != nil {
		children := make([]Node, 0, len(block.NestedLoop))
		for _, entry := range block.NestedLoop {
			if entry.Table != nil {
				children = append(children, mysqlTableNode(entry.Table, thresholdRows, scans))
			}
		}
		return []Node{mysqlWrap("Nested loop join", children, nil)}
	}
	if block.Table != nil {
		return []Node{mysqlTableNode(block.Table, thresholdRows, scans)}
	}
	return []Node{}
}

func parseMysqlPlan(rawText string, thresholdRows int) (Plan, error) {
	var parsed struct {
		QueryBlock json.RawMessage `json:"query_block"`
	}
	if err := json.Unmarshal([]byte(rawText), &parsed); err != nil {
		return Plan{}, fmt.Errorf("queryplan: parse mysql plan: %w", err)
	}

	var block mysqlRawBlock
	if parsed.QueryBlock != nil {
		_ = json.Unmarshal(parsed.QueryBlock, &block)
	}

	scans := make([]float64, 0)
	children := mysqlBlockNodes(parsed.QueryBlock, thresholdRows, &scans)

	var queryCost *float64
	if block.CostInfo != nil && block.CostInfo.QueryCost != nil {
		v := parseFloatCell(*block.CostInfo.QueryCost)
		queryCost = &v
	}
	var rootCost *Cost
	if queryCost != nil {
		rootCost = &Cost{Total: *queryCost}
	}
	root := Node{Label: "Query", Cost: rootCost, Metrics: []Metric{}, Issues: []Issue{}, Children: children}

	estimatedRowsRead := maxEstimatedRows(scans)
	var nativeCost *NativeCost
	if queryCost != nil {
		nativeCost = &NativeCost{Value: *queryCost, Unit: CostUnitMysqlCost}
	}
	return Plan{
		Kind: "mysql", Root: root, EstimatedRowsRead: estimatedRowsRead, NativeCost: nativeCost,
		Issues: rollupIssues(&root), OverThreshold: isOverThreshold(estimatedRowsRead, thresholdRows),
		Raw: rawText,
	}, nil
}
