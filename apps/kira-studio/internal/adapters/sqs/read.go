package sqs

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"strconv"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/sqs"
	"github.com/aws/aws-sdk-go-v2/service/sqs/types"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/page"
)

const (
	receiveLimit    = 10 // ReceiveMessage's own hard per-call cap on MaxNumberOfMessages
	waitTimeSeconds = 1  // short poll per call; looped rather than one long wait
)

// receiptHandleCap is P58d D9: a bound on the adapter-local receiptHandles map — a receipt handle
// is only useful for as long as the message it names is still in flight, so unbounded growth
// across many polls would be a slow leak of tokens nothing will ever look up again. FIFO eviction
// (oldest first) approximates "least likely to still be wanted"; Go's own map has no insertion
// order to lean on the way JS's Map does, so receiptHandles is a mutex-guarded map plus an
// explicit eviction queue (see adapter.go's receiptHandles type).
const receiptHandleCap = 5000

// sqsMessageAttribute is P58d D8's hand-written encoder over types.MessageAttributeValue: fields
// are emitted only when non-nil/non-empty, in this fixed order, so the headers cell matches the
// JavaScript adapter's JSON.stringify(message.MessageAttributes ?? {}) — which drops undefined
// fields entirely — rather than json.Marshal's own all-fields-with-nulls struct shape (confirmed
// as the divergence by M8.0's AWS-1(c)).
type sqsMessageAttribute struct {
	DataType         string   `json:"DataType,omitempty"`
	StringValue      *string  `json:"StringValue,omitempty"`
	BinaryValue      *string  `json:"BinaryValue,omitempty"` // base64
	StringListValues []string `json:"StringListValues,omitempty"`
	BinaryListValues []string `json:"BinaryListValues,omitempty"` // base64, one per entry
}

// encodeHeaders is P58d D8. The outer map is a plain map[string]sqsMessageAttribute, which
// encoding/json marshals with sorted keys — a harmless difference from JS's insertion order that
// no consumer observes (the cell is parsed, not compared byte-for-byte against a live order).
func encodeHeaders(attrs map[string]types.MessageAttributeValue) (string, error) {
	out := make(map[string]sqsMessageAttribute, len(attrs))
	for name, v := range attrs {
		enc := sqsMessageAttribute{DataType: aws.ToString(v.DataType), StringValue: v.StringValue}
		if len(v.BinaryValue) > 0 {
			s := base64.StdEncoding.EncodeToString(v.BinaryValue)
			enc.BinaryValue = &s
		}
		if len(v.StringListValues) > 0 {
			enc.StringListValues = v.StringListValues
		}
		if len(v.BinaryListValues) > 0 {
			list := make([]string, len(v.BinaryListValues))
			for i, b := range v.BinaryListValues {
				list[i] = base64.StdEncoding.EncodeToString(b)
			}
			enc.BinaryListValues = list
		}
		out[name] = enc
	}
	b, err := json.Marshal(out)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// defaultVisibilityTimeout is F10's own fallback when fetchVisibilityTimeout couldn't read the
// queue's own attribute (a best-effort call, see its own comment) — AWS's own documented default
// for a queue whose VisibilityTimeout was never explicitly set.
const defaultVisibilityTimeout = 30 * time.Second

// receiptHandleEntry is one cached receipt handle plus the bookkeeping F10 needs to tell a still-
// valid handle from one whose visibility timeout has already passed: receivedAt (when this poll
// received the message) and visibilityTimeout (the queue's own attribute at receive time).
type receiptHandleEntry struct {
	handle            string
	receivedAt        time.Time
	visibilityTimeout time.Duration
}

// receiptHandles is the adapter-local, mutex-guarded FIFO map SqsAdapter threads through from
// pollQueue (keyed by MessageId) to mutate.go — P58d D9. A receipt handle is an AWS-internal token
// with no reason to round-trip through the wire protocol, and it is only ever valid for the
// message that was actually received, not a stable identifier of the message itself. Two
// JavaScript guarantees this type must reproduce by hand: single-threadedness (a mutex) and Map's
// insertion order (an explicit eviction queue) — Go's own map iteration order is deliberately
// randomised, so a literal port would evict an arbitrary handle rather than the oldest one.
type receiptHandles struct {
	mu      sync.Mutex
	entries map[string]receiptHandleEntry
	order   []string
}

func newReceiptHandles() *receiptHandles {
	return &receiptHandles{entries: map[string]receiptHandleEntry{}}
}

// set records handle as messageID's own current receipt handle (F10: alongside the moment it was
// received and the queue's own visibility timeout at that moment), evicting the oldest entry once
// the cap is exceeded.
func (r *receiptHandles) set(messageID, handle string, visibilityTimeout time.Duration) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.entries[messageID]; !exists {
		r.order = append(r.order, messageID)
	}
	r.entries[messageID] = receiptHandleEntry{handle: handle, receivedAt: time.Now(), visibilityTimeout: visibilityTimeout}
	for len(r.order) > receiptHandleCap {
		oldest := r.order[0]
		r.order = r.order[1:]
		delete(r.entries, oldest)
	}
}

