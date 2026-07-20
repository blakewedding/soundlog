vcl 4.1;
# LOCAL DEVELOPMENT: Varnish runs in a container but the API does not — it's the
# `pnpm dev` (tsx watch) server on the host machine. host.docker.internal routes
# from inside the container back to the host, so `docker compose up -d varnish`
# works standalone with no backend image build.
#
# docker-compose.override.yml mounts this file over /etc/varnish/default.vcl and
# maps host.docker.internal to the host gateway. The caching policy is shared
# with production via cache-policy.vcl.

backend api {
    .host = "host.docker.internal";
    .port = "4000";
}

include "cache-policy.vcl";
