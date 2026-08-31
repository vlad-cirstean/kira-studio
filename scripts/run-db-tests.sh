#!/bin/sh
# run-db-tests.sh — P57 D17. Used to also esbuild-bundle tests/db/kafka.spec.ts and run it under a
# real vendored Node process, because Bun could not load @confluentinc/kafka-javascript's native
# addon under any ABI (P32 F21). Kafka went native in Go (P58e M9) and that spec was deleted
# (P58e M9.4) — tests/db/ is now a plain `bun test` suite like every other kind's.
set -eu

bun test tests/db
