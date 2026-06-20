#!/usr/bin/env bash
# post-adhoc.sh — fire a one-off LinkedIn post via the ad-hoc GitHub Action.
# Base64-encodes the text (dodging shell-quoting of apostrophes) and dispatches
# .github/workflows/linkedin-post.yml. Requires the GitHub CLI (`gh`) authenticated.
#
# Usage:
#   scripts/post-adhoc.sh "Most founders go looking for the yes..."   # text as arg
#   scripts/post-adhoc.sh -f path/to/post.txt                          # text from a file
#   scripts/post-adhoc.sh -v CONNECTIONS "..."                         # set visibility
#
# Spec: DVS-LPS-2026-001 v2.0 §5.
set -euo pipefail

VISIBILITY="PUBLIC"
TEXT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -f) TEXT="$(cat "$2")"; shift 2 ;;
    -v) VISIBILITY="$2"; shift 2 ;;
    *)  TEXT="$1"; shift ;;
  esac
done

if [[ -z "$TEXT" ]]; then
  echo "No text. Usage: post-adhoc.sh \"text\"  |  post-adhoc.sh -f file.txt  [-v PUBLIC|CONNECTIONS]" >&2
  exit 1
fi

# base64 (-w0 on GNU; macOS base64 has no -w but also doesn't wrap by default)
B64="$(printf '%s' "$TEXT" | base64 | tr -d '\n')"

echo "Dispatching ad-hoc LinkedIn post (visibility=$VISIBILITY, ${#TEXT} chars)..."
gh workflow run linkedin-post.yml -f text_b64="$B64" -f visibility="$VISIBILITY"
echo "Dispatched. Watch the run:"
gh run list --workflow=linkedin-post.yml --limit 1
echo "Tip: 'gh run watch' to follow it; the run summary prints the post URN + URL."
