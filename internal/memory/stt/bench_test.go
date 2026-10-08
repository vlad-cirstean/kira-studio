//go:build whisper && sttbench

package stt

import (
	"bufio"
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"slices"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	sherpa "github.com/k2-fsa/sherpa-onnx-go/sherpa_onnx"

	"github.com/kirathecat/kira-studio/internal/memory/modelstore"
	"github.com/kirathecat/kira-studio/internal/memory/stt/transcript"
)

// P218 step 1 engine comparison. Needs the whisper.cpp libs for the baseline
// (sh scripts/fetch-whisper.sh linux-x64) and fixtures from testdata/bench/prepare.py.
//
//	KIRA_STT_BENCH_DIR     fixtures (prepare.py output)
//	KIRA_STT_BENCH_MODELS  model home, downloaded through modelstore.Install
//	KIRA_STT_BENCH_OUT     JSON lines, one per session
//	KIRA_STT_BENCH_ENGINES comma list of baseline,c1..c5 (default all)
//	KIRA_STT_BENCH_ONLY    comma list of fixtures f1,f5,f2,f3,f4 (default all)
//	KIRA_STT_BENCH_NOEMPTY=1 skips the baseline's empty-glossary run
//	KIRA_STT_BENCH_INSTALL_ONLY=1 downloads and verifies the models, runs nothing
//	c5 hotwords need <model dir>/bpe.vocab, from bpe.model: sentencepiece id_to_piece and get_score, tab separated
//	go test -tags whisper,sttbench ./internal/memory/stt/ -run '^TestBench$' -timeout 0 -v
//	KIRA_STT_BENCH_REPORT=<jsonl> go test -tags whisper,sttbench ./internal/memory/stt/ -run '^TestBenchReport$' -v

func init() {
	spec := os.Getenv("KIRA_STT_BENCH_WORKER")
	if spec == "" {
		return
	}
	id, dir, _ := strings.Cut(spec, ":")
	var gloss []string
	if g := os.Getenv("KIRA_STT_BENCH_GLOSSARY"); g != "" {
		gloss = strings.Split(g, "\n")
	}
	eng, err := newBenchEngine(id, dir, gloss)
	out := bufio.NewWriter(os.Stdout)
	if err != nil {
		_ = json.NewEncoder(out).Encode(hello{Error: err.Error()})
		_ = out.Flush()
		os.Exit(2)
	}
	// The baseline's Silero state is uninitialised until the first reset; without this its first
	// session decides on garbage and drops the opening seconds of speech (measured, see the doc).
	eng.resetVAD()
	eng = &timedEngine{engine: eng, log: os.Getenv("KIRA_STT_BENCH_DECODELOG")}
	code := serve(os.Stdin, out, eng)
	eng.close()
	os.Exit(code)
}

// timedEngine logs every transcribe call so the host can derive decode time and commit cuts.
type timedEngine struct {
	engine
	log string
}

type decodeRec struct {
	Final   bool   `json:"final"`
	Samples int    `json:"samples"`
	NS      int64  `json:"ns"`
	Text    string `json:"text,omitempty"`
	Prompt  string `json:"prompt,omitempty"`
}

func (e *timedEngine) vad(samples []float32) ([]float32, error) {
	if e.log != "" && os.Getenv("KIRA_STT_BENCH_VADLOG") != "" {
		if f, err := os.OpenFile(e.log+".vad", os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644); err == nil {
			fmt.Fprintf(f, "%d %d\n", time.Now().UnixMilli(), len(samples))
			_ = f.Close()
		}
	}
	return e.engine.vad(samples)
}

func (e *timedEngine) transcribe(samples []float32, final bool, prompt string) ([]transcript.Word, error) {
	t0 := time.Now()
	w, err := e.engine.transcribe(samples, final, prompt)
	if e.log != "" {
		if f, ferr := os.OpenFile(e.log, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644); ferr == nil {
			b, _ := json.Marshal(decodeRec{Final: final, Samples: len(samples), NS: time.Since(t0).Nanoseconds(), Text: transcript.Text(w), Prompt: prompt})
			_, _ = f.Write(append(b, '\n'))
			_ = f.Close()
		}
	}
	return w, err
}

func benchThreads() int { return min(4, runtime.NumCPU()) }

// benchVAD adapts sherpa's segment based Silero VAD to the per-frame engine contract.
type benchVAD struct{ v *sherpa.VoiceActivityDetector }

func newBenchVAD(path string) (*benchVAD, error) {
	v := sherpa.NewVoiceActivityDetector(&sherpa.VadModelConfig{
		SileroVad: sherpa.SileroVadModelConfig{
			Model: path, Threshold: speechProb, WindowSize: frame,
			MinSilenceDuration: float32(frame) / sampleRate, MinSpeechDuration: float32(frame) / sampleRate,
			MaxSpeechDuration: 3600,
		},
		SampleRate: sampleRate, NumThreads: 1, Provider: "cpu",
	}, 30)
	if v == nil {
		return nil, fmt.Errorf("load VAD %s failed", path)
	}
	return &benchVAD{v: v}, nil
}

func (b *benchVAD) vad(samples []float32) ([]float32, error) {
	out := make([]float32, 0, len(samples)/frame)
	for i := 0; i+frame <= len(samples); i += frame {
		b.v.AcceptWaveform(samples[i : i+frame])
		p := float32(0)
		if b.v.IsSpeech() {
			p = 1
		}
		out = append(out, p)
		for !b.v.IsEmpty() {
			b.v.Pop()
		}
	}
	return out, nil
}

