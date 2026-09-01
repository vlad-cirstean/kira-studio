package kafka

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/twmb/franz-go/pkg/kadm"
	"github.com/twmb/franz-go/pkg/kgo"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/page"
)

const (
	pollTimeout   = 1 * time.Second // read.ts's POLL_TIMEOUT_MS, ported as a per-round bound (see readTopic)
	maxEmptyPolls = 2               // read.ts's MAX_EMPTY_POLLS
)

// partitionWindow is read.ts's PartitionWindow, with int64 offsets rather than decimal strings
// (P58e E6/E7 — Go's int64 has no JS-number-precision problem, so toNativeOffset's safe-integer
// guard has no equivalent here). Field names/tags match read.ts's own naming (partition/next/end)
// per P58e E17's diffability rule — this struct's own shape is the page token's payload.
type partitionWindow struct {
	Partition int32 `json:"partition"`
	Next      int64 `json:"next"`
	End       int64 `json:"end"` // frozen high watermark for this browse — never re-fetched mid-browse (P10 D6/D7)
}

// kafkaStreamFilter mirrors packages/shared/domain/streamFilter.ts's KafkaStreamFilter wire shape.
type kafkaStreamFilter struct {
	Offset      *string `json:"offset"`
	Partitions  []int32 `json:"partitions"`
	TimestampMs *int64  `json:"timestampMs"`
}

func parseStreamFilter(raw *string) (kafkaStreamFilter, error) {
	if raw == nil {
		return kafkaStreamFilter{}, nil
	}
	var f kafkaStreamFilter
	if err := json.Unmarshal([]byte(*raw), &f); err != nil {
		return kafkaStreamFilter{}, err
	}
	return f, nil
}

// readFingerprintParts is requestFingerprint({topic, pageSize, filter})'s Go shape (read.ts:205) —
// the fingerprint covers only these three, deliberately (P58e E7). Field names/tags/order must
// match kafka_test.go scenario 20's own reconstruction exactly, since RequestFingerprint hashes
// the marshalled JSON bytes.
type readFingerprintParts struct {
	Topic    string  `json:"topic"`
	PageSize int     `json:"pageSize"`
	Filter   *string `json:"filter"`
}

// headersToPlain is read.ts's headersToPlain, folded onto franz-go's flat, ordered
// []RecordHeader ({Key string; Value []byte}) — closer to librdkafka's own [{k:v}] array than to
// kafkajs's Record, so the repeated-key promotion (a second occurrence of a header name becomes a
// []string) ports unchanged in intent (P58e E8). Each value passes through strings.ToValidUTF8:
// raw broker bytes carry no encoding guarantee, unlike Node's Buffer.toString('utf8'), which
// replaces invalid sequences invisibly.
func headersToPlain(headers []kgo.RecordHeader) map[string]any {
	out := map[string]any{}
	for _, h := range headers {
		value := strings.ToValidUTF8(string(h.Value), "�")
		switch existing := out[h.Key].(type) {
		case nil:
			out[h.Key] = value
		case string:
			out[h.Key] = []string{existing, value}
		case []string:
			out[h.Key] = append(existing, value)
		}
	}
	return out
}

// buildStreamRow is read.ts:281-291's row construction, with P58e E8 applied.
func buildStreamRow(rec *kgo.Record) (page.StreamRow, error) {
	var key *string
	if rec.Key != nil {
		k := strings.ToValidUTF8(string(rec.Key), "�")
		key = &k
	}
	headersJSON, err := json.Marshal(headersToPlain(rec.Headers))
	if err != nil {
		return page.StreamRow{}, err
	}
	// The number/string asymmetry ports verbatim (read.ts:288): partition is a JSON number,
	// offset a JSON string — kafka.spec.ts 7's own assertion, and a Go port that "tidies" offset
	// into a number would break a cell users read.
	attrsJSON, err := json.Marshal(map[string]any{
		"partition": rec.Partition,
		"offset":    strconv.FormatInt(rec.Offset, 10),
	})
	if err != nil {
		return page.StreamRow{}, err
	}
	var timestamp *string
	if !rec.Timestamp.IsZero() {
		// P58d D11's exact-three-fractional-digits format — never time.RFC3339Nano, which drops
		// trailing zeros.
		t := rec.Timestamp.UTC().Format("2006-01-02T15:04:05.000Z07:00")
		timestamp = &t
	}
	body := ""
	if rec.Value != nil {
		body = strings.ToValidUTF8(string(rec.Value), "�")
	}
	return page.StreamRow{Key: key, Headers: string(headersJSON), Attrs: string(attrsJSON), Timestamp: timestamp, Body: body}, nil
}

