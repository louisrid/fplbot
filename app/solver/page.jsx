"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import PlayerPhoto from "../../components/PlayerPhoto";
import { Header, Sheet, Chip, Loading, ErrorBox, Empty, Pill, FixtureTag } from "../../components/UI";
import { C, R, S, F, W } from "../../lib/theme";
import { usePersistentState } from "../../lib/use-persistent-state";
import {
  loadBootstrap, loadSquad, sellPrice, xptsRange, SERVED_GW_TO, opponentLabel,
} from "../../lib/fpl";
import { solveTransfers } from "../../lib/solver";
import { createDraft, setSelectedId, weekOf, setWeek, getDraft } from "../../lib/drafts";

/* THE SOLVER.
 *
 * You tell it what you will and will not do. It tells you the best moves inside those rules.
 *
 * Everything is a toggle, never a text box. A text box would need a language model to interpret,
 * which means latency, cost and the chance of it misreading you. Toggles are instant, deterministic
 * and cannot be misunderstood.
 *
 * Every option is measured against holding your current squad, so an option only appears if it
 * genuinely beats doing nothing. Options are distinct as whole plans: two of them may sign the same
 * player, because if one signing is clearly right it belongs in more than one plan.
 */

const NEVER_BUY_KEY = "zeus2:neverbuy:v1";

const readNeverBuy = () => {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(NEVER_BUY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeNeverBuy = (ids) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(NEVER_BUY_KEY, JSON.stringify(ids));
  } catch {
    /* ignore */
  }
};

