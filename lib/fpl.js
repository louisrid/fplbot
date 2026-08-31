"use client";

/* THE DATA LAYER.
 *
 * Everything the app knows comes from two places and no others:
 *
 *   1. The official FPL API, proxied through /api/fpl. Squad, prices, live points, fixtures.
 *      This is the source of truth for club, position, price and anything that has happened.
 *   2. config/xpts.mjs, a static import of the FPL Copilot export. This is the source of truth
 *      for anything that has not happened yet.
 *
 * There is no database and no login, which is why the app needs no configuration to run.
 *
 * Where the two disagree about a player's club, position or price, the FPL API wins. The export
 * runs a transfer or two behind and has had players at the wrong club.
 */

import XPTS from "../config/xpts.mjs";

export const ENTRY_ID = 4812;
export const SQUAD_SIZE = 15;
export const XI_SIZE = 11;
export const CLUB_LIMIT = 3;
export const MAX_FREE_TRANSFERS = 5;
export const HIT_COST = 4;

/* HOW FAR THE PROJECTION IS TRUSTED.
 *
 * The export stores all 38 gameweeks. It is only served as far as gw_served_to, because carrying a
 * number is cheap and standing behind it is not. Past this line the app shows nothing rather than
 * something it cannot justify.
 *
 * To extend the projection: raise gw_served_to in config/xpts.mjs. That is the only edit. Every
 * range picker, every solver window and every greyed-out week reads from this one constant. Never
 * write a gameweek literal anywhere else. */
export const STORED_GW_TO = Number(XPTS.gw_to) || 38;
export const SERVED_GW_TO = Math.min(Number(XPTS.gw_served_to) || 10, STORED_GW_TO);
export const XPTS_IMPORTED_AT = XPTS.imported_at;
export const TOTAL_GWS = 38;

const POS_BY_TYPE = { 1: "GKP", 2: "DEF", 3: "MID", 4: "FWD" };

/* Legal starting elevens. One keeper always, then at least three at the back and one up front. */
export const FORMATIONS = [
  [3, 4, 3], [3, 5, 2], [4, 3, 3], [4, 4, 2],
  [4, 5, 1], [5, 2, 3], [5, 3, 2], [5, 4, 1],
];

const xptsById = new Map((XPTS.rows || []).map((row) => [Number(row.fpl_id), row]));

/* xPTS for one player in one gameweek. Null past the served horizon, never a number. */
export function xptsFor(playerId, gw) {
  if (!Number.isInteger(gw) || gw < 1 || gw > SERVED_GW_TO) return null;
  const row = xptsById.get(Number(playerId));
  if (!row || !Array.isArray(row.xpts)) return null;
  const value = Number(row.xpts[gw - 1]);
  return Number.isFinite(value) ? value : null;
}

/* xPTS summed across an inclusive range. Weeks past the horizon contribute nothing and are not
   silently treated as zero: `served` tells the caller how much of the range was real. */
export function xptsRange(playerId, gwFrom, gwTo) {
  let total = 0;
  let served = 0;
  for (let gw = gwFrom; gw <= gwTo; gw += 1) {
    const value = xptsFor(playerId, gw);
    if (value === null) continue;
    total += value;
    served += 1;
  }
  return { total, served, complete: served === Math.max(0, gwTo - gwFrom + 1) };
}

async function api(path) {
  const response = await fetch(`/api/fpl?path=${encodeURIComponent(path)}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load ${path}`);
  return response.json();
}

/* THE BOOTSTRAP. Players, clubs and the gameweek calendar, normalised once so no component ever
   has to remember that element_type 3 means midfielder or that prices are in tenths. */
