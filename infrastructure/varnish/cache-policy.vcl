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

    # Cache only explicitly cache-safe public routes.
    if (req.url ~ "^/api/(releases|search|feed/popular|health)") {
        unset req.http.Cookie;
        return (hash);
    }
    return (pass);
}

sub vcl_backend_response {
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
