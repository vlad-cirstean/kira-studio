#!/usr/bin/env bash
# Kira Studio — run all database seeds against the local containers.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> PostgreSQL"
docker exec -i kira-postgres psql -U kira -d kira -v ON_ERROR_STOP=1 \
  < "${SCRIPT_DIR}/postgres/seed.sql"

echo
echo "==> MariaDB"
docker exec -i kira-mariadb mariadb -ukira -pkira kira \
  < "${SCRIPT_DIR}/mariadb/seed.sql"

echo
echo "==> MySQL"
docker exec -i kira-mysql mysql -ukira -pkira kira \
  < "${SCRIPT_DIR}/mysql/seed.sql"

echo
echo "==> ClickHouse"
docker exec -i kira-clickhouse clickhouse-client --multiquery --database kira \
  < "${SCRIPT_DIR}/clickhouse/seed.sql"

echo
echo "==> MongoDB"
docker exec -i kira-mongo mongosh --quiet kira \
  < "${SCRIPT_DIR}/mongo/seed.js"

echo
echo "==> Redis"
docker exec -i kira-redis redis-cli EVAL "$(cat "${SCRIPT_DIR}/redis/seed.lua")" 0

echo
echo "==> Kafka"
docker exec -i kira-kafka bash < "${SCRIPT_DIR}/kafka/seed.sh"

echo
echo "==> SQS (LocalStack)"
docker exec -i kira-sqs bash < "${SCRIPT_DIR}/sqs/seed.sh"

echo
echo "==> S3 (LocalStack — same container as SQS)"
docker exec -i kira-sqs bash < "${SCRIPT_DIR}/s3/seed.sh"

echo
echo "==> RabbitMQ (host-side — no useful CLI inside the image, talks to localhost:15672 directly)"
bash "${SCRIPT_DIR}/rabbitmq/seed.sh"

echo
echo "==> SQLite (no container — a file on disk, built directly)"
bun "${SCRIPT_DIR}/sqlite/seed.ts"

echo
echo "All seeds complete."
