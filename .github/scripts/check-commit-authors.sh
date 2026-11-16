#!/usr/bin/env bash
# Usage: check-commit-authors.sh <range> [owner-login pull-request-author-login]
#
# Rule 1 (always): no commit may be authored or committed by a known AI agent, name one in a
#   Co-authored-by trailer or carry an agent signature in its message.
# Rule 2 (only when the pull request author is the owner): every author, committer and
#   Co-authored-by trailer must be one of the owner's identities.
set -euo pipefail

range="$1"
owner_login="${2:-}"
pr_author="${3:-}"

AI_EMAIL='anthropic\.com|claude|copilot|cursoragent|@cursor\.com|openai|codex|chatgpt|gemini|jules|devin-ai|cognition|aider|windsurf|codeium|amazonq|openhands|antigravity|opencode'
AI_NAME='claude|copilot|cursor agent|codex|chatgpt|gemini|devin ai|devin-ai|aider|jules\[bot\]|google jules|windsurf|openhands|antigravity'
AI_SIGNATURE='^Claude-Session:|Generated with \[?(Claude|Codex|Cursor|Copilot|Gemini|Devin)'

OWNER_EMAIL='^(nassifrroma@gmail\.com|([0-9]+\+)?douglasjunior@users\.noreply\.github\.com)$'
OWNER_COMMITTER_EMAIL='^(nassifrroma@gmail\.com|([0-9]+\+)?douglasjunior@users\.noreply\.github\.com|noreply@github\.com)$'

check_owner=false
if [ -n "$owner_login" ] && [ "$(tr '[:upper:]' '[:lower:]' <<<"$pr_author")" = "$(tr '[:upper:]' '[:lower:]' <<<"$owner_login")" ]; then
  check_owner=true
fi

failures=0
fail() {
  echo "::error::$1"
  failures=$((failures + 1))
}

while read -r sha; do
  short="${sha:0:7}"
  author_name="$(git show -s --format=%an "$sha")"
  author_email="$(git show -s --format=%ae "$sha")"
  committer_name="$(git show -s --format=%cn "$sha")"
  committer_email="$(git show -s --format=%ce "$sha")"
  message="$(git show -s --format=%B "$sha")"
  coauthors="$(grep -iE '^Co-authored-by:' <<<"$message" || true)"

  for who in "author|$author_name|$author_email" "committer|$committer_name|$committer_email"; do
    IFS='|' read -r role name email <<<"$who"
    if grep -qiE "$AI_EMAIL" <<<"$email" || grep -qiE "$AI_NAME" <<<"$name"; then
      fail "$short: $role '$name <$email>' is an AI agent"
    fi
  done

  if grep -qiE "$AI_EMAIL|$AI_NAME" <<<"$coauthors"; then
    fail "$short: Co-authored-by names an AI agent"
  fi
  if grep -qiE "$AI_SIGNATURE" <<<"$message"; then
    fail "$short: message carries an AI agent signature"
  fi

  if $check_owner; then
    grep -qE "$OWNER_EMAIL" <<<"$author_email" || fail "$short: author <$author_email> is not an owner identity"
    grep -qE "$OWNER_COMMITTER_EMAIL" <<<"$committer_email" || fail "$short: committer <$committer_email> is not an owner identity"
    if [ -n "$coauthors" ]; then
      fail "$short: Co-authored-by is not allowed in the owner's pull requests"
    fi
  fi
done < <(git rev-list "$range")

[ "$failures" -eq 0 ] || exit 1
echo "All commits in $range passed."