func position(windows []partitionWindow, hasMore bool, fingerprint string, pageSize int) page.PagePosition {
	var nextToken *string
	if hasMore {
		raw, err := json.Marshal(windows)
		if err != nil {
			panic(err) // partitionWindow is a plain struct of ints; cannot fail
		}
		token := adapters.EncodePageToken([]string{string(raw)}, fingerprint)
		nextToken = &token
	}
	return page.PagePosition{Offset: nil, PageSize: pageSize, HasMore: hasMore, NextToken: nextToken, PrevToken: nil, Strategy: "offsetWindow"}
}

// freshWindows is read.ts's freshWindows (:76-143), only ever consulted for a fresh browse — a
// token-continued page's windows were already resolved once, and re-applying the filter there
// would just be wrong once the user has paged partway through.
func freshWindows(ctx context.Context, adm *kadm.Client, topic string, rawFilter *string) ([]partitionWindow, error) {
	// P58e E12: a nonexistent topic surfaces inside ListedOffsets' own per-partition Err, not as a
	// returned error — checking .Error() after each call is what turns it into E_QUERY instead of
	// a silently empty window set.
	starts, err := adm.ListStartOffsets(ctx, topic)
	if err != nil {
		return nil, mapError(err)
	}
	if err := starts.Error(); err != nil {
		return nil, mapError(err)
	}
	ends, err := adm.ListEndOffsets(ctx, topic)
	if err != nil {
		return nil, mapError(err)
	}
	if err := ends.Error(); err != nil {
		return nil, mapError(err)
	}
	if err := adapters.CheckCancelled(ctx); err != nil {
		return nil, err
	}

	filter, err := parseStreamFilter(rawFilter)
	if err != nil {
		return nil, adapters.New(adapters.CodeQuery, "malformed stream filter", err)
	}

	endsByPartition := ends[topic]
	startsByPartition := starts[topic]
	partitions := make([]int32, 0, len(endsByPartition))
	for p := range endsByPartition {
		partitions = append(partitions, p)
	}
	sort.Slice(partitions, func(i, j int) bool { return partitions[i] < partitions[j] })

	if len(filter.Partitions) > 0 {
		// "any of these partitions" — a union, not an intersection.
		wanted := make(map[int32]bool, len(filter.Partitions))
		for _, p := range filter.Partitions {
			wanted[p] = true
		}
		selected := make([]int32, 0, len(partitions))
		for _, p := range partitions {
			if wanted[p] {
				selected = append(selected, p)
			}
		}
		if len(selected) == 0 {
			names := make([]string, len(filter.Partitions))
			for i, p := range filter.Partitions {
				names[i] = strconv.FormatInt(int64(p), 10)
			}
			return nil, adapters.New(adapters.CodeQuery,
				fmt.Sprintf("topic %s has no partition(s) %s", topic, strings.Join(names, ", ")), nil)
		}
		partitions = selected
	}

	start := make(map[int32]int64, len(partitions))
	for _, p := range partitions {
		start[p] = startsByPartition[p].Offset
	}

	switch {
	case filter.TimestampMs != nil:
		// kadm's own doc: "if a partition has no offsets after the requested millisecond, the
		// offset will be the current end offset" — a different answer from librdkafka's -1
		// sentinel (KF-4(c)), re-baselined in scenario 19 rather than guessed.
		byTs, err := adm.ListOffsetsAfterMilli(ctx, *filter.TimestampMs, topic)
		if err != nil {
			return nil, mapError(err)
		}
		if err := byTs.Error(); err != nil {
			return nil, mapError(err)
		}
		if err := adapters.CheckCancelled(ctx); err != nil {
			return nil, err
		}
		for p, lo := range byTs[topic] {
			if _, ok := start[p]; ok {
				start[p] = lo.Offset
			}
		}
	case filter.Offset != nil:
		requested, err := strconv.ParseInt(*filter.Offset, 10, 64)
		if err != nil {
			return nil, adapters.New(adapters.CodeQuery,
				fmt.Sprintf("malformed offset filter: %q", *filter.Offset), nil)
		}
		for _, p := range partitions {
			lo := startsByPartition[p].Offset
			hi := endsByPartition[p].Offset
			clamped := requested
			if requested < lo {
				clamped = lo
			} else if requested > hi {
				clamped = hi
			}
			start[p] = clamped
		}
	}

	windows := make([]partitionWindow, len(partitions))
	for i, p := range partitions {
		windows[i] = partitionWindow{Partition: p, Next: start[p], End: endsByPartition[p].Offset}
	}
	return windows, nil
}

