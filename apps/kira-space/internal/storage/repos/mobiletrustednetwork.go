package repos

import (
	"database/sql"
	"errors"
	"fmt"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
)

// MobileTrustedNetworkRepo holds the single trusted network (row id 1).
type MobileTrustedNetworkRepo struct {
	DB *sql.DB
}

// Get reads the trusted network; found is false when none is set.
func (r *MobileTrustedNetworkRepo) Get() (model.TrustedNetwork, bool, error) {
	var n model.TrustedNetwork
	err := r.DB.QueryRow(`SELECT subnet, router_ip, router_mac, interface, trusted_at FROM mobile_trusted_network WHERE id = 1`).
		Scan(&n.Subnet, &n.RouterIP, &n.RouterMAC, &n.Interface, &n.TrustedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return model.TrustedNetwork{}, false, nil
	}
	if err != nil {
		return model.TrustedNetwork{}, false, fmt.Errorf("repos: get mobile trusted network: %w", err)
	}
	return n, true, nil
}

// Set replaces the trusted network.
func (r *MobileTrustedNetworkRepo) Set(n model.TrustedNetwork) error {
	_, err := r.DB.Exec(
		`INSERT INTO mobile_trusted_network (id, subnet, router_ip, router_mac, interface, trusted_at) VALUES (1, ?, ?, ?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET subnet = excluded.subnet, router_ip = excluded.router_ip,
		   router_mac = excluded.router_mac, interface = excluded.interface, trusted_at = excluded.trusted_at`,
		n.Subnet, n.RouterIP, n.RouterMAC, n.Interface, n.TrustedAt,
	)
	if err != nil {
		return fmt.Errorf("repos: set mobile trusted network: %w", err)
	}
	return nil
}

// Clear forgets the trusted network.
func (r *MobileTrustedNetworkRepo) Clear() error {
	if _, err := r.DB.Exec(`DELETE FROM mobile_trusted_network WHERE id = 1`); err != nil {
		return fmt.Errorf("repos: clear mobile trusted network: %w", err)
	}
	return nil
}