func (b *benchVAD) resetVAD() { b.v.Reset() }
func (b *benchVAD) closeVAD() { sherpa.DeleteVoiceActivityDetector(b.v) }

// benchOffline is C1 to C4: sherpa's offline recognizer over one window per call.
type benchOffline struct {
	*benchVAD
	rec *sherpa.OfflineRecognizer
}

func (e *benchOffline) close() {
	sherpa.DeleteOfflineRecognizer(e.rec)
	e.closeVAD()
}

func (e *benchOffline) transcribe(samples []float32, _ bool, _ string) ([]transcript.Word, error) {
	if len(samples) == 0 {
		return nil, nil
	}
	s := sherpa.NewOfflineStream(e.rec)
	defer sherpa.DeleteOfflineStream(s)
	s.AcceptWaveform(sampleRate, samples)
	e.rec.Decode(s)
	return offlineWords(s.GetResult()), nil
}

func offlineWords(r *sherpa.OfflineRecognizerResult) []transcript.Word {
	if len(r.Tokens) > 0 && len(r.Timestamps) == len(r.Tokens) {
		var words []transcript.Word
		for i, tok := range r.Tokens {
			words = appendToken(words, tok, int(r.Timestamps[i]*1000))
		}
		if strings.Join(strings.Fields(transcript.Text(words)), " ") == strings.Join(strings.Fields(r.Text), " ") {
			return words
		}
	}
	var words []transcript.Word
	for _, f := range strings.Fields(r.Text) {
		words = append(words, transcript.Word{Text: f})
	}
	return words
}

// benchZipformer is C5: the streaming transducer fed one window, then casing and punctuation.
type benchZipformer struct {
	*benchVAD
	rec   *sherpa.OnlineRecognizer
	punct *sherpa.OnlinePunctuation
}

func (e *benchZipformer) close() {
	sherpa.DeleteOnlineRecognizer(e.rec)
	if e.punct != nil {
		sherpa.DeleteOnlinePunctuation(e.punct)
	}
	e.closeVAD()
}

func (e *benchZipformer) transcribe(samples []float32, _ bool, _ string) ([]transcript.Word, error) {
	if len(samples) == 0 {
		return nil, nil
	}
	s := sherpa.NewOnlineStream(e.rec)
	defer sherpa.DeleteOnlineStream(s)
	s.AcceptWaveform(sampleRate, samples)
	s.AcceptWaveform(sampleRate, make([]float32, sampleRate*2/3))
	s.InputFinished()
	for e.rec.IsReady(s) {
		e.rec.Decode(s)
	}
	text := strings.TrimSpace(e.rec.GetResult(s).Text)
	if text == "" {
		return nil, nil
	}
	if e.punct != nil {
		text = e.punct.AddPunct(strings.ToLower(text))
	}
	var words []transcript.Word
	for _, f := range strings.Fields(text) {
		words = append(words, transcript.Word{Text: f})
	}
	return words, nil
}

type benchCand struct {
	id, label string
	spec      Spec
}

const hfBase = "https://huggingface.co/"

func hf(repo, rev, name, local, sha string, size int64) modelstore.File {
	return modelstore.File{Name: local, URL: hfBase + repo + "/resolve/" + rev + "/" + name, SHA256: sha, Size: size}
}

// Official Silero VAD 6.2 ONNX (MIT), the same weights generation as the baseline's ggml-silero-v6.2.0.
// The v5 files named in the plan (csukuangfj/vad, onnx-community) load but clip speech onsets.
var benchVADFile = modelstore.File{Name: "silero_vad.onnx", URL: "https://raw.githubusercontent.com/snakers4/silero-vad/v6.2/src/silero_vad/data/silero_vad.onnx",
	SHA256: "1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3", Size: 2327524}

