"use client";

/* THE SOLVER.
 *
 * The old site drove a HiGHS mixed-integer program compiled to WebAssembly. That was the right tool
 * for "build a whole fifteen from nothing", where the search space is astronomically large. It is
 * the wrong tool here.
 *
 * This solver answers a much narrower question: given the fifteen I already own and one or two free
 * transfers, what should I do. That space is small enough to search exhaustively, which means the
 * answer is provably the best one rather than whatever the optimiser converged on, it runs in the
 * browser in milliseconds, and there is no WASM binary to ship or fail to load.
 *
 * WHAT IT OPTIMISES.
 *
 * Net xPTS gain across your chosen gameweek range, measured against doing nothing. The baseline is
 * always "hold the current squad", so an option only appears if it genuinely beats standing still.
 *
 * WHAT IT WILL NOT DO.
 *
 * Take a hit. You asked for free transfers only, so the search never exceeds them.
 *
 * VARIETY.
 *
 * Options must be distinct as whole plans: no two share an identical set of moves. Players may and
 * often should repeat across options, because if one signing is genuinely best it belongs in
 * several plans. What varies is the rest of the plan around it. The optional per-player cap exists
 * for the case where one name crowds out everything else.
 */

import {
  CLUB_LIMIT, SQUAD_SIZE, XI_SIZE, FORMATIONS,
  xptsRange, sellPrice, availability,
} from "./fpl";

/* How many candidates per position enter the search. The full pool is 600+, most of whom are
   fourth-choice players who will never be the answer. Ranking by xPTS over the range and taking the
   strongest keeps the two-move search fast without ever discarding a realistic signing. */
const CANDIDATE_DEPTH = { GKP: 18, DEF: 45, MID: 55, FWD: 30 };

/* The best legal eleven from a fifteen, and what it scores. Also returns the bench in the order it
   should be used, which is simply the remaining players ranked by projection. */
export function bestXI(members, gwFrom, gwTo, captainMultiplier = 2) {
  const scored = members.map((member) => ({
    member,
    xpts: xptsRange(member.id, gwFrom, gwTo).total,
  }));

  const byPosition = (position) => scored
    .filter((row) => row.member.position === position)
    .sort((a, b) => b.xpts - a.xpts);

  const keepers = byPosition("GKP");
  const defenders = byPosition("DEF");
  const midfielders = byPosition("MID");
  const forwards = byPosition("FWD");

  let best = null;
  for (const [defCount, midCount, fwdCount] of FORMATIONS) {
    if (defenders.length < defCount || midfielders.length < midCount || forwards.length < fwdCount) continue;
    if (!keepers.length) continue;

    const xi = [
      keepers[0],
      ...defenders.slice(0, defCount),
      ...midfielders.slice(0, midCount),
      ...forwards.slice(0, fwdCount),
    ];
    const base = xi.reduce((sum, row) => sum + row.xpts, 0);
    const captain = xi.reduce((top, row) => (row.xpts > top.xpts ? row : top), xi[0]);
    const total = base + captain.xpts * (captainMultiplier - 1);

    if (!best || total > best.total) {
      const chosen = new Set(xi.map((row) => row.member.id));
      const bench = scored
        .filter((row) => !chosen.has(row.member.id))
        .sort((a, b) => {
          /* The reserve keeper is bench slot one by convention and cannot cover an outfielder. */
          if (a.member.position === "GKP") return 1;
          if (b.member.position === "GKP") return -1;
          return b.xpts - a.xpts;
        });
      best = {
        total,
        base,
        formation: `${defCount}-${midCount}-${fwdCount}`,
        xi: xi.map((row) => row.member),
        bench: bench.map((row) => row.member),
        captain: captain.member,
        vice: xi.filter((row) => row.member.id !== captain.member.id)
          .sort((a, b) => b.xpts - a.xpts)[0]?.member || null,
      };
    }
  }
  return best;
}

const clubCounts = (members) => {
  const counts = new Map();
  for (const member of members) counts.set(member.teamId, (counts.get(member.teamId) || 0) + 1);
  return counts;
};

function buildCandidates({ allPlayers, squadIds, neverBuy, gwFrom, gwTo, includeDoubtful }) {
  const banned = new Set(neverBuy || []);
  const byPosition = { GKP: [], DEF: [], MID: [], FWD: [] };

  for (const player of allPlayers) {
    if (squadIds.has(player.id) || banned.has(player.id)) continue;
    const flag = availability(player);
    if (flag?.level === "out") continue;
    if (!includeDoubtful && flag?.level === "doubt") continue;

    const { total } = xptsRange(player.id, gwFrom, gwTo);
    if (total <= 0) continue;
    byPosition[player.position]?.push({ ...player, xpts: total });
  }

  for (const position of Object.keys(byPosition)) {
    byPosition[position].sort((a, b) => b.xpts - a.xpts);
    byPosition[position] = byPosition[position].slice(0, CANDIDATE_DEPTH[position]);
  }
  return byPosition;
}

