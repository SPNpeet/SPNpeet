# ── Stage 1: build whisper.cpp ────────────────────────────────────────────────
FROM debian:bookworm-slim AS whisper-build

RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential cmake git curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
RUN git clone --depth 1 https://github.com/ggml-org/whisper.cpp.git . \
 && cmake -B build -DGGML_OPENMP=OFF \
 && cmake --build build -j "$(nproc)" --config Release --target whisper-cli \
 && bash ./models/download-ggml-model.sh base

RUN mkdir -p /out \
 && cp build/bin/whisper-cli                  /out/ \
 && cp build/src/libwhisper.so*               /out/ \
 && cp build/ggml/src/libggml*.so*            /out/ \
 && cp build/ggml/src/ggml-cpu/libggml-cpu*.so* /out/ 2>/dev/null || true \
 && cp models/ggml-base.bin                    /out/

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg ca-certificates \
      fonts-dejavu \
      fonts-noto-core \
      fonts-noto-cjk \
      fonts-thai-tlwg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install JS deps first to leverage Docker layer cache
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

# App source
COPY pipeline ./pipeline
COPY web      ./web
COPY scripts  ./scripts
COPY README.md ./

# Whisper artefacts from stage 1
COPY --from=whisper-build /out /app/vendor/whisper

# Data directories (mounted as a volume in production)
RUN mkdir -p /app/assets/_uploads /app/renders /app/data
VOLUME ["/app/renders", "/app/data"]

ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/app/data \
    RENDERS_DIR=/app/renders \
    UPLOAD_DIR=/app/assets/_uploads

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

CMD ["node", "web/server.js"]
