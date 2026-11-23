import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import Redis from 'ioredis';
import {
  ActionRowBuilder,
  AuditLogEvent,
  ButtonBuilder,
  ButtonStyle,
  Client,
  ContainerBuilder,
  GatewayIntentBits,
  MessageFlags,
  PermissionsBitField,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  ThumbnailBuilder,
} from 'discord.js';

const token = process.env.DISCORD_TOKEN?.trim();
const guildId = process.env.GUILD_ID?.trim();
if (!token || !guildId) throw new Error('DISCORD_TOKEN and GUILD_ID are required');

const cfg = {
  roleId: process.env.NEW_CREATOR_ROLE_ID?.trim() || '',
  roleQuery: process.env.NEW_CREATOR_ROLE_QUERY || 'NEW CREATOR',
  qualitySweepMs: Math.max(60000, Number(process.env.QUALITY_SWEEP_MS || 300000)),
  creatorRoleGraceHours: Math.max(1, Number(process.env.CREATOR_ROLE_GRACE_HOURS || 48)),
  invitesChannelId: process.env.INVITES_CHANNEL_ID?.trim() || '',
  invitesChannelName: process.env.INVITES_CHANNEL_NAME || '🎁｜invites',
  landingChannelId: process.env.LANDING_CHANNEL_ID?.trim() || '',
  landingChannelName: process.env.LANDING_CHANNEL_QUERY || 'join',
  memberCountChannelId: process.env.MEMBER_COUNT_CHANNEL_ID?.trim() || '1499031772699299980',
  memberCountMinUpdateMs: Math.max(60000, Number(process.env.MEMBER_COUNT_MIN_UPDATE_MS || 300000)),
  dataDir: path.resolve(process.env.DATA_DIR || './data'),
  port: Number(process.env.PORT || 10000),
  timeZone: process.env.TIME_ZONE || 'Europe/London',
  pollMs: Math.max(5000, Number(process.env.POLL_MS || 5000)),
};

fs.mkdirSync(cfg.dataDir, { recursive: true });
const statePath = path.join(cfg.dataDir, 'state.json');
const redis = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 3 }) : null;
const STATE_KEY = 'fanvue:invite-state:v2';
const INSTANCE_ID = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
const blankState = () => ({ links: {}, weeks: {}, referrals: {}, names: {}, baselines: {}, messageId: null, lastWeek: null });
let state = blankState();
try { state = { ...blankState(), ...JSON.parse(fs.readFileSync(statePath, 'utf8')) }; } catch {}

function normaliseState() {
  state.links ||= {};
  state.weeks ||= {};
  state.referrals ||= {};
  state.names ||= {};
  state.baselines ||= {};
}
normaliseState();

async function loadSharedState() {
  if (!redis) return;
  const raw = await redis.get(STATE_KEY).catch((err) => { console.error('REDIS_LOAD_FAILED', err); return null; });
  if (raw) {
    try { state = { ...blankState(), ...JSON.parse(raw) }; normaliseState(); } catch (err) { console.error('REDIS_STATE_PARSE_FAILED', err); }
  } else {
    await redis.set(STATE_KEY, JSON.stringify(state)).catch((err) => console.error('REDIS_INIT_FAILED', err));
  }
}

