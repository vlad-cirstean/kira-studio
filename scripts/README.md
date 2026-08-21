# Kira Studio — local database fixtures

Spins up four databases (PostgreSQL, MariaDB, MongoDB, Redis) via
[Colima](https://github.com/abiosoft/colima) + Docker Compose, each with a full
schema, foreign keys, indexes, and ~20k rows of seed data.

## Requirements

- [Colima](https://github.com/abiosoft/colima) running with the Docker runtime
- `docker` and `docker-compose` on the PATH

## Start the databases

```sh
docker-compose -f scripts/docker-compose.yml up -d
```

Wait for all containers to report healthy:

```sh
docker ps
```

## Seed the data (idempotent — safe to re-run)

```sh
bash scripts/seed.sh
```

The schema is applied automatically on first container start (via
`/docker-entrypoint-initdb.d`). The seed step is separate and can be re-run any
time to reset data.

## Connections

| Database | Host | Port | User     | Password | DB   |
|----------|------|------|----------|----------|------|
| PostgreSQL | localhost | 5432 | `kira` | `kira` | `kira` |
| MariaDB  | localhost | 3306 | `kira` | `kira` | `kira` |
| MongoDB  | localhost | 27017 | — (no auth) | — | `kira` |
| Redis    | localhost | 6379 | — | — | db 0 |

Connection strings:

```sh
postgresql://kira:kira@localhost:5432/kira
mariadb://kira:kira@localhost:3306/kira
mongodb://localhost:27017/kira
redis://localhost:6379/0
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

## Files

```
scripts/
├── docker-compose.yml        # the four services
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
└── redis/
    └── seed.lua              # 20k-key seed (all data types)
```

## Reset everything

```sh
docker-compose -f scripts/docker-compose.yml down -v
docker-compose -f scripts/docker-compose.yml up -d
bash scripts/seed.sh
```
