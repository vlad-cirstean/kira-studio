package mysqlfamily

import (
	"errors"
	"net"
	"syscall"

	"github.com/go-sql-driver/mysql"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters"
)

// mapError is errors.ts's mapError. B22 removes the two RSA-key branches (errno 45044/45063):
// go-sql-driver has no allowPublicKeyRetrieval gate to fail this specific way (§1.11).
func mapError(err error) *adapters.Error {
	if err == nil {
		return nil
	}
	message := err.Error()

	var myErr *mysql.MySQLError
	if errors.As(err, &myErr) {
		switch myErr.Number {
		case 1045:
			return adapters.New(adapters.CodeAuth, message, err)
		case 1317:
			return adapters.New(adapters.CodeCancelled, message, err)
		}
		return adapters.New(adapters.CodeQuery, message, err)
	}

	var dnsErr *net.DNSError
	if errors.As(err, &dnsErr) {
		return adapters.New(adapters.CodeConnect, message, err)
	}
	if errors.Is(err, syscall.ECONNREFUSED) {
		return adapters.New(adapters.CodeConnect, message, err)
	}
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return adapters.New(adapters.CodeConnect, message, err)
	}

	return adapters.New(adapters.CodeQuery, message, err)
}
