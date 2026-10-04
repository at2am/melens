#!/usr/bin/env bash
set -euo pipefail

T026_SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
T026_REPO_ROOT="$(cd -- "$T026_SCRIPT_DIR/../../../.." && pwd)"
T026_NODE_BIN="${T026_NODE_BIN:-/Users/alexgao/.nvm/versions/node/v24.18.0/bin/node}"
T026_BUILD_DIR="$(mktemp -d /tmp/melens-t026.XXXXXX)"
trap 'rm -rf -- "$T026_BUILD_DIR"' EXIT

cd -- "$T026_REPO_ROOT/cloud/map"
"$T026_NODE_BIN" node_modules/typescript/bin/tsc --project tsconfig.json --outDir "$T026_BUILD_DIR"
cp package.json "$T026_BUILD_DIR/package.json"
ln -s "$PWD/node_modules" "$T026_BUILD_DIR/node_modules"
"$T026_NODE_BIN" --test "$T026_BUILD_DIR/test/aggregation.test.js"

cd -- "$T026_REPO_ROOT/app"
fvm flutter test --no-pub test/features/map/zoom_policy_test.dart
fvm flutter analyze --no-pub test/features/map/zoom_policy_test.dart
