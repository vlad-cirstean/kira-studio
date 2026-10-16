//go:build !linux && !darwin

package lannet

import (
	"errors"
	"net/netip"
)

func defaultRoute() (netip.Addr, string, error) { return netip.Addr{}, "", errors.ErrUnsupported }

func arpTable() (map[netip.Addr]string, error) { return nil, errors.ErrUnsupported }