export async function loadBootstrap() {
  const [raw, fixtures] = await Promise.all([api("bootstrap-static"), api("fixtures")]);

  const teamsById = new Map();
  for (const team of raw.teams || []) {
    teamsById.set(team.id, {
      id: team.id,
      name: team.name,
      short: team.short_name,
      code: team.code,
      strength: team.strength,
    });
  }

  const players = (raw.elements || []).map((element) => {
    const team = teamsById.get(element.team);
    return {
      id: element.id,
      code: element.code,
      name: element.web_name,
      fullName: `${element.first_name} ${element.second_name}`.trim(),
      position: POS_BY_TYPE[element.element_type] || "MID",
      elementType: element.element_type,
      teamId: element.team,
      team: team ? team.short : "—",
      teamName: team ? team.name : "Unknown",
      price: element.now_cost / 10,
      totalPoints: element.total_points,
      eventPoints: element.event_points,
      form: Number(element.form) || 0,
      ownership: Number(element.selected_by_percent) || 0,
      minutes: element.minutes,
      starts: element.starts,
      goals: element.goals_scored,
      assists: element.assists,
      cleanSheets: element.clean_sheets,
      saves: element.saves,
      bonus: element.bonus,
      bps: element.bps,
      yellow: element.yellow_cards,
      red: element.red_cards,
      xG: Number(element.expected_goals) || 0,
      xA: Number(element.expected_assists) || 0,
      xGI: Number(element.expected_goal_involvements) || 0,
      defCon: Number(element.defensive_contribution) || 0,
      defConPer90: Number(element.defensive_contribution_per_90) || 0,
      pointsPerGame: Number(element.points_per_game) || 0,
      status: element.status,
      chanceOfPlaying: element.chance_of_playing_next_round,
      news: element.news || "",
      priceChange: element.cost_change_event / 10,
      priceNow: element.now_cost / 10,
      priceChangeStart: element.cost_change_start / 10,
      penaltyOrder: element.penalties_order,
      transfersInEvent: element.transfers_in_event,
      transfersOutEvent: element.transfers_out_event,
    };
  });

  const events = (raw.events || []).map((event) => ({
    gw: event.id,
    deadline: event.deadline_time,
    finished: event.finished,
    dataChecked: event.data_checked,
    isCurrent: event.is_current,
    isNext: event.is_next,
    averageScore: event.average_entry_score,
    highestScore: event.highest_score,
  }));

  const currentGw = events.find((e) => e.isCurrent)?.gw
    || events.find((e) => e.isNext)?.gw
    || 1;
  const nextGw = events.find((e) => e.isNext)?.gw || currentGw;

  return {
    players,
    playersById: new Map(players.map((p) => [p.id, p])),
    teamsById,
    teams: [...teamsById.values()].sort((a, b) => a.name.localeCompare(b.name)),
    events,
    currentGw,
    nextGw,
    fixtures: (fixtures || []).map((f) => ({
      id: f.id,
      gw: f.event,
      homeId: f.team_h,
      awayId: f.team_a,
      homeScore: f.team_h_score,
      awayScore: f.team_a_score,
      homeDifficulty: f.team_h_difficulty,
      awayDifficulty: f.team_a_difficulty,
      kickoff: f.kickoff_time,
      started: f.started,
      /* `finished` stays false until the whole gameweek is data-checked and bonus is confirmed,
         which can be a day after the final whistle. `finished_provisional` with ninety minutes on
         the clock is what actually means the match is over. Using `finished` alone left every
         completed match flashing LIVE for the rest of the weekend. */
      finished: f.finished,
      finishedProvisional: f.finished_provisional,
      minutes: f.minutes,
      stats: f.stats || [],
    })),
  };
}

/* FREE TRANSFERS.
 *
 * The API never states how many you have. It has to be derived: one per gameweek, banking up to
 * five, less whatever you spent. Deriving it from history is the only way to be right about it,
 * and getting it wrong makes every hit calculation on the transfer screen wrong too.
 *
 * GW1 BANKS NOTHING. Before the first deadline the whole squad is free to change, so there is no
 * transfer to carry out of it. Counting GW1 as an unused free transfer inflates every week after
 * it by one, which is why the loop below starts at the second week rather than the first. */
export function deriveFreeTransfers(history, targetGw) {
  const weeks = (history?.current || []).filter((row) => Number(row.event) < targetGw);
  if (!weeks.length) return 1;
  let free = 1;
  for (const week of weeks.slice(1)) {
    free = Math.min(MAX_FREE_TRANSFERS, free + 1 - (Number(week.event_transfers) || 0));
    free = Math.max(0, free);
  }
  const last = weeks[weeks.length - 1];
  if (Number(last.event) === targetGw - 1 && weeks.length > 1) return free;
  return Math.min(MAX_FREE_TRANSFERS, Math.max(1, free));
}

/* WHAT YOU ACTUALLY PAID.
 *
 * The picks endpoint does not return selling price, so purchase price has to be reconstructed or
 * every calculation that depends on it is wrong. Two sources, and between them they are exact:
 *
 *   - A player you have never transferred in was bought at the season-start price, which the
 *     bootstrap gives as now_cost minus cost_change_start.
 *   - A player you transferred in was bought at element_in_cost, recorded on the transfers
 *     endpoint. Later transfers overwrite earlier ones, which is what you want if he has been in
 *     and out more than once.
 *
 * Using the current price instead, as a placeholder, quietly misprices every rise and fall: it
 * reports squad value as the market price rather than what the squad would actually raise, which
 * is what makes a transfer look affordable when it is a tenth short. */
function purchasePrices(members, transfers, playersById) {
  const paid = new Map();
  for (const member of members) {
    const player = playersById.get(member.id);
    if (!player) continue;
    paid.set(member.id, (player.priceNow - player.priceChangeStart));
  }
  const ordered = [...(transfers || [])].sort((a, b) => (a.event || 0) - (b.event || 0));
  for (const move of ordered) {
    if (Number.isFinite(move?.element_in_cost)) paid.set(move.element_in, move.element_in_cost / 10);
  }
  return paid;
}

