#!/usr/bin/env bash
# Refresh the vendored @capability-ui/core package tarball from a sibling
# Capability-UI checkout. The harness consumes CUP as a prebuilt package
# (vendor/capability-ui-core.tgz), so no sibling is needed to build or run it —
# only to regenerate the tarball when CUP changes.
#
# Usage: ./scripts/vendor-cup.sh [path-to-Capability-UI]   (default: ../Capability-UI)
set -euo pipefail

CUP_DIR="${1:-../Capability-UI}"
HARNESS_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ ! -f "$CUP_DIR/package.json" ]; then
  echo "error: Capability-UI not found at $CUP_DIR" >&2
  exit 1
fi

echo "Building Capability-UI at $CUP_DIR ..."
( cd "$CUP_DIR" && npm install && npm run build )

echo "Packing prebuilt tarball ..."
TGZ="$(cd "$CUP_DIR" && npm pack --silent | tail -n 1)"

mkdir -p "$HARNESS_ROOT/vendor"
mv "$CUP_DIR/$TGZ" "$HARNESS_ROOT/vendor/capability-ui-core.tgz"

echo "Reinstalling harness against the refreshed package ..."
( cd "$HARNESS_ROOT" && npm install )

echo "Done: vendor/capability-ui-core.tgz refreshed from $CUP_DIR"
