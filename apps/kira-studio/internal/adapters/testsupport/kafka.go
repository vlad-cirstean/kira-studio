package testsupport

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/testcontainers/testcontainers-go"
	tckafka "github.com/testcontainers/testcontainers-go/modules/kafka"
	"github.com/twmb/franz-go/pkg/kadm"
	"github.com/twmb/franz-go/pkg/kgo"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

// 0005_kafka_seed.ts's own constants, re-expressed in Go (P58e E25).
const (
	KafkaOrdersTopic          = "orders"
	KafkaEmptyTopic           = "empty-topic" // exercises a topic with zero messages
	KafkaOrdersPartitionCount = 2
	KafkaOrdersMessageCount   = 6 // > one partition's worth, so browsing genuinely spans both
	KafkaConsumerGroup        = "kira-test-group"
)

const (
	// kafkaImage mirrors packages/db-fixtures/support/kafka.ts's own IMAGE (P32 D25) — already namespaced (no
	// library/ prefix), per AGENTS.md's Docker section.
	kafkaImage = "confluentinc/cp-kafka:8.0.7"
	// kafkaPublicPort is the module's own exposed PLAINTEXT listener (kafka.go's publicPort,
	// unexported by testcontainers-go/modules/kafka).
	kafkaPublicPort     = "9093/tcp"
	kafkaStartupTimeout = 180 * time.Second
	// kafkaClusterID satisfies KF-4(a)'s finding: kafka.Run fails outright ("CLUSTER_ID is
	// required") unless kafka.WithClusterID is passed explicitly — the module has no default.
	kafkaClusterID = "kira-test-cluster"
)

// KafkaFixture is support/kafka.ts's KafkaFixture, plus a side kgo/kadm client pair — the admin
// half seeds the fixture and gives every producing test its own topic (P58e E27), and the kgo
// half is what P58e E25's seeder produces the orders messages with.
type KafkaFixture struct {
	Config    model.ResolvedConnectionConfig // ready to hand to the adapter
	Client    *kgo.Client                    // a side client, for seeding and per-test setup only
	Admin     *kadm.Client
	container testcontainers.Container
}

var kafkaMemo fixture[KafkaFixture]

// StartKafka is support/kafka.ts's startKafka. Skips the test when Docker is unreachable.
func StartKafka(t *testing.T) *KafkaFixture {
	t.Helper()
	if !IsDockerAvailable() {
		t.Skip(DockerUnavailableMessage)
	}
	f, err := kafkaMemo.get(startKafka)
	if err != nil {
		t.Fatalf("kafka container: %v", err)
	}
	return f
}

// StopKafka terminates the memoized container and closes its side client, if ever started. Call
// once, from the test binary's own TestMain, after m.Run() returns — never from an individual
// test's t.Cleanup, per fixture.go's own doc comment (P58b B15).
func StopKafka() {
	kafkaMemo.stop(func(f *KafkaFixture) {
		f.Client.Close()
		_ = f.container.Terminate(context.Background())
	})
}

func startKafka() (*KafkaFixture, error) {
	// The module's own readiness wait (a log-regex match inside a PostStarts hook, kafka.go's own
	// Run) takes no configurable timeout option — it is bounded only by the ctx passed to Run
	// itself, unlike testcontainers.WithWaitStrategyAndDeadline's own deadline parameter. Scoped to
	// the Run call alone, not the seeding that follows.
	startupCtx, cancel := context.WithTimeout(context.Background(), kafkaStartupTimeout)
	defer cancel()

	// KF-4(a): kafka.WithClusterID is not optional the way §1.15 originally read — Run fails
	// outright with "CLUSTER_ID is required" without it. KAFKA_AUTO_CREATE_TOPICS_ENABLE=false is
	// KF-4(d)'s finding: without it at the container level, a nonexistent-topic read auto-creates
	// the topic broker-side (independent of any client-side AllowAutoTopicCreation setting) and
	// pollutes every test that runs after it in the same container.
	c, err := tckafka.Run(startupCtx, kafkaImage,
		tckafka.WithClusterID(kafkaClusterID),
		testcontainers.WithEnv(map[string]string{"KAFKA_AUTO_CREATE_TOPICS_ENABLE": "false"}),
	)
	if err != nil {
		return nil, fmt.Errorf("start kafka: %w", err)
	}

	ctx := context.Background()
	host, err := c.Host(ctx)
	if err != nil {
		_ = c.Terminate(ctx)
		return nil, err
	}
	mapped, err := c.MappedPort(ctx, kafkaPublicPort)
	if err != nil {
		_ = c.Terminate(ctx)
		return nil, err
	}
	port := int(mapped.Num())

	client, err := kgo.NewClient(kgo.SeedBrokers(fmt.Sprintf("%s:%d", host, port)))
	if err != nil {
		_ = c.Terminate(ctx)
		return nil, err
	}
	admin := kadm.NewClient(client)

	if err := seedKafka(ctx, admin, client); err != nil {
		client.Close()
		_ = c.Terminate(ctx)
		return nil, err
	}

	now := time.Now().UTC().Format(time.RFC3339Nano)
	cfg := model.ResolvedConnectionConfig{
		ID: "test-kafka", SortOrder: 0, CreatedAt: now, UpdatedAt: now,
		Name: "Test Kafka", Kind: "kafka", Color: "orange", Mode: "fields", ReadOnly: false,
		Host: Strp(host), Port: intp(port), Options: map[string]any{},
	}
	return &KafkaFixture{Config: cfg, Client: client, Admin: admin, container: c}, nil
}

