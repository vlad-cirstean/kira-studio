package repos

import (
	"database/sql"
	"errors"
	"fmt"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
	"github.com/kirathecat/kira-studio/internal/kiratime"
	"github.com/kirathecat/kira-studio/internal/sqlitex"
)

// ErrInvalidMove is a MoveItems request that cannot land: into the item itself or a descendant, under
// a parent that is not a folder of the target collection, or before a sibling that is not a child of
// the target parent. ErrCollectionNotFound is a target or delete id with no collection row.
var (
	ErrInvalidMove        = errors.New("repos/collections: invalid move")
	ErrCollectionNotFound = errors.New("repos/collections: collection not found")
)

type treeNode struct {
	collectionID string
	parentID     string // "" = collection root
	kind         string
	index        int // position among its parent's children
}

type nodeKey struct{ collectionID, parentID string }

// loadTree reads every item's place in one query. children holds each parent's ids in sort order.
func loadTree(tx *sql.Tx) (nodes map[string]treeNode, children map[nodeKey][]string, err error) {
	rows, err := tx.Query(`SELECT id, collection_id, parent_id, kind FROM api_items ORDER BY sort_order, created_at, id`)
	if err != nil {
		return nil, nil, fmt.Errorf("repos/collections: read tree: %w", err)
	}
	defer rows.Close()
	nodes = map[string]treeNode{}
	children = map[nodeKey][]string{}
	for rows.Next() {
		var id, collectionID, kind string
		var parent sql.NullString
		if err := rows.Scan(&id, &collectionID, &parent, &kind); err != nil {
			return nil, nil, fmt.Errorf("repos/collections: scan tree: %w", err)
		}
		key := nodeKey{collectionID, parent.String}
		nodes[id] = treeNode{collectionID: collectionID, parentID: parent.String, kind: kind, index: len(children[key])}
		children[key] = append(children[key], id)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, fmt.Errorf("repos/collections: tree rows: %w", err)
	}
	return nodes, children, nil
}

func dedupe(ids []string) []string {
	seen := make(map[string]struct{}, len(ids))
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		if _, dup := seen[id]; !dup {
			seen[id] = struct{}{}
			out = append(out, id)
		}
	}
	return out
}

// hasAncestorIn reports whether any proper ancestor of id is in set.
func hasAncestorIn(nodes map[string]treeNode, id string, set map[string]struct{}) bool {
	for p := nodes[id].parentID; p != ""; p = nodes[p].parentID {
		if _, hit := set[p]; hit {
			return true
		}
	}
	return false
}

func toSet(ids []string) map[string]struct{} {
	set := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		set[id] = struct{}{}
	}
	return set
}

func collectionExists(tx *sql.Tx, id string) error {
	var one int
	err := tx.QueryRow(`SELECT 1 FROM api_collections WHERE id = ?`, id).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("%w: %s", ErrCollectionNotFound, id)
	}
	if err != nil {
		return fmt.Errorf("repos/collections: read collection %s: %w", id, err)
	}
	return nil
}

// topmostIDs returns ids, deduped, minus any whose ancestor is also in ids; each must exist.
func topmostIDs(nodes map[string]treeNode, ids []string) ([]string, error) {
	ids = dedupe(ids)
	all := toSet(ids)
	moved := make([]string, 0, len(ids))
	for _, id := range ids {
		if _, ok := nodes[id]; !ok {
			return nil, fmt.Errorf("%w: %s", ErrItemNotFound, id)
		}
		if !hasAncestorIn(nodes, id, all) {
			moved = append(moved, id)
		}
	}
	return moved, nil
}

// checkMoveTarget validates the destination of a move and returns the target parent id ("" = root).
func checkMoveTarget(nodes map[string]treeNode, moved map[string]struct{}, collectionID string, parentID, beforeID *string) (string, error) {
	target := ""
	if parentID != nil {
		target = *parentID
		node, ok := nodes[target]
		if !ok {
			return "", fmt.Errorf("%w: %s", ErrItemNotFound, target)
		}
		if node.collectionID != collectionID {
			return "", fmt.Errorf("%w: parent %s is outside the target collection", ErrInvalidMove, target)
		}
		if node.kind != model.CollectionItemFolder {
			return "", fmt.Errorf("%w: parent %s is not a folder", ErrInvalidMove, target)
		}
		if _, self := moved[target]; self || hasAncestorIn(nodes, target, moved) {
			return "", fmt.Errorf("%w: into the item itself or a descendant", ErrInvalidMove)
		}
	}
	if beforeID != nil {
		node, ok := nodes[*beforeID]
		if !ok {
			return "", fmt.Errorf("%w: %s", ErrItemNotFound, *beforeID)
		}
		if _, moving := moved[*beforeID]; moving || node.collectionID != collectionID || node.parentID != target {
			return "", fmt.Errorf("%w: before %s", ErrInvalidMove, *beforeID)
		}
	}
	return target, nil
}

// orderWithMoved is siblings without the moved ids, the moved ids spliced in before beforeID or last.
func orderWithMoved(siblings, moved []string, movedSet map[string]struct{}, beforeID *string) []string {
	order := make([]string, 0, len(siblings)+len(moved))
	placed := false
	place := func() {
		order = append(order, moved...)
		placed = true
	}
	for _, id := range siblings {
		if _, moving := movedSet[id]; moving {
			continue
		}
		if beforeID != nil && id == *beforeID {
			place()
		}
		order = append(order, id)
	}
	if !placed {
		place()
	}
	return order
}

