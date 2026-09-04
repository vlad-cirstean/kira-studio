package repos

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"

	"github.com/google/uuid"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/postman"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

// P4 D2: two tables, one repo. `sort_order` is dense within a parent and rewritten wholesale on
// any insert or delete — exactly the discipline TabsRepo.Save already applies to tabs."order" —
// because Postman's `item` is an ordered array, so order is data, not presentation.
//
// No prepared statement: the list query runs once per panel mount, not per keystroke, so it does
// not belong in repos.New's hot-statement set.
type CollectionsRepo struct {
	DB *sql.DB
}

// The two projections that never touch request_json/origin_json. SQLite stores a row's columns in
// declaration order and spills the tail into overflow pages, so stopping before them is the cheap
// path for the one query that runs on every panel mount (D2).
const (
	collectionSelectColumns = `id, name, sort_order, created_at, updated_at`
	itemSelectColumns       = `id, collection_id, parent_id, kind, name, sort_order, method, url, protocol, created_at, updated_at`
)

// encodeJSON marshals with HTML escaping off — the same discipline internal/ipcfixture/write.go
// and internal/postman both apply. An origin_json escaped here would carry its < all the way
// into an exported file, which survives re-import but reads as corruption in a diff.
func encodeJSON(v any) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return bytes.TrimRight(buf.Bytes(), "\n"), nil
}

// List returns every collection and every item, as two flat arrays — the renderer builds the tree,
// mirroring how TreeService.Children returns flat nodes. One call per panel mount; no N+1.
func (r *CollectionsRepo) List() ([]model.Collection, []model.CollectionItem, error) {
	collections, err := r.listCollections()
	if err != nil {
		return nil, nil, err
	}
	items, err := r.listItems()
	if err != nil {
		return nil, nil, err
	}
	return collections, items, nil
}

