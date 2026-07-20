vcl 4.1;
# PRODUCTION / full-stack compose: Varnish fronts the backend CONTAINER, reached
# by its compose service name on the shared network.
#
# For local development against `pnpm dev` on the host, docker-compose.override.yml
# swaps this file for dev.vcl (see that file). The caching policy itself lives in
# cache-policy.vcl and is shared by both.

backend api {
    .host = "backend";
    .port = "4000";
}

include "cache-policy.vcl";