// forDelete is mutate.go's own lookup (F10): refuses a delete outright, with a clear message,
// rather than letting AWS silently accept a stale receipt handle and report success while another
// consumer holds the message — once past the visibility timeout the handle recorded at receive
// time, AWS can accept a DeleteMessage call using it with no guarantee it still names the same
// in-flight receipt.
func (r *receiptHandles) forDelete(messageID string) (string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	e, ok := r.entries[messageID]
	if !ok {
		return "", adapters.New(adapters.CodeQuery,
			"this message was not received in the current session (its receipt handle is gone) — poll again before deleting", nil)
	}
	if time.Since(e.receivedAt) >= e.visibilityTimeout {
		return "", adapters.New(adapters.CodeQuery,
			"this message's receipt handle may have expired (past its visibility timeout) — poll again before deleting", nil)
	}
	return e.handle, nil
}

func (r *receiptHandles) delete(messageID string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.entries, messageID)
	for i, id := range r.order {
		if id == messageID {
			r.order = append(r.order[:i], r.order[i+1:]...)
			break
		}
	}
}

func (r *receiptHandles) clear() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.entries = map[string]receiptHandleEntry{}
	r.order = nil
}

func pushMessage(builder *page.StreamPageBuilder, m types.Message, handles *receiptHandles, visibilityTimeout time.Duration) error {
	attrs := m.Attributes
	var timestamp *string
	if raw, ok := attrs["SentTimestamp"]; ok {
		if ms, err := strconv.ParseInt(raw, 10, 64); err == nil {
			// P58d D11: JS toISOString()'s exact format.
			s := time.UnixMilli(ms).UTC().Format("2006-01-02T15:04:05.000Z07:00")
			timestamp = &s
		}
	}
	headers, err := encodeHeaders(m.MessageAttributes)
	if err != nil {
		return err
	}
	attrsJSON, err := json.Marshal(attrs)
	if err != nil {
		return err
	}
	builder.Push(page.StreamRow{
		Key:       m.MessageId,
		Headers:   headers,
		Attrs:     string(attrsJSON),
		Timestamp: timestamp,
		Body:      aws.ToString(m.Body),
	})
	if handles != nil && m.MessageId != nil && m.ReceiptHandle != nil {
		handles.set(*m.MessageId, *m.ReceiptHandle, visibilityTimeout)
	}
	return nil
}

// position is P58d D11 (§4.5): SQS has no addressable position at all — every poll is an
// independent, non-resumable snapshot.
func position(pageSize int) page.PagePosition {
	return page.PagePosition{Offset: nil, PageSize: pageSize, HasMore: false, NextToken: nil, PrevToken: nil, Strategy: "batch"}
}