func benchCands() []benchCand {
	const w1 = "csukuangfj/sherpa-onnx-whisper-small.en"
	const r1 = "d9533f69affd85061aee349af7fea5cb2996dbbe"
	const w2 = "csukuangfj/sherpa-onnx-whisper-distil-small.en"
	const r2 = "0492324bca9e12a6fca0089bb846f2dd723b50d8"
	const m3 = "csukuangfj/sherpa-onnx-moonshine-base-en-int8"
	const r3 = "052b0798ad1bf046a140fdd4efcd9426530fa3f5"
	const m4 = "csukuangfj2/sherpa-onnx-moonshine-base-en-quantized-2026-02-27"
	const r4 = "8f4d6c58c03d40bcea40043bb7120a878f2bbef6"
	const z5 = "csukuangfj/sherpa-onnx-streaming-zipformer-en-2023-06-26"
	const r5 = "672fbf1b30579d6585301139bb363f42a0ad4a24"
	const p5 = "brady-pplx/sherpa-onnx-online-punct-en-2024-08-06"
	const rp = "29a49a07620ef067e6fa40580da620c11db07b83"
	return []benchCand{
		{"baseline", "whisper.cpp small.en q5_1 (baseline)", Default},
		{"c1", "C1 sherpa whisper small.en int8", Spec{ID: "bench-c1", Files: []modelstore.File{
			hf(w1, r1, "small.en-encoder.int8.onnx", "encoder.onnx", "8bdac288f369aa94ee2194059238c465ed82ea9d47ee8fa4a8c0a891873e462f", 112442483),
			hf(w1, r1, "small.en-decoder.int8.onnx", "decoder.onnx", "710ccf890e10f3faa15f51ec346081a2723c9f3adb6e4da81c6573a5a6f877fb", 262223042),
			hf(w1, r1, "small.en-tokens.txt", "tokens.txt", "306cd27f03c1a714eca7108e03d66b7dc042abe8c258b44c199a7ed9838dd930", 835554),
			benchVADFile}}},
		{"c2", "C2 sherpa whisper distil-small.en int8", Spec{ID: "bench-c2", Files: []modelstore.File{
			hf(w2, r2, "distil-small.en-encoder.int8.onnx", "encoder.onnx", "397a76d2308c2c1ec91a4ecc12f20fede69bb17be41a1cef050993520328beca", 102961431),
			hf(w2, r2, "distil-small.en-decoder.int8.onnx", "decoder.onnx", "3074092bca078786ecda9c9e88449f14e9ebde1d60be4d41de8cacda55e065e0", 195079097),
			hf(w2, r2, "distil-small.en-tokens.txt", "tokens.txt", "306cd27f03c1a714eca7108e03d66b7dc042abe8c258b44c199a7ed9838dd930", 835554),
			benchVADFile}}},
		{"c3", "C3 sherpa moonshine base en int8", Spec{ID: "bench-c3", Files: []modelstore.File{
			hf(m3, r3, "preprocess.onnx", "preprocess.onnx", "ffa630d395c5ccf76f5d4954be5b882df76aaf6491519ec01fd82ea7a3819fb2", 14077290),
			hf(m3, r3, "encode.int8.onnx", "encode.onnx", "7e38770f776f2e5583a53b052936005df2ba5c833d7e09c2a5fd796b94bf73e2", 50311494),
			hf(m3, r3, "uncached_decode.int8.onnx", "uncached.onnx", "c01f4b35093bcac20d352d23a75a539e772964579f9d024a90e5e6f09cae9987", 122120451),
			hf(m3, r3, "cached_decode.int8.onnx", "cached.onnx", "2db74e51cedf64a8b1be3c8192e0bb5e4923af0e90bd9e87f8e8771873f8ea03", 99983837),
			hf(m3, r3, "tokens.txt", "tokens.txt", "1165c2aeb9f72f457a83be2d459a09054f27490acd9b41bd43794dfd25e296ea", 436688),
			benchVADFile}}},
		{"c4", "C4 sherpa moonshine base en quantized 2026-02-27", Spec{ID: "bench-c4", Files: []modelstore.File{
			hf(m4, r4, "encoder_model.ort", "encoder.ort", "7c66495948d0d08ec1af454cd4b5514862ae6511e94712a60e6d83eaec8dc8cf", 31326816),
			hf(m4, r4, "decoder_model_merged.ort", "decoder.ort", "d9d7b333af34bc552580576ddcf248a1c6c839e0d3b43b09afb9376ed009899d", 109424400),
			hf(m4, r4, "tokens.txt", "tokens.txt", "2870d843e14c1e187bf1913a521562a63b53933814bd7f2145120468f494a049", 549350),
			benchVADFile}}},
		{"c5", "C5 sherpa streaming zipformer en 2023-06-26 int8 + punct-casing", Spec{ID: "bench-c5", Files: []modelstore.File{
			hf(z5, r5, "encoder-epoch-99-avg-1-chunk-16-left-128.int8.onnx", "encoder.onnx", "563fde436d16cf7607cf408cd6b30909819d03162652ef389c2450ced3f45ac1", 71083163),
			hf(z5, r5, "decoder-epoch-99-avg-1-chunk-16-left-128.int8.onnx", "decoder.onnx", "98da299f471e38bb4e1a8df579b8cc9122d6039576a77e357b3c60f17dd83b02", 1307236),
			hf(z5, r5, "joiner-epoch-99-avg-1-chunk-16-left-128.int8.onnx", "joiner.onnx", "d944208d660d67c8d72cd2acaeac971fa5ceb8c80e76c1968148846fedd6e297", 259335),
			hf(z5, r5, "tokens.txt", "tokens.txt", "49e3c2646595fd907228b3c6787069658f67b17377c60aeb8619c4551b2316fb", 5048),
			hf(z5, r5, "bpe.model", "bpe.model", "c53433de083c4a6ad12d034550ef22de68cec62c4f58932a7b6b8b2f1e743fa5", 244865),
			hf(p5, rp, "model.int8.onnx", "punct.onnx", "9d611f445fe4a46186080fe161be6059d87d72eb88d3a8cb00c1a06e83a6067e", 7490500),
			hf(p5, rp, "bpe.vocab", "punct-bpe.vocab", "e118b7ad88c54db562517df49e1cffd4836d166c34fb190fd311d7f34eb238f5", 149430),
			benchVADFile}}},
	}
}

