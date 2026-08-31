/* THE DESIGN SYSTEM.
 *
 * One file. Nothing anywhere else writes a raw colour, radius or spacing value.
 *
 * PRINCIPLES.
 *
 * Pure black background. Surfaces sit one or two steps above it, so panels separate by luminance
 * and the app needs almost no borders. There is no green pitch and no decorative texture: the
 * players are the content, and a background competing with them makes the screen look busy.
 *
 * Text has three levels and no more. The lowest is still readable against black, which the earlier
 * greys were not. A label that cannot be read comfortably is not subtle, it is broken.
 *
 * Every size comes off a scale. Spacing is a multiple of four, radii are one of three values, type
 * is one of seven sizes. Values picked by eye instead of off the scale are what make a layout look
 * random, which is exactly the failure this replaces.
 */

export const C = {
  bg: "#000000",
  /* Three surface levels: the page, a panel, and something raised inside a panel. */
  surface: "#101012",
  surfaceHi: "#16161A",
  surfaceTop: "#26262B",
  border: "#2A2A30",
  borderSoft: "#1C1C20",

  /* Three text levels. The top is white and carries every value, name and figure you actually
     read. The other two are supporting labels only, and both sit high enough on black to be read
     without effort: the earlier ramp faded them into the background, which made the screen look
     washed out rather than calm. */
  text: "#FFFFFF",
  textDim: "#D4D4DC",
  textFaint: "#9C9CA8",

  /* xPTS owns this blue and nothing else uses it, so a projection is never mistaken for a real
     score anywhere in the app. */
  xp: "#4FD8FF",
  good: "#22E07A",
  risk: "#FF3D6E",
  warn: "#FFB020",
  captain: "#FFD400",
};

/* Fixture difficulty on FPL's own 1 to 5 scale. Muted enough to sit on a player card without
   shouting, distinct enough to read at a glance. */
export const DIFFICULTY = {
  1: { bg: "#123D28", text: "#3EE58C" },
  2: { bg: "#123D28", text: "#3EE58C" },
  3: { bg: "#232329", text: "#B0B0BA" },
  4: { bg: "#3F1526", text: "#FF7A9C" },
  5: { bg: "#4D1122", text: "#FF6285" },
};

/* SPACING. Multiples of four, named by use rather than by number, so changing one kind of gap
   cannot accidentally change another. */
export const S = {
  xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24,
  /* The horizontal margin every screen uses. One value, so nothing sits closer to the edge than
     anything else. */
  page: 16,
  tabBar: 64,
  /* Minimum height for anything pressable. */
  tap: 44,
};

/* RADII. Three values. Smaller than before, because heavy rounding at small sizes reads as soft
   rather than precise. */
/* RADII. Deliberately tight. Heavy rounding at these sizes reads as soft and generic; a smaller
   radius reads as deliberate. */
export const R = { sm: 4, md: 6, lg: 8, card: 10 };

/* TYPE. Seven sizes, three weights. */
/* TYPE. A tighter ramp with more separation between levels, so hierarchy is obvious without
   reaching for colour. */
export const F = {
  display: 32, title: 19, heading: 16, body: 14, small: 12.5, tiny: 11, micro: 10,
};
export const W = { regular: 400, medium: 500, semi: 600, bold: 700, heavy: 800 };

/* Club colours, used only as a thin accent bar in fixture rows. Never behind a photo: a tinted
   card behind a portrait makes fifteen cards look like fifteen different designs. */
export const CLUB = {
  ARS: "#EF0107", AVL: "#95BFE5", BOU: "#DA291C", BRE: "#E30613", BHA: "#0057B8",
  BUR: "#6C1D45", CHE: "#034694", CRY: "#1B458F", EVE: "#003399", FUL: "#CFCFCF",
  IPS: "#3A64A3", LEE: "#FFCD00", LEI: "#003090", LIV: "#C8102E", MCI: "#6CABDD",
  MUN: "#DA291C", NEW: "#41B6E6", NFO: "#DD0000", SOU: "#D71920", TOT: "#8E8E9A",
  WHU: "#7A263A", WOL: "#FDB913", SUN: "#EB172B", HUL: "#F5A12D", COV: "#78D2F1",
  LUT: "#F78F1E", SHU: "#EE2737", NOR: "#00A650", WAT: "#FBEE23", MID: "#DC143C",
};
export const clubColour = (code) => CLUB[code] || "#4A4A52";

/* Inter, self-hosted by next/font and exposed as a CSS variable. Declared once here and referenced
   through the variable everywhere else, so there is exactly one place the typeface is decided. */
export const FONT = 'var(--font-inter), -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
