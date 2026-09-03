package testsupport

import (
	"context"
	"fmt"
	"net"
	"net/netip"
	"strconv"
	"testing"
	"time"

	mobycontainer "github.com/moby/moby/api/types/container"
	mobynetwork "github.com/moby/moby/api/types/network"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

// P25 §2.3's one genuine exception to "one container per adapter": SASL is a *listener* property
// fixed at broker boot, so a PLAINTEXT broker (kafka.go's StartKafka) cannot be made to require
// SASL at runtime the way every other adapter's least-privilege principals are created inside an
// already-running container. This is a second, purpose-built single-node KRaft broker whose only
// client listener is SASL_PLAINTEXT/PLAIN, with one user baked in at boot.
const (
	kafkaSaslUsername       = "kira"
	kafkaSaslPassword       = "kira"
	kafkaSaslClusterID      = "kira-sasl-test-cluster"
	kafkaSaslContainerPort  = "9095/tcp"
	kafkaSaslControllerPort = "9094/tcp"
)

// KafkaSaslFixture is the SASL_PLAINTEXT/PLAIN counterpart to KafkaFixture — used only by the
// complete matrix's kafka auth rows (§2.7). Config is fields-mode with no credentials; a case sets
// Username/Password itself.
type KafkaSaslFixture struct {
	Config    model.ResolvedConnectionConfig
	Host      string
	Port      int
	container testcontainers.Container
}

var kafkaSaslMemo fixture[KafkaSaslFixture]

// StartKafkaSasl skips the test when Docker is unreachable, exactly like every other fixture in
// this package.
func StartKafkaSasl(t *testing.T) *KafkaSaslFixture {
	t.Helper()
	if !IsDockerAvailable() {
		t.Skip(DockerUnavailableMessage)
	}
	f, err := kafkaSaslMemo.get(startKafkaSasl)
	if err != nil {
		t.Fatalf("kafka sasl container: %v", err)
	}
	return f
}

// StopKafkaSasl terminates the memoized container, if one was ever started. Call once, from the
// test binary's own TestMain, after m.Run() returns — never from an individual test.
func StopKafkaSasl() {
	kafkaSaslMemo.stop(func(f *KafkaSaslFixture) { _ = f.container.Terminate(context.Background()) })
}

// pickFreeHostPort finds a currently-unused TCP port on the loopback interface. A small race
// window exists between closing this listener and the container binding the same port, the same
// one every "reserve a free port for later" pattern in Go accepts — acceptable here since this
// runs once per test binary, not per case.
func pickFreeHostPort() (int, error) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port, nil
}

