# Kira Studio — local database fixtures

Spins up all eight of Kira Studio's supported engines (PostgreSQL, MariaDB, MySQL, MongoDB, Redis,
Kafka, SQS, S3) via [Colima](https://github.com/abiosoft/colima) + Docker Compose. The five
relational/document/key-value stores get a full schema, foreign keys, indexes, and ~20k rows of
seed data; Kafka/SQS/S3 get a handful of topics/queues/buckets with a small backlog — enough to
exercise every tree view without waiting on a multi-minute seed.

Kafka uses the same image/mode as the `@testcontainers/kafka` harness under `bun run test:db`
(confluentinc/cp-kafka in KRaft mode) — see `tests/db/support/kafka.ts`. SQS and S3 share one
LocalStack container (`SERVICES=sqs,s3`), same as `@testcontainers/localstack`'s own harnesses —
see `tests/db/support/sqs.ts` and `tests/db/support/s3.ts`.

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
| MySQL    | localhost | 3307 | `kira` | `kira` | `kira` |
| MongoDB  | localhost | 27017 | — (no auth) | — | `kira` |
| Redis    | localhost | 6379 | — | — | db 0 |
| Kafka    | localhost | 9092 | — | — | — |
| SQS (LocalStack) | — (URI mode) | — | `test` | `test` | region `us-east-1` |
| S3 (LocalStack)  | — (URI mode) | — | `test` | `test` | region `us-east-1` |

Connection strings:

```sh
postgresql://kira:kira@localhost:5432/kira
mariadb://kira:kira@localhost:3306/kira
mysql://kira:kira@localhost:3307/kira
mongodb://localhost:27017/kira
redis://localhost:6379/0
```

Kafka has no auth — in Kira Studio's connection dialog, Fields mode with host `localhost` and port
`9092` is enough.

SQS and S3 both always need a real region plus an endpoint override to redirect the AWS SDK at
LocalStack instead of real AWS, so they only work in URI mode (`options.endpoint`, set via the
URI's query string — see `src/shared/domain/uri.ts`):

```sh
sqs://test:test@us-east-1?endpoint=http://localhost:4566
s3://test:test@us-east-1?endpoint=http://localhost:4566
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

S3 gets three buckets. `kira-demo-bucket` carries the full P33 (download/upload/delete/bounded
edit) demo surface: `readme.txt` (root-level, `Metadata.seeded=true`), `reports/notes.txt` and
`reports/2024/summary.json` (nesting depth), `reports/quarter one (Q1).json` (a key with spaces
and parentheses, to exercise path encoding through download/delete/the tab title); a
`sizes/` ladder — `tiny.txt` (0 bytes), `small.json` (~4 KB, ordinary edit case), `medium.csv`
(~512 KB, editable but large enough to feel it), `large.log` (~2 MB — renders, but Edit is
disabled since it's over `OBJECT_BODY_EDIT_BYTES`), `huge.bin` (~8 MB — over
`OBJECT_BODY_PREVIEW_BYTES`, no Body row at all, Download is the only way to see it), `logo.png`
(a real tiny PNG — previews lossily, Edit refused as not valid UTF-8); and `bulk/` with 1,200
small JSON objects, past `ListObjectsV2`'s 1,000-key page, to exercise the tree's continuation
loop. `kira-uploads-bucket` is empty — the upload target, and the case of a bucket with nothing
in it to open an object from (Upload has to be reachable from the bucket row itself).
`kira-empty-bucket` stays empty too, unrelated to uploads.

Unlike the relational/document seeds, the Kafka/SQS/S3 seeds are **not** idempotent in the same
way — topics/queues are created with `--if-not-exists`/reused and S3 objects are simply
overwritten in place, but re-running `seed.sh` appends another batch of messages to Kafka/SQS on
top of whatever's already there (a topic/queue has no primary key to upsert against). Use
`down -v` + `up -d` + `seed.sh` for a clean slate.

## Files

```
scripts/demo-dbs/
├── docker-compose.yml        # all eight services (sqs + s3 share one LocalStack container)
├── seed.sh                   # run every seed
├── README.md
├── postgres/
│   ├── init.sql              # schema (tables, FKs, indexes) — runs on init
│   └── seed.sql              # 20k-row seed (generate_series)
├── mariadb/
│   ├── init.sql              # schema — runs on init
│   └── seed.sql              # 20k-row seed (seq_1_to_N)
├── mysql/
│   ├── init.sql              # schema — runs on init (CHAR(36) stands in for MariaDB's UUID type)
│   └── seed.sql              # 20k-row seed (WITH RECURSIVE, MySQL has no SEQUENCE engine)
├── mongo/
│   ├── init.js               # collections + indexes — runs on init
│   └── seed.js               # 20k-doc seed
├── redis/
│   └── seed.lua              # 20k-key seed (all data types)
├── kafka/
│   └── seed.sh               # topics + keyed messages + a registered consumer group
├── sqs/
│   └── seed.sh               # queues + messages, via LocalStack's `awslocal` CLI
└── s3/
    └── seed.sh               # buckets + nested objects, via LocalStack's `awslocal` CLI
```

## Reset everything

```sh
docker-compose -f scripts/demo-dbs/docker-compose.yml down -v
docker-compose -f scripts/demo-dbs/docker-compose.yml up -d
bash scripts/demo-dbs/seed.sh
```
