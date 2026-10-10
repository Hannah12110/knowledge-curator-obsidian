#!/bin/bash

set -u

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
bash "$script_dir/check-local-files.sh" || exit $?

project_root="$(CDPATH= cd -- "$script_dir/.." && pwd)"
dataset_root="$project_root/KnowledgeCuratorValidation/datasets/graph-quality"
dataset_files="evaluation-manifest.json edge-review.json unrelated-review.json orphan-review.json annotations.json"

for name in $dataset_files; do
  file="$dataset_root/$name"
  if [ ! -r "$file" ]; then
    echo "Graph Quality Evaluation dataset is unavailable locally." >&2
    echo "Missing or unreadable frozen file: $name" >&2
    echo "The frozen dataset was not regenerated or modified." >&2
    exit 1
  fi
  if [ "$(uname -s)" = "Darwin" ] && find "$file" -flags +dataless -print 2>/dev/null | grep -q .; then
    echo "Graph Quality Evaluation dataset is unavailable locally." >&2
    echo "macOS/iCloud placeholder file: $name" >&2
    echo "Download the frozen dataset locally; it will not be regenerated." >&2
    exit 1
  fi
done

exec node "$script_dir/review-claim-graph.mjs" "$@"
