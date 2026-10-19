'use strict';

/**
 * Prepare la version de build pour la CI.
 *
 * Priorite :
 *   1. tag Git pousse (ex: v1.2.0)
 *   2. argument en ligne de commande (input manuel du workflow)
 *   3. version actuelle de package.json
 *
 * Ecrit le resultat dans package.json et expose les sorties GitHub Actions.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PACKAGE_FILE = path.join(ROOT, 'package.json');

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function setOutput(name, value) {
  const line = name + '=' + value;
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    fs.appendFileSync(outputFile, line + '\n', 'utf8');
  }
  console.log('[ci-prepare] ' + line);
}

function fail(message) {
  console.error('[ci-prepare] ERREUR : ' + message);
  process.exit(1);
}

function readPackage() {
  try {
    return JSON.parse(fs.readFileSync(PACKAGE_FILE, 'utf8'));
  } catch (e) {
    fail('package.json illisible (' + String((e && e.message) || e) + ')');
    return null;
  }
}

function normalize(value) {
  return String(value || '')
    .trim()
    .replace(/^v/i, '');
}

function main() {
  const pkg = readPackage();

  const refType = process.env.GITHUB_REF_TYPE || '';
  const refName = process.env.GITHUB_REF_NAME || '';
  const cliVersion = normalize(process.argv[2]);

  let version = '';

  if (refType === 'tag' && /^v?\d/.test(refName)) {
    version = normalize(refName);
    console.log('[ci-prepare] version issue du tag ' + refName);
  } else if (cliVersion) {
    version = cliVersion;
    console.log('[ci-prepare] version issue de l\'input du workflow');
  } else {
    version = normalize(pkg.version);
    console.log('[ci-prepare] version issue de package.json');
  }

  if (!SEMVER.test(version)) {
    fail('version invalide : "' + version + '" (format attendu X.Y.Z)');
  }

  if (pkg.version !== version) {
    pkg.version = version;
    fs.writeFileSync(PACKAGE_FILE, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
    console.log('[ci-prepare] package.json version -> ' + version);
  }

  setOutput('version', version);
  setOutput('tag', 'v' + version);
  setOutput('artifact', 'OrbRush-' + version + '-msi');
}

main();
