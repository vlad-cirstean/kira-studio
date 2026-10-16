package mobileweb

import (
	"net"
	"net/netip"
)

// peerAllowed admits only a private or link-local IPv4 peer inside the bound interface's subnet:
// the server is LAN-only even if a router forwards the port to it.
func peerAllowed(remoteAddr string, bound netip.Prefix, isLAN func(netip.Addr) bool) bool {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		return false
	}
	peer, err := netip.ParseAddr(host)
	if err != nil {
		return false
	}
	peer = peer.Unmap()
	return isLAN(peer) && bound.Masked().Contains(peer)
}

// hostAllowed is the DNS-rebinding guard: the Host header must be the bound address itself, as an
// IP literal. No hostname ever matches.
func hostAllowed(hostHeader string, bound netip.Addr) bool {
	host := hostHeader
	if h, _, err := net.SplitHostPort(hostHeader); err == nil {
		host = h
	}
	ip, err := netip.ParseAddr(host)
	return err == nil && ip.Unmap() == bound
}
