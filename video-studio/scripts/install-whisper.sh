#!/usr/bin/env bash
# Install whisper.cpp + base model into video-studio/vendor/whisper/
# Run once after `npm install`.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR="$ROOT/vendor/whisper"
BUILD="$ROOT/.whisper-build"

if [[ -x "$VENDOR/whisper-cli" && -f "$VENDOR/ggml-base.bin" ]]; then
  echo "✓ whisper-cli already installed at $VENDOR"
  exit 0
fi

echo "→ Cloning whisper.cpp…"
rm -rf "$BUILD"
git clone --depth 1 https://github.com/ggml-org/whisper.cpp.git "$BUILD"

echo "→ Building (this takes ~2 min)…"
cmake -B "$BUILD/build" -S "$BUILD" -DGGML_OPENMP=OFF
cmake --build "$BUILD/build" -j "$(nproc)" --config Release --target whisper-cli

echo "→ Downloading ggml-base model (142 MB)…"
(cd "$BUILD" && sh ./models/download-ggml-model.sh base)

echo "→ Staging binaries to $VENDOR…"
mkdir -p "$VENDOR"
cp "$BUILD/build/bin/whisper-cli"                  "$VENDOR/"
cp "$BUILD/build/src/libwhisper.so"*               "$VENDOR/"
cp "$BUILD/build/ggml/src/libggml"*.so*            "$VENDOR/"
cp "$BUILD/build/ggml/src/ggml-cpu/libggml-cpu"*.so* "$VENDOR/" 2>/dev/null || true
cp "$BUILD/models/ggml-base.bin"                   "$VENDOR/"

echo "→ Cleaning up build dir…"
rm -rf "$BUILD"

echo "✓ whisper installed at $VENDOR"
