package adapters

import (
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/page"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

// DefaultConsoleCap bounds one console statement's result. 10,000 rows matches the data tab's
// largest page size; 64 MiB bounds the cell bytes one result holds regardless of row width.
var DefaultConsoleCap = page.ResultCap{Rows: 10_000, Bytes: 64 << 20}

// ConsoleCapFor resolves req's cap: a zero field takes the default, a field above the default is
// clamped down to it.
func ConsoleCapFor(req model.ConsoleRequest) page.ResultCap {
	c := req.Cap
	if c.Rows <= 0 || c.Rows > DefaultConsoleCap.Rows {
		c.Rows = DefaultConsoleCap.Rows
	}
	if c.Bytes <= 0 || c.Bytes > DefaultConsoleCap.Bytes {
		c.Bytes = DefaultConsoleCap.Bytes
	}
	return c
}
