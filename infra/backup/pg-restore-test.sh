#!/usr/bin/env bash
# Weekly disaster-recovery drill: restores the newest dump into a throwaway
# postgres container and verifies both databases come back with tables.
# A backup that has never been restored is a hope, not a backup.
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] && . ./.env

notify() {
  [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ] || return 0
  curl -s -m 10 "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d chat_id="${TELEGRAM_CHAT_ID}" -d text="$1" >/dev/null || true
}

fail() {
  echo "$(date -uIs) FAIL: $*"
  docker rm -f pg-restore-test >/dev/null 2>&1 || true
  notify "zvonok RESTORE DRILL FAILED: $*"
  exit 1
}

LATEST=$(ls -1t zvonok-db-*.sql.gz 2>/dev/null | head -1)
[ -n "${LATEST}" ] || fail "no dump files found"

docker rm -f pg-restore-test >/dev/null 2>&1 || true
# Same major version as prod (16); trust auth is fine: no ports published.
docker run -d --name pg-restore-test -e POSTGRES_HOST_AUTH_METHOD=trust \
  postgres:16 >/dev/null

ready=0
for _ in $(seq 1 30); do
  if docker exec pg-restore-test pg_isready -U postgres >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
[ "$ready" = 1 ] || fail "test container never became ready"

# The entrypoint starts a temporary server during initdb, so pg_isready can
# pass right before a brief gap. Retry the restore itself; a fresh cluster
# also cannot replay PG16 "GRANTED BY" role-membership clauses, so they are
# stripped (the grant is recreated as the executing superuser instead).
restored=0
err=""
for _ in $(seq 1 10); do
  if err=$(gunzip -c "${LATEST}" \
    | sed -E 's/ GRANTED BY [A-Za-z_][A-Za-z0-9_]*//g' \
    | docker exec -i pg-restore-test psql -U postgres -d postgres \
      -q -v ON_ERROR_STOP=1 2>&1 >/dev/null); then
    restored=1
    break
  fi
  sleep 3
done
[ "$restored" = 1 ] || fail "restore of ${LATEST} failed: ${err:0:300}"

for db in zvonok glitchtip; do
  n=$(docker exec pg-restore-test psql -U postgres -d "$db" \
    -tAc "select count(*) from information_schema.tables where table_schema='public'")
  [ "${n:-0}" -gt 0 ] || fail "db ${db} has no tables after restore"
done

docker rm -f pg-restore-test >/dev/null
echo "$(date -uIs) OK: restore drill passed for ${LATEST}"
