package dbmcp

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"github.com/google/uuid"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapterhost"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/queryplan"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

// approvalPlanIssuesCap bounds ApprovalPlan.Issues on the wire — a rolled-up plan can carry many,
// the dialog renders every one, and an uncapped list is the same unbounded-render hazard
// bridge/dbmcp.go's own capApprovalStatement already guards for the statement text (M3 §6.2).
const approvalPlanIssuesCap = 10

// approvalPlanFrom projects plan into the evidence the approval dialog shows: warn-severity
// issues first (the ones a decision actually turns on), capped at approvalPlanIssuesCap with
// IssuesOmitted carrying the remainder. nil in, nil out — an ordinary permission prompt with no
// plan attached (auto-force-explain off, or the statement was not explainable) carries no plan.
func approvalPlanFrom(plan *queryplan.Plan, thresholdRows int) *ApprovalPlan {
	if plan == nil {
		return nil
	}
	sorted := make([]queryplan.Issue, len(plan.Issues))
	copy(sorted, plan.Issues)
	sort.SliceStable(sorted, func(i, j int) bool {
		return sorted[i].Severity == "warn" && sorted[j].Severity != "warn"
	})
	omitted := 0
	if len(sorted) > approvalPlanIssuesCap {
		omitted = len(sorted) - approvalPlanIssuesCap
		sorted = sorted[:approvalPlanIssuesCap]
	}
	issues := make([]ApprovalPlanIssue, len(sorted))
	for i, iss := range sorted {
		issues[i] = ApprovalPlanIssue(iss)
	}
	return &ApprovalPlan{
		EstimatedRowsRead: plan.EstimatedRowsRead,
		ThresholdRows:     thresholdRows,
		OverThreshold:     plan.OverThreshold,
		Issues:            issues,
		IssuesOmitted:     omitted,
	}
}

// planSummary is what an AI client gets beside a run_query result, and what the approval dialog
// renders: the numbers a decision turns on, never the whole tree (that is explain_query's job).
type planSummary struct {
	EstimatedRowsRead *float64          `json:"estimatedRowsRead,omitempty"`
	ThresholdRows     int               `json:"thresholdRows"`
	OverThreshold     bool              `json:"overThreshold"`
	Issues            []queryplan.Issue `json:"issues"`
}

func summaryOf(plan *queryplan.Plan, thresholdRows int) *planSummary {
	if plan == nil {
		return nil
	}
	return &planSummary{
		EstimatedRowsRead: plan.EstimatedRowsRead,
		ThresholdRows:     thresholdRows,
		OverThreshold:     plan.OverThreshold,
		Issues:            plan.Issues,
	}
}

// maskPlanForMaskedConnection strips whatever an EXPLAIN plan can carry of real row data when the
// connection has active mask rules (F5): MySQL/MariaDB substitute real column values from a
// const-evaluated table into another table's own attached_condition (surfaced as Node.Detail), and
// ClickHouse's index metrics carry the same kind of evaluated condition text (Metric.Label ending
// " condition"). Column-name masking cannot see through either — they are plan prose, not a result
// set row — so both are blanked outright rather than filtered by column name. Raw is dropped
// unconditionally too, regardless of IncludeRaw: it is the server's own EXPLAIN text verbatim, the
// same data by construction.
func maskPlanForMaskedConnection(plan queryplan.Plan) queryplan.Plan {
	plan.Raw = ""
	plan.Root = maskPlanNode(plan.Root)
	return plan
}

func maskPlanNode(n queryplan.Node) queryplan.Node {
	n.Detail = ""
	if len(n.Metrics) > 0 {
		kept := make([]queryplan.Metric, 0, len(n.Metrics))
		for _, m := range n.Metrics {
			if strings.HasSuffix(m.Label, " condition") {
				continue
			}
			kept = append(kept, m)
		}
		n.Metrics = kept
	}
	if len(n.Children) > 0 {
		children := make([]queryplan.Node, len(n.Children))
		for i, c := range n.Children {
			children[i] = maskPlanNode(c)
		}
		n.Children = children
	}
	return n
}

// assertComposedStatementsAreReads is §8.3's checkable defense in depth: before executing a
// composed EXPLAIN batch, every statement statements.go composed is passed through
// Query.ClassifyStatement and must report ClassRead. This is the one property the whole "EXPLAIN
// never bypasses the permission gate" argument (§8) rests on — if a future dialect's EXPLAIN
// spelling ever classifies as anything but a read, it must not reach the server through this path.
// A non-read verdict (or a classification failure) is an internal refusal, not a caller error —
// the caller did nothing wrong; this app's own composer produced something it does not trust.
func (s *Server) assertComposedStatementsAreReads(ctx context.Context, connectionID string, statements []string) error {
	for _, stmt := range statements {
		class, err := s.cfg.Query.ClassifyStatement(ctx, connectionID, stmt)
		if err != nil {
			s.log.Warn("dbmcp: explain: classification of composed EXPLAIN failed", "connectionId", connectionID, "error", err)
			return fmt.Errorf("dbmcp: classify composed EXPLAIN statement: %w", err)
		}
		if class != adapters.ClassRead {
			s.log.Error("dbmcp: explain: composed EXPLAIN did not classify as a read", "connectionId", connectionID, "class", class, "statement", stmt)
			return fmt.Errorf("dbmcp: composed EXPLAIN statement classified as %s, not a read — refusing", class)
		}
	}
	return nil
}

// planFor composes, verifies and runs this connection's own EXPLAIN for sql, and parses the
// result. Returns (nil, nil) when this kind has no EXPLAIN this app can parse or sql is not
// explainable — a no-op, not a failure (auto-force-explain's own posture, M3 §5.1). Any other
// error (classification refusal, execute failure, parse failure) is returned for the caller to
// decide how to degrade — runQuery's own step 7 treats every error here as "no plan", never a
// reason to block the real query (§5.2's own D19 rule 6 posture); explainQuery instead surfaces it.
func (s *Server) planFor(ctx context.Context, summary model.ConnectionSummary, sql, path string) (*queryplan.Plan, error) {
	if !queryplan.Supported(summary.Kind) || !queryplan.Explainable(sql) {
		return nil, nil
	}

	statements := queryplan.StatementsFor(summary.Kind, sql)
	if err := s.assertComposedStatementsAreReads(ctx, summary.ID, statements); err != nil {
		return nil, err
	}

	resp, err := s.cfg.Query.Execute(ctx, adapterhost.ExecuteRequestWire{
		OpID: uuid.NewString(), ConnectionID: summary.ID, Path: path, Statements: statements,
	})
	if err != nil {
		return nil, err
	}

	plan, err := queryplan.FromPages(summary.Kind, resp.Pages, s.cfg.ExplainThreshold())
	if err != nil {
		return nil, err
	}
	return &plan, nil
}
