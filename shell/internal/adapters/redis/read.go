package redis

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"

	goredis "github.com/redis/go-redis/v9"

	"github.com/kirathecat/kira-studio/shell/internal/adapters"
	"github.com/kirathecat/kira-studio/shell/internal/page"
	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
)

// Never an unbudgeted SCAN (ground rules) — same per-round-trip COUNT hint as catalog.go.
const readScanCount = 1000

var knownTypes = map[string]bool{"string": true, "hash": true, "list": true, "set": true, "zset": true, "stream": true}

type keyMeta struct {
	redisType   string // one of knownTypes, or "" if none applies (checked before use)
	ttlMs       *int64
	memoryBytes *int64
}

// readMeta ports read.ts's readMeta.
func readMeta(ctx context.Context, conn *goredis.Client, key string) (keyMeta, error) {
	rawType, err := conn.Type(ctx, key).Result()
	if err != nil {
		return keyMeta{}, mapError(err)
	}
	// A key gone at read time is an ordinary query-time condition (expired/deleted concurrently),
	// not a connection failure — E_QUERY, deliberately not E_NOT_FOUND (P9's D10).
	if rawType == "none" {
		return keyMeta{}, adapters.New(adapters.CodeQuery, "key no longer exists: "+key, nil)
	}
	if !knownTypes[rawType] {
		return keyMeta{}, adapters.New(adapters.CodeUnsupported, "unsupported redis type for "+key+": "+rawType, nil)
	}
	pttl, err := conn.PTTL(ctx, key).Result()
	if err != nil {
		return keyMeta{}, mapError(err)
	}
	var ttlMs *int64
	if ms := pttl.Milliseconds(); ms >= 0 {
		ttlMs = &ms
	}
	var memoryBytes *int64
	if usage, err := conn.MemoryUsage(ctx, key).Result(); err == nil {
		memoryBytes = &usage
	} // best-effort (§8.8)
	return keyMeta{redisType: rawType, ttlMs: ttlMs, memoryBytes: memoryBytes}, nil
}

func readString(ctx context.Context, conn *goredis.Client, key string, meta keyMeta) (page.KeyValuePage, error) {
	value, err := conn.Get(ctx, key).Result()
	if err != nil && !errors.Is(err, goredis.Nil) {
		return page.KeyValuePage{}, mapError(err)
	}
	builder := page.NewKeyValuePageBuilder("string", meta.ttlMs, meta.memoryBytes, false)
	if !errors.Is(err, goredis.Nil) {
		builder.Push("value", value)
	}
	return builder.Finish(page.UnpagedPosition(1)), nil
}

// scanRoundFn runs one SCAN-family round: cursor in, (elements, nextCursor) out. pairSize is 1
// (set) or 2 (hash/zset) — elements alternate field/value for pairSize 2.
type scanRoundFn func(ctx context.Context, cursor uint64) (elements []string, nextCursor uint64, err error)

// readScanFamily is read.ts's own shared cursor-loop body for hash/set/zset (§8.8's per-type
// renderers): accumulates whole SCAN rounds without slicing mid-round, so a round's remaining
// elements are never dropped — the page can overshoot req.pageSize by up to one round. An offset
// cursor on a cursor-paged key silently restarts the scan from 0 rather than seeking or erroring
// (redis 24, views/keyvalue/state.ts's D40 depends on this).
func readScanFamily(ctx context.Context, scanOnce scanRoundFn, pairSize int, redisType string, meta keyMeta, req readReq, fingerprint string) (page.KeyValuePage, error) {
	if req.Cursor.Mode == "before" {
		return page.KeyValuePage{}, adapters.New(adapters.CodeUnsupported,
			"redis cursor pagination is forward-only; there is no previous page", nil)
	}
	var cursor uint64
	if req.Cursor.Mode == "after" {
		keyValues, err := adapters.DecodePageToken(req.Cursor.Token, fingerprint)
		if err != nil {
			return page.KeyValuePage{}, err
		}
		if len(keyValues) != 1 {
			return page.KeyValuePage{}, adapters.New(adapters.CodeQuery, "malformed page token", nil)
		}
		parsed, err := strconv.ParseUint(keyValues[0], 10, 64)
		if err != nil {
			return page.KeyValuePage{}, adapters.New(adapters.CodeQuery, "malformed page token", nil)
		}
		cursor = parsed
	}

	builder := page.NewKeyValuePageBuilder(redisType, meta.ttlMs, meta.memoryBytes, false)
	rowCount := 0
	exhausted := false

	for {
		if err := adapters.CheckCancelled(ctx); err != nil {
			return page.KeyValuePage{}, err
		}
		elements, nextCursor, err := scanOnce(ctx, cursor)
		if err != nil {
			return page.KeyValuePage{}, mapError(err)
		}
		cursor = nextCursor
		for i := 0; i < len(elements); i += pairSize {
			if pairSize == 2 {
				builder.Push(elements[i], elements[i+1])
			} else {
				builder.Push(strconv.Itoa(rowCount), elements[i])
			}
			rowCount++
		}
		if cursor == 0 {
			exhausted = true
		}
		if rowCount >= req.PageSize || exhausted {
			break
		}
	}

	hasMore := !exhausted
	var nextToken *string
	if hasMore {
		token := adapters.EncodePageToken([]string{strconv.FormatUint(cursor, 10)}, fingerprint)
		nextToken = &token
	}
	position := page.PagePosition{
		Offset: nil, PageSize: req.PageSize, HasMore: hasMore,
		NextToken: nextToken, PrevToken: nil, Strategy: "cursor",
	}
	return builder.Finish(position), nil
}

