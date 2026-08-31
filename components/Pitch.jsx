"use client";

import PlayerPhoto from "./PlayerPhoto";
import { C, S, R, F, W, DIFFICULTY } from "../lib/theme";
import { xptsFor, availability, opponentLabel } from "../lib/fpl";

/* THE PITCH.
 *
 * Outfielders in formation rows from the top, keeper below them, bench along the bottom. That is
 * the reverse of the official site, and it is deliberate: your thumb reaches the bottom of the
 * screen, the bench is what you actually adjust, and the keeper is the player you look at least.
 *
 * There is no green pitch and no markings. The fifteen portraits are the content; a textured
 * background behind them competes for attention and makes the screen look busier than it is.
 *
 * Everything is sized off the shared scale, and the row is laid out so the widest legal formation
 * still fits a 390px screen without scrolling.
 */

function PlayerCard({ member, live, gw, bootstrap, onTap, width, photo, benchBoost, captainMult }) {
  /* width is used for type sizing as well as layout, so it is read before anything renders. */
  const liveRow = live?.get(member.id);
  const played = liveRow?.played;
  const projection = xptsFor(member.id, gw);
  const flag = availability(member);
  const multiplier = member.isCaptain ? captainMult : 1;
  const opponent = opponentLabel(bootstrap.fixtures, bootstrap.teamsById, member.teamId, gw);
  const tone = DIFFICULTY[opponent.difficulty] || DIFFICULTY[3];
  const benched = !member.starting && !benchBoost;

  /* Real points once he has kicked a ball, the opponent until then. Never both, and never a
     projection dressed up to look like a score. */
  const points = played ? liveRow.points * multiplier : null;

  return (
    <button
      onClick={() => onTap?.(member)}
      className="press"
      style={{
        width,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 3,
        opacity: benched ? 0.55 : 1,
      }}
    >
      <div style={{ position: "relative" }}>
        <div
          style={{
            borderRadius: R.md,
            overflow: "hidden",
            background: C.surfaceHi,
            outline: member.isCaptain ? `2px solid ${C.captain}` : "none",
            outlineOffset: -1,
          }}
        >
          <PlayerPhoto code={member.code} size={photo} radius={R.md} />
        </div>

        {(member.isCaptain || member.isVice) && (
          <span
            className="num"
            style={{
              position: "absolute", top: -6, left: -6, width: 19, height: 19, borderRadius: 10,
              background: member.isCaptain ? C.captain : C.surfaceTop,
              color: member.isCaptain ? "#000" : C.textDim,
              fontSize: F.micro, fontWeight: W.bold,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            {member.isCaptain ? (captainMult === 3 ? "3" : "C") : "V"}
          </span>
        )}

        {flag && (
          <span
            style={{
              position: "absolute", top: -4, right: -4, width: 12, height: 12, borderRadius: 6,
              background: flag.level === "out" ? C.risk : C.warn,
              border: `2px solid ${C.bg}`,
            }}
          />
        )}
      </div>

      {/* Name. Shrinks to fit rather than truncating: a name a point smaller reads fine, a name cut
          to "Calvert-Le…" does not. */}
      <div
        style={{
          width: "100%",
          /* Sized from the actual card width and the actual name length rather than fixed steps,
             so the same rule holds at every card size. Inter's semibold average character is about
             0.62 of its point size, measured rather than assumed: the earlier 0.53 was borrowed
             from a narrower face and left long names truncating anyway. Floored at 7px, below
             which it stops being readable, and capped so short names do not balloon. */
          fontSize: Math.max(7, Math.min(11, width / (member.name.length * 0.62))),
          fontWeight: W.semi,
          color: C.text,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          textAlign: "center",
          lineHeight: 1.3,
        }}
      >
        {member.name}
      </div>

      {/* One block, not two. Either the score he got or the fixture he is waiting on, with the
          projection tucked underneath it inside the same block so the card stays two rows tall
          whatever state he is in. */}
      <div
        className="num"
        style={{
          width: "100%",
          borderRadius: R.sm,
          padding: "2px 4px",
          textAlign: "center",
          lineHeight: 1.2,
          background: points !== null ? C.surfaceHi : tone.bg,
          color: points !== null ? C.text : tone.text,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            fontSize: points !== null ? F.small : F.micro,
            fontWeight: W.bold,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}
        >
          {points !== null ? points : opponent.text}
        </div>
        {points === null && projection !== null && (
          <div style={{ fontSize: F.micro - 0.5, fontWeight: W.semi, color: C.xp, marginTop: 1 }}>
            {(projection * multiplier).toFixed(1)}
          </div>
        )}
      </div>
    </button>
  );
}

/* `dense` shrinks every card by a fixed proportion. An editable gameweek carries a chip row and
   sometimes a horizon notice above the pitch, which is around a hundred pixels the read-only view
   does not spend. Rather than let the bench slide under the tab bar, the squad gives that height
   back. */
export default function Pitch({ members, live, gw, bootstrap, onTapPlayer, benchBoost = false, captainMult = 2, dense = false }) {
  const starters = members.filter((member) => member.starting);
  const bench = members.filter((member) => !member.starting).sort((a, b) => a.slot - b.slot);

  const outfield = ["DEF", "MID", "FWD"].map((position) =>
    starters.filter((member) => member.position === position).sort((a, b) => a.slot - b.slot));
  const keeper = starters.filter((member) => member.position === "GKP");

  /* Card width is driven by the widest row so a 5-4-1 packs tighter than a 3-4-3 instead of
     overflowing. Worked out from the real available width rather than guessed. */
  const widest = Math.max(...outfield.map((row) => row.length), 1);
  const gap = S.sm;
  /* Width is whatever the widest row allows, capped so a 3-4-3 does not produce absurdly large
     cards. Height then follows from the width, and the bench sits a step smaller because it is
     secondary: that is what lets four rows and five substitutes share one screen. */
  const cap = dense ? 52 : 59;
  const width = Math.min(cap, Math.floor((358 - gap * (widest - 1)) / widest));
  const photo = Math.round(width * 0.78);
  const benchWidth = Math.round(width * 0.88);
  const benchPhoto = Math.round(benchWidth * 0.82);

  const row = (players, key) => (
    <div key={key} style={{ display: "flex", justifyContent: "center", gap }}>
      {players.map((member) => (
        <PlayerCard
          key={member.id}
          member={member}
          live={live}
          gw={gw}
          bootstrap={bootstrap}
          onTap={onTapPlayer}
          width={width}
          photo={photo}
          benchBoost={benchBoost}
          captainMult={captainMult}
        />
      ))}
    </div>
  );

  return (
    <div style={{ padding: `${S.sm}px ${S.page}px 0` }}>
      <div style={{ display: "flex", flexDirection: "column", gap: S.sm }}>
        {outfield.reverse().map((players, index) => row(players, `row${index}`))}
        {row(keeper, "gk")}
      </div>

      {/* The bench, separated by a rule rather than a panel. Numbered, because bench order decides
          who comes on and that is a decision you make, not a fact about the squad. */}
      <div
        style={{
          marginTop: 4,
          paddingTop: 6,
          borderTop: `1px solid ${C.borderSoft}`,
          display: "flex",
          justifyContent: "center",
          gap,
        }}
      >
        {bench.map((member, index) => (
          <div key={member.id} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
            <PlayerCard
              member={member}
              live={live}
              gw={gw}
              bootstrap={bootstrap}
              onTap={onTapPlayer}
              width={benchWidth}
              photo={benchPhoto}
              benchBoost={benchBoost}
              captainMult={captainMult}
            />
            <span className="num" style={{ fontSize: F.micro - 0.5, color: C.textFaint, fontWeight: W.semi }}>
              {member.position === "GKP" ? "GK" : index}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
