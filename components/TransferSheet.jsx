"use client";

import { useState, useMemo, useEffect } from "react";
import { Sheet, Pill, Chip, FixtureTag, Empty } from "./UI";
import PlayerPhoto from "./PlayerPhoto";
import { C, S, R, F, W } from "../lib/theme";
import { usePersistentState } from "../lib/use-persistent-state";
import {
  xptsRange, sellPrice, availability, opponentLabel,
  SERVED_GW_TO, CLUB_LIMIT, HIT_COST,
} from "../lib/fpl";

/* THE TRANSFER SCREEN.
 *
 * You have picked someone to sell. This finds who replaces him.
 *
 * The rules are enforced here rather than explained afterwards. A player you cannot afford, or who
 * would put you over three from one club, is shown greyed with the reason attached and cannot be
 * tapped. Discovering a move is illegal after committing to it is the single most annoying thing a
 * transfer planner can do.
 *
 * Filters are behind a button. A filter bar pinned above the list eats forty percent of a phone
 * screen to save one tap, and you are scrolling the list far more often than you are changing how
 * it is filtered.
 */

const SORTS = [
  { value: "xpts", label: "xPTS" },
  { value: "points", label: "Points" },
  { value: "form", label: "Form" },
  { value: "price", label: "Price" },
  { value: "value", label: "Value" },
  { value: "owned", label: "Owned" },
];

/* JOINT TRANSFERS.
 *
 * Selling one player at a time means a move you can plainly afford is refused because the single
 * sale does not cover the single purchase. Real transfer plans fund an expensive signing by making
 * a second move alongside it, and the money only has to balance across the whole set.
 *
 * So this screen holds a list of pairs. Each pair is a player leaving and, once chosen, a player
 * arriving. The budget is the bank plus everything being sold, less everything already bought, and
 * a candidate is affordable when the set still balances rather than when that one swap does. */
