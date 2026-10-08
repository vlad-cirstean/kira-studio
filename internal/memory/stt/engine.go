package stt

import (
	"errors"

	"github.com/kirathecat/kira-studio/internal/memory/stt/transcript"
)

// ErrNoEngine means this binary was built without the whisper.cpp library.
var ErrNoEngine = errors.New("speech engine is not built into this binary")

// engine is the whisper.cpp surface the stream needs. The real one is cgo behind the whisper tag.
type engine interface {
	// vad returns one speech probability per 512 samples; len(samples) is a multiple of 512.
	vad(samples []float32) ([]float32, error)
	resetVAD()
	// transcribe decodes samples. final enables temperature fallback; prompt primes the decoder.
	transcribe(samples []float32, final bool, prompt string) ([]transcript.Word, error)
	close()
}
