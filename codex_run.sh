#!/usr/bin/env bash
# codex_run.sh — unattended Codex launcher with Git-guard
export OPENAI_API_KEY="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"

GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'; RED=$'\033[0;31m'; NC=$'\033[0m'

# 1. Verify Codex CLI
command -v codex >/dev/null || { echo -e "${RED}codex not found. Install with: npm i -g @openai/codex${NC}"; exit 1; }

# 2. Ensure repo safety
if ! git rev-parse --is-inside-work-tree &>/dev/null; then
  echo -e "${YELLOW}No Git repo detected; initialising so Codex can auto-revert…${NC}"
  git init -q || { echo -e "${RED}git not available – falling back to --dangerously-auto-approve-everything${NC}"; UNSAFE=1; }
fi

# 3. Build Codex command
FLAGS=(-a full-auto)
[[ $UNSAFE == 1 ]] && FLAGS=(--dangerously-auto-approve-everything)

# 4. Run Codex (spinner kept minimal to avoid input clashes)
echo -e "${GREEN}Starting Codex ${FLAGS[*]}${NC}"
if [ $# -gt 0 ]; then codex "${FLAGS[@]}" "$@"; else codex "${FLAGS[@]}"; fi