func fetchVisibilityTimeout(ctx context.Context, client *sqs.Client, queueURL string) *int {
	result, err := client.GetQueueAttributes(ctx, &sqs.GetQueueAttributesInput{
		QueueUrl:       aws.String(queueURL),
		AttributeNames: []types.QueueAttributeName{types.QueueAttributeNameVisibilityTimeout},
	})
	if err != nil {
		return nil // best-effort, mirrors redis/read.go's MEMORY USAGE fallback
	}
	raw, ok := result.Attributes["VisibilityTimeout"]
	if !ok {
		return nil
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		return nil
	}
	return &n
}

// pollQueue is read.ts's pollQueue. Never called automatically — always an explicit user-
// initiated poll. Loops ReceiveMessage (hard-capped at 10 messages per call) up to
// ceil(pageSize/10) times, stopping early on any short/empty batch (the queue is plausibly
// drained for this poll). One GetQueueAttributes call per poll feeds both this page's
// visibilityTimeoutSeconds and countQueue's approximate count. Every SDK call takes ctx directly
// (P58d D3): SQS has no server-side kill mechanism, so the op's own context is the entire
// cancellation story.
func pollQueue(ctx context.Context, client *sqs.Client, queueURL string, req adapters.ReadRequest, op *adapters.OpCtx, handles *receiptHandles) (page.StreamPage, error) {
	visibilityTimeoutSeconds := fetchVisibilityTimeout(ctx, client, queueURL)
	builder := page.NewStreamPageBuilder(visibilityTimeoutSeconds)
	collected := 0

	// F10: the duration a cached receipt handle stays trustworthy for — the queue's own attribute
	// when it was readable, defaultVisibilityTimeout (AWS's own documented default) otherwise.
	visibilityTimeout := defaultVisibilityTimeout
	if visibilityTimeoutSeconds != nil {
		visibilityTimeout = time.Duration(*visibilityTimeoutSeconds) * time.Second
	}

	op.SetCommand("ReceiveMessage " + queueURL)
	for collected < req.PageSize {
		if err := adapters.CheckCancelled(ctx); err != nil {
			return page.StreamPage{}, err
		}
		batchLimit := receiveLimit
		if remaining := req.PageSize - collected; remaining < batchLimit {
			batchLimit = remaining
		}
		result, err := client.ReceiveMessage(ctx, &sqs.ReceiveMessageInput{
			QueueUrl:                    aws.String(queueURL),
			MaxNumberOfMessages:         int32(batchLimit),
			WaitTimeSeconds:             waitTimeSeconds,
			MessageAttributeNames:       []string{"All"},
			MessageSystemAttributeNames: []types.MessageSystemAttributeName{types.MessageSystemAttributeNameAll},
		})
		if err != nil {
			return page.StreamPage{}, mapError(err)
		}
		for _, m := range result.Messages {
			if err := pushMessage(builder, m, handles, visibilityTimeout); err != nil {
				return page.StreamPage{}, mapError(err)
			}
		}
		collected += len(result.Messages)
		if len(result.Messages) < batchLimit {
			break // short of a full batch — queue is likely drained
		}
	}

	return builder.Finish(position(req.PageSize)), nil
}

// countQueue is read.ts's countQueue — approximate only; SQS has no exact-count operation.
func countQueue(ctx context.Context, client *sqs.Client, queueURL string) (adapters.CountResult, error) {
	result, err := client.GetQueueAttributes(ctx, &sqs.GetQueueAttributesInput{
		QueueUrl:       aws.String(queueURL),
		AttributeNames: []types.QueueAttributeName{types.QueueAttributeNameApproximateNumberOfMessages},
	})
	if err != nil {
		return adapters.CountResult{}, mapError(err)
	}
	raw, ok := result.Attributes["ApproximateNumberOfMessages"]
	if !ok {
		return adapters.CountResult{Value: 0, Exact: false}, nil
	}
	n, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return adapters.CountResult{Value: 0, Exact: false}, nil
	}
	return adapters.CountResult{Value: n, Exact: false}, nil
}
