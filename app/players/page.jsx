"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import PlayerPhoto from "../../components/PlayerPhoto";
import { Header, Chip, FixtureTag, Loading, ErrorBox, Empty, Pill } from "../../components/UI";
import { C, S, R, F, W } from "../../lib/theme";
import { usePersistentState } from "../../lib/use-persistent-state";
import {
  loadBootstrap, xptsRange, availability, opponentLabel, SERVED_GW_TO,
} from "../../lib/fpl";

/* THE PLAYERS TAB.
 *
 * Every player in the game, scrollable, with both what he has actually scored and what he is
 * projected to score. The two live side by side because they answer different questions: total
 * points tells you what has happened, xPTS tells you what to do next, and a list showing only one
 * of them is only half useful.
 *
 * This is the one tab that is meant to scroll. The tab bar stays pinned regardless.
 */

const SORTS = [
  { value: "xpts", label: "xPTS" },
  { value: "points", label: "Points" },
  { value: "form", label: "Form" },
  { value: "value", label: "Value" },
  { value: "price", label: "Price" },
  { value: "owned", label: "Owned" },
];

const POSITIONS = ["ALL", "GKP", "DEF", "MID", "FWD"];

export default function Players() {
  const [bootstrap, setBootstrap] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");
  const [position, setPosition] = usePersistentState("players.position", "ALL");
  const [sort, setSort] = usePersistentState("players.sort", "xpts");
  const [clubs, setClubs] = usePersistentState("players.clubs", []);
  const [maxPrice, setMaxPrice] = usePersistentState("players.maxPrice", null);
  const [hideUnavailable, setHideUnavailable] = usePersistentState("players.hideUnavailable", false);
  const [showFilters, setShowFilters] = usePersistentState("players.showFilters", false);
  const [range, setRange] = usePersistentState("players.range", 3);
  const [limit, setLimit] = useState(60);

  const load = useCallback(async () => {
    setError(null);
    try {
      setBootstrap(await loadBootstrap());
    } catch (issue) {
      setError(issue?.message || "Could not load players");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const gwFrom = bootstrap?.nextGw ?? 1;
  const gwTo = Math.min(gwFrom + range - 1, SERVED_GW_TO);

  const rows = useMemo(() => {
    if (!bootstrap) return [];
    const text = query.trim().toLowerCase();

    return bootstrap.players
      .filter((player) => (position === "ALL" ? true : player.position === position))
      .filter((player) => (clubs.length ? clubs.includes(player.team) : true))
      .filter((player) => (maxPrice ? player.price <= maxPrice : true))
      .filter((player) => (text
        ? player.name.toLowerCase().includes(text) || player.fullName.toLowerCase().includes(text)
        : true))
      .filter((player) => (hideUnavailable ? availability(player)?.level !== "out" : true))
      .map((player) => ({ ...player, xpts: xptsRange(player.id, gwFrom, gwTo).total }))
      .sort((a, b) => {
        if (sort === "points") return b.totalPoints - a.totalPoints;
        if (sort === "form") return b.form - a.form;
        if (sort === "price") return b.price - a.price;
        if (sort === "owned") return b.ownership - a.ownership;
        if (sort === "value") return (b.xpts / b.price) - (a.xpts / a.price);
        return b.xpts - a.xpts;
      });
  }, [bootstrap, position, clubs, maxPrice, query, hideUnavailable, sort, gwFrom, gwTo]);

  useEffect(() => { setLimit(60); }, [position, clubs, maxPrice, query, sort, range]);

  if (error) return <ErrorBox message={error} onRetry={load} />;
  if (!bootstrap) return <Loading label="Loading players" />;

  const filtersOn = clubs.length > 0 || maxPrice !== null || hideUnavailable;

  return (
    <div>
      <Header
        title="Players"
        right={(
          <button
            onClick={() => setShowFilters((value) => !value)}
            className="press"
            style={{
              height: S.tap, padding: `0 ${S.md}px`, borderRadius: R.lg, fontSize: F.small, fontWeight: W.semi,
              background: showFilters || filtersOn ? C.text : C.surfaceHi,
              color: showFilters || filtersOn ? "#000" : C.textDim,
              border: `1px solid ${C.border}`,
            }}
          >
            Filter{filtersOn ? " ·" : ""}
          </button>
        )}
      />

      <div style={{ padding: "12px 14px 8px" }}>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search players"
          style={{
            width: "100%", padding: "11px 13px", borderRadius: 11,
            background: C.surfaceHi, border: `1px solid ${C.border}`, fontSize: 14,
          }}
        />

        <div className="scroll" style={{ display: "flex", gap: 6, overflowX: "auto", marginTop: 10, paddingBottom: 2 }}>
          {POSITIONS.map((option) => (
            <Chip key={option} active={position === option} onClick={() => setPosition(option)}>
              {option === "ALL" ? "All" : option}
            </Chip>
          ))}
        </div>

        {showFilters && (
          <div className="fade-up" style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 11 }}>
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
                xPTS OVER
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {[1, 3, 5, 8].map((weeks) => (
                  <Chip key={weeks} active={range === weeks} onClick={() => setRange(weeks)}>
                    {weeks === 1 ? "1 GW" : `${weeks} GWs`}
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

            <Chip active={hideUnavailable} onClick={() => setHideUnavailable((value) => !value)}>
              Hide unavailable
            </Chip>
          </div>
        )}
      </div>

      <div
        style={{
          padding: "5px 14px", display: "flex", justifyContent: "space-between",
          fontSize: F.micro, color: C.text, letterSpacing: "0.03em", fontWeight: W.semi,
          borderBottom: `1px solid ${C.borderSoft}`,
        }}
      >
        <span>{rows.length} PLAYERS</span>
        <span>xPTS GW{gwFrom}{gwTo > gwFrom ? `–${gwTo}` : ""}</span>
      </div>

      {rows.length === 0 ? (
        <Empty title="Nobody matches" detail="Try clearing a filter." />
      ) : (
        <>
          {rows.slice(0, limit).map((player) => {
            const flag = availability(player);
            const opponent = opponentLabel(bootstrap.fixtures, bootstrap.teamsById, player.teamId, gwFrom);

            return (
              <Link
                key={player.id}
                href={`/player?id=${player.id}`}
                className="press"
                style={{
                  display: "flex", alignItems: "center", gap: 11,
                  padding: "9px 14px", borderBottom: `1px solid ${C.borderSoft}`,
                }}
              >
                <PlayerPhoto code={player.code} size={40} radius={8} />

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{
                      fontSize: 14, fontWeight: 600,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {player.name}
                    </span>
                    {flag && (
                      <span style={{
                        width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
                        background: flag.level === "out" ? C.risk : C.warn,
                      }} />
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
                    <span className="num" style={{ fontSize: 11, color: C.textDim }}>{player.team}</span>
                    <span className="num" style={{ fontSize: 11, color: C.textDim }}>{player.position}</span>
                    <span className="num" style={{ fontSize: 11, color: C.textDim }}>£{player.price.toFixed(1)}</span>
                    <FixtureTag text={opponent.text} difficulty={opponent.difficulty} size={9.5} />
                  </div>
                </div>

                <div style={{ display: "flex", gap: 14, flexShrink: 0, textAlign: "right" }}>
                  <div>
                    <div className="num" style={{ fontSize: 14, fontWeight: 700 }}>{player.totalPoints}</div>
                    <div style={{ fontSize: F.micro - 1, color: C.textDim, fontWeight: W.semi }}>PTS</div>
                  </div>
                  <div>
                    <div className="num" style={{ fontSize: 14, fontWeight: 700, color: C.xp }}>
                      {player.xpts > 0 ? player.xpts.toFixed(1) : "—"}
                    </div>
                    <div style={{ fontSize: F.micro - 1, color: C.textDim, fontWeight: W.semi }}>xPTS</div>
                  </div>
                </div>
              </Link>
            );
          })}

          {limit < rows.length && (
            <button
              onClick={() => setLimit((value) => value + 60)}
              className="press"
              style={{
                width: "100%", padding: "15px", fontSize: 13, fontWeight: 600,
                color: C.textDim, background: C.surface,
              }}
            >
              Show more ({rows.length - limit} left)
            </button>
          )}
        </>
      )}
    </div>
  );
}
