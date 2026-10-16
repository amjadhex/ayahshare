#!/bin/bash
# Embed the clip captions and fill the "clips" Vectorize index, retrying every 10 minutes until Workers AI has free
# neurons again (the free tier is 10,000/day shared with the app; an exhausted day answers HTTP 500, AiError 4006).
# The allocation only comes back at 00:00 UTC, so the loop runs for 30 hours: whenever it starts, it is still trying
# within 10 minutes of the next reset, before the app's traffic spends the new day's neurons.
#   nohup ./retry_vectors.sh > out/logs/a4_vectors.log 2>&1 &
cd "$(dirname "$0")"
for attempt in $(seq 1 180); do
  if ../.venv/bin/python a4_publish.py --vectors-only; then exit 0; fi
  echo "$(date -u +%H:%MZ) attempt $attempt failed, retrying in 10 minutes"
  sleep 600
done
exit 1
