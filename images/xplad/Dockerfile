# Package the official release binaries: the upstream v1.14.0 image build failed.
# Downloads run on the builder's native platform; no emulated compilation.
FROM --platform=$BUILDPLATFORM alpine:3.22 AS artifact
RUN apk add --no-cache ca-certificates curl git

ARG REPO=xpladev/xpla
ARG REF
ARG COMMIT
ARG TARGETARCH
ARG SHA256_AMD64
ARG SHA256_ARM64

# Verify the release tag's source revision as well as each published binary.
RUN test -n "${REF}" && test -n "${COMMIT}" \
    && git clone --depth 1 --branch "${REF}" "https://github.com/${REPO}.git" /src \
    && test "$(git -C /src rev-parse HEAD)" = "${COMMIT}"

RUN case "${TARGETARCH}" in \
      amd64) asset_arch=x86_64; checksum="${SHA256_AMD64}" ;; \
      arm64) asset_arch=arm64; checksum="${SHA256_ARM64}" ;; \
      *) echo "unsupported architecture: ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
    && test -n "${checksum}" \
    && curl -fL --retry 3 "https://github.com/${REPO}/releases/download/${REF}/xpla_${REF#v}_Linux_${asset_arch}.tar.gz" -o /tmp/xpla.tar.gz \
    && echo "${checksum}  /tmp/xpla.tar.gz" | sha256sum -c - \
    && mkdir /out \
    && tar -xzf /tmp/xpla.tar.gz -C /out \
    && chmod 0555 /out/xplad

# Upstream release binaries are statically linked, including wasmvm.
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=artifact /out/xplad /usr/bin/xplad
