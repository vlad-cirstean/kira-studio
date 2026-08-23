#!/usr/bin/env bash
# Kira Studio — S3 demo seed. Runs *inside* the kira-sqs (LocalStack) container (docker exec -i
# ... < this file), using the `awslocal` CLI the localstack image ships on PATH — the same one
# container sqs/seed.sh uses, since docker-compose.yml's SERVICES lists both. Mirrors
# tests/db/fixtures/0007_s3_seed.ts's shape (bucket/prefix/object layout) without an AWS SDK
# dependency.
set -euo pipefail

awslocal s3 mb s3://kira-demo-bucket >/dev/null
awslocal s3 mb s3://kira-empty-bucket >/dev/null

echo -n "hello from the bucket root" |
  awslocal s3 cp - s3://kira-demo-bucket/readme.txt --content-type text/plain >/dev/null
echo -n '{"year":2024,"total":42}' |
  awslocal s3 cp - s3://kira-demo-bucket/reports/2024/summary.json --content-type application/json >/dev/null
echo -n "a sibling of the 2024/ prefix, under reports/ itself" |
  awslocal s3 cp - s3://kira-demo-bucket/reports/notes.txt --content-type text/plain >/dev/null
