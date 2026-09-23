package sqs

import (
	"context"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/sqs"
	"github.com/aws/aws-sdk-go-v2/service/sqs/types"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

// Sentinel keys (mirrors mongo's $document, kafka's $body): a new message is expressed through
// the existing relational-shaped RowValues rather than widening the shared mutation schema.
const (
	bodyField    = "$body"
	headersField = "$headers"
	idField      = "messageId" // the row's key column is already the MessageId (read.go's pushMessage)
)

func toMessageAttributes(headers map[string]string) map[string]types.MessageAttributeValue {
	if headers == nil {
		return nil
	}
	out := make(map[string]types.MessageAttributeValue, len(headers))
	for name, value := range headers {
		out[name] = types.MessageAttributeValue{DataType: aws.String("String"), StringValue: aws.String(value)}
	}
	return out
}

func renderOpText(op model.MutationRowOp, queueName string) (string, error) {
	switch op.Kind {
	case "insert":
		return "SendMessage(" + queueName + ")", nil
	case "delete":
		return "DeleteMessage(" + queueName + ")", nil
	default: // update — a delivered message can't be edited in place, only replaced by delete+resend.
		return "", adapters.New(adapters.CodeUnsupported, "sqs has no update operation — delete and resend instead", nil)
	}
}

// preview is mutate.ts's preview — synchronous (Adapter rule 3): no network, no queue-URL
// resolution.
func preview(plan model.MutationPlan, queueName string) ([]string, error) {
	return adapters.PreviewProduce(plan, queueName, renderOpText)
}

// mutateQueue is mutate.ts's mutateQueue. handles is the adapter-local, mutex-guarded receipt-
// handle cache read.go populates — a receipt handle is only ever valid for the message that was
// actually received, not a stable identifier of the message itself; deleting a message the
// current session never polled is reported as E_QUERY rather than silently doing nothing.
func mutateQueue(ctx context.Context, client *sqs.Client, queueURL, queueName string, readOnly bool, plan model.MutationPlan, handles *receiptHandles, op *adapters.OpCtx) (model.MutationResult, error) {
	if err := adapters.AssertWritable(readOnly); err != nil {
		return model.MutationResult{}, err
	}

	statements, err := preview(plan, queueName)
	if err != nil {
		return model.MutationResult{}, err
	}
	commandText := ""
	for i, s := range statements {
		if i > 0 {
			commandText += ";\n"
		}
		commandText += s
	}
	op.SetCommand(commandText)

	return adapters.RunRowOps(ctx, plan, readOnly, func(ctx context.Context, _ int, rowOp model.MutationRowOp) (int, error) {
		switch rowOp.Kind {
		case "insert":
			body, ok := rowOp.Values.Get(bodyField)
			if !ok || body == nil {
				return 0, adapters.New(adapters.CodeQuery, "a new message requires a "+bodyField, nil)
			}
			headersRaw, _ := rowOp.Values.Get(headersField)
			headers, err := adapters.ParseHeaderJSON(headersRaw)
			if err != nil {
				return 0, err
			}
			_, err = client.SendMessage(ctx, &sqs.SendMessageInput{
				QueueUrl:          aws.String(queueURL),
				MessageBody:       body,
				MessageAttributes: toMessageAttributes(headers),
			})
			if err != nil {
				return 0, mapError(err)
			}
			return 1, nil

		case "delete":
			messageID, ok := rowOp.Key.Get(idField)
			if !ok || messageID == nil {
				return 0, adapters.New(adapters.CodeQuery, "a delete requires the message's "+idField, nil)
			}
			handle, ok := handles.get(*messageID)
			if !ok {
				return 0, adapters.New(adapters.CodeQuery,
					"this message was not received in the current session (its receipt handle is gone) — poll again before deleting", nil)
			}
			_, err := client.DeleteMessage(ctx, &sqs.DeleteMessageInput{QueueUrl: aws.String(queueURL), ReceiptHandle: aws.String(handle)})
			if err != nil {
				return 0, mapError(err)
			}
			handles.delete(*messageID)
			return 1, nil

		default:
			return 0, adapters.New(adapters.CodeUnsupported, "sqs has no update operation — delete and resend instead", nil)
		}
	})
}
