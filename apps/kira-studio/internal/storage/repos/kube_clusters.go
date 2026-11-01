package repos

import (
	"database/sql"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/kubernetes"
)

// KubeClustersRepo reads and writes kube_clusters (P439).
type KubeClustersRepo struct {
	DB *sql.DB
}

var _ kubernetes.ClusterStore = (*KubeClustersRepo)(nil)

const kubeClusterCols = `id, context, server, created_at, last_seen_at`

func (r *KubeClustersRepo) Ensure(context, server string, now time.Time) (kubernetes.ClusterRecord, error) {
	ts := now.UnixMilli()
	row := r.DB.QueryRow(
		`INSERT INTO kube_clusters (id, context, server, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)
		 ON CONFLICT(context, server) DO UPDATE SET last_seen_at = excluded.last_seen_at
		 RETURNING `+kubeClusterCols,
		uuid.NewString(), context, server, ts, ts)
	return scanKubeCluster(row)
}

func (r *KubeClustersRepo) Get(id string) (kubernetes.ClusterRecord, bool, error) {
	rec, err := scanKubeCluster(r.DB.QueryRow(`SELECT `+kubeClusterCols+` FROM kube_clusters WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return kubernetes.ClusterRecord{}, false, nil
	}
	return rec, err == nil, err
}

func scanKubeCluster(row *sql.Row) (kubernetes.ClusterRecord, error) {
	var (
		rec           kubernetes.ClusterRecord
		created, seen int64
	)
	if err := row.Scan(&rec.ID, &rec.Context, &rec.Server, &created, &seen); err != nil {
		return kubernetes.ClusterRecord{}, err
	}
	rec.CreatedAt, rec.LastSeenAt = time.UnixMilli(created), time.UnixMilli(seen)
	return rec, nil
}
