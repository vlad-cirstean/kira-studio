//go:build whisper && cgo

package stt

/*
#cgo LDFLAGS: -lwhisper -lggml -lggml-cpu -lggml-base -lm -lstdc++ -lpthread
#cgo darwin LDFLAGS: -lggml-metal -lggml-blas -lggml-base -framework Accelerate -framework Metal -framework Foundation
#include <stdlib.h>
#include "whisper.h"

static void quiet_log(enum ggml_log_level level, const char *text, void *user) {
	(void)level; (void)text; (void)user;
}

static void silence_logs(void) { whisper_log_set(quiet_log, NULL); }

static struct whisper_context *load_model(const char *path, bool use_gpu) {
	struct whisper_context_params p = whisper_context_default_params();
	p.use_gpu = use_gpu;
	p.flash_attn = true;
	return whisper_init_from_file_with_params(path, p);
}

static struct whisper_vad_context *load_vad(const char *path, int threads) {
	struct whisper_vad_context_params p = whisper_vad_default_context_params();
	p.use_gpu = false;
	p.n_threads = threads;
	return whisper_vad_init_from_file_with_params(path, p);
}

// audio_ctx is fixed: changing it between passes reallocates buffers and is no faster.
static int run_full(struct whisper_context *ctx, const float *samples, int n, int threads, bool final, const char *prompt) {
	struct whisper_full_params p = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
	p.n_threads = threads;
	p.language = "en";
	p.translate = false;
	p.detect_language = false;
	p.no_context = true;
	p.print_progress = false;
	p.print_realtime = false;
	p.print_timestamps = false;
	p.print_special = false;
	p.token_timestamps = true;
	p.suppress_nst = true;
	p.audio_ctx = 640;
	p.temperature = 0.0f;
	p.temperature_inc = final ? 0.2f : 0.0f;
	p.initial_prompt = (prompt && prompt[0]) ? prompt : NULL;
	return whisper_full(ctx, p, samples, n);
}
*/
import "C"

import (
	"errors"
	"fmt"
	"runtime"
	"strings"
	"unsafe"

	"github.com/kirathecat/kira-studio/internal/memory/stt/transcript"
)

// Built reports whether this binary carries the whisper.cpp engine.
const Built = true

type whisperEngine struct {
	ctx     *C.struct_whisper_context
	vctx    *C.struct_whisper_vad_context
	threads C.int
}

func newEngine(modelDir string) (engine, error) {
	C.silence_logs()
	threads := C.int(min(4, runtime.NumCPU()))
	// Metal is the fast path on Apple Silicon; Intel Macs and Linux run the CPU backend.
	gpu := runtime.GOOS == "darwin" && runtime.GOARCH == "arm64"

	mp := C.CString(modelDir + "/" + ModelFile)
	defer C.free(unsafe.Pointer(mp))
	ctx := C.load_model(mp, C.bool(gpu))
	if ctx == nil {
		return nil, errors.New("stt: load whisper model failed")
	}
	vp := C.CString(modelDir + "/" + VADFile)
	defer C.free(unsafe.Pointer(vp))
	vctx := C.load_vad(vp, 1)
	if vctx == nil {
		C.whisper_free(ctx)
		return nil, errors.New("stt: load VAD model failed")
	}
	return &whisperEngine{ctx: ctx, vctx: vctx, threads: threads}, nil
}

func (e *whisperEngine) close() {
	C.whisper_vad_free(e.vctx)
	C.whisper_free(e.ctx)
}

func (e *whisperEngine) resetVAD() { C.whisper_vad_reset_state(e.vctx) }

func (e *whisperEngine) vad(samples []float32) ([]float32, error) {
	if len(samples) == 0 {
		return nil, nil
	}
	if !C.whisper_vad_detect_speech_no_reset(e.vctx, (*C.float)(unsafe.Pointer(&samples[0])), C.int(len(samples))) {
		return nil, errors.New("stt: VAD failed")
	}
	n := int(C.whisper_vad_n_probs(e.vctx))
	if n != len(samples)/frame {
		return nil, fmt.Errorf("stt: VAD returned %d probabilities for %d frames", n, len(samples)/frame)
	}
	probs := unsafe.Slice((*float32)(unsafe.Pointer(C.whisper_vad_probs(e.vctx))), n)
	return append([]float32(nil), probs...), nil
}

func (e *whisperEngine) transcribe(samples []float32, final bool, prompt string) ([]transcript.Word, error) {
	if len(samples) == 0 {
		return nil, nil
	}
	cp := C.CString(prompt)
	defer C.free(unsafe.Pointer(cp))
	if rc := C.run_full(e.ctx, (*C.float)(unsafe.Pointer(&samples[0])), C.int(len(samples)), e.threads, C.bool(final), cp); rc != 0 {
		return nil, fmt.Errorf("stt: whisper_full failed (%d)", int(rc))
	}
	eot := C.whisper_token_eot(e.ctx)
	var words []transcript.Word
	for i := C.int(0); i < C.whisper_full_n_segments(e.ctx); i++ {
		for j := C.int(0); j < C.whisper_full_n_tokens(e.ctx, i); j++ {
			if C.whisper_full_get_token_id(e.ctx, i, j) >= eot {
				continue
			}
			text := C.GoString(C.whisper_full_get_token_text(e.ctx, i, j))
			end := int(C.whisper_full_get_token_data(e.ctx, i, j).t1) * 10
			words = appendToken(words, text, end)
		}
	}
	return words, nil
}

// appendToken starts a new word at a token with a leading space and extends the last word
// otherwise, so punctuation and word pieces attach to the word before them.
func appendToken(words []transcript.Word, text string, endMS int) []transcript.Word {
	piece := strings.TrimSpace(text)
	if piece == "" {
		return words
	}
	if len(words) == 0 || strings.HasPrefix(text, " ") {
		return append(words, transcript.Word{Text: piece, EndMS: endMS})
	}
	last := &words[len(words)-1]
	last.Text += piece
	last.EndMS = max(last.EndMS, endMS)
	return words
}
