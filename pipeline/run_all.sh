#!/bin/bash
# Whole pipeline, in order. Every step is idempotent: rerun after a crash and it continues from cache/.
#   ./run_all.sh --subset                      small run into out/subset/
#   nohup ./run_all.sh > out/logs/full.log 2>&1 &   full run, detached
set -euo pipefail
cd "$(dirname "$0")"
PY=../.venv/bin/python
FLAG="${1:-}"

$PY a1_ayahs.py
$PY a1b_ayah_groups.py
$PY a2_index.py
$PY a3_topics.py $FLAG
$PY a4_candidates.py $FLAG
$PY a4_screen.py $FLAG
$PY a4_encode.py $FLAG
# exit code 2 = only the clips index is missing (Workers AI out of quota): carry on, run ./retry_vectors.sh later
$PY a4_publish.py $FLAG || { [ $? -eq 2 ] && echo "clips index pending: run ./retry_vectors.sh"; }
$PY a5_suggest.py $FLAG
$PY validate.py $FLAG
