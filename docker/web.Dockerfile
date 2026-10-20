# AWS dev web image (deployment.md — Add-on AWS Dev Environment): Caddy + the built SPA + Caddyfile.aws.
# BUILD_IMAGE is the `build` target of apps/api/Dockerfile for the same commit, so the SPA comes from
# the same frozen-lockfile build as the API image. Built by scripts/aws/deploy-dev.sh.
ARG BUILD_IMAGE
FROM ${BUILD_IMAGE} AS build

FROM caddy:2.11.4
COPY --from=build /workspace/apps/web/dist /srv
COPY docker/Caddyfile.aws /etc/caddy/Caddyfile
EXPOSE 80
