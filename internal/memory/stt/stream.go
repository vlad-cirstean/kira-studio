package stt

import (
	"strings"
	"unicode/utf16"

	"github.com/kirathecat/kira-studio/internal/memory/stt/transcript"
)

// Whisper is not a streaming model. A stream gates audio with Silero VAD, re-decodes the bounded
// uncommitted window for live partials, shows a word as stable once two passes agree, and commits
// a chunk with a fuller decode at each pause.
const (
	sampleRate = 16000
	frame      = 512 // VAD window: 32 ms
	frameMS    = 32

	speechProb         = 0.5
	minPartialSpeechMS = 300 // speech needed before a partial pass
	newAudioMS         = 400 // new audio needed since the last pass
	minFinalSpeechMS   = 200 // less speech than this is treated as silence and dropped
	pauseMS            = 600 // silence after speech that ends a chunk
	padMS              = 200 // audio kept after the last speech frame
	windowCapMS        = 12000
	gapSearchMS        = 6000
	minGapMS           = 150
	hardCutMS          = 10000
	idleKeepFrames     = 10 // silence kept ahead of speech so an onset is not clipped
	promptTailRunes    = 200
	maxGlossaryTerms   = 40
)

// event is a stream output: the whole session text so far, and how much of it is stable.
type event struct {
	text   string
	stable int // UTF-16 units, the length a JS string reports
}

// stream turns audio into text events for one dictation session.
type stream struct {
	eng       engine
	glossary  []string
	cancelled func() bool
	emit      func(event)

	committed string
	buf       []float32 // VAD-processed audio not yet committed
	probs     []float32 // one per frame of buf
	carry     []float32 // audio short of a whole VAD frame
	sinceLast int       // samples added since the last decode
	tracker   transcript.Tracker
	hyp       []transcript.Word
	last      event
}

func newStream(eng engine, glossary []string, cancelled func() bool, emit func(event)) *stream {
	if len(glossary) > maxGlossaryTerms {
		glossary = glossary[:maxGlossaryTerms]
	}
	return &stream{eng: eng, glossary: glossary, cancelled: cancelled, emit: emit}
}

func ms(samples int) int { return samples * 1000 / sampleRate }

// feed adds audio and runs VAD over every whole frame.
func (s *stream) feed(pcm []float32) error {
	s.carry = append(s.carry, pcm...)
	n := len(s.carry) / frame * frame
	if n == 0 {
		return nil
	}
	p, err := s.eng.vad(s.carry[:n])
	if err != nil {
		return err
	}
	s.probs = append(s.probs, p...)
	s.buf = append(s.buf, s.carry[:n]...)
	s.sinceLast += n
	s.carry = append(s.carry[:0], s.carry[n:]...)
	return nil
}

// step performs at most one decode and reports whether it did. Callers loop until it returns false.
func (s *stream) step(allowPartial bool) (bool, error) {
	if s.cancelled() {
		return false, nil
	}
	if !s.hasSpeech() {
		s.trimSilence()
		return false, nil
	}
	if ms(len(s.buf)) >= windowCapMS {
		return true, s.commitPrefix(s.pickCut(), false)
	}
	if start, end, ok := s.firstPause(); ok {
		if end >= len(s.probs) {
			return true, s.commitPrefix(min(len(s.buf), start*frame+padMS*sampleRate/1000), true)
		}
		return true, s.commitPrefix(min(end*frame, start*frame+padMS*sampleRate/1000), false, end*frame)
	}
	if allowPartial && s.speechMS(0, len(s.probs)) >= minPartialSpeechMS && ms(s.sinceLast) >= newAudioMS {
		return true, s.partial()
	}
	return false, nil
}

// finish commits whatever is left and returns the session text.
func (s *stream) finish() (string, error) {
	for {
		acted, err := s.step(false)
		if err != nil {
			return s.committed, err
		}
		if !acted {
			break
		}
	}
	if s.cancelled() {
		return s.committed, nil
	}
	if len(s.buf) > 0 {
		if err := s.commitPrefix(len(s.buf), true); err != nil {
			return s.committed, err
		}
	}
	return s.committed, nil
}

func (s *stream) isSpeech(frameIdx int) bool { return s.probs[frameIdx] >= speechProb }

func (s *stream) hasSpeech() bool {
	for i := range s.probs {
		if s.isSpeech(i) {
			return true
		}
	}
	return false
}

// speechMS is the speech duration in frames [from, to).
func (s *stream) speechMS(from, to int) int {
	n := 0
	for i := from; i < min(to, len(s.probs)); i++ {
		if s.isSpeech(i) {
			n++
		}
	}
	return n * frameMS
}