async function save() {
  normaliseState();
  try {
    const tmp = `${statePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, statePath);
  } catch (err) { console.error('LOCAL_STATE_SAVE_FAILED', err); }
  if (redis) await redis.set(STATE_KEY, JSON.stringify(state)).catch((err) => console.error('REDIS_SAVE_FAILED', err));
}

async function acquireLock(name, ttlSeconds = 30) {
  if (!redis) return true;
  const result = await redis.set(`fanvue:lock:${name}`, INSTANCE_ID, 'EX', ttlSeconds, 'NX').catch((err) => { console.error('REDIS_LOCK_FAILED', err); return null; });
  return result === 'OK';
}

async function releaseLock(name) {
  if (!redis) return;
  const key = `fanvue:lock:${name}`;
  const script = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
  await redis.eval(script, 1, key, INSTANCE_ID).catch((err) => console.error('REDIS_UNLOCK_FAILED', err));
}

function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function weekKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: cfg.timeZone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short'
  }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const y = Number(get('year')), m = Number(get('month')), d = Number(get('day'));
  const dayMap = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  const local = new Date(Date.UTC(y, m - 1, d));
  local.setUTCDate(local.getUTCDate() - (dayMap[get('weekday')] ?? 0));
  return local.toISOString().slice(0, 10);
}
const CONTEST_START_WEEK = '2026-11-16';

function contestWeekNumber(wk = weekKey()) {
  const start = Date.parse(`${CONTEST_START_WEEK}T00:00:00Z`);
  const current = Date.parse(`${wk}T00:00:00Z`);
  return Math.max(1, Math.floor((current - start) / (7 * 24 * 60 * 60 * 1000)) + 1);
}

function weekCount(userId, wk = weekKey()) { return Number(state.weeks[wk]?.[userId] || 0); }
function addCount(userId, n, wk = weekKey()) {
  if (!state.weeks[wk]) state.weeks[wk] = {};
  state.weeks[wk][userId] = Math.max(0, Number(state.weeks[wk][userId] || 0) + Number(n || 0));
}

function rollingSevenDayCounts(now = Date.now()) {
  const cutoff = Number(now) - (7 * 24 * 60 * 60 * 1000);
  const counts = {};

  // Referral links are valid for 7 days, so any link created inside the
  // rolling window can only contain invite uses from inside that window.
  for (const link of Object.values(state.links || {})) {
    const createdAt = Number(link.createdAt || 0);
    if (!createdAt || createdAt < cutoff || createdAt > Number(now)) continue;
    const uses = Math.max(0, Number(link.lastUses || 0));
    if (!uses) continue;
    counts[link.referrerId] = Number(counts[link.referrerId] || 0) + uses;
  }

  // Remove referrals that the quality system has explicitly revoked.
  for (const r of Object.values(state.referrals || {})) {
    if (r.status !== 'revoked') continue;
    const joinedAt = Number(r.joinedAt || 0);
    if (!joinedAt || joinedAt < cutoff || joinedAt > Number(now)) continue;
    counts[r.referrerId] = Math.max(0, Number(counts[r.referrerId] || 0) - 1);
  }

  return counts;
}

function revokedByReferrer(userId, wk = weekKey()) {
  return Object.values(state.referrals).filter((r) => r.referrerId === userId && r.week === wk && r.status === 'revoked').length;
}

async function rebuildWeeklyCountsFromDiscord(invites = null) {
  const wk = weekKey();
  const allInvites = invites || await guild.invites.fetch({ cache: false });
  state.baselines[wk] ||= {};
  const counts = {};

  for (const [code, link] of Object.entries(state.links)) {
    const invite = allInvites.get(code);
    if (!invite) continue;

    const uses = Number(invite.uses || 0);
    const createdWeek = weekKey(new Date(link.createdAt || Date.now()));

    if (state.baselines[wk][code] == null) {
      state.baselines[wk][code] = createdWeek === wk ? 0 : uses;
    }

    const baseline = Number(state.baselines[wk][code] || 0);
    const weeklyUses = Math.max(0, uses - baseline);
    counts[link.referrerId] = Number(counts[link.referrerId] || 0) + weeklyUses;
    link.lastUses = uses;
  }

  for (const [uid, n] of Object.entries(counts)) {
    counts[uid] = Math.max(0, n - revokedByReferrer(uid, wk));
  }

  state.weeks[wk] = counts;
  return counts;
}

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildInvites] });
let guild, invitesChannel, landingChannel, creatorRole, memberCountChannel;
let syncing = false;
let refreshTimer = null;
let qualityTimer = null;
let memberCountTimer = null;
let memberCountPendingTimer = null;
let lastMemberCountRenameAt = 0;
let joinQueue = Promise.resolve();



const CREATOR_RANK_IDS = [
  '1539309205364805662', // Elite Creator
  '1431000324864348210', // Legendary Creator
  '1430998390690414592', // Diamond Creator
  '1430998282510929930', // Gold Creator
  '1430998244233838763', // Silver Creator
  '1430978118717538346', // New Creator
];

let creatorRankSweepRunning = false;

function memberCreatorRankIds(member) {
  return CREATOR_RANK_IDS.filter((id) => member.roles.cache.has(id));
}

async function normalizeCreatorRanks(member, reason = 'Keep only highest creator rank') {
  if (!member || member.user?.bot) return false;
  const held = memberCreatorRankIds(member);
  if (held.length <= 1) return false;
  const remove = held.slice(1).filter((id) => guild.roles.cache.get(id)?.editable !== false);
  if (!remove.length) return false;
  await member.roles.remove(remove, reason);
  console.log('CREATOR_RANK_NORMALIZED ' + JSON.stringify({ memberId: member.id, kept: held[0], removed: remove }));
  return true;
}

async function sweepCreatorRanksOnce() {
  if (creatorRankSweepRunning) return;
  creatorRankSweepRunning = true;
  try {
    const members = await guild.members.fetch();
    let fixed = 0;
    let failed = 0;
    for (const member of members.values()) {
      try {
        if (await normalizeCreatorRanks(member, 'Creator rank cleanup: keep highest creator rank only')) fixed++;
      } catch (err) {
        failed++;
        console.error('CREATOR_RANK_NORMALIZE_FAILED', member.id, err);
      }
    }
    console.log('CREATOR_RANK_SWEEP_COMPLETE ' + JSON.stringify({ scanned: members.size, fixed, failed }));
  } finally {
    creatorRankSweepRunning = false;
  }
}

async function findChannel(id, name) {
  if (id) return guild.channels.fetch(id).catch(() => null);
  const q = norm(name);
  return [...guild.channels.cache.values()].find((c) => c.isTextBased?.() && norm(c.name) === q) || null;
}


async function configureHangoutChannel() {
  if (!memberCountChannel) return;

  const hangoutName = `🎙️ ${Number(guild?.memberCount || 0).toLocaleString('en-GB')} Members`;

  if (memberCountChannel.parentId) {
    memberCountChannel = await memberCountChannel.setParent(null, {
      lockPermissions: false,
      reason: 'Keep Hangout as standalone top-level voice channel'
    });
  }

  if (memberCountChannel.name !== hangoutName) {
    memberCountChannel = await memberCountChannel.setName(
      hangoutName,
      'Show live member count on public voice channel'
    );
  }

  const general = guild.channels.cache.get('1427337799451021521')
    || [...guild.channels.cache.values()].find((c) => c.name === '💬｜general');

  if (!general) throw new Error('Could not resolve #general for Hangout visibility sync');

  const viewerOverwrites = [...general.permissionOverwrites.cache.values()]
    .filter((o) => o.allow.has(PermissionsBitField.Flags.ViewChannel));

  const permissionEntries = [
    {
      id: guild.roles.everyone.id,
      allow: [PermissionsBitField.Flags.Connect],
      deny: [PermissionsBitField.Flags.ViewChannel],
    },
    ...viewerOverwrites.map((o) => ({
      id: o.id,
      type: o.type,
      allow: [PermissionsBitField.Flags.ViewChannel],
    })),
    {
      id: '1540566862709137440',
      type: 0,
      deny: [PermissionsBitField.Flags.SendMessages],
    },
  ];

  await memberCountChannel.permissionOverwrites.set(
    permissionEntries,
    'Keep Hangout hidden until verification while preserving normal voice access'
  );

  memberCountChannel = await memberCountChannel.setPosition(0, {
    reason: 'Keep Hangout as top standalone voice channel'
  });

  const verifiedChecks = viewerOverwrites.map((o) => {
    const role = guild.roles.cache.get(o.id);
    return role ? {
      id: role.id,
      name: role.name,
      view: memberCountChannel.permissionsFor(role)?.has(PermissionsBitField.Flags.ViewChannel) ?? null,
      connect: memberCountChannel.permissionsFor(role)?.has(PermissionsBitField.Flags.Connect) ?? null
    } : null;
  }).filter(Boolean);

  console.log('HANGOUT_VERIFIED ' + JSON.stringify({
    id: memberCountChannel.id,
    name: memberCountChannel.name,
    parentId: memberCountChannel.parentId,
    position: memberCountChannel.rawPosition ?? memberCountChannel.position,
    everyoneView: memberCountChannel.permissionsFor(guild.roles.everyone)?.has(PermissionsBitField.Flags.ViewChannel) ?? null,
    everyoneConnect: memberCountChannel.permissionsFor(guild.roles.everyone)?.has(PermissionsBitField.Flags.Connect) ?? null,
    verifiedChecks,
    connectedMembers: [...memberCountChannel.members.values()].map((m) => ({ id: m.id, name: m.displayName }))
  }));
}

async function updateVoiceMemberCount(force = false) {
  if (!memberCountChannel) return;

  const freshGuild = await client.guilds.fetch(guildId).catch(() => null);
  if (freshGuild) guild.memberCount = freshGuild.memberCount;

  const wanted = `🎙️ ${Number(guild?.memberCount || 0).toLocaleString('en-GB')} Members`;
  if (memberCountChannel.name === wanted) return;

  const now = Date.now();
  const remaining = cfg.memberCountMinUpdateMs - (now - lastMemberCountRenameAt);

  if (!force && remaining > 0) {
    if (!memberCountPendingTimer) {
      memberCountPendingTimer = setTimeout(() => {
        memberCountPendingTimer = null;
        updateVoiceMemberCount(true).catch((err) => console.error('VOICE_COUNT_UPDATE_FAILED', err));
      }, remaining);
      memberCountPendingTimer.unref?.();
    }
    return;
  }

  memberCountChannel = await memberCountChannel.setName(
    wanted,
    'Keep live member count visible on voice channel'
  );
  lastMemberCountRenameAt = Date.now();
  console.log('VOICE_COUNT_CHANNEL ' + wanted);
}

function queueVoiceMemberCountUpdate() {
  updateVoiceMemberCount(false).catch((err) => console.error('VOICE_COUNT_UPDATE_FAILED', err));
}

async function resolveCreatorRole() {
  await guild.roles.fetch();
  if (cfg.roleId) return guild.roles.cache.get(cfg.roleId) || await guild.roles.fetch(cfg.roleId).catch(() => null);
  const exact = [...guild.roles.cache.values()].filter((r) => !r.managed && norm(r.name) === norm(cfg.roleQuery));
  if (exact.length === 1) return exact[0];
  const wanted = norm(cfg.roleQuery).split(' ').filter(Boolean);
  const fuzzy = [...guild.roles.cache.values()].filter((r) => {
    if (r.managed) return false;
    const name = norm(r.name);
    return wanted.every((w) => name.includes(w));
  });
  return fuzzy.length === 1 ? fuzzy[0] : null;
}

function revokedCount(userId, wk = weekKey()) {
  return Object.values(state.referrals).filter((r) => r.referrerId === userId && r.week === wk && r.status === 'revoked').length;
}

function cleanLeaderboardName(value) {
  return String(value || '').replace(/[\r\n`*_~|>]/g, '').trim().slice(0, 40);
}

