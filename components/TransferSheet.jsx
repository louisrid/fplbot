"use client";

import { useState, useMemo } from "react";
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

export default function TransferSheet({
  open, onClose, outgoing, members, bootstrap, bank, gw, gwTo,
  freeTransfers, transfersUsed, onConfirm, neverBuy = [],
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = usePersistentState("transfer.sort", "xpts");
  const [clubs, setClubs] = usePersistentState("transfer.clubs", []);
  const [maxPrice, setMaxPrice] = usePersistentState("transfer.maxPrice", null);
  const [hideDoubtful, setHideDoubtful] = usePersistentState("transfer.hideDoubtful", false);
  const [showFilters, setShowFilters] = usePersistentState("transfer.showFilters", false);

  const rangeTo = Math.min(gwTo ?? gw, SERVED_GW_TO);
  const proceeds = outgoing ? sellPrice(outgoing) : 0;
  const budget = bank + proceeds;

  /* Club counts excluding the player leaving, since selling him frees a slot at his club. */
  const clubCounts = useMemo(() => {
    const counts = new Map();
    for (const member of members) {
      if (outgoing && member.id === outgoing.id) continue;
      counts.set(member.team, (counts.get(member.team) || 0) + 1);
    }
    return counts;
  }, [members, outgoing]);

  const squadIds = useMemo(() => new Set(members.map((member) => member.id)), [members]);
  const banned = useMemo(() => new Set(neverBuy), [neverBuy]);

  const rows = useMemo(() => {
    if (!outgoing) return [];
    const text = query.trim().toLowerCase();

    return bootstrap.players
      .filter((player) => player.position === outgoing.position)
      .filter((player) => player.id !== outgoing.id)
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
        return {
          ...player,
          xpts: projection.total,
          blocked: clubFull ? `${CLUB_LIMIT} from ${player.team}` : tooDear ? "Too expensive" : null,
          isBanned: banned.has(player.id),
        };
      })
      .sort((a, b) => {
        /* Blocked players sink rather than disappear. Seeing that the man you want is one club slot
           away is useful; silently hiding him is not. */
        if (Boolean(a.blocked) !== Boolean(b.blocked)) return a.blocked ? 1 : -1;
        if (sort === "price") return b.price - a.price;
        if (sort === "points") return b.totalPoints - a.totalPoints;
        if (sort === "form") return b.form - a.form;
        if (sort === "owned") return b.ownership - a.ownership;
        if (sort === "value") return (b.xpts / b.price) - (a.xpts / a.price);
        return b.xpts - a.xpts;
      })
      .slice(0, 120);
  }, [bootstrap.players, outgoing, squadIds, clubs, maxPrice, query, hideDoubtful,
      gw, rangeTo, clubCounts, budget, sort, banned]);

  if (!outgoing) return null;

  const outProjection = xptsRange(outgoing.id, gw, rangeTo).total;
  const willCostHit = transfersUsed >= freeTransfers;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`Replace ${outgoing.name}`}
      subtitle={`£${budget.toFixed(1)}m available · ${willCostHit ? `costs ${HIT_COST} pts` : "free transfer"}`}
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
      <div style={{ padding: "12px 16px 8px", borderBottom: `1px solid ${C.borderSoft}` }}>
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
        <span style={{ color: C.textDim, fontSize: F.micro, letterSpacing: "0.03em", fontWeight: W.semi }}>OUT</span>
        <span style={{ fontWeight: W.semi }}>{outgoing.name}</span>
        <span className="num" style={{ color: C.textDim }}>£{sellPrice(outgoing).toFixed(1)}m</span>
        <span className="num" style={{ color: C.text, marginLeft: "auto", fontWeight: W.bold }}>
          £{budget.toFixed(1)}m to spend
        </span>
      </div>

      {rows.length === 0 ? (
        <Empty title="Nobody matches" detail="Widen the filters or clear the search." />
      ) : (
        <div>
          {rows.map((player) => {
            const gain = player.xpts - outProjection;
            const disabled = Boolean(player.blocked);

            return (
              <button
                key={player.id}
                disabled={disabled}
                onClick={() => onConfirm?.(player)}
                className={disabled ? "" : "press"}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 11,
                  padding: "9px 16px", borderBottom: `1px solid ${C.borderSoft}`,
                  opacity: disabled ? 0.38 : 1, textAlign: "left",
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
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
                    <span className="num" style={{ fontSize: 11, color: C.textDim }}>{player.team}</span>
                    <span className="num" style={{ fontSize: 11, color: C.textDim }}>£{player.price.toFixed(1)}</span>
                    <FixtureTag
                      {...(() => {
                        const label = opponentLabel(bootstrap.fixtures, bootstrap.teamsById, player.teamId, gw);
                        return { text: label.text, difficulty: label.difficulty };
                      })()}
                      size={9.5}
                    />
                    {player.blocked && (
                      <span style={{ fontSize: 10, color: C.risk, fontWeight: 600 }}>{player.blocked}</span>
                    )}
                  </div>
                </div>

                <div style={{ textAlign: "right", flexShrink: 0, minWidth: 62 }}>
                  <div className="num" style={{ fontSize: F.body, fontWeight: W.bold, color: C.xp }}>
                    {player.xpts.toFixed(1)}
                  </div>
                  <div
                    className="num"
                    style={{ fontSize: F.micro, fontWeight: W.semi, color: gain > 0 ? C.good : C.textDim }}
                  >
                    {gain > 0 ? "+" : ""}{gain.toFixed(1)} xPTS
                  </div>
                  {/* What the bank would hold after this purchase. */}
                  <div
                    className="num"
                    style={{
                      fontSize: F.micro, fontWeight: W.semi, marginTop: 2,
                      color: budget - player.price < -0.001 ? C.risk : C.textDim,
                    }}
                  >
                    £{(budget - player.price).toFixed(1)}m left
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