func startKafkaSasl() (*KafkaSaslFixture, error) {
	ctx := context.Background()

	// KF-4(a) (kafka.go's own comment) generalizes: the advertised listener has to name a port
	// that is known *before* the broker's own server.properties is generated from its env, which
	// testcontainers' own random port mapping cannot give us in time. Reserving a host port
	// ourselves and binding it explicitly via HostConfigModifier — rather than kafka.go's own
	// module's start-blocked-then-rewrite-and-launch script — sidesteps that entirely: the
	// advertised address is known up front, so the broker boots directly with its real
	// configuration on the first try.
	hostPort, err := pickFreeHostPort()
	if err != nil {
		return nil, err
	}

	provider, err := testcontainers.NewDockerProvider()
	if err != nil {
		return nil, err
	}
	daemonHost, err := provider.DaemonHost(ctx)
	_ = provider.Close()
	if err != nil {
		return nil, err
	}

	saslPort, err := mobynetwork.ParsePort(kafkaSaslContainerPort)
	if err != nil {
		return nil, err
	}

	// A single mechanism entry serves two roles at once, per PlainLoginModule's own contract:
	// username/password is this broker's own identity when it dials itself for inter-broker
	// traffic, and user_<name>=<password> is the table of credentials it accepts from an
	// incoming client — the same "kira"/"kira" pair for both, so there is exactly one principal to
	// reason about.
	jaas := fmt.Sprintf(
		`org.apache.kafka.common.security.plain.PlainLoginModule required username="%[1]s" password="%[2]s" user_%[1]s="%[2]s";`,
		kafkaSaslUsername, kafkaSaslPassword,
	)

	req := testcontainers.ContainerRequest{
		Image:        ImageFor("kafka", kafkaImage),
		ExposedPorts: []string{kafkaSaslContainerPort, kafkaSaslControllerPort},
		HostConfigModifier: func(hc *mobycontainer.HostConfig) {
			hc.PortBindings = mobynetwork.PortMap{
				saslPort: []mobynetwork.PortBinding{{HostIP: netip.IPv4Unspecified(), HostPort: strconv.Itoa(hostPort)}},
			}
		},
		Env: map[string]string{
			// The image's own /etc/confluent/docker/configure script hard-fails ("dub ensure
			// KAFKA_OPTS") the instant KAFKA_ADVERTISED_LISTENERS contains a SASL_ scheme, unless
			// KAFKA_OPTS is set to *something* — the per-listener KAFKA_LISTENER_NAME_..._SASL_JAAS_CONFIG
			// below is what actually configures PLAIN, so this only has to satisfy that check, not
			// name a real login-config file.
			"KAFKA_OPTS":                                 "-Dkira.kafka.matrix.sasl=true",
			"CLUSTER_ID":                                 kafkaSaslClusterID,
			"KAFKA_NODE_ID":                              "1",
			"KAFKA_PROCESS_ROLES":                        "broker,controller",
			"KAFKA_CONTROLLER_QUORUM_VOTERS":             "1@localhost:9094",
			"KAFKA_CONTROLLER_LISTENER_NAMES":            "CONTROLLER",
			"KAFKA_LISTENERS":                            "SASL_PLAINTEXT://0.0.0.0:9095,CONTROLLER://0.0.0.0:9094",
			"KAFKA_ADVERTISED_LISTENERS":                 fmt.Sprintf("SASL_PLAINTEXT://%s:%d", daemonHost, hostPort),
			"KAFKA_LISTENER_SECURITY_PROTOCOL_MAP":       "SASL_PLAINTEXT:SASL_PLAINTEXT,CONTROLLER:PLAINTEXT",
			"KAFKA_INTER_BROKER_LISTENER_NAME":           "SASL_PLAINTEXT",
			"KAFKA_SASL_ENABLED_MECHANISMS":              "PLAIN",
			"KAFKA_SASL_MECHANISM_INTER_BROKER_PROTOCOL": "PLAIN",
			// dub's own env_to_props (docker_utils/dub.py) turns a single '_' into '.' and a
			// double '__' into a literal '_' — the listener name SASL_PLAINTEXT has to survive as
			// one dotted segment ("sasl_plaintext"), so the underscore inside it is doubled here,
			// or this silently becomes "sasl.plaintext" (two segments) and the broker never finds
			// its per-listener JAAS config at all (confirmed against a real container: it fails at
			// boot with "Could not find a 'KafkaServer' ... entry in the JAAS configuration").
			"KAFKA_LISTENER_NAME_SASL__PLAINTEXT_PLAIN_SASL_JAAS_CONFIG": jaas,
			// KF-4(a)/(d)'s own findings, same as the PLAINTEXT fixture: a single-node cluster needs
			// its own replication/ISR floors, and auto-created topics would pollute later tests.
			"KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR":         "1",
			"KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR": "1",
			"KAFKA_TRANSACTION_STATE_LOG_MIN_ISR":            "1",
			"KAFKA_AUTO_CREATE_TOPICS_ENABLE":                "false",
		},
		WaitingFor: wait.ForLog("(?i)Kafka Server started").AsRegexp().WithStartupTimeout(kafkaStartupTimeout),
	}
	container, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: req,
		Started:          true,
	})
	if err != nil {
		return nil, fmt.Errorf("start kafka sasl: %w", err)
	}

	now := time.Now().UTC().Format(time.RFC3339Nano)
	cfg := model.ResolvedConnectionConfig{
		ID: "test-kafka-sasl", SortOrder: 0, CreatedAt: now, UpdatedAt: now,
		Name: "Test Kafka SASL", Kind: "kafka", Color: "orange", Mode: "fields", ReadOnly: false,
		Host: Strp(daemonHost), Port: intp(hostPort), Options: map[string]any{},
	}
	return &KafkaSaslFixture{Config: cfg, Host: daemonHost, Port: hostPort, container: container}, nil
}