// advanceWindows applies P43 iter2 F19/D26's end-of-log clamp for one poll round (P58e E9, unit
// tested per P58e E26 in read_test.go). touched carries the HighWatermark this SAME round reported
// for every partition the fetch actually mentioned; pageCapped is whether this round's own
// delivery reached the caller's page budget. A partition is provably drained — its remaining
// [Next, End) gap can only ever be non-data offsets (a transaction's commit marker, a compacted
// offset, or one aged out by retention) that will never arrive as a record — when this round was
// not capped by the page budget (a capped round proves nothing; there may simply be more the
// caller didn't ask for yet), and the round's own reported watermark for that partition has
// reached or passed its frozen End. This is evaluated after every delivering round, never after a
// follow-up "peek" poll: KF-3 found that once a partition is genuinely exhausted, a subsequent
// poll blocks for the caller's entire remaining context with no partition metadata to peek at, so
// the clamp signal has to come from the fetch that actually delivered data.
func advanceWindows(windows []partitionWindow, touched map[int32]int64, pageCapped bool) {
	if pageCapped {
		return
	}
	for i := range windows {
		w := &windows[i]
		if w.Next >= w.End {
			continue
		}
		if hw, ok := touched[w.Partition]; ok && hw >= w.End {
			w.Next = w.End
		}
	}
}

