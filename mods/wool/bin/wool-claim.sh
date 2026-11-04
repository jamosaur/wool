#!/bin/sh
# wool-claim.sh <folder> [fresh-minutes]
# Prints exactly one line:
#   not-linked                                   not a linked git worktree
#   stale                                        made more than [fresh-minutes] (3) ago
#   taken                                        wool already handled it (or is handling it)
#   claimed<TAB><git-dir><TAB><main-root><TAB><branch>
# The claim is mkdir "<git-dir>/wool": atomic, so two copies of wool (two
# windows, or a reload mid-setup) can never both claim one worktree.
set -u

folder=$1
minutes=${2:-3}

cd "$folder" 2>/dev/null || { echo not-linked; exit 0; }
dirs=$(git rev-parse --path-format=absolute --git-dir --git-common-dir 2>/dev/null) || { echo not-linked; exit 0; }
gitdir=$(printf '%s\n' "$dirs" | sed -n 1p)
common=$(printf '%s\n' "$dirs" | sed -n 2p)
if [ -z "$gitdir" ] || [ -z "$common" ] || [ "$gitdir" = "$common" ]; then
  echo not-linked
  exit 0
fi

# git worktree add writes <git-dir>/commondir once; its age is the worktree's.
if [ -z "$(find "$gitdir/commondir" -mmin "-$minutes" 2>/dev/null)" ]; then
  echo stale
  exit 0
fi

if ! mkdir "$gitdir/wool" 2>/dev/null; then
  if [ -d "$gitdir/wool" ]; then echo taken; exit 0; fi
  echo "wool-claim: can't create $gitdir/wool" >&2
  exit 1
fi

case $common in
  */.git) main=${common%/.git} ;;
  *) main=$(git worktree list --porcelain | sed -n '1s/^worktree //p') ;;
esac
branch=$(git symbolic-ref --short -q HEAD 2>/dev/null || true)
printf 'claimed\t%s\t%s\t%s\n' "$gitdir" "$main" "$branch"
