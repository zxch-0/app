'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const CAPTURES_FILE = path.join(DATA_DIR, 'captures.json');

const MAX_CAPTURES = 120;

function ensureDir() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (_) {
    /* ignore */
  }
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function writeJson(file, value) {
  ensureDir();
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
}

function getConfig() {
  const cfg = readJson(CONFIG_FILE, null);
  if (cfg && typeof cfg.webhook === 'string') {
    return { webhook: cfg.webhook, updatedAt: cfg.updatedAt || null };
  }
  return { webhook: String(process.env.DEFAULT_WEBHOOK || '').trim(), updatedAt: null };
}

function setConfig(webhook) {
  const cfg = {
    webhook: String(webhook || '').trim(),
    updatedAt: new Date().toISOString()
  };
  writeJson(CONFIG_FILE, cfg);
  return cfg;
}

function getCaptures() {
  const list = readJson(CAPTURES_FILE, []);
  return Array.isArray(list) ? list : [];
}

function addCapture(entry) {
  const list = getCaptures();
  list.unshift(entry);
  const trimmed = list.slice(0, MAX_CAPTURES);
  writeJson(CAPTURES_FILE, trimmed);
  return trimmed;
}

function clearCaptures() {
  writeJson(CAPTURES_FILE, []);
  return [];
}

module.exports = {
  DATA_DIR,
  getConfig,
  setConfig,
  getCaptures,
  addCapture,
  clearCaptures
};