async function resolveLeaderboardName(userId) {
  const member = await guild.members.fetch(userId).catch(() => null);
  const user = member?.user || await client.users.fetch(userId).catch(() => null);
  const liveName = cleanLeaderboardName(member?.displayName || user?.globalName || user?.username);
  if (liveName) {
    state.names[userId] = liveName;
    save();
    return liveName;
  }
  return cleanLeaderboardName(state.names[userId]) || ('Creator ' + String(userId).slice(-4));
}

function extractAuditCode(entry) {
  const t = entry?.target;
  if (typeof t?.code === 'string') return t.code;
  if (typeof t?.id === 'string' && !/^\d{15,22}$/.test(t.id)) return t.id;
  for (const c of entry?.changes || []) {
    if (c?.key === 'code' && typeof (c.new ?? c.old) === 'string') return c.new ?? c.old;
  }
  return null;
}

async function recoverMappings(invites) {
  if (!guild.members.me.permissions.has('ViewAuditLog')) return 0;
  const active = new Set([...invites.keys()]);
  let recovered = 0;
  let before;
  for (let page = 0; page < 5; page++) {
    const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.InviteCreate, limit: 100, ...(before ? { before } : {}) }).catch(() => null);
    if (!logs) break;
    const entries = [...logs.entries.values()];
    if (!entries.length) break;
    for (const e of entries) {
      const reason = String(e.reason || '');
      const match = reason.match(/Academy referral link for .*\((\d{15,22})\)\s*$/);
      if (!match) continue;
      const code = extractAuditCode(e);
      if (!code || !active.has(code) || state.links[code]) continue;
      state.links[code] = { referrerId: match[1], createdAt: e.createdTimestamp || Date.now(), lastUses: 0 };
      recovered++;
    }
    before = entries.at(-1)?.id;
    if (entries.length < 100 || !before) break;
  }
  if (recovered) save();
  return recovered;
}