export default function TransferSheet({
  open, onClose, outgoing, members, bootstrap, bank, gw, gwTo,
  freeTransfers, transfersUsed, onConfirm, neverBuy = [],
}) {
  const [pairs, setPairs] = useState([]);
  const [picking, setPicking] = useState(null);
  const [addingSeller, setAddingSeller] = useState(false);

  /* Opening on a new player resets the set to just that player. */
  useEffect(() => {
    if (outgoing) { setPairs([{ out: outgoing, in: null }]); setPicking(0); setAddingSeller(false); }
  }, [outgoing]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = usePersistentState("transfer.sort", "xpts");
  const [clubs, setClubs] = usePersistentState("transfer.clubs", []);
  const [maxPrice, setMaxPrice] = usePersistentState("transfer.maxPrice", null);
  const [hideDoubtful, setHideDoubtful] = usePersistentState("transfer.hideDoubtful", false);
  const [showFilters, setShowFilters] = usePersistentState("transfer.showFilters", false);
  /* Default is the next gameweek alone. A projection over an arbitrary multi-week block is not
     what you asked for and reads as a much bigger number than it is, which is misleading rather
     than helpful. Widen it deliberately with the toggle when you want the longer view. */
  const [range, setRange] = usePersistentState("transfer.range", 1);

  /* The window xPTS is measured over, chosen here rather than inherited, because who is worth
     signing depends entirely on how far ahead you are looking. */
  const rangeTo = Math.min(gw + range - 1, SERVED_GW_TO);
  /* The fixture run is independent of the xPTS window. How many matches are coming is useful
     context whatever period you are scoring over, so it always shows the next five. */
  const fixtureCount = 5;
  /* Everything being sold, less everything already bought. */
  const proceeds = pairs.reduce((sum, pair) => sum + sellPrice(pair.out), 0);
  const spent = pairs.reduce((sum, pair) => sum + (pair.in ? pair.in.price : 0), 0);
  const budget = bank + proceeds - spent;
  const slot = picking !== null ? pairs[picking] : null;
  const filled = pairs.filter((pair) => pair.in).length;

  /* Club counts excluding the player leaving, since selling him frees a slot at his club. */
  const clubCounts = useMemo(() => {
    const leaving = new Set(pairs.map((pair) => pair.out.id));
    const counts = new Map();
    for (const member of members) {
      if (leaving.has(member.id)) continue;
      counts.set(member.team, (counts.get(member.team) || 0) + 1);
    }
    /* Players already chosen in this set count against the limit too. */
    for (const pair of pairs) {
      if (pair.in) counts.set(pair.in.team, (counts.get(pair.in.team) || 0) + 1);
    }
    return counts;
  }, [members, pairs]);

  const squadIds = useMemo(
    () => new Set([...members.map((m) => m.id), ...pairs.filter((p) => p.in).map((p) => p.in.id)]),
    [members, pairs],
  );
  const banned = useMemo(() => new Set(neverBuy), [neverBuy]);

  const rows = useMemo(() => {
    if (!slot) return [];
    const text = query.trim().toLowerCase();

    return bootstrap.players
      .filter((player) => player.position === slot.out.position)
      .filter((player) => player.id !== slot.out.id)
      .filter((player) => !squadIds.has(player.id))
      .filter((player) => (clubs.length ? clubs.includes(player.team) : true))
      .filter((player) => (maxPrice ? player.price <= maxPrice : true))
      .filter((player) => (text
        ? player.name.toLowerCase().includes(text) || player.fullName.toLowerCase().includes(text)
        : true))
      .filter((player) => (hideDoubtful ? !availability(player) : true))
      .map((player) => {
        const projection = xptsRange(player.id, gw, rangeTo);
        const clubFull = (clubCounts.get(player.team) || 0) >= CLUB_LIMIT;
        const tooDear = player.price > budget + 0.001;
        const runs = [];
        for (let week = gw; week < gw + fixtureCount && week <= 38; week += 1) {
          runs.push(opponentLabel(bootstrap.fixtures, bootstrap.teamsById, player.teamId, week));
        }
        return {
          ...player,
          runs,
          xpts: projection.total,
          /* Only the club limit blocks a pick outright, because no amount of extra selling fixes
             it unless you sell someone from that club, which is a different decision. Money is not
             a block: pick who you want and fund it by selling more. The confirm bar refuses until
             the set balances. */
          blocked: clubFull ? `${CLUB_LIMIT} from ${player.team}` : null,
          short: tooDear ? player.price - budget : 0,
          isBanned: banned.has(player.id),
        };
      })
      .sort((a, b) => {
        /* Blocked players sink rather than disappear. Seeing that the man you want is one club slot
           away is useful; silently hiding him is not. */
        if (Boolean(a.blocked) !== Boolean(b.blocked)) return a.blocked ? 1 : -1;
        if (Boolean(a.short) !== Boolean(b.short)) return a.short ? 1 : -1;
        if (sort === "price") return b.price - a.price;
        if (sort === "points") return b.totalPoints - a.totalPoints;
        if (sort === "form") return b.form - a.form;
        if (sort === "owned") return b.ownership - a.ownership;
        if (sort === "value") return (b.xpts / b.price) - (a.xpts / a.price);
        return b.xpts - a.xpts;
      })
      .slice(0, 120);
  }, [bootstrap.players, slot, squadIds, clubs, maxPrice, query, hideDoubtful,
      gw, rangeTo, clubCounts, budget, sort, banned]);

  if (!outgoing || !pairs.length) return null;

  const outProjection = slot ? xptsRange(slot.out.id, gw, rangeTo).total : 0;
  const moves = transfersUsed + pairs.length;
  const hits = Math.max(0, moves - freeTransfers) * HIT_COST;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={pairs.length > 1 ? `${pairs.length} transfers` : `Replace ${pairs[0].out.name}`}
      subtitle={`£${budget.toFixed(1)}m to spend · ${hits > 0 ? `−${hits} pts` : `${pairs.length} free`}`}
      action={(
        <div style={{ display: "flex", gap: S.sm, flexShrink: 0 }}>
        <button
          onClick={onClose}
          className="press"
          style={{
            height: 40, padding: `0 ${S.md}px`, borderRadius: R.lg, fontSize: F.small,
            fontWeight: W.semi, background: C.surfaceHi, color: C.text,
          }}
        >
          Cancel
        </button>
        <button
          onClick={() => setShowFilters((value) => !value)}
          className="press"
          style={{
            height: 40, padding: `0 ${S.md}px`, borderRadius: R.lg, fontSize: F.small, fontWeight: W.semi,
            background: showFilters || clubs.length || maxPrice ? C.text : C.surfaceHi,
            color: showFilters || clubs.length || maxPrice ? "#000" : C.textDim,
            border: `1px solid ${C.border}`, flexShrink: 0,
          }}
        >
          Filter{clubs.length || maxPrice ? " ·" : ""}
        </button>
        </div>
      )}
    >
      {/* THE SET. Every pair, and a control to sell another player so an expensive signing can be
          funded by a second move rather than being refused outright. */}
      <div style={{ padding: `${S.md}px ${S.page}px`, borderBottom: `1px solid ${C.borderSoft}` }}>
        {pairs.map((pair, index) => (
          <div
            key={pair.out.id}
            onClick={() => setPicking(index)}
            className="press"
            style={{
              display: "flex", alignItems: "center", gap: S.sm, padding: `${S.sm}px ${S.md}px`,
              borderRadius: R.lg, marginBottom: S.sm, cursor: "pointer",
              background: picking === index ? C.surfaceHi : "transparent",
              border: `1px solid ${picking === index ? C.xp : "transparent"}`,
            }}
          >
            <span style={{ fontSize: F.small, color: C.risk }}>{pair.out.name}</span>
            <span style={{ color: C.textFaint }}>→</span>
            <span style={{ fontSize: F.small, color: pair.in ? C.good : C.textDim, fontWeight: W.semi }}>
              {pair.in ? pair.in.name : "choose"}
            </span>
            <span className="num" style={{ marginLeft: "auto", fontSize: F.micro, color: C.textDim }}>
              {pair.in
                ? `${(pair.in.price - sellPrice(pair.out) >= 0 ? "+" : "")}£${(pair.in.price - sellPrice(pair.out)).toFixed(1)}m`
                : `£${sellPrice(pair.out).toFixed(1)}m`}
            </span>
            {pairs.length > 1 && (
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  const next = pairs.filter((_, i) => i !== index);
                  setPairs(next);
                  setPicking(next.findIndex((p) => !p.in) === -1 ? 0 : next.findIndex((p) => !p.in));
                }}
                style={{ color: C.textDim, fontSize: F.heading, width: 28 }}
              >×</button>
            )}
          </div>
        ))}

        <button
          onClick={() => setAddingSeller((value) => !value)}
          className="press"
          style={{
            width: "100%", height: 40, borderRadius: R.lg, background: C.surfaceHi,
            fontSize: F.small, fontWeight: W.semi, color: addingSeller ? C.xp : C.text,
          }}
        >
          {addingSeller ? "Close" : "Sell another player to fund this"}
        </button>

        {addingSeller && (
          <div className="fade-up hscroll" style={{ display: "flex", gap: S.sm, marginTop: S.sm, overflowX: "auto" }}>
            {members
              .filter((member) => !pairs.some((pair) => pair.out.id === member.id))
              .map((member) => (
                <Chip
                  key={member.id}
                  onClick={() => {
                    setPairs((current) => [...current, { out: member, in: null }]);
                    setPicking(pairs.length);
                    setAddingSeller(false);
                  }}
                >
                  {member.name} £{sellPrice(member).toFixed(1)}
                </Chip>
              ))}
          </div>
        )}
      </div>

      <div style={{ padding: `${S.md}px ${S.page}px ${S.sm}px`, borderBottom: `1px solid ${C.borderSoft}` }}>
        {/* How far ahead xPTS is measured. On screen rather than behind the filter button, because
            it changes every number in the list below it. */}
        <div style={{ display: "flex", alignItems: "center", gap: S.sm, marginBottom: S.md }}>
          <span style={{ fontSize: F.micro, color: C.textDim, fontWeight: W.semi, flexShrink: 0 }}>
            xPTS
          </span>
          <div className="hscroll" style={{ display: "flex", gap: 6, overflowX: "auto" }}>
            {[1, 2, 3, 5, 8].map((weeks) => (
              <button
                key={weeks}
                onClick={() => setRange(weeks)}
                className="press"
                style={{
                  height: 34, padding: `0 ${S.md}px`, borderRadius: R.lg, whiteSpace: "nowrap",
                  fontSize: F.small, fontWeight: W.semi,
                  background: range === weeks ? C.text : C.surfaceHi,
                  color: range === weeks ? "#000" : C.textDim,
                }}
              >
                {weeks === 1 ? "Next GW" : `${weeks} GWs`}
              </button>
            ))}
          </div>
        </div>

        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search players"
          style={{
            width: "100%", padding: "11px 13px", borderRadius: 11,
            background: C.surfaceHi, border: `1px solid ${C.border}`, fontSize: 14,
          }}
        />

        {showFilters && (
          <div className="fade-up" style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
            <div>
              <div style={{ fontSize: F.micro, color: C.text, marginBottom: S.sm, fontWeight: W.semi, letterSpacing: "0.03em" }}>
                SORT BY
              </div>
              <div className="scroll" style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2 }}>
                {SORTS.map((option) => (
                  <Chip key={option.value} active={sort === option.value} onClick={() => setSort(option.value)}>
                    {option.label}
                  </Chip>
                ))}
              </div>
            </div>

            <div>
              <div style={{ fontSize: F.micro, color: C.text, marginBottom: S.sm, fontWeight: W.semi, letterSpacing: "0.03em" }}>
                MAX PRICE
              </div>
              <div className="scroll" style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2 }}>
                <Chip active={!maxPrice} onClick={() => setMaxPrice(null)}>Any</Chip>
                {[4.5, 5.5, 6.5, 7.5, 9, 11, 15].map((price) => (
                  <Chip key={price} active={maxPrice === price} onClick={() => setMaxPrice(price)}>
                    £{price.toFixed(1)}
                  </Chip>
                ))}
              </div>
            </div>

            <div>
              <div style={{ fontSize: F.micro, color: C.text, marginBottom: S.sm, fontWeight: W.semi, letterSpacing: "0.03em" }}>
                CLUBS
              </div>
              <div className="scroll" style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2 }}>
                <Chip active={!clubs.length} onClick={() => setClubs([])}>All</Chip>
                {bootstrap.teams.map((team) => (
                  <Chip
                    key={team.id}
                    active={clubs.includes(team.short)}
                    onClick={() => setClubs((current) => (current.includes(team.short)
                      ? current.filter((code) => code !== team.short)
                      : [...current, team.short]))}
                  >
                    {team.short}
                  </Chip>
                ))}
              </div>
            </div>

            <Chip active={hideDoubtful} onClick={() => setHideDoubtful((value) => !value)}>
              Hide injured and doubtful
            </Chip>
          </div>
        )}
      </div>

      {/* What you are giving up, pinned above the list so the comparison is always on screen. */}
      <div
        style={{
          padding: "9px 16px", background: C.surface, borderBottom: `1px solid ${C.borderSoft}`,
          display: "flex", alignItems: "center", gap: 10, fontSize: 12,
        }}
      >
        <span style={{ color: C.textDim, fontSize: F.micro, letterSpacing: "0.03em", fontWeight: W.semi }}>
          REPLACING
        </span>
        <span style={{ fontWeight: W.semi }}>{slot ? slot.out.name : "—"}</span>
        <span className="num" style={{ marginLeft: "auto", fontSize: F.micro, color: C.textDim, fontWeight: W.semi }}>
          {rangeTo > gw ? `GW${gw}–${rangeTo}` : `GW${gw} only`}
        </span>
        <span className="num" style={{ color: C.text, fontWeight: W.bold }}>
          £{budget.toFixed(1)}m
        </span>
      </div>

      {filled === pairs.length && budget < -0.001 && (
        <div
          className="fade-up"
          style={{
            position: "sticky", top: 0, zIndex: 5, padding: `${S.md}px ${S.page}px`,
            background: "rgba(255,61,110,0.12)", borderBottom: `1px solid ${C.borderSoft}`,
            fontSize: F.small, color: C.risk, textAlign: "center", fontWeight: W.semi,
          }}
        >
          £{Math.abs(budget).toFixed(1)}m short. Sell another player to fund it.
        </div>
      )}

      {rows.length === 0 ? (
        <Empty title="Nobody matches" detail="Widen the filters or clear the search." />
      ) : (
        <div>
          {rows.map((player) => {
            const disabled = Boolean(player.blocked);

            return (
              <button
                key={player.id}
                disabled={disabled}
                onClick={() => {
                  const next = pairs.map((pair, i) => (i === picking ? { ...pair, in: player } : pair));
                  setPairs(next);
                  const nextEmpty = next.findIndex((pair) => !pair.in);
                  setPicking(nextEmpty === -1 ? picking : nextEmpty);
                  setQuery("");

                  /* Every slot filled and the money balances: the transfer is made. There is
                     nothing left to confirm, and asking anyway is a step that only ever costs a
                     tap. If it does not balance, the sheet stays open and says what is short. */
                  const remaining = bank
                    + next.reduce((sum, pair) => sum + sellPrice(pair.out), 0)
                    - next.reduce((sum, pair) => sum + (pair.in ? pair.in.price : 0), 0);
                  if (nextEmpty === -1 && remaining >= -0.001) onConfirm?.(next);
                }}
                className={disabled ? "" : "press"}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 11,
                  padding: "9px 16px", borderBottom: `1px solid ${C.borderSoft}`,
                  opacity: disabled ? 0.35 : player.short ? 0.72 : 1, textAlign: "left",
                }}
              >
                <PlayerPhoto code={player.code} size={38} radius={8} />

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {player.name}
                    </span>
                    {player.isBanned && <Pill colour={C.risk} size={9}>Never buy</Pill>}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: S.sm, marginTop: 2 }}>
                    <span className="num" style={{ fontSize: F.tiny, color: C.textDim }}>{player.team}</span>
                    <span className="num" style={{ fontSize: F.tiny, color: C.textDim }}>£{player.price.toFixed(1)}</span>
                    {player.blocked && (
                      <span style={{ fontSize: F.micro, color: C.risk, fontWeight: W.semi }}>{player.blocked}</span>
                    )}
                    {!player.blocked && player.short > 0 && (
                      <span style={{ fontSize: F.micro, color: C.warn, fontWeight: W.semi }}>
                        sell £{player.short.toFixed(1)}m more
                      </span>
                    )}
                  </div>

                  {/* His whole run over the chosen window, not just the next match. Which fixtures
                      are coming is most of the reason to sign someone. */}
                  <div style={{ display: "flex", gap: 3, marginTop: 4, flexWrap: "wrap" }}>
                    {player.runs.map((run, index) => (
                      <FixtureTag key={index} text={run.text} difficulty={run.difficulty} size={F.micro - 1} />
                    ))}
                  </div>
                </div>

                <div style={{ textAlign: "right", flexShrink: 0, minWidth: 56 }}>
                  <div className="num" style={{ fontSize: F.heading, fontWeight: W.bold, color: C.xp }}>
                    {player.xpts.toFixed(1)}
                  </div>
                  <div style={{ fontSize: F.micro - 1, color: C.textDim, fontWeight: W.semi }}>
                    xPTS
                  </div>
                  <div
                    className="num"
                    style={{
                      fontSize: F.micro, fontWeight: W.semi, marginTop: 3,
                      color: budget - player.price < -0.001 ? C.risk : C.textDim,
                    }}
                  >
                    £{(budget - player.price).toFixed(1)}m
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </Sheet>
  );
}