/* YOUR SQUAD as it stood at a given gameweek's deadline, joined to current player data.
 * Picks only exist once a deadline has passed, so a future gameweek reuses the latest real squad. */
export async function loadSquad(bootstrap, gw) {
  const readableGw = Math.min(gw, bootstrap.currentGw);
  const [picks, entry, history, transfers] = await Promise.all([
    api(`entry/${ENTRY_ID}/event/${readableGw}/picks`).catch(() => null),
    api(`entry/${ENTRY_ID}`).catch(() => null),
    api(`entry/${ENTRY_ID}/history`).catch(() => null),
    api(`entry/${ENTRY_ID}/transfers`).catch(() => []),
  ]);
  if (!picks?.picks?.length) return null;

  const paid = purchasePrices(
    picks.picks.map((pick) => ({ id: pick.element })),
    transfers,
    bootstrap.playersById,
  );

  const members = picks.picks.map((pick) => {
    const player = bootstrap.playersById.get(pick.element);
    return {
      ...player,
      slot: pick.position,
      isCaptain: pick.is_captain,
      isVice: pick.is_vice_captain,
      multiplier: pick.multiplier,
      starting: pick.position <= XI_SIZE,
      purchasePrice: paid.get(pick.element) ?? player?.price ?? 0,
    };
  }).filter((m) => m.id);

  const bank = (picks.entry_history?.bank ?? 0) / 10;
  return {
    gw: readableGw,
    members,
    bank,
    /* Selling value, not market value. The API's own `value` is a snapshot from the last deadline
       and drifts as prices move during the week. */
    value: members.reduce((sum, member) => sum + sellPrice(member), 0),
    marketValue: members.reduce((sum, member) => sum + member.price, 0),
    deadlineValue: (picks.entry_history?.value ?? 0) / 10,
    points: picks.entry_history?.points ?? 0,
    transfersMade: picks.entry_history?.event_transfers ?? 0,
    transferCost: picks.entry_history?.event_transfers_cost ?? 0,
    benchPoints: picks.entry_history?.points_on_bench ?? 0,
    activeChip: picks.active_chip || null,
    autoSubs: picks.automatic_subs || [],
    entryName: entry?.name || "My team",
    freeTransfers: deriveFreeTransfers(history, bootstrap.nextGw),
    history: history?.current || [],
    chipsUsed: history?.chips || [],
  };
}

/* LIVE POINTS for one gameweek, keyed by player id. Empty for a gameweek not yet started. */
export async function loadLive(gw) {
  try {
    const data = await api(`event/${gw}/live`);
    const byId = new Map();
    for (const element of data.elements || []) {
      byId.set(element.id, {
        points: element.stats?.total_points ?? 0,
        minutes: element.stats?.minutes ?? 0,
        played: (element.stats?.minutes ?? 0) > 0,
        bonus: element.stats?.bonus ?? 0,
        bps: element.stats?.bps ?? 0,
        goals: element.stats?.goals_scored ?? 0,
        assists: element.stats?.assists ?? 0,
        cleanSheet: element.stats?.clean_sheets ?? 0,
        saves: element.stats?.saves ?? 0,
        yellow: element.stats?.yellow_cards ?? 0,
        red: element.stats?.red_cards ?? 0,
      });
    }
    return byId;
  } catch {
    return new Map();
  }
}

export async function loadPlayerSummary(playerId) {
  return api(`element-summary/${playerId}`);
}

/* THE HYBRID TOTAL.
 *
 * Real points for anyone who has kicked a ball, xPTS for anyone who has not, added together. Once a
 * player is on the pitch his projection is discarded entirely: two points at half time is two
 * points, not two plus the rest of a forecast that has already been overtaken by events.
 *
 * Captaincy is applied to whichever number the captain contributes, so a captain who has played
 * doubles his real score and a captain who has not doubles his projection. */
export function squadTotals({ members, live, gw, benchBoost = false, captainMult = 2 }) {
  let real = 0;
  let projected = 0;
  let played = 0;
  let toPlay = 0;

  for (const member of members) {
    const counts = benchBoost || member.starting;
    if (!counts) continue;

    const multiplier = member.isCaptain ? captainMult : 1;
    const liveRow = live?.get(member.id);

    if (liveRow?.played) {
      real += liveRow.points * multiplier;
      projected += liveRow.points * multiplier;
      played += 1;
    } else {
      const forecast = xptsFor(member.id, gw);
      if (forecast !== null) projected += forecast * multiplier;
      toPlay += 1;
    }
  }
  return { real, projected, played, toPlay };
}

