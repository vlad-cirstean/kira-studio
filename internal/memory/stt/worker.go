package stt

import (
	"bufio"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"sync/atomic"
)

// RunWorker is the `memory-stt` subcommand body: it loads the model, then serves NDJSON dictation
// sessions on stdin/stdout until stdin closes. It returns the process exit code. stdout is the
// protocol; diagnostics go to stderr.
func RunWorker(args []string) int {
	fs := flag.NewFlagSet("memory-stt", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	dir := fs.String("model-dir", "", "directory holding the installed model files")
	if err := fs.Parse(args); err != nil {
		return 2
	}
	out := bufio.NewWriter(os.Stdout)
	fail := func(err error) int {
		_ = json.NewEncoder(out).Encode(hello{Error: err.Error()})
		_ = out.Flush()
		return 2
	}
	if *dir == "" || !Installed(*dir, Default) {
		return fail(errors.New("model is not installed"))
	}
	eng, err := newEngine(*dir)
	if err != nil {
		return fail(err)
	}
	defer eng.close()
	return serve(os.Stdin, out, eng)
}

// serve writes the hello line, then runs sessions until in reaches EOF.
func serve(in io.Reader, out *bufio.Writer, eng engine) int {
	l := &loop{eng: eng, enc: json.NewEncoder(out), out: out}
	if !l.send(hello{Ready: true, Model: Default.ID}) {
		return 1
	}
	msgs := l.readRequests(in)
	for r := range msgs {
		if !l.handle(r) || !l.drain(msgs) {
			return 1
		}
		if !l.run() {
			return 1
		}
	}
	return 0
}

// loop is the worker's single-threaded session state.
type loop struct {
	eng    engine
	enc    *json.Encoder
	out    *bufio.Writer
	cancel atomic.Bool
	st     *stream
	sid    int
}

func (l *loop) send(v any) bool { return l.enc.Encode(v) == nil && l.out.Flush() == nil }

// readRequests keeps stdin drained while a decode runs, and raises cancel at once so the pass in
// flight is abandoned when it returns.
func (l *loop) readRequests(in io.Reader) <-chan request {
	msgs := make(chan request, 256)
	go func() {
		defer close(msgs)
		dec := json.NewDecoder(in)
		for {
			var r request
			if err := dec.Decode(&r); err != nil {
				if !errors.Is(err, io.EOF) {
					fmt.Fprintln(os.Stderr, "memory-stt: bad request:", err)
				}
				return
			}
			if r.Type == msgCancel {
				l.cancel.Store(true)
			}
			msgs <- r
		}
	}()
	return msgs
}

// drain handles everything already queued, so a pass starts on the latest audio.
func (l *loop) drain(msgs <-chan request) bool {
	for {
		select {
		case r, ok := <-msgs:
			if !ok {
				return true
			}
			if !l.handle(r) {
				return false
			}
		default:
			return true
		}
	}
}

// run decodes until the stream has nothing left to do. It returns false when stdout is gone.
func (l *loop) run() bool {
	for l.st != nil {
		acted, err := l.st.step(true)
		if err != nil {
			return l.fail(err)
		}
		if !acted {
			break
		}
	}
	return true
}

func (l *loop) fail(err error) bool {
	l.st = nil
	return l.send(reply{Type: replyError, SID: l.sid, Error: err.Error()})
}

func (l *loop) handle(r request) bool {
	switch r.Type {
	case msgStart:
		l.cancel.Store(false)
		l.sid = r.SID
		l.st = newStream(l.eng, r.Glossary, l.cancel.Load, func(e event) {
			l.send(reply{Type: replyText, SID: l.sid, Text: e.text, Stable: e.stable})
		})
	case msgAudio:
		if l.st == nil {
			return true
		}
		pcm, err := decodePCM(r.PCM)
		if err == nil {
			err = l.st.feed(pcm)
		}
		if err != nil {
			return l.fail(err)
		}
	case msgStop:
		if l.st == nil {
			return true
		}
		text, err := l.st.finish()
		if err != nil {
			return l.fail(err)
		}
		l.st = nil
		return l.send(reply{Type: replyFinal, SID: l.sid, Text: text})
	case msgCancel:
		l.st = nil
		l.cancel.Store(false)
	}
	return true
}

func decodePCM(b64 string) ([]float32, error) {
	raw, err := base64.StdEncoding.DecodeString(b64)
	if err != nil || len(raw)%2 != 0 {
		return nil, errors.New("malformed audio frame")
	}
	out := make([]float32, len(raw)/2)
	for i := range out {
		out[i] = float32(int16(binary.LittleEndian.Uint16(raw[2*i:]))) / 32768
	}
	return out, nil
}
