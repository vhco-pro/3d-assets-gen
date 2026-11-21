# syntax=docker/dockerfile:1
# Builder and runtime are both Debian 13, so the harvested libraries match the runtime's ABI.
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
# Harvest the executable's shared libraries except the glibc core, which distroless/cc already provides.
RUN mkdir -p /out/libs /out/data \
 && ldd /out/asset-studio | awk '/=> \// {print $3}' \
    | grep -Ev '/(libc|libm|libdl|libpthread|librt|ld-linux[^/]*)\.so' \
    | xargs -r -I{} cp --parents {} /out/libs/

FROM gcr.io/distroless/cc-debian13:nonroot@sha256:cb87acc574abe719b6e5c547384defa2f7b1f24af9605d3f618cf852495d8be2
COPY --from=build /out/libs/ /
COPY --from=build --chown=nonroot:nonroot /out/data /data
COPY --from=build /out/asset-studio /usr/local/bin/asset-studio
USER nonroot:nonroot
EXPOSE 8790
ENTRYPOINT ["/usr/local/bin/asset-studio"]
CMD ["serve"]
