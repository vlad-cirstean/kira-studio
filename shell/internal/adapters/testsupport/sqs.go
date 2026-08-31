package testsupport

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/sqs"
	"github.com/aws/aws-sdk-go-v2/service/sqs/types"
	"github.com/testcontainers/testcontainers-go"

	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
)

// 0006_sqs_seed.ts's own constants, re-expressed in Go (P58d D24).
const (
	SQSOrdersQueue        = "orders-queue"
	SQSOrdersMessageCount = 5
	SQSDrainQueue         = "drain-queue"
	SQSDrainMessageCount  = 7
	SQSEmptyQueue         = "empty-queue"
)

// SqsFixture is support/sqs.ts's SqsFixture, plus the counting proxy P58d D10 needs and a side
// client for P58d D23's per-test queue creation (every SQS test that sends or deletes a message
// creates its own queue rather than touching the three seeded ones above).
type SqsFixture struct {
	Config    model.ResolvedConnectionConfig // points at the proxy — every adapter request is counted
	Client    *sqs.Client                    // a side client, for per-test queue setup only
	Proxy     *OperationCountingProxy
	container testcontainers.Container
}

var sqsMemo fixture[SqsFixture]

// StartSqs is support/sqs.ts's startSqs. Skips the test when Docker is unreachable.
func StartSqs(t *testing.T) *SqsFixture {
	t.Helper()
	if !IsDockerAvailable() {
		t.Skip(DockerUnavailableMessage)
	}
	f, err := sqsMemo.get(startSqs)
	if err != nil {
		t.Fatalf("sqs container: %v", err)
	}
	return f
}

// StopSqs terminates the memoized container and proxy, if ever started. Call once, from the test
// binary's own TestMain, after m.Run() returns.
func StopSqs() {
	sqsMemo.stop(func(f *SqsFixture) {
		f.Proxy.Close()
		_ = f.container.Terminate(context.Background())
	})
}

func startSqs() (*SqsFixture, error) {
	ctx := context.Background()
	c, endpoint, err := startLocalStack(ctx, "sqs")
	if err != nil {
		return nil, err
	}

	proxy, err := NewOperationCountingProxy(endpoint, "AmazonSQS.GetQueueUrl")
	if err != nil {
		_ = c.Terminate(ctx)
		return nil, err
	}

	awsCfg, err := awsconfig.LoadDefaultConfig(ctx,
		awsconfig.WithRegion(LocalStackRegion),
		awsconfig.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(LocalStackStaticAccessKey, LocalStackStaticSecret, "")),
	)
	if err != nil {
		proxy.Close()
		_ = c.Terminate(ctx)
		return nil, err
	}
	client := sqs.NewFromConfig(awsCfg, func(o *sqs.Options) { o.BaseEndpoint = aws.String(proxy.Endpoint) })

	if err := seedSqsQueue(ctx, client, SQSOrdersQueue, SQSOrdersMessageCount); err != nil {
		proxy.Close()
		_ = c.Terminate(ctx)
		return nil, err
	}
	if err := seedSqsQueue(ctx, client, SQSDrainQueue, SQSDrainMessageCount); err != nil {
		proxy.Close()
		_ = c.Terminate(ctx)
		return nil, err
	}
	if _, err := client.CreateQueue(ctx, &sqs.CreateQueueInput{QueueName: aws.String(SQSEmptyQueue)}); err != nil {
		proxy.Close()
		_ = c.Terminate(ctx)
		return nil, err
	}
	proxy.Reset() // the seed itself calls GetQueueUrl-adjacent operations; tests start from zero

	now := time.Now().UTC().Format(time.RFC3339Nano)
	cfg := model.ResolvedConnectionConfig{
		ID: "test-sqs", SortOrder: 0, CreatedAt: now, UpdatedAt: now,
		Name: "Test SQS", Kind: "sqs", Color: "amber", Mode: "uri", ReadOnly: false,
		URI:     Strp(fmt.Sprintf("sqs://%s:%s@%s", LocalStackStaticAccessKey, LocalStackStaticSecret, LocalStackRegion)),
		Options: map[string]any{"endpoint": proxy.Endpoint},
	}
	return &SqsFixture{Config: cfg, Client: client, Proxy: proxy, container: c}, nil
}

func seedSqsQueue(ctx context.Context, client *sqs.Client, name string, count int) error {
	out, err := client.CreateQueue(ctx, &sqs.CreateQueueInput{QueueName: aws.String(name)})
	if err != nil {
		return err
	}
	for i := 0; i < count; i++ {
		_, err := client.SendMessage(ctx, &sqs.SendMessageInput{
			QueueUrl:    out.QueueUrl,
			MessageBody: aws.String(fmt.Sprintf(`{"seq":%d}`, i)),
			MessageAttributes: map[string]types.MessageAttributeValue{
				"source": {DataType: aws.String("String"), StringValue: aws.String("seed")},
			},
		})
		if err != nil {
			return err
		}
	}
	return nil
}
