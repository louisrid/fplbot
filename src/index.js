import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {
  ActionRowBuilder,
  AuditLogEvent,
  ButtonBuilder,
  ButtonStyle,
  Client,
  ContainerBuilder,
  GatewayIntentBits,
  MessageFlags,
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
  minAccountAgeHours: Math.max(0, Number(process.env.MIN_ACCOUNT_AGE_HOURS || 24)),
  creatorRoleGraceHours: Math.max(1, Number(process.env.CREATOR_ROLE_GRACE_HOURS || 48)),
  invitesChannelId: process.env.INVITES_CHANNEL_ID?.trim() || '',
  invitesChannelName: process.env.INVITES_CHANNEL_NAME || '🎁｜invites',
  landingChannelId: process.env.LANDING_CHANNEL_ID?.trim() || '',
  landingChannelName: process.env.LANDING_CHANNEL_QUERY || 'join',
  dataDir: path.resolve(process.env.DATA_DIR || './data'),
  port: Number(process.env.PORT || 10000),
  timeZone: process.env.TIME_ZONE || 'Europe/London',
  pollMs: Math.max(5000, Number(process.env.POLL_MS || 15000)),
};

fs.mkdirSync(cfg.dataDir, { recursive: true });
const statePath = path.join(cfg.dataDir, 'state.json');
const blankState = () => ({ links: {}, weeks: {}, referrals: {}, messageId: null, lastWeek: null });
let state = blankState();
try { state = { ...blankState(), ...JSON.parse(fs.readFileSync(statePath, 'utf8')) }; } catch {}
state.links ||= {};
state.weeks ||= {};
state.referrals ||= {};
const save = () => {
  const tmp = `${statePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, statePath);
};

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

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildInvites] });
let guild, invitesChannel, landingChannel, creatorRole;
let syncing = false;
let refreshTimer = null;
let qualityTimer = null;
let joinQueue = Promise.resolve();

async function findChannel(id, name) {
  if (id) return guild.channels.fetch(id).catch(() => null);
  const q = norm(name);
  return [...guild.channels.cache.values()].find((c) => c.isTextBased?.() && norm(c.name) === q) || null;
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

function leaderboardPayload() {
  const wk = weekKey();
  const rows = Object.entries(state.weeks[wk] || {}).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const medals = ['🥇', '🥈', '🥉'];
  const labels = ['1ST', '2ND', '3RD'];
  const podium = [0,1,2].map((i) => {
    const row = rows[i];
    if (!row) return `${medals[i]} **${labels[i]}**  →  **0 invites**`;
    const [uid, count] = row;
    return `${medals[i]} **${labels[i]}**  <@${uid}>  ·  **${count} invite${count === 1 ? '' : 's'}**`;
  }).join('\n');

  const c = new ContainerBuilder().setAccentColor(0x75FB4C);
  const icon = guild.iconURL({ size: 128 });
  if (icon) {
    c.addSectionComponents(new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent('# 💚 INVITE & EARN'),
        new TextDisplayBuilder().setContent('Invite creators to the **Fanvue AI Creator Academy** and climb the live weekly leaderboard.')
      )
      .setThumbnailAccessory(new ThumbnailBuilder().setURL(icon).setDescription('Fanvue AI Creator Academy'))
    );
  } else {
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent('# 💚 INVITE & EARN\nInvite creators to the **Fanvue AI Creator Academy** and climb the live weekly leaderboard.'));
  }
  c.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  c.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## 🏆 THIS WEEK\n${podium}`),
    new TextDisplayBuilder().setContent('*Counts immediately · low-quality or departed referrals can be auto-revoked · resets Monday 00:00 UK*')
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
    m = await invitesChannel.send(leaderboardPayload());
    state.messageId = m.id;
    save();
    return;
  }
  if (force || state.lastWeek !== wk) await m.edit(leaderboardPayload());
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
  save();
  if (candidates.length > 1) console.warn(`Invite attribution ambiguous for ${member.id}; chose ${chosen.invite.code}`);
  return { code: chosen.invite.code, referrerId: chosen.link.referrerId };
}

async function processJoin(member) {
  if (member.guild.id !== guildId) return;
  await new Promise((resolve) => setTimeout(resolve, 1400));
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
  addCount(used.referrerId, 1, wk);
  save();
  await updateLeaderboard(true);
  console.log(`COUNTED ${member.id} -> ${used.referrerId}`);
}

async function revokeReferral(memberId, reason) {
  const r = state.referrals[memberId];
  if (!r || r.status !== 'counted') return false;
  r.status = 'revoked';
  r.reason = reason;
  r.revokedAt = Date.now();
  addCount(r.referrerId, -1, r.week);
  save();
  await updateLeaderboard(true);
  console.log(`REVOKED ${memberId} -> ${r.referrerId}: ${reason}`);
  return true;
}

