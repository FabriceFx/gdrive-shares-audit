# Version Apps Script — à déployer pour tout le domaine

Même rapport que la version Python, mais **rien à installer côté utilisateur** :
vous déployez une application web, vous partagez **une URL**, chaque collaborateur
l'ouvre et n'analyse que son propre Drive, sous sa propre identité.

*[English version below](#english)* · Licence **Elastic 2.0** ([`LICENSE`](../LICENSE)) :
usage et redistribution libres, service hébergé exclu.

* Aucun `credentials.json` à distribuer, aucun Python, aucun terminal.
* L'application s'exécute **en tant que l'utilisateur qui y accède** : personne ne
  voit les partages de quelqu'un d'autre.
* Le balayage est piloté par le navigateur (une page de résultats par appel), ce qui
  contourne la limite de 6 minutes par exécution et affiche une progression réelle.
  Les éléments qu'une page n'a pas eu le temps de traiter sont repris explicitement
  (`hydrateFiles`) : rien n'est abandonné silencieusement.
* L'identité de l'utilisateur et les membres des Drives sont **relus côté serveur**
  (cache utilisateur), jamais repris de ce que le navigateur envoie.
* **Export Google Sheets natif** : le bouton *Exporter vers Google Sheets*, au bas du
  rapport, crée un classeur à trois feuilles (Synthèse, Éléments, Permissions) avec
  en-têtes figées et filtres. Il porte sur la **sélection courante** du tableau de détail,
  la feuille Synthèse rappelant le périmètre complet. Écriture en mode `RAW` : aucune
  cellule n'est interprétée comme une formule.
* **Drives que vous ne gérez pas décochés par défaut** : sur un Drive où vous êtes lecteur,
  commentateur ou contributeur, vous ne pouvez pas modifier les partages. Le badge « vous
  n'êtes pas gestionnaire » indique votre rôle et nomme les gestionnaires à qui s'adresser.
  Vous pouvez les cocher : leurs éléments comptent alors normalement dans vos statistiques,
  puisqu'il s'agit bien des données de votre organisation.
* **Drives d'autres organisations reconnus** : un Drive partagé dont aucun gestionnaire
  n'appartient à vos domaines appartient à un tiers (client, partenaire). Vous y êtes
  invité : ce n'est pas votre exposition. Il est décoché par défaut dans l'écran de
  sélection, marqué « autre organisation », et — s'il est analysé — ses éléments sont
  exclus des indicateurs et de la répartition, tout en restant consultables dans le détail.
* **Contribution de vos collaborateurs dans les Drives tiers** : le bloc dédié compte les
  éléments **créés** par vos domaines (historique d'activité Drive) et ceux dont le
  **dernier contributeur** est chez vous, et nomme les personnes. Dans un Drive partagé le
  fichier appartient au Drive : ce que vos salariés y déposent sort de votre patrimoine.
* **Damier d'applications Google** en haut à droite : Drive et ses vues, Gmail, Agenda,
  Meet, Docs, Sheets, Slides, Groupes, Contacts, Mon compte, console d'administration et
  journaux Drive. Il s'agit d'un menu de liens, pas de la barre Google — composant
  propriétaire, non intégrable dans l'iframe Apps Script.
* **Liens de remédiation** : le **nom** de chaque ligne ouvre le fichier dans Drive — à
  gauche de la ligne, visible sans défilement horizontal sur un portable — le nom d'un Drive
  partagé ouvre son onglet *Gérer les membres*, et « voir les N éléments »
  sur un compte externe (ou un clic sur la barre d'un domaine) filtre le détail sur ce qu'il
  peut atteindre — l'export reprend alors cette sélection. L'API n'offre pas d'URL ouvrant
  directement la boîte de partage : on amène au bon endroit, on ne clique pas à la place de
  l'utilisateur.
* **Relance en un clic** : deux boutons en tête du rapport — *↻ Relancer l'analyse*, qui
  rejoue le **même périmètre** sans repasser par l'écran de choix, et *Changer le
  périmètre…*, qui le rouvre. Ils sont désactivés pendant un balayage en cours.
  La relance se fait **sans recharger la page** : dans l'iframe Apps Script, le document
  n'est servi qu'une fois et un `location.reload()` y laisse une page blanche. Effet de
  bord appréciable, les filtres et le tri du tableau de détail survivent à la relance.
* **Écran de sélection** avant le balayage : tout Mon Drive, certains dossiers seulement
  (sous-dossiers inclus) ou aucun ; tous les Drives partagés, une sélection ou aucun.
  Utile sur un gros Drive, où l'analyse complète prend plusieurs minutes.

## Déploiement (≈ 10 minutes, une seule fois)

1. Ouvrez **[script.new](https://script.new)** avec un compte de votre domaine.
   Nommez le projet *Audit des partages Drive*.
2. **Paramètres du projet** → cochez
   **« Afficher le fichier manifeste `appsscript.json` dans l'éditeur »**.
3. Recopiez les quatre fichiers de ce dossier :

   | Fichier ici | À créer dans l'éditeur |
   |---|---|
   | `appsscript.json` | remplacer le contenu du manifeste |
   | `Code.gs` | fichier script `Code` |
   | `Classify.gs` | fichier script `Classify` |
   | `Index.html` | fichier **HTML** nommé `Index` |

   Le manifeste active les services avancés **Drive API v3** et **Sheets API v4** ;
   s'ils n'apparaissent pas dans *Services*, ajoutez-les à la main (identifiants `Drive`
   version `v3`, et `Sheets` version `v4` — ce dernier sert à l'export Google Sheets).
4. **Déployer → Nouveau déploiement → Application Web** :
   * *Exécuter en tant que* : **l'utilisateur qui accède à l'application web**
   * *Qui a accès* : **tous les utilisateurs de votre-domaine.fr**
5. Autorisez pour vous-même, vérifiez que le rapport se génère, puis **diffusez
   l'URL `…/exec`**.

Alternative reproductible avec [clasp](https://github.com/google/clasp) :

```bash
npm install -g @google/clasp && clasp login
cd apps-script && clasp push -f && clasp deploy --description "v1"
```

### Si vos utilisateurs voient « Accès bloqué »

Contrôle des applications de l'Admin console (*Sécurité → Contrôles des API →
Gérer l'accès des applications*) : ajoutez le projet comme **application de
confiance** via son ID client OAuth, visible dans *Paramètres du projet → Projet
Google Cloud*. Une application Apps Script détenue par votre domaine est **interne** :
pas de validation Google requise, et les jetons n'expirent pas au bout de 7 jours.

### Pour aller plus loin

Publier le projet comme **module complémentaire privé** via le Google Workspace
Marketplace SDK le fait apparaître dans le lanceur d'applications de chacun, sans
lien à diffuser.

## À configurer avant le déploiement : les domaines secondaires

Ce qui compte comme « interne » se déduit du domaine de l'adresse de chaque utilisateur.
Si votre organisation a des **domaines secondaires ou des alias** (console
d'administration > Compte > Domaines > Gérer les domaines), déclarez-les, sinon les
collègues qui y sont hébergés seront classés « Partagé hors de l'organisation ».

Deux façons de faire, au choix :

* éditer la constante `INTERNAL_DOMAINS` en tête de `Code.gs` ;
* ou exécuter **une seule fois** depuis l'éditeur, sans toucher au code :
  `setInternalDomains('autre-domaine.fr, marque-secondaire.com')`. La valeur est stockée
  dans les propriétés du script et s'applique **à tous vos utilisateurs**.

Le domaine principal de chaque utilisateur est ajouté automatiquement. Les domaines
retenus sont rappelés en tête du rapport, pour que chacun sache sur quelle base la
distinction interne/externe a été faite.

## Liste blanche des partenaires

Un client ou un prestataire habituel n'est pas une alerte. Déclarez ses domaines et ses
accès deviennent **« Partenaire référencé »** : toujours visibles dans l'inventaire des
destinataires extérieurs, marqués 🤝, mais retirés des indicateurs « Partagés hors de
l'organisation » et « Droits d'écriture externes ». Ces indicateurs ne signalent alors plus
que l'inattendu, et un indicateur dédié rappelle le volume approuvé.

Trois façons de la tenir, par ordre de commodité :

**1. Depuis le rapport (recommandé).** Déclarez d'abord qui a le droit de la modifier.
Deux voies, au choix :

* exécuter **une fois** depuis l'éditeur, effet immédiat sans republier :
  `setPartnerAdmins('prenom.nom@votre-domaine.fr, rssi@votre-domaine.fr')` ;
* ou compléter la constante `PARTNER_ADMINS` en tête de `Code.gs`, qui ne prend effet
  qu'à la publication d'une nouvelle version.

Les deux se cumulent, sans doublon. `setPartnerAdmins('')` revient à la seule constante.
Cette fonction n'est **pas** exposée dans le rapport : c'est le réglage qui décide de qui
décide, et y toucher suppose l'accès à l'éditeur, donc un niveau de droit supérieur.

Ces personnes — et elles seules — voient alors un bouton **🤝 Liste blanche…** en tête du
rapport. Elles y saisissent les domaines, un par ligne ; l'enregistrement **relance
automatiquement l'analyse** pour reclasser les partages. La valeur va dans les propriétés du
script : elle s'applique **immédiatement, à tous les utilisateurs, sans republier**.

Le défaut est fermé : `PARTNER_ADMINS` vide, personne ne peut modifier la liste depuis
l'interface. Ce n'est pas un réglage personnel — ajouter un domaine fait sortir ses partages
de l'indicateur « hors organisation » pour tout le monde. Le contrôle est refait côté
serveur, jamais sur la foi du navigateur.

La boîte affiche aussi qui a modifié la liste en dernier et quand, les domaines figés dans
le code (non modifiables là), et signale ce qu'elle a écarté — un domaine déjà interne, ou
mal formé.

**2. La constante `PARTNER_DOMAINS`** de `Code.gs`, alimentée depuis
`domaines-partenaires.txt` par `build_apps_script.py`. Elle ne prend effet qu'à la
publication d'une nouvelle version : c'est le socle, pas le réglage courant.

**3. `setPartnerDomains('client.com, agence.fr')`** exécuté depuis l'éditeur, équivalent au
point 1 sans passer par le rapport.

À ne pas confondre avec `INTERNAL_DOMAINS`, qui liste **vos** domaines. Un domaine présent
dans les deux listes est traité comme interne : l'appartenance l'emporte sur l'approbation.

## Le signal « créé par » : service Drive Activity

L'API Drive n'expose pas le créateur d'un fichier. Seule l'**API Drive Activity** le donne,
et elle est disponible comme **service avancé Apps Script** — donc **sans passer par la
console Google Cloud**.

Le manifeste la déclare déjà (`DriveActivity`, `v2`). Si l'éditeur signale qu'elle manque,
ajoutez-la dans *Services +* → *Drive Activity API* → identifiant `DriveActivity`,
version `v2`. Elle ajoute la portée `drive.activity.readonly` : **vos utilisateurs devront
donc reconsentir** au prochain accès.

Deux détails d'implémentation qui expliquent ce que vous voyez :

* L'API ne renvoie jamais d'adresse, seulement un identifiant d'acteur `people/<id>`. Cet
  identifiant coïncide avec l'identifiant de permission Drive : l'outil résout donc les
  créateurs avec les membres du Drive et les derniers contributeurs déjà collectés, **sans
  API People ni portée supplémentaire**. Un créateur qui a quitté le Drive reste non résolu.
* L'historique d'activité n'est pas éternel : un élément créé avant la fenêtre de rétention
  n'a pas de trace. L'infobulle indique combien d'éléments sont dans ce cas — le compte est
  donc un **plancher**, jamais un maximum.

La requête n'est lancée que sur les **Drives d'autres organisations**, là où la question se
pose. Si le service est absent ou refusé, la colonne affiche « n/d », un avertissement
s'affiche, et le reste du rapport fonctionne normalement.

## Autorisations demandées

| Scope | Pourquoi |
|---|---|
| `drive.readonly` | **imposé par l'API** : `drives.list`, seul moyen d'énumérer les Drives partagés, n'accepte que `drive` ou `drive.readonly`. Avec `drive.metadata.readonly`, l'application échoue sur *« autorisations insuffisantes pour appeler drive.drives.list »*. |
| `drive.activity.readonly` | lire l'historique d'activité des Drives tiers pour identifier qui, chez vous, y a **créé** des documents. Lecture seule, limitée aux Drives que vous analysez. |
| `drive.file` | créer, à votre demande, le classeur Google Sheets d'export — accès limité aux **seuls fichiers créés par l'application**, jamais au reste de votre Drive. C'est aussi la portée utilisée par l'API Sheets pour écrire dedans. |

À énoncer clairement à vos utilisateurs : **`drive.readonly` donne le droit
technique de lire le contenu des fichiers.** Le code ne l'exerce jamais — il ne
demande à l'API que des champs de métadonnées et de permissions — et aucune écriture
n'est possible. Si vous préférez la portée minimale, remplacez `drive.readonly` par
`drive.metadata.readonly` dans le manifeste : l'audit continue de fonctionner, mais
`Drives.list` échoue silencieusement (le `try/catch` est prévu) et **seul Mon Drive
est analysé**.

## Limites propres à cette version

* Un très gros Drive (> 30 000 éléments) prend plusieurs minutes : la page doit rester
  ouverte pendant le balayage.
* L'iframe Apps Script bloque les téléchargements directs : *Exporter la sélection (CSV)*
  crée donc une feuille Google à partir du CSV (plafonnée à 20 Mo). Pour un classeur
  structuré, préférez *Exporter vers Google Sheets*.
* Les éléments « Partagés avec moi » ne sont pas balayés (l'objectif est de voir ce
  que **vous** exposez). La tâche existe côté serveur : ajoutez
  `{kind:'sharedWithMe', name:'Partagés avec moi'}` à la liste `tasks` de `Index.html`.

## Numéro de version

Le pied du rapport affiche `version 5.2.0 · build 20260904-1458` : le numéro vient du fichier
`VERSION` à la racine du projet, l'empreinte de build est horodatée automatiquement à chaque
`build_apps_script.py` — de sorte que le pied de page change même si le numéro de version,
lui, n'a pas bougé. À chaque livraison : modifier `VERSION`, lancer `python3 build_apps_script.py`
(qui reporte la valeur dans la constante `APP_VERSION` de `Code.gs` et resynchronise les
listes de domaines), pousser, puis **publier une nouvelle version du déploiement** — sans
quoi vos utilisateurs continuent de voir l'ancien numéro, ce qui est précisément le
comportement attendu : le numéro affiché est celui de la livraison réellement installée.

## Convention de code

Le projet cible le runtime **V8** : le code utilise `const` et `let`. Seules les constantes
globales de `Code.gs` restent en `var`, pour deux raisons — elles sont hissées, ce qui évite
toute dépendance à l'ordre de chargement des fichiers `.gs`, et `build_apps_script.py` les
réécrit par expression régulière sur la forme `var NOM = …`. Un commentaire le rappelle à
cet endroit du fichier.

## Modifier le rapport

`Index.html` est **généré**. Le tableau de bord est partagé avec la version Python
(`gdshares/template.html`) ; l'écran de balayage et l'amorçage sont dans
`apps-script/parts/bootstrap.html`. Après modification :

```bash
python3 build_apps_script.py
```

---

<a name="english"></a>

# Apps Script edition — domain-wide deployment

Same report as the Python edition, but **nothing for users to install**: deploy a web
app, share **one URL**, and each colleague audits only their own Drive under their own
identity.

**Re-run in one click**: two buttons at the top of the report — *↻ Relancer l'analyse*
replays the same perimeter without going back through the selection screen, *Changer le
périmètre…* reopens it.

**Partner whitelist.** Declare who may maintain it — either run
`setPartnerAdmins('name@corp.com')` once from the editor (effective immediately, no
redeploy) or fill the `PARTNER_ADMINS` constant in `Code.gs`; the two merge. Those people
then get a **🤝 Liste blanche…** button in the report, editing the list for
everyone with no redeploy — saving re-runs the analysis so items are reclassified. The
default is closed: with no admin declared, nobody can edit it from the interface, and the
check is repeated server-side. The baseline list stays in `PARTNER_DOMAINS`. Approved
domains' 
access is reclassified as "Partenaire référencé": still external and still listed, but out
of the "shared outside the organisation" and "external write access" indicators, so those
flag only the unexpected. A domain listed both as internal and partner is treated as
internal.

**Drives you don't manage** are unticked by default: where you are only a viewer, commenter
or contributor you cannot change sharing, so the badge names your role and the managers to
contact instead. Ticking them is allowed — their items then count normally, since the data
is your organisation's.

**Who created what.** The Drive API exposes no creator field; the **Drive Activity API**
does, and it is available as an Apps Script **advanced service** — no Cloud console needed.
The manifest declares it (`DriveActivity`, `v2`); it adds the `drive.activity.readonly`
scope, so **users must re-consent**. Activity actors come back as `people/<id>` rather than
addresses, so the tool resolves them against the Drive permission IDs it already collected —
no People API, no extra scope. Items older than the activity retention window have no trace,
so the count is a floor. Queried only on drives owned by other organisations; if the service
is missing the column reads "n/d" and everything else still works.

**Native Google Sheets export**: the *Exporter vers Google Sheets* button at the bottom
of the report builds a three-sheet workbook (Summary, Items, Permissions) with frozen
headers and filters, covering the current selection of the detail table. Values are
written `RAW`, so no cell is evaluated as a formula.

A **selection screen** opens before the scan: all of My Drive, only certain folders
(subfolders included) or none; all shared drives, a subset, or none — useful on a large
Drive where a full scan takes minutes.

The scan is driven by the browser (one result page per call), which sidesteps the
6-minute execution limit and gives a real progress bar; items a page could not finish
are explicitly re-fetched (`hydrateFiles`), never silently dropped. The user's identity
and shared-drive membership are re-read **server-side**, never trusted from the client.

## Deployment (~10 minutes, once)

1. Open [script.new](https://script.new) with an account in your domain.
2. **Project settings** → tick *Show `appsscript.json` manifest file in editor*.
3. Copy the four files from this folder: `appsscript.json` (manifest), `Code.gs`,
   `Classify.gs`, and an **HTML** file named `Index`. The manifest enables the
   **Drive API v3** advanced service (identifier `Drive`, version `v3`).
4. **Deploy → New deployment → Web app**: *Execute as* **user accessing the web app**,
   *Who has access* **anyone in your-domain.com**.
5. Authorise it for yourself, check the report renders, then share the `…/exec` URL.

With clasp: `clasp push -f && clasp deploy --description "v1"`.

If users hit *Access blocked*, mark the project as a **trusted app** in the Admin
console (Security → API controls → Manage app access) using its OAuth client ID. An
Apps Script app owned by your domain is **internal**: no Google verification needed,
and tokens do not expire after 7 days.

## Before deploying: declare your secondary domains

"Internal" is inferred from each user's own email domain. If your organisation has
**secondary domains or aliases** (Admin console > Account > Domains), declare them, or
colleagues hosted there will be reported as external. Either edit the `INTERNAL_DOMAINS`
constant at the top of `Code.gs`, or run `setInternalDomains('other.com, second.com')`
once from the editor — it is stored in script properties and applies to every user. The
report header lists the domains treated as internal.

## Scopes

| Scope | Why |
|---|---|
| `drive.readonly` | **required by the API**: `drives.list`, the only way to enumerate shared drives, accepts only `drive` or `drive.readonly`. With `drive.metadata.readonly` the app fails with *"insufficient authentication scopes to call drive.drives.list"*. |
| `drive.file` | creates the Google Sheet export on request; limited to files the app itself creates |

Be explicit with your users: **`drive.readonly` technically grants the right to read
file content.** The code never does — it only requests metadata and permission fields —
and no write access is possible. For the minimal scope, replace `drive.readonly` with
`drive.metadata.readonly` in the manifest: the app still works, `Drives.list` fails
gracefully (the `try/catch` is there for it), and **only My Drive is audited**.

## Limitations

Very large drives (> 30,000 items) take several minutes and the tab must stay open.
The Apps Script iframe blocks direct downloads, so *Export selection* creates a Google
Sheet in your Drive (capped at 20 MB). "Shared with me" items are not scanned by
default — the server task exists; add `{kind:'sharedWithMe', name:'Partagés avec moi'}`
to the `tasks` list in `Index.html` to enable it.

`Index.html` is **generated** from `gdshares/template.html` +
`apps-script/parts/bootstrap.html`; rebuild with `python3 build_apps_script.py`.

Licensed under **Elastic License 2.0** — use and redistribution allowed, hosted service excluded, see
[`LICENSE`](../LICENSE). Built by **Fabrice Faucheux** — [faucheux.bzh](https://faucheux.bzh).
