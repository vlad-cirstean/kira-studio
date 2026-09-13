package kafka

import (
	"context"
	"encoding/json"

	"github.com/twmb/franz-go/pkg/kgo"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

// Sentinel keys (mirrors mongo/mutate.ts's $document, sqs/mutate.go's $body/$headers): a new
// message is expressed through the existing relational-shaped MutationRowOp's values rather than
// widening the shared mutation schema. '$' can never start a real Kafka header name worth
// round-tripping, so it can't collide with genuine data.
const (
	keyField     = "$key"
	bodyField    = "$body"
	headersField = "$headers"
)

func parseProduceHeaders(raw *string) (map[string]string, error) {
	if raw == nil || *raw == "" {
		return nil, nil
	}
	var parsed any
	if err := json.Unmarshal([]byte(*raw), &parsed); err != nil {
		return nil, adapters.New(adapters.CodeQuery, "malformed $headers JSON", err)
	}
	obj, ok := parsed.(map[string]any)
	if !ok {
		return nil, adapters.New(adapters.CodeQuery, "$headers must be a JSON object of string values", nil)
	}
	out := make(map[string]string, len(obj))
	for k, v := range obj {
		s, ok := v.(string)
		if !ok {
			return nil, adapters.New(adapters.CodeQuery, "$headers."+k+" must be a string", nil)
		}
		out[k] = s
	}
	return out, nil
}

// renderOpText renders the produce preview against the real kgo.ProduceSync call this adapter
// makes (P58f D6) — produce.ts's own renderOpText named node-rdkafka's producer.produce(...), an
// API with no Go analogue, which stopped being a faithful preview the moment this adapter shipped.
func renderOpText(op model.MutationRowOp, topic string) (string, error) {
	if op.Kind != "insert" {
		// A topic's log is immutable — no per-message update or delete (caps.go's own comment).
		return "", adapters.New(adapters.CodeUnsupported, "kafka only supports producing new messages (insert)", nil)
	}
	keyText := "<none>"
	if key, _ := op.Values.Get(keyField); key != nil {
		keyText = *key
	}
	return "ProduceSync " + topic + " key=" + keyText, nil
}

// preview is produce.ts's preview — synchronous (Adapter rule 3): no network, no catalog lookup.
func preview(plan model.MutationPlan, topic string) ([]string, error) {
	out := make([]string, len(plan.Ops))
	for i, op := range plan.Ops {
		text, err := renderOpText(op, topic)
		if err != nil {
			return nil, err
		}
		out[i] = text
	}
	return out, nil
}

func toRecordHeaders(headers map[string]string) []kgo.RecordHeader {
	if headers == nil {
		return nil
	}
	out := make([]kgo.RecordHeader, 0, len(headers))
	for k, v := range headers {
		out = append(out, kgo.RecordHeader{Key: k, Value: []byte(v)})
	}
	return out
}

// produce is produce.ts's produce (P58e E14): kgo.ProduceSync on the adapter's own long-lived
// client, which already carries kgo.DisableIdempotentWrite() (client.go) — matching librdkafka's
// own default and sidestepping the InitProducerId hang a single-broker cluster's default
// transaction-log replication factor would otherwise cause. No separate producer client, unlike
// produce.ts's fresh Producer per mutate: that existed only to dodge a NAN/Electron-sandbox
// delivery-report crash with no Go analogue whatsoever.
func produce(ctx context.Context, client *kgo.Client, topic string, readOnly bool, plan model.MutationPlan, op *adapters.OpCtx) (model.MutationResult, error) {
	// §8.12's standard: enforced here, not only greyed out in the UI (mirrors mongo/sqs).
	if err := adapters.AssertWritable(readOnly); err != nil {
		return model.MutationResult{}, err
	}

	statements, err := preview(plan, topic)
	if err != nil {
		return model.MutationResult{}, err
	}
	command := ""
	for i, s := range statements {
		if i > 0 {
			command += ";\n"
		}
		command += s
	}
	op.SetCommand(command)

	records := make([]*kgo.Record, 0, len(plan.Ops))
	for _, rowOp := range plan.Ops {
		if rowOp.Kind != "insert" {
			return model.MutationResult{}, adapters.New(adapters.CodeUnsupported, "kafka only supports producing new messages (insert)", nil)
		}
		body, ok := rowOp.Values.Get(bodyField)
		if !ok || body == nil {
			return model.MutationResult{}, adapters.New(adapters.CodeQuery, "a new message requires a "+bodyField, nil)
		}
		headersRaw, _ := rowOp.Values.Get(headersField)
		headers, err := parseProduceHeaders(headersRaw)
		if err != nil {
			return model.MutationResult{}, err
		}
		rec := &kgo.Record{Topic: topic, Value: []byte(*body), Headers: toRecordHeaders(headers)}
		if key, _ := rowOp.Values.Get(keyField); key != nil {
			rec.Key = []byte(*key)
		}
		records = append(records, rec)
	}

	// A capability gain over produce.ts, whose own comment concedes it can only report "queued
	// into librdkafka", not "the broker acknowledged this specific message" — ProduceSync reports
	// exactly that (P58e E14).
	results := client.ProduceSync(ctx, records...)
	if err := results.FirstErr(); err != nil {
		return model.MutationResult{}, mapError(err)
	}

	return model.MutationResult{AffectedRows: len(records)}, nil
}
