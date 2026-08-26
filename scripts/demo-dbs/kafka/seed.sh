#!/usr/bin/env bash
# Kira Studio — Kafka demo seed. Runs *inside* the kira-kafka container (docker exec -i ... < this
# file), using the kafka-* CLI tools the confluentinc/cp-kafka image ships on PATH. The `orders`/
# `empty-topic`/consumer-group shape mirrors tests/db/fixtures/0005_kafka_seed.ts (kept small there
# for test speed); `large-topic` is demo-only, at the same ~20k scale as the relational seeds'
# `orders` table. No Node/kafkajs dependency either way.
set -euo pipefail

BROKER=localhost:9092

kafka-topics --bootstrap-server "$BROKER" --create --if-not-exists \
  --topic orders --partitions 2 --replication-factor 1
kafka-topics --bootstrap-server "$BROKER" --create --if-not-exists \
  --topic empty-topic --partitions 1 --replication-factor 1
kafka-topics --bootstrap-server "$BROKER" --create --if-not-exists \
  --topic large-topic --partitions 4 --replication-factor 1

for i in $(seq 0 14); do
  echo "key-${i}:{\"seq\":${i}}"
done | kafka-console-producer --broker-list "$BROKER" --topic orders \
  --property "parse.key=true" --property "key.separator=:"

# Same ~20k scale as the relational/document seeds' `orders` table, so the tree/stream view has
# a topic that actually exercises pagination and large-message-count rendering, not just a toy.
seq 0 19999 | awk '{ printf "key-%d:{\"seq\":%d}\n", $1, $1 }' | \
  kafka-console-producer --broker-list "$BROKER" --topic large-topic \
    --property "parse.key=true" --property "key.separator=:"

# Registers kira-demo-group in the topics/consumer-groups tree — a group only appears there once
# some consumer has actually joined it and consumed at least one message. `|| true` because the
# console consumer's timeout path can exit non-zero even after delivering every message.
kafka-console-consumer --bootstrap-server "$BROKER" --topic orders --group kira-demo-group \
  --from-beginning --max-messages 15 --timeout-ms 10000 >/dev/null 2>&1 || true
