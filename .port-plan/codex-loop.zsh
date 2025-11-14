#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
PROMPT_FILE="${PROMPT_FILE:-${SCRIPT_DIR}/standard-prompt.md}"
SLEEP_SECONDS="${SLEEP_SECONDS:-30}"

if [[ ! -f "$PROMPT_FILE" ]]; then
  print -u2 "[codex-loop] Prompt file not found: $PROMPT_FILE"
  exit 1
fi

trap 'print "\n[codex-loop] Caught signal, exiting."; exit 0' INT TERM

extract_prompt() {
  local has_fence prompt
  if grep -q '^```' "$PROMPT_FILE"; then
    prompt=$(awk '
      BEGIN {in_block=0}
      /^```/ {in_block=!in_block; next}
      in_block {print}
    ' "$PROMPT_FILE")
  else
    prompt=$(cat "$PROMPT_FILE")
  fi
  printf '%s' "$prompt"
}

while true; do
  prompt_content="$(extract_prompt)"
  if [[ -z "${prompt_content//[[:space:]]/}" ]]; then
    print -u2 "[codex-loop] Prompt content is empty. Update $PROMPT_FILE."
    exit 1
  fi

  timestamp=$(date '+%Y-%m-%d %H:%M:%S')
  print "[${timestamp}] Launching Codex exec run..."

  codex exec \
    --model gpt-5.1-codex \
    --config model_reasoning_effort=high \
    --dangerously-bypass-approvals-and-sandbox \
    - <<<"$prompt_content"

  timestamp=$(date '+%Y-%m-%d %H:%M:%S')
  print "[${timestamp}] Codex run finished; sleeping ${SLEEP_SECONDS}s."
  sleep "$SLEEP_SECONDS"
done
