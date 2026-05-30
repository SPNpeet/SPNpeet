# ============================================================================
# SPNpeet Transaction Engine — production image
# Multi-stage: build a static binary, ship it on distroless (no shell, tiny,
# minimal CVE surface).
# ============================================================================

# ---- build stage -----------------------------------------------------------
FROM golang:1.23-alpine AS build
WORKDIR /src

# Cache module downloads.
COPY go.mod go.sum ./
RUN go mod download

# Build.
COPY . .
# CGO disabled => fully static binary. Trim symbol tables for a smaller image.
RUN CGO_ENABLED=0 GOOS=linux go build \
      -trimpath -ldflags="-s -w" \
      -o /out/server ./cmd/server

# ---- runtime stage ---------------------------------------------------------
FROM gcr.io/distroless/static-debian12:nonroot AS runtime
WORKDIR /app
COPY --from=build /out/server /app/server

# Run as the distroless nonroot user (uid 65532).
USER nonroot:nonroot
EXPOSE 8080

# The binary supports `-healthcheck` for the compose healthcheck.
ENTRYPOINT ["/app/server"]
