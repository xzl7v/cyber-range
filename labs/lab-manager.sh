#!/bin/bash
set -euo pipefail

case "$1" in
  status)
    docker ps --filter "label=cyber-range.session"
    ;;
  cleanup)
    docker ps -aq --filter "label=cyber-range.session" | xargs -r docker rm -f
    ;;
  *)
    echo "Usage: $0 {status|cleanup}"
    ;;
esac