func readHash(ctx context.Context, conn *goredis.Client, key string, meta keyMeta, req readReq, fingerprint string) (page.KeyValuePage, error) {
	return readScanFamily(ctx, func(ctx context.Context, cursor uint64) ([]string, uint64, error) {
		return conn.HScan(ctx, key, cursor, "", readScanCount).Result()
	}, 2, "hash", meta, req, fingerprint)
}

func readSet(ctx context.Context, conn *goredis.Client, key string, meta keyMeta, req readReq, fingerprint string) (page.KeyValuePage, error) {
	return readScanFamily(ctx, func(ctx context.Context, cursor uint64) ([]string, uint64, error) {
		return conn.SScan(ctx, key, cursor, "", readScanCount).Result()
	}, 1, "set", meta, req, fingerprint)
}

func readZSet(ctx context.Context, conn *goredis.Client, key string, meta keyMeta, req readReq, fingerprint string) (page.KeyValuePage, error) {
	return readScanFamily(ctx, func(ctx context.Context, cursor uint64) ([]string, uint64, error) {
		return conn.ZScan(ctx, key, cursor, "", readScanCount).Result()
	}, 2, "zset", meta, req, fingerprint)
}

// readList is read.ts's readList: offset-only, LRANGE offset..offset+pageSize-1 honouring the
// requested page size in full (P43 iter2 D25/F18 — no LIST_WINDOW clamp).
func readList(ctx context.Context, conn *goredis.Client, key string, meta keyMeta, req readReq) (page.KeyValuePage, error) {
	if req.Cursor.Mode != "offset" {
		return page.KeyValuePage{}, adapters.New(adapters.CodeUnsupported, "redis list pagination only supports offset paging", nil)
	}
	offset := req.Cursor.Offset
	elements, err := conn.LRange(ctx, key, int64(offset), int64(offset+req.PageSize-1)).Result()
	if err != nil {
		return page.KeyValuePage{}, mapError(err)
	}
	if err := adapters.CheckCancelled(ctx); err != nil {
		return page.KeyValuePage{}, err
	}
	total, err := conn.LLen(ctx, key).Result()
	if err != nil {
		return page.KeyValuePage{}, mapError(err)
	}

	builder := page.NewKeyValuePageBuilder("list", meta.ttlMs, meta.memoryBytes, false)
	for i, value := range elements {
		builder.Push(strconv.Itoa(offset+i), value)
	}

	hasMore := int64(offset+len(elements)) < total
	off := offset
	position := page.PagePosition{
		Offset: &off, PageSize: req.PageSize, HasMore: hasMore,
		NextToken: nil, PrevToken: nil, Strategy: "offset",
	}
	return builder.Finish(position), nil
}