/* WHAT A PLAYER SELLS FOR.
 *
 * You keep half of any rise, rounded down to the nearest tenth. A player bought at 5.0 who is now
 * 5.3 sells for 5.1, not 5.3. Falls are absorbed in full. Getting this wrong overstates your budget
 * on every transfer screen, which is the kind of error that only surfaces once a move is already
 * impossible. */
export function sellPrice(player) {
  const bought = Number(player.purchasePrice ?? player.price);
  const now = Number(player.price);
  if (!Number.isFinite(bought) || !Number.isFinite(now)) return now || 0;
  if (now <= bought) return now;
  const rise = now - bought;
  return bought + Math.floor(rise * 10 / 2) / 10;
}

export const squadValue = (members) => members.reduce((sum, m) => sum + sellPrice(m), 0);

/* IS THIS ELEVEN LEGAL? Used to block an illegal swap before it happens rather than explaining
   afterwards why the squad cannot be saved. */
export function formationOf(members) {
  const xi = members.filter((m) => m.starting);
  const count = (position) => xi.filter((m) => m.position === position).length;
  return { gk: count("GKP"), def: count("DEF"), mid: count("MID"), fwd: count("FWD"), size: xi.length };
}

export function formationLabel(members) {
  const { def, mid, fwd } = formationOf(members);
  return `${def}-${mid}-${fwd}`;
}

export function isLegalXI(members) {
  const { gk, def, mid, fwd, size } = formationOf(members);
  if (size !== XI_SIZE || gk !== 1) return false;
  return FORMATIONS.some(([d, m, f]) => d === def && m === mid && f === fwd);
}

/* Full squad legality, checked on every edit. Returns a plain-English reason so the UI never has to
   compose one and the two can never drift apart. */
export function squadProblems(members, bank = 0) {
  const problems = [];
  const count = (position) => members.filter((m) => m.position === position).length;

  if (members.length !== SQUAD_SIZE) problems.push(`Squad has ${members.length} players, needs ${SQUAD_SIZE}`);
  if (count("GKP") !== 2) problems.push(`${count("GKP")} goalkeepers, needs 2`);
  if (count("DEF") !== 5) problems.push(`${count("DEF")} defenders, needs 5`);
  if (count("MID") !== 5) problems.push(`${count("MID")} midfielders, needs 5`);
  if (count("FWD") !== 3) problems.push(`${count("FWD")} forwards, needs 3`);

  const byClub = new Map();
  for (const member of members) byClub.set(member.team, (byClub.get(member.team) || 0) + 1);
  for (const [club, total] of byClub) {
    if (total > CLUB_LIMIT) problems.push(`${total} players from ${club}, limit is ${CLUB_LIMIT}`);
  }

  if (bank < -0.001) problems.push(`Over budget by £${Math.abs(bank).toFixed(1)}m`);
  if (!isLegalXI(members)) problems.push("Starting eleven is not a legal formation");
  return problems;
}

/* Availability, reduced to the one thing that matters: can I start him. */
export function availability(player) {
  if (player.status === "a") return null;
  const chance = player.chanceOfPlaying;
  if (player.status === "u" || player.status === "n") return { level: "out", label: "Unavailable" };
  if (player.status === "s") return { level: "out", label: "Suspended" };
  if (player.status === "i" || player.status === "d") {
    if (chance === 0) return { level: "out", label: "Out" };
    if (chance !== null && chance !== undefined) return { level: "doubt", label: `${chance}%` };
    return { level: "doubt", label: "Doubt" };
  }
  return null;
}

/* Served through this app's own proxy: one origin, one connection, cached at the edge. */
export const photoUrl = (code, size = "250x250") => `/api/photo?code=${code}&size=${size}`;

/* Fixtures for a club in a gameweek. Returns a list because a double gameweek is two rows and a
   blank is none, and a caller that assumes exactly one will be wrong in both cases. */
export function fixturesForTeam(fixtures, teamId, gw) {
  return fixtures
    .filter((f) => f.gw === gw && (f.homeId === teamId || f.awayId === teamId))
    .map((f) => {
      const home = f.homeId === teamId;
      return {
        ...f,
        home,
        opponentId: home ? f.awayId : f.homeId,
        difficulty: home ? f.homeDifficulty : f.awayDifficulty,
      };
    });
}

export function opponentLabel(fixtures, teamsById, teamId, gw) {
  const rows = fixturesForTeam(fixtures, teamId, gw);
  if (!rows.length) return { text: "BLANK", difficulty: 5, blank: true };
  const text = rows
    .map((row) => `${teamsById.get(row.opponentId)?.short || "?"}${row.home ? "" : " (A)"}`)
    .join(", ");
  return { text, difficulty: Math.max(...rows.map((r) => r.difficulty)), double: rows.length > 1 };
}
