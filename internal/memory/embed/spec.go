// Package embed is the local text-embedding stack for memory search: a pinned model spec,
// vector encoding, a model installer, and an out-of-process ONNX Runtime worker with its client.
// It imports nothing from package memory.
package embed

import "github.com/kirathecat/kira-studio/internal/memory/modelstore"

const hfRevision = "e596f507467533e48a2e17c007f0e1dacc837b33"

// File is one downloadable model file, pinned by size and SHA-256.
type File = modelstore.File

// Spec pins one embedding model.
type Spec struct {
	ID          string
	Dim         int
	QueryPrefix string // prepended to queries only; documents are embedded as-is
	MaxTokens   int
	// DocFloor is the doc-to-doc cosine at or above which two facts count as paraphrases.
	DocFloor float32
	Files    []File
}

// ModelFile and TokenizerFile name the two files every Spec carries.
const (
	ModelFile     = "model.onnx"
	TokenizerFile = "tokenizer.json"
)

// Default is Snowflake arctic-embed-s, int8 ONNX (Apache-2.0, 33M params, CLS pooling).
var Default = Spec{
	ID:          "arctic-embed-s-int8-e596f50",
	Dim:         384,
	QueryPrefix: "Represent this sentence for searching relevant passages: ",
	MaxTokens:   512,
	DocFloor:    0.85,
	Files: []File{
		{
			Name:   ModelFile,
			URL:    "https://huggingface.co/Snowflake/snowflake-arctic-embed-s/resolve/" + hfRevision + "/onnx/model_int8.onnx",
			SHA256: "f93ff225320628d2e88baf2a395cae791b0e3b27edf5c70bf7b312a4d3260c14",
			Size:   34015111,
		},
		{
			Name:   TokenizerFile,
			URL:    "https://huggingface.co/Snowflake/snowflake-arctic-embed-s/resolve/" + hfRevision + "/tokenizer.json",
			SHA256: "91f1def9b9391fdabe028cd3f3fcc4efd34e5d1f08c3bf2de513ebb5911a1854",
			Size:   711649,
		},
	},
}

// TotalSize is the sum of the spec's file sizes.
func (s Spec) TotalSize() int64 { return modelstore.TotalSize(s.Files) }