async function leaderboardPayload() {
  const wk = weekKey();
  const weekNo = contestWeekNumber(wk);
  const rows = Object.entries(state.weeks[wk] || {}).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const medals = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];
  const labels = ['1ST', '2ND', '3RD', '4TH', '5TH'];
  const podium = (await Promise.all([0,1,2,3,4].map(async (i) => {
    const row = rows[i];
    if (!row) return `${medals[i]} **${labels[i]}**  →  **0 invites**`;
    const [uid, count] = row;
    const name = await resolveLeaderboardName(uid);
    return `${medals[i]} **${labels[i]}**  **${name}**  ·  **${count} invite${count === 1 ? '' : 's'}**`;
  }))).join('\n');

  const c = new ContainerBuilder().setAccentColor(0x75FB4C);
  const icon = guild.iconURL({ size: 128 });
  if (icon) {
    c.addSectionComponents(new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`# 💚 INVITE & WIN · WEEK ${weekNo}`),
        new TextDisplayBuilder().setContent(`Invite creators to the **Fanvue AI Creator Academy** and climb the live **Week ${weekNo}** leaderboard.`)
      )
      .setThumbnailAccessory(new ThumbnailBuilder().setURL(icon).setDescription('Fanvue AI Creator Academy'))
    );
  } else {
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`# 💚 INVITE & EARN · WEEK ${weekNo}\nInvite creators to the **Fanvue AI Creator Academy** and climb the live **Week ${weekNo}** leaderboard.`));
  }
  c.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  c.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## 🏆 LEADERBOARD\n${podium}`),
    new TextDisplayBuilder().setContent('**🎁 Top inviters win a prize.**'),
  );
  c.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
  c.addActionRowComponents(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ref:get').setLabel('GET MY INVITE LINK').setEmoji('🔗').setStyle(ButtonStyle.Success)
  ));
  c.addActionRowComponents(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ref:stats').setLabel('MY STATS').setEmoji('📊').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ref:rewards').setLabel('REWARDS').setEmoji('🎁').setStyle(ButtonStyle.Secondary)
  ));
  return { flags: MessageFlags.IsComponentsV2, components: [c], allowedMentions: { parse: [] } };
}

