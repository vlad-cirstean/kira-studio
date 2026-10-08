//go:build cgo

package stt

import (
	"encoding/binary"
	"fmt"

	"github.com/gen2brain/malgo"
)

// OpenMic captures the default input device through miniaudio. The device is asked for 16 kHz
// mono s16 and miniaudio resamples; audio never reaches the webview.
func OpenMic(onPCM func([]int16)) (func(), error) {
	ctx, err := malgo.InitContext(nil, malgo.ContextConfig{}, nil)
	if err != nil {
		return nil, fmt.Errorf("audio context: %w", err)
	}
	cfg := malgo.DefaultDeviceConfig(malgo.Capture)
	cfg.Capture.Format = malgo.FormatS16
	cfg.Capture.Channels = 1
	cfg.SampleRate = captureRate
	cfg.PeriodSizeInFrames = 1536
	dev, err := malgo.InitDevice(ctx.Context, cfg, malgo.DeviceCallbacks{
		Data: func(_, in []byte, frames uint32) {
			n := min(int(frames), len(in)/2)
			pcm := make([]int16, n)
			for i := range pcm {
				pcm[i] = int16(binary.LittleEndian.Uint16(in[2*i:]))
			}
			onPCM(pcm)
		},
	})
	if err != nil {
		_ = ctx.Uninit()
		ctx.Free()
		return nil, fmt.Errorf("open microphone: %w", err)
	}
	if err := dev.Start(); err != nil {
		dev.Uninit()
		_ = ctx.Uninit()
		ctx.Free()
		return nil, fmt.Errorf("start microphone: %w", err)
	}
	return func() {
		dev.Uninit()
		_ = ctx.Uninit()
		ctx.Free()
	}, nil
}
