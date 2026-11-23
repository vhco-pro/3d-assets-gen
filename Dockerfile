# syntax=docker/dockerfile:1
# Builder and runtime are both Debian 13, so the harvested libraries match the runtime's ABI. The runtime
# is base-nossl: the executable links only glibc, and the cc base's OpenSSL carried an unfixed HIGH CVE.
FROM oven/bun:1.4.5-debian@sha256:3dddea58e1f8f2240eca906b023fedb944f9a8352515a35309fd0c879fe00aaa AS build
WORKDIR /src
COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile --ignore-scripts
COPY tsconfig.json tsconfig.base.json tsconfig.web.json tsconfig.node.json tsconfig.e2e.json vite.config.ts ./
COPY app ./app
ARG APP_VERSION=dev
ARG APP_COMMIT=unknown
RUN bun run build:web \
 && bun app/cli/build-exe.ts --version "$APP_VERSION" --commit "$APP_COMMIT" --out /out/asset-studio
# Harvest the executable's shared libraries except the glibc core, which the distroless runtime provides.
RUN mkdir -p /out/libs /out/data \
 && ldd /out/asset-studio | awk '/=> \// {print $3}' \
    | grep -Ev '/(libc|libm|libdl|libpthread|librt|ld-linux[^/]*)\.so' \
    | xargs -r -I{} cp --parents {} /out/libs/

FROM gcr.io/distroless/base-nossl-debian13:nonroot@sha256:89815d620ac01d8de13cdaf04d19ed874447ca2296d4985b14b818f6e5e47854
COPY --from=build /out/libs/ /
COPY --from=build --chown=nonroot:nonroot /out/data /data
COPY --from=build /out/asset-studio /usr/local/bin/asset-studio
USER nonroot:nonroot
EXPOSE 8790
ENTRYPOINT ["/usr/local/bin/asset-studio"]
CMD ["serve"]
