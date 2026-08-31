"use client";

import Link from "next/link";
import { Sheet, Pill, FixtureTag } from "./UI";
import PlayerPhoto from "./PlayerPhoto";
import { C, F, W } from "../lib/theme";
import {
  xptsFor, sellPrice, availability, opponentLabel,
  SERVED_GW_TO, fixturesForTeam,
} from "../lib/fpl";

/* WHAT HAPPENS WHEN YOU TAP A PLAYER ON THE PITCH.
 *
 * Actions first, information second. The reason you tapped him is almost always to do something,
 * so Transfer, Captain and Bench sit at the top where the thumb already is. Everything below is
 * reference.
 *
 * Which actions appear depends on whether the gameweek can still be edited. A finished gameweek
 * shows the same sheet with the buttons gone rather than a different sheet, so the layout does not
 * jump when you step back a week.
 */

function ActionButton({ onClick, children, tone = C.text, disabled = false, filled = false, href = null }) {
  const style = {
    flex: 1,
    padding: "11px 8px",
    borderRadius: 11,
    fontSize: 13,
    fontWeight: 700,
    textAlign: "center",
    color: disabled ? C.textFaint : filled ? "#000" : tone,
    background: filled ? tone : C.surfaceHi,
    border: `1px solid ${filled ? tone : C.border}`,
    opacity: disabled ? 0.4 : 1,
  };
  if (href && !disabled) {
    return <Link href={href} className="press" style={{ ...style, display: "block" }}>{children}</Link>;
  }
  return (
    <button onClick={onClick} disabled={disabled} className="press" style={style}>
      {children}
    </button>
  );
}

function Stat({ label, value, colour = C.text }) {
  return (
    <div style={{ textAlign: "center", flex: 1 }}>
      <div className="num" style={{ fontSize: 16, fontWeight: 700, color: colour, lineHeight: 1.2 }}>{value}</div>
      <div style={{ fontSize: F.micro, color: C.textDim, marginTop: 3, letterSpacing: "0.03em", fontWeight: W.semi }}>{label}</div>
    </div>
  );
}

export default function PlayerSheet({
  member, open, onClose, gw, bootstrap, live,
  editable, onMakeCaptain, onMakeVice, onToggleStarting, onTransfer, swapCandidate,
}) {
  if (!member) return null;

  const liveRow = live?.get(member.id);
  const flag = availability(member);
  const sell = sellPrice(member);
  const priceMoved = Math.abs(sell - member.price) > 0.001;

  /* The next five fixtures with their projections, which is the single most useful thing to see
     when deciding whether to keep him. Stops at the served horizon rather than inventing weeks. */
  const upcoming = [];
  for (let week = gw; week < gw + 5 && week <= SERVED_GW_TO; week += 1) {
    const rows = fixturesForTeam(bootstrap.fixtures, member.teamId, week);
    const label = opponentLabel(bootstrap.fixtures, bootstrap.teamsById, member.teamId, week);
    upcoming.push({ gw: week, label, xpts: xptsFor(member.id, week), blank: !rows.length });
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={member.name}
      subtitle={`${member.teamName} · ${member.position} · £${member.price.toFixed(1)}m`}
    >
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>

        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
          <PlayerPhoto code={member.code} size={72} radius={12} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>{member.fullName}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
              <Pill colour={C.textDim}>{member.ownership.toFixed(1)}% owned</Pill>
              {priceMoved && <Pill colour={C.textDim}>Sells £{sell.toFixed(1)}m</Pill>}
              {flag && (
                <Pill colour={flag.level === "out" ? C.risk : C.warn} border={false} background={C.surfaceHi}>
                  {flag.label}
                </Pill>
              )}
              {member.penaltyOrder === 1 && <Pill colour={C.good}>Pens</Pill>}
            </div>
          </div>
        </div>

        {member.news && (
          <div
            style={{
              background: C.surfaceHi, borderRadius: 10, padding: "10px 12px",
              fontSize: 12.5, color: flag?.level === "out" ? C.risk : C.warn, lineHeight: 1.45,
              border: `1px solid ${C.border}`,
            }}
          >
            {member.news}
          </div>
        )}

        {editable && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {swapCandidate && (
              <div
                style={{
                  fontSize: 12, color: C.xp, textAlign: "center", padding: "6px 0",
                  background: C.surfaceHi, borderRadius: 9, border: `1px solid ${C.border}`,
                }}
              >
                Tap another player to swap with {swapCandidate.name}
              </div>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <ActionButton onClick={() => onTransfer?.(member)} tone={C.xp} filled>Transfer</ActionButton>
              <ActionButton
                onClick={() => onToggleStarting?.(member)}
                disabled={!onToggleStarting}
              >
                {member.starting ? "Bench" : "Start"}
              </ActionButton>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <ActionButton
                onClick={() => onMakeCaptain?.(member)}
                tone={C.captain}
                disabled={member.isCaptain || !member.starting}
              >
                {member.isCaptain ? "Captain" : "Make captain"}
              </ActionButton>
              <ActionButton
                onClick={() => onMakeVice?.(member)}
                disabled={member.isVice || !member.starting}
              >
                {member.isVice ? "Vice" : "Make vice"}
              </ActionButton>
            </div>
          </div>
        )}

        <div
          style={{
            display: "flex", background: C.surfaceHi, borderRadius: 12,
            padding: "12px 6px", border: `1px solid ${C.borderSoft}`,
          }}
        >
          <Stat label="THIS GW" value={liveRow?.played ? liveRow.points : "—"} />
          <Stat label="xPTS" value={xptsFor(member.id, gw)?.toFixed(1) ?? "—"} colour={C.xp} />
          <Stat label="TOTAL" value={member.totalPoints} />
          <Stat label="FORM" value={member.form.toFixed(1)} />
        </div>

        <div>
          <div style={{ fontSize: 11, color: C.text, letterSpacing: "0.03em", marginBottom: 8, fontWeight: 600 }}>
            NEXT FIXTURES
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {upcoming.map((week) => (
              <div key={week.gw} style={{ flex: 1, textAlign: "center" }}>
                <div style={{ fontSize: F.micro, color: C.textDim, marginBottom: 4, fontWeight: W.semi }}>GW{week.gw}</div>
                <FixtureTag text={week.label.text} difficulty={week.label.difficulty} size={9.5} />
                <div className="num" style={{ fontSize: 11, color: C.xp, marginTop: 3, fontWeight: 600 }}>
                  {week.xpts?.toFixed(1) ?? "—"}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div
          style={{
            display: "flex", background: C.surfaceHi, borderRadius: 12,
            padding: "12px 6px", border: `1px solid ${C.borderSoft}`,
          }}
        >
          <Stat label="MINS" value={member.minutes} />
          <Stat label="G" value={member.goals} />
          <Stat label="A" value={member.assists} />
          <Stat label="xGI" value={member.xGI.toFixed(1)} />
          <Stat label="BPS" value={member.bps} />
        </div>

        <Link
          href={`/player?id=${member.id}`}
          className="press"
          style={{
            display: "block", textAlign: "center", padding: "12px",
            background: C.surfaceHi, borderRadius: 11, border: `1px solid ${C.border}`,
            fontSize: 13, fontWeight: 600,
          }}
        >
          Full player page
        </Link>
      </div>
    </Sheet>
  );
}
