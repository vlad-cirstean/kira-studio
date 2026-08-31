package kafka

import (
	"context"
	"sort"
	"strconv"
	"strings"

	"github.com/twmb/franz-go/pkg/kadm"

	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
)

// abbreviateCount mirrors @shared/format's abbreviateCount (every SQL adapter's own local copy —
// postgres/catalog.go's is the original) closely enough for the tree's own partition-count badge.
// No shared Go home exists for it yet (§4.2), and a partition count reaching four digits on a
// real cluster is possible, so a plain strconv.Itoa is not equivalent.
var abbreviateUnits = []struct {
	threshold int
	suffix    string
}{
	{1_000_000_000_000, "T"},
	{1_000_000_000, "B"},
	{1_000_000, "M"},
	{1_000, "K"},
}

func abbreviateCount(n int) string {
	sign := ""
	abs := n
	if abs < 0 {
		sign = "-"
		abs = -abs
	}
	for _, u := range abbreviateUnits {
		if abs < u.threshold {
			continue
		}
		scaled := float64(abs) / float64(u.threshold)
		var text string
		if scaled < 10 {
			text = trimTrailingZero(scaled)
		} else {
			text = strconv.Itoa(int(scaled + 0.5))
		}
		return sign + text + u.suffix
	}
	return sign + strconv.Itoa(abs)
}

func trimTrailingZero(f float64) string {
	s := strconv.FormatFloat(f, 'f', 1, 64)
	if len(s) >= 2 && s[len(s)-2:] == ".0" {
		return s[:len(s)-2]
	}
	return s
}

// isInternalGroup mirrors catalog.ts's isInternal — kept for groups only. kadm.ListedGroup has no
// internal flag the broker itself supplies, unlike a topic's own IsInternal (P58e E10).
func isInternalGroup(name string) bool {
	return strings.HasPrefix(name, "__")
}

// listRoot is catalog.ts's listRoot: topics ∪ consumer groups, root-level siblings — a consumer
// group can span many topics, or none of the ones currently browsed, so nesting it under one
// topic would misrepresent it.
func listRoot(ctx context.Context, adm *kadm.Client) ([]model.TreeNode, error) {
	topics, err := listTopics(ctx, adm)
	if err != nil {
		return nil, err
	}
	groups, err := listGroups(ctx, adm)
	if err != nil {
		return nil, err
	}
	return append(topics, groups...), nil
}

// listTopics is catalog.ts's listTopics. kadm.TopicDetail.IsInternal is the broker's own answer
// (P58e E10), replacing the TypeScript's name.startsWith('__') heuristic for topics.
func listTopics(ctx context.Context, adm *kadm.Client) ([]model.TreeNode, error) {
	meta, err := adm.Metadata(ctx)
	if err != nil {
		return nil, mapError(err)
	}
	meta.Topics.FilterInternal()
	nodes := make([]model.TreeNode, 0, len(meta.Topics))
	for _, t := range meta.Topics {
		count := len(t.Partitions)
		plural := "s"
		if count == 1 {
			plural = ""
		}
		detail := abbreviateCount(count) + " partition" + plural
		nodes = append(nodes, model.TreeNode{
			Kind: "topic", Name: t.Topic,
			Path:        model.EncodePath([]model.PathSegment{{Kind: "topic", Name: t.Topic}}),
			HasChildren: false, // P23 D3 — a topic's partitions moved into the definition view
			Detail:      &detail,
		})
	}
	sort.Slice(nodes, func(i, j int) bool { return nodes[i].Name < nodes[j].Name })
	return nodes, nil
}

func listGroups(ctx context.Context, adm *kadm.Client) ([]model.TreeNode, error) {
	groups, err := adm.ListGroups(ctx)
	if err != nil {
		return nil, mapError(err)
	}
	nodes := make([]model.TreeNode, 0, len(groups))
	for _, g := range groups {
		if isInternalGroup(g.Group) {
			continue
		}
		nodes = append(nodes, model.TreeNode{
			Kind: "consumerGroup", Name: g.Group,
			Path:        model.EncodePath([]model.PathSegment{{Kind: "consumerGroup", Name: g.Group}}),
			HasChildren: false,
		})
	}
	sort.Slice(nodes, func(i, j int) bool { return nodes[i].Name < nodes[j].Name })
	return nodes, nil
}

// listPartitions is catalog.ts's listPartitions. Still called even though the tree no longer
// expands a topic (P23 D4): StreamView.vue's partition filter popover is a second, live caller,
// re-fetched every time it opens.
func listPartitions(ctx context.Context, adm *kadm.Client, topic string) ([]model.TreeNode, error) {
	meta, err := adm.Metadata(ctx, topic)
	if err != nil {
		return nil, mapError(err)
	}
	detail, ok := meta.Topics[topic]
	if !ok || detail.Err != nil {
		return []model.TreeNode{}, nil
	}
	partitions := detail.Partitions.Sorted()
	nodes := make([]model.TreeNode, len(partitions))
	for i, p := range partitions {
		name := strconv.FormatInt(int64(p.Partition), 10)
		nodes[i] = model.TreeNode{
			Kind: "partition", Name: name,
			Path: model.EncodePath([]model.PathSegment{
				{Kind: "topic", Name: topic}, {Kind: "partition", Name: name},
			}),
			HasChildren: false,
		}
	}
	return nodes, nil
}