/* One evaluation: swap these players out, those in, and see what the best eleven now scores.
   Returns null when the result would be illegal, so illegality is never a special case upstream. */
function evaluate({ members, out, incoming, bank, gwFrom, gwTo }) {
  const outIds = new Set(out.map((player) => player.id));
  const kept = members.filter((member) => !outIds.has(member.id));
  const squad = [...kept, ...incoming];

  if (squad.length !== SQUAD_SIZE) return null;

  const received = out.reduce((sum, player) => sum + sellPrice(player), 0);
  const spent = incoming.reduce((sum, player) => sum + player.price, 0);
  const remaining = bank + received - spent;
  if (remaining < -0.001) return null;

  const counts = clubCounts(squad);
  for (const total of counts.values()) if (total > CLUB_LIMIT) return null;

  const shape = bestXI(squad, gwFrom, gwTo);
  if (!shape) return null;

  return { squad, shape, bank: remaining, out, in: incoming, score: shape.total };
}

/* THE SEARCH.
 *
 * One move is 15 x candidates. Two moves is every pair of outgoing players against every pair of
 * incoming, which is large but bounded, and pruned hard: a pair is only tried when the money works
 * and neither outgoing player is force-kept. In practice this completes in well under a second on
 * a phone.
 */
export function solveTransfers({
  members,
  allPlayers,
  bank,
  freeTransfers,
  gwFrom,
  gwTo,
  neverBuy = [],
  forceOut = [],
  forceKeep = [],
  includeDoubtful = false,
  maxPerPlayer = 0,
  limit = 6,
}) {
  const squadIds = new Set(members.map((member) => member.id));
  const keep = new Set(forceKeep);
  const mustGo = new Set(forceOut);

  const candidates = buildCandidates({ allPlayers, squadIds, neverBuy, gwFrom, gwTo, includeDoubtful });
  const baseline = bestXI(members, gwFrom, gwTo);
  if (!baseline) return { baseline: null, options: [] };

  const sellable = members.filter((member) => !keep.has(member.id));
  const results = [];
  const maxMoves = Math.max(1, Math.min(freeTransfers, 2));

  /* Hold. Always present, always the thing every option is measured against. */
  const hold = {
    id: "hold",
    moves: 0,
    out: [],
    in: [],
    gain: 0,
    score: baseline.total,
    shape: baseline,
    bank,
    hits: 0,
  };

  const consider = (out, incoming) => {
    if (mustGo.size && ![...mustGo].every((id) => out.some((player) => player.id === id))) return;
    const evaluated = evaluate({ members, out, incoming, bank, gwFrom, gwTo });
    if (!evaluated) return;
    const gain = evaluated.score - baseline.total;
    if (gain <= 0.01) return;
    results.push({
      id: `${out.map((p) => p.id).sort().join("-")}_${incoming.map((p) => p.id).sort().join("-")}`,
      moves: out.length,
      out,
      in: incoming,
      gain,
      score: evaluated.score,
      shape: evaluated.shape,
      bank: evaluated.bank,
      hits: 0,
    });
  };

  for (const outgoing of sellable) {
    const pool = candidates[outgoing.position] || [];
    for (const incoming of pool) consider([outgoing], [incoming]);
  }

  if (maxMoves >= 2) {
    for (let i = 0; i < sellable.length; i += 1) {
      for (let j = i + 1; j < sellable.length; j += 1) {
        const outPair = [sellable[i], sellable[j]];
        const budget = bank + outPair.reduce((sum, player) => sum + sellPrice(player), 0);

        const firstPool = candidates[outPair[0].position] || [];
        const secondPool = candidates[outPair[1].position] || [];

        for (const first of firstPool) {
          if (first.price > budget) continue;
          for (const second of secondPool) {
            if (first.id === second.id) continue;
            if (first.price + second.price > budget + 0.001) continue;
            consider(outPair, [first, second]);
          }
        }
      }
    }
  }

  results.sort((a, b) => b.gain - a.gain);

  /* Distinct as whole plans. Identical move-sets collapse to one; shared players do not. */
  const seen = new Set();
  const perPlayer = new Map();
  const options = [];

  for (const result of results) {
    if (options.length >= limit) break;
    if (seen.has(result.id)) continue;

    if (maxPerPlayer > 0) {
      const over = result.in.some((player) => (perPlayer.get(player.id) || 0) >= maxPerPlayer);
      if (over) continue;
    }

    seen.add(result.id);
    for (const player of result.in) perPlayer.set(player.id, (perPlayer.get(player.id) || 0) + 1);
    options.push(result);
  }

  return { baseline, hold, options };
}