async function findLeaderboardMessage() {
  if (state.messageId) {
    const m = await invitesChannel.messages.fetch(state.messageId).catch(() => null);
    if (m) return m;
  }
  const recent = await invitesChannel.messages.fetch({ limit: 100 });
  const candidates = [...recent.values()].filter((m) => m.author.id === client.user.id);
  const found = candidates.find((m) => JSON.stringify(m.components).includes('INVITE & EARN')) || null;
  if (found) { state.messageId = found.id; save(); }
  return found;
}

async function updateLeaderboard(force = false) {
  const wk = weekKey();
  let m = await findLeaderboardMessage();
  if (!m) {
    m = await invitesChannel.send(await leaderboardPayload());
    state.messageId = m.id;
    save();
    return;
  }
  if (force || state.lastWeek !== wk) await m.edit(await leaderboardPayload());
  state.lastWeek = wk;
  save();
}


async function consumeInviteDelta(member) {
  const invites = await guild.invites.fetch({ cache: false });
  await recoverMappings(invites);
  const candidates = [];
  for (const invite of invites.values()) {
    const link = state.links[invite.code];
    if (!link) continue;
    const uses = Number(invite.uses || 0);
    const prev = Number(link.lastUses || 0);
    const delta = uses - prev;
    if (delta > 0) candidates.push({ invite, link, delta });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.delta - a.delta || a.invite.code.localeCompare(b.invite.code));
  const chosen = candidates[0];
  chosen.link.lastUses = Number(chosen.link.lastUses || 0) + 1;
  await save();
  if (candidates.length > 1) console.warn(`Invite attribution ambiguous for ${member.id}; chose ${chosen.invite.code}`);
  return { code: chosen.invite.code, referrerId: chosen.link.referrerId };
}