func newBenchEngine(id, dir string, glossary []string) (engine, error) {
	p := func(n string) string { return filepath.Join(dir, n) }
	if id == "baseline" {
		return newEngine(dir)
	}
	vad, err := newBenchVAD(p("silero_vad.onnx"))
	if err != nil {
		return nil, err
	}
	off := func(m sherpa.OfflineModelConfig) (engine, error) {
		m.Tokens, m.NumThreads, m.Provider = p("tokens.txt"), benchThreads(), "cpu"
		rec := sherpa.NewOfflineRecognizer(&sherpa.OfflineRecognizerConfig{
			FeatConfig: sherpa.FeatureConfig{SampleRate: sampleRate, FeatureDim: 80}, ModelConfig: m, DecodingMethod: "greedy_search",
		})
		if rec == nil {
			vad.closeVAD()
			return nil, fmt.Errorf("load %s recognizer failed", id)
		}
		return &benchOffline{benchVAD: vad, rec: rec}, nil
	}
	switch id {
	case "c1", "c2":
		return off(sherpa.OfflineModelConfig{Whisper: sherpa.OfflineWhisperModelConfig{
			Encoder: p("encoder.onnx"), Decoder: p("decoder.onnx"), Language: "en", Task: "transcribe", EnableTokenTimestamps: 1}})
	case "c3":
		return off(sherpa.OfflineModelConfig{Moonshine: sherpa.OfflineMoonshineModelConfig{
			Preprocessor: p("preprocess.onnx"), Encoder: p("encode.onnx"), UncachedDecoder: p("uncached.onnx"), CachedDecoder: p("cached.onnx")}})
	case "c4":
		return off(sherpa.OfflineModelConfig{Moonshine: sherpa.OfflineMoonshineModelConfig{
			Encoder: p("encoder.ort"), MergedDecoder: p("decoder.ort")}})
	case "c5":
		cfg := sherpa.OnlineRecognizerConfig{
			FeatConfig: sherpa.FeatureConfig{SampleRate: sampleRate, FeatureDim: 80},
			ModelConfig: sherpa.OnlineModelConfig{
				Transducer: sherpa.OnlineTransducerModelConfig{Encoder: p("encoder.onnx"), Decoder: p("decoder.onnx"), Joiner: p("joiner.onnx")},
				Tokens:     p("tokens.txt"), NumThreads: benchThreads(), Provider: "cpu",
			},
			DecodingMethod: "greedy_search",
		}
		if len(glossary) > 0 {
			var b strings.Builder
			for _, g := range glossary {
				b.WriteString(strings.ToUpper(strings.NewReplacer("-", " ").Replace(g)) + "\n")
			}
			cfg.DecodingMethod, cfg.MaxActivePaths = "modified_beam_search", 4
			cfg.HotwordsBuf, cfg.HotwordsBufSize, cfg.HotwordsScore = b.String(), b.Len(), 1.5
			cfg.ModelConfig.ModelingUnit, cfg.ModelConfig.BpeVocab = "bpe", p("bpe.vocab")
		}
		rec := sherpa.NewOnlineRecognizer(&cfg)
		if rec == nil {
			vad.closeVAD()
			return nil, fmt.Errorf("load c5 recognizer failed")
		}
		punct := sherpa.NewOnlinePunctuation(&sherpa.OnlinePunctuationConfig{Model: sherpa.OnlinePunctuationModelConfig{
			CnnBilstm: p("punct.onnx"), BpeVocab: p("punct-bpe.vocab"), NumThreads: 1, Provider: "cpu"}})
		if punct == nil {
			sherpa.DeleteOnlineRecognizer(rec)
			vad.closeVAD()
			return nil, fmt.Errorf("load c5 punctuation failed")
		}
		return &benchZipformer{benchVAD: vad, rec: rec, punct: punct}, nil
	}
	return nil, fmt.Errorf("unknown engine %q", id)
}

// ---- host side

type benchRefs struct {
	F2    []benchItem `json:"f2"`
	F3    []benchItem `json:"f3"`
	F4    []benchItem `json:"f4"`
	F5    benchItem   `json:"f5"`
	Terms []string    `json:"terms"`
}

type benchItem struct {
	File string `json:"file"`
	Ref  string `json:"ref"`
}

type benchRow struct {
	Engine      string      `json:"engine"`
	Mode        string      `json:"mode"` // glossary | empty
	Fixture     string      `json:"fixture"`
	File        string      `json:"file"`
	Ref         string      `json:"ref"`
	Final       string      `json:"final"`
	Err         string      `json:"err,omitempty"`
	AudioSec    float64     `json:"audioSec"`
	Speed       float64     `json:"speed"`
	StopToFinal float64     `json:"stopToFinalSec"`
	GapsSec     []float64   `json:"gapsSec"`
	LoadSec     float64     `json:"loadSec,omitempty"`
	HWMKB       int         `json:"hwmKB"`
	Decodes     []decodeRec `json:"decodes"`
	Texts       []string    `json:"texts,omitempty"` // live text frames as "<sec since first>: text", f1 and f5 only
}

func benchReadWAV(t *testing.T, path string) []int16 {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("fixture: %v", err)
	}
	for i := 12; i+8 <= len(b); {
		size := int(binary.LittleEndian.Uint32(b[i+4:]))
		if string(b[i:i+4]) == "data" {
			raw := b[i+8 : min(i+8+size, len(b))]
			out := make([]int16, len(raw)/2)
			for j := range out {
				out[j] = int16(binary.LittleEndian.Uint16(raw[2*j:]))
			}
			return out
		}
		i += 8 + size
	}
	t.Fatal("no data chunk in wav")
	return nil
}