// readTopic is read.ts's readTopic (:193-319). P58e E5: the browse client is a fresh, ephemeral
// kgo.Client per call, built from the adapter's own baseOpts plus kgo.ConsumePartitions at exact
// offsets — never kgo.ConsumeTopics or kgo.ConsumerGroup, which is what makes the no-group promise
// (P10 D6) structural rather than disciplinary. P58e E3: ctx goes straight to every kadm/kgo call;
// each poll additionally runs on its own bounded sub-context (see the loop below) because
// PollRecords, given nothing new to deliver, does not return on its own — it keeps retrying
// internally against FetchMaxWait until data arrives or its context ends (KF-3), so an unbounded
// per-round context would hang the whole op on a genuinely-exhausted-with-a-gap topic.
func readTopic(ctx context.Context, adm *kadm.Client, baseOpts []kgo.Opt, topic string, req adapters.ReadRequest, op *adapters.OpCtx) (page.StreamPage, error) {
	if err := adapters.CheckNotStarted(ctx); err != nil {
		return page.StreamPage{}, err
	}
	if req.Cursor.Mode == "before" {
		return page.StreamPage{}, adapters.New(adapters.CodeUnsupported,
			"kafka offset-window pagination is forward-only; there is no previous page", nil)
	}
	fingerprint := adapters.RequestFingerprint(readFingerprintParts{Topic: topic, PageSize: req.PageSize, Filter: req.Filter})

	var windows []partitionWindow
	if req.Cursor.Mode == "after" {
		keys, err := adapters.DecodePageToken(req.Cursor.Token, fingerprint)
		if err != nil {
			return page.StreamPage{}, err
		}
		if len(keys) != 1 {
			return page.StreamPage{}, adapters.New(adapters.CodeQuery, "malformed page token", nil)
		}
		if err := json.Unmarshal([]byte(keys[0]), &windows); err != nil {
			return page.StreamPage{}, adapters.New(adapters.CodeQuery, "malformed page token", err)
		}
	} else {
		w, err := freshWindows(ctx, adm, topic, req.Filter)
		if err != nil {
			return page.StreamPage{}, err
		}
		windows = w
	}

	var remaining []partitionWindow
	for _, w := range windows {
		if w.Next < w.End {
			remaining = append(remaining, w)
		}
	}
	if len(remaining) == 0 {
		// No client is ever constructed (read.ts:212-215).
		builder := page.NewStreamPageBuilder(nil)
		return builder.Finish(position(windows, false, fingerprint, req.PageSize)), nil
	}
	if err := adapters.CheckCancelled(ctx); err != nil {
		return page.StreamPage{}, err
	}

	op.SetCommand(fmt.Sprintf("browse %s (%d partition(s) of %d)", topic, len(remaining), len(windows)))

	partitionOffsets := make(map[int32]kgo.Offset, len(remaining))
	for _, w := range remaining {
		partitionOffsets[w.Partition] = kgo.NewOffset().At(w.Next)
	}
	browseOpts := append(append([]kgo.Opt{}, baseOpts...),
		kgo.ConsumePartitions(map[string]map[int32]kgo.Offset{topic: partitionOffsets}),
		kgo.FetchMaxWait(pollTimeout))
	browse, err := kgo.NewClient(browseOpts...)
	if err != nil {
		return page.StreamPage{}, mapError(err)
	}
	defer browse.Close()

	cursor := make(map[int32]*partitionWindow, len(windows))
	for i := range windows {
		cursor[windows[i].Partition] = &windows[i]
	}

	allDone := func() bool {
		for _, w := range cursor {
			if w.Next < w.End {
				return false
			}
		}
		return true
	}

	builder := page.NewStreamPageBuilder(nil)
	collected := 0
	emptyPolls := 0

	for collected < req.PageSize && !allDone() {
		if err := adapters.CheckCancelled(ctx); err != nil {
			return page.StreamPage{}, err
		}

		// A per-round bound, not the raw op ctx — see the func comment. Mirrors read.ts's own
		// consumer.setDefaultConsumeTimeout(POLL_TIMEOUT_MS).
		roundCtx, cancel := context.WithTimeout(ctx, pollTimeout)
		fetches := browse.PollRecords(roundCtx, req.PageSize-collected)
		cancel()

		if err := fetches.Err(); err != nil {
			if ctx.Err() != nil {
				// The op's own context is what ended this, not the round's bound (P58e E3).
				return page.StreamPage{}, adapters.New(adapters.CodeCancelled, "operation was cancelled", ctx.Err())
			}
			if errors.Is(err, kgo.ErrClientClosed) {
				break // the browse client's own teardown racing this poll — loop end, not an error
			}
			if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
				// Just this round's own bound expiring with genuinely nothing to report (KF-3) —
				// indistinguishable from a slow broker, so it counts toward MAX_EMPTY_POLLS rather
				// than failing the op.
				emptyPolls++
				if emptyPolls >= maxEmptyPolls {
					break
				}
				continue
			}
			return page.StreamPage{}, mapError(err)
		}

		touched := make(map[int32]int64)
		fetches.EachPartition(func(fp kgo.FetchTopicPartition) {
			touched[fp.Partition] = fp.HighWatermark
		})

		if fetches.NumRecords() == 0 {
			emptyPolls++
		} else {
			emptyPolls = 0
			for _, rec := range fetches.Records() {
				if collected >= req.PageSize {
					break
				}
				w, ok := cursor[rec.Partition]
				if !ok || rec.Offset < w.Next || rec.Offset >= w.End {
					continue
				}
				row, err := buildStreamRow(rec)
				if err != nil {
					return page.StreamPage{}, mapError(err)
				}
				builder.Push(row)
				collected++
				w.Next = rec.Offset + 1
			}
		}

		advanceWindows(windows, touched, collected >= req.PageSize)

		if fetches.NumRecords() == 0 && emptyPolls >= maxEmptyPolls {
			break
		}
	}

	if err := adapters.CheckCancelled(ctx); err != nil {
		return page.StreamPage{}, err
	}

	hasMore := false
	for _, w := range windows {
		if w.Next < w.End {
			hasMore = true
			break
		}
	}
	return builder.Finish(position(windows, hasMore, fingerprint, req.PageSize)), nil
}

// countTopic is read.ts's countTopic (:323-337): exact via high/low watermark subtraction, summed
// across every partition. Go's int64 removes the Number(BigInt(high)-BigInt(low)) narrowing the
// TypeScript had to accept.
func countTopic(ctx context.Context, adm *kadm.Client, topic string) (adapters.CountResult, error) {
	if err := adapters.CheckNotStarted(ctx); err != nil {
		return adapters.CountResult{}, err
	}
	starts, err := adm.ListStartOffsets(ctx, topic)
	if err != nil {
		return adapters.CountResult{}, mapError(err)
	}
	if err := starts.Error(); err != nil {
		return adapters.CountResult{}, mapError(err)
	}
	ends, err := adm.ListEndOffsets(ctx, topic)
	if err != nil {
		return adapters.CountResult{}, mapError(err)
	}
	if err := ends.Error(); err != nil {
		return adapters.CountResult{}, mapError(err)
	}
	if err := adapters.CheckCancelled(ctx); err != nil {
		return adapters.CountResult{}, err
	}

	startsByPartition := starts[topic]
	var total int64
	for p, hi := range ends[topic] {
		total += hi.Offset - startsByPartition[p].Offset
	}
	return adapters.CountResult{Value: total, Exact: true}, nil
}
