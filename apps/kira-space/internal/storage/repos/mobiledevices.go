package repos

import (
	"database/sql"
	"errors"
	"fmt"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
	"github.com/kirathecat/kira-studio/internal/sqlitex"
)

// MobileDeviceRow is the full row, including the salted hash. Used by internal/mobileweb's token
// verification; model.MobileDevice is the projection that crosses to the renderer.
type MobileDeviceRow struct {
	ID         string
	Label      string
	UserAgent  string
	TokenHash  []byte
	TokenSalt  []byte
	CreatedAt  int64
	LastSeenAt int64
	LastIP     string
	RevokedAt  *int64
	// ExpiresAt is epoch ms; a device past it must pair again.
	ExpiresAt int64
	// CanWrite lets the phone change backlog and stages; CanAgentInput lets it reply to agents and
	// control their terminals. Both are set from the desktop pane only.
	CanWrite      bool
	CanAgentInput bool
}

// MobileDevicesRepo is the trust store for phones paired with the mobile agents web.
type MobileDevicesRepo struct {
	DB *sql.DB
}

const mobileDeviceColumns = `id, label, user_agent, token_hash, token_salt, created_at, last_seen_at, last_ip, revoked_at, can_write, can_agent_input, expires_at`

// ByID reads one row. found is false (with a nil error) when no such row exists; the timing
// discipline around a miss is the caller's job.
func (r *MobileDevicesRepo) ByID(id string) (MobileDeviceRow, bool, error) {
	var rec MobileDeviceRow
	err := r.DB.QueryRow(`SELECT `+mobileDeviceColumns+` FROM mobile_devices WHERE id = ?`, id).Scan(
		&rec.ID, &rec.Label, &rec.UserAgent, &rec.TokenHash, &rec.TokenSalt,
		&rec.CreatedAt, &rec.LastSeenAt, &rec.LastIP, &rec.RevokedAt, &rec.CanWrite, &rec.CanAgentInput, &rec.ExpiresAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return MobileDeviceRow{}, false, nil
	}
	if err != nil {
		return MobileDeviceRow{}, false, fmt.Errorf("repos: mobile device by id %s: %w", id, err)
	}
	return rec, true, nil
}

// Insert records a newly approved device. Device ids are minted server-side per approval, so a
// conflict is a bug, never a re-pair.
func (r *MobileDevicesRepo) Insert(row MobileDeviceRow) error {
	_, err := r.DB.Exec(
		`INSERT INTO mobile_devices (`+mobileDeviceColumns+`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		row.ID, row.Label, row.UserAgent, row.TokenHash, row.TokenSalt,
		row.CreatedAt, row.LastSeenAt, row.LastIP, row.RevokedAt, row.CanWrite, row.CanAgentInput, row.ExpiresAt,
	)
	if err != nil {
		return fmt.Errorf("repos: insert mobile device %s: %w", row.ID, err)
	}
	return nil
}

// TouchLastSeen records an authenticated request.
func (r *MobileDevicesRepo) TouchLastSeen(id string, now int64, ip string) error {
	res, err := r.DB.Exec(`UPDATE mobile_devices SET last_seen_at = ?, last_ip = ? WHERE id = ?`, now, ip, id)
	if err != nil {
		return fmt.Errorf("repos: touch mobile device %s: %w", id, err)
	}
	return sqlitex.RequireOneRow(res, "mobile device "+id)
}

// Revoke sets revoked_at; the row stays so the pane keeps history.
func (r *MobileDevicesRepo) Revoke(id string, now int64) error {
	res, err := r.DB.Exec(`UPDATE mobile_devices SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`, now, id)
	if err != nil {
		return fmt.Errorf("repos: revoke mobile device %s: %w", id, err)
	}
	return sqlitex.RequireOneRow(res, "mobile device "+id)
}

// SetPermissions replaces both flags on an unrevoked device.
func (r *MobileDevicesRepo) SetPermissions(id string, canWrite, canAgentInput bool) error {
	res, err := r.DB.Exec(`UPDATE mobile_devices SET can_write = ?, can_agent_input = ? WHERE id = ? AND revoked_at IS NULL`, canWrite, canAgentInput, id)
	if err != nil {
		return fmt.Errorf("repos: set mobile device permissions %s: %w", id, err)
	}
	return sqlitex.RequireOneRow(res, "mobile device "+id)
}

// List returns every device, revoked included, most recently seen first, projected to
// model.MobileDevice (never the hash or the salt).
func (r *MobileDevicesRepo) List() ([]model.MobileDevice, error) {
	rows, err := r.DB.Query(`SELECT id, label, user_agent, created_at, last_seen_at, last_ip, revoked_at, can_write, can_agent_input, expires_at FROM mobile_devices ORDER BY last_seen_at DESC`)
	return sqlitex.QueryAll(rows, err, func(rows *sql.Rows) (model.MobileDevice, bool, error) {
		var d model.MobileDevice
		err := rows.Scan(&d.ID, &d.Label, &d.UserAgent, &d.CreatedAt, &d.LastSeenAt, &d.LastIP, &d.RevokedAt, &d.CanWrite, &d.CanAgentInput, &d.ExpiresAt)
		return d, true, err
	})
}
