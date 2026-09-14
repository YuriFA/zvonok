#!/usr/bin/env bash
# Map a user-supplied deploy reference to a GHCR image tag.
#
#   sha-<short>  -> passed through (already an image tag)
#   <git-ref>    -> sha-<short> of that commit; deploy tags like
#                   v2026.09.14 are the intended input, but any
#                   rev-parse-able ref works (branch, sha, tag)
#
# Used by `make rollback TAG=...` and usable to inspect what a tag maps to.
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "Usage: $0 <image-tag | git-ref>" >&2
  exit 1
fi

ref=$1

case "$ref" in
  sha-*) echo "$ref" && exit 0 ;;
esac

if sha=$(git rev-parse -q --verify "${ref}^{commit}" 2>/dev/null); then
  echo "sha-$(git rev-parse --short "$sha")"
else
  echo "ERROR: '$ref' is neither an image tag (sha-...) nor a resolvable git ref" >&2
  exit 1
fi
