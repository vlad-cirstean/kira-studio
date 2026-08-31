package mariadb

import (
	"github.com/kirathecat/kira-studio/shell/internal/adapters"
	"github.com/kirathecat/kira-studio/shell/internal/adapters/mysqlfamily"
)

func init() {
	adapters.Register("mariadb", func(deps adapters.Deps) (adapters.Adapter, error) {
		profile := mysqlfamily.Profile{Kind: "mariadb", ServerLabel: "MariaDB", ApplyEngineOptions: applyEngineOptions}
		return mysqlfamily.New(deps, profile, caps), nil
	})
}
