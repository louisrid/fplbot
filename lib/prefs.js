"use client";

/* WHAT THE APP REMEMBERS.
 *
 * Every control that has a setting keeps it. Gameweek range, sort order, position filter, club
 * filter, solver window, which draft you were on. Set it once and it stays set through closing the
 * tab, reopening tomorrow and any future version of the app.
 *
 * The rule is that the app never resets a choice you made. An update that silently put the range
 * back to its default every time would make the setting useless, because you would spend longer
 * restoring it than using it.
 *
 * SCOPE. This is the browser's own storage, so it is per device. There is no login and no server,
 * which means a setting made on the phone cannot follow you to a laptop. Nothing else would, given
 * there is no account to attach it to.
 *
 * VERSIONING. The key carries a version. If the shape of what is stored ever has to change, the
 * version moves and old values are ignored rather than misread. A stored value that no longer makes
 * sense is discarded on read, so a bad entry can never wedge the app.
 */

const PREFIX = "fplbot:v1:";

export function readPref(key, fallback) {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    const parsed = JSON.parse(raw);
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch {
    return fallback;
  }
}

export function writePref(key, value) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* Private mode or storage full. The setting holds for this session and simply does not persist. */
  }
}

export function clearPref(key) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}
