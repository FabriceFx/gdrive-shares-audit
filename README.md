# Audit des partages Google Drive

Outil qui donne à **chaque utilisateur** une vision **macroscopique puis détaillée**
de tous ses partages Google Drive — partie **Mon Drive** et partie **Drives
partagés** — avec, à chaque fois, le **niveau de partage** et le **droit accordé**.

*[English version below](#english)*

Il produit un rapport HTML autonome (à ouvrir dans un navigateur, aucune donnée
n'est envoyée nulle part) plus deux exports CSV pour retraitement.

## Deux versions, le même rapport

| | **Apps Script** (`apps-script/`) | **Python** (ce dossier) |
|---|---|---|
| Pour qui | tous vos utilisateurs | vous, l'équipe IT/sécurité |
| Déploiement | une application web, **une URL à partager** | un dossier à distribuer, Python à installer |
| Côté utilisateur | ouvrir un lien, autoriser | terminal, `credentials.json`, `pip install` |
| Sorties | tableau de bord + export vers Google Sheets | tableau de bord + CSV + JSON + résumé terminal |
| Audit d'un tiers | non (chacun voit son Drive) | oui, via compte de service délégué |

La version Apps Script permet en outre de **relancer une analyse depuis le rapport**
(même périmètre, ou nouveau choix) ; le rapport fichier de la version Python est figé au
moment de sa génération — pour le rafraîchir, on relance la commande.

**Si vous êtes administrateur Workspace, commencez par la version Apps Script :**
voir [`apps-script/README.md`](apps-script/README.md).

## 1. Installation

```bash
cd gdrive-shares-audit
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

Voir le rendu immédiatement, sans connecter de compte (données fictives) :

```bash
python3 audit_drive.py --demo --open
```

## 2. Accès à l'API Drive (une seule fois)

Sur [console.cloud.google.com](https://console.cloud.google.com) :

1. Créer ou choisir un projet, puis activer **Google Drive API**.
2. **Écran de consentement OAuth** : type *Interne* (Google Workspace) ou *Externe*
   en ajoutant votre adresse comme testeur.
3. **Identifiants > Créer des identifiants > ID client OAuth > Application de bureau**.
4. Télécharger le JSON et l'enregistrer à côté du script sous `credentials.json`.

Le premier lancement ouvre le navigateur pour le consentement ; le jeton est mis en
cache dans `token.json` (créé en `0600`, révocable depuis myaccount.google.com >
Sécurité).

## 3. Utilisation

```bash
python3 audit_drive.py --open                 # Mon Drive + tous les Drives partagés
python3 audit_drive.py --scope mydrive        # Mon Drive uniquement
python3 audit_drive.py --scope shared         # Drives partagés uniquement
python3 audit_drive.py --list-targets         # lister dossiers et Drives disponibles
python3 audit_drive.py --folders "Contrats,RH"          # seulement ces dossiers, sous-dossiers inclus
python3 audit_drive.py --drives "Direction" --scope shared
python3 audit_drive.py --folders Contrats --drives none # un dossier, aucun Drive partagé
python3 audit_drive.py --to-sheets            # + un classeur Google Sheets dans votre Drive
python3 audit_drive.py --metadata-only        # portée minimale (voir §7)
python3 audit_drive.py --max-files 2000       # échantillon rapide sur un très gros Drive
python3 audit_drive.py --sa-key sa.json --impersonate agent@societe.fr
```

| Option | Effet |
|---|---|
| `--scope all\|mydrive\|shared` | périmètre analysé (défaut : `all`) |
| `--include-shared-with-me` | ajoute les éléments que d'autres partagent avec vous |
| `--folders A,B` | n'analyser que ces dossiers de Mon Drive (noms ou ID), **sous-dossiers inclus** |
| `--drives A,B` | n'analyser que ces Drives partagés (`none` pour aucun) |
| `--list-targets` | lister les dossiers et Drives disponibles, puis quitter |
| `--to-sheets` | créer aussi un classeur Google Sheets (3 feuilles) dans votre Drive |
| `--internal-domains A,B` | domaines secondaires de votre organisation, traités comme internes |
| `--partner-domains A,B` | liste blanche : domaines extérieurs approuvés (fichier accepté) |
| `--metadata-only` | portée OAuth minimale, Mon Drive uniquement (§7) |
| `--max-files N` | plafonne le nombre d'éléments (rapport marqué « partiel ») |
| `--out DIR` | dossier de sortie (défaut : `./rapports`) |
| `--workers N` | appels permissions en parallèle (défaut : 8) |
| `--open` | ouvre le rapport à la fin |
| `--demo` | rapport de démonstration sur données fictives |

### Choisir le périmètre

Sur un gros Drive, tout analyser prend plusieurs minutes alors qu'on ne veut souvent
qu'un dossier. `--list-targets` affiche les dossiers de premier niveau de Mon Drive et
les Drives partagés accessibles ; `--folders` et `--drives` acceptent ensuite leurs noms
ou leurs identifiants. Un dossier sélectionné est parcouru **récursivement** et compte
lui-même comme élément analysé. Un élément atteint par deux chemins n'est compté qu'une
fois. La version Apps Script propose la même chose via un écran de sélection avant le
balayage.

### Export vers Google Sheets

`--to-sheets` crée, en plus des fichiers locaux, un classeur dans votre Drive :

| Feuille | Contenu |
|---|---|
| **Synthèse** | compte, périmètre, les 6 indicateurs, répartition par exposition, domaines et comptes externes, Drives partagés |
| **Éléments** | une ligne par élément, en-tête figée et filtres actifs |
| **Permissions** | une ligne par droit accordé |

Deux prérequis : activer **Google Sheets API** dans le même projet Cloud, et accepter
la portée supplémentaire `drive.file` — qui ne donne accès **qu'aux fichiers créés par
l'outil**, jamais au reste de votre Drive. Le jeton est stocké séparément
(`token-sheets.json`) pour que l'audit sans export reste en lecture seule stricte.

Les valeurs sont écrites en mode `RAW` : aucune cellule n'est interprétée comme une
formule, donc un fichier nommé `=HYPERLINK(...)` reste du texte.

Dans la version Apps Script, le même classeur s'obtient d'un clic sur
**Exporter vers Google Sheets**, au bas du rapport.

## 4. Ce que vous obtenez

`rapports/audit-AAAAMMJJ-HHMMSS/` contient :

| Fichier | Contenu |
|---|---|
| `rapport.html` | le rapport complet, autonome et ouvrable hors ligne |
| `fichiers.csv` | une ligne par élément : exposition, bénéficiaires, rôles, score, chemin |
| `permissions.csv` | une ligne par **droit** : bénéficiaire, type, rôle, hérité ou non, expiration |
| `audit.json` | données brutes, pour scripter une remédiation |

Le rapport s'organise du plus large au plus fin : conclusion en une phrase →
6 indicateurs → répartition par niveau d'exposition (cliquable) → droits accordés
et domaines externes → comptes externes → Drives partagés → dossiers exposés →
détail fichier par fichier avec recherche, filtres, tri, permissions dépliables et
export CSV de la sélection.

### Accès aux applications Google

En haut à droite du rapport, un **damier** ouvre un menu vers Drive (Mon Drive, Partagés
avec moi, Drives partagés), Gmail, Agenda, Meet, Docs, Sheets, Slides, Groupes, Contacts,
Mon compte, ainsi que la console d'administration et ses journaux Drive. Chaque lien
s'ouvre dans un nouvel onglet.

Ce n'est pas la barre Google : ce composant est propriétaire et ne peut pas être intégré
dans l'iframe d'une application Apps Script. C'est un menu de liens équivalent, qui reprend
le geste habituel sans prétendre être l'original.

### Passer du constat à la correction

L'API Drive n'expose **aucune URL ouvrant directement la boîte de dialogue de partage** :
le rapport amène donc au bon endroit en un clic, il ne peut pas déclencher l'écran lui-même.
Trois raccourcis, selon ce que vous voulez corriger :

| Où | Lien | Ce qu'il ouvre |
|---|---|---|
| Détail, **le nom de l'élément** | *nom ↗* | la fiche du fichier ou du dossier dans Drive — bouton *Partager* à un clic |
| Tableau des **Drives partagés** | le nom du Drive | le Drive, dont l'onglet *Gérer les membres* |
| Tableau des **Comptes externes** | *voir les N éléments ↓* | filtre le détail sur ce destinataire, d'où chaque fichier s'ouvre dans Drive |
| Graphique des **domaines externes** | la barre du domaine | même chose, pour tout un domaine |

Le lien est porté par le **nom**, à gauche de la ligne : en bout de table il tombait hors
écran sur un portable 14 pouces, où il fallait défiler horizontalement pour l'atteindre.
Le tableau de détail tient désormais dans 1 200 px sans défilement.

Pour traiter un destinataire d'un coup, le filtrage se fait **dans le rapport** : un clic sur
« voir les N éléments » réduit le tableau de détail aux fichiers concernés, d'où chaque ligne
s'ouvre dans Drive et d'où l'export CSV ou Google Sheets reprend exactement cette sélection.

Une première version renvoyait vers la recherche Drive `to:destinataire` ; **cet opérateur
n'est pas honoré par l'interface Drive**, le lien a donc été remplacé par ce filtrage
interne, qui ne dépend d'aucun comportement de l'interface Google.

L'outil ne **modifie** jamais un partage : sa portée OAuth est en lecture seule, et le
rester est délibéré — un audit qui peut écrire est un audit qu'on hésite à déployer.

## 5. Les niveaux d'exposition

Chaque élément est classé au niveau **le plus ouvert** parmi ses permissions.

| Niveau | Signification |
|---|---|
| 🌐 Public sur le web | `anyone` + trouvable : accessible et indexable par les moteurs |
| 🔗 Lien public | `anyone` : accessible sans authentification à qui a l'URL |
| 🏢 Domaine externe | tout le domaine d'une **autre** organisation |
| 🤝 Partenaire référencé | destinataire extérieur figurant dans votre liste blanche |
| 👤 Externe | comptes ou groupes hors de votre organisation |
| 🏛️ Organisation trouvable | tout votre domaine, avec recherche |
| 🏛️ Organisation via lien | tout votre domaine, avec l'URL |
| 👥 Interne | partage nominatif avec des collègues |
| 🔒 Privé | vous seul (ou les seuls membres du Drive partagé) |

### Liste blanche des partenaires

Un client ou un prestataire avec qui vous travaillez depuis des années n'est pas une
alerte. Déclarez ces domaines et leurs accès deviennent **« Partenaire référencé »** :

```bash
python3 audit_drive.py --partner-domains domaines-partenaires.txt
```

Ils **restent externes** — ils apparaissent dans l'inventaire des destinataires extérieurs,
marqués 🤝 — mais sortent des indicateurs « Partagés hors de l'organisation » et « Droits
d'écriture externes », qui ne signalent alors plus que **l'inattendu**. Un indicateur
« Vers des partenaires référencés » rappelle le volume approuvé. Le fichier
[`domaines-partenaires.txt`](domaines-partenaires.txt) sert de modèle.

À ne pas confondre avec `--internal-domains`, qui liste **vos** domaines : un domaine
présent dans les deux est traité comme interne.

Dans la version Apps Script, la liste est **modifiable depuis le rapport** par les
administrateurs déclarés dans `PARTNER_ADMINS` : la modification s'applique à tous les
utilisateurs sans republier, et relance l'analyse pour reclasser les partages. Voir
[`apps-script/README.md`](apps-script/README.md).

**Domaines secondaires — à déclarer.** Ce qui est « interne » se déduit du domaine de
votre adresse. Si votre organisation a des **domaines secondaires ou des alias**
(console d'administration > Compte > Domaines > Gérer les domaines), déclarez-les,
sinon vos collègues qui y sont hébergés apparaîtront à tort comme des destinataires
externes :

```bash
python3 audit_drive.py --internal-domains "autre-domaine.fr,marque-secondaire.com"
```

L'outil signale d'ailleurs le cas : s'il ne connaît qu'un seul domaine interne, il vous
rappelle de vérifier. Les domaines déclarés sont rappelés en tête du rapport, pour que
le lecteur sache sur quelle base la distinction interne/externe a été faite. Dans la
version Apps Script, l'administrateur les déclare **une fois pour tous les utilisateurs**.

**Compte personnel (`@gmail.com`)** : la notion d'organisation n'existe pas ;
l'outil le détecte et compte alors **toute autre personne comme externe**.

**Score de risque (0–100)** : niveau d'exposition, aggravé par les droits en
écriture accordés à l'extérieur, le nombre de destinataires externes, l'effet de
propagation des dossiers et l'absence d'expiration sur un lien public.

## 6. Mon Drive vs Drives partagés

* **Mon Drive** — vous êtes propriétaire ; chaque partage est un acte explicite,
  hérité des dossiers parents.
* **Drives partagés** — l'accès de base vient de l'**appartenance au Drive** : tous
  les membres voient tout le contenu. L'outil affiche la composition du Drive
  (membres, membres externes, gestionnaires, restrictions), puis distingue les
  droits **hérités** des **partages spécifiques** posés sur un élément — ce sont ces
  derniers qui élargissent réellement l'exposition.

### Drives que vous ne gérez pas

Sur un Drive partagé où vous n'êtes que **lecteur, commentateur ou contributeur**, vous ne
pouvez pas modifier les partages : l'auditer ne vous donne aucune action. Ces Drives sont
donc **ignorés par défaut** (`--include-unmanaged` pour les inclure), et le CLI liste ceux
qu'il écarte avec votre rôle et le nom des gestionnaires à qui s'adresser.

Le critère est la capacité `canManageMembers` déclarée par l'API, pas une déduction : elle
tient compte des réglages d'administration. Si vous choisissez d'inclure ces Drives, le
tableau affiche une colonne **« Votre rôle »** et, au survol, la liste des gestionnaires —
la remédiation passe par eux.

À la différence des Drives d'une autre organisation, ces contenus **restent comptés dans
vos statistiques** : ce sont bien les données de votre organisation, simplement pas votre
périmètre d'action.

### Drives appartenant à une autre organisation

Vous pouvez être membre d'un Drive partagé qui appartient à un client, un partenaire ou
une filiale hors périmètre. Ces contenus **ne sont pas votre exposition** : ce sont leurs
données, leurs membres, leur gouvernance. Les compter dans « Partagés hors de
l'organisation » gonflerait vos chiffres avec un risque qui n'est pas le vôtre, et
noierait les vrais.

L'outil détecte ces Drives — **aucun gestionnaire n'appartient à vos domaines** — et :

* les exclut des indicateurs et de la répartition par exposition ;
* les présente dans un bloc distinct, avec leurs gestionnaires ;
* conserve leurs éléments dans le tableau de détail, marqués « Drive externe » ;
* les décoche par défaut dans l'écran de sélection de la version Apps Script.

Le verdict « externe » exige une **preuve positive** : si les membres du Drive ne sont pas
lisibles, ou si aucun gestionnaire n'est visible, le Drive reste compté comme le vôtre.
Un doute ne doit jamais faire disparaître un partage des statistiques.

**Ce que vos collaborateurs y déposent.** C'est le vrai enjeu de gouvernance : dans un
Drive partagé, le fichier appartient au **Drive**, donc à l'organisation propriétaire. Un
document créé par l'un de vos salariés dans le Drive d'un client sort de votre patrimoine.
Le bloc « Drives appartenant à d'autres organisations » compte donc les éléments dont le
**dernier contributeur** est chez vous, et liste ces contributeurs. La colonne
« Dernier contributeur » figure aussi dans le détail (marquée ↻) et dans les exports.

L'API Drive n'exposant pas le créateur d'un fichier, ce compte repose sur
`lastModifyingUser` : « quelqu'un de chez vous a modifié ce document en dernier », pas
« l'a créé ». C'est un plancher.

**La version Apps Script va plus loin** : elle interroge l'**API Drive Activity**
(service avancé, sans console Cloud) pour obtenir les véritables **créateurs**, et affiche
les deux colonnes — « créés par » et « modifiés par ». Voir
[`apps-script/README.md`](apps-script/README.md).

Ce signal n'existe pas dans la version Python : l'API Drive Activity y exigerait d'être
activée dans votre projet Cloud, ce que le service avancé Apps Script évite. Le CLI reste
sur le dernier contributeur.

## 7. Portée OAuth, confidentialité, limites

**Portée demandée : `drive.readonly` (+ `drive.file` côté Apps Script).**
C'est une contrainte de l'API Google, pas un choix : `drives.list`, seul moyen
d'énumérer les Drives partagés, n'accepte que `drive` ou `drive.readonly`.
`drive.metadata.readonly` échoue avec *« Les autorisations spécifiées ne sont pas
suffisantes pour appeler drive.drives.list »*.

Il faut donc l'énoncer honnêtement : **cette portée donne le droit technique de
lire le contenu des fichiers.** L'outil ne l'exerce jamais — il ne demande à l'API
que des champs de métadonnées et de permissions, et le code est lisible en entier
dans `gdshares/scan.py`. Aucune écriture n'est possible : la portée est en lecture
seule, l'outil ne peut pas modifier un partage.

Si cette portée est inacceptable dans votre contexte, `--metadata-only` bascule sur
`drive.metadata.readonly` : plus aucun droit de lecture du contenu, mais
**les Drives partagés ne sont plus énumérables** et l'audit se limite à Mon Drive.

Autres limites :

* Tout est écrit sur votre machine ; le rapport HTML n'appelle aucune ressource
  externe. Rien n'est transmis à un tiers.
* Les éléments **à la corbeille** sont exclus.
* Un partage n'est visible que si le compte audité a le droit de le voir : sur un
  élément dont vous n'êtes ni propriétaire ni gestionnaire, la liste des
  bénéficiaires peut être incomplète (limite de l'API).
* Sur de très gros volumes, l'API impose des quotas : backoff exponentiel et appels
  parallèles (`--workers`). Comptez quelques minutes pour ~10 000 éléments.
* Les exports CSV neutralisent l'injection de formules (un nom de fichier commençant
  par `=`, `+`, `-` ou `@` est préfixé d'une apostrophe).
* Le graphique d'exposition emploie la palette d'état ; chaque barre porte toujours
  une icône, un libellé et une valeur, afin que l'information ne repose jamais sur
  la couleur seule.

## 8. Version et livraisons

Le pied de chaque rapport porte le **numéro de version** de la livraison, repris aussi dans
`audit.json` et dans la feuille *Synthèse* de l'export Google Sheets. Il vient d'un
**fichier unique**, [`VERSION`](VERSION), à la racine :

```
5.1.0
```

À chaque livraison :

```bash
# 1. modifier la valeur
echo "5.2.0" > VERSION

# 2. la reporter dans la version Apps Script (et resynchroniser les listes de domaines)
python3 build_apps_script.py

# 3. publier
cd apps-script && clasp push -f
```

Le CLI Python lit `VERSION` à l'exécution : rien à régénérer de ce côté. La version
Apps Script embarque la valeur dans `Code.gs` (constante `APP_VERSION`, générée — ne pas
l'éditer à la main), et vos utilisateurs la verront **après publication d'une nouvelle
version du déploiement**.

Le build y ajoute une **empreinte horodatée** (`APP_BUILD`, par exemple `20260904-1458`),
affichée à côté du numéro : `version 5.2.0 · build 20260904-1458`. Elle change à chaque
build, y compris si vous oubliez de modifier `VERSION` — deux livraisons ne peuvent donc
jamais être confondues. Quand un utilisateur signale un comportement, ces deux valeurs
disent exactement quel code il exécute.

## 9. Structure du code

```
VERSION                 numéro de version, repris partout (§8)
domaines-internes.txt   vos domaines (générés dans Code.gs par le build)
domaines-partenaires.txt liste blanche des partenaires approuvés
audit_drive.py          point d'entrée
build_apps_script.py    régénère Index.html + les constantes de Code.gs
gdshares/auth.py        OAuth utilisateur ou compte de service délégué
gdshares/scan.py        parcours Drive, permissions, chemins, backoff
gdshares/classify.py    niveaux d'exposition, rôles, score de risque
gdshares/aggregate.py   agrégations macro
gdshares/report.py      rendu du rapport
gdshares/template.html  gabarit HTML/CSS/JS partagé avec la version Apps Script
gdshares/export.py      exports CSV et JSON
gdshares/demo.py        jeu de données de démonstration
```

## Licence

**Elastic License 2.0** — voir [`LICENSE`](LICENSE). Identifiant SPDX : `Elastic-2.0`.

**Ce qui est permis :** utiliser, copier, modifier et **redistribuer** l'outil, y compris
au sein d'une entreprise à but lucratif. Auditer votre Drive, adapter le code à vos
domaines, le déployer pour vos collaborateurs, publier un fork corrigé : tout cela est
couvert.

**Ce qui ne l'est pas :** fournir le logiciel à des tiers **en tant que service hébergé ou
infogéré**, et retirer ou masquer les mentions de licence, de droit d'auteur ou d'auteur.
Pour une offre de service, contactez l'auteur.

Ce n'est pas une licence open source au sens de l'OSI — elle restreint un champ
d'utilisation — mais elle est **reconnue par le registre SPDX** et affichée sous son nom
par GitHub.

Outil réalisé par **Fabrice Faucheux** — [faucheux.bzh](https://faucheux.bzh).

---

<a name="english"></a>

# Google Drive sharing audit — English

A tool giving **every user** a **macro-level then item-level** view of everything
they share in Google Drive — both **My Drive** and **Shared drives** — with the
sharing level and the granted role for each item.

It produces a self-contained HTML report (no external resources, works offline)
plus two CSV exports.

## Two editions, one report

| | **Apps Script** (`apps-script/`) | **Python** (this folder) |
|---|---|---|
| Audience | all your users | you, IT/security |
| Deployment | a web app, **one URL to share** | a folder to distribute, Python required |
| End-user steps | open a link, authorise | terminal, `credentials.json`, `pip install` |
| Outputs | dashboard + export to Google Sheets | dashboard + CSV + JSON + terminal summary |
| Auditing someone else | no (each user sees their own Drive) | yes, via a delegated service account |

Workspace administrators should start with [`apps-script/README.md`](apps-script/README.md).

## Quick start

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python3 audit_drive.py --demo --open     # demo report, no account needed
python3 audit_drive.py --open            # audit your own Drive
```

Google Cloud setup (once): enable the **Drive API**, configure the **OAuth consent
screen**, create an **OAuth client ID of type Desktop app**, and save the JSON as
`credentials.json` next to the script.

Main options: `--scope all|mydrive|shared`, `--include-shared-with-me`,
`--metadata-only`, `--max-files N`, `--out DIR`, `--workers N`, `--open`, `--demo`,
`--sa-key` + `--impersonate` for delegated admin audits.

**Export to Google Sheets.** `--to-sheets` also creates a workbook in your Drive with
three sheets — Summary, Items, Permissions — with frozen headers and filters. It requires
enabling the **Google Sheets API** in the same Cloud project and the extra `drive.file`
scope, which grants access **only to files the tool itself creates**. Values are written
`RAW`, so no cell is ever evaluated as a formula. In the Apps Script edition the same
workbook is one click away: **Exporter vers Google Sheets** at the bottom of the report.

**Choosing what to scan.** `--list-targets` prints the top-level folders of My Drive and
the accessible shared drives; `--folders "Contracts,HR"` and `--drives "Management"` then
accept those names or IDs (`--drives none` for none at all). A selected folder is walked
**recursively** and counts as an audited item itself; an item reachable through two paths
is counted once. The Apps Script edition offers the same choice on a selection screen
shown before the scan.

## From finding to fix

The Drive API exposes **no URL that opens the sharing dialog directly**, so the report takes
you to the right place in one click instead: the item name on each row links to the file or folder
(Share button one click away), the shared-drive name opens the drive and its *Manage members*
tab, and *voir les N éléments* in the external-accounts table filters the detail table down to
what that person can reach — each row then opens in Drive, and the CSV/Sheets export carries
exactly that selection. (An earlier version linked to a Drive `to:` search; that operator is
not honoured by the Drive interface, so the filtering is now done inside the report.) The
tool never modifies a share: its OAuth scope is read-only, deliberately.

## Exposure levels

Each item is classified at its **most open** permission: public on the web (indexable),
public link, external domain, external account, whole organisation (discoverable),
whole organisation (link), internal named sharing, private. Roles are reported as
Drive names them: owner, manager, content manager, editor, commenter, viewer.

**Partner whitelist.** A long-standing client or supplier is not an alert.
`--partner-domains partners.txt` reclassifies those recipients as **"Partenaire référencé"**:
they stay external and remain listed in the external-recipient inventory (marked 🤝), but
they drop out of the "shared outside the organisation" and "external write access"
indicators, so those only flag the unexpected. A separate indicator reports the approved
volume. Not to be confused with `--internal-domains`, which lists *your* domains — a domain
in both is treated as internal.

**Secondary domains must be declared.** "Internal" is inferred from your own email
domain, so colleagues hosted on a **secondary domain or alias** (Admin console > Account >
Domains) would otherwise be reported as external recipients. Pass them with
`--internal-domains "other-domain.com,second-brand.com"`; the report header lists the
domains it treated as internal. In the Apps Script edition the administrator declares
them once for everyone.

A **personal `@gmail.com` account** has no organisation: the tool detects it and
treats every other person as external.

The **risk score (0–100)** combines the exposure level, write access granted
externally, the number of external recipients, the propagation effect of folders,
and the absence of an expiry date on a public link.

## My Drive vs Shared drives

In My Drive you are the owner and every share is an explicit act. In a shared drive
the baseline access comes from **drive membership** — all members see all content —
so the tool reports membership (members, external members, managers, restrictions)
and then separates **inherited** rights from **item-specific** shares, which are the
ones that actually widen exposure.

## Shared drives you don't manage

On a shared drive where you are only a viewer, commenter or contributor, you cannot change
any sharing: auditing it gives you nothing to act on. Those drives are **skipped by
default** (`--include-unmanaged` to include them) and the CLI lists what it skipped, with
your role and the managers to contact. The criterion is the API's `canManageMembers`
capability, which accounts for admin settings. Included drives show a **"Votre rôle"**
column and, on hover, the managers who can act. Unlike drives owned by another
organisation, their items **stay in your statistics** — it is your organisation's data,
just not your remit.

## Shared drives owned by another organisation

You may be a member of a shared drive owned by a client or partner. That content is **not
your exposure** — it is their data, their members, their governance — and counting it under
"shared outside the organisation" would inflate your figures with risk that isn't yours.

The tool detects those drives (**no manager belongs to your domains**), excludes them from
the indicators and the exposure distribution, lists them in a separate block with their
managers, keeps their items in the detail table marked "Drive externe", and leaves them
unticked by default on the Apps Script selection screen. Calling a drive external requires
**positive evidence**: if its membership cannot be read, or no manager is visible, it stays
counted as yours — a doubt must never make a share vanish from the statistics.

**What your people put there.** In a shared drive the file belongs to the **drive**, hence
to the owning organisation: a document created by one of your employees inside a client's
drive has left your estate. The external-drives block therefore counts items whose **last
contributor** is one of yours and lists those contributors; the column also appears in the
detail table (marked ↻) and in the exports. Caveat: the Drive API exposes no *creator*
field, only `lastModifyingUser` — the signal means "someone of yours edited this last", not
"someone of yours created it". Exact attribution would require the Drive Activity API
(extra API and scope). The **Apps Script edition does exactly that**, via the advanced
service — no Cloud console involved — and reports true creators alongside last contributors;
the Python CLI stays on the last contributor, since there the same API would have to be
enabled in your Cloud project.

## OAuth scope, privacy, limitations

**Requested scope: `drive.readonly` (plus `drive.file` in the Apps Script edition).**
This is a Google API constraint, not a preference: `drives.list` — the only way to
enumerate shared drives — accepts only `drive` or `drive.readonly`.
`drive.metadata.readonly` fails with *"insufficient authentication scopes to call
drive.drives.list"*.

So, stated plainly: **this scope technically grants the right to read file content.**
The tool never exercises it — it only ever requests metadata and permission fields,
and the code is short enough to read in full (`gdshares/scan.py`). No write access is
possible: the scope is read-only, the tool cannot change any sharing setting.

If that scope is unacceptable in your context, `--metadata-only` switches to
`drive.metadata.readonly`: no content-read right at all, but **shared drives can no
longer be enumerated** and the audit covers My Drive only.

Other limitations: trashed items are excluded; a share is only visible if the audited
account is allowed to see it (on items you neither own nor manage, the recipient list
may be incomplete — an API limit); large drives hit API quotas, handled with
exponential backoff and parallel calls; CSV exports neutralise formula injection.

## Licence

**Elastic License 2.0** — see [`LICENSE`](LICENSE). SPDX identifier: `Elastic-2.0`.

You may use, copy, modify and **redistribute** the tool, including inside a for-profit
company. You may **not** provide it to third parties as a hosted or managed service, nor
remove or obscure the licensing, copyright or authorship notices. Contact the author for a
service offering. Not an OSI open-source licence — it restricts one field of use — but it
is on the SPDX register and GitHub displays it by name.

Built by **Fabrice Faucheux** — [faucheux.bzh](https://faucheux.bzh).