func benchHWM(pid int) int {
	b, err := os.ReadFile(fmt.Sprintf("/proc/%d/status", pid))
	if err != nil {
		return 0
	}
	m := regexp.MustCompile(`VmHWM:\s+(\d+) kB`).FindSubmatch(b)
	if m == nil {
		return 0
	}
	kb, _ := strconv.Atoi(string(m[1]))
	return kb
}

type benchRun struct {
	t        *testing.T
	cand     benchCand
	mode     string
	glossary []string
	client   *Client
	cmd      atomic.Pointer[exec.Cmd]
	logPath  string
	logOff   int64
	out      *os.File
	loadSec  float64
}

func (r *benchRun) readDecodes() []decodeRec {
	b, err := os.ReadFile(r.logPath)
	if err != nil || int64(len(b)) <= r.logOff {
		return nil
	}
	var recs []decodeRec
	for _, l := range strings.Split(strings.TrimSpace(string(b[r.logOff:])), "\n") {
		var d decodeRec
		if json.Unmarshal([]byte(l), &d) == nil {
			recs = append(recs, d)
		}
	}
	r.logOff = int64(len(b))
	return recs
}

func (r *benchRun) session(fixture string, item benchItem, pcm []int16, speed float64) benchRow {
	var mu sync.Mutex
	type tf struct {
		at   time.Time
		text string
	}
	var texts []tf
	var final, errMsg string
	var finalAt time.Time
	gotFinal := make(chan struct{})
	var once sync.Once
	chunk := time.Duration(float64(100*time.Millisecond) / speed)
	fed := make(chan struct{})
	mic := func(onPCM func([]int16)) (func(), error) {
		stop := make(chan struct{})
		done := make(chan struct{})
		go func() {
			defer close(done)
			start := time.Now()
			n := 0
			for i := 0; i < len(pcm); i += chunkFrames {
				select {
				case <-stop:
					return
				case <-time.After(time.Until(start.Add(time.Duration(n) * chunk))):
				}
				onPCM(pcm[i:min(i+chunkFrames, len(pcm))])
				n++
			}
			close(fed)
		}()
		return func() { close(stop); <-done }, nil
	}
	d, err := r.client.Dictate(context.Background(), DictateOptions{Mic: mic, Glossary: r.glossary, Emit: func(f Frame) {
		mu.Lock()
		defer mu.Unlock()
		switch f.Type {
		case "text":
			texts = append(texts, tf{time.Now(), f.Text})
		case "final":
			final, finalAt = f.Text, time.Now()
			once.Do(func() { close(gotFinal) })
		case "error":
			errMsg, finalAt = f.Code+": "+f.Message, time.Now()
			once.Do(func() { close(gotFinal) })
		}
	}})
	if err != nil {
		r.t.Fatal(err)
	}
	<-fed
	stopAt := time.Now()
	d.Stop()
	select {
	case <-gotFinal:
	case <-time.After(5 * time.Minute):
		r.t.Fatalf("%s %s: no final", r.cand.id, item.File)
	}
	<-d.Done()
	row := benchRow{Engine: r.cand.id, Mode: r.mode, Fixture: fixture, File: item.File, Ref: item.Ref, AudioSec: float64(len(pcm)) / captureRate,
		Speed: speed, Err: errMsg, LoadSec: r.loadSec, Decodes: r.readDecodes()}
	mu.Lock()
	row.Final, row.StopToFinal = final, finalAt.Sub(stopAt).Seconds()
	if fixture == "f1" || fixture == "f5" {
		for _, x := range texts {
			row.Texts = append(row.Texts, fmt.Sprintf("%.1f: %s", x.at.Sub(texts[0].at).Seconds(), x.text))
		}
	}
	for i := 1; i < len(texts); i++ {
		row.GapsSec = append(row.GapsSec, texts[i].at.Sub(texts[i-1].at).Seconds())
	}
	mu.Unlock()
	if cmd := r.cmd.Load(); cmd != nil && cmd.Process != nil {
		row.HWMKB = benchHWM(cmd.Process.Pid)
	}
	r.loadSec = 0
	b, _ := json.Marshal(row)
	_, _ = r.out.Write(append(b, '\n'))
	r.t.Logf("%s/%s %s: %.1fs audio, stop->final %.2fs, hwm %d MB, %q", r.cand.id, r.mode, item.File, row.AudioSec, row.StopToFinal, row.HWMKB/1024, final)
	return row
}

