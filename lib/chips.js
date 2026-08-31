"use client";

/* CHIPS.
 *
 * Two of each per season, one usable in each half. The first-half set expires at GW19 whether you
 * play it or not; the second set unlocks at GW20. A chip spent in the first half is gone for the
 * first half only, which is why "have I used my Bench Boost" is not a yes or no question and the
 * app has to ask it per half.
 *
 * Availability is read from your real chip history rather than tracked separately, so it cannot
 * drift out of step with what the game thinks you have.
 */

export const FIRST_HALF_END = 19;
export const SECOND_HALF_START = 20;

export const CHIPS = [
  { key: "bboost", name: "Bench Boost", short: "BB", blurb: "All fifteen score" },
  { key: "3xc", name: "Triple Captain", short: "TC", blurb: "Captain scores treble" },
  { key: "freehit", name: "Free Hit", short: "FH", blurb: "One week only, reverts after" },
  { key: "wildcard", name: "Wildcard", short: "WC", blurb: "Unlimited transfers, permanent" },
];

export const halfOf = (gw) => (Number(gw) <= FIRST_HALF_END ? 1 : 2);

/* What is left, for the half the given gameweek falls in. `used` is the raw chips array from the
   entry history endpoint: [{ name, event }]. */
export function chipStatus(used = [], gw = 1) {
  const half = halfOf(gw);

  return CHIPS.map((chip) => {
    const plays = used.filter((row) => row.name === chip.key);
    const thisHalf = plays.find((row) => halfOf(row.event) === half);
    const otherHalf = plays.find((row) => halfOf(row.event) !== half);

    return {
      ...chip,
      half,
      available: !thisHalf,
      usedThisHalf: thisHalf ? thisHalf.event : null,
      usedOtherHalf: otherHalf ? otherHalf.event : null,
      /* Said plainly, because "unavailable" on its own always prompts the question why. */
      reason: thisHalf
        ? `Played GW${thisHalf.event}`
        : half === 1
          ? `Expires after GW${FIRST_HALF_END}`
          : null,
    };
  });
}

/* Bench Boost and Triple Captain change what a squad scores, so the projection has to know. Free
   Hit and Wildcard change what you may transfer, not what the eleven scores, so they do not appear
   here. */
export const captainMultiplier = (chip) => (chip === "3xc" ? 3 : 2);
export const benchCounts = (chip) => chip === "bboost";
