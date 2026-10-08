// Package lannet identifies the trusted local network: subnet, router IP and router MAC. It reads
// the kernel routing and ARP tables only; it sends no probe traffic and needs no OS permission.
package lannet

import (
	"errors"
	"fmt"
	"net"
	"net/netip"
	"strings"
)

// Identity names a network. Interface names are not part of it: Wi-Fi and Ethernet on one LAN match.
type Identity struct {
	Subnet    netip.Prefix // masked, e.g. 192.168.1.0/24
	RouterIP  netip.Addr
	RouterMAC string // lower-case, colon-separated
}

// Network is a local interface address on an identified network.
type Network struct {
	Interface string
	Addr      netip.Prefix // interface address with its prefix length, e.g. 192.168.1.20/24
	Identity  Identity
}

var (
	ErrNoRoute     = errors.New("No network connection.")
	ErrNotLAN      = errors.New("This network is not a private local network.")
	ErrNoRouterMAC = errors.New("The router is not visible from this computer. A VPN may route all traffic, or the network was just joined; try again in a moment.")
	ErrAway        = errors.New("This computer is not on the trusted network.")
	ErrOtherRouter = errors.New("The router on this network is not the trusted one.")
)

// IsLAN reports whether a is a private or link-local IPv4 address.
func IsLAN(a netip.Addr) bool {
	a = a.Unmap()
	return a.Is4() && (a.IsPrivate() || a.IsLinkLocalUnicast())
}

// Detect identifies the network behind the default IPv4 route.
func Detect() (Network, error) {
	gw, ifName, err := defaultRoute()
	if err != nil {
		return Network{}, err
	}
	ifc, err := net.InterfaceByName(ifName)
	if err != nil {
		return Network{}, fmt.Errorf("%w: %v", ErrNoRoute, err)
	}
	var addr netip.Prefix
	for _, p := range ifaceV4(ifc) {
		if p.Contains(gw) {
			addr = p
			break
		}
	}
	if !addr.IsValid() {
		return Network{}, ErrNoRoute
	}
	if !IsLAN(addr.Addr()) {
		return Network{}, ErrNotLAN
	}
	table, err := arpTable()
	if err != nil {
		return Network{}, err
	}
	mac, ok := table[gw]
	if !ok {
		return Network{}, ErrNoRouterMAC
	}
	return Network{
		Interface: ifc.Name,
		Addr:      addr,
		Identity:  Identity{Subnet: addr.Masked(), RouterIP: gw, RouterMAC: mac},
	}, nil
}

// Find reports whether the identified network exists on this machine now. It ignores the default
// route, so a VPN owning it does not hide a directly attached LAN.
func Find(id Identity) (Network, error) {
	ifaces, err := net.Interfaces()
	if err != nil {
		return Network{}, fmt.Errorf("lannet: list interfaces: %w", err)
	}
	var found *Network
	for i := range ifaces {
		ifc := &ifaces[i]
		if ifc.Flags&net.FlagUp == 0 || ifc.Flags&net.FlagLoopback != 0 {
			continue
		}
		for _, p := range ifaceV4(ifc) {
			if p.Masked() != id.Subnet {
				continue
			}
			if found == nil || ifc.Index < indexOf(ifaces, found.Interface) {
				found = &Network{Interface: ifc.Name, Addr: p, Identity: id}
			}
			break
		}
	}
	if found == nil {
		return Network{}, ErrAway
	}
	table, err := arpTable()
	if err != nil {
		return Network{}, err
	}
	mac, ok := table[id.RouterIP]
	if !ok {
		return Network{}, ErrNoRouterMAC
	}
	if !strings.EqualFold(mac, id.RouterMAC) {
		return Network{}, ErrOtherRouter
	}
	return *found, nil
}

func indexOf(ifaces []net.Interface, name string) int {
	for _, i := range ifaces {
		if i.Name == name {
			return i.Index
		}
	}
	return 0
}

func ifaceV4(ifc *net.Interface) []netip.Prefix {
	addrs, err := ifc.Addrs()
	if err != nil {
		return nil
	}
	var out []netip.Prefix
	for _, a := range addrs {
		ipnet, ok := a.(*net.IPNet)
		if !ok {
			continue
		}
		ip, ok := netip.AddrFromSlice(ipnet.IP)
		if !ok {
			continue
		}
		ip = ip.Unmap()
		ones, _ := ipnet.Mask.Size()
		if ip.Is4() && ones > 0 {
			out = append(out, netip.PrefixFrom(ip, ones))
		}
	}
	return out
}
