#!/usr/bin/env bash
# Daily logical backup of every database in zvonok-postgres (zvonok, glitchtip,
# roles). Runs on the VPS from ~/backup via cron - see README.md.
set -euo pipefail
cd "$(dirname "$0")"
# Optional failure alerts: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID in ./.env
[ -f .env ] && . ./.env

notify() {
  [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ] || return 0
  curl -s -m 10 "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d chat_id="${TELEGRAM_CHAT_ID}" -d text="$1" >/dev/null || true
}

fail() {
  echo "$(date -uIs) FAIL: $*"
  notify "zvonok DB backup FAILED: $*"
  exit 1
}

OUT="zvonok-db-$(date +%F).sql.gz"
trap 'rm -f "${OUT}.tmp"' EXIT

docker exec zvonok-postgres pg_dumpall -U zvonok_admin \
  | gzip > "${OUT}.tmp" || fail "pg_dumpall|gzip exited non-zero"

gzip -t "${OUT}.tmp" || fail "gzip integrity check failed"
[ "$(stat -c%s "${OUT}.tmp")" -gt 1024 ] || fail "dump suspiciously small"
zcat "${OUT}.tmp" | tail -c 200 | grep -q "PostgreSQL database dump complete" \
  || fail "dump end marker missing (truncated dump?)"

mv "${OUT}.tmp" "${OUT}"
# Retention: keep 14 days
find . -maxdepth 1 -name 'zvonok-db-*.sql.gz' -mtime +14 -delete
echo "$(date -uIs) OK: ${OUT} $(stat -c%s "${OUT}") bytes"