async function qualitySweep() {
  const now = Date.now();
  for (const r of Object.values(state.referrals)) {
    if (r.status !== 'counted') continue;
    const accountAgeAtJoin = Number(r.joinedAt || 0) - Number(r.accountCreatedAt || 0);
    if (r.accountCreatedAt && accountAgeAtJoin < cfg.minAccountAgeHours * 3600000) {
      await revokeReferral(r.memberId, `account younger than ${cfg.minAccountAgeHours}h at join`);
      continue;
    }
    const member = await guild.members.fetch(r.memberId).catch(() => null);
    if (!member) {
      await revokeReferral(r.memberId, 'left server');
      continue;
    }
    if (creatorRole && now - Number(r.joinedAt || now) >= cfg.creatorRoleGraceHours * 3600000 && !member.roles.cache.has(creatorRole.id)) {
      await revokeReferral(r.memberId, `no NEW CREATOR role after ${cfg.creatorRoleGraceHours}h`);
    }
  }
}

async function syncInviteCounters({ bootstrap = false } = {}) {
  if (syncing) return;
  syncing = true;
  try {
    const invites = await guild.invites.fetch({ cache: false });
    await recoverMappings(invites);
    const wk = weekKey();
    let changed = false;

    if (state.lastWeek && state.lastWeek !== wk) changed = true;

    for (const invite of invites.values()) {
      const link = state.links[invite.code];
      if (!link) continue;
      const uses = Number(invite.uses || 0);
      const createdWeek = weekKey(new Date(link.createdAt || Date.now()));
      const prev = Number(link.lastUses || 0);

      if (bootstrap && prev === 0 && uses > 0 && createdWeek === wk) {
        addCount(link.referrerId, uses, wk);
        changed = true;
      } else if (uses > prev) {
        addCount(link.referrerId, uses - prev, wk);
        changed = true;
      }
      link.lastUses = uses;
    }

    state.lastWeek = wk;
    save();
    if (changed) await updateLeaderboard(true);
  } finally { syncing = false; }
}

async function getOrCreateLink(user) {
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

client.once('clientReady', async () => {
  guild = await client.guilds.fetch(guildId);
  await guild.channels.fetch();
  invitesChannel = await findChannel(cfg.invitesChannelId, cfg.invitesChannelName);
  landingChannel = await findChannel(cfg.landingChannelId, cfg.landingChannelName);
  if (!invitesChannel || !landingChannel) throw new Error('Could not find #invites and/or #join. Set their IDs in Render environment variables.');
  creatorRole = await resolveCreatorRole();
  if (!creatorRole) console.warn('NEW CREATOR role not resolved. 48h role-based quality revocation is disabled until it is found.');
  else console.log(`Quality role: ${creatorRole.name} (${creatorRole.id})`);

  await syncInviteCounters({ bootstrap: true });
  await updateLeaderboard(true);
  await qualitySweep();

  refreshTimer = setInterval(() => syncInviteCounters().catch(console.error), cfg.pollMs);
  refreshTimer.unref();
  qualityTimer = setInterval(() => qualitySweep().catch(console.error), cfg.qualitySweepMs);
  qualityTimer.unref();
  console.log(`READY ${client.user.tag} · ${guild.name} · live sync ${cfg.pollMs/1000}s · quality sweep ${cfg.qualitySweepMs/60000}m`);
});

client.on('guildMemberAdd', (member) => {
  if (member.guild.id !== guildId) return;
  joinQueue = joinQueue.then(() => processJoin(member)).catch(console.error);
});

client.on('guildMemberRemove', (member) => {
  if (member.guild.id !== guildId) return;
  revokeReferral(member.id, 'left server').catch(console.error);
});

client.on('interactionCreate', async (i) => {
  if (!i.isButton() || i.guildId !== guildId || !i.customId.startsWith('ref:')) return;
  try {
    if (cfg.roleId && !i.member?.roles?.cache?.has(cfg.roleId)) {
      await i.reply({ content: 'This invite programme is available to Academy creators.', ephemeral: true });
      return;
    }
    if (i.customId === 'ref:get') {
      await i.deferReply({ ephemeral: true });
      const url = await getOrCreateLink(i.user);
      const n = weekCount(i.user.id);
      await i.editReply(`🔗 **Your personal Academy invite**\n${url}\n\n**This week:** ${n} invite${n === 1 ? '' : 's'}`);
      return;
    }
    if (i.customId === 'ref:stats') {
      await syncInviteCounters();
      const n = weekCount(i.user.id);
      const revoked = revokedCount(i.user.id);
      await i.reply({ content: `📊 **Your stats**\nThis week: **${n} invite${n === 1 ? '' : 's'}**\nAuto-revoked this week: **${revoked}**\nResets Monday at 00:00 UK.`, ephemeral: true });
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