// readStream is read.ts's readStream: XRANGE key <start> + COUNT pageSize+1.
func readStream(ctx context.Context, conn *goredis.Client, key string, meta keyMeta, req readReq, fingerprint string) (page.KeyValuePage, error) {
	if req.Cursor.Mode == "before" {
		return page.KeyValuePage{}, adapters.New(adapters.CodeUnsupported,
			"redis stream pagination is forward-only; there is no previous page", nil)
	}
	startID := "-"
	if req.Cursor.Mode == "after" {
		keyValues, err := adapters.DecodePageToken(req.Cursor.Token, fingerprint)
		if err != nil {
			return page.KeyValuePage{}, err
		}
		if len(keyValues) != 1 {
			return page.KeyValuePage{}, adapters.New(adapters.CodeQuery, "malformed page token", nil)
		}
		startID = "(" + keyValues[0] // exclusive lower bound, per XRANGE syntax
	}

	limit := req.PageSize + 1 // D24's +1 probe, mirroring the SQL adapters
	entries, err := conn.XRangeN(ctx, key, startID, "+", int64(limit)).Result()
	if err != nil {
		return page.KeyValuePage{}, mapError(err)
	}
	if err := adapters.CheckCancelled(ctx); err != nil {
		return page.KeyValuePage{}, err
	}

	probedExtra := len(entries) > req.PageSize
	kept := entries
	if probedExtra {
		kept = entries[:req.PageSize]
	}

	builder := page.NewKeyValuePageBuilder("stream", meta.ttlMs, meta.memoryBytes, false)
	for _, entry := range kept {
		pairs := make(map[string]string, len(entry.Values))
		for field, value := range entry.Values {
			if s, ok := value.(string); ok {
				pairs[field] = s
			}
		}
		body, err := json.Marshal(pairs)
		if err != nil {
			return page.KeyValuePage{}, err
		}
		builder.Push(entry.ID, string(body))
	}

	hasMore := probedExtra
	var nextToken *string
	if hasMore {
		token := adapters.EncodePageToken([]string{kept[len(kept)-1].ID}, fingerprint)
		nextToken = &token
	}
	position := page.PagePosition{
		Offset: nil, PageSize: req.PageSize, HasMore: hasMore,
		NextToken: nextToken, PrevToken: nil, Strategy: "cursor",
	}
	return builder.Finish(position), nil
}

// readReq is the field subset of adapters.ReadRequest readKey needs, minus Path.
type readReq struct {
	PageSize int
	Cursor   model.PageCursor
}

// readKey is read.ts's readKey (D6): per-type dispatch after TYPE + PTTL + best-effort MEMORY
// USAGE classification.
func readKey(ctx context.Context, conn *goredis.Client, key string, req readReq, op *adapters.OpCtx) (page.KeyValuePage, error) {
	meta, err := readMeta(ctx, conn, key)
	if err != nil {
		return page.KeyValuePage{}, err
	}
	op.SetCommand("TYPE " + key)
	fingerprint := adapters.RequestFingerprint(struct {
		Key       string `json:"key"`
		PageSize  int    `json:"pageSize"`
		RedisType string `json:"redisType"`
	}{key, req.PageSize, meta.redisType})

	switch meta.redisType {
	case "string":
		return readString(ctx, conn, key, meta)
	case "hash":
		return readHash(ctx, conn, key, meta, req, fingerprint)
	case "set":
		return readSet(ctx, conn, key, meta, req, fingerprint)
	case "zset":
		return readZSet(ctx, conn, key, meta, req, fingerprint)
	case "list":
		return readList(ctx, conn, key, meta, req)
	case "stream":
		return readStream(ctx, conn, key, meta, req, fingerprint)
	default:
		return page.KeyValuePage{}, adapters.New(adapters.CodeUnsupported, "unsupported redis type for "+key+": "+meta.redisType, nil)
	}
}

// countKey is read.ts's countKey (D6): exact via O(1) type-length commands.
func countKey(ctx context.Context, conn *goredis.Client, key string) (adapters.CountResult, error) {
	rawType, err := conn.Type(ctx, key).Result()
	if err != nil {
		return adapters.CountResult{}, mapError(err)
	}
	if rawType == "none" {
		return adapters.CountResult{}, adapters.New(adapters.CodeQuery, "key no longer exists: "+key, nil)
	}
	if err := adapters.CheckCancelled(ctx); err != nil {
		return adapters.CountResult{}, err
	}

	var value int64
	switch rawType {
	case "string":
		value = 1
	case "hash":
		value, err = conn.HLen(ctx, key).Result()
	case "set":
		value, err = conn.SCard(ctx, key).Result()
	case "zset":
		value, err = conn.ZCard(ctx, key).Result()
	case "list":
		value, err = conn.LLen(ctx, key).Result()
	case "stream":
		value, err = conn.XLen(ctx, key).Result()
	default:
		return adapters.CountResult{}, adapters.New(adapters.CodeUnsupported, "unsupported redis type for "+key+": "+rawType, nil)
	}
	if err != nil {
		return adapters.CountResult{}, mapError(err)
	}
	return adapters.CountResult{Value: value, Exact: true}, nil
}