func (r *CollectionsRepo) listCollections() ([]model.Collection, error) {
	rows, err := r.DB.Query(`SELECT ` + collectionSelectColumns + ` FROM http_collections ORDER BY sort_order, name`)
	if err != nil {
		return nil, fmt.Errorf("repos/collections: query collections: %w", err)
	}
	defer rows.Close()

	out := []model.Collection{}
	for rows.Next() {
		var c model.Collection
		if err := rows.Scan(&c.ID, &c.Name, &c.SortOrder, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, fmt.Errorf("repos/collections: scan collection: %w", err)
		}
		out = append(out, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("repos/collections: collection rows: %w", err)
	}
	return out, nil
}

func (r *CollectionsRepo) listItems() ([]model.CollectionItem, error) {
	rows, err := r.DB.Query(`SELECT ` + itemSelectColumns + ` FROM http_items ORDER BY collection_id, sort_order`)
	if err != nil {
		return nil, fmt.Errorf("repos/collections: query items: %w", err)
	}
	defer rows.Close()

	out := []model.CollectionItem{}
	for rows.Next() {
		item, err := scanItem(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("repos/collections: item rows: %w", err)
	}
	return out, nil
}

func scanItem(row rowScanner) (model.CollectionItem, error) {
	var (
		item   model.CollectionItem
		parent sql.NullString
	)
	if err := row.Scan(
		&item.ID, &item.CollectionID, &parent, &item.Kind, &item.Name,
		&item.SortOrder, &item.Method, &item.URL, &item.Protocol, &item.CreatedAt, &item.UpdatedAt,
	); err != nil {
		return model.CollectionItem{}, fmt.Errorf("repos/collections: scan item: %w", err)
	}
	if parent.Valid {
		item.ParentID = &parent.String
	}
	return item, nil
}

// GetRequest reads one saved request on demand, so the list path never touches request_json. A row
// whose stored document is unparseable or fails model.SavedRequest.Validate is refused with a
// legible error rather than handed to the renderer half-formed — the write-side counterpart of
// repos/saved_queries.go's drop-and-log on read.
func (r *CollectionsRepo) GetRequest(itemID string) (model.SavedRequest, error) {
	var (
		kind, protocol string
		body           string
	)
	err := r.DB.QueryRow(`SELECT kind, protocol, request_json FROM http_items WHERE id = ?`, itemID).Scan(&kind, &protocol, &body)
	if errors.Is(err, sql.ErrNoRows) {
		return model.SavedRequest{}, fmt.Errorf("repos/collections: no item %s", itemID)
	}
	if err != nil {
		return model.SavedRequest{}, fmt.Errorf("repos/collections: get request %s: %w", itemID, err)
	}
	if kind != model.CollectionItemRequest {
		return model.SavedRequest{}, fmt.Errorf("repos/collections: item %s is a %s, not a request", itemID, kind)
	}
	if protocol != model.ItemProtocolHTTP {
		return model.SavedRequest{}, fmt.Errorf("repos/collections: item %s is a %s request, not http", itemID, protocol)
	}
	return decodeSavedRequest(itemID, body)
}

// GetGrpcRequest is GetRequest's own gRPC sibling (D12).
func (r *CollectionsRepo) GetGrpcRequest(itemID string) (model.SavedGrpcRequest, error) {
	var (
		kind, protocol string
		body           string
	)
	err := r.DB.QueryRow(`SELECT kind, protocol, request_json FROM http_items WHERE id = ?`, itemID).Scan(&kind, &protocol, &body)
	if errors.Is(err, sql.ErrNoRows) {
		return model.SavedGrpcRequest{}, fmt.Errorf("repos/collections: no item %s", itemID)
	}
	if err != nil {
		return model.SavedGrpcRequest{}, fmt.Errorf("repos/collections: get grpc request %s: %w", itemID, err)
	}
	if kind != model.CollectionItemRequest {
		return model.SavedGrpcRequest{}, fmt.Errorf("repos/collections: item %s is a %s, not a request", itemID, kind)
	}
	if protocol != model.ItemProtocolGrpc {
		return model.SavedGrpcRequest{}, fmt.Errorf("repos/collections: item %s is a %s request, not grpc", itemID, protocol)
	}
	return decodeSavedGrpcRequest(itemID, body)
}

func decodeSavedGrpcRequest(itemID, body string) (model.SavedGrpcRequest, error) {
	var req model.SavedGrpcRequest
	if err := json.Unmarshal([]byte(body), &req); err != nil {
		slog.Warn("collection grpc request is not valid JSON", "scope", "storage/collections", "id", itemID)
		return model.SavedGrpcRequest{}, fmt.Errorf("repos/collections: item %s: request is not valid JSON", itemID)
	}
	if err := req.Validate(); err != nil {
		slog.Warn("collection grpc request failed validation", "scope", "storage/collections", "id", itemID, "err", err)
		return model.SavedGrpcRequest{}, fmt.Errorf("repos/collections: item %s: %w", itemID, err)
	}
	return req, nil
}

func decodeSavedRequest(itemID, body string) (model.SavedRequest, error) {
	var req model.SavedRequest
	if err := json.Unmarshal([]byte(body), &req); err != nil {
		slog.Warn("collection request is not valid JSON", "scope", "storage/collections", "id", itemID)
		return model.SavedRequest{}, fmt.Errorf("repos/collections: item %s: request is not valid JSON", itemID)
	}
	if err := req.Validate(); err != nil {
		slog.Warn("collection request failed validation", "scope", "storage/collections", "id", itemID, "err", err)
		return model.SavedRequest{}, fmt.Errorf("repos/collections: item %s: %w", itemID, err)
	}
	return req, nil
}

// CreateCollection appends an empty collection created in this app — origin_json '{}', so export
// builds every member canonically.
func (r *CollectionsRepo) CreateCollection(name string) (model.Collection, error) {
	if name == "" {
		return model.Collection{}, fmt.Errorf("repos/collections: name is required")
	}
	var order int
	if err := r.DB.QueryRow(`SELECT COALESCE(MAX(sort_order) + 1, 0) FROM http_collections`).Scan(&order); err != nil {
		return model.Collection{}, fmt.Errorf("repos/collections: next collection order: %w", err)
	}
	c := model.Collection{
		ID: uuid.NewString(), Name: name, SortOrder: order,
		CreatedAt: model.NowISO(), UpdatedAt: model.NowISO(),
	}
	if _, err := r.DB.Exec(
		`INSERT INTO http_collections (id, name, sort_order, origin_json, created_at, updated_at)
		 VALUES (?, ?, ?, '{}', ?, ?)`,
		c.ID, c.Name, c.SortOrder, c.CreatedAt, c.UpdatedAt,
	); err != nil {
		return model.Collection{}, fmt.Errorf("repos/collections: insert collection: %w", err)
	}
	return c, nil
}

// CreateItem appends a folder or a request under parentID (nil = the collection root). request is
// meaningful only for kind 'request'; nil means "the empty request a new row starts as".
func (r *CollectionsRepo) CreateItem(collectionID string, parentID *string, kind, name string, request *model.SavedRequest) (model.CollectionItem, error) {
	if collectionID == "" {
		return model.CollectionItem{}, fmt.Errorf("repos/collections: collectionId is required")
	}
	if !model.IsCollectionItemKind(kind) {
		return model.CollectionItem{}, fmt.Errorf("repos/collections: unrecognised item kind %q", kind)
	}
	if name == "" {
		return model.CollectionItem{}, fmt.Errorf("repos/collections: name is required")
	}

	item := model.CollectionItem{
		ID: uuid.NewString(), CollectionID: collectionID, ParentID: parentID, Kind: kind, Name: name,
		Protocol: model.ItemProtocolHTTP, CreatedAt: model.NowISO(), UpdatedAt: model.NowISO(),
	}
	requestJSON := ""
	if kind == model.CollectionItemRequest {
		req := model.SavedRequest{Method: "GET", Headers: []model.SavedHeader{}, BodyMode: "none", CodeLanguage: "json"}
		if request != nil {
			req = *request
		}
		if err := req.Validate(); err != nil {
			return model.CollectionItem{}, fmt.Errorf("repos/collections: %w", err)
		}
		encoded, err := encodeJSON(req)
		if err != nil {
			return model.CollectionItem{}, fmt.Errorf("repos/collections: encode request: %w", err)
		}
		requestJSON = string(encoded)
		item.Method, item.URL = req.Method, req.URL
	}

	tx, err := r.DB.Begin()
	if err != nil {
		return model.CollectionItem{}, fmt.Errorf("repos/collections: begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	order, err := nextItemOrder(tx, collectionID, parentID)
	if err != nil {
		return model.CollectionItem{}, err
	}
	item.SortOrder = order
	if err := insertItem(tx, item, requestJSON, "{}"); err != nil {
		return model.CollectionItem{}, err
	}
	if err := tx.Commit(); err != nil {
		return model.CollectionItem{}, fmt.Errorf("repos/collections: commit: %w", err)
	}
	return item, nil
}

// CreateGrpcItem is CreateItem's own gRPC sibling (D12) — always kind 'request': a gRPC request
// has no folder distinction of its own, folders stay protocol-neutral. request nil means "the
// empty request a new row starts as" (reflection mode, TLS on, nothing else set).
func (r *CollectionsRepo) CreateGrpcItem(collectionID string, parentID *string, name string, request *model.SavedGrpcRequest) (model.CollectionItem, error) {
	if collectionID == "" {
		return model.CollectionItem{}, fmt.Errorf("repos/collections: collectionId is required")
	}
	if name == "" {
		return model.CollectionItem{}, fmt.Errorf("repos/collections: name is required")
	}

	req := model.SavedGrpcRequest{TLSMode: "tls", DescriptorMode: "reflection", ImportPaths: []string{}, Metadata: []model.SavedGrpcMetaRow{}}
	if request != nil {
		req = *request
	}
	if err := req.Validate(); err != nil {
		return model.CollectionItem{}, fmt.Errorf("repos/collections: %w", err)
	}
	encoded, err := encodeJSON(req)
	if err != nil {
		return model.CollectionItem{}, fmt.Errorf("repos/collections: encode grpc request: %w", err)
	}

	item := model.CollectionItem{
		ID: uuid.NewString(), CollectionID: collectionID, ParentID: parentID, Kind: model.CollectionItemRequest,
		Name: name, Protocol: model.ItemProtocolGrpc, Method: req.Service + "/" + req.Method, URL: req.Target,
		CreatedAt: model.NowISO(), UpdatedAt: model.NowISO(),
	}

	tx, err := r.DB.Begin()
	if err != nil {
		return model.CollectionItem{}, fmt.Errorf("repos/collections: begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	order, err := nextItemOrder(tx, collectionID, parentID)
	if err != nil {
		return model.CollectionItem{}, err
	}
	item.SortOrder = order
	if err := insertItem(tx, item, string(encoded), "{}"); err != nil {
		return model.CollectionItem{}, err
	}
	if err := tx.Commit(); err != nil {
		return model.CollectionItem{}, fmt.Errorf("repos/collections: commit: %w", err)
	}
	return item, nil
}

func nextItemOrder(tx *sql.Tx, collectionID string, parentID *string) (int, error) {
	var order int
	err := tx.QueryRow(
		`SELECT COALESCE(MAX(sort_order) + 1, 0) FROM http_items
		  WHERE collection_id = ? AND parent_id IS ?`,
		collectionID, parentID,
	).Scan(&order)
	if err != nil {
		return 0, fmt.Errorf("repos/collections: next item order: %w", err)
	}
	return order, nil
}

func insertItem(tx *sql.Tx, item model.CollectionItem, requestJSON, originJSON string) error {
	protocol := item.Protocol
	if protocol == "" {
		protocol = model.ItemProtocolHTTP
	}
	_, err := tx.Exec(
		`INSERT INTO http_items
		   (id, collection_id, parent_id, kind, name, sort_order, method, url, protocol, request_json, origin_json, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		item.ID, item.CollectionID, item.ParentID, item.Kind, item.Name, item.SortOrder,
		item.Method, item.URL, protocol, requestJSON, originJSON, item.CreatedAt, item.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("repos/collections: insert item: %w", err)
	}
	return nil
}

// SaveRequest writes the edited request and performs D6's shedding: each member the user has
// actually changed is deleted from origin_json, so an edited request stops carrying a stale
// duplicate of its own body (D5's cost) and export's rule degenerates correctly.
func (r *CollectionsRepo) SaveRequest(itemID, name string, request model.SavedRequest) (model.CollectionItem, error) {
	if itemID == "" {
		return model.CollectionItem{}, fmt.Errorf("repos/collections: itemId is required")
	}
	if name == "" {
		return model.CollectionItem{}, fmt.Errorf("repos/collections: name is required")
	}
	if err := request.Validate(); err != nil {
		return model.CollectionItem{}, fmt.Errorf("repos/collections: %w", err)
	}

	var (
		kind, protocol string
		originJSON     string
	)
	err := r.DB.QueryRow(`SELECT kind, protocol, origin_json FROM http_items WHERE id = ?`, itemID).Scan(&kind, &protocol, &originJSON)
	if errors.Is(err, sql.ErrNoRows) {
		return model.CollectionItem{}, fmt.Errorf("repos/collections: no item %s", itemID)
	}
	if err != nil {
		return model.CollectionItem{}, fmt.Errorf("repos/collections: read item %s: %w", itemID, err)
	}
	if kind != model.CollectionItemRequest {
		return model.CollectionItem{}, fmt.Errorf("repos/collections: item %s is a %s, not a request", itemID, kind)
	}
	if protocol != model.ItemProtocolHTTP {
		return model.CollectionItem{}, fmt.Errorf("repos/collections: item %s is a %s request, not http", itemID, protocol)
	}

	shed, err := shedOriginJSON(originJSON, request)
	if err != nil {
		return model.CollectionItem{}, err
	}
	encoded, err := encodeJSON(request)
	if err != nil {
		return model.CollectionItem{}, fmt.Errorf("repos/collections: encode request: %w", err)
	}
	now := model.NowISO()
	if _, err := r.DB.Exec(
		`UPDATE http_items
		    SET name = ?, method = ?, url = ?, request_json = ?, origin_json = ?, updated_at = ?
		  WHERE id = ?`,
		name, request.Method, request.URL, string(encoded), shed, now, itemID,
	); err != nil {
		return model.CollectionItem{}, fmt.Errorf("repos/collections: save request %s: %w", itemID, err)
	}
	return r.getItem(itemID)
}

// SaveGrpcRequest is SaveRequest's own gRPC sibling (D12) — no origin-shedding (F22: a gRPC item
// has no Postman origin, ever), so this is a plain rewrite.
func (r *CollectionsRepo) SaveGrpcRequest(itemID, name string, request model.SavedGrpcRequest) (model.CollectionItem, error) {
	if itemID == "" {
		return model.CollectionItem{}, fmt.Errorf("repos/collections: itemId is required")
	}
	if name == "" {
		return model.CollectionItem{}, fmt.Errorf("repos/collections: name is required")
	}
	if err := request.Validate(); err != nil {
		return model.CollectionItem{}, fmt.Errorf("repos/collections: %w", err)
	}

	var kind, protocol string
	err := r.DB.QueryRow(`SELECT kind, protocol FROM http_items WHERE id = ?`, itemID).Scan(&kind, &protocol)
	if errors.Is(err, sql.ErrNoRows) {
		return model.CollectionItem{}, fmt.Errorf("repos/collections: no item %s", itemID)
	}
	if err != nil {
		return model.CollectionItem{}, fmt.Errorf("repos/collections: read item %s: %w", itemID, err)
	}
	if kind != model.CollectionItemRequest {
		return model.CollectionItem{}, fmt.Errorf("repos/collections: item %s is a %s, not a request", itemID, kind)
	}
	if protocol != model.ItemProtocolGrpc {
		return model.CollectionItem{}, fmt.Errorf("repos/collections: item %s is a %s request, not grpc", itemID, protocol)
	}

	encoded, err := encodeJSON(request)
	if err != nil {
		return model.CollectionItem{}, fmt.Errorf("repos/collections: encode grpc request: %w", err)
	}
	now := model.NowISO()
	method := request.Service + "/" + request.Method
	if _, err := r.DB.Exec(
		`UPDATE http_items SET name = ?, method = ?, url = ?, request_json = ?, updated_at = ? WHERE id = ?`,
		name, method, request.Target, string(encoded), now, itemID,
	); err != nil {
		return model.CollectionItem{}, fmt.Errorf("repos/collections: save grpc request %s: %w", itemID, err)
	}
	return r.getItem(itemID)
}

// shedOriginJSON is postman.ShedOrigin over the stored text. An origin_json that no longer parses
// is replaced with '{}' rather than propagated: it can only have been hand-edited, and keeping it
// would make every future export of that item emit the same broken bytes.
func shedOriginJSON(originJSON string, request model.SavedRequest) (string, error) {
	origin := map[string]json.RawMessage{}
	if originJSON != "" {
		if err := json.Unmarshal([]byte(originJSON), &origin); err != nil {
			slog.Warn("collection item origin is not a JSON object; discarding it",
				"scope", "storage/collections")
			origin = map[string]json.RawMessage{}
		}
	}
	encoded, err := encodeJSON(postman.ShedOrigin(origin, request))
	if err != nil {
		return "", fmt.Errorf("repos/collections: encode origin: %w", err)
	}
	return string(encoded), nil
}

func (r *CollectionsRepo) getItem(itemID string) (model.CollectionItem, error) {
	row := r.DB.QueryRow(`SELECT `+itemSelectColumns+` FROM http_items WHERE id = ?`, itemID)
	return scanItem(row)
}

// Rename renames a collection or an item. target is 'collection' or 'item' — the same two-table
// discriminator Delete takes, so the renderer never has to know which table a row lives in.
func (r *CollectionsRepo) Rename(id, target, name string) error {
	table, err := targetTable(target)
	if err != nil {
		return err
	}
	if id == "" || name == "" {
		return fmt.Errorf("repos/collections: id and name are required")
	}
	res, err := r.DB.Exec(`UPDATE `+table+` SET name = ?, updated_at = ? WHERE id = ?`, name, model.NowISO(), id)
	if err != nil {
		return fmt.Errorf("repos/collections: rename %s %s: %w", target, id, err)
	}
	return requireOneRow(res, target, id)
}

// Delete removes a collection (and its whole item tree) or one item (and its subtree). The cascade
// is genuine: db.go's DSN sets _foreign_keys=1 on every connection the pool opens, so
// http_items.parent_id REFERENCES http_items(id) ON DELETE CASCADE deletes a subtree at any depth
// in one statement, with no recursive delete in Go (F9). Surviving siblings are re-indexed dense.
func (r *CollectionsRepo) Delete(id, target string) error {
	table, err := targetTable(target)
	if err != nil {
		return err
	}
	if id == "" {
		return fmt.Errorf("repos/collections: id is required")
	}

	tx, err := r.DB.Begin()
	if err != nil {
		return fmt.Errorf("repos/collections: begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	var (
		collectionID string
		parentID     *string
	)
	if target == "item" {
		var parent sql.NullString
		err := tx.QueryRow(`SELECT collection_id, parent_id FROM http_items WHERE id = ?`, id).Scan(&collectionID, &parent)
		if errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("repos/collections: no item %s", id)
		}
		if err != nil {
			return fmt.Errorf("repos/collections: read item %s: %w", id, err)
		}
		if parent.Valid {
			parentID = &parent.String
		}
	}

	res, err := tx.Exec(`DELETE FROM `+table+` WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("repos/collections: delete %s %s: %w", target, id, err)
	}
	if err := requireOneRow(res, target, id); err != nil {
		return err
	}
	if target == "item" {
		if err := reindexSiblings(tx, collectionID, parentID); err != nil {
			return err
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("repos/collections: commit: %w", err)
	}
	return nil
}

func targetTable(target string) (string, error) {
	switch target {
	case "collection":
		return "http_collections", nil
	case "item":
		return "http_items", nil
	}
	return "", fmt.Errorf("repos/collections: unrecognised target %q", target)
}

func requireOneRow(res sql.Result, target, id string) error {
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("repos/collections: rows affected: %w", err)
	}
	if n == 0 {
		return fmt.Errorf("repos/collections: no %s %s", target, id)
	}
	return nil
}

// reindexSiblings rewrites one parent's sort_order dense, 0..n-1, in the order the rows already
// have. Sparse ordering keys were declined (D2): a parent's children are a handful to a few
// hundred rows, always rewritten inside one transaction, so gap management buys nothing.
func reindexSiblings(tx *sql.Tx, collectionID string, parentID *string) error {
	rows, err := tx.Query(
		`SELECT id FROM http_items WHERE collection_id = ? AND parent_id IS ? ORDER BY sort_order, created_at, id`,
		collectionID, parentID,
	)
	if err != nil {
		return fmt.Errorf("repos/collections: read siblings: %w", err)
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return fmt.Errorf("repos/collections: scan sibling: %w", err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return fmt.Errorf("repos/collections: sibling rows: %w", err)
	}
	rows.Close()

	for order, id := range ids {
		if _, err := tx.Exec(`UPDATE http_items SET sort_order = ? WHERE id = ?`, order, id); err != nil {
			return fmt.Errorf("repos/collections: reindex %s: %w", id, err)
		}
	}
	return nil
}

// ImportTree writes a parsed collection as rows, in one transaction — D3's (parent, index) mapping
// with a fresh uuid per row. postman.Tree.Items is depth-first in document order with Parent an
// index strictly below the item's own, so one pass suffices.
func (r *CollectionsRepo) ImportTree(tree *postman.Tree) (model.Collection, error) {
	if tree == nil {
		return model.Collection{}, fmt.Errorf("repos/collections: nil tree")
	}
	originJSON, err := encodeJSON(tree.Origin)
	if err != nil {
		return model.Collection{}, fmt.Errorf("repos/collections: encode collection origin: %w", err)
	}

	tx, err := r.DB.Begin()
	if err != nil {
		return model.Collection{}, fmt.Errorf("repos/collections: begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	var order int
	if err := tx.QueryRow(`SELECT COALESCE(MAX(sort_order) + 1, 0) FROM http_collections`).Scan(&order); err != nil {
		return model.Collection{}, fmt.Errorf("repos/collections: next collection order: %w", err)
	}
	now := model.NowISO()
	collection := model.Collection{
		ID: uuid.NewString(), Name: tree.Name, SortOrder: order, CreatedAt: now, UpdatedAt: now,
	}
	if _, err := tx.Exec(
		`INSERT INTO http_collections (id, name, sort_order, origin_json, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		collection.ID, collection.Name, collection.SortOrder, string(originJSON), now, now,
	); err != nil {
		return model.Collection{}, fmt.Errorf("repos/collections: insert collection: %w", err)
	}

	ids := make([]string, len(tree.Items))
	for i, src := range tree.Items {
		ids[i] = uuid.NewString()
		var parentID *string
		if src.Parent != postman.RootParent {
			parentID = &ids[src.Parent]
		}
		item := model.CollectionItem{
			ID: ids[i], CollectionID: collection.ID, ParentID: parentID,
			Kind: string(src.Kind), Name: src.Name, SortOrder: src.Order,
			CreatedAt: now, UpdatedAt: now,
		}
		requestJSON := ""
		if src.Kind == postman.KindRequest {
			encoded, err := encodeJSON(src.Request)
			if err != nil {
				return model.Collection{}, fmt.Errorf("repos/collections: encode request: %w", err)
			}
			requestJSON = string(encoded)
			item.Method, item.URL = src.Request.Method, src.Request.URL
		}
		itemOrigin, err := encodeJSON(src.Origin)
		if err != nil {
			return model.Collection{}, fmt.Errorf("repos/collections: encode item origin: %w", err)
		}
		if err := insertItem(tx, item, requestJSON, string(itemOrigin)); err != nil {
			return model.Collection{}, err
		}
	}

	if err := tx.Commit(); err != nil {
		return model.Collection{}, fmt.Errorf("repos/collections: commit: %w", err)
	}
	return collection, nil
}

// LoadTree rebuilds a postman.Tree from rows — the exact inverse of ImportTree, with the id→index
// mapping restored so Write can rebuild the nested arrays.
func (r *CollectionsRepo) LoadTree(collectionID string) (*postman.Tree, error) {
	var (
		name       string
		originJSON string
	)
	err := r.DB.QueryRow(`SELECT name, origin_json FROM http_collections WHERE id = ?`, collectionID).Scan(&name, &originJSON)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("repos/collections: no collection %s", collectionID)
	}
	if err != nil {
		return nil, fmt.Errorf("repos/collections: read collection %s: %w", collectionID, err)
	}

	tree := &postman.Tree{Name: name, Origin: decodeOrigin(originJSON, collectionID)}

	// D15/D16: the collection's own promoted variables, re-emitted from these rows — a secret
	// row's `value` is already '' by construction (D4's own CHECK constraint), which is what
	// makes D16's "a secret exports valueless" true here with no decrypt and no extra branch.
	varRows, err := r.DB.Query(
		`SELECT name, value, is_secret FROM http_variables WHERE collection_id = ? ORDER BY sort_order, name`,
		collectionID,
	)
	if err != nil {
		return nil, fmt.Errorf("repos/collections: query variables: %w", err)
	}
	for varRows.Next() {
		var (
			varName, varValue string
			isSecretInt       int
		)
		if err := varRows.Scan(&varName, &varValue, &isSecretInt); err != nil {
			varRows.Close()
			return nil, fmt.Errorf("repos/collections: scan variable: %w", err)
		}
		secret := isSecretInt != 0
		typ := ""
		if secret {
			typ = "secret"
		}
		tree.Variables = append(tree.Variables, postman.Variable{Name: varName, Value: varValue, Secret: secret, Type: typ})
	}
	if err := varRows.Err(); err != nil {
		varRows.Close()
		return nil, fmt.Errorf("repos/collections: variable rows: %w", err)
	}
	varRows.Close()

	rows, err := r.DB.Query(
		`SELECT id, parent_id, kind, name, sort_order, protocol, request_json, origin_json
		   FROM http_items WHERE collection_id = ? ORDER BY sort_order, created_at, id`,
		collectionID,
	)
	if err != nil {
		return nil, fmt.Errorf("repos/collections: query items: %w", err)
	}
	defer rows.Close()

	type row struct {
		id, kind, name, protocol, requestJSON, originJSON string
		parent                                            *string
		order                                             int
	}
	all := []row{}
	for rows.Next() {
		var (
			rec    row
			parent sql.NullString
		)
		if err := rows.Scan(&rec.id, &parent, &rec.kind, &rec.name, &rec.order, &rec.protocol, &rec.requestJSON, &rec.originJSON); err != nil {
			return nil, fmt.Errorf("repos/collections: scan item: %w", err)
		}
		if parent.Valid {
			rec.parent = &parent.String
		}
		all = append(all, rec)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("repos/collections: item rows: %w", err)
	}

	// One pass to claim an index per id, a second to resolve parents — a row's parent can sort
	// after it (sort_order is dense per parent, not global), so the two cannot be merged.
	indexByID := make(map[string]int, len(all))
	for i, rec := range all {
		indexByID[rec.id] = i
	}
	tree.Items = make([]postman.Item, 0, len(all))
	for _, rec := range all {
		item := postman.Item{
			Parent: postman.RootParent, Kind: postman.ItemKind(rec.kind), Name: rec.name,
			Order: rec.order, Protocol: rec.protocol, Origin: decodeOrigin(rec.originJSON, rec.id),
		}
		if rec.parent != nil {
			if idx, ok := indexByID[*rec.parent]; ok {
				item.Parent = idx
			}
		}
		// F22/D12: a gRPC item's request_json is a model.SavedGrpcRequest, not a SavedRequest —
		// write.go skips every protocol='grpc' item before it ever reads .Request (postman has no
		// representation for one), so it is left at its zero value here rather than decoded wrong.
		if item.Kind == postman.KindRequest && rec.protocol == model.ItemProtocolHTTP {
			req, err := decodeSavedRequest(rec.id, rec.requestJSON)
			if err != nil {
				return nil, err
			}
			item.Request = req
		}
		tree.Items = append(tree.Items, item)
	}
	return tree, nil
}

// decodeOrigin never fails the load: an origin that no longer parses is treated as absent, so the
// export builds every member canonically rather than refusing to write the file at all.
func decodeOrigin(originJSON, id string) map[string]json.RawMessage {
	out := map[string]json.RawMessage{}
	if originJSON == "" {
		return out
	}
	if err := json.Unmarshal([]byte(originJSON), &out); err != nil {
		slog.Warn("collection origin is not a JSON object; exporting canonically instead",
			"scope", "storage/collections", "id", id)
		return map[string]json.RawMessage{}
	}
	return out
}
