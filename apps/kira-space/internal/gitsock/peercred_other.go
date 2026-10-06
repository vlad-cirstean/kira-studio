//go:build !linux && !darwin

package gitsock

import (
	"errors"
	"net"
)

// peerCred has no implementation here, so the server fails closed and closes the connection.
func peerCred(net.Conn) (peer, error) {
	return peer{}, errors.New("gitsock: peer credentials are not supported on this platform")
}
