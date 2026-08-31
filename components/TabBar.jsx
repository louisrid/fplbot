"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { C, S } from "../lib/theme";

/* Four destinations, in the order you asked for. Home sits centre because it is where every
   session starts and the thumb rests there naturally.
 *
 * Icons are inline paths rather than an icon package: four glyphs do not justify a dependency, and
 * shipping one keeps the bundle small enough that the app opens instantly on mobile data. */

const TABS = [
  {
    href: "/fixtures",
    label: "Fixtures",
    icon: (
      <>
        <rect x="3" y="4.5" width="18" height="16" rx="2.5" />
        <path d="M3 9.5h18M8 2.5v4M16 2.5v4" />
      </>
    ),
  },
  {
    href: "/solver",
    label: "Solver",
    icon: (
      <>
        <path d="M4 8h13M13.5 4.5 17 8l-3.5 3.5" />
        <path d="M20 16H7M10.5 12.5 7 16l3.5 3.5" />
      </>
    ),
  },
  {
    href: "/",
    label: "Home",
    icon: (
      <>
        <path d="M3.5 10.5L12 3.5l8.5 7" />
        <path d="M5.5 9.5v10h13v-10" />
        <path d="M9.5 19.5v-6h5v6" />
      </>
    ),
  },
  {
    href: "/players",
    label: "Players",
    icon: (
      <>
        <circle cx="12" cy="8" r="3.6" />
        <path d="M5 20.5c0-3.6 3.1-6.2 7-6.2s7 2.6 7 6.2" />
      </>
    ),
  },
];

export default function TabBar() {
  const pathname = usePathname();

  return (
    <nav
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 60,
        background: "rgba(0,0,0,0.92)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        borderTop: `1px solid ${C.borderSoft}`,
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      <div
        style={{
          maxWidth: 480,
          margin: "0 auto",
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          height: 64,
        }}
      >
        {TABS.map((tab) => {
          /* Player detail pages belong to the Players tab, so the highlight does not vanish when
             you drill in from the list. */
          const active = tab.href === "/"
            ? pathname === "/"
            : pathname.startsWith(tab.href) || (tab.href === "/players" && pathname.startsWith("/player"));

          return (
            <Link
              key={tab.href}
              href={tab.href}
              className="press"
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 4,
                color: active ? C.text : C.textFaint,
                position: "relative",
              }}
            >
              {/* The selected tab carries a light grey panel behind it, so which tab you are on is
                  legible at a glance rather than only by a shade of text. */}
              {active && (
                <span
                  aria-hidden
                  style={{
                    position: "absolute", inset: "6px 10px", borderRadius: 12,
                    background: C.surfaceHi,
                  }}
                />
              )}
              <span style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              <svg
                width="23"
                height="23"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={active ? 2.1 : 1.7}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {tab.icon}
              </svg>
              <span style={{ fontSize: 10.5, fontWeight: active ? 700 : 500, letterSpacing: "0.02em" }}>
                {tab.label}
              </span>
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
