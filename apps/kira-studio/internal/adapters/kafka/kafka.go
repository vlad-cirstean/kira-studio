// Package kafka is the Go-native Kafka adapter (P58 D7, docs/v1/plans/P58e-kafka.md). Not
// implemented yet — this file exists only so M9.1's acceptance suite (kafka_test.go) can
// blank-import this package and compile against it ahead of the adapter itself (P58 D12's
// test-first rule / its R3). Until M9.2 registers a constructor via adapters.Register from this
// package's own init(), adapters.CreateAdapter("kafka", ...) returns E_UNSUPPORTED
// "kafka connections are not supported yet" (registry.go) — which is what the acceptance suite is
// expected to fail with in this milestone.
package kafka
