package redis

import (
	"context"
	"regexp"
	"sort"
	"strconv"
	"strings"

	goredis "github.com/redis/go-redis/v9"

	"github.com/kirathecat/kira-studio/shell/internal/adapters"
	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
)

// Never an unbudgeted SCAN (ground rules): a fixed COUNT hint per round-trip, and a hard cap on
// how many rounds one children() call will run — a call degrades to "not everything shown yet
// under this prefix" rather than turning into a full-keyspace crawl.
const (
	scanCount     = 1000
	maxScanRounds = 200
)

var dbKeyspaceLineRE = regexp.MustCompile(`^db(\d+):keys=(\d+)`)
var dbNameRE = regexp.MustCompile(`^db(\d+)$`)

// abbreviateUnits/abbreviateCount mirror the SQL adapters' own copies (format.ts's UNITS) — a
// redis DB's key count is exactly the kind of unbounded number that made that fix necessary.
var abbreviateUnits = []struct {
	threshold int64
	suffix    string
}{
	{1_000_000_000_000, "T"},
	{1_000_000_000, "B"},
	{1_000_000, "M"},
	{1_000, "K"},
}

func abbreviateCount(n int64) string {
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
			text = strconv.FormatInt(int64(scaled+0.5), 10)
		}
		return sign + text + u.suffix
	}
	return sign + strconv.FormatInt(abs, 10)
}

func trimTrailingZero(f float64) string {
	s := strconv.FormatFloat(f, 'f', 1, 64)
	if len(s) >= 2 && s[len(s)-2:] == ".0" {
		return s[:len(s)-2]
	}
	return s
}

// listDatabases ports catalog.ts's listDatabases: INFO keyspace's db<N>:keys=<M> lines, sorted
// numerically — db10 must not sort before db2.
func listDatabases(ctx context.Context, primary *goredis.Client) ([]model.TreeNode, error) {
	info, err := primary.Info(ctx, "keyspace").Result()
	if err != nil {
		return nil, mapError(err)
	}
	var nodes []model.TreeNode
	indices := map[string]int{}
	for _, line := range strings.Split(info, "\n") {
		line = strings.TrimRight(line, "\r")
		m := dbKeyspaceLineRE.FindStringSubmatch(line)
		if m == nil {
			continue
		}
		index, _ := strconv.Atoi(m[1])
		keys, _ := strconv.ParseInt(m[2], 10, 64)
		name := "db" + m[1]
		plural := "s"
		if keys == 1 {
			plural = ""
		}
		detail := abbreviateCount(keys) + " key" + plural
		indices[name] = index
		nodes = append(nodes, model.TreeNode{
			Kind: "database", Name: name,
			Path: model.EncodePath([]model.PathSegment{{Kind: "database", Name: name}}),
			// P41 D5: a db index's key namespace is unbounded — the tree stops here; the space
			// itself is navigated in a Browse tab, reached via listNamespaceChildren below.
			HasChildren: false,
			Detail:      &detail,
		})
	}
	sort.Slice(nodes, func(i, j int) bool { return indices[nodes[i].Name] < indices[nodes[j].Name] })
	return nodes, nil
}

// dbIndexFromName ports catalog.ts's dbIndexFromName.
func dbIndexFromName(name string) (int, error) {
	m := dbNameRE.FindStringSubmatch(name)
	if m == nil {
		return 0, adapters.New(adapters.CodeNotFound, "not a redis database node: "+name, nil)
	}
	n, _ := strconv.Atoi(m[1])
	return n, nil
}

// listNamespaceChildren ports catalog.ts's listNamespaceChildren: the ':'-splitting SCAN walk.
// namespaceSegments is just the local segments collected while descending the tree, joined back
// into a scan prefix here, never reconstructed from a leaf.
func listNamespaceChildren(ctx context.Context, conn *goredis.Client, dbName string, namespaceSegments []string, op *adapters.OpCtx) (adapters.TreeChildren, error) {
	prefix := ""
	if len(namespaceSegments) > 0 {
		prefix = strings.Join(namespaceSegments, ":") + ":"
	}
	namespaceNodes := map[string]model.TreeNode{}
	var namespaceOrder []string
	keyNodes := map[string]model.TreeNode{}
	var keyOrder []string

	var cursor uint64
	rounds := 0
	for {
		if err := adapters.CheckCancelled(ctx); err != nil {
			return adapters.TreeChildren{}, err
		}
		keys, nextCursor, err := conn.Scan(ctx, cursor, prefix+"*", scanCount).Result()
		if err != nil {
			return adapters.TreeChildren{}, mapError(err)
		}
		cursor = nextCursor
		for _, key := range keys {
			rest := key[len(prefix):]
			sep := strings.IndexByte(rest, ':')
			if sep < 0 {
				if _, seen := keyNodes[key]; !seen {
					keyOrder = append(keyOrder, key)
				}
				segments := make([]model.PathSegment, 0, len(namespaceSegments)+2)
				segments = append(segments, model.PathSegment{Kind: "database", Name: dbName})
				for _, s := range namespaceSegments {
					segments = append(segments, model.PathSegment{Kind: "namespace", Name: s})
				}
				segments = append(segments, model.PathSegment{Kind: "key", Name: key})
				keyNodes[key] = model.TreeNode{
					Kind: "key", Name: key, Path: model.EncodePath(segments), HasChildren: false,
				}
				continue
			}
			segment := rest[:sep]
			if _, seen := namespaceNodes[segment]; seen {
				continue
			}
			segments := make([]model.PathSegment, 0, len(namespaceSegments)+2)
			segments = append(segments, model.PathSegment{Kind: "database", Name: dbName})
			for _, s := range namespaceSegments {
				segments = append(segments, model.PathSegment{Kind: "namespace", Name: s})
			}
			segments = append(segments, model.PathSegment{Kind: "namespace", Name: segment})
			namespaceNodes[segment] = model.TreeNode{
				Kind: "namespace", Name: segment, Path: model.EncodePath(segments), HasChildren: true,
			}
			namespaceOrder = append(namespaceOrder, segment)
		}
		rounds++
		if cursor == 0 || rounds >= maxScanRounds {
			break
		}
	}

	sort.Strings(namespaceOrder)
	sort.Strings(keyOrder)
	nodes := make([]model.TreeNode, 0, len(namespaceOrder)+len(keyOrder))
	for _, name := range namespaceOrder {
		nodes = append(nodes, namespaceNodes[name])
	}
	for _, name := range keyOrder {
		nodes = append(nodes, keyNodes[name])
	}

	// P43 iter2 F16/D21: true only when the round cap cut the scan short (cursor != 0 means SCAN
	// itself says there is more) — never for an ordinary complete scan that happened to take fewer
	// rounds.
	if cursor != 0 && rounds >= maxScanRounds {
		truncated := true
		return adapters.TreeChildren{Nodes: nodes, Truncated: &truncated}, nil
	}
	return adapters.TreeChildren{Nodes: nodes}, nil
}
