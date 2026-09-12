#!/bin/bash
COMPOSE_FILE="$HOME/cyber-range/docker-compose.yml"
case "$1" in
  deploy)
    docker compose -f "$COMPOSE_FILE" --profile labs up -d target-dvwa
    echo "[+] Lab DVWA Deployed successfully at: target-dvwa"
    ;;
  destroy)
    docker compose -f "$COMPOSE_FILE" --profile labs stop target-dvwa
    docker compose -f "$COMPOSE_FILE" --profile labs rm -f target-dvwa
    echo "[-] Lab Destroyed."
    ;;
  status)
    docker ps --filter "network=cyber-range_isolated-range"
    ;;
  *)
    echo "Usage: $0 {deploy|destroy|status}"
    ;;
esac
