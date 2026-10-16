//go:build linux

package lannet

import (
	"net/netip"
	"strings"
	"testing"
)

const routeTable = `Iface	Destination	Gateway 	Flags	RefCnt	Use	Metric	Mask		MTU	Window	IRTT
eth0	00000000	0101A8C0	0003	0	0	100	00000000	0	0	0
wlan0	00000000	010AA8C0	0003	0	0	50	00000000	0	0	0
eth1	00000000	0102A8C0	0002	0	0	10	00000000	0	0	0
eth2	00000000	0103A8C0	0001	0	0	5	00000000	0	0	0
eth0	0001A8C0	00000000	0001	0	0	100	00FFFFFF	0	0	0
`

func TestParseDefaultRoute(t *testing.T) {
	gw, iface, err := parseDefaultRoute(strings.NewReader(routeTable))
	if err != nil {
		t.Fatal(err)
	}
	if gw != netip.MustParseAddr("192.168.10.1") || iface != "wlan0" {
		t.Fatalf("got %s on %s, want 192.168.10.1 on wlan0 (lowest metric, UP+GATEWAY only)", gw, iface)
	}
}

func TestParseARP(t *testing.T) {
	tbl := `IP address       HW type     Flags       HW address            Mask     Device
192.168.1.1      0x1         0x2         AA:BB:CC:DD:EE:01     *        eth0
192.168.1.7      0x1         0x0         aa:bb:cc:dd:ee:02     *        eth0
192.168.1.8      0x1         0x2         00:00:00:00:00:00     *        eth0
192.168.1.9      0x1         0x6         aa:bb:cc:dd:ee:03     *        wlan0
`
	got, err := parseARP(strings.NewReader(tbl))
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("got %v, want complete non-zero entries only", got)
	}
	if got[netip.MustParseAddr("192.168.1.1")] != "aa:bb:cc:dd:ee:01" {
		t.Fatalf("mac not lower-cased: %v", got)
	}
	if got[netip.MustParseAddr("192.168.1.9")] != "aa:bb:cc:dd:ee:03" {
		t.Fatalf("flags 0x6 keeps the complete bit: %v", got)
	}
}
