"use client";

/* DRAFTS.
 *
 * A draft is a PLAN, not a snapshot. It holds a chain of gameweeks, each with its own transfers,
 * captain, formation and bench order, starting from your real squad and running forward. Stepping
 * from GW3 to GW4 inside a draft carries the GW3 transfers with you, because a plan that forgets
 * what it just did cannot tell you what a second move costs.
 *
 * Free transfers accumulate down the chain: one a week, banking to five, spent as you go. That is
 * the whole reason the chain exists. Without it, "can I afford two moves in GW5" has no answer.
 *
 * Everything lives in this browser. There is no login and no server copy, so a draft is private to
 * the device that made it and survives until it is deleted.
 */

import { MAX_FREE_TRANSFERS, HIT_COST, sellPrice, XI_SIZE } from "./fpl";

const KEY = "zeus2:drafts:v1";
const SELECTED_KEY = "zeus2:selected:v1";

const read = () => {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const write = (drafts) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(drafts));
  } catch {
    /* Storage full or private mode. The draft simply does not persist; the session still works. */
  }
};

export const listDrafts = () => read();

export const getDraft = (id) => read().find((draft) => draft.id === id) || null;

export function getSelectedId() {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(SELECTED_KEY);
  } catch {
    return null;
  }
}

export function setSelectedId(id) {
  if (typeof window === "undefined") return;
  try {
    if (id) window.localStorage.setItem(SELECTED_KEY, id);
    else window.localStorage.removeItem(SELECTED_KEY);
  } catch {
    /* ignore */
  }
}

/* Naming is fixed: Draft 1 (Main Team), Draft 2 (Main Team). The number is the next unused one, so
   deleting Draft 2 and making another gives you Draft 2 again rather than Draft 3. */
export function nextDraftName(parentName = "Main Team") {
  const used = new Set(
    read()
      .map((draft) => /^Draft (\d+)/.exec(draft.name)?.[1])
      .filter(Boolean)
      .map(Number),
  );
  let index = 1;
  while (used.has(index)) index += 1;
  return `Draft ${index} (${parentName})`;
}

export function createDraft({ fromGw, transfers = [], lineup = null, captain = null, vice = null }) {
  const drafts = read();
  const draft = {
    id: `d${Date.now()}${Math.floor(Math.random() * 1000)}`,
    name: nextDraftName(),
    createdAt: new Date().toISOString(),
    weeks: {
      [fromGw]: { transfers, lineup, captain, vice, chip: null },
    },
  };
  drafts.push(draft);
  write(drafts);
  return draft;
}

export function updateDraft(id, updater) {
  const drafts = read();
  const index = drafts.findIndex((draft) => draft.id === id);
  if (index === -1) return null;
  const updated = typeof updater === "function" ? updater(drafts[index]) : { ...drafts[index], ...updater };
  drafts[index] = updated;
  write(drafts);
  return updated;
}

export function deleteDraft(id) {
  write(read().filter((draft) => draft.id !== id));
  if (getSelectedId() === id) setSelectedId(null);
}

export function renameDraft(id, name) {
  return updateDraft(id, (draft) => ({ ...draft, name }));
}

export const emptyWeek = () => ({ transfers: [], lineup: null, captain: null, vice: null, chip: null });

export function weekOf(draft, gw) {
  return draft?.weeks?.[gw] ? { ...emptyWeek(), ...draft.weeks[gw] } : emptyWeek();
}

export function setWeek(draftId, gw, patch) {
  return updateDraft(draftId, (draft) => ({
    ...draft,
    weeks: { ...draft.weeks, [gw]: { ...weekOf(draft, gw), ...patch } },
  }));
}

/* APPLYING THE CHAIN.
 *
 * Walk from the base gameweek up to the target, applying each week's transfers in order and
 * accounting for money and free transfers as you go. The result is the fifteen you would actually
 * own in that gameweek, plus what getting there cost.
 *
 * Every transfer stores the sell price that applied at the moment it was made, so replaying the
 * chain later cannot silently re-price a move you already committed to.
 */
export function applyChain({ draft, baseMembers, baseBank, baseGw, targetGw, freeAtBase, playersById }) {
  let members = baseMembers.map((member) => ({ ...member }));
  let bank = baseBank;
  let free = freeAtBase;
  let totalHits = 0;
  const perWeek = {};

  for (let gw = baseGw; gw <= targetGw; gw += 1) {
    if (gw > baseGw) free = Math.min(MAX_FREE_TRANSFERS, free + 1);

    const week = weekOf(draft, gw);
    const applied = [];

    for (const transfer of week.transfers || []) {
      const outIndex = members.findIndex((member) => member.id === transfer.out);
      const incoming = playersById.get(transfer.in);
      if (outIndex === -1 || !incoming) continue;

      const outgoing = members[outIndex];
      const out = Number.isFinite(transfer.sellPrice) ? transfer.sellPrice : sellPrice(outgoing);
      bank = bank + out - incoming.price;

      members[outIndex] = {
        ...incoming,
        slot: outgoing.slot,
        starting: outgoing.starting,
        isCaptain: false,
        isVice: false,
        multiplier: outgoing.starting ? 1 : 0,
        purchasePrice: incoming.price,
      };
      applied.push({ out: outgoing, in: incoming, sellPrice: out });
    }

    const used = applied.length;
    const paidFor = Math.max(0, used - free);
    const hits = paidFor * HIT_COST;
    free = Math.max(0, free - used);
    totalHits += hits;

    perWeek[gw] = { transfers: applied, used, free, hits, bank };

    /* LINEUP, WITH TRANSFERRED PLAYERS SUBSTITUTED IN.
     *
     * A stored lineup is a list of player ids. Once a transfer happens, that list still names the
     * player who left, and the player who arrived is absent from it. Applied literally, the new
     * player keeps whatever slot he inherited while everyone else is renumbered from the list, so
     * two players end up on the same slot and the eleven silently stops being eleven. That is what
     * produced squads that could not be made legal and substitutes that could not be brought on.
     *
     * Substituting each outgoing id for the incoming one keeps the list describing the squad that
     * actually exists. */
    if (week.lineup?.length) {
      const replaced = new Map(applied.map((move) => [move.out.id, move.in.id]));
      const lineup = week.lineup.map((id) => replaced.get(id) ?? id);

      /* Anyone the list forgets is appended rather than dropped, so the order is always a complete
         description of the fifteen. */
      const known = new Set(lineup);
      for (const member of members) if (!known.has(member.id)) lineup.push(member.id);

      const order = new Map(lineup.map((id, index) => [id, index]));
      members = members
        .map((member) => {
          const index = order.get(member.id);
          return index === undefined
            ? member
            : { ...member, slot: index + 1, starting: index < XI_SIZE };
        })
        .sort((a, b) => a.slot - b.slot);
    }
    if (week.captain) {
      members = members.map((member) => ({ ...member, isCaptain: member.id === week.captain }));
    }
    if (week.vice) {
      members = members.map((member) => ({ ...member, isVice: member.id === week.vice }));
    }
  }

  const current = perWeek[targetGw] || { used: 0, free, hits: 0, transfers: [] };
  return {
    members,
    bank,
    free: current.free,
    hits: current.hits,
    totalHits,
    transfers: current.transfers,
    perWeek,
  };
}
