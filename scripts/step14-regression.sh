#!/bin/bash
# Step 14 — Fresh cross-engine regression driver for Enterprise Control Center
# Phase 1. Runs Engine 1,3,7,9,11,12 test suites, one file at a time (lesson
# learned from Step 12's PBKDF2-concurrency timeout), switching PM2 server
# state per file's documented invocation mode. Appends all raw `node --test`
# TAP output to one continuous log.
set -uo pipefail
cd /home/user/webapp
LOG="$1"
LOADER="./tests/payment-engine/helpers/ts-extensionless-loader.mjs"

log() { echo "$1" | tee -a "$LOG"; }

stop_server() { pm2 stop naijadeals >/dev/null 2>&1 || true; sleep 1; }
start_server() {
  pm2 restart naijadeals >/dev/null 2>&1 || pm2 start ecosystem.config.cjs >/dev/null 2>&1
  for i in $(seq 1 15); do
    code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/catalog/categories 2>/dev/null)
    if [ "$code" = "200" ]; then return 0; fi
    sleep 1
  done
  log "SERVER FAILED TO START"; return 1
}

FAILED=0
FAILED_FILES=""

run_node() {
  # run_node <timeout_s> <file> <extra flags...>
  local timeout_s="$1" file="$2"; shift 2
  log "----------------------------------------------------------------"
  log "RUNNING: $file  (flags: $*)"
  log "----------------------------------------------------------------"
  timeout "$timeout_s" node "$@" --test "$file" >> "$LOG" 2>&1
  local rc=$?
  log "EXIT_CODE[$file]=$rc"
  if [ $rc -ne 0 ]; then FAILED=1; FAILED_FILES="$FAILED_FILES $file"; fi
  return $rc
}

run_tsx() {
  local timeout_s="$1" file="$2"
  log "----------------------------------------------------------------"
  log "RUNNING (tsx): $file"
  log "----------------------------------------------------------------"
  timeout "$timeout_s" npx tsx --test "$file" >> "$LOG" 2>&1
  local rc=$?
  log "EXIT_CODE[$file]=$rc"
  if [ $rc -ne 0 ]; then FAILED=1; FAILED_FILES="$FAILED_FILES $file"; fi
  return $rc
}

log "===== STEP 14 CROSS-ENGINE REGRESSION START $(date -u +%FT%TZ) ====="

case "$2" in

engine1)
  # Documented Category-C hygiene (docs/ENGINE-1-IDENTITY-ACCESS-COMPLETION.md):
  # local wrangler --local sets cf-connecting-ip=127.0.0.1 for ALL local traffic,
  # so unrelated prior test runs (Control Center Steps 12/13 included) accumulate
  # shared IP-axis login_attempts rows that can pre-trip the throttle before this
  # suite's own dedicated throttling test runs. Clearing at start of run only.
  npx wrangler d1 execute naijadeals-production --local --command="DELETE FROM login_attempts WHERE ip_address='127.0.0.1'" >> "$LOG" 2>&1
  start_server
  for f in tests/identity-engine/*.test.mjs; do
    run_node 240 "$f" --experimental-strip-types
  done
  ;;

engine3)
  start_server
  for f in tests/booking-engine/*.test.mjs; do
    run_node 150 "$f" --experimental-strip-types
  done
  ;;

engine7)
  stop_server
  run_node 100 tests/payment-engine/01.wallet-concurrency.test.mjs --experimental-strip-types
  start_server
  run_node 100 tests/payment-engine/02.webhook-hardening.test.mjs --experimental-strip-types
  stop_server
  run_node 150 tests/payment-engine/03.order-payment-cas.test.mjs --experimental-strip-types --experimental-loader "$LOADER"
  run_node 200 tests/payment-engine/04.refund-concurrency.test.mjs --experimental-strip-types --experimental-loader "$LOADER"
  run_node 150 tests/payment-engine/05.variable-weight-settlement-cas.test.mjs --experimental-strip-types --experimental-loader "$LOADER"
  ;;

engine9)
  start_server
  run_node 100 tests/notification-engine/00.smoke.test.mjs --experimental-strip-types
  stop_server
  run_node 100 tests/notification-engine/02.idempotency-concurrency.test.mjs --experimental-strip-types --experimental-loader "$LOADER"
  start_server
  run_node 100 tests/notification-engine/03.preferences-api.test.mjs --experimental-strip-types
  run_node 100 tests/notification-engine/05.consent-boundary.test.mjs --experimental-strip-types
  stop_server
  run_node 100 tests/notification-engine/06.template-safety.test.mjs --experimental-strip-types --experimental-loader "$LOADER"
  run_node 100 tests/notification-engine/07.providers-outbox.test.mjs --experimental-strip-types --experimental-loader "$LOADER"
  run_node 100 tests/notification-engine/08.regression-proof.test.mjs --experimental-strip-types --experimental-loader "$LOADER"
  start_server
  run_node 100 tests/notification-engine/09.api-security.test.mjs --experimental-strip-types
  ;;

engine11)
  stop_server
  run_node 150 tests/search-engine/01.enqueue-idempotency-concurrency.test.mjs --experimental-strip-types --experimental-loader "$LOADER"
  run_node 150 tests/search-engine/02.product-listing-write-paths.test.mjs --experimental-strip-types --experimental-loader "$LOADER"
  run_node 150 tests/search-engine/03.service-listing-write-paths.test.mjs --experimental-strip-types --experimental-loader "$LOADER"
  run_node 150 tests/search-engine/04.bookable-listing-write-paths.test.mjs --experimental-strip-types --experimental-loader "$LOADER"
  run_node 150 tests/search-engine/05.adjust-stock-write-path.test.mjs --experimental-transform-types --experimental-loader "$LOADER"
  run_node 150 tests/search-engine/06.eligibility.test.mjs --experimental-strip-types --experimental-loader "$LOADER"
  run_node 200 tests/search-engine/07.phase1-integration.test.mjs --experimental-transform-types --experimental-loader "$LOADER"
  ;;

engine12)
  stop_server
  run_node 100 tests/promotion-engine/01.coupon-concurrency-and-rules.test.mjs --experimental-strip-types --experimental-loader "$LOADER"
  run_tsx 280 tests/promotion-engine/02.brand-merchandising.test.mjs
  run_tsx 100 tests/promotion-engine/03.hero-campaign-verification.test.mjs
  start_server
  run_tsx 100 tests/promotion-engine/04.rbac-boundaries.test.mjs
  ;;

esac

stop_server
log "===== STEP 14 [$2] END $(date -u +%FT%TZ) FAILED=$FAILED FAILED_FILES=$FAILED_FILES ====="
exit $FAILED