func TestBench(t *testing.T) {
	dir, home, outPath := os.Getenv("KIRA_STT_BENCH_DIR"), os.Getenv("KIRA_STT_BENCH_MODELS"), os.Getenv("KIRA_STT_BENCH_OUT")
	if dir == "" || home == "" || outPath == "" {
		t.Skip("KIRA_STT_BENCH_DIR, KIRA_STT_BENCH_MODELS and KIRA_STT_BENCH_OUT are required")
	}
	var refs benchRefs
	b, err := os.ReadFile(filepath.Join(dir, "refs.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(b, &refs); err != nil {
		t.Fatal(err)
	}
	want := strings.Split(os.Getenv("KIRA_STT_BENCH_ENGINES"), ",")
	out, err := os.OpenFile(outPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		t.Fatal(err)
	}
	defer out.Close()

	wav := func(rel string) []int16 { return benchReadWAV(t, filepath.Join(dir, rel)) }
	for _, cand := range benchCands() {
		if os.Getenv("KIRA_STT_BENCH_ENGINES") != "" && !slices.Contains(want, cand.id) {
			continue
		}
		modes := []string{"glossary"}
		if cand.id == "baseline" && os.Getenv("KIRA_STT_BENCH_NOEMPTY") == "" {
			modes = append(modes, "empty")
		}
		for _, mode := range modes {
			t.Run(cand.id+"/"+mode, func(t *testing.T) {
				mdir := ModelDir(home, cand.spec)
				if !Installed(mdir, cand.spec) {
					if err := modelstore.Install(context.Background(), mdir, cand.spec.ID, cand.spec.Files, nil); err != nil {
						t.Fatal(err)
					}
				}
				if os.Getenv("KIRA_STT_BENCH_INSTALL_ONLY") != "" {
					return
				}
				var gloss []string
				if mode == "glossary" {
					gloss = refs.Terms
				}
				r := &benchRun{t: t, cand: cand, mode: mode, glossary: gloss, out: out,
					logPath: filepath.Join(filepath.Dir(outPath), fmt.Sprintf("decode-%s-%s.log", cand.id, mode))}
				_ = os.Remove(r.logPath)
				r.client = NewClient(ClientOptions{Spec: cand.spec, Home: home, IdleTimeout: time.Hour, Command: func(d string) *exec.Cmd {
					cmd := exec.Command(os.Args[0], "-test.run=^$")
					cmd.Env = append(os.Environ(), "KIRA_STT_BENCH_WORKER="+cand.id+":"+d, "KIRA_STT_BENCH_GLOSSARY="+strings.Join(gloss, "\n"),
						"KIRA_STT_BENCH_DECODELOG="+r.logPath)
					r.cmd.Store(cmd)
					return cmd
				}})
				defer r.client.Close()

				t0 := time.Now()
				s, err := r.client.Begin(context.Background(), gloss, nil)
				if err != nil {
					t.Fatal(err)
				}
				<-s.Ready()
				if err := s.Err(); err != nil {
					t.Fatalf("worker start: %v", err)
				}
				r.loadSec = time.Since(t0).Seconds()
				s.Cancel()

				only := os.Getenv("KIRA_STT_BENCH_ONLY")
				use := func(f string) bool { return only == "" || strings.Contains(only, f) }
				if use("f1") {
					r.session("f1", benchItem{File: "f1/jfk.wav", Ref: "ask not what your country can do for you"}, wav("f1/jfk.wav"), 1)
				}
				if use("f5") {
					r.session("f5", refs.F5, wav(refs.F5.File), 1)
				}
				for _, g := range []struct {
					name  string
					items []benchItem
				}{{"f2", refs.F2}, {"f3", refs.F3}, {"f4", refs.F4}} {
					if use(g.name) {
						for _, it := range g.items {
							r.session(g.name, it, wav(it.File), 4)
						}
					}
				}
			})
		}
	}
}

// ---- report

var nonWord = regexp.MustCompile(`[^a-z0-9' ]+`)

func benchNorm(s string) []string {
	return strings.Fields(nonWord.ReplaceAllString(strings.ToLower(strings.ReplaceAll(s, "-", " ")), " "))
}

func benchEdits(ref, hyp []string) int {
	prev := make([]int, len(hyp)+1)
	for j := range prev {
		prev[j] = j
	}
	for i := 1; i <= len(ref); i++ {
		cur := make([]int, len(hyp)+1)
		cur[0] = i
		for j := 1; j <= len(hyp); j++ {
			cost := 1
			if ref[i-1] == hyp[j-1] {
				cost = 0
			}
			cur[j] = min(prev[j]+1, cur[j-1]+1, prev[j-1]+cost)
		}
		prev = cur
	}
	return prev[len(hyp)]
}

// benchHasTerm reports whether term appears as consecutive words once spacing and punctuation are normalised.
func benchHasTerm(hyp []string, term string) bool {
	want := strings.Join(benchNorm(term), "")
	for i := range hyp {
		cat := ""
		for j := i; j < min(i+5, len(hyp)); j++ {
			cat += strings.ReplaceAll(hyp[j], "'", "")
			if cat == want {
				return true
			}
			if len(cat) >= len(want) {
				break
			}
		}
	}
	return false
}

func benchMedian(x []float64) float64 {
	if len(x) == 0 {
		return 0
	}
	s := slices.Clone(x)
	sort.Float64s(s)
	return s[len(s)/2]
}

func TestBenchReport(t *testing.T) {
	path := os.Getenv("KIRA_STT_BENCH_REPORT")
	if path == "" {
		t.Skip("KIRA_STT_BENCH_REPORT is required")
	}
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	var rows []benchRow
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 1<<20), 1<<26)
	for sc.Scan() {
		var r benchRow
		if json.Unmarshal(sc.Bytes(), &r) == nil {
			rows = append(rows, r)
		}
	}
	var terms []string
	if tb, err := os.ReadFile(filepath.Join(os.Getenv("KIRA_STT_BENCH_DIR"), "refs.json")); err == nil {
		var rf benchRefs
		_ = json.Unmarshal(tb, &rf)
		terms = rf.Terms
	}
	type key struct{ engine, mode string }
	var keys []key
	by := map[key][]benchRow{}
	for _, r := range rows {
		k := key{r.Engine, r.Mode}
		if _, ok := by[k]; !ok {
			keys = append(keys, k)
		}
		by[k] = append(by[k], r)
	}
	pct := func(e, n int) float64 {
		if n == 0 {
			return 0
		}
		return 100 * float64(e) / float64(n)
	}
	p := func(format string, a ...any) { fmt.Printf(format+"\n", a...) }
	p("| engine/mode | load s | F1 quote | F1 s2f | F5 s2f | gap med s | F1 gap | F5 gap | F2+F3 WER | F3 WER | F4 WER | term recall | F5 WER | RTF final F3 | HWM after F1 MB | HWM after F5 MB | HWM end MB | cased+punct |")
	p("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
	for _, k := range keys {
		rs := by[k]
		var load float64
		var f1s2f, f5s2f float64
		var f1gap, f5gap, allgap []float64
		var e23, n23, e3, n3, e4, n4, e5, n5, hit, tot int
		var f3ns, f3smp int64
		var hwm1, hwm5, hwmEnd int
		quote := false
		cased, sess := 0, 0
		for _, r := range rs {
			if r.LoadSec > 0 {
				load = r.LoadSec
			}
			hwmEnd = max(hwmEnd, r.HWMKB)
			ref, hyp := benchNorm(r.Ref), benchNorm(r.Final)
			switch r.Fixture {
			case "f1":
				f1s2f, f1gap, hwm1 = r.StopToFinal, r.GapsSec, r.HWMKB
				allgap = append(allgap, r.GapsSec...)
				quote = strings.Contains(strings.Join(hyp, " "), "ask not what your country can do for you")
			case "f5":
				f5s2f, f5gap, hwm5 = r.StopToFinal, r.GapsSec, r.HWMKB
				allgap = append(allgap, r.GapsSec...)
				e5, n5 = benchEdits(ref, hyp), len(ref)
			case "f2", "f3":
				e := benchEdits(ref, hyp)
				e23, n23 = e23+e, n23+len(ref)
				if r.Fixture == "f3" {
					e3, n3 = e3+e, n3+len(ref)
					for _, d := range r.Decodes {
						if d.Final {
							f3ns += d.NS
							f3smp += int64(d.Samples)
						}
					}
				}
			case "f4":
				e4, n4 = e4+benchEdits(ref, hyp), n4+len(ref)
				for _, term := range terms {
					if benchHasTerm(ref, term) {
						tot++
						if benchHasTerm(hyp, term) {
							hit++
						}
					}
				}
			}
			if r.Fixture == "f3" || r.Fixture == "f2" {
				sess++
				fs := strings.TrimSpace(r.Final)
				if fs != "" && fs[0] >= 'A' && fs[0] <= 'Z' && strings.ContainsAny(fs[len(fs)-1:], ".?!") {
					cased++
				}
			}
		}
		rtf := 0.0
		if f3smp > 0 {
			rtf = float64(f3ns) / 1e9 / (float64(f3smp) / sampleRate)
		}
		p("| %s/%s | %.1f | %v | %.2f | %.2f | %.2f | %.2f | %.2f | %.2f | %.2f | %.2f | %d/%d | %.2f | %.2f | %d | %d | %d | %d/%d |",
			k.engine, k.mode, load, quote, f1s2f, f5s2f, benchMedian(allgap), benchMedian(f1gap), benchMedian(f5gap),
			pct(e23, n23), pct(e3, n3), pct(e4, n4), hit, tot, pct(e5, n5), rtf, hwm1/1024, hwm5/1024, hwmEnd/1024, cased, sess)
	}
	p("\nF1 and F5 finals and commit cuts (final decode lengths, ms):")
	for _, k := range keys {
		for _, r := range by[k] {
			if r.Fixture != "f1" && r.Fixture != "f5" {
				continue
			}
			var cuts []int
			for _, d := range r.Decodes {
				if d.Final {
					cuts = append(cuts, d.Samples*1000/sampleRate)
				}
			}
			p("- %s/%s %s cuts=%v final=%q", k.engine, k.mode, r.Fixture, cuts, r.Final)
		}
	}
}