// seedKafka is the Go re-expression of 0005_kafka_seed.ts (P58e E25), seeded from the host with
// kadm + kgo rather than the broker's own CLI run inside the container. Neither of the
// TypeScript's own two reasons for the in-container CLI survives translation: this test binary
// already links a Kafka client, so there is no client to keep out of the process (F24's whole
// point), and kadm.CommitOffsets commits a group's offsets "outside the context of a Kafka
// group" (kgo/config.go's own doc for ConsumePartitions points at exactly this use) — the same
// committed-offsets-with-no-members state --reset-offsets --to-earliest --execute produced.
func seedKafka(ctx context.Context, admin *kadm.Client, client *kgo.Client) error {
	if _, err := admin.CreateTopics(ctx, KafkaOrdersPartitionCount, 1, nil, KafkaOrdersTopic); err != nil {
		return fmt.Errorf("create topic %s: %w", KafkaOrdersTopic, err)
	}
	if _, err := admin.CreateTopics(ctx, 1, 1, nil, KafkaEmptyTopic); err != nil {
		return fmt.Errorf("create topic %s: %w", KafkaEmptyTopic, err)
	}

	records := make([]*kgo.Record, KafkaOrdersMessageCount)
	for i := 0; i < KafkaOrdersMessageCount; i++ {
		records[i] = &kgo.Record{
			Topic:   KafkaOrdersTopic,
			Key:     []byte(fmt.Sprintf("key-%d", i)),
			Value:   []byte(fmt.Sprintf(`{"seq":%d}`, i)),
			Headers: []kgo.RecordHeader{{Key: "source", Value: []byte("seed")}},
		}
	}
	if err := client.ProduceSync(ctx, records...).FirstErr(); err != nil {
		return fmt.Errorf("seed %s: %w", KafkaOrdersTopic, err)
	}

	// Registers KafkaConsumerGroup with committed offsets and no members — the same state
	// scenario 6 (kafka.spec.ts) needs, and the same state --reset-offsets --to-earliest --execute
	// against a group that has never existed produces.
	starts, err := admin.ListStartOffsets(ctx, KafkaOrdersTopic)
	if err != nil {
		return fmt.Errorf("list start offsets: %w", err)
	}
	if err := starts.Error(); err != nil {
		return fmt.Errorf("list start offsets: %w", err)
	}
	if _, err := admin.CommitOffsets(ctx, KafkaConsumerGroup, starts.Offsets()); err != nil {
		return fmt.Errorf("commit offsets for %s: %w", KafkaConsumerGroup, err)
	}
	return nil
}

// CreateTopic creates a fresh, dedicated topic for one producing test (P58e E27) — orders and
// empty-topic stay read-only fixtures, so scenarios asserting their message counts never depend
// on test execution order the way packages/db-fixtures/kafka.spec.ts's own top-to-bottom bun:test run did.
func CreateTopic(t *testing.T, f *KafkaFixture, name string) {
	t.Helper()
	if _, err := f.Admin.CreateTopics(context.Background(), 1, 1, nil, name); err != nil {
		t.Fatalf("CreateTopic %s: %v", name, err)
	}
}
