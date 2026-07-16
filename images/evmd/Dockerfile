# evmd image for starskiff test instances.
#
# cosmos/evm (evmd) links go-ethereum's cgo secp256k1 (ante/cosmos/eip712.go
# calls secp256k1.RecoverPubkey / VerifySignature), so CGO_ENABLED=0 does NOT
# compile — a plain cross-compile is off the table. Instead the builder stage
# runs on the TARGET platform (note: NO `--platform=$BUILDPLATFORM` on the FROM),
# so buildx compiles each arch natively with its own gcc — amd64 native on the
# runner, arm64 under QEMU. The emulation cost is at BUILD time only; the
# produced binary is native for its arch.
#
# Build via: docker buildx build --platform linux/amd64,linux/arm64 \
#   --build-arg REF=<tag> --build-arg REPO=cosmos/evm ...
ARG GO_VERSION=1.25.9
ARG RUNTIME_BASE=gcr.io/distroless/base-debian12:nonroot

FROM golang:${GO_VERSION}-bookworm AS builder

# Upstream source pin. REF is the git tag; COMMIT is REQUIRED and asserted
# against the checked-out HEAD, so a moved tag fails the build instead of
# silently publishing a different revision (config/images.json always carries
# the commit, and the publish workflow passes it).
ARG REPO=cosmos/evm
ARG REF
ARG COMMIT

RUN test -n "${REF}" || (echo "REF build-arg is required" >&2; exit 1)
RUN test -n "${COMMIT}" || (echo "COMMIT build-arg is required (immutable-source guarantee)" >&2; exit 1)

RUN git clone --depth 1 --branch "${REF}" "https://github.com/${REPO}.git" /src \
    && cd /src \
    && HEAD_SHA="$(git rev-parse HEAD)" \
    && if [ "${HEAD_SHA}" != "${COMMIT}" ]; then \
         echo "commit mismatch: tag ${REF} is ${HEAD_SHA}, expected ${COMMIT}" >&2; exit 1; \
       fi \
    && echo "building ${REPO}@${REF} (${HEAD_SHA})"

# evmd is a nested module under ./evmd; its Makefile builds ./cmd/evmd with
# CGO_ENABLED=1 and the netgo tag. Build here directly so we control flags.
WORKDIR /src/evmd
ARG TARGETOS
ARG TARGETARCH
RUN CGO_ENABLED=1 GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
      go build -tags "netgo" -trimpath -o /out/evmd ./cmd/evmd \
    && /out/evmd version 2>&1 | head -1

FROM ${RUNTIME_BASE}
COPY --from=builder /out/evmd /usr/bin/evmd
# NO ENTRYPOINT: starskiff invokes the container as `docker run IMAGE evmd <args>`,
# resolving `evmd` on PATH (/usr/bin). An entrypoint of /usr/bin/evmd would make
# that `evmd evmd <args>` and double the command. Matches how the official xpla
# image (no entrypoint) is driven.