async function processJoin(member) {
  if (member.guild.id !== guildId) return;
  if (!(await acquireLock(`join:${member.id}`, 120))) return;
  await loadSharedState();
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const used = await consumeInviteDelta(member);
  if (!used) return;

  if (member.user.bot) {
    console.log(`Ignored bot referral ${member.id}`);
    return;
  }
  if (state.referrals[member.id]) {
    console.log(`Ignored repeat/rejoin referral ${member.id}`);
    return;
  }

  const wk = weekKey(new Date(member.joinedTimestamp || Date.now()));
  state.referrals[member.id] = {
    memberId: member.id,
    referrerId: used.referrerId,
    code: used.code,
    joinedAt: member.joinedTimestamp || Date.now(),
    accountCreatedAt: member.user.createdTimestamp || 0,
    week: wk,
    status: 'counted',
    reason: null,
  };
  await save();
  await syncInviteCounters();
  console.log(`COUNTED ${member.id} -> ${used.referrerId}`);
}

async function revokeReferral(memberId, reason) {
  const r = state.referrals[memberId];
  if (!r || r.status !== 'counted') return false;
  r.status = 'revoked';
  r.reason = reason;
  r.revokedAt = Date.now();
  await save();
  await syncInviteCounters();
  console.log(`REVOKED ${memberId} -> ${r.referrerId}: ${reason}`);
  return true;
}

async function qualitySweep() {
  const now = Date.now();
  for (const r of Object.values(state.referrals)) {
    if (r.status !== 'counted') continue;
    const member = await guild.members.fetch(r.memberId).catch(() => null);
    if (!member) {
      await revokeReferral(r.memberId, 'left server');
      continue;
    }
    const ageMs = now - Number(r.joinedAt || now);
    if (ageMs >= 24 * 3600000 && member.pending === true) {
      await revokeReferral(r.memberId, 'still pending server screening after 24h');
      continue;
    }
    if (ageMs >= cfg.creatorRoleGraceHours * 3600000) {
      const hasMeaningfulRole = member.roles.cache.some((role) => role.id !== guild.id && !role.managed);
      if (!hasMeaningfulRole) {
        await revokeReferral(r.memberId, `no qualifying server role after ${cfg.creatorRoleGraceHours}h`);
      }
    }
  }
}

