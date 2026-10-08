//go:build darwin

package lannet

import (
	"fmt"
	"net"
	"net/netip"
	"syscall"

	"golang.org/x/net/route"
)

func defaultRoute() (netip.Addr, string, error) {
	rib, err := route.FetchRIB(syscall.AF_INET, route.RIBTypeRoute, 0)
	if err != nil {
		return netip.Addr{}, "", fmt.Errorf("lannet: fetch routes: %w", err)
	}
	msgs, err := route.ParseRIB(route.RIBTypeRoute, rib)
	if err != nil {
		return netip.Addr{}, "", fmt.Errorf("lannet: parse routes: %w", err)
	}
	gw, idx, ok := selectDefaultRoute(msgs)
	if !ok {
		return netip.Addr{}, "", ErrNoRoute
	}
	ifc, err := net.InterfaceByIndex(idx)
	if err != nil {
		return netip.Addr{}, "", fmt.Errorf("%w: %v", ErrNoRoute, err)
	}
	return gw, ifc.Name, nil
}

func arpTable() (map[netip.Addr]string, error) {
	rib, err := route.FetchRIB(syscall.AF_INET, route.RIBType(syscall.NET_RT_FLAGS), syscall.RTF_LLINFO)
	if err != nil {
		return nil, fmt.Errorf("lannet: fetch arp: %w", err)
	}
	msgs, err := route.ParseRIB(route.RIBTypeRoute, rib)
	if err != nil {
		return nil, fmt.Errorf("lannet: parse arp: %w", err)
	}
	return arpFromMessages(msgs), nil
}

// selectDefaultRoute picks the unscoped default gateway route. macOS keeps interface-scoped
// duplicates (RTF_IFSCOPE) that must not win.
func selectDefaultRoute(msgs []route.Message) (netip.Addr, int, bool) {
	for _, m := range msgs {
		rm, ok := m.(*route.RouteMessage)
		if !ok || len(rm.Addrs) <= syscall.RTAX_GATEWAY {
			continue
		}
		if rm.Flags&syscall.RTF_UP == 0 || rm.Flags&syscall.RTF_GATEWAY == 0 || rm.Flags&syscall.RTF_IFSCOPE != 0 {
			continue
		}
		dst, ok := rm.Addrs[syscall.RTAX_DST].(*route.Inet4Addr)
		if !ok || dst.IP != [4]byte{} {
			continue
		}
		if len(rm.Addrs) > syscall.RTAX_NETMASK {
			if mask, ok := rm.Addrs[syscall.RTAX_NETMASK].(*route.Inet4Addr); ok && mask.IP != [4]byte{} {
				continue
			}
		}
		gw, ok := rm.Addrs[syscall.RTAX_GATEWAY].(*route.Inet4Addr)
		if !ok {
			continue
		}
		return netip.AddrFrom4(gw.IP), rm.Index, true
	}
	return netip.Addr{}, 0, false
}

// arpFromMessages maps destination IPv4 to the 6-byte link-layer gateway of each ARP entry.
func arpFromMessages(msgs []route.Message) map[netip.Addr]string {
	out := map[netip.Addr]string{}
	for _, m := range msgs {
		rm, ok := m.(*route.RouteMessage)
		if !ok || len(rm.Addrs) <= syscall.RTAX_GATEWAY {
			continue
		}
		dst, ok := rm.Addrs[syscall.RTAX_DST].(*route.Inet4Addr)
		if !ok {
			continue
		}
		ll, ok := rm.Addrs[syscall.RTAX_GATEWAY].(*route.LinkAddr)
		if !ok || len(ll.Addr) != 6 {
			continue
		}
		mac := formatMAC(ll.Addr)
		if mac == "00:00:00:00:00:00" {
			continue
		}
		out[netip.AddrFrom4(dst.IP)] = mac
	}
	return out
}

func formatMAC(b []byte) string {
	return net.HardwareAddr(b).String()
}