export default function Solver() {
  const [bootstrap, setBootstrap] = useState(null);
  const [squad, setSquad] = useState(null);
  const [error, setError] = useState(null);

  const [weeks, setWeeks] = usePersistentState("solver.weeks", 4);
  const [optionCount, setOptionCount] = usePersistentState("solver.optionCount", 6);
  const [maxPerPlayer, setMaxPerPlayer] = usePersistentState("solver.maxPerPlayer", 0);
  const [includeDoubtful, setIncludeDoubtful] = usePersistentState("solver.includeDoubtful", false);
  const [forceOut, setForceOut] = usePersistentState("solver.forceOut", []);
  const [forceKeep, setForceKeep] = usePersistentState("solver.forceKeep", []);
  const [neverBuy, setNeverBuy] = useState([]);

  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [showSquad, setShowSquad] = useState(false);
  const [showNeverBuy, setShowNeverBuy] = useState(false);
  const [saved, setSaved] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const core = await loadBootstrap();
      setBootstrap(core);
      const mine = await loadSquad(core, core.currentGw);
      setSquad(mine);
      setNeverBuy(readNeverBuy());
    } catch (issue) {
      setError(issue?.message || "Could not load your squad");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const gwFrom = bootstrap?.nextGw ?? 1;
  const gwTo = Math.min(gwFrom + weeks - 1, SERVED_GW_TO);

  const run = useCallback(() => {
    if (!squad || !bootstrap) return;
    setRunning(true);
    setSaved(null);
    /* Yield a frame first so the button state paints before the search blocks the thread. */
    setTimeout(() => {
      try {
        setResult(solveTransfers({
          members: squad.members,
          allPlayers: bootstrap.players,
          bank: squad.bank,
          freeTransfers: squad.freeTransfers,
          gwFrom,
          gwTo,
          neverBuy,
          forceOut,
          forceKeep,
          includeDoubtful,
          maxPerPlayer,
          limit: optionCount,
        }));
      } catch (issue) {
        setError(issue?.message || "The solver failed");
      }
      setRunning(false);
    }, 30);
  }, [squad, bootstrap, gwFrom, gwTo, neverBuy, forceOut, forceKeep,
      includeDoubtful, maxPerPlayer, optionCount]);

  const saveAsDraft = useCallback((option) => {
    if (!squad) return;
    const draft = createDraft({ fromGw: gwFrom });
    setWeek(draft.id, gwFrom, {
      transfers: option.out.map((player, index) => ({
        out: player.id,
        in: option.in[index].id,
        sellPrice: sellPrice(player),
      })),
    });
    setSelectedId(draft.id);
    setSaved(option.id);
  }, [squad, gwFrom]);

  const toggle = (list, setList, id) =>
    setList(list.includes(id) ? list.filter((value) => value !== id) : [...list, id]);

  if (error) return <ErrorBox message={error} onRetry={load} />;
  if (!bootstrap || !squad) return <Loading label="Loading your squad" />;

  return (
    <div style={{ paddingBottom: 24 }}>
      <Header
        title="Solver"
        right={<Pill colour={C.textDim}>{squad.freeTransfers} FT · £{squad.bank.toFixed(1)}m</Pill>}
      />

      <div style={{ padding: "14px 14px 0", display: "flex", flexDirection: "column", gap: 15 }}>

        <Block label={`GAMEWEEKS · GW${gwFrom}${gwTo > gwFrom ? `–${gwTo}` : ""}`}>
          <div className="scroll" style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2 }}>
            {[1, 3, 4, 6, 8].map((count) => (
              <Chip key={count} active={weeks === count} onClick={() => setWeeks(count)}>
                {count}
              </Chip>
            ))}
          </div>
        </Block>

        <Block label="HOW MANY OPTIONS">
          <div className="scroll" style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2 }}>
            {[3, 5, 6, 8, 10, 12].map((count) => (
              <Chip key={count} active={optionCount === count} onClick={() => setOptionCount(count)}>
                {count}
              </Chip>
            ))}
          </div>
        </Block>

        <Block
          label="MY SQUAD"
          action={(
            <button onClick={() => setShowSquad(true)} style={{ height: S.tap, padding: `0 ${S.sm}px`, marginRight: -S.sm, fontSize: F.small, color: C.xp, fontWeight: W.semi }}>
              Set rules
            </button>
          )}
        >
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {forceOut.length === 0 && forceKeep.length === 0 ? (
              <span style={{ fontSize: F.small, color: C.textDim }}>No players locked either way</span>
            ) : (
              <>
                {forceOut.map((id) => (
                  <Pill key={id} colour={C.risk} background={C.surfaceHi} border={false}>
                    Sell {bootstrap.playersById.get(id)?.name}
                  </Pill>
                ))}
                {forceKeep.map((id) => (
                  <Pill key={id} colour={C.good} background={C.surfaceHi} border={false}>
                    Keep {bootstrap.playersById.get(id)?.name}
                  </Pill>
                ))}
              </>
            )}
          </div>
        </Block>

        <Block
          label="NEVER BUY"
          action={(
            <button onClick={() => setShowNeverBuy(true)} style={{ height: S.tap, padding: `0 ${S.sm}px`, marginRight: -S.sm, fontSize: F.small, color: C.xp, fontWeight: W.semi }}>
              Edit list
            </button>
          )}
        >
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {neverBuy.length === 0 ? (
              <span style={{ fontSize: F.small, color: C.textDim }}>Empty</span>
            ) : neverBuy.map((id) => (
              <Pill key={id} colour={C.textDim}>{bootstrap.playersById.get(id)?.name}</Pill>
            ))}
          </div>
        </Block>

        <Block label="VARIETY">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Chip active={maxPerPlayer === 0} onClick={() => setMaxPerPlayer(0)}>No cap</Chip>
            {[1, 2, 3].map((cap) => (
              <Chip key={cap} active={maxPerPlayer === cap} onClick={() => setMaxPerPlayer(cap)}>
                Max {cap} per player
              </Chip>
            ))}
          </div>
          <div style={{ fontSize: F.tiny, color: C.textDim, marginTop: S.sm, lineHeight: 1.5 }}>
            Options are always different plans. The cap limits how often one player can appear across
            them, for when a single name crowds out everything else.
          </div>
        </Block>

        <Block label="AVAILABILITY">
          <Chip active={includeDoubtful} onClick={() => setIncludeDoubtful((value) => !value)}>
            Include doubtful players
          </Chip>
        </Block>

        <button
          onClick={run}
          disabled={running}
          className="press"
          style={{
            width: "100%", padding: "15px", borderRadius: 13,
            background: running ? C.surfaceHi : C.xp, color: running ? C.textDim : "#000",
            fontSize: 15, fontWeight: 700,
          }}
        >
          {running ? "Solving…" : "Find transfers"}
        </button>
      </div>

      {result && (
        <div style={{ marginTop: 20 }}>
          <div
            style={{
              padding: "9px 14px", borderTop: `1px solid ${C.borderSoft}`,
              borderBottom: `1px solid ${C.borderSoft}`,
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}
          >
            <span style={{ fontSize: 10.5, color: C.text, letterSpacing: "0.03em", fontWeight: 600 }}>
              HOLD · {result.hold.score.toFixed(1)} xPTS
            </span>
            <span style={{ fontSize: F.micro, color: C.textDim, letterSpacing: "0.03em", fontWeight: W.semi }}>
              {result.options.length} option{result.options.length === 1 ? "" : "s"} beat it
            </span>
          </div>

          {result.options.length === 0 ? (
            <Empty
              title="Hold your squad"
              detail={`Nothing available beats your current fifteen over GW${gwFrom}–${gwTo} within ${squad.freeTransfers} free transfer${squad.freeTransfers === 1 ? "" : "s"}.`}
            />
          ) : result.options.map((option, index) => (
            <div
              key={option.id}
              className="fade-up"
              style={{
                margin: "10px 14px", padding: 13, borderRadius: 13,
                background: C.surface, border: `1px solid ${index === 0 ? C.xp : C.borderSoft}`,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700 }}>
                    {option.moves === 1 ? "1 transfer" : `${option.moves} transfers`}
                  </span>
                  {index === 0 && <Pill colour={C.xp} background={C.surfaceHi} border={false}>Best</Pill>}
                </div>
                <div className="num" style={{ fontSize: 15, fontWeight: 700, color: C.good }}>
                  +{option.gain.toFixed(1)}
                </div>
              </div>

              {option.out.map((outgoing, moveIndex) => {
                const incoming = option.in[moveIndex];
                const opponent = opponentLabel(bootstrap.fixtures, bootstrap.teamsById, incoming.teamId, gwFrom);
                return (
                  <div
                    key={moveIndex}
                    style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 8 }}
                  >
                    <PlayerPhoto code={outgoing.code} size={30} radius={6} dim />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: C.risk, textDecoration: "line-through", opacity: 0.8 }}>
                        {outgoing.name}
                      </div>
                      <div className="num" style={{ fontSize: F.micro, color: C.textDim }}>
                        £{sellPrice(outgoing).toFixed(1)}m
                      </div>
                    </div>
                    <span style={{ color: C.textFaint, fontSize: 13 }}>→</span>
                    <div style={{ flex: 1, minWidth: 0, textAlign: "right" }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600 }}>{incoming.name}</div>
                      <div style={{ display: "flex", gap: 5, justifyContent: "flex-end", alignItems: "center", marginTop: 2 }}>
                        <span className="num" style={{ fontSize: F.micro, color: C.textDim }}>
                          £{incoming.price.toFixed(1)}m
                        </span>
                        <FixtureTag text={opponent.text} difficulty={opponent.difficulty} size={9} />
                      </div>
                    </div>
                    <PlayerPhoto code={incoming.code} size={30} radius={6} />
                  </div>
                );
              })}

              <div
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  marginTop: 11, paddingTop: 10, borderTop: `1px solid ${C.borderSoft}`,
                }}
              >
                <span className="num" style={{ fontSize: 11, color: C.textDim }}>
                  £{option.bank.toFixed(1)}m left · {option.shape.formation}
                </span>
                <button
                  onClick={() => saveAsDraft(option)}
                  className="press"
                  style={{
                    padding: "6px 13px", borderRadius: 9, fontSize: 11.5, fontWeight: 700,
                    background: saved === option.id ? C.good : C.surfaceHi,
                    color: saved === option.id ? "#000" : C.text,
                    border: `1px solid ${saved === option.id ? C.good : C.border}`,
                  }}
                >
                  {saved === option.id ? "Saved" : "Save as draft"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <SquadRulesSheet
        open={showSquad}
        onClose={() => setShowSquad(false)}
        squad={squad}
        forceOut={forceOut}
        forceKeep={forceKeep}
        onToggleOut={(id) => { toggle(forceOut, setForceOut, id); setForceKeep((k) => k.filter((v) => v !== id)); }}
        onToggleKeep={(id) => { toggle(forceKeep, setForceKeep, id); setForceOut((o) => o.filter((v) => v !== id)); }}
      />

      <NeverBuySheet
        open={showNeverBuy}
        onClose={() => setShowNeverBuy(false)}
        bootstrap={bootstrap}
        neverBuy={neverBuy}
        onChange={(ids) => { setNeverBuy(ids); writeNeverBuy(ids); }}
      />
    </div>
  );
}

