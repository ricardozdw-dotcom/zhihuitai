#!/usr/bin/env bash
set -euo pipefail
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT/backend"
python3 -m venv .venv
.venv/bin/python -m pip install -e '.[dev]'
cd "$PROJECT_ROOT/frontend"
npm ci
