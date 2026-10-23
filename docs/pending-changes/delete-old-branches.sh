#!/bin/sh
# Delete the old remote branch names that chapter/<name> replaced (P330).
# Usage: run locally from a clone with push rights: sh docs/pending-changes/delete-old-branches.sh
# The agent session proxy returns 403 on branch deletes, so a person runs this.
# Delete this file afterwards.
set -eu

for name in v0.2.10 v2.0 v2.6 v2.8; do
  old="$(git ls-remote origin "refs/heads/$name" | cut -f1)"
  new="$(git ls-remote origin "refs/heads/chapter/$name" | cut -f1)"
  if [ -z "$old" ]; then
    echo "skip $name: already deleted"
  elif [ -z "$new" ]; then
    echo "skip $name: origin/chapter/$name missing"
  elif [ "$old" != "$new" ]; then
    echo "skip $name: differs from origin/chapter/$name ($old vs $new)"
  else
    git push origin --delete "$name"
  fi
done