async function syncInviteCounters({ bootstrap = false } = {}) {
  if (syncing) return;
  if (!(await acquireLock('invite-sync', 30))) return;
  syncing = true;
  try {
    await loadSharedState();
    const invites = await guild.invites.fetch({ cache: false });
    if (bootstrap || Object.keys(state.links).length === 0) await recoverMappings(invites);

    const currentWeek = weekKey();
    const previousWeek = state.lastWeek;
    const before = JSON.stringify(state.weeks[currentWeek] || {});
    await rebuildWeeklyCountsFromDiscord(invites);
    const after = JSON.stringify(state.weeks[currentWeek] || {});
    const weekChanged = previousWeek !== currentWeek;
    state.lastWeek = currentWeek;
    await save();

    if (bootstrap || weekChanged || before !== after) {
      console.log('LIVE_WEEK_COUNTS ' + JSON.stringify({ week: currentWeek, weekNo: contestWeekNumber(currentWeek), counts: JSON.parse(after) }));
      await updateLeaderboard(true);
    }
  } finally {
    syncing = false;
    await releaseLock('invite-sync');
  }
}

async function getOrCreateLink(user) {
  const displayName = cleanLeaderboardName(user.globalName || user.username);
  if (displayName) {
    state.names[user.id] = displayName;
    save();
  }
  const invites = await guild.invites.fetch({ cache: false });
  for (const [code, link] of Object.entries(state.links)) {
    if (link.referrerId !== user.id) continue;
    const i = invites.get(code);
    if (i) return i.url;
  }
  const i = await landingChannel.createInvite({ maxAge: 604800, maxUses: 50, unique: true, reason: `Academy referral link for ${user.username} (${user.id})` });
  state.links[i.code] = { referrerId: user.id, createdAt: Date.now(), lastUses: Number(i.uses || 0) };
  save();
  return i.url;
}


async function removeFiveMinuteTypingRequirement() {
  if (guild.verificationLevel === 2) {
    await guild.setVerificationLevel(1, 'Remove 5-minute account-age typing requirement; retain verified-email requirement');
    console.log('VERIFICATION_LEVEL_CHANGED 2 -> 1');
  } else {
    console.log('VERIFICATION_LEVEL_ALREADY ' + guild.verificationLevel);
  }
}





client.once('clientReady', async () => {
  guild = await client.guilds.fetch(guildId);
  await loadSharedState();
  await removeFiveMinuteTypingRequirement();
  await guild.channels.fetch();
  await guild.roles.fetch();
  invitesChannel = await findChannel(cfg.invitesChannelId, cfg.invitesChannelName);
  landingChannel = await findChannel(cfg.landingChannelId, cfg.landingChannelName);
  memberCountChannel = await guild.channels.fetch('1572455999158231260').catch(() => null);
  if (!memberCountChannel) {
    memberCountChannel = [...guild.channels.cache.values()].find((c) =>
      (c.type === 2 || c.type === 13) && (/^🎙️\s[\d,]+(?:\sMembers)?$/.test(c.name) || c.name === '🎙️ // 𝗛𝗔𝗡𝗚𝗢𝗨𝗧' || /^Members:/i.test(c.name))
    ) || null;
  }
  if (!invitesChannel || !landingChannel) throw new Error('Could not find #invites and/or #join. Set their IDs in Render environment variables.');
  if (!memberCountChannel) console.warn('Hangout voice channel could not be resolved.');
  else {
    await configureHangoutChannel();
    await updateVoiceMemberCount(true);
  }
  creatorRole = await resolveCreatorRole();
  if (!creatorRole) console.warn('NEW CREATOR role not resolved. Using screening + no-role fallback quality checks.');
  else console.log(`Quality role: ${creatorRole.name} (${creatorRole.id})`);

  await syncInviteCounters({ bootstrap: true });
  await updateLeaderboard(true);
  await qualitySweep();

  refreshTimer = setInterval(() => syncInviteCounters().catch(console.error), cfg.pollMs);
  refreshTimer.unref();
  qualityTimer = setInterval(() => qualitySweep().catch(console.error), cfg.qualitySweepMs);
  qualityTimer.unref();
  memberCountTimer = setInterval(() => updateVoiceMemberCount(false).catch(console.error), 300000);
  memberCountTimer.unref();
  console.log(`READY ${client.user.tag} · ${guild.name} · live sync ${cfg.pollMs/1000}s · quality sweep ${cfg.qualitySweepMs/60000}m · live voice member count enabled`);
  setTimeout(() => sweepCreatorRanksOnce().catch(console.error), 5000).unref?.();
});