// MoveItems moves items, each with its subtree, under parentID of collectionID (nil = collection
// root), in argument order, before beforeID or last when beforeID is nil. One transaction: the
// target parent's order is rewritten dense, every parent the items left re-indexes dense, and a
// refused move changes nothing. An item whose ancestor is also moved rides along with that ancestor.
func (r *CollectionsRepo) MoveItems(ids []string, collectionID string, parentID, beforeID *string) error {
	if len(ids) == 0 || collectionID == "" {
		return fmt.Errorf("repos/collections: item and collection ids are required")
	}
	tx, err := r.DB.Begin()
	if err != nil {
		return fmt.Errorf("repos/collections: begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if err := collectionExists(tx, collectionID); err != nil {
		return err
	}
	nodes, children, err := loadTree(tx)
	if err != nil {
		return err
	}
	moved, err := topmostIDs(nodes, ids)
	if err != nil {
		return err
	}
	movedSet := toSet(moved)
	target, err := checkMoveTarget(nodes, movedSet, collectionID, parentID, beforeID)
	if err != nil {
		return err
	}
	order := orderWithMoved(children[nodeKey{collectionID, target}], moved, movedSet, beforeID)

	now := kiratime.NowISO()
	leftBehind := map[nodeKey]struct{}{}
	for _, id := range moved {
		node := nodes[id]
		if old := (nodeKey{node.collectionID, node.parentID}); old != (nodeKey{collectionID, target}) {
			leftBehind[old] = struct{}{}
		}
		if node.collectionID != collectionID {
			if err := moveSubtreeCollection(tx, id, collectionID, now); err != nil {
				return err
			}
		}
	}
	for i, id := range order {
		if _, isMoved := movedSet[id]; isMoved {
			if _, err := tx.Exec(`UPDATE api_items SET parent_id = ?, sort_order = ?, updated_at = ? WHERE id = ?`, parentID, i, now, id); err != nil {
				return fmt.Errorf("repos/collections: place item %s: %w", id, err)
			}
			continue
		}
		if nodes[id].index == i {
			continue
		}
		if _, err := tx.Exec(`UPDATE api_items SET sort_order = ? WHERE id = ?`, i, id); err != nil {
			return fmt.Errorf("repos/collections: reorder item %s: %w", id, err)
		}
	}
	if err := reindexPairs(tx, leftBehind); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("repos/collections: commit: %w", err)
	}
	return nil
}

func moveSubtreeCollection(tx *sql.Tx, rootID, collectionID, now string) error {
	if _, err := tx.Exec(
		`WITH RECURSIVE sub(id) AS (
		   SELECT ? UNION ALL SELECT i.id FROM api_items i JOIN sub ON i.parent_id = sub.id
		 )
		 UPDATE api_items SET collection_id = ?, updated_at = ? WHERE id IN (SELECT id FROM sub)`,
		rootID, collectionID, now,
	); err != nil {
		return fmt.Errorf("repos/collections: move subtree of %s: %w", rootID, err)
	}
	return nil
}

func reindexPairs(tx *sql.Tx, pairs map[nodeKey]struct{}) error {
	for key := range pairs {
		var parent *string
		if key.parentID != "" {
			parent = &key.parentID
		}
		if err := reindexSiblings(tx, key.collectionID, parent); err != nil {
			return err
		}
	}
	return nil
}

// DeleteMany removes whole collections and items, each item with its subtree, in one transaction:
// a missing id deletes nothing. An item inside a deleted collection or under another deleted item is
// covered by that cascade and skipped. Surviving siblings re-index dense.
func (r *CollectionsRepo) DeleteMany(collectionIDs, itemIDs []string) error {
	if len(collectionIDs) == 0 && len(itemIDs) == 0 {
		return fmt.Errorf("repos/collections: nothing to delete")
	}
	tx, err := r.DB.Begin()
	if err != nil {
		return fmt.Errorf("repos/collections: begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	collectionIDs, itemIDs = dedupe(collectionIDs), dedupe(itemIDs)
	for _, id := range collectionIDs {
		if err := collectionExists(tx, id); err != nil {
			return err
		}
	}
	nodes, _, err := loadTree(tx)
	if err != nil {
		return err
	}
	for _, id := range itemIDs {
		if _, ok := nodes[id]; !ok {
			return fmt.Errorf("%w: %s", ErrItemNotFound, id)
		}
	}
	deletedCollections, deletedItems := toSet(collectionIDs), toSet(itemIDs)

	survivors := map[nodeKey]struct{}{}
	for _, id := range itemIDs {
		node := nodes[id]
		if _, covered := deletedCollections[node.collectionID]; covered || hasAncestorIn(nodes, id, deletedItems) {
			continue
		}
		if _, err := tx.Exec(`DELETE FROM api_items WHERE id = ?`, id); err != nil {
			return fmt.Errorf("repos/collections: delete item %s: %w", id, err)
		}
		survivors[nodeKey{node.collectionID, node.parentID}] = struct{}{}
	}
	for _, id := range collectionIDs {
		res, err := tx.Exec(`DELETE FROM api_collections WHERE id = ?`, id)
		if err != nil {
			return fmt.Errorf("repos/collections: delete collection %s: %w", id, err)
		}
		if err := sqlitex.RequireOneRow(res, "collection "+id); err != nil {
			return err
		}
	}
	if err := reindexPairs(tx, survivors); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("repos/collections: commit: %w", err)
	}
	return nil
}
