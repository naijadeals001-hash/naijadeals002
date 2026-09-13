#!/bin/bash
# Engine 9 Final Closure — consolidated regression driver.
# Runs Payment 01-05, Booking 01-09, Engine9 (00,02,03,05,06,07,08,09) in the
# exact order specified in the closure prompt, switching PM2 server state
# per file's documented invocation mode (HTTP vs direct-lib), and appends
# every file's raw `node --test` TAP output to ONE continuous log so the
# final report can quote the actual final run, not historical numbers.
set -uo pipefail
cd /home/user/webapp
LOG="$1"
LOADER="./tests/payment-engine/helpers/ts-extensionless-loader.mjs"

log() { echo "$1" | tee -a "$LOG"; }

stop_server() {
  pm2 stop naijadeals >/dev/null 2>&1 || true
  sleep 1
}

start_server() {
  pm2 restart naijadeals >/dev/null 2>&1 || pm2 start ecosystem.config.cjs >/dev/null 2>&1
  for i in $(seq 1 15); do
    code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/catalog/categories 2>/dev/null)
    if [ "$code" = "200" ]; then return 0; fi
    sleep 1
  done
  log "SERVER FAILED TO START"
  return 1
}

run_file() {
  local mode="$1" file="$2" timeout_s="$3"
  log "----------------------------------------------------------------"
  log "RUNNING [$mode]: $file"
  log "----------------------------------------------------------------"
  if [ "$mode" = "HTTP" ]; then
    start_server || { log "RESULT: $file -> ABORT (server did not start)"; return 1; }
    timeout "$timeout_s" node --experimental-strip-types --test "$file" >> "$LOG" 2>&1
  else
    stop_server
    timeout "$timeout_s" node --experimental-strip-types --experimental-loader "$LOADER" --test "$file" >> "$LOG" 2>&1
  fi
  local rc=$?
  log "EXIT_CODE[$file]=$rc"
  return $rc
}

log "===== CONSOLIDATED REGRESSION START $(date -u +%FT%TZ) ====="

FAILED=0

# ---------------- PAYMENT ENGINE ----------------
run_file DIRECT tests/payment-engine/01.wallet-concurrency.test.mjs 100 || FAILED=1
[ $FAILED -eq 0 ] && { run_file HTTP tests/payment-engine/02.webhook-hardening.test.mjs 100 || FAILED=1; }
[ $FAILED -eq 0 ] && { run_file DIRECT tests/payment-engine/03.order-payment-cas.test.mjs 150 || FAILED=1; }
[ $FAILED -eq 0 ] && { run_file DIRECT tests/payment-engine/04.refund-concurrency.test.mjs 200 || FAILED=1; }
[ $FAILED -eq 0 ] && { run_file DIRECT tests/payment-engine/05.variable-weight-settlement-cas.test.mjs 150 || FAILED=1; }

# ---------------- BOOKING ENGINE ----------------
if [ $FAILED -eq 0 ]; then
  start_server
  for f in 01.booking-creation 02.authorization-tenant-isolation 03.state-machine 04.availability-collision 05.concurrency 06.cancellation-refund 07.provider-ownership-isolation 08.idempotency 09.security-regression; do
    log "----------------------------------------------------------------"
    log "RUNNING [HTTP]: tests/booking-engine/${f}.test.mjs"
    log "----------------------------------------------------------------"
    timeout 250 node --experimental-strip-types --test "tests/booking-engine/${f}.test.mjs" >> "$LOG" 2>&1
    rc=$?
    log "EXIT_CODE[tests/booking-engine/${f}.test.mjs]=$rc"
    if [ $rc -ne 0 ]; then FAILED=1; break; fi
  done
fi

# ---------------- ENGINE 9 ----------------
[ $FAILED -eq 0 ] && { run_file HTTP tests/notification-engine/00.smoke.test.mjs 100 || FAILED=1; }
[ $FAILED -eq 0 ] && { run_file DIRECT tests/notification-engine/02.idempotency-concurrency.test.mjs 100 || FAILED=1; }
[ $FAILED -eq 0 ] && { run_file HTTP tests/notification-engine/03.preferences-api.test.mjs 100 || FAILED=1; }
[ $FAILED -eq 0 ] && { run_file HTTP tests/notification-engine/05.consent-boundary.test.mjs 100 || FAILED=1; }
[ $FAILED -eq 0 ] && { run_file DIRECT tests/notification-engine/06.template-safety.test.mjs 100 || FAILED=1; }
[ $FAILED -eq 0 ] && { run_file DIRECT tests/notification-engine/07.providers-outbox.test.mjs 100 || FAILED=1; }
[ $FAILED -eq 0 ] && { run_file DIRECT tests/notification-engine/08.regression-proof.test.mjs 100 || FAILED=1; }
[ $FAILED -eq 0 ] && { run_file HTTP tests/notification-engine/09.api-security.test.mjs 100 || FAILED=1; }

stop_server

log "===== CONSOLIDATED REGRESSION END $(date -u +%FT%TZ) FAILED=$FAILED ====="
exit $FAILED
