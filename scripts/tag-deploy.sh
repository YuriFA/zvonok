#!/usr/bin/env bash
# Mark a successful deploy: push a CalVer git tag for the deployed
# commit and publish a GitHub Release for it (the deploy changelog).
#
# Called by the workstation deploy path (`make deploy`). The CI path
# (deploy.yml) does not tag - both paths push the same sha-<short> +
# latest tags, so either can be the one that shipped.
# Rollback runs never call this - they redeploy an existing marker.
#
# Idempotent: if the deployed commit already has a deploy tag, keep it
# and only (re)publish a missing Release.
#
# Tag scheme: vYYYY.MM.DD (UTC), -2/-3/... for later deploys the same
# day. Release notes: feat/fix commits since the previous deploy tag.
#
# Needs git push access and an authenticated gh CLI.
set -euo pipefail

dry_run=0
[ "${1:-}" = "--dry-run" ] && dry_run=1

die() { echo "ERROR: $*" >&2; exit 1; }

# The tag must name exactly what was deployed: docker build ships the
# working tree, so uncommitted changes would make the marker lie.
[ -z "$(git status --porcelain)" ] \
  || die "working tree is dirty - commit or stash first; a deploy tag must name exactly what ships"

if [ "$dry_run" -eq 0 ]; then
  command -v gh >/dev/null 2>&1 || die "gh CLI missing (brew install gh && gh auth login)"
  gh auth status >/dev/null 2>&1 || die "gh is not authenticated - run: gh auth login"
fi

# Same-day suffixing and the notes range both depend on origin's tags.
git fetch --tags --quiet origin

head_sha=$(git rev-parse HEAD)
short=$(git rev-parse --short HEAD)
today=$(date -u +%Y.%m.%d)

deploy_tag_re='^v[0-9]{4}\.[0-9]{2}\.[0-9]{2}(-[0-9]+)?$'

# Already tagged (the same commit deployed twice): keep it.
tag=$(git tag --points-at "$head_sha" | grep -E "$deploy_tag_re" | head -n 1 || true)
new_tag=0
if [ -z "$tag" ]; then
  new_tag=1
  tag="v$today"
  n=1
  while git rev-parse -q --verify "refs/tags/$tag" >/dev/null; do
    n=$((n + 1))
    tag="v$today-$n"
  done
fi

# Previous deploy marker: nearest tagged ancestor of HEAD's parent, so
# a tag on HEAD itself (idempotent re-run) never empties the notes range.
prev=$(git describe --abbrev=0 --match 'v[0-9][0-9][0-9][0-9].[0-9][0-9].[0-9][0-9]' "$head_sha^" 2>/dev/null || true)
range="${prev:+$prev..}$head_sha"

notes=$(git log --oneline --no-decorate "$range" | grep -E '^[0-9a-f]{7,} (feat|fix)(\([^)]*\))?:' || true)
[ -n "$notes" ] || notes="No user-facing changes since ${prev:-the first deploy} (chore/docs/refactor only)."

echo "deploy tag : $tag  (commit $short)"
echo "prev marker: ${prev:-<none - first deploy tag>}"
echo "notes from : $range"
if [ "$dry_run" -eq 1 ]; then
  echo "--- dry run: release notes would be ---"
  printf '%s\n' "$notes"
  exit 0
fi

if [ "$new_tag" -eq 1 ]; then
  git tag "$tag" "$head_sha"
  git push origin "refs/tags/$tag"
fi

if gh release view "$tag" >/dev/null 2>&1; then
  echo "release $tag already published - done."
  exit 0
fi

gh release create "$tag" --title "$tag" --notes "$notes"
echo "published release $tag"