// TestBenchVAD compares per-frame speech decisions of the baseline VAD and sherpa's Silero adapter.
func TestBenchVAD(t *testing.T) {
	dir, home := os.Getenv("KIRA_STT_BENCH_DIR"), os.Getenv("KIRA_STT_BENCH_MODELS")
	if dir == "" || home == "" {
		t.Skip("KIRA_STT_BENCH_DIR and KIRA_STT_BENCH_MODELS are required")
	}
	base, err := newEngine(ModelDir(home, Default))
	if err != nil {
		t.Fatal(err)
	}
	defer base.close()
	vadPath := filepath.Join(ModelDir(home, benchCands()[1].spec), "silero_vad.onnx")
	if alt := os.Getenv("KIRA_STT_BENCH_VADFILE"); alt != "" {
		vadPath = alt
	}
	sv, err := newBenchVAD(vadPath)
	if err != nil {
		t.Fatal(err)
	}
	defer sv.closeVAD()
	for _, f := range []string{"f1/jfk.wav", "f5/f5.wav"} {
		pcm := benchReadWAV(t, filepath.Join(dir, f))
		x := make([]float32, len(pcm)/frame*frame)
		for i := range x {
			x[i] = float32(pcm[i]) / 32768
		}
		base.resetVAD()
		sv.resetVAD()
		var a, b []float32
		for i := 0; i < len(x); i += 3 * frame {
			j := min(i+3*frame, len(x))
			pa, _ := base.vad(x[i:j])
			pb, _ := sv.vad(x[i:j])
			a, b = append(a, pa...), append(b, pb...)
		}
		var diff, lagSum, onsets int
		var runs [2][]string
		for k, p := range [][]float32{a, b} {
			prev := false
			for i, v := range p {
				cur := v >= speechProb
				if cur != prev {
					runs[k] = append(runs[k], fmt.Sprintf("%d:%v", i, cur))
				}
				prev = cur
			}
		}
		for i := range a {
			if (a[i] >= speechProb) != (b[i] >= speechProb) {
				diff++
			}
		}
		_ = lagSum
		_ = onsets
		t.Logf("%s: %d frames, %d differ (%.1f%%)\n baseline transitions %v\n sherpa   transitions %v", f, len(a), diff, 100*float64(diff)/float64(len(a)), runs[0], runs[1])
	}
}

