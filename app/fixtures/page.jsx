"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Header, Sheet, Loading, ErrorBox, Pill } from "../../components/UI";
import { C, DIFFICULTY, clubColour, S, F, W } from "../../lib/theme";
import { loadBootstrap, loadSquad, TOTAL_GWS } from "../../lib/fpl";
import { readPref, writePref } from "../../lib/prefs";

/* THE FIXTURES TAB.
 *
 * Every match in a gameweek, with the score if it has been played and the difficulty if it has not.
 * Your own players are marked on both sides of every tie, because the only reason to look at a
 * fixture list during a gameweek is to find out who of yours is playing.
 *
 * Tapping a played match opens the detail: goals, assists, bonus and cards, with your players
 * highlighted there too.
 */

const STAT_LABELS = {
  goals_scored: "Goals",
  assists: "Assists",
  own_goals: "Own goals",
  penalties_saved: "Pens saved",
  penalties_missed: "Pens missed",
  yellow_cards: "Yellow",
  red_cards: "Red",
  saves: "Saves",
  bonus: "Bonus",
};

const SHOWN_STATS = ["goals_scored", "assists", "bonus", "yellow_cards", "red_cards", "penalties_missed", "own_goals"];

export default function Fixtures() {
  const [bootstrap, setBootstrap] = useState(null);
  const [squad, setSquad] = useState(null);
  const [error, setError] = useState(null);
  const [gw, setGw] = useState(null);
  const [openFixture, setOpenFixture] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const core = await loadBootstrap();
      setBootstrap(core);
      /* Remembered, but never behind the live gameweek: reopening into a settled week is not where
         you wanted to be. */
      const remembered = readPref("fixtures.gw", null);
      const startGw = Number.isInteger(remembered) && remembered >= core.currentGw && remembered <= TOTAL_GWS
        ? remembered
        : core.currentGw;
      setGw((current) => current ?? startGw);
      loadSquad(core, core.currentGw).then(setSquad).catch(() => setSquad(null));
    } catch (issue) {
      setError(issue?.message || "Could not load fixtures");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => { if (gw !== null) writePref("fixtures.gw", gw); }, [gw]);

  const myPlayerIds = useMemo(
    () => new Set((squad?.members || []).map((member) => member.id)),
    [squad],
  );

  const myTeamIds = useMemo(
    () => new Set((squad?.members || []).map((member) => member.teamId)),
    [squad],
  );

  if (error) return <ErrorBox message={error} onRetry={load} />;
  if (!bootstrap || gw === null) return <Loading label="Loading fixtures" />;

  const fixtures = bootstrap.fixtures
    .filter((fixture) => fixture.gw === gw)
    .sort((a, b) => new Date(a.kickoff || 0) - new Date(b.kickoff || 0));

  const clubsPlaying = new Set(fixtures.flatMap((f) => [f.homeId, f.awayId]));
  const blanks = [...bootstrap.teamsById.values()].filter((team) => !clubsPlaying.has(team.id));

  const doubles = new Map();
  for (const fixture of fixtures) {
    for (const id of [fixture.homeId, fixture.awayId]) {
      doubles.set(id, (doubles.get(id) || 0) + 1);
    }
  }
  const doubled = [...doubles.entries()].filter(([, count]) => count > 1);

  const grouped = fixtures.reduce((groups, fixture) => {
    const day = fixture.kickoff
      ? new Date(fixture.kickoff).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" })
      : "Date to be confirmed";
    (groups[day] = groups[day] || []).push(fixture);
    return groups;
  }, {});

  return (
    <div style={{ paddingBottom: 20 }}>
      <Header
        title="Fixtures"
        left={(
          <button
            onClick={() => setGw((value) => Math.max(1, value - 1))}
            disabled={gw <= 1}
            className="press"
            style={{ width: 40, height: S.tap, display: "flex", alignItems: "center", justifyContent: "center", fontSize: F.title, color: C.textDim, opacity: gw <= 1 ? 0.3 : 1 }}
          >‹</button>
        )}
        right={(
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="num" style={{ fontSize: 14, fontWeight: 700 }}>GW{gw}</span>
            <button
              onClick={() => setGw((value) => Math.min(TOTAL_GWS, value + 1))}
              disabled={gw >= TOTAL_GWS}
              className="press"
              style={{ width: 40, height: S.tap, display: "flex", alignItems: "center", justifyContent: "center", fontSize: F.title, color: C.textDim, opacity: gw >= TOTAL_GWS ? 0.3 : 1 }}
            >›</button>
          </div>
        )}
      />

      {(blanks.length > 0 || doubled.length > 0) && (
        <div style={{ padding: "10px 14px 0", display: "flex", gap: 6, flexWrap: "wrap" }}>
          {doubled.length > 0 && (
            <Pill colour={C.good} background={C.surfaceHi} border={false}>
              Double: {doubled.map(([id]) => bootstrap.teamsById.get(id)?.short).join(" ")}
            </Pill>
          )}
          {blanks.length > 0 && blanks.length < 12 && (
            <Pill colour={C.risk} background={C.surfaceHi} border={false}>
              Blank: {blanks.map((team) => team.short).join(" ")}
            </Pill>
          )}
        </div>
      )}

      {Object.entries(grouped).map(([day, dayFixtures]) => (
        <div key={day} style={{ marginTop: 14 }}>
          <div
            style={{
              padding: `0 ${S.page}px ${S.sm}px`, fontSize: F.micro, color: C.text,
              letterSpacing: "0.03em", fontWeight: 600, textTransform: "uppercase",
            }}
          >
            {day}
          </div>

          {dayFixtures.map((fixture) => {
            const home = bootstrap.teamsById.get(fixture.homeId);
            const away = bootstrap.teamsById.get(fixture.awayId);
            const mine = myTeamIds.has(fixture.homeId) || myTeamIds.has(fixture.awayId);
            const time = fixture.kickoff
              ? new Date(fixture.kickoff).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
              : "TBC";

            return (
              <button
                key={fixture.id}
                onClick={() => fixture.started && setOpenFixture(fixture)}
                className={fixture.started ? "press" : ""}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 10,
                  minHeight: 52, padding: `${S.md}px ${S.page}px`, borderBottom: `1px solid ${C.borderSoft}`,
                  background: mine ? "rgba(79,216,255,0.04)" : "transparent",
                  textAlign: "left",
                }}
              >
                <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
                  <span style={{
                    fontSize: 13.5,
                    fontWeight: myTeamIds.has(fixture.homeId) ? 700 : 500,
                    color: myTeamIds.has(fixture.homeId) ? C.text : C.textDim,
                  }}>
                    {home?.short}
                  </span>
                  <span style={{ width: 3, height: 18, borderRadius: 2, background: clubColour(home?.short) }} />
                </div>

                <div style={{ minWidth: 62, textAlign: "center", flexShrink: 0 }}>
                  {fixture.started ? (
                    <div className="num" style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.02em" }}>
                      {fixture.homeScore}–{fixture.awayScore}
                    </div>
                  ) : (
                    <div className="num" style={{ fontSize: F.body, color: C.textDim, fontWeight: 600 }}>{time}</div>
                  )}
                  {fixture.started && !fixture.finishedProvisional && (
                    <div className="live-dot" style={{ fontSize: 9, color: C.good, fontWeight: 700 }}>
                      {fixture.minutes ? `${fixture.minutes}'` : "LIVE"}
                    </div>
                  )}
                  {fixture.finishedProvisional && !fixture.finished && (
                    <div style={{ fontSize: F.micro - 1, color: C.textDim, fontWeight: W.semi }}>FT</div>
                  )}
                  {fixture.finished && (
                    <div style={{ fontSize: F.micro - 1, color: C.textDim, fontWeight: W.semi }}>FT</div>
                  )}
                </div>

                <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 3, height: 18, borderRadius: 2, background: clubColour(away?.short) }} />
                  <span style={{
                    fontSize: 13.5,
                    fontWeight: myTeamIds.has(fixture.awayId) ? 700 : 500,
                    color: myTeamIds.has(fixture.awayId) ? C.text : C.textDim,
                  }}>
                    {away?.short}
                  </span>
                </div>

                {!fixture.started && (
                  <div style={{ display: "flex", gap: 3, flexShrink: 0 }}>
                    {[fixture.homeDifficulty, fixture.awayDifficulty].map((difficulty, index) => {
                      const tone = DIFFICULTY[difficulty] || DIFFICULTY[3];
                      return (
                        <span
                          key={index}
                          className="num"
                          style={{
                            width: 17, height: 17, borderRadius: 4, fontSize: 10, fontWeight: 700,
                            background: tone.bg, color: tone.text,
                            display: "flex", alignItems: "center", justifyContent: "center",
                          }}
                        >
                          {difficulty}
                        </span>
                      );
                    })}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      ))}

      <FixtureSheet
        fixture={openFixture}
        open={Boolean(openFixture)}
        onClose={() => setOpenFixture(null)}
        bootstrap={bootstrap}
        myPlayerIds={myPlayerIds}
      />
    </div>
  );
}

function FixtureSheet({ fixture, open, onClose, bootstrap, myPlayerIds }) {
  if (!fixture) return null;
  const home = bootstrap.teamsById.get(fixture.homeId);
  const away = bootstrap.teamsById.get(fixture.awayId);

  const rows = SHOWN_STATS
    .map((identifier) => {
      const stat = (fixture.stats || []).find((entry) => entry.identifier === identifier);
      if (!stat) return null;
      const both = [...(stat.h || []), ...(stat.a || [])];
      if (!both.length) return null;
      return { identifier, h: stat.h || [], a: stat.a || [] };
    })
    .filter(Boolean);

  const nameOf = (element) => bootstrap.playersById.get(element)?.name || "?";

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`${home?.short} ${fixture.homeScore ?? ""}–${fixture.awayScore ?? ""} ${away?.short}`}
      subtitle={fixture.finished
        ? "Full time"
        : fixture.finishedProvisional
          ? "Full time, bonus provisional"
          : `${fixture.minutes}'`}
      maxHeight="75vh"
    >
      <div style={{ padding: 16 }}>
        {rows.length === 0 ? (
          <div style={{ textAlign: "center", color: C.textDim, fontSize: 13, padding: "24px 0" }}>
            Nothing to report yet.
          </div>
        ) : rows.map((row) => (
          <div key={row.identifier} style={{ marginBottom: 16 }}>
            <div
              style={{
                fontSize: 10.5, color: C.text, letterSpacing: "0.03em",
                fontWeight: 600, marginBottom: 7, textTransform: "uppercase",
              }}
            >
              {STAT_LABELS[row.identifier]}
            </div>
            <div style={{ display: "flex", gap: 12 }}>
              <div style={{ flex: 1, textAlign: "right" }}>
                {row.h.map((entry, index) => (
                  <div
                    key={index}
                    style={{
                      fontSize: 13, marginBottom: 3,
                      fontWeight: myPlayerIds.has(entry.element) ? 700 : 400,
                      color: myPlayerIds.has(entry.element) ? C.xp : C.textDim,
                    }}
                  >
                    {nameOf(entry.element)}{entry.value > 1 ? ` ×${entry.value}` : ""}
                  </div>
                ))}
              </div>
              <div style={{ width: 1, background: C.borderSoft }} />
              <div style={{ flex: 1 }}>
                {row.a.map((entry, index) => (
                  <div
                    key={index}
                    style={{
                      fontSize: 13, marginBottom: 3,
                      fontWeight: myPlayerIds.has(entry.element) ? 700 : 400,
                      color: myPlayerIds.has(entry.element) ? C.xp : C.textDim,
                    }}
                  >
                    {nameOf(entry.element)}{entry.value > 1 ? ` ×${entry.value}` : ""}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </Sheet>
  );
}
