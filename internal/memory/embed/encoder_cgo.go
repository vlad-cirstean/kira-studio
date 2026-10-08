//go:build cgo

package embed

import (
	"fmt"
	"math"
	"path/filepath"

	"github.com/gomlx/go-huggingface/tokenizers/api"
	"github.com/gomlx/go-huggingface/tokenizers/hftokenizer"
	ort "github.com/yalue/onnxruntime_go"
)

type ortEncoder struct {
	spec     Spec
	tk       *hftokenizer.Tokenizer
	sess     *ort.DynamicAdvancedSession
	inNames  []string
	typeIDs  bool
	outIndex int
}

func newEncoder(libPath, dir string, s Spec) (encoder, error) {
	tk, err := hftokenizer.NewFromFile(nil, filepath.Join(dir, TokenizerFile))
	if err != nil {
		return nil, fmt.Errorf("embed: tokenizer: %w", err)
	}
	if err := tk.With(api.EncodeOptions{AddSpecialTokens: true, MaxLen: s.MaxTokens}); err != nil {
		return nil, fmt.Errorf("embed: tokenizer options: %w", err)
	}
	modelPath := filepath.Join(dir, ModelFile)

	ort.SetSharedLibraryPath(libPath)
	if err := ort.InitializeEnvironment(); err != nil {
		return nil, fmt.Errorf("embed: init onnxruntime: %w", err)
	}
	ins, outs, err := ort.GetInputOutputInfo(modelPath)
	if err != nil {
		return nil, fmt.Errorf("embed: read model io: %w", err)
	}
	e := &ortEncoder{spec: s, tk: tk}
	for _, in := range ins {
		switch in.Name {
		case "input_ids", "attention_mask":
		case "token_type_ids":
			e.typeIDs = true
		default:
			return nil, fmt.Errorf("embed: unexpected model input %q", in.Name)
		}
		e.inNames = append(e.inNames, in.Name)
	}
	outName := ""
	for _, o := range outs {
		if o.Name == "last_hidden_state" {
			outName = o.Name
		}
	}
	if outName == "" {
		return nil, fmt.Errorf("embed: model has no last_hidden_state output")
	}

	opts, err := ort.NewSessionOptions()
	if err != nil {
		return nil, fmt.Errorf("embed: session options: %w", err)
	}
	defer opts.Destroy()
	for _, set := range []func() error{
		func() error { return opts.SetIntraOpNumThreads(2) },
		func() error { return opts.SetInterOpNumThreads(1) },
		func() error { return opts.SetCpuMemArena(false) },
		func() error { return opts.SetMemPattern(false) },
		func() error { return opts.AddSessionConfigEntry("session.intra_op.allow_spinning", "0") },
	} {
		if err := set(); err != nil {
			return nil, fmt.Errorf("embed: session options: %w", err)
		}
	}
	e.sess, err = ort.NewDynamicAdvancedSession(modelPath, e.inNames, []string{outName}, opts)
	if err != nil {
		return nil, fmt.Errorf("embed: load model: %w", err)
	}
	return e, nil
}

func (e *ortEncoder) embed(texts []string) ([][]float32, error) {
	ids := make([][]int, len(texts))
	width := 0
	for i, t := range texts {
		ids[i] = e.truncate(e.tk.Encode(t))
		width = max(width, len(ids[i]))
	}
	n := int64(len(texts))
	shape := ort.NewShape(n, int64(width))
	idData := make([]int64, int(n)*width)
	maskData := make([]int64, int(n)*width)
	for i, row := range ids {
		for j, id := range row {
			idData[i*width+j] = int64(id)
			maskData[i*width+j] = 1
		}
	}
	inputs := make([]ort.Value, 0, len(e.inNames))
	defer func() {
		for _, v := range inputs {
			_ = v.Destroy()
		}
	}()
	for _, name := range e.inNames {
		data := idData
		switch name {
		case "attention_mask":
			data = maskData
		case "token_type_ids":
			data = make([]int64, len(idData))
		}
		t, err := ort.NewTensor(shape, data)
		if err != nil {
			return nil, fmt.Errorf("embed: input tensor: %w", err)
		}
		inputs = append(inputs, t)
	}
	outputs := []ort.Value{nil}
	if err := e.sess.Run(inputs, outputs); err != nil {
		return nil, fmt.Errorf("embed: run model: %w", err)
	}
	defer func() { _ = outputs[0].Destroy() }()
	out, ok := outputs[0].(*ort.Tensor[float32])
	if !ok {
		return nil, fmt.Errorf("embed: unexpected output type %T", outputs[0])
	}
	data := out.GetData()
	dim := e.spec.Dim
	if len(data) != int(n)*width*dim {
		return nil, fmt.Errorf("embed: output has %d values, want %d", len(data), int(n)*width*dim)
	}
	vecs := make([][]float32, len(texts))
	for i := range vecs {
		start := i * width * dim // token 0 is [CLS]; CLS pooling
		v := make([]float32, dim)
		copy(v, data[start:start+dim])
		normalize(v)
		vecs[i] = v
	}
	return vecs, nil
}

// truncate enforces MaxTokens while keeping the trailing [SEP].
func (e *ortEncoder) truncate(ids []int) []int {
	if len(ids) <= e.spec.MaxTokens {
		return ids
	}
	out := append([]int(nil), ids[:e.spec.MaxTokens]...)
	out[len(out)-1] = ids[len(ids)-1]
	return out
}

func normalize(v []float32) {
	var sum float64
	for _, x := range v {
		sum += float64(x) * float64(x)
	}
	if sum == 0 {
		return
	}
	inv := float32(1 / math.Sqrt(sum))
	for i := range v {
		v[i] *= inv
	}
}

func (e *ortEncoder) close() {
	_ = e.sess.Destroy()
	_ = ort.DestroyEnvironment()
}