client.on('guildMemberAdd', (member) => {
  if (member.guild.id !== guildId) return;
  queueVoiceMemberCountUpdate();
  joinQueue = joinQueue.then(() => processJoin(member)).catch(console.error);
});

client.on('guildMemberRemove', (member) => {
  if (member.guild.id !== guildId) return;
  queueVoiceMemberCountUpdate();
  revokeReferral(member.id, 'left server').catch(console.error);
});


client.on('guildMemberUpdate', (oldMember, newMember) => {
  if (newMember.guild.id !== guildId) return;
  const before = memberCreatorRankIds(oldMember).join(',');
  const after = memberCreatorRankIds(newMember).join(',');
  if (before === after || memberCreatorRankIds(newMember).length <= 1) return;
  normalizeCreatorRanks(newMember).catch((err) => console.error('CREATOR_RANK_NORMALIZE_FAILED', newMember.id, err));
});

client.on('interactionCreate', async (i) => {
  if (!i.isButton() || i.guildId !== guildId || !i.customId.startsWith('ref:')) return;
  if (!(await acquireLock(`interaction:${i.id}`, 60))) return;
  await loadSharedState();
  try {
    if (cfg.roleId) {
      const member = await guild.members.fetch(i.user.id).catch(() => null);
      const eligibleRoleIds = new Set([
        ...CREATOR_RANK_IDS,
        '1539578951364775956',
        '1427337798129680523',
        '1447969609176318042',
        '1534133542647500861'
      ]);
      const eligible = member && member.roles.cache.some((role) => eligibleRoleIds.has(role.id));
      if (!eligible) {
        await i.reply({ content: 'This invite programme is available to Academy creators.', ephemeral: true });
        return;
      }
    }
    if (i.customId === 'ref:get') {
      await i.deferReply({ ephemeral: true });
      const url = await getOrCreateLink(i.user);
      const n = weekCount(i.user.id);
      await i.editReply(`🔗 **Your personal Academy invite**\n${url}\n\n**This week:** ${n} invite${n === 1 ? '' : 's'}`);
      return;
    }
    if (i.customId === 'ref:stats') {
      await i.deferReply({ ephemeral: true });
      await syncInviteCounters();
      const n = weekCount(i.user.id);
      const revoked = revokedCount(i.user.id);
      await i.editReply(`📊 **Your stats**\nThis week: **${n} invite${n === 1 ? '' : 's'}**\nAuto-revoked this week: **${revoked}**\nResets Monday at 00:00 UK.`);
      return;
    }
    if (i.customId === 'ref:rewards') {
      await i.reply({ content: '🎁 **Rewards coming soon.**\nInvites count immediately, with low-quality referrals automatically removable.', ephemeral: true });
    }
  } catch (err) {
    console.error(err);
    const msg = 'Something went wrong. Staff can check the bot logs.';
    if (i.deferred || i.replied) await i.editReply(msg).catch(() => {}); else await i.reply({ content: msg, ephemeral: true }).catch(() => {});
  }
});

http.createServer((req, res) => {
  if (req.url === '/healthz') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, discord: client.isReady(), role: creatorRole?.id || null })); return; }
  res.writeHead(404); res.end('not found');
}).listen(cfg.port, '0.0.0.0', () => console.log(`health :${cfg.port}/healthz`));

process.on('SIGTERM', () => { save(); client.destroy(); process.exit(0); });
process.on('SIGINT', () => { save(); client.destroy(); process.exit(0); });
client.login(token);
