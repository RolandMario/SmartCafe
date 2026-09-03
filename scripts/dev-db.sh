#!/bin/bash
# Dev helper: download + run a local MongoDB 7 single-node replica set.
# Location: ./scripts/dev-db.sh
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MONGO_DIR="$ROOT/.mongo"
DATA_DIR="$MONGO_DIR/data"
VERSION="7.0.14"

URL="https://fastdl.mongodb.org/osx/mongodb-macos-arm64-$VERSION.tgz"

download() {
  echo "Downloading MongoDB $VERSION ($URL)…"
  mkdir -p "$MONGO_DIR"
  curl -sL -o "$MONGO_DIR/mongodb.tgz" "$URL"
  echo "Extracting…"
  tar xzf "$MONGO_DIR/mongodb.tgz" -C "$MONGO_DIR" --strip-components=1
  rm -f "$MONGO_DIR/mongodb.tgz"
}

ensure_bin() {
  if [ ! -x "$MONGO_DIR/bin/mongod" ]; then
    download
  fi
}

initiate_rs() {
  # Idempotent replica-set init: only fires if not already configured.
  "$MONGO_DIR/bin/mongod" --version >/dev/null
  node -e "
    const {MongoClient} = (() => { try { return require('/Users/macbookair/Desktop/projects/cafe/backend/node_modules/mongodb'); } catch { return null; } })();
    if (!MongoClient) return process.exit(0);
    (async () => {
      const c = new MongoClient('mongodb://localhost:27017/?directConnection=true');
      await c.connect();
      const hello = await c.db('admin').command({ hello: 1 });
      if (!hello.isWritablePrimary) {
        try {
          await c.db('admin').command({ replSetInitiate: { _id: 'rs0', members: [{ _id: 0, host: 'localhost:27017' }] } });
          console.log('Replica set initiated (rs0)');
        } catch (e) { if (!String(e.message).includes('already initialized')) throw e; }
      }
      await c.close();
    })().catch((e) => { console.error(e.message); process.exit(1); });
  " || true
}

case "${1:-start}" in
  start)
    ensure_bin
    mkdir -p "$DATA_DIR"
    if pgrep -f "mongod.*$DATA_DIR" >/dev/null; then
      echo "mongod already running (data dir: $DATA_DIR)"
    else
      nohup "$MONGO_DIR/bin/mongod" \
        --dbpath "$DATA_DIR" \
        --port 27017 \
        --bind_ip 127.0.0.1 \
        --replSet rs0 \
        > "$MONGO_DIR/mongod.log" 2>&1 &
      echo "mongod starting (pid $!) — log: $MONGO_DIR/mongod.log"
      sleep 3
    fi
    initiate_rs
    echo "MongoDB ready on mongodb://localhost:27017 (replica set: rs0)"
    ;;
  stop)
    pkill -f "mongod.*$DATA_DIR" || echo "mongod not running"
    ;;
  restart)
    "$0" stop
    sleep 1
    "$0" start
    ;;
  *)
    echo "Usage: $0 {start|stop|restart}"
    exit 1
    ;;
esac