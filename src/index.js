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
  PermissionFlagsBits,
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
function weekCount(userId, wk = weekKey()) { return Number(state.weeks[wk]?.[userId] || 0); }
function addCount(userId, n, wk = weekKey()) {
  if (!state.weeks[wk]) state.weeks[wk] = {};
  state.weeks[wk][userId] = Math.max(0, Number(state.weeks[wk][userId] || 0) + Number(n || 0));
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




async function fetchAuditType(type, maxPages = 20) {
  const out = [];
  let before;
  for (let page = 0; page < maxPages; page++) {
    const logs = await guild.fetchAuditLogs({ type, limit: 100, ...(before ? { before } : {}) }).catch((err) => {
      console.error('AUDIT_FETCH_FAILED', type, err);
      return null;
    });
    if (!logs) break;
    const entries = [...logs.entries.values()];
    if (!entries.length) break;
    out.push(...entries);
    before = entries.at(-1)?.id;
    if (entries.length < 100 || !before) break;
  }
  return out;
}

function overwritePatch(allowBits, denyBits) {
  const patch = {};
  for (const [name, bit] of Object.entries(PermissionFlagsBits)) {
    if ((allowBits & bit) === bit) patch[name] = true;
    else if ((denyBits & bit) === bit) patch[name] = false;
    else patch[name] = null;
  }
  return patch;
}

async function rollbackPrimaryPermissionOverreachOnce() {
  const markerKey = 'fanvue:rollback:primary-permission-overreach-v1';
  if (redis && await redis.get(markerKey) === 'done') {
    console.log('PRIMARY_PERMISSION_ROLLBACK already complete');
    return;
  }
  if (!(await acquireLock('primary-permission-rollback', 300))) return;

  try {
    if (redis && await redis.get(markerKey) === 'done') return;

    const roleReason = 'Primary role hierarchy: inherit lower-role permissions';
    const overwriteReason = 'Primary role hierarchy: inherit lower-role channel access';
    const executorId = client.user.id;

    let rolesRestored = 0;
    let overwritesRestored = 0;
    let overwritesDeleted = 0;
    let conflicts = 0;

    // Restore only role permission bitfields changed by the staff/everyone expansion.
    const roleEntries = (await fetchAuditType(AuditLogEvent.RoleUpdate, 12))
      .filter((e) => e.executor?.id === executorId && String(e.reason || '') === roleReason);

    const roleGroups = new Map();
    for (const e of roleEntries) {
      const roleId = e.target?.id;
      const change = (e.changes || []).find((c) => c.key === 'permissions');
      if (!roleId || !change || change.old == null || change.new == null) continue;
      if (!roleGroups.has(roleId)) roleGroups.set(roleId, []);
      roleGroups.get(roleId).push({ at:e.createdTimestamp, old:BigInt(change.old), new:BigInt(change.new) });
    }

    for (const [roleId, changes] of roleGroups) {
      changes.sort((a,b) => a.at - b.at);
      const baseline = changes[0].old;
      const expectedCurrent = changes.at(-1).new;
      const role = guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
      if (!role || !role.editable) {
        console.warn('PRIMARY_PERMISSION_ROLE_SKIP', roleId, 'missing-or-uneditable');
        conflicts++;
        continue;
      }
      if (role.permissions.bitfield === baseline) continue;
      if (role.permissions.bitfield !== expectedCurrent) {
        console.warn('PRIMARY_PERMISSION_ROLE_CONFLICT', roleId, String(role.permissions.bitfield), String(expectedCurrent));
        conflicts++;
        continue;
      }
      await role.setPermissions(baseline, 'Rollback only Fanvue Invites staff/everyone permission inheritance');
      rolesRestored++;
    }

    // Restore only channel overwrites changed/created by the staff/everyone expansion.
    const [createdEntries, updatedEntries] = await Promise.all([
      fetchAuditType(AuditLogEvent.ChannelOverwriteCreate, 12),
      fetchAuditType(AuditLogEvent.ChannelOverwriteUpdate, 12)
    ]);

    const overwriteEntries = [...createdEntries, ...updatedEntries]
      .filter((e) => e.executor?.id === executorId && String(e.reason || '') === overwriteReason);

    const groups = new Map();
    for (const e of overwriteEntries) {
      const channelId = e.target?.id;
      const roleId = e.extra?.id || (e.changes || []).find((c) => c.key === 'id')?.new;
      if (!channelId || !roleId) continue;
      const key = channelId + ':' + roleId;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    }

    for (const [key, entries] of groups) {
      entries.sort((a,b) => a.createdTimestamp - b.createdTimestamp);
      const [channelId, roleId] = key.split(':');
      const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
      const role = guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
      if (!channel?.permissionOverwrites || !role) {
        console.warn('PRIMARY_OVERWRITE_SKIP', key, 'missing-channel-or-role');
        conflicts++;
        continue;
      }

      const first = entries[0];
      const createdByUs = first.action === AuditLogEvent.ChannelOverwriteCreate;

      let baselineAllow = 0n;
      let baselineDeny = 0n;
      if (!createdByUs) {
        const a = (first.changes || []).find((c) => c.key === 'allow');
        const d = (first.changes || []).find((c) => c.key === 'deny');
        const current = channel.permissionOverwrites.cache.get(roleId);
        baselineAllow = a?.old != null ? BigInt(a.old) : (current?.allow?.bitfield || 0n);
        baselineDeny = d?.old != null ? BigInt(d.old) : (current?.deny?.bitfield || 0n);
      }

      let expectedAllow = createdByUs ? 0n : baselineAllow;
      let expectedDeny = createdByUs ? 0n : baselineDeny;
      for (const e of entries) {
        for (const c of e.changes || []) {
          if (c.key === 'allow' && c.new != null) expectedAllow = BigInt(c.new);
          if (c.key === 'deny' && c.new != null) expectedDeny = BigInt(c.new);
        }
      }

      const current = channel.permissionOverwrites.cache.get(roleId);
      if (createdByUs) {
        if (!current) continue;
        if (current.allow.bitfield !== expectedAllow || current.deny.bitfield !== expectedDeny) {
          console.warn('PRIMARY_OVERWRITE_CONFLICT', key, 'created-overwrite-changed-later');
          conflicts++;
          continue;
        }
        await channel.permissionOverwrites.delete(roleId, 'Rollback only Fanvue Invites staff/everyone permission inheritance');
        overwritesDeleted++;
        continue;
      }

      if (!current) {
        console.warn('PRIMARY_OVERWRITE_CONFLICT', key, 'existing-overwrite-missing');
        conflicts++;
        continue;
      }
      if (current.allow.bitfield !== expectedAllow || current.deny.bitfield !== expectedDeny) {
        console.warn('PRIMARY_OVERWRITE_CONFLICT', key, 'overwrite-changed-later');
        conflicts++;
        continue;
      }

      await channel.permissionOverwrites.edit(
        roleId,
        overwritePatch(baselineAllow, baselineDeny),
        { reason:'Rollback only Fanvue Invites staff/everyone permission inheritance' }
      );
      overwritesRestored++;
    }

    if (redis) await redis.set(markerKey, 'done');
    console.log('PRIMARY_PERMISSION_ROLLBACK_COMPLETE ' + JSON.stringify({
      rolesRestored,
      overwritesRestored,
      overwritesDeleted,
      conflicts
    }));
  } finally {
    await releaseLock('primary-permission-rollback');
  }
}

client.once('clientReady', async () => {
  guild = await client.guilds.fetch(guildId);
  await loadSharedState();
  await removeFiveMinuteTypingRequirement();
  await guild.channels.fetch();
  await guild.roles.fetch();
  await rollbackPrimaryPermissionOverreachOnce();
  invitesChannel = await findChannel(cfg.invitesChannelId, cfg.invitesChannelName);
  landingChannel = await findChannel(cfg.landingChannelId, cfg.landingChannelName);
  memberCountChannel = await guild.channels.fetch(cfg.memberCountChannelId).catch(() => null);
  if (!memberCountChannel) {
    memberCountChannel = [...guild.channels.cache.values()].find((c) =>
      (c.type === 2 || c.type === 13) && /^Members:/i.test(c.name)
    ) || null;
  }
  if (!memberCountChannel) {
    if (!guild.members.me.permissions.has('ManageChannels')) {
      console.warn('Member count channel missing and bot lacks Manage Channels permission.');
    } else {
      memberCountChannel = await guild.channels.create({
        name: desiredMemberCountName(),
        type: 2,
        reason: 'Create Fanvue live member count channel'
      });
      console.log('MEMBER_COUNT_CHANNEL_CREATED ' + memberCountChannel.id + ' ' + memberCountChannel.name);
    }
  }
  if (!invitesChannel || !landingChannel) throw new Error('Could not find #invites and/or #join. Set their IDs in Render environment variables.');
  if (!memberCountChannel) console.warn('Member count voice channel could not be resolved or created.');
  creatorRole = await resolveCreatorRole();
  if (!creatorRole) console.warn('NEW CREATOR role not resolved. Using screening + no-role fallback quality checks.');
  else console.log(`Quality role: ${creatorRole.name} (${creatorRole.id})`);

  await syncInviteCounters({ bootstrap: true });
  await updateLeaderboard(true);
  await qualitySweep();
  await updateMemberCountChannel(true);

  refreshTimer = setInterval(() => syncInviteCounters().catch(console.error), cfg.pollMs);
  refreshTimer.unref();
  qualityTimer = setInterval(() => qualitySweep().catch(console.error), cfg.qualitySweepMs);
  qualityTimer.unref();
  memberCountTimer = setInterval(() => updateMemberCountChannel(false).catch(console.error), 300000);
  memberCountTimer.unref();
  console.log(`READY ${client.user.tag} · ${guild.name} · live sync ${cfg.pollMs/1000}s · quality sweep ${cfg.qualitySweepMs/60000}m · exact member count enabled`);
  setTimeout(() => sweepCreatorRanksOnce().catch(console.error), 5000).unref?.();
});

client.on('guildMemberAdd', (member) => {
  if (member.guild.id !== guildId) return;
  queueMemberCountUpdate();
  joinQueue = joinQueue.then(() => processJoin(member)).catch(console.error);
});

client.on('guildMemberRemove', (member) => {
  if (member.guild.id !== guildId) return;
  queueMemberCountUpdate();
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
