import { Manrope } from "next/font/google";
import "./globals.css";

/* THE TYPEFACE.
 *
 * Manrope, self-hosted by next/font, which downloads it at build time and serves it from this
 * app's own domain. No third-party request that can be slow or blocked, and no flash of a fallback
 * face while it arrives.
 *
 * It is declared in exactly one place. An earlier build declared a second @font-face by hand under
 * the same family name, and the two sets of weights collided badly enough that the browser
 * synthesised every bold instead of drawing it. Synthetic bold is what smears the letterforms and
 * pushes the spacing out, and it is why the type looked wrong at every size.
 *
 * Manrope is a geometric sans drawn for interfaces: open counters, a tall x-height and semi-
 * condensed capitals, which is what lets a label sit at ten pixels and still read cleanly. */
const appFont = Manrope({
  subsets: ["latin"],
  /* The full range as a variable font, so every weight is drawn rather than synthesised. */
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
  variable: "--font-app",
});
import TabBar from "../components/TabBar";
import { C } from "../lib/theme";

export const metadata = {
  title: "FPLbot",
  description: "FPL decisions, measured",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, title: "FPLbot", statusBarStyle: "black-translucent" },
  icons: {
    icon: [{ url: "/favicon.png", sizes: "64x64", type: "image/png" }],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport = {
  themeColor: C.bg,
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={appFont.variable}>
      <head>

        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black" />
      </head>
      <body>
        <div className="frame">{children}</div>
        <TabBar />
      </body>
    </html>
  );
}
