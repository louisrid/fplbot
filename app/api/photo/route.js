/* PLAYER PHOTOS, SERVED FROM THIS APP.
 *
 * The portraits live on the Premier League CDN. Pointing an <img> straight at it works, but it
 * makes the app depend on a third party being reachable from wherever the phone happens to be, and
 * it means fifteen cross-origin requests on the busiest screen.
 *
 * Fetching them here instead means one origin, one connection, and a long cache at the edge. A
 * portrait does not change, so it is cached for a day and revalidated in the background after that.
 *
 * A missing photo returns 404 rather than an error page, which is what lets the card component
 * fall back to its silhouette cleanly.
 */

export const dynamic = "force-dynamic";

const SIZES = new Set(["110x140", "250x250"]);

/* One transparent pixel, served with the same long cache as a real portrait so a player without
   one is not re-requested on every render. */
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const transparent = () => new Response(PIXEL, {
  headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400, s-maxage=604800" },
});

/* Query parameter rather than a dynamic segment, for the same reason as the FPL proxy: a folder
   named [code] cannot be uploaded through GitHub's web interface. */
export async function GET(request) {
  const url = new URL(request.url);
  const code = String(url.searchParams.get("code") || "");
  const size = url.searchParams.get("size") || "250x250";

  /* The code is an integer from the FPL bootstrap. Anything else is not a request we made. */
  if (!/^\d+$/.test(code) || !SIZES.has(size)) {
    return new Response("Bad request", { status: 400 });
  }

  try {
    const upstream = await fetch(
      `https://resources.premierleague.com/premierleague/photos/players/${size}/p${code}.png`,
      { headers: { "User-Agent": "Mozilla/5.0" }, cache: "no-store" },
    );
    /* A player with no portrait gets a transparent pixel rather than a 404. The card already
       draws the silhouette underneath, so a transparent image simply lets it show through, and
       the browser logs nothing. Returning 404 worked too, but filled the console with failures
       that were not failures. */
    if (!upstream.ok) return transparent();

    return new Response(upstream.body, {
      headers: {
        "Content-Type": upstream.headers.get("content-type") || "image/png",
        "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
      },
    });
  } catch {
    return transparent();
  }
}
