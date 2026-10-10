#!/bin/sh
# Rebuilds the generated pictures in docs/images/ (banner, decision, typing, relay, sweet-spot).
# social-preview.png is not built here; see CONTRIBUTING.md.
set -e
cd "$(dirname "$0")"
for g in banner decision held relay sweet; do python3 "$g.py"; done