function Block({ label, children, action = null }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 10.5, color: C.text, letterSpacing: "0.03em", fontWeight: 600 }}>{label}</span>
        {action}
      </div>
      {children}
    </div>
  );
}

function SquadRulesSheet({ open, onClose, squad, forceOut, forceKeep, onToggleOut, onToggleKeep }) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Squad rules"
      subtitle="Force a player out, or protect him from being sold"
      maxHeight="80vh"
    >
      <div>
        {(squad?.members || []).map((member) => (
          <div
            key={member.id}
            style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "9px 16px", borderBottom: `1px solid ${C.borderSoft}`,
            }}
          >
            <PlayerPhoto code={member.code} size={34} radius={7} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{member.name}</div>
              <div className="num" style={{ fontSize: F.micro, color: C.textDim }}>
                {member.team} · {member.position} · £{sellPrice(member).toFixed(1)}m
              </div>
            </div>
            <button
              onClick={() => onToggleOut(member.id)}
              className="press"
              style={{
                padding: "5px 10px", borderRadius: 8, fontSize: 11, fontWeight: 700,
                background: forceOut.includes(member.id) ? C.risk : C.surfaceHi,
                color: forceOut.includes(member.id) ? "#000" : C.textDim,
                border: `1px solid ${forceOut.includes(member.id) ? C.risk : C.border}`,
              }}
            >Sell</button>
            <button
              onClick={() => onToggleKeep(member.id)}
              className="press"
              style={{
                padding: "5px 10px", borderRadius: 8, fontSize: 11, fontWeight: 700,
                background: forceKeep.includes(member.id) ? C.good : C.surfaceHi,
                color: forceKeep.includes(member.id) ? "#000" : C.textDim,
                border: `1px solid ${forceKeep.includes(member.id) ? C.good : C.border}`,
              }}
            >Keep</button>
          </div>
        ))}
      </div>
    </Sheet>
  );
}

