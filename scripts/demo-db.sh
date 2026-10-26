#!/usr/bin/env bash
# Local demo PostgreSQL (port 54329) used by .env.local. Usage: scripts/demo-db.sh start|stop|status
set -euo pipefail
DIR="${DEMO_DB_DIR:-$HOME/.local/share/expense-manager/pg}"
PGCTL="$DIR/node_modules/@embedded-postgres/linux-x64/native/bin/pg_ctl"
case "${1:-status}" in
  start)  "$PGCTL" -D "$DIR/data" -o "-p 54329 -k $DIR" -l "$DIR/pg.log" start ;;
  stop)   "$PGCTL" -D "$DIR/data" stop -m fast ;;
  status) "$PGCTL" -D "$DIR/data" status ;;
  *) echo "usage: $0 start|stop|status" >&2; exit 1 ;;
esac
