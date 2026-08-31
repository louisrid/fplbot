"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Pitch from "../components/Pitch";
import PlayerSheet from "../components/PlayerSheet";
import TransferSheet from "../components/TransferSheet";
import { Sheet, Loading, ErrorBox, Pill, Chip } from "../components/UI";
import { C, S, R, F, W } from "../lib/theme";
import {
  loadBootstrap, loadSquad, loadLive, squadTotals, squadValue, sellPrice,
  SERVED_GW_TO, TOTAL_GWS, XI_SIZE, isLegalXI, formationLabel, squadProblems, HIT_COST,
} from "../lib/fpl";
import {
  listDrafts, getDraft, createDraft, deleteDraft, renameDraft,
  getSelectedId, setSelectedId, applyChain, weekOf, setWeek,
} from "../lib/drafts";
import { bestXI } from "../lib/solver";
import { readPref, writePref } from "../lib/prefs";
import { chipStatus, captainMultiplier, benchCounts, CHIPS } from "../lib/chips";

/* HOME.
 *
 * The one screen the app exists for: my team, this week, what it has scored and what it is going to
 * score. Everything else is a detour from here.
 *
 * The whole screen fits without scrolling. Anything that needs more room is a sheet.
 */

export default function Home() {
  const [bootstrap, setBootstrap] = useState(null);
  const [squad, setSquad] = useState(null);
  const [live, setLive] = useState(new Map());
  const [error, setError] = useState(null);
  const [gw, setGw] = useState(null);

  const [drafts, setDrafts] = useState([]);
  const [draftId, setDraftId] = useState(null);
  const [tick, setTick] = useState(0);

  const [tapped, setTapped] = useState(null);
  const [transferOut, setTransferOut] = useState(null);
  const [swapping, setSwapping] = useState(null);
  const [swapNote, setSwapNote] = useState(null);
  const [showDrafts, setShowDrafts] = useState(false);

  const refreshDrafts = useCallback(() => {
    setDrafts(listDrafts());
    setTick((value) => value + 1);
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      const core = await loadBootstrap();
      setBootstrap(core);
      /* THE GAMEWEEK YOU WERE LAST LOOKING AT.
       *
       * Remembered, so a reload does not throw away where you were. It is not restored blindly
       * though: a gameweek that has since finished is behind you, and reopening the app into a
       * settled week you can no longer act on is not useful. In that case it snaps forward to the
       * current one. */
      const remembered = readPref("home.gw", null);
      const startGw = Number.isInteger(remembered) && remembered >= core.currentGw && remembered <= TOTAL_GWS
        ? remembered
        : core.currentGw;
      setGw((current) => current ?? startGw);
      const [mySquad, liveRows] = await Promise.all([
        loadSquad(core, startGw),
        loadLive(startGw),
      ]);
      setSquad(mySquad);
      setLive(liveRows);
      setDrafts(listDrafts());
      setDraftId(getSelectedId());
    } catch (issue) {
      setError(issue?.message || "Something went wrong");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /* Live scores while a gameweek is in progress. Sixty seconds is frequent enough that the number
     feels live and infrequent enough to be invisible on a data plan. Stops entirely once the
     gameweek is finished, because there is nothing left to update. */
  useEffect(() => {
    if (!bootstrap || gw === null) return undefined;
    const event = bootstrap.events.find((e) => e.gw === gw);
    if (!event || event.finished || gw > bootstrap.currentGw) return undefined;
    const timer = setInterval(() => { loadLive(gw).then(setLive); }, 60000);
    return () => clearInterval(timer);
  }, [bootstrap, gw]);

  useEffect(() => {
    if (!bootstrap || gw === null) return;
    loadLive(gw).then(setLive);
    writePref("home.gw", gw);
  }, [bootstrap, gw]);

  const draft = useMemo(
    () => (draftId ? getDraft(draftId) : null),
    [draftId, tick],
  );

  /* THE CHAIN STARTS AT THE NEXT DEADLINE, NOT THIS WEEK.
   *
   * squad.freeTransfers is the count for the next gameweek, because that is the only week you can
   * still act on. Basing the chain on the current gameweek and then adding one per week forward
   * counted that same transfer twice, so GW3 read three when you really had two. */
  const baseGw = bootstrap?.nextGw ?? 1;
  const editable = bootstrap && gw !== null && gw >= bootstrap.nextGw;

  /* THE SQUAD ON SCREEN.
   *
   * With no draft selected this is your real team. With a draft selected it is your real team with
   * that draft's chain of transfers applied up to the week you are looking at. */
  const view = useMemo(() => {
    if (!squad || !bootstrap || gw === null) return null;
    if (!draft) {
      return {
        members: squad.members,
        bank: squad.bank,
        free: squad.freeTransfers,
        hits: 0,
        transfers: [],
      };
    }
    return applyChain({
      draft,
      baseMembers: squad.members,
      baseBank: squad.bank,
      baseGw,
      targetGw: gw,
      freeAtBase: squad.freeTransfers,
      playersById: bootstrap.playersById,
    });
  }, [squad, bootstrap, gw, draft, baseGw]);

  /* WHICH CHIP IS ON THIS WEEK.
   *
   * For your real team it is whatever you actually played. Inside a draft it is whatever the draft
   * plans, but only if that chip is still available in this half of the season. */
  const activeChip = useMemo(() => {
    if (!draft) return (gw === squad?.gw ? squad?.activeChip : null) || null;
    return weekOf(draft, gw).chip || null;
  }, [draft, gw, squad]);

  const chips = useMemo(
    () => chipStatus(squad?.chipsUsed || [], gw ?? 1),
    [squad, gw],
  );

  const totals = useMemo(() => {
    if (!view || gw === null) return null;
    return squadTotals({
      members: view.members,
      live,
      gw,
      benchBoost: benchCounts(activeChip),
      captainMult: captainMultiplier(activeChip),
    });
  }, [view, live, gw, activeChip]);

  /* Any edit forks a draft if you do not already have one selected, so your real team is never
     altered by accident. */
  const ensureDraft = useCallback(() => {
    if (draftId) return draftId;
    const created = createDraft({ fromGw: gw });
    setSelectedId(created.id);
    setDraftId(created.id);
    refreshDrafts();
    return created.id;
  }, [draftId, gw, refreshDrafts]);

  /* The whole set commits together. A joint move only balances across all of it, so applying one
     pair at a time could leave the squad transiently over budget and reject the rest. */
  const applyTransfer = useCallback((pairs) => {
    if (!pairs?.length) return;
    const id = ensureDraft();
    const week = weekOf(getDraft(id), gw);
    const replacing = new Set(pairs.map((pair) => pair.out.id));
    setWeek(id, gw, {
      transfers: [
        ...week.transfers.filter((t) => !replacing.has(t.out)),
        ...pairs.map((pair) => ({
          out: pair.out.id,
          in: pair.in.id,
          sellPrice: sellPrice(pair.out),
        })),
      ],
    });
    setTransferOut(null);
    setTapped(null);
    refreshDrafts();
  }, [ensureDraft, gw, refreshDrafts]);

  const writeLineup = useCallback((members) => {
    const id = ensureDraft();
    setWeek(id, gw, { lineup: members.map((member) => member.id) });
    refreshDrafts();
  }, [ensureDraft, gw, refreshDrafts]);

  /* SWAPPING.
   *
   * Tap one player, tap another, they trade places. Formation follows automatically exactly as it
   * does on the official site: swapping a defender for a midfielder simply changes the shape, and
   * the swap is refused only if the result would be an illegal eleven. No formation dropdown, ever.
   */
  const doSwap = useCallback((a, b) => {
    if (!view) return;
    const next = view.members.map((member) => {
      if (member.id === a.id) return { ...member, slot: b.slot, starting: b.starting };
      if (member.id === b.id) return { ...member, slot: a.slot, starting: a.starting };
      return member;
    }).sort((x, y) => x.slot - y.slot);

    /* A refused swap now says why. Silently doing nothing looked identical to a broken tap, which
       is the worst way to communicate a rule. */
    if (!isLegalXI(next)) {
      const shape = formationOf(next);
      setSwapNote(
        shape.gk !== 1
          ? "You need exactly one goalkeeper in the eleven."
          : shape.def < 3
            ? "You need at least three defenders."
            : shape.fwd < 1
              ? "You need at least one forward."
              : `${shape.def}-${shape.mid}-${shape.fwd} is not a legal formation.`,
      );
      setSwapping(null);
      setTapped(null);
      return;
    }
    setSwapNote(null);
    writeLineup(next);
    setSwapping(null);
    setTapped(null);
  }, [view, writeLineup]);

  const onTapPlayer = useCallback((member) => {
    if (swapping) {
      if (swapping.id === member.id) { setSwapping(null); return; }
      doSwap(swapping, member);
      return;
    }
    setTapped(member);
  }, [swapping, doSwap]);

  const optimise = useCallback(() => {
    if (!view || gw === null) return;
    const best = bestXI(view.members, gw, Math.min(gw + 2, SERVED_GW_TO));
    if (!best) return;
    const ordered = [
      ...best.xi.map((member, index) => ({ ...member, slot: index + 1, starting: true })),
      ...best.bench.map((member, index) => ({ ...member, slot: XI_SIZE + index + 1, starting: false })),
    ];
    const id = ensureDraft();
    setWeek(id, gw, {
      lineup: ordered.map((member) => member.id),
      captain: best.captain?.id ?? null,
      vice: best.vice?.id ?? null,
    });
    refreshDrafts();
  }, [view, gw, ensureDraft, refreshDrafts]);

  if (error) return <ErrorBox message={error} onRetry={load} />;
  if (!bootstrap || !squad || !view || gw === null) return <Loading label="Loading your team" />;

  const event = bootstrap.events.find((e) => e.gw === gw);
  const isLive = event && !event.finished && gw <= bootstrap.currentGw;
  /* Only a draft's planned hits are deducted here. A hit you actually took is already subtracted
     from the points FPL reports, so taking it off again would count it twice. */
  const plannedHits = draft ? view.hits : 0;
  const beyondHorizon = gw > SERVED_GW_TO;
  const problems = squadProblems(view.members, view.bank);

  return (
    <div style={{ paddingBottom: 0 }}>

      {/* THE HEADER.
       *
       * One raised card carrying the two numbers the screen exists for, with the money and the
       * transfers beneath them on a divided row. Sitting the figures on a panel rather than loose
       * on the background is what stops the top of the screen looking like scattered fragments. */}
      <div style={{ padding: `${S.sm}px ${S.page}px 0` }}>
        <div style={{ background: C.surface, borderRadius: R.card, padding: `0 ${S.lg}px ${S.md}px` }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: S.xs }}>
            <button
              onClick={() => setGw((value) => Math.max(1, value - 1))}
              disabled={gw <= 1}
              className="press"
              style={{
                width: 40, height: S.tap, display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: F.title, color: C.textDim, opacity: gw <= 1 ? 0.25 : 1,
              }}
            >‹</button>
            <span style={{ fontSize: F.title, fontWeight: W.bold, letterSpacing: "-0.02em", minWidth: 54, textAlign: "center" }}>
              GW{gw}
            </span>
            <button
              onClick={() => setGw((value) => Math.min(TOTAL_GWS, value + 1))}
              disabled={gw >= TOTAL_GWS}
              className="press"
              style={{
                width: 40, height: S.tap, display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: F.title, color: C.textDim, opacity: gw >= TOTAL_GWS ? 0.25 : 1,
              }}
            >›</button>
          </div>

          {isLive && (
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span className="live-dot" style={{ width: 7, height: 7, borderRadius: 4, background: C.good }} />
              <span style={{ fontSize: F.tiny, fontWeight: W.semi, color: C.good, letterSpacing: "0.04em" }}>LIVE</span>
            </span>
          )}
        </div>

          <div style={{ display: "flex", alignItems: "flex-end", gap: S.lg, marginTop: S.sm }}>
            <div style={{ flex: 1 }}>
              <div className="num" style={{ fontSize: 28, fontWeight: W.bold, lineHeight: 1, letterSpacing: "-0.03em" }}>
                {totals.real - plannedHits}
              </div>
              <div style={{ fontSize: F.micro, color: C.text, marginTop: 5, letterSpacing: "0.03em", fontWeight: W.semi }}>
                POINTS
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <div className="num" style={{ fontSize: 28, fontWeight: W.bold, lineHeight: 1, letterSpacing: "-0.03em", color: C.xp }}>
                {(totals.projected - plannedHits).toFixed(1)}
              </div>
              <div style={{ fontSize: F.micro, color: C.text, marginTop: 5, letterSpacing: "0.03em", fontWeight: W.semi }}>
                PROJECTED
              </div>
            </div>
          </div>

          <div
            style={{
              display: "flex", alignItems: "center", gap: S.lg,
              marginTop: S.sm, paddingTop: S.sm, borderTop: `1px solid ${C.borderSoft}`, flexWrap: "wrap",
            }}
          >
            <Meta label="FREE" value={view.free} />
            <Meta label="BANK" value={`£${view.bank.toFixed(1)}m`} tone={view.bank < 0 ? C.risk : C.text} />
            <Meta label="VALUE" value={`£${squadValue(view.members).toFixed(1)}m`} />
            {view.hits > 0 && <Meta label="HITS" value={`−${view.hits}`} tone={C.risk} />}
            {activeChip && !draft && (
              <Meta label="CHIP" value={CHIPS.find((chip) => chip.key === activeChip)?.short} tone={C.xp} />
            )}
          </div>
        </div>

        <div style={{ display: "flex", gap: S.sm, marginTop: S.sm }}>
          <button
            onClick={() => setShowDrafts(true)}
            className="press"
            style={{
              flex: 1, height: S.tap, borderRadius: R.lg,
              background: C.surface,
              border: `1px solid ${draft ? C.xp : "transparent"}`,
              display: "flex", alignItems: "center", justifyContent: "center", gap: S.sm,
              fontSize: F.body, fontWeight: W.semi, color: draft ? C.xp : C.text,
            }}
          >
            {draft ? draft.name : "Actual Team"}
            <span style={{ fontSize: F.micro, color: C.textFaint }}>▼</span>
          </button>
          <button
            onClick={optimise}
            disabled={!editable}
            className="press"
            style={{
              height: S.tap, padding: `0 ${S.lg}px`, borderRadius: R.lg, fontSize: F.small, fontWeight: W.bold,
              background: C.surface, color: editable ? C.text : C.textFaint, opacity: editable ? 1 : 0.35,
            }}
          >
            Optimise
          </button>
        </div>
      </div>

      {/* CHIPS. Only shown on a gameweek you can still act on. A chip already spent this half is
          greyed with the week it went, because "unavailable" alone always prompts the question. */}
      {editable && (
        <div style={{ display: "flex", gap: S.sm, padding: `${S.md}px ${S.page}px 0` }}>
          {chips.map((chip) => {
            const on = activeChip === chip.key;
            const usable = chip.available && Boolean(draftId || true);
            return (
              <button
                key={chip.key}
                disabled={!chip.available}
                onClick={() => {
                  const id = ensureDraft();
                  setWeek(id, gw, { chip: on ? null : chip.key });
                  refreshDrafts();
                }}
                className={chip.available ? "press" : ""}
                style={{
                  flex: 1, height: 40, borderRadius: R.lg,
                  background: on ? C.xp : C.surface,
                  border: "none",
                  color: on ? "#000" : chip.available ? C.textDim : C.textFaint,
                  opacity: chip.available ? 1 : 0.4,
                }}
                title={chip.reason || chip.blurb}
              >
                <div className="num" style={{ fontSize: F.small, fontWeight: W.bold }}>{chip.short}</div>
                <div style={{ fontSize: F.micro - 0.5, marginTop: 1, whiteSpace: "nowrap" }}>
                  {chip.available ? chip.name.split(" ")[0] : `GW${chip.usedThisHalf}`}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {activeChip && draft && (
        <div
          style={{
            margin: `${S.md}px ${S.page}px 0`, padding: `${S.md}px ${S.lg}px`, borderRadius: R.card,
            background: "rgba(79,216,255,0.1)", border: `1px solid ${C.xp}`,
            fontSize: 11.5, color: C.xp, textAlign: "center", fontWeight: 600,
          }}
        >
          {CHIPS.find((chip) => chip.key === activeChip)?.name} planned
        </div>
      )}

      {beyondHorizon && (
        <div
          style={{
            padding: `${S.sm}px ${S.page}px 0`,
            fontSize: F.micro, color: C.textDim, textAlign: "center", fontWeight: W.medium,
          }}
        >
          No projection past GW{SERVED_GW_TO}
        </div>
      )}

      {problems.length > 0 && draft && (
        <div
          style={{
            margin: `${S.md}px ${S.page}px 0`, padding: `${S.md}px ${S.lg}px`, borderRadius: R.card,
            background: "rgba(233,0,82,0.1)", border: `1px solid ${C.risk}`,
            fontSize: 11.5, color: C.risk, lineHeight: 1.5,
          }}
        >
          {problems[0]}
        </div>
      )}

      {swapNote && (
        <div
          style={{
            margin: `${S.sm}px ${S.page}px 0`, padding: `${S.md}px ${S.lg}px`, borderRadius: R.card,
            background: "rgba(255,61,110,0.12)", fontSize: F.small, color: C.risk, textAlign: "center",
          }}
          onClick={() => setSwapNote(null)}
        >
          {swapNote}
        </div>
      )}

      {swapping && (
        <div
          style={{
            margin: `${S.md}px ${S.page}px 0`, padding: `${S.md}px ${S.lg}px`, borderRadius: R.card,
            background: C.surfaceHi, border: `1px solid ${C.xp}`,
            fontSize: 12, color: C.xp, textAlign: "center",
          }}
        >
          Tap a player to swap with {swapping.name}
          <button onClick={() => setSwapping(null)} style={{ marginLeft: 8, color: C.textDim, fontSize: 11 }}>cancel</button>
        </div>
      )}

      <Pitch
        members={view.members}
        live={live}
        gw={gw}
        bootstrap={bootstrap}
        onTapPlayer={onTapPlayer}
        benchBoost={benchCounts(activeChip)}
        captainMult={captainMultiplier(activeChip)}
        dense={editable}
      />

      {/* This week's moves, if the draft makes any. Only rendered when there are some. */}
      {view.transfers.length > 0 && (
        <div style={{ margin: `${S.lg}px ${S.page}px 0` }}>
          <div style={{ fontSize: 10.5, color: C.text, letterSpacing: "0.03em", marginBottom: 7, fontWeight: 600 }}>
            GW{gw} TRANSFERS
          </div>
          {view.transfers.map((transfer, index) => (
            <div
              key={index}
              style={{
                display: "flex", alignItems: "center", gap: S.sm, padding: `${S.md}px ${S.lg}px`,
                background: C.surface, borderRadius: R.lg, marginBottom: S.sm,
                border: "none", fontSize: F.small,
              }}
            >
              <span style={{ color: C.risk }}>{transfer.out.name}</span>
              <span style={{ color: C.textFaint }}>→</span>
              <span style={{ color: C.good }}>{transfer.in.name}</span>
              <button
                onClick={() => {
                  const week = weekOf(draft, gw);
                  setWeek(draftId, gw, {
                    transfers: week.transfers.filter((t) => t.out !== transfer.out.id),
                  });
                  refreshDrafts();
                }}
                style={{ marginLeft: "auto", color: C.textDim, fontSize: F.heading, width: 36, height: 36 }}
              >×</button>
            </div>
          ))}
          {view.hits > 0 && (
            <div style={{ fontSize: 11.5, color: C.risk, textAlign: "center", marginTop: 5 }}>
              {view.transfers.length} transfers, {view.free} free · −{view.hits} points
            </div>
          )}
        </div>
      )}

      <PlayerSheet
        member={tapped}
        open={Boolean(tapped)}
        onClose={() => setTapped(null)}
        gw={gw}
        bootstrap={bootstrap}
        live={live}
        editable={editable}
        swapCandidate={swapping}
        onTransfer={(member) => { setTapped(null); setTransferOut(member); }}
        onToggleStarting={(member) => { setTapped(null); setSwapping(member); }}
        onMakeCaptain={(member) => {
          const id = ensureDraft();
          setWeek(id, gw, { captain: member.id });
          refreshDrafts();
          setTapped(null);
        }}
        onMakeVice={(member) => {
          const id = ensureDraft();
          setWeek(id, gw, { vice: member.id });
          refreshDrafts();
          setTapped(null);
        }}
      />

      <TransferSheet
        open={Boolean(transferOut)}
        onClose={() => setTransferOut(null)}
        outgoing={transferOut}
        members={view.members}
        bootstrap={bootstrap}
        bank={view.bank}
        gw={gw}
        gwTo={Math.min(gw + 3, SERVED_GW_TO)}
        freeTransfers={view.free}
        transfersUsed={view.transfers.length}
        onConfirm={applyTransfer}
      />

      <DraftSheet
        open={showDrafts}
        onClose={() => setShowDrafts(false)}
        drafts={drafts}
        activeId={draftId}
        onSelect={(id) => {
          setSelectedId(id);
          setDraftId(id);
          setShowDrafts(false);
        }}
        onDelete={(id) => {
          deleteDraft(id);
          if (draftId === id) setDraftId(null);
          refreshDrafts();
        }}
        onRename={(id, name) => { renameDraft(id, name); refreshDrafts(); }}
        onCreate={() => {
          const created = createDraft({ fromGw: gw });
          setSelectedId(created.id);
          setDraftId(created.id);
          refreshDrafts();
          setShowDrafts(false);
        }}
      />
    </div>
  );
}

/* THE DRAFT LIST.
 *
 * Your real team sits at the top and cannot be deleted. Drafts fork from it, keep their own chain
 * of transfers, and carry forward across gameweeks. */
/* One figure with its label underneath, the pattern used across the summary row. */
function Meta({ label, value, tone = C.text }) {
  return (
    <div>
      <div className="num" style={{ fontSize: F.body, fontWeight: W.bold, color: tone, lineHeight: 1.2 }}>{value}</div>
      <div style={{ fontSize: F.micro, color: C.text, marginTop: 2, letterSpacing: "0.03em", fontWeight: W.semi }}>
        {label}
      </div>
    </div>
  );
}

function DraftSheet({ open, onClose, drafts, activeId, onSelect, onDelete, onRename, onCreate }) {
  const [renaming, setRenaming] = useState(null);
  const [name, setName] = useState("");

  return (
    <Sheet open={open} onClose={onClose} title="Team versions" maxHeight="70vh">
      <div style={{ padding: 14 }}>
        <button
          onClick={() => onSelect(null)}
          className="press"
          style={{
            width: "100%", padding: "13px 14px", borderRadius: 11, marginBottom: 8,
            background: !activeId ? C.surfaceHi : "transparent",
            border: `1px solid ${!activeId ? C.xp : C.border}`,
            display: "flex", alignItems: "center", justifyContent: "space-between",
            fontSize: 14, fontWeight: 600, color: !activeId ? C.xp : C.text,
          }}
        >
          Actual Team
          {!activeId && <span style={{ fontSize: 11 }}>current</span>}
        </button>

        {drafts.map((draft) => (
          <div
            key={draft.id}
            style={{
              display: "flex", alignItems: "center", gap: 8, marginBottom: 8,
              padding: "11px 14px", borderRadius: 11,
              background: activeId === draft.id ? C.surfaceHi : "transparent",
              border: `1px solid ${activeId === draft.id ? C.xp : C.border}`,
            }}
          >
            {renaming === draft.id ? (
              <input
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                onBlur={() => { onRename(draft.id, name || draft.name); setRenaming(null); }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") { onRename(draft.id, name || draft.name); setRenaming(null); }
                }}
                style={{ flex: 1, fontSize: 14, fontWeight: 600, background: "transparent" }}
              />
            ) : (
              <button
                onClick={() => onSelect(draft.id)}
                style={{
                  flex: 1, textAlign: "left", fontSize: 14, fontWeight: 600,
                  color: activeId === draft.id ? C.xp : C.text,
                }}
              >
                {draft.name}
              </button>
            )}
            <button
              onClick={() => { setRenaming(draft.id); setName(draft.name); }}
              style={{ color: C.textDim, fontSize: F.small, height: S.tap, padding: `0 ${S.sm}px` }}
            >edit</button>
            <button
              onClick={() => onDelete(draft.id)}
              style={{ color: C.risk, fontSize: 16, padding: "0 3px" }}
            >×</button>
          </div>
        ))}

        <button
          onClick={onCreate}
          className="press"
          style={{
            width: "100%", padding: "13px", borderRadius: 11, marginTop: 4,
            background: C.text, color: "#000", fontSize: 14, fontWeight: 700,
          }}
        >
          New draft
        </button>

        <div style={{ fontSize: F.tiny, color: C.textDim, marginTop: S.lg, lineHeight: 1.5, textAlign: "center" }}>
          Drafts fork from your actual team and carry their transfers forward across gameweeks.
        </div>
      </div>
    </Sheet>
  );
}
