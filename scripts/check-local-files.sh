#!/bin/bash

set -u

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
project_root="${KC_PREFLIGHT_PROJECT_ROOT:-$(CDPATH= cd -- "$script_dir/.." && pwd)}"
platform="${KC_PREFLIGHT_PLATFORM:-$(uname -s)}"

if [ "$platform" != "Darwin" ]; then
  echo "Knowledge Curator local-file preflight: skipped on $platform."
  echo "PASS"
  exit 0
fi

temporary_root="$(mktemp -d "${TMPDIR:-/tmp}/knowledge-curator-preflight.XXXXXX")"
critical_list="$temporary_root/critical.txt"
node_modules_list="$temporary_root/node-modules.txt"
missing_list="$temporary_root/missing.txt"
trap 'rm -rf "$temporary_root"' EXIT HUP INT TERM
: > "$critical_list"
: > "$node_modules_list"
: > "$missing_list"

detect_dataless() {
  target="$1"
  output_file="$2"
  if [ -n "${KC_PREFLIGHT_FIXTURE_FILE:-}" ]; then
    while IFS= read -r candidate || [ -n "$candidate" ]; do
      case "$candidate" in
        "$target"|"$target"/*) printf '%s\n' "$candidate" >> "$output_file" ;;
      esac
    done < "$KC_PREFLIGHT_FIXTURE_FILE"
    return
  fi
  find "$target" -flags +dataless -print >> "$output_file" 2>/dev/null || {
    echo "Unable to inspect macOS dataless flags under: $target" >&2
    exit 2
  }
}

for relative_path in src scripts tests; do
  target="$project_root/$relative_path"
  if [ ! -d "$target" ]; then
    printf '%s\n' "$target" >> "$missing_list"
  else
    detect_dataless "$target" "$critical_list"
  fi
done

# Commands may opt into additional repository-local inputs (for example,
# regression fixtures) without making unrelated CLIs depend on those files.
if [ -n "${KC_PREFLIGHT_EXTRA_PATHS:-}" ]; then
  previous_ifs="$IFS"
  IFS=':'
  for relative_path in $KC_PREFLIGHT_EXTRA_PATHS; do
    [ -n "$relative_path" ] || continue
    target="$project_root/$relative_path"
    if [ ! -e "$target" ]; then
      printf '%s\n' "$target" >> "$missing_list"
    else
      detect_dataless "$target" "$critical_list"
    fi
  done
  IFS="$previous_ifs"
fi

for relative_path in package.json package-lock.json tsconfig.json esbuild.config.mjs; do
  target="$project_root/$relative_path"
  if [ ! -f "$target" ]; then
    printf '%s\n' "$target" >> "$missing_list"
  else
    detect_dataless "$target" "$critical_list"
  fi
done

if [ -s "$missing_list" ]; then
  echo "Knowledge Curator local-file preflight failed."
  echo
  echo "Required project files or directories are missing:"
  sed "s#^$project_root/##" "$missing_list" | sed -n '1,20p'
  exit 1
fi

critical_count="$(wc -l < "$critical_list" | tr -d ' ')"
if [ "$critical_count" -gt 0 ]; then
  echo "Knowledge Curator local-file preflight failed."
  echo
  echo "Detected macOS/iCloud placeholder files."
  echo "Critical files must be fully downloaded before running this command."
  echo
  sed "s#^$project_root/##" "$critical_list" | sed -n '1,20p'
  if [ "$critical_count" -gt 20 ]; then
    echo "... and $((critical_count - 20)) more files"
  fi
  cat <<EOF

Recommended fix:

1. Open Finder
2. Locate:
   $project_root
3. Right-click the folder
4. Choose "Download Now / 立即下载"
5. Wait until files are fully available locally

Then run:

find src scripts tests -flags +dataless -print

Expected result:
(no output)

For long-term development stability, consider moving the repository
outside iCloud-managed Desktop, for example:

$HOME/Projects/obsidian-knowledge-management
EOF
  exit 1
fi

node_modules="$project_root/node_modules"
if [ ! -d "$node_modules" ]; then
  echo "Knowledge Curator local-file preflight failed."
  echo
  echo "node_modules is missing."
  echo
  echo "Recommended fix:"
  echo
  echo "npm ci"
  exit 1
fi
detect_dataless "$node_modules" "$node_modules_list"
node_modules_count="$(wc -l < "$node_modules_list" | tr -d ' ')"
if [ "$node_modules_count" -gt 0 ]; then
  echo "Knowledge Curator local-file preflight failed."
  echo
  echo "node_modules contains iCloud placeholder files."
  echo
  sed "s#^$project_root/##" "$node_modules_list" | sed -n '1,20p'
  if [ "$node_modules_count" -gt 20 ]; then
    echo "... and $((node_modules_count - 20)) more files"
  fi
  cat <<'EOF'

Recommended fix:

rm -rf node_modules
npm ci
EOF
  exit 1
fi

echo "Knowledge Curator local-file preflight: all required project files are local."
echo "PASS"
