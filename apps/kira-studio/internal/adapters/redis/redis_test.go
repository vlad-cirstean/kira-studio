// Ported from packages/db-fixtures/redis.spec.ts (§9.4), case by case where practical — the spec's own
// numbering is kept in each test's name so the two can be diffed. §5.4 of
// docs/v1/plans/P58c-mongo-redis.md names the cases that carry the most weight: hash/set/zset
// paging asserting "some rows, more to come" rather than an exact count where overshoot is
// possible, the offset-cursor-restarts-the-scan contract, a vanished key being E_QUERY not
// E_NOT_FOUND, truncated only when the round cap actually cut a scan short, children() of a key
// leaf marshalling as [] not null, and cancel being a permanent, honest no-op.
package redis_test

import (
	"context"
	"encoding/json"
	"os"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"

	goredis "github.com/redis/go-redis/v9"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters"
	_ "github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters/redis"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters/testsupport"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/page"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

func TestMain(m *testing.M) {
	code := m.Run()
	testsupport.StopRedis()
	os.Exit(code)
}

var (
	deps           = adapters.Deps{Log: func(level, message string) {}}
	regexpRedisVer = regexp.MustCompile(`^Redis 7`)
	seg            = testsupport.Seg
	childNames     = testsupport.ChildNames
	containsName   = testsupport.ContainsName
	kvPairs        = testsupport.KVPairs
	kvValueAt      = testsupport.KVValueAt
	kvFieldAt      = testsupport.KVFieldAt
)

func newAdapter(t *testing.T) adapters.Adapter {
	t.Helper()
	a, err := adapters.CreateAdapter("redis", deps)
	if err != nil {
		t.Fatalf("CreateAdapter: %v", err)
	}
	return a
}

func connectedAdapter(t *testing.T, fixture *testsupport.RedisFixture) adapters.Adapter {
	t.Helper()
	a := newAdapter(t)
	if _, err := a.Connect(context.Background(), fixture.Config, adapters.NewOpCtx("connect")); err != nil {
		t.Fatalf("Connect: %v", err)
	}
	t.Cleanup(func() { _ = a.Disconnect(context.Background()) })
	return a
}

func nodePath(fixture *testsupport.RedisFixture, segments ...model.PathSegment) model.NodePath {
	return testsupport.NodePath(fixture.Config.ID, segments...)
}

// 1. connect / disconnect
func TestRedis_ConnectDisconnect(t *testing.T) {
	fixture := testsupport.StartRedis(t)
	a := newAdapter(t)

	info, err := a.Connect(context.Background(), fixture.Config, adapters.NewOpCtx("op-1"))
	if err != nil {
		t.Fatalf("Connect: %v", err)
	}
	if !regexpRedisVer.MatchString(info.ServerVersion) {
		t.Errorf("ServerVersion = %q, want to start with \"Redis 7\"", info.ServerVersion)
	}
	if info.Details["database"] != "db0" {
		t.Errorf("Details[database] = %q, want db0", info.Details["database"])
	}
	if err := a.Disconnect(context.Background()); err != nil {
		t.Fatalf("Disconnect: %v", err)
	}
}

// 2 (re-baselined against the Go driver): wrong password is E_AUTH.
func TestRedis_Connect_WrongPasswordIsAuthError(t *testing.T) {
	fixture := testsupport.StartRedis(t)
	badCfg := fixture.Config
	badPassword := "not-the-password"
	badCfg.Password = &badPassword

	a := newAdapter(t)
	_, err := a.Connect(context.Background(), badCfg, adapters.NewOpCtx("op-2"))
	if err == nil {
		t.Fatal("want an error, got nil")
	}
	code, _ := adapters.CodeOf(err)
	if code != adapters.CodeAuth {
		t.Errorf("code = %v, want E_AUTH", code)
	}
}

// 3. tree: databases, numeric sort, and the exact root namespace/key listing.
func TestRedis_Children_Databases(t *testing.T) {
	fixture := testsupport.StartRedis(t)
	a := connectedAdapter(t, fixture)

	children, err := a.Children(context.Background(), nodePath(fixture), adapters.NewOpCtx("op-3"))
	if err != nil {
		t.Fatalf("Children: %v", err)
	}
	names := childNames(t, children)
	if !containsName(names, "db0") || !containsName(names, "db1") {
		t.Errorf("names = %v, want both db0 and db1", names)
	}
}

func TestRedis_Children_RootNamespacesAndKeys(t *testing.T) {
	fixture := testsupport.StartRedis(t)
	a := connectedAdapter(t, fixture)

	children, err := a.Children(context.Background(), nodePath(fixture, seg("database", "db0")), adapters.NewOpCtx("op-4"))
	if err != nil {
		t.Fatalf("Children: %v", err)
	}
	var namespaces, keys []string
	for _, n := range children.Nodes {
		if n.Kind == "namespace" {
			namespaces = append(namespaces, n.Name)
		} else {
			keys = append(keys, n.Name)
		}
	}
	wantNamespaces := []string{"events", "queue", "session", "tags", "user"}
	for _, w := range wantNamespaces {
		if !containsName(namespaces, w) {
			t.Errorf("namespaces = %v, want to contain %q", namespaces, w)
		}
	}
	wantKeys := []string{"counter", "leaderboard"}
	for _, w := range wantKeys {
		if !containsName(keys, w) {
			t.Errorf("keys = %v, want to contain %q", keys, w)
		}
	}
}

// children() of a key leaf marshals as "nodes":[] (C16), never null.
func TestRedis_Children_KeyIsLeaf(t *testing.T) {
	fixture := testsupport.StartRedis(t)
	a := connectedAdapter(t, fixture)

	children, err := a.Children(context.Background(),
		nodePath(fixture, seg("database", "db0"), seg("key", "counter")),
		adapters.NewOpCtx("op-5"))
	if err != nil {
		t.Fatalf("Children: %v", err)
	}
	if children.Nodes == nil {
		t.Fatal("Nodes is nil, want an empty non-nil slice")
	}
	b, err := json.Marshal(children)
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	if !regexp.MustCompile(`"Nodes":\[\]`).Match(b) {
		t.Errorf("marshalled = %s, want a \"Nodes\":[] field, not null", b)
	}
}

// 8/9/10: hash/set/zset paging asserts "some rows, more to come" for the big hash, and the exact
// set of pairs for the small ones — never an exact row count on the paged case, since HSCAN's
// COUNT is a hint and readScanFamily can overshoot.
func TestRedis_Read_Hash_Small(t *testing.T) {
	fixture := testsupport.StartRedis(t)
	a := connectedAdapter(t, fixture)
	path := nodePath(fixture, seg("database", "db0"), seg("key", testsupport.RedisHashKey))

	p, err := a.Read(context.Background(), adapters.ReadRequest{
		Path: path, PageSize: 100, Cursor: model.PageCursor{Mode: "offset", Offset: 0},
	}, adapters.NewOpCtx("op-8"))
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	kv := p.(page.KeyValuePage)
	pairs := kvPairs(t, kv)
	for field, value := range testsupport.RedisHashFields {
		if pairs[field] != value {
			t.Errorf("pairs[%q] = %q, want %q", field, pairs[field], value)
		}
	}
}

func TestRedis_Read_Hash_Big(t *testing.T) {
	fixture := testsupport.StartRedis(t)
	a := connectedAdapter(t, fixture)
	path := nodePath(fixture, seg("database", "db0"), seg("key", testsupport.RedisBigHashKey))

	p, err := a.Read(context.Background(), adapters.ReadRequest{
		Path: path, PageSize: 50, Cursor: model.PageCursor{Mode: "offset", Offset: 0},
	}, adapters.NewOpCtx("op-9"))
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	kv := p.(page.KeyValuePage)
	if kv.RowCount == 0 {
		t.Fatal("RowCount = 0, want > 0")
	}
	if !kv.Position.HasMore {
		t.Error("HasMore = false, want true (5000-field hash, page size 50)")
	}
	if kv.Position.NextToken == nil {
		t.Fatal("NextToken is nil, want a cursor token")
	}

	// An offset cursor on this cursor-paged key restarts the scan rather than seeking or
	// erroring (redis 24) — the second read must succeed and simply start over from cursor 0.
	p2, err := a.Read(context.Background(), adapters.ReadRequest{
		Path: path, PageSize: 50, Cursor: model.PageCursor{Mode: "offset", Offset: 40},
	}, adapters.NewOpCtx("op-9b"))
	if err != nil {
		t.Fatalf("Read (offset cursor on a cursor-paged key): %v", err)
	}
	kv2 := p2.(page.KeyValuePage)
	if kv2.RowCount == 0 {
		t.Error("restart read: RowCount = 0, want > 0")
	}
}

func TestRedis_Read_Set(t *testing.T) {
	fixture := testsupport.StartRedis(t)
	a := connectedAdapter(t, fixture)
	path := nodePath(fixture, seg("database", "db0"), seg("key", testsupport.RedisSetKey))

	p, err := a.Read(context.Background(), adapters.ReadRequest{
		Path: path, PageSize: 100, Cursor: model.PageCursor{Mode: "offset", Offset: 0},
	}, adapters.NewOpCtx("op-10"))
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	kv := p.(page.KeyValuePage)
	if kv.RowCount != len(testsupport.RedisSetMembers) {
		t.Fatalf("RowCount = %d, want %d", kv.RowCount, len(testsupport.RedisSetMembers))
	}
	seen := map[string]bool{}
	for i := 0; i < kv.RowCount; i++ {
		v := kvValueAt(t, kv, i)
		if v != nil {
			seen[*v] = true
		}
	}
	for _, m := range testsupport.RedisSetMembers {
		if !seen[m] {
			t.Errorf("set members = %v, missing %q", seen, m)
		}
	}
}

// P2 R1 regression: a set's per-row display index (its only "field" — a member has no natural
// key) is a running total carried across pages, not reset to 0 each call. Without the fix, page 2
// relabels its rows starting at "0" again, duplicating page 1's own labels instead of continuing
// from where page 1 left off.
func TestRedis_Read_Set_Big_RowNumberingContinuesAcrossPages(t *testing.T) {
	fixture := testsupport.StartRedis(t)
	a := connectedAdapter(t, fixture)
	path := nodePath(fixture, seg("database", "db0"), seg("key", testsupport.RedisBigSetKey))

	p1, err := a.Read(context.Background(), adapters.ReadRequest{
		Path: path, PageSize: 50, Cursor: model.PageCursor{Mode: "offset", Offset: 0},
	}, adapters.NewOpCtx("op-set-big-1"))
	if err != nil {
		t.Fatalf("Read page 1: %v", err)
	}
	kv1 := p1.(page.KeyValuePage)
	if kv1.RowCount == 0 {
		t.Fatal("page 1: RowCount = 0, want > 0")
	}
	if !kv1.Position.HasMore || kv1.Position.NextToken == nil {
		t.Fatalf("page 1: HasMore = %v, NextToken = %v, want a truncated first page (5000-member set, page size 50)", kv1.Position.HasMore, kv1.Position.NextToken)
	}
	lastLabel1, err := strconv.Atoi(*kvFieldAt(t, kv1, kv1.RowCount-1))
	if err != nil {
		t.Fatalf("page 1: last row label not numeric: %v", err)
	}

	p2, err := a.Read(context.Background(), adapters.ReadRequest{
		Path: path, PageSize: 50, Cursor: model.PageCursor{Mode: "after", Token: *kv1.Position.NextToken},
	}, adapters.NewOpCtx("op-set-big-2"))
	if err != nil {
		t.Fatalf("Read page 2: %v", err)
	}
	kv2 := p2.(page.KeyValuePage)
	if kv2.RowCount == 0 {
		t.Fatal("page 2: RowCount = 0, want > 0")
	}
	firstLabel2, err := strconv.Atoi(*kvFieldAt(t, kv2, 0))
	if err != nil {
		t.Fatalf("page 2: first row label not numeric: %v", err)
	}
	if firstLabel2 != lastLabel1+1 {
		t.Errorf("page 2's first row label = %d, want %d (continuing from page 1's last label %d, not restarting)", firstLabel2, lastLabel1+1, lastLabel1)
	}
}

func TestRedis_Read_ZSet(t *testing.T) {
	fixture := testsupport.StartRedis(t)
	a := connectedAdapter(t, fixture)
	path := nodePath(fixture, seg("database", "db0"), seg("key", testsupport.RedisZSetKey))

	p, err := a.Read(context.Background(), adapters.ReadRequest{
		Path: path, PageSize: 100, Cursor: model.PageCursor{Mode: "offset", Offset: 0},
	}, adapters.NewOpCtx("op-11"))
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	kv := p.(page.KeyValuePage)
	pairs := kvPairs(t, kv)
	want := map[string]string{"alice": "10", "bob": "20", "carol": "30"}
	for member, score := range want {
		if pairs[member] != score {
			t.Errorf("pairs[%q] = %q, want %q", member, pairs[member], score)
		}
	}
}

// list: offset paging honours the requested page size in full — no LIST_WINDOW clamp (P43 iter2
// D25/F18).
func TestRedis_Read_List_NoWindowClamp(t *testing.T) {
	fixture := testsupport.StartRedis(t)
	a := connectedAdapter(t, fixture)
	path := nodePath(fixture, seg("database", "db0"), seg("key", testsupport.RedisBigListKey))

	p, err := a.Read(context.Background(), adapters.ReadRequest{
		Path: path, PageSize: 1000, Cursor: model.PageCursor{Mode: "offset", Offset: 0},
	}, adapters.NewOpCtx("op-12"))
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	kv := p.(page.KeyValuePage)
	if kv.RowCount != 1000 {
		t.Fatalf("RowCount = %d, want 1000 (the deleted LIST_WINDOW clamp must not come back)", kv.RowCount)
	}
	if !kv.Position.HasMore {
		t.Error("HasMore = false, want true (1200-element list, page size 1000)")
	}
}

// stream: XRANGE with the +1 probe.
func TestRedis_Read_Stream(t *testing.T) {
	fixture := testsupport.StartRedis(t)
	a := connectedAdapter(t, fixture)
	path := nodePath(fixture, seg("database", "db0"), seg("key", testsupport.RedisStreamKey))

	p, err := a.Read(context.Background(), adapters.ReadRequest{
		Path: path, PageSize: 100, Cursor: model.PageCursor{Mode: "offset", Offset: 0},
	}, adapters.NewOpCtx("op-13"))
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	kv := p.(page.KeyValuePage)
	if kv.RowCount != testsupport.RedisStreamEntries {
		t.Fatalf("RowCount = %d, want %d", kv.RowCount, testsupport.RedisStreamEntries)
	}
	body := kvValueAt(t, kv, 0)
	if body == nil {
		t.Fatal("body is nil")
	}
	var fields map[string]string
	if err := json.Unmarshal([]byte(*body), &fields); err != nil {
		t.Fatalf("Unmarshal stream entry body: %v", err)
	}
	if fields["type"] != "click" {
		t.Errorf("fields[type] = %q, want click", fields["type"])
	}

	// P2 R1 regression: the seed fixture's own XAdd order is "zLast", "type", "seq" (deliberately
	// not alphabetical) — a read path that discards that order and falls back to a Go map/JSON
	// key sort would instead emit "seq", "type", "zLast", failing this position check.
	var positions []int
	for _, field := range testsupport.RedisStreamFields {
		pos := strings.Index(*body, `"`+field+`"`)
		if pos < 0 {
			t.Fatalf("body = %s, missing field %q", *body, field)
		}
		positions = append(positions, pos)
	}
	for i := 1; i < len(positions); i++ {
		if positions[i] < positions[i-1] {
			t.Errorf("body = %s, want field order %v (XADD's own order), not re-sorted", *body, testsupport.RedisStreamFields)
			break
		}
	}
}

// string type + TTL surfaced.
func TestRedis_Read_StringWithTTL(t *testing.T) {
	fixture := testsupport.StartRedis(t)
	a := connectedAdapter(t, fixture)
	path := nodePath(fixture, seg("database", "db0"), seg("key", testsupport.RedisTTLKey))

	p, err := a.Read(context.Background(), adapters.ReadRequest{
		Path: path, PageSize: 10, Cursor: model.PageCursor{Mode: "offset", Offset: 0},
	}, adapters.NewOpCtx("op-14"))
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	kv := p.(page.KeyValuePage)
	if kv.RedisType != "string" {
		t.Errorf("RedisType = %q, want string", kv.RedisType)
	}
	if kv.TTLMs == nil || *kv.TTLMs <= 0 {
		t.Errorf("TTLMs = %v, want a positive value", kv.TTLMs)
	}
	v := kvValueAt(t, kv, 0)
	if v == nil || *v != "token-abc" {
		t.Errorf("value = %v, want token-abc", v)
	}
}

// 15: a vanished key is E_QUERY, not E_NOT_FOUND (P9 D10) — the wrong code gates a tab behind
// "Reconnect & load" for a key that merely expired.
func TestRedis_Read_VanishedKeyIsQueryError(t *testing.T) {
	fixture := testsupport.StartRedis(t)
	a := connectedAdapter(t, fixture)
	path := nodePath(fixture, seg("database", "db0"), seg("key", "does-not-exist"))

	_, err := a.Read(context.Background(), adapters.ReadRequest{
		Path: path, PageSize: 10, Cursor: model.PageCursor{Mode: "offset", Offset: 0},
	}, adapters.NewOpCtx("op-15"))
	if err == nil {
		t.Fatal("want an error, got nil")
	}
	code, _ := adapters.CodeOf(err)
	if code != adapters.CodeQuery {
		t.Errorf("code = %v, want E_QUERY (not E_NOT_FOUND)", code)
	}
}

// count: exact via O(1) type-length commands.
func TestRedis_Count(t *testing.T) {
	fixture := testsupport.StartRedis(t)
	a := connectedAdapter(t, fixture)
	path := nodePath(fixture, seg("database", "db0"), seg("key", testsupport.RedisListKey))

	result, err := a.Count(context.Background(), adapters.CountRequest{Path: path}, adapters.NewOpCtx("op-16"))
	if err != nil {
		t.Fatalf("Count: %v", err)
	}
	if !result.Exact {
		t.Error("Exact = false, want true")
	}
	if result.Value != testsupport.RedisListLength {
		t.Errorf("Value = %d, want %d", result.Value, testsupport.RedisListLength)
	}
}

// mutate: insert (SET NX) / update (SET) / delete (DEL), against db index 1 (C23 — every mutating
// test runs against the secondary db, never db0, whose exact root listing scenario 3 asserts).
func TestRedis_Mutate_InsertUpdateDelete(t *testing.T) {
	fixture := testsupport.StartRedis(t)
	a := connectedAdapter(t, fixture)
	path := nodePath(fixture, seg("database", "db1"))

	insertPlan := model.MutationPlan{Path: path, Ops: []model.MutationRowOp{{
		Kind: "insert",
		Values: model.RowValues{
			{Name: "_key", Value: strp("mutate:probe")},
			{Name: "$value", Value: strp("hello")},
		},
	}}}
	preview, err := a.Preview(insertPlan)
	if err != nil {
		t.Fatalf("Preview: %v", err)
	}
	if len(preview) != 1 || preview[0] != "SET mutate:probe hello NX" {
		t.Errorf("Preview = %v", preview)
	}
	result, err := a.Mutate(context.Background(), insertPlan, adapters.NewOpCtx("op-17"))
	if err != nil {
		t.Fatalf("Mutate (insert): %v", err)
	}
	if result.AffectedRows != 1 {
		t.Fatalf("AffectedRows = %d, want 1", result.AffectedRows)
	}

	// Inserting the same key again must fail (NX).
	_, err = a.Mutate(context.Background(), insertPlan, adapters.NewOpCtx("op-17b"))
	if err == nil {
		t.Fatal("second insert: want an error (key already exists), got nil")
	}

	updatePlan := model.MutationPlan{Path: path, Ops: []model.MutationRowOp{{
		Kind: "update",
		Key:  model.RowValues{{Name: "_key", Value: strp("mutate:probe")}},
		Changes: model.RowValues{
			{Name: "$value", Value: strp("updated")},
		},
	}}}
	if _, err := a.Mutate(context.Background(), updatePlan, adapters.NewOpCtx("op-18")); err != nil {
		t.Fatalf("Mutate (update): %v", err)
	}
	readPath := nodePath(fixture, seg("database", "db1"), seg("key", "mutate:probe"))
	p, err := a.Read(context.Background(), adapters.ReadRequest{
		Path: readPath, PageSize: 10, Cursor: model.PageCursor{Mode: "offset", Offset: 0},
	}, adapters.NewOpCtx("op-18b"))
	if err != nil {
		t.Fatalf("Read after update: %v", err)
	}
	v := kvValueAt(t, p.(page.KeyValuePage), 0)
	if v == nil || *v != "updated" {
		t.Errorf("value after update = %v, want updated", v)
	}

	// P2 R1: editing a value must not silently clear the key's existing TTL — a plain SET
	// (without KEEPTTL) would reset it to none.
	side := goredis.NewClient(&goredis.Options{
		Addr: fixture.Host + ":" + strconv.Itoa(fixture.Port), Password: testsupport.RedisPassword,
		DB: testsupport.RedisSecondaryDbIndex, Protocol: 2,
	})
	defer side.Close()
	if err := side.Expire(context.Background(), "mutate:probe", time.Hour).Err(); err != nil {
		t.Fatalf("seed TTL: %v", err)
	}
	ttlPlan := model.MutationPlan{Path: path, Ops: []model.MutationRowOp{{
		Kind: "update",
		Key:  model.RowValues{{Name: "_key", Value: strp("mutate:probe")}},
		Changes: model.RowValues{
			{Name: "$value", Value: strp("updated again")},
		},
	}}}
	if _, err := a.Mutate(context.Background(), ttlPlan, adapters.NewOpCtx("op-18c")); err != nil {
		t.Fatalf("Mutate (update, with TTL): %v", err)
	}
	ttl, err := side.TTL(context.Background(), "mutate:probe").Result()
	if err != nil {
		t.Fatalf("TTL after update: %v", err)
	}
	if ttl <= 0 {
		t.Errorf("TTL after update = %v, want it preserved (> 0)", ttl)
	}

	deletePlan := model.MutationPlan{Path: path, Ops: []model.MutationRowOp{{
		Kind: "delete",
		Key:  model.RowValues{{Name: "_key", Value: strp("mutate:probe")}},
	}}}
	deleteResult, err := a.Mutate(context.Background(), deletePlan, adapters.NewOpCtx("op-19"))
	if err != nil {
		t.Fatalf("Mutate (delete): %v", err)
	}
	if deleteResult.AffectedRows != 1 {
		t.Errorf("AffectedRows = %d, want 1", deleteResult.AffectedRows)
	}
}

func strp(s string) *string { return &s }

// mutate: editing a non-string-type key is rejected server-side too (§8.12's standard).
func TestRedis_Mutate_NonStringTypeUneditable(t *testing.T) {
	fixture := testsupport.StartRedis(t)
	a := connectedAdapter(t, fixture)
	path := nodePath(fixture, seg("database", "db1"))

	// A real list key, seeded directly into db1 (C23) — mutate.go itself has no way to create a
	// non-string-typed key, so the type this test needs to reject has to come from a side client.
	const listKey = "mutate:list-probe"
	side := goredis.NewClient(&goredis.Options{
		Addr: fixture.Host + ":" + strconv.Itoa(fixture.Port), Password: testsupport.RedisPassword,
		DB: testsupport.RedisSecondaryDbIndex, Protocol: 2,
	})
	defer side.Close()
	if err := side.RPush(context.Background(), listKey, "a", "b").Err(); err != nil {
		t.Fatalf("seed list key: %v", err)
	}

	updatePlan := model.MutationPlan{Path: path, Ops: []model.MutationRowOp{{
		Kind: "update",
		Key:  model.RowValues{{Name: "_key", Value: strp(listKey)}},
		Changes: model.RowValues{
			{Name: "$value", Value: strp("nope")},
		},
	}}}
	_, err := a.Mutate(context.Background(), updatePlan, adapters.NewOpCtx("op-20"))
	if err == nil {
		t.Fatal("want an error, got nil")
	}
	code, _ := adapters.CodeOf(err)
	if code != adapters.CodeUnsupported {
		t.Errorf("code = %v, want E_UNSUPPORTED", code)
	}
}

// 21: cancel is a permanent no-op, and honest about it — caps.Cancel is true anyway (C9).
func TestRedis_Cancel_PermanentNoOp(t *testing.T) {
	fixture := testsupport.StartRedis(t)
	a := connectedAdapter(t, fixture)

	killed, err := a.Cancel(context.Background(), "any-op-id")
	if err != nil {
		t.Fatalf("Cancel: %v", err)
	}
	if killed {
		t.Error("Cancel returned true, want false (permanent no-op, D7/D8)")
	}
	if !a.Caps().Cancel {
		t.Error("Caps().Cancel = false, want true")
	}
}

// console: a generic command dispatch through client.Do.
func TestRedis_Console_Execute(t *testing.T) {
	fixture := testsupport.StartRedis(t)
	a := connectedAdapter(t, fixture)
	path := nodePath(fixture, seg("database", "db1"))

	pages, err := a.Execute(context.Background(), model.ConsoleRequest{
		Path:       path,
		Statements: []string{"SET console:probe hello", "GET console:probe"},
	}, adapters.NewOpCtx("op-22"))
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if len(pages) != 2 {
		t.Fatalf("len(pages) = %d, want 2", len(pages))
	}
	getPage, ok := pages[1].(page.KeyValuePage)
	if !ok {
		t.Fatalf("pages[1] = %T, want page.KeyValuePage", pages[1])
	}
	v := kvValueAt(t, getPage, 0)
	if v == nil || *v != "hello" {
		t.Errorf("GET result = %v, want hello", v)
	}
}

// caps honesty.
func TestRedis_Caps(t *testing.T) {
	a := newAdapter(t)
	c := a.Caps()
	if !c.KeyValue || c.Tabular || c.Documents || c.Stream {
		t.Errorf("Caps page-kind flags = %+v, want keyValue-only", c)
	}
	if c.Pagination != adapters.PaginationCursor {
		t.Errorf("Pagination = %v, want cursor", c.Pagination)
	}
	if !c.ExactCount {
		t.Error("ExactCount = false, want true")
	}
	if c.Definition || c.Describe {
		t.Error("Definition/Describe = true, want both false")
	}
}
