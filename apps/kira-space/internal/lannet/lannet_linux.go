//go:build linux

package lannet

import (
	"bufio"
	"encoding/binary"
	"fmt"
	"io"
	"net/netip"
	"os"
	"strconv"
	"strings"
)

const (
	rtfUp       = 0x1
	rtfGateway  = 0x2
	arpComplete = 0x2
)

func defaultRoute() (netip.Addr, string, error) {
	f, err := os.Open("/proc/net/route")
	if err != nil {
		return netip.Addr{}, "", fmt.Errorf("lannet: %w", err)
	}
	defer f.Close()
	return parseDefaultRoute(f)
}

func arpTable() (map[netip.Addr]string, error) {
	f, err := os.Open("/proc/net/arp")
	if err != nil {
		return nil, fmt.Errorf("lannet: %w", err)
	}
	defer f.Close()
	return parseARP(f)
}

// parseDefaultRoute reads /proc/net/route: hex addresses in host byte order, little-endian on
// every supported Linux target.
func parseDefaultRoute(r io.Reader) (netip.Addr, string, error) {
	var (
		best   netip.Addr
		iface  string
		metric uint64
		found  bool
	)
	sc := bufio.NewScanner(r)
	sc.Scan() // header
	for sc.Scan() {
		f := strings.Fields(sc.Text())
		if len(f) < 8 {
			continue
		}
		dst, err1 := strconv.ParseUint(f[1], 16, 32)
		gw, err2 := strconv.ParseUint(f[2], 16, 32)
		flags, err3 := strconv.ParseUint(f[3], 16, 32)
		m, err4 := strconv.ParseUint(f[6], 10, 64)
		mask, err5 := strconv.ParseUint(f[7], 16, 32)
		if err1 != nil || err2 != nil || err3 != nil || err4 != nil || err5 != nil {
			continue
		}
		if dst != 0 || mask != 0 || flags&rtfUp == 0 || flags&rtfGateway == 0 || gw == 0 {
			continue
		}
		if found && m >= metric {
			continue
		}
		var b [4]byte
		binary.LittleEndian.PutUint32(b[:], uint32(gw))
		best, iface, metric, found = netip.AddrFrom4(b), f[0], m, true
	}
	if err := sc.Err(); err != nil {
		return netip.Addr{}, "", fmt.Errorf("lannet: read routes: %w", err)
	}
	if !found {
		return netip.Addr{}, "", ErrNoRoute
	}
	return best, iface, nil
}

// parseARP reads /proc/net/arp, keeping complete entries with a non-zero hardware address.
func parseARP(r io.Reader) (map[netip.Addr]string, error) {
	out := map[netip.Addr]string{}
	sc := bufio.NewScanner(r)
	sc.Scan() // header
	for sc.Scan() {
		f := strings.Fields(sc.Text())
		if len(f) < 6 {
			continue
		}
		ip, err := netip.ParseAddr(f[0])
		if err != nil {
			continue
		}
		flags, err := strconv.ParseUint(f[2], 0, 32)
		if err != nil || flags&arpComplete == 0 {
			continue
		}
		mac := strings.ToLower(f[3])
		if mac == "00:00:00:00:00:00" {
			continue
		}
		out[ip] = mac
	}
	if err := sc.Err(); err != nil {
		return nil, fmt.Errorf("lannet: read arp: %w", err)
	}
	return out, nil
}
