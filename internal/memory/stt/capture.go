package stt

import "math"

// Microphone audio is 16 kHz mono signed 16-bit, the model's rate.
const (
	captureRate = 16000
	chunkFrames = 1600 // 100 ms
)

// MicOpener starts capturing the default input device and calls onPCM with raw samples from the
// audio thread, so onPCM must not block. The returned stop is safe to call once.
type MicOpener func(onPCM func([]int16)) (stop func(), err error)

// rms is the root-mean-square level of pcm in 0..1.
func rms(pcm []int16) float64 {
	if len(pcm) == 0 {
		return 0
	}
	var sum float64
	for _, v := range pcm {
		f := float64(v) / 32768
		sum += f * f
	}
	return math.Sqrt(sum / float64(len(pcm)))
}

func allZero(pcm []int16) bool {
	for _, v := range pcm {
		if v != 0 {
			return false
		}
	}
	return true
}
