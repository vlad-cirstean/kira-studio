# Kira Studio — local database fixtures

Spins up all six of Kira Studio's supported engines (PostgreSQL, MariaDB, MongoDB, Redis, Kafka,
SQS) via [Colima](https://github.com/abiosoft/colima) + Docker Compose. The four relational/document/
key-value stores get a full schema, foreign keys, indexes, and ~20k rows of seed data; Kafka and SQS
get a handful of topics/queues with a small message backlog — enough to exercise every tree view
without waiting on a multi-minute seed.

Kafka and SQS use the same images/modes as the `@testcontainers/kafka` / `@testcontainers/localstack`
harness under `bun run test:db` (confluentinc/cp-kafka in KRaft mode; localstack/localstack with only
`SERVICES=sqs`) — see `tests/db/support/kafka.ts` and `tests/db/support/sqs.ts`.

## Requirements

- [Colima](https://github.com/abiosoft/colima) running with the Docker runtime
- `docker` and `docker-compose` on the PATH

## Start the databases

```sh
docker-compose -f scripts/demo-dbs/docker-compose.yml up -d
```

Wait for all containers to report healthy:

```sh
docker ps
```

## Seed the data

```sh
bash scripts/demo-dbs/seed.sh
```

The schema is applied automatically on first container start (via
`/docker-entrypoint-initdb.d`). The seed step is separate and can be re-run any
time to reset data — safe to re-run for the four relational/document/key-value stores; for Kafka
and SQS it appends another batch of messages rather than resetting (see the Model section below).

## Connections

| Database | Host | Port | User     | Password | DB   |
|----------|------|------|----------|----------|------|
| PostgreSQL | localhost | 5432 | `kira` | `kira` | `kira` |
| MariaDB  | localhost | 3306 | `kira` | `kira` | `kira` |
| MongoDB  | localhost | 27017 | — (no auth) | — | `kira` |
| Redis    | localhost | 6379 | — | — | db 0 |
| Kafka    | localhost | 9092 | — | — | — |
| SQS (LocalStack) | — (URI mode) | — | `test` | `test` | region `us-east-1` |

Connection strings:

```sh
postgresql://kira:kira@localhost:5432/kira
mariadb://kira:kira@localhost:3306/kira
mongodb://localhost:27017/kira
redis://localhost:6379/0
```

Kafka has no auth — in Kira Studio's connection dialog, Fields mode with host `localhost` and port
`9092` is enough.

SQS always needs a real region plus an endpoint override to redirect the AWS SDK at LocalStack
instead of real AWS, so it only works in URI mode (`options.endpoint`, set via the URI's query
string — see `src/shared/domain/uri.ts`):

```sh
sqs://test:test@us-east-1?endpoint=http://localhost:4566
```

## Model

Every relational database uses the same e-commerce-shaped model:

- `customers` (20k)
- `customer_addresses` (20k) → FK `customers`
- `categories` (20k) → self-referencing FK
- `products` (20k) → FK `categories`
- `orders` (20k) → FK `customers`, `customer_addresses`
- `order_items` (80k) → FK `orders`, `products`
- `reviews` (20k) → FK `products`, `customers`
- `data_types_demo` (1) — one row exercising every column type

MongoDB mirrors this with the same collections (`customers`, `addresses`,
`categories`, `products`, `orders`, `orderItems`, `reviews`) using `ObjectId`
references and the same index set (unique, single-field, compound, text,
geospatial).

Redis has no schema; the seed creates 20k keys of each core data type: hashes
(`user:<id>`), strings (`session:<id>`), a sorted set (`leaderboard`), a set
(`active:users`), a list (`recent:events`), and a stream (`events`), plus TTLs.

Kafka gets three topics: `orders` (2 partitions, 6 keyed JSON messages, `{seq}` payloads),
`empty-topic` (0 messages, to exercise an empty topic in the tree), and `large-topic` (4
partitions, 20k keyed JSON messages — the same scale as the relational seeds' `orders` table, to
exercise pagination/large-message-count rendering). A `kira-demo-group` consumer group is
registered by draining `orders` once during seeding, so the consumer-groups view isn't empty
either.

SQS gets three queues: `orders-queue` (5 messages), `drain-queue` (7 messages, a second queue so
polling one doesn't race the other's `VisibilityTimeout`), and `empty-queue` (0 messages).

Unlike the relational/document seeds, the Kafka and SQS seeds are **not** idempotent in the same
way — topics/queues are created with `--if-not-exists`/reused, but re-running `seed.sh` appends
another batch of messages on top of whatever's already there (a topic/queue has no primary key to
upsert against). Use `down -v` + `up -d` + `seed.sh` for a clean slate.

## Files

```
scripts/demo-dbs/
├── docker-compose.yml        # all six services
├── seed.sh                   # run every seed
├── README.md
├── postgres/
│   ├── init.sql              # schema (tables, FKs, indexes) — runs on init
│   └── seed.sql              # 20k-row seed (generate_series)
├── mariadb/
│   ├── init.sql              # schema — runs on init
│   └── seed.sql              # 20k-row seed (seq_1_to_N)
├── mongo/
│   ├── init.js               # collections + indexes — runs on init
│   └── seed.js               # 20k-doc seed
├── redis/
│   └── seed.lua              # 20k-key seed (all data types)
├── kafka/
│   └── seed.sh               # topics + keyed messages + a registered consumer group
└── sqs/
    └── seed.sh               # queues + messages, via LocalStack's `awslocal` CLI
```

## Reset everything

```sh
docker-compose -f scripts/demo-dbs/docker-compose.yml down -v
docker-compose -f scripts/demo-dbs/docker-compose.yml up -d
bash scripts/demo-dbs/seed.sh
```
