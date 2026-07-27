# Shared caching policy, included by both default.vcl (production: the backend
# container) and dev.vcl (local: the dev server on the host). Keeping the policy
# in one file means the two environments can never drift apart — they differ
# ONLY in which backend they point at.
#
# Policy: cache anonymous, cacheable GETs (release pages, search, the popular
# feed, health). Anything authenticated or mutating passes straight through.

sub vcl_recv {
    if (req.method != "GET" && req.method != "HEAD") {
        return (pass);
    }
    # Never cache per-user responses.
    if (req.http.Authorization || req.http.Cookie ~ "refresh_token") {
        return (pass);
    }
    # Cover art PASSES, deliberately — matched FIRST so this is a real rule and
    # not a restatement of the final pass below. Varnish's store is memory
    # (malloc), and image renditions are orders of magnitude larger than the JSON
    # this cache exists to serve: caching them here would evict release and
    # search responses to hold bytes that are already cached twice over — on the
    # origin's own disk (backend/src/services/coverCache.ts) and at Cloudflare,
    # which is where a US visitor should be getting them from anyway.
    if (req.url ~ "^/covers/") {
        return (pass);
    }
    # Avatars PASS for the same reason as covers: Varnish's store is memory, and
    # holding image bytes here evicts the JSON this cache exists to serve. They
    # are already cached on the origin's disk and at Cloudflare, which is where
    # a visitor should be getting them from.
    #
    # There is a second reason specific to avatars. Their 404 is deliberately
    # SHORT-LIVED — it usually means the edge asked for the hash the row held a
    # moment ago, and it heals on the next request. Holding that 404 in a second
    # cache layer would extend exactly the window we shortened it to close.
    if (req.url ~ "^/avatars/") {
        return (pass);
    }

    # Cache only explicitly cache-safe public routes.
    if (req.url ~ "^/api/(releases|search|feed/popular|health)") {
        unset req.http.Cookie;
        return (hash);
    }
    return (pass);
}

sub vcl_backend_response {
    # The origin's refusal wins. The rules below set a TTL by URL, which would
    # otherwise override a `no-store` the backend sent deliberately — and the
    # backend sends it for a reason: a release still being enriched carries a
    # progress field that changes every few seconds, and caching that for 60s
    # hands an anonymous visitor a stale `pending` while the page polls against
    # it. Measured during 6.1.3 verification: six polls over thirty seconds all
    # reported a coverless release that Postgres had already healed.
    #
    # `uncacheable` + a short TTL is a hit-for-pass object: subsequent requests
    # skip the cache instead of queueing behind an uncacheable fetch. Ten
    # seconds, not the usual two minutes — enrichment settles in seconds, and
    # normal 60s caching should resume as soon as it does.
    if (beresp.http.Cache-Control ~ "no-store") {
        set beresp.uncacheable = true;
        set beresp.ttl = 10s;
        return (deliver);
    }
    if (bereq.url ~ "^/api/(releases|search)") {
        set beresp.ttl = 60s;
        set beresp.grace = 30s;
    }
    if (bereq.url ~ "^/api/feed/popular") {
        set beresp.ttl = 300s;
    }
}

sub vcl_deliver {
    # VCL has no ternary operator — this must be a plain if/else. (The previous
    # `(obj.hits > 0) ? "HIT" : "MISS"` was a syntax error that failed VCL
    # compilation outright, so Varnish never started.)
    if (obj.hits > 0) {
        set resp.http.X-Cache = "HIT";
    } else {
        set resp.http.X-Cache = "MISS";
    }
    set resp.http.X-Cache-Hits = obj.hits;
}
