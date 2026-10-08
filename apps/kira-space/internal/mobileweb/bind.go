package mobileweb

import (
	"fmt"
	"net"
	"net/netip"
	"os"
	"sort"
	"strings"
)

// PrivateAddrs lists the addresses the server binds: the private IPv4 (RFC 1918) address of every
// up interface, plus loopback. Never a wildcard and never a public address. IPv6 is not served.
func PrivateAddrs() ([]net.IP, error) {
	ifaces, err := net.Interfaces()
	if err != nil {
		return nil, fmt.Errorf("mobileweb: list interfaces: %w", err)
	}
	out := []net.IP{net.IPv4(127, 0, 0, 1).To4()}
	for _, ifc := range ifaces {
		if ifc.Flags&net.FlagUp == 0 || ifc.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, err := ifc.Addrs()
		if err != nil {
			continue
		}
		for _, a := range addrs {
			ipnet, ok := a.(*net.IPNet)
			if !ok {
				continue
			}
			if ip4 := ipnet.IP.To4(); ip4 != nil && ip4.IsPrivate() {
				out = append(out, ip4)
			}
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].String() < out[j].String() })
	return dedupeIPs(out), nil
}

func dedupeIPs(ips []net.IP) []net.IP {
	seen := map[string]bool{}
	out := ips[:0]
	for _, ip := range ips {
		if !seen[ip.String()] {
			seen[ip.String()] = true
			out = append(out, ip)
		}
	}
	return out
}

// allowedRemote admits only loopback and RFC 1918 peers: the server is LAN-only even if a router
// forwards a port to it.
func allowedRemote(remoteAddr string) bool {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		return false
	}
	addr, err := netip.ParseAddr(host)
	if err != nil {
		return false
	}
	addr = addr.Unmap()
	return addr.Is4() && (addr.IsLoopback() || addr.IsPrivate())
}

// mdnsName is the `<hostname>.local` name the leaf certificate and Host check accept.
func mdnsName() string {
	h, err := os.Hostname()
	if err != nil || h == "" {
		return ""
	}
	h = strings.ToLower(strings.TrimSuffix(strings.ToLower(h), ".local"))
	if i := strings.IndexByte(h, '.'); i >= 0 {
		h = h[:i]
	}
	var b strings.Builder
	for _, r := range h {
		if r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '-' {
			b.WriteRune(r)
		}
	}
	if b.Len() == 0 {
		return ""
	}
	return b.String() + ".local"
}

// hostAllowed is the DNS-rebinding guard: the Host header must name a bound address, the
// machine's `.local` name or localhost. A rebound attacker name never matches.
func hostAllowed(hostHeader string, bound []net.IP, mdns string) bool {
	host := hostHeader
	if h, _, err := net.SplitHostPort(hostHeader); err == nil {
		host = h
	}
	host = strings.TrimSuffix(strings.ToLower(host), ".")
	if host == "" {
		return false
	}
	if ip := net.ParseIP(host); ip != nil {
		for _, b := range bound {
			if b.Equal(ip) {
				return true
			}
		}
		return false
	}
	return host == "localhost" || (mdns != "" && host == mdns)
}
