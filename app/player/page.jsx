"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import PlayerPhoto from "../../components/PlayerPhoto";
import { Loading, ErrorBox, Pill, FixtureTag } from "../../components/UI";
import { C, clubColour, S, F, W } from "../../lib/theme";
import {
  loadBootstrap, loadPlayerSummary, xptsFor, availability,
  opponentLabel, SERVED_GW_TO, TOTAL_GWS,
} from "../../lib/fpl";

/* THE PLAYER PAGE.
 *
 * Everything about one player, in the order you would ask about him: who he is, what he is
 * projected to do next, what he has done this season week by week, and how his previous seasons
 * went. Career history comes from the element-summary endpoint, which is the only place it lives.
 */

function Stat({ label, value, colour = C.text, size = 17 }) {
  return (
    <div style={{ textAlign: "center", flex: 1, minWidth: 0 }}>
      <div className="num" style={{ fontSize: size, fontWeight: 700, color: colour, lineHeight: 1.2 }}>
        {value}
      </div>
      <div style={{ fontSize: F.micro, color: C.textDim, marginTop: 3, letterSpacing: "0.03em", fontWeight: W.semi }}>{label}</div>
    </div>
  );
}

function Section({ label, children }) {
  return (
    <div style={{ marginTop: 20 }}>
      <div
        style={{
          fontSize: 10.5, color: C.text, letterSpacing: "0.03em",
          fontWeight: 600, marginBottom: 9, padding: "0 14px",
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

/* The player is identified by a query parameter rather than a dynamic path segment.
 *
 * A dynamic route lives in a folder literally named [id], and GitHub's web uploader refuses folder
 * names containing square brackets. Uploading through the browser is how this app is deployed, so
 * a page that cannot be uploaded is a page that does not exist. /player?id=411 works identically.
 *
 * useSearchParams suspends during prerender, so the page is wrapped in a Suspense boundary below. */
function PlayerDetail() {
  const router = useRouter();
  const params = useSearchParams();
  const [bootstrap, setBootstrap] = useState(null);
  const [player, setPlayer] = useState(null);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const core = await loadBootstrap();
      setBootstrap(core);
      const found = core.playersById.get(Number(params.get("id")));
      if (!found) throw new Error("Player not found");
      setPlayer(found);
      loadPlayerSummary(params.get("id")).then(setSummary).catch(() => setSummary(null));
    } catch (issue) {
      setError(issue?.message || "Could not load this player");
    }
  }, [params]);

  useEffect(() => { load(); }, [load]);

  if (error) return <ErrorBox message={error} onRetry={load} />;
  if (!bootstrap || !player) return <Loading label="Loading player" />;

  const flag = availability(player);
  const gwFrom = bootstrap.nextGw;

  const upcoming = [];
  for (let gw = gwFrom; gw < gwFrom + 6 && gw <= TOTAL_GWS; gw += 1) {
    upcoming.push({
      gw,
      label: opponentLabel(bootstrap.fixtures, bootstrap.teamsById, player.teamId, gw),
      xpts: xptsFor(player.id, gw),
    });
  }

  const history = (summary?.history || []).slice().reverse();
  const seasons = (summary?.history_past || []).slice().reverse();

  return (
    <div style={{ paddingBottom: 24 }}>
      <div
        style={{
          position: "sticky", top: 0, zIndex: 40,
          background: "rgba(0,0,0,0.92)",
          backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
          borderBottom: `1px solid ${C.borderSoft}`,
          padding: "12px 14px", display: "flex", alignItems: "center", gap: 10,
        }}
      >
        <button
          onClick={() => router.back()}
          className="press"
          style={{ width: 40, height: S.tap, display: "flex", alignItems: "center", justifyContent: "center", marginLeft: -10, fontSize: F.title, color: C.textDim }}
        >‹</button>
        <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-0.01em" }}>{player.name}</span>
      </div>

      <div style={{ padding: "16px 14px 0", display: "flex", gap: 14, alignItems: "center" }}>
        <div
          style={{
            borderRadius: 13, overflow: "hidden",
            background: C.surfaceHi, padding: 3,
          }}
        >
          <PlayerPhoto code={player.code} size={78} radius={11} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 3 }}>{player.fullName}</div>
          <div style={{ fontSize: 12.5, color: C.textDim, marginBottom: 8 }}>
            {player.teamName} · {player.position}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            <Pill colour={C.text}>£{player.price.toFixed(1)}m</Pill>
            <Pill colour={C.textDim}>{player.ownership.toFixed(1)}% owned</Pill>
            {player.priceChange !== 0 && (
              <Pill colour={player.priceChange > 0 ? C.good : C.risk}>
                {player.priceChange > 0 ? "+" : ""}{player.priceChange.toFixed(1)}
              </Pill>
            )}
            {player.penaltyOrder === 1 && <Pill colour={C.good}>Penalties</Pill>}
          </div>
        </div>
      </div>

      {player.news && (
        <div
          style={{
            margin: "14px 14px 0", padding: "10px 12px", borderRadius: 11,
            background: C.surfaceHi, border: `1px solid ${flag?.level === "out" ? C.risk : C.border}`,
            fontSize: 12.5, color: flag?.level === "out" ? C.risk : C.warn, lineHeight: 1.45,
          }}
        >
          {player.news}
        </div>
      )}

      <div
        style={{
          margin: "16px 14px 0", padding: "14px 6px", borderRadius: 13,
          background: C.surface, border: `1px solid ${C.borderSoft}`, display: "flex",
        }}
      >
        <Stat label="TOTAL" value={player.totalPoints} />
        <Stat label="PER GAME" value={player.pointsPerGame.toFixed(1)} />
        <Stat label="FORM" value={player.form.toFixed(1)} />
        <Stat label="STARTS" value={player.starts} />
      </div>

      <Section label={`PROJECTION · NEXT ${upcoming.length}`}>
        <div style={{ display: "flex", gap: 6, padding: "0 14px" }}>
          {upcoming.map((week) => (
            <div key={week.gw} style={{ flex: 1, textAlign: "center", minWidth: 0 }}>
              <div style={{ fontSize: F.micro, color: C.textDim, marginBottom: 4, fontWeight: W.semi }}>GW{week.gw}</div>
              <FixtureTag text={week.label.text} difficulty={week.label.difficulty} size={9.5} />
              <div className="num" style={{ fontSize: 12, color: C.xp, marginTop: 4, fontWeight: 700 }}>
                {week.xpts?.toFixed(1) ?? "—"}
              </div>
            </div>
          ))}
        </div>
        {upcoming.some((week) => week.xpts === null) && (
          <div style={{ fontSize: 10.5, color: C.textFaint, textAlign: "center", marginTop: 8, padding: "0 14px" }}>
            No projection past GW{SERVED_GW_TO}
          </div>
        )}
      </Section>

      <Section label="THIS SEASON">
        <div
          style={{
            margin: "0 14px", padding: "13px 6px", borderRadius: 13,
            background: C.surface, border: `1px solid ${C.borderSoft}`, display: "flex",
          }}
        >
          <Stat label="MINS" value={player.minutes} size={15} />
          <Stat label="GOALS" value={player.goals} size={15} />
          <Stat label="ASSISTS" value={player.assists} size={15} />
          <Stat label="CS" value={player.cleanSheets} size={15} />
          <Stat label="BONUS" value={player.bonus} size={15} />
        </div>
        <div
          style={{
            margin: "8px 14px 0", padding: "13px 6px", borderRadius: 13,
            background: C.surface, border: `1px solid ${C.borderSoft}`, display: "flex",
          }}
        >
          <Stat label="xG" value={player.xG.toFixed(2)} size={15} />
          <Stat label="xA" value={player.xA.toFixed(2)} size={15} />
          <Stat label="xGI" value={player.xGI.toFixed(2)} size={15} />
          <Stat label="DEFCON" value={player.defConPer90.toFixed(1)} size={15} />
          <Stat label="BPS" value={player.bps} size={15} />
        </div>
      </Section>

      {history.length > 0 && (
        <Section label="BY GAMEWEEK">
          <div style={{ margin: "0 14px", borderRadius: 13, overflow: "hidden", border: `1px solid ${C.borderSoft}` }}>
            {history.slice(0, 12).map((row) => {
              const opponentTeam = bootstrap.teamsById.get(row.opponent_team);
              return (
                <div
                  key={`${row.round}-${row.fixture}`}
                  style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "9px 12px", background: C.surface,
                    borderBottom: `1px solid ${C.borderSoft}`,
                  }}
                >
                  <span className="num" style={{ fontSize: F.tiny, color: C.textDim, width: 34, fontWeight: W.semi }}>
                    GW{row.round}
                  </span>
                  <span className="num" style={{ fontSize: 11.5, color: C.textDim, width: 58 }}>
                    {opponentTeam?.short}{row.was_home ? " (H)" : " (A)"}
                  </span>
                  <span className="num" style={{ fontSize: F.tiny, color: C.textDim, flex: 1 }}>
                    {row.minutes}′
                    {row.goals_scored > 0 ? ` · ${row.goals_scored}G` : ""}
                    {row.assists > 0 ? ` · ${row.assists}A` : ""}
                    {row.bonus > 0 ? ` · ${row.bonus}B` : ""}
                  </span>
                  <span
                    className="num"
                    style={{
                      fontSize: 14, fontWeight: 700, width: 26, textAlign: "right",
                      color: row.total_points >= 6 ? C.good : row.total_points <= 1 ? C.risk : C.text,
                    }}
                  >
                    {row.total_points}
                  </span>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {seasons.length > 0 && (
        <Section label="PREVIOUS SEASONS">
          <div style={{ margin: "0 14px", borderRadius: 13, overflow: "hidden", border: `1px solid ${C.borderSoft}` }}>
            {seasons.map((season) => (
              <div
                key={season.season_name}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "10px 12px", background: C.surface,
                  borderBottom: `1px solid ${C.borderSoft}`,
                }}
              >
                <span className="num" style={{ fontSize: 12, color: C.textDim, width: 54 }}>
                  {season.season_name}
                </span>
                <span className="num" style={{ fontSize: F.tiny, color: C.textDim, flex: 1 }}>
                  £{(season.start_cost / 10).toFixed(1)}→£{(season.end_cost / 10).toFixed(1)}m
                  {" · "}{season.minutes}′
                  {season.goals_scored > 0 ? ` · ${season.goals_scored}G` : ""}
                  {season.assists > 0 ? ` · ${season.assists}A` : ""}
                </span>
                <span className="num" style={{ fontSize: 14, fontWeight: 700 }}>
                  {season.total_points}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

export default function PlayerPage() {
  return (
    <Suspense fallback={<Loading label="Loading player" />}>
      <PlayerDetail />
    </Suspense>
  );
}
