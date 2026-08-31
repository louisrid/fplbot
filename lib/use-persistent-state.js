"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { readPref, writePref } from "./prefs";

/* A piece of state that remembers itself.
 *
 * Behaves exactly like useState. The difference is that the value is read back from storage on
 * mount and written every time it changes, so the control is where you left it.
 *
 * The first render deliberately uses the fallback rather than the stored value. Reading storage
 * during render would make the server and client produce different markup, which React reports as
 * a hydration mismatch and which shows up as a visible flicker. Reading in an effect instead means
 * one frame of the default, then the remembered value.
 */
export function usePersistentState(key, fallback, { validate } = {}) {
  const [value, setValue] = useState(fallback);
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    const stored = readPref(key, undefined);
    if (stored === undefined) return;
    /* A stored value that no longer makes sense is discarded rather than applied. A gameweek range
       saved last season, or a club that has been relegated, should not be able to wedge a screen. */
    if (validate && !validate(stored)) return;
    setValue(stored);
  }, [key, validate]);

  const update = useCallback((next) => {
    setValue((current) => {
      const resolved = typeof next === "function" ? next(current) : next;
      writePref(key, resolved);
      return resolved;
    });
  }, [key]);

  return [value, update, loaded];
}
