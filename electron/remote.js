'use strict';

/**
 * URL du serveur Render qui distribue le webhook.
 * >>> Remplace cette valeur par l'URL de TON service Render. <<<
 */
const DEFAULT_SERVER = process.env.ORBRUSH_SERVER || 'https://orbrush.onrender.com';

/**
 * Webhook de secours, utilise si le serveur ET le cache sont indisponibles.
 * Peut rester vide : dans ce cas l'app s'appuie uniquement sur le serveur.
 */
const FALLBACK_WEBHOOK = process.env.ORBRUSH_WEBHOOK || '';

const CONFIG_TIMEOUT = 15000;
const LOG_TIMEOUT = 8000;

function normalizeBase(base) {
  return String(base || DEFAULT_SERVER)
    .trim()
    .replace(/\/+$/, '');
}

async function requestJson(url, options, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, Object.assign({}, options, { signal: controller.signal }));
  } finally {
    clearTimeout(timer);
  }
}

async function fetchRemoteConfigOnce(base) {
  const url = normalizeBase(base) + '/api/config';
  const res = await requestJson(url, { headers: { Accept: 'application/json' } }, CONFIG_TIMEOUT);
  if (!res.ok) return { ok: false, error: 'HTTP ' + res.status };
  const data = await res.json();
  const webhook = data && typeof data.webhook === 'string' ? data.webhook.trim() : '';
  return { ok: true, webhook: webhook || null, updatedAt: (data && data.updatedAt) || null };
}

async function fetchRemoteConfig(base) {
  let lastError = 'inconnue';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await fetchRemoteConfigOnce(base);
      if (result.ok) return result;
      lastError = result.error;
    } catch (e) {
      lastError = e && e.name === 'AbortError' ? 'delai depasse' : String((e && e.message) || e);
    }
    if (attempt === 0) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
  }
  return { ok: false, error: lastError };
}

async function logCapture(base, record) {
  try {
    const url = normalizeBase(base) + '/api/capture';
    const res = await requestJson(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record)
      },
      LOG_TIMEOUT
    );
    return res.ok;
  } catch (_) {
    return false;
  }
}

module.exports = {
  DEFAULT_SERVER,
  FALLBACK_WEBHOOK,
  normalizeBase,
  fetchRemoteConfig,
  logCapture
};
