/* PROXY TO THE OFFICIAL FPL API.
 *
 * The FPL API sends no CORS headers, so a browser cannot call it directly. Every request from the
 * app goes through here instead. Nothing is stored and nothing is authenticated: these are the same
 * public endpoints anyone can open in a browser tab.
 *
 * Cache windows are deliberately short and differ by endpoint, because the cost of a stale answer
 * differs. Live scores must move within a minute. The bootstrap moves once a day at most.
 */

export const dynamic = "force-dynamic";

const BASE = "https://fantasy.premierleague.com/api";

/* Only these shapes are forwarded. An open proxy that will fetch any path is an invitation. */
const ALLOWED = [
  /^bootstrap-static$/,
  /^fixtures$/,
  /^entry\/\d+$/,
  /^entry\/\d+\/history$/,
  /^entry\/\d+\/transfers$/,
  /^entry\/\d+\/event\/\d+\/picks$/,
  /^event\/\d+\/live$/,
  /^element-summary\/\d+$/,
];

const cacheSeconds = (path) => {
  if (path.endsWith("/live")) return 45;
  if (path.startsWith("entry/")) return 60;
  if (path === "fixtures") return 120;
  return 900;
};

/* The endpoint is taken from a query parameter rather than a dynamic path segment.
 *
 * A catch-all route lives in a folder literally named [...path], and GitHub's web uploader refuses
 * to accept folder names containing square brackets. Since uploading through the browser is how
 * this app gets deployed, a route that cannot be uploaded is a route that does not work. A query
 * parameter does the same job with a name that survives the trip. */
export async function GET(request) {
  const url = new URL(request.url);
  const path = (url.searchParams.get("path") || "").replace(/^\/+|\/+$/g, "");
  if (!ALLOWED.some((rule) => rule.test(path))) {
    return Response.json({ error: "not a permitted endpoint" }, { status: 400 });
  }

  /* Everything except `path` is forwarded upstream, so ?event=2 still reaches the FPL API. */
  const forwarded = new URLSearchParams(url.searchParams);
  forwarded.delete("path");
  const query = forwarded.toString();
  const target = `${BASE}/${path}/${query ? `?${query}` : ""}`;

  try {
    /* no-store rather than Next's data cache. The bootstrap is 2.2MB and Next refuses to cache
       anything over 2MB, so every request silently missed and refetched the lot. Caching is done
       instead by the Cache-Control header below, which the CDN honours and which has no size
       limit. */
    const upstream = await fetch(target, {
      headers: { "User-Agent": "Mozilla/5.0", accept: "application/json" },
      cache: "no-store",
    });
    if (!upstream.ok) {
      return Response.json({ error: `FPL returned ${upstream.status}` }, { status: upstream.status });
    }
    const body = await upstream.json();
    return Response.json(body, {
      headers: { "Cache-Control": `public, s-maxage=${cacheSeconds(path)}, stale-while-revalidate=300` },
    });
  } catch (error) {
    return Response.json({ error: String(error?.message || error) }, { status: 502 });
  }
}