// firstPause finds the first silence run of at least pauseMS that follows speech. end is the
// frame after the run, equal to len(probs) when the run is still open at the tail.
func (s *stream) firstPause() (start, end int, ok bool) {
	need := (pauseMS + frameMS - 1) / frameMS
	seen := false
	runStart := -1
	for i := range s.probs {
		if s.isSpeech(i) {
			seen, runStart = true, -1
			continue
		}
		if !seen {
			continue
		}
		if runStart < 0 {
			runStart = i
		}
		if i+1-runStart >= need {
			end = i + 1
			for end < len(s.probs) && !s.isSpeech(end) {
				end++
			}
			return runStart, end, true
		}
	}
	return 0, 0, false
}

// trimSilence bounds the buffer while nobody is speaking.
func (s *stream) trimSilence() {
	if len(s.probs) <= idleKeepFrames+sampleRate/frame {
		return
	}
	drop := len(s.probs) - idleKeepFrames
	s.buf = append(s.buf[:0], s.buf[drop*frame:]...)
	s.probs = append(s.probs[:0], s.probs[drop:]...)
}

// pickCut chooses where to split a window that reached the cap without a pause.
func (s *stream) pickCut() int {
	maxFrame := windowCapMS / frameMS
	limit := min(len(s.probs), maxFrame)
	from := max(0, len(s.probs)-gapSearchMS/frameMS)
	bestLen, bestCut := 0, 0
	for i := from; i < limit; {
		if s.isSpeech(i) {
			i++
			continue
		}
		j := i
		for j < limit && !s.isSpeech(j) {
			j++
		}
		if n := j - i; n*frameMS >= minGapMS && n > bestLen {
			bestLen, bestCut = n, (i+j)/2
		}
		i = j
	}
	if bestLen > 0 {
		return max(bestCut, 1) * frame
	}
	if s.tracker.Stable() > 0 && len(s.hyp) >= s.tracker.Stable() {
		if end := s.hyp[s.tracker.Stable()-1].EndMS; end > 0 {
			if cut := end * sampleRate / 1000 / frame * frame; cut >= frame && cut <= limit*frame {
				return cut
			}
		}
	}
	return min(hardCutMS*sampleRate/1000/frame, limit) * frame
}

// commitPrefix decodes buf[:end] as a final chunk and merges it into the committed text. With
// dropAll the rest of the buffer is silence and goes too; otherwise audio from keepFrom (default
// end) stays as the next window.
func (s *stream) commitPrefix(end int, dropAll bool, keepFrom ...int) error {
	end = min(end, len(s.buf))
	if s.speechMS(0, end/frame) >= minFinalSpeechMS {
		words, err := s.eng.transcribe(s.buf[:end], true, s.prompt())
		if err != nil {
			return err
		}
		if s.cancelled() {
			return nil
		}
		s.committed = transcript.Merge(s.committed, words, s.glossary)
		s.emitText(s.committed, len(utf16Units(s.committed)))
	}
	from := end
	if len(keepFrom) > 0 {
		from = min(keepFrom[0], len(s.buf))
	}
	if dropAll {
		s.buf, s.probs = s.buf[:0], s.probs[:0]
		s.eng.resetVAD()
	} else {
		s.buf = append(s.buf[:0], s.buf[from:]...)
		s.probs = append(s.probs[:0], s.probs[from/frame:]...)
	}
	s.tracker.Reset()
	s.hyp = nil
	s.sinceLast = 0
	return nil
}

func (s *stream) partial() error {
	words, err := s.eng.transcribe(s.buf, false, s.prompt())
	if err != nil {
		return err
	}
	s.sinceLast = 0
	if s.cancelled() {
		return nil
	}
	words = transcript.Clean(words)
	stable := s.tracker.Update(words)
	s.hyp = words
	full := transcript.Merge(s.committed, words, s.glossary)
	stableText := transcript.Merge(s.committed, words[:stable], s.glossary)
	n := len(utf16Units(s.committed))
	if strings.HasPrefix(full, stableText) {
		n = len(utf16Units(stableText))
	}
	s.emitText(full, n)
	return nil
}

func (s *stream) emitText(text string, stable int) {
	e := event{text: text, stable: stable}
	if e == s.last {
		return
	}
	s.last = e
	s.emit(e)
}

func (s *stream) prompt() string {
	var b strings.Builder
	if len(s.glossary) > 0 {
		b.WriteString("Glossary: " + strings.Join(s.glossary, ", ") + ".")
	}
	if tail := []rune(s.committed); len(tail) > 0 {
		if len(tail) > promptTailRunes {
			tail = tail[len(tail)-promptTailRunes:]
		}
		if b.Len() > 0 {
			b.WriteByte(' ')
		}
		b.WriteString(string(tail))
	}
	return b.String()
}

func utf16Units(s string) []uint16 { return utf16.Encode([]rune(s)) }
