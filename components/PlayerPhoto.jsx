"use client";

import { useState, useEffect } from "react";
import { photoUrl } from "../lib/fpl";
import { C } from "../lib/theme";

/* THE PHOTO, AND WHAT HAPPENS WHEN THERE ISN'T ONE.
 *
 * Roughly one player in eight has no official portrait, and new signings often go weeks without.
 * The fallback is a plain grey silhouette occupying exactly the same box, so a row of cards never
 * reflows and a missing face never draws the eye. That is the whole point: an absent photo should
 * be unremarkable, not a hole in the layout.
 *
 * The Premier League CDN 404s rather than redirecting, so onError is a reliable signal. The key on
 * the image element resets the failure state when the component is reused for a different player,
 * which otherwise leaves the previous player's silhouette showing.
 */

export default function PlayerPhoto({ code, size = 56, radius = 10, dim = false }) {
  const [failed, setFailed] = useState(!code);

  useEffect(() => { setFailed(!code); }, [code]);

  const height = Math.round(size * 1.27);

  if (failed) {
    return (
      <div
        aria-hidden
        style={{
          width: size,
          height,
          borderRadius: radius,
          background: C.surfaceHi,
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "center",
          overflow: "hidden",
          flexShrink: 0,
          opacity: dim ? 0.5 : 1,
        }}
      >
        <svg width={size * 0.7} height={height * 0.76} viewBox="0 0 40 44" fill="#33333A">
          <circle cx="20" cy="13" r="9" />
          <path d="M2 44c0-9.4 8.1-16 18-16s18 6.6 18 16z" />
        </svg>
      </div>
    );
  }

  return (
    <div style={{ position: "relative", width: size, height, flexShrink: 0 }}>
      <div
        aria-hidden
        style={{
          position: "absolute", inset: 0, borderRadius: radius, background: C.surfaceHi,
          display: "flex", alignItems: "flex-end", justifyContent: "center", overflow: "hidden",
        }}
      >
        <svg width={size * 0.7} height={height * 0.76} viewBox="0 0 40 44" fill="#33333A">
          <circle cx="20" cy="13" r="9" />
          <path d="M2 44c0-9.4 8.1-16 18-16s18 6.6 18 16z" />
        </svg>
      </div>
    <img
      key={code}
      alt=""
      width={size}
      height={height}
      src={photoUrl(code, size > 70 ? "250x250" : "110x140")}
      onError={() => setFailed(true)}
      style={{
        width: size,
        height,
        borderRadius: radius,
        objectFit: "cover",
        objectPosition: "top center",
        flexShrink: 0,
        opacity: dim ? 0.5 : 1,
        position: "relative",
      }}
    />
    </div>
  );
}
