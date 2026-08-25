#!/usr/bin/env bash
# Kira Studio — RabbitMQ demo seed. Runs on the HOST, not via docker exec (P37 D40) — unlike
# every other engine's seed here, there is no useful CLI shipped inside the
# rabbitmq:4.3.5-management-alpine image to exec into (no bulk-publish tool, and rabbitmqadmin is
# a separate download), so this talks straight to the management API on localhost:15672 with curl,
# the same surface the app's own adapter reads (mirrors tests/db/fixtures/0011_rabbitmq_seed.ts's
# shape at demo scale rather than test-fixture scale — no binary/quorum/stream/weird-name edge
# cases, just enough topology to browse).
set -euo pipefail

BASE_URL="http://localhost:15672"
AUTH="kira:kira"
VHOST="kira"

mgmt() {
  local method="$1" path="$2" body="${3:-}"
  if [ -n "$body" ]; then
    curl -sf -u "$AUTH" -H 'Content-Type: application/json' -X "$method" "${BASE_URL}/api/${path}" -d "$body" >/dev/null
  else
    curl -sf -u "$AUTH" -X "$method" "${BASE_URL}/api/${path}" >/dev/null
  fi
}

declare_queue() {
  mgmt PUT "queues/${VHOST}/$1" "{\"durable\":true}"
}

declare_exchange() {
  mgmt PUT "exchanges/${VHOST}/$1" "{\"type\":\"$2\",\"durable\":true}"
}

bind_queue() {
  mgmt POST "bindings/${VHOST}/e/$1/q/$2" "{\"routing_key\":\"$3\"}"
}

bind_exchange() {
  mgmt POST "bindings/${VHOST}/e/$1/e/$2" "{\"routing_key\":\"$3\"}"
}

publish() {
  local exchange="$1" routing_key="$2" payload="$3"
  mgmt POST "exchanges/${VHOST}/${exchange:-amq.default}/publish" \
    "{\"properties\":{},\"routing_key\":\"${routing_key}\",\"payload\":\"${payload}\",\"payload_encoding\":\"string\"}"
}

echo "==> vhost + permissions"
mgmt PUT "vhosts/${VHOST}"
mgmt PUT "permissions/${VHOST}/kira" '{"configure":".*","write":".*","read":".*"}'

echo "==> exchanges"
declare_exchange "orders.direct" direct
declare_exchange "events.fanout" fanout
declare_exchange "events.topic" topic
bind_exchange "events.fanout" "events.topic" ""

echo "==> queues"
declare_queue orders
bind_queue "orders.direct" orders orders

declare_queue notifications
bind_queue "events.fanout" notifications ""

declare_queue empty-queue

declare_queue large-queue

echo "==> messages: orders (20)"
for i in $(seq 0 19); do
  publish "orders.direct" orders "{\"seq\":${i}}"
done

echo "==> messages: notifications (8)"
for i in $(seq 0 7); do
  publish "events.fanout" "" "{\"event\":\"order.created\",\"seq\":${i}}"
done

# Same order of magnitude as tests/db/fixtures/0011_rabbitmq_seed.ts's own big-queue — enough to
# demonstrate the 500-message poll clamp (D20) without a multi-minute seed (curl's own per-call
# overhead makes RabbitMQ's own HTTP publish path far slower than Kafka's bulk console-producer
# pipe, so this stays well under the relational seeds' ~20k scale).
echo "==> messages: large-queue (2000)"
for i in $(seq 0 1999); do
  publish "" large-queue "{\"seq\":${i}}"
done

echo "==> policy: orders gets a 1-hour message TTL"
mgmt PUT "policies/${VHOST}/orders-ttl" \
  '{"pattern":"^orders$","definition":{"message-ttl":3600000},"apply-to":"queues","priority":0}'
