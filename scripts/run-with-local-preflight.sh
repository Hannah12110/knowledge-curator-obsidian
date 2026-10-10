#!/bin/bash

set -u

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
bash "$script_dir/check-local-files.sh" || exit $?
exec "$@"
