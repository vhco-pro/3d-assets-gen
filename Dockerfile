# syntax=docker/dockerfile:1
# Builder and runtime are both Debian 13, so the harvested libraries match the runtime's ABI. The runtime
# is base-nossl: the executable links only glibc, and the cc base's OpenSSL carried an unfixed HIGH CVE.
FROM oven/bun:1.4.3-debian@sha256:923bedb355f7746666659f71e724998159a5c8c54bd1cb1030e1975a0698415b AS build
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

FROM gcr.io/distroless/base-nossl-debian13:nonroot@sha256:4006ac92504be607b70de01d1f64f38288c69fcd8faa820f6d3aed266ea32ac5
COPY --from=build /out/libs/ /
COPY --from=build --chown=nonroot:nonroot /out/data /data
COPY --from=build /out/asset-studio /usr/local/bin/asset-studio
USER nonroot:nonroot
EXPOSE 8790
ENTRYPOINT ["/usr/local/bin/asset-studio"]
CMD ["serve"]
