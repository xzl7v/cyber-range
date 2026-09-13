#!/bin/bash
clear
echo "=================================================="
echo "         CYBER-RANGE: OWNER DASHBOARD             "
echo "=================================================="
echo ""
echo "[+] Runtime manager activity:"
docker logs --tail 10 -f cyber-range-runtime-manager 2>&1 &
PID_STUDENT=$!

echo ""
echo "[+] Press [CTRL+C] to exit monitoring."
trap "kill $PID_STUDENT 2>/dev/null; exit" INT
wait
