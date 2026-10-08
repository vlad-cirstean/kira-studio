// Package stt is local English speech to text for memory dictation: a pinned Whisper small.en
// model spec, an out-of-process whisper.cpp worker with its client, and microphone capture. It
// imports nothing from package memory.
package stt

import "github.com/kirathecat/kira-studio/internal/memory/modelstore"

// WhisperCommit is the whisper.cpp source commit (v1.9.5) that scripts/fetch-whisper.sh builds.
// verify-packaging.sh S13 keeps the two equal.
const WhisperCommit = "d1be6fde11ac6e0407606b4e42fe72d34add8037"

const (
	whisperRevision = "5359861c739e955e79d9a303bcbc70fb988958b1"
	vadRevision     = "9ffd54a1e1ee413ddf265af9913beaf518d1639b"
)

// The two files every Spec carries.
const (
	ModelFile = "ggml-small.en-q5_1.bin"
	VADFile   = "ggml-silero-v6.2.0.bin"
)

// Spec pins one speech model: the Whisper weights plus the Silero voice-activity model.
type Spec struct {
	ID    string
	Files []modelstore.File
}

// Default is Whisper small.en q5_1 (MIT, ggml) with Silero VAD v6.2.0 (MIT).
var Default = Spec{
	ID: "whisper-small.en-q5_1-5359861",
	Files: []modelstore.File{
		{
			Name:   ModelFile,
			URL:    "https://huggingface.co/ggerganov/whisper.cpp/resolve/" + whisperRevision + "/" + ModelFile,
			SHA256: "bfdff4894dcb76bbf647d56263ea2a96645423f1669176f4844a1bf8e478ad30",
			Size:   190098681,
		},
		{
			Name:   VADFile,
			URL:    "https://huggingface.co/ggml-org/whisper-vad/resolve/" + vadRevision + "/" + VADFile,
			SHA256: "2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987",
			Size:   885098,
		},
	},
}

// TotalSize is the sum of the spec's file sizes.
func (s Spec) TotalSize() int64 { return modelstore.TotalSize(s.Files) }

// ModelDir is where a spec's files live: <home>/models/<id>.
func ModelDir(home string, s Spec) string { return modelstore.ModelDir(home, s.ID) }

// Installed reports whether dir holds a complete install of s.
func Installed(dir string, s Spec) bool { return modelstore.Installed(dir, s.ID, s.Files) }