// TestBenchDecode times single transcribe calls of the named engine on F1, for quick sanity checks.
func TestBenchDecode(t *testing.T) {
	id, dir, home := os.Getenv("KIRA_STT_BENCH_DECODE"), os.Getenv("KIRA_STT_BENCH_DIR"), os.Getenv("KIRA_STT_BENCH_MODELS")
	if id == "" {
		t.Skip("KIRA_STT_BENCH_DECODE is required")
	}
	for _, c := range benchCands() {
		if c.id != id {
			continue
		}
		eng, err := newBenchEngine(id, ModelDir(home, c.spec), nil)
		if err != nil {
			t.Fatal(err)
		}
		defer eng.close()
		pcm := benchReadWAV(t, filepath.Join(dir, "f1/jfk.wav"))
		x := make([]float32, len(pcm))
		for i := range x {
			x[i] = float32(pcm[i]) / 32768
		}
		for _, n := range []int{9216, 5 * sampleRate, len(x)} {
			t0 := time.Now()
			w, err := eng.transcribe(x[:n], true, "")
			t.Logf("%s %d samples: %v %q (%v)", id, n, time.Since(t0), transcript.Text(w), err)
		}
	}
}

// TestBenchVADChunks shows how the baseline VAD's decisions depend on the call size.
func TestBenchVADChunks(t *testing.T) {
	dir, home := os.Getenv("KIRA_STT_BENCH_DIR"), os.Getenv("KIRA_STT_BENCH_MODELS")
	if os.Getenv("KIRA_STT_BENCH_VADCHUNKS") == "" {
		t.Skip("KIRA_STT_BENCH_VADCHUNKS is required")
	}
	base, err := newEngine(ModelDir(home, Default))
	if err != nil {
		t.Fatal(err)
	}
	defer base.close()
	pcm := benchReadWAV(t, filepath.Join(dir, "f1/jfk.wav"))
	x := make([]float32, len(pcm)/frame*frame)
	for i := range x {
		x[i] = float32(pcm[i]) / 32768
	}
	for _, n := range []int{3, 10, 30, 100, 1000} {
		if os.Getenv("KIRA_STT_BENCH_VADCHUNKS") == "reset" {
			base.resetVAD()
		}
		var a []float32
		for i := 0; i < len(x); i += n * frame {
			p, _ := base.vad(x[i:min(i+n*frame, len(x))])
			a = append(a, p...)
		}
		var tr []string
		prev := false
		for i, v := range a {
			if cur := v >= speechProb; cur != prev {
				tr = append(tr, fmt.Sprintf("%d:%v", i, cur))
				prev = cur
			}
		}
		t.Logf("chunk %d frames: %v", n, tr)
	}
}

// TestBenchStream drives the stream directly, as the worker loop does, without any timing.
func TestBenchStream(t *testing.T) {
	id, dir, home := os.Getenv("KIRA_STT_BENCH_STREAM"), os.Getenv("KIRA_STT_BENCH_DIR"), os.Getenv("KIRA_STT_BENCH_MODELS")
	if id == "" {
		t.Skip("KIRA_STT_BENCH_STREAM is required")
	}
	for _, c := range benchCands() {
		if c.id != id {
			continue
		}
		eng, err := newBenchEngine(id, ModelDir(home, c.spec), nil)
		if err != nil {
			t.Fatal(err)
		}
		defer eng.close()
		pcm := benchReadWAV(t, filepath.Join(dir, "f1/jfk.wav"))
		st := newStream(eng, nil, func() bool { return false }, func(e event) { t.Logf("event: %q stable=%d", e.text, e.stable) })
		for i := 0; i < len(pcm); i += chunkFrames {
			chunk := make([]float32, min(chunkFrames, len(pcm)-i))
			for j := range chunk {
				chunk[j] = float32(pcm[i+j]) / 32768
			}
			if err := st.feed(chunk); err != nil {
				t.Fatal(err)
			}
			for {
				t0 := time.Now()
				acted, err := st.step(true)
				if err != nil {
					t.Fatal(err)
				}
				if !acted {
					break
				}
				t.Logf("at %.1fs of audio: step decoded in %v, buf=%d", float64(i)/captureRate, time.Since(t0), len(st.buf))
			}
		}
		text, err := st.finish()
		t.Logf("final: %q %v", text, err)
	}
}
