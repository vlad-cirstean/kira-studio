//go:build !cgo

package stt

import "errors"

// OpenMic is unavailable without cgo.
func OpenMic(func([]int16)) (func(), error) {
	return nil, errors.New("microphone capture needs a cgo build")
}