function NeverBuySheet({ open, onClose, bootstrap, neverBuy, onChange }) {
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!text) return neverBuy.map((id) => bootstrap.playersById.get(id)).filter(Boolean);
    return bootstrap.players
      .filter((player) => player.name.toLowerCase().includes(text) || player.fullName.toLowerCase().includes(text))
      .slice(0, 40);
  }, [query, neverBuy, bootstrap]);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Never buy"
      subtitle="These players are excluded from every solve"
      maxHeight="80vh"
    >
      <div style={{ padding: "12px 16px" }}>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search to add"
          style={{
            width: "100%", padding: "11px 13px", borderRadius: 11,
            background: C.surfaceHi, border: `1px solid ${C.border}`, fontSize: 14,
          }}
        />
      </div>

      {rows.length === 0 ? (
        <Empty title="Nobody on the list" detail="Search above to add a player." />
      ) : rows.map((player) => {
        const on = neverBuy.includes(player.id);
        return (
          <button
            key={player.id}
            onClick={() => onChange(on
              ? neverBuy.filter((id) => id !== player.id)
              : [...neverBuy, player.id])}
            className="press"
            style={{
              width: "100%", display: "flex", alignItems: "center", gap: 10,
              padding: "9px 16px", borderBottom: `1px solid ${C.borderSoft}`, textAlign: "left",
            }}
          >
            <PlayerPhoto code={player.code} size={32} radius={7} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{player.name}</div>
              <div className="num" style={{ fontSize: F.micro, color: C.textDim }}>
                {player.team} · £{player.price.toFixed(1)}m
              </div>
            </div>
            <span style={{ fontSize: 18, color: on ? C.risk : C.textFaint }}>{on ? "×" : "+"}</span>
          </button>
        );
      })}
    </Sheet>
  );
}
