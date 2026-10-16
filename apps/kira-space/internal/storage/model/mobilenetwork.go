package model

// TrustedNetwork is the one network the phone web server may run on (mobile_trusted_network,
// id 1). Interface is display only: Wi-Fi and Ethernet on one LAN both match.
type TrustedNetwork struct {
	Subnet    string `json:"subnet"`
	RouterIP  string `json:"routerIp"`
	RouterMAC string `json:"routerMac"`
	Interface string `json:"interface"`
	TrustedAt int64  `json:"trustedAt"`
}
