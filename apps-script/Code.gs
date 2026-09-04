/**
 * Audit des partages Google Drive — application web Apps Script.
 *
 * Déployée par l'administrateur en « Exécuter en tant que : l'utilisateur qui accède »
 * et « Accès : tous les utilisateurs de <domaine> ». Chaque utilisateur ouvre la même
 * URL et n'analyse que son propre Drive, sous sa propre identité.
 *
 * Le balayage est piloté par le navigateur (une page de résultats par appel) : cela
 * contourne la limite de 6 minutes par exécution et affiche une progression réelle.
 * L'identité et les membres des Drives ne sont JAMAIS repris du client : ils sont
 * relus côté serveur (cache utilisateur), pour qu'un appel forgé ne puisse pas
 * fausser la classification interne/externe.
 */

var FILE_FIELDS = 'nextPageToken, files(id,name,mimeType,driveId,parents,shared,trashed,' +
  'webViewLink,createdTime,modifiedTime,size,quotaBytesUsed,hasAugmentedPermissions,' +
  'owners(emailAddress,displayName),lastModifyingUser(emailAddress,displayName,permissionId),' +
  'permissions(id,type,role,emailAddress,domain,displayName,allowFileDiscovery,deleted,' +
  'expirationTime,pendingOwner,permissionDetails(permissionType,role,inherited,inheritedFrom)))';
var PERM_FIELDS = 'nextPageToken, permissions(id,type,role,emailAddress,domain,displayName,' +
  'allowFileDiscovery,deleted,expirationTime,pendingOwner,' +
  'permissionDetails(permissionType,role,inherited,inheritedFrom))';
var SINGLE_FILE_FIELDS = FILE_FIELDS
  .replace('nextPageToken, files(', '').replace(/\)$/, '');
/**
 * DOMAINES SECONDAIRES DE VOTRE ORGANISATION — à compléter avant le déploiement.
 *
 * Console d'administration > Compte > Domaines > Gérer les domaines : recopiez ici
 * tous les domaines secondaires et alias. Sans cela, les collègues dont l'adresse est
 * sur l'un de ces domaines seraient classés « Partagé hors de l'organisation ».
 * Le domaine principal est déduit automatiquement de l'adresse de chaque utilisateur.
 *
 * Modifiable sans toucher au code : exécuter une fois setInternalDomains('a.fr,b.com')
 * depuis l'éditeur (la valeur est alors partagée par tous les utilisateurs).
 *
 * N'y mettez PAS un domaine en <domaine>.guest.google : Google le provisionne pour les
 * identités invitées, et le compter comme interne masquerait des accès externes.
 * Liste de référence : domaines-internes.txt (ce tableau en est généré).
 */
var INTERNAL_DOMAINS = [
];

/**
 * LISTE BLANCHE — domaines EXTÉRIEURS approuvés (clients, prestataires, filiales hors
 * périmètre). Ils restent externes, mais sont classés « Partenaire référencé » et sortent
 * de l'indicateur « Partagés hors de l'organisation », qui ne signale alors que l'inattendu.
 *
 * À ne pas confondre avec INTERNAL_DOMAINS, qui liste VOS domaines. Un domaine présent
 * dans les deux est traité comme interne.
 *
 * Modifiable sans toucher au code : setPartnerDomains('client.com, agence.fr')
 */
/**
 * ADMINISTRATEURS de la liste blanche : adresses autorisées à la modifier depuis le rapport.
 *
 * Laissée vide, personne ne peut la modifier depuis l'interface. Ce défaut fermé est
 * délibéré : ajouter un domaine à la liste blanche fait sortir ses partages de l'indicateur
 * « hors organisation » pour TOUS les utilisateurs. Ce n'est pas un réglage personnel.
 *
 * Cette constante n'atteint les utilisateurs qu'après publication d'une nouvelle version.
 * Pour un effet immédiat, exécuter depuis l'éditeur :
 *   setPartnerAdmins('prenom.nom@votre-domaine.fr, autre@votre-domaine.fr')
 */
var PARTNER_ADMINS = [
  // 'prenom.nom@votre-domaine.fr',
];

var PARTNER_DOMAINS = [
];

// Les constantes globales de ce fichier restent en `var`, à dessein : elles sont hissées
// (l'ordre de chargement des fichiers .gs n'est pas garanti) et build_apps_script.py les
// réécrit par expression régulière sur la forme `var NOM = …`. Partout ailleurs, le code
// utilise const/let.
//
// GÉNÉRÉS par build_apps_script.py — ne pas éditer ici.
// APP_VERSION vient du fichier VERSION à la racine ; APP_BUILD est horodaté à chaque build,
// pour que le pied de page change même quand le numéro de version, lui, ne bouge pas.
var APP_VERSION = '5.2.0';
var APP_BUILD = '20260904-1850';

var HYDRATE_BUDGET_MS = 120000;   // au-delà, les éléments restants repartent en « pending »
var CACHE_TTL = 21600;            // 6 h, maximum autorisé par CacheService
var MAX_EXPORT_BYTES = 20 * 1024 * 1024;

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Audit de mes partages Google Drive')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/* ------------------------------------------------------------ résilience API */

/** Rejoue un appel Drive sur quota, indisponibilité ou coupure réseau. */
function withRetry_(fn, tries) {
  tries = tries || 5;
  for (var i = 0; i < tries; i++) {
    try {
      return fn();
    } catch (e) {
      var msg = String(e && e.message || e);
      var transient = /rate ?limit|quota|internal error|backend|try again|timeout|503|500|429/i.test(msg);
      if (!transient || i === tries - 1) throw e;
      Utilities.sleep(Math.min(Math.pow(2, i) * 1000, 16000) + Math.floor(Math.random() * 500));
    }
  }
}

/* ------------------------------------------------- état serveur (cache user) */

function cacheGet_(key) { try { return CacheService.getUserCache().get(key); } catch (e) { return null; } }
function cachePut_(key, val) { try { CacheService.getUserCache().put(key, val, CACHE_TTL); } catch (e) { } }

/** Domaines internes : constante ci-dessus + valeur éventuellement posée par l'admin. */
function internalDomains_() {
  let extra = [];
  try {
    var stored = PropertiesService.getScriptProperties().getProperty('internalDomains');
    if (stored) extra = stored.split(',');
  } catch (e) { /* propriétés indisponibles : on garde la constante */ }
  return INTERNAL_DOMAINS.concat(extra);
}

/**
 * À exécuter UNE FOIS depuis l'éditeur, par l'administrateur, pour déclarer les
 * domaines secondaires sans modifier le code :
 *   setInternalDomains('autre-domaine.fr, marque-secondaire.com')
 */
function setInternalDomains(csv) {
  PropertiesService.getScriptProperties().setProperty('internalDomains', csv || '');
  return internalDomains_();
}

function partnerDomains_() {
  let extra = [];
  try {
    var stored = PropertiesService.getScriptProperties().getProperty('partnerDomains');
    if (stored) extra = stored.split(',');
  } catch (e) { /* propriétés indisponibles : on garde la constante */ }
  return PARTNER_DOMAINS.concat(extra);
}

function normDomain_(d) {
  return String(d || '').trim().replace(/^@/, '').trim().toLowerCase();
}

function normEmail_(x) {
  return String(x || '').trim().toLowerCase();
}

/** Administrateurs effectifs : constante du code + valeur posée depuis l'éditeur. */
function partnerAdmins_() {
  let extra = [];
  try {
    var stored = PropertiesService.getScriptProperties().getProperty('partnerAdmins');
    if (stored) extra = stored.split(',');
  } catch (e) { /* propriétés indisponibles : on garde la constante */ }
  const out = [];
  PARTNER_ADMINS.concat(extra).forEach(function (a) {
    a = normEmail_(a);
    if (a && out.indexOf(a) === -1) out.push(a);
  });
  return out;
}

/**
 * À exécuter UNE FOIS depuis l'éditeur pour déclarer qui peut modifier la liste blanche,
 * sans republier de version :
 *   setPartnerAdmins('prenom.nom@votre-domaine.fr, rssi@votre-domaine.fr')
 *
 * Volontairement non exposée au rapport : c'est le réglage qui décide de qui décide.
 * Y toucher suppose l'accès à l'éditeur, donc un niveau de droit supérieur.
 * setPartnerAdmins('') revient à la seule constante du code.
 */
function setPartnerAdmins(csv) {
  const garde = [];
  String(csv || '').split(/[\s,;]+/).forEach(function (a) {
    a = normEmail_(a);
    if (a && a.indexOf('@') > 0 && garde.indexOf(a) === -1) garde.push(a);
  });
  PropertiesService.getScriptProperties().setProperty('partnerAdmins', garde.join(','));
  Logger.log('Administrateurs de la liste blanche : ' + partnerAdmins_().join(', '));
  return partnerAdmins_();
}

function isPartnerAdmin_(me) {
  return partnerAdmins_().indexOf(normEmail_(me.email)) > -1;
}

/** État de la liste blanche pour l'écran de gestion. */
function getPartnerConfig() {
  const me = identity_();
  const props = PropertiesService.getScriptProperties();
  let meta = {};
  try { meta = JSON.parse(props.getProperty('partnerDomainsMeta') || '{}'); } catch (e) { }
  const stored = (props.getProperty('partnerDomains') || '').split(',')
    .map(normDomain_).filter(function (d) { return !!d; });
  return {
    stored: stored,                       // modifiable depuis le rapport
    fromCode: PARTNER_DOMAINS.map(normDomain_),   // figés dans Code.gs
    effective: me.partners,               // ce que la classification utilise réellement
    canEdit: isPartnerAdmin_(me),
    admins: partnerAdmins_(),
    adminsDeclared: partnerAdmins_().length > 0,
    lastBy: meta.by || '', lastAt: meta.at || ''
  };
}

/**
 * Enregistre la liste blanche modifiable. Réservé aux administrateurs déclarés :
 * le contrôle est refait ici, côté serveur, jamais sur la foi du navigateur.
 */
function savePartnerDomains(texte) {
  const me = identity_();
  if (!isPartnerAdmin_(me)) {
    throw new Error("Modification refusée : votre compte ne figure pas parmi les "
      + "administrateurs de la liste blanche.");
  }
  const internes = internalDomains_().map(normDomain_);
  let seen = {}, gardes = [], ignores = [];
  String(texte || '').split(/[\s,;]+/).forEach(function (raw) {
    const d = normDomain_(raw);
    if (!d || seen[d]) return;
    seen[d] = 1;
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) { ignores.push(d + ' (format)'); return; }
    if (internes.indexOf(d) > -1) { ignores.push(d + ' (déjà interne)'); return; }
    gardes.push(d);
  });
  if (gardes.length > 300) throw new Error('Liste trop longue (300 domaines maximum).');

  const props = PropertiesService.getScriptProperties();
  props.setProperty('partnerDomains', gardes.join(','));
  props.setProperty('partnerDomainsMeta',
    JSON.stringify({
      by: me.email, at: Utilities.formatDate(new Date(),
        Session.getScriptTimeZone(), "dd/MM/yyyy 'à' HH:mm")
    }));

  const conf = getPartnerConfig();
  conf.ignored = ignores;
  return conf;
}

/** À exécuter une fois depuis l'éditeur pour déclarer la liste blanche. */
function setPartnerDomains(csv) {
  PropertiesService.getScriptProperties().setProperty('partnerDomains', csv || '');
  return partnerDomains_();
}

/**
 * DIAGNOSTIC — à exécuter depuis l'éditeur (menu des fonctions, puis ▷ Exécuter).
 *
 * Affiche la configuration réellement prise en compte et le classement qu'obtiendrait
 * un partage avec les adresses données. Utile quand un domaine de la liste blanche
 * ressort quand même en « Externe » : la réponse est dans le journal d'exécution.
 *
 * Pour tester vos propres adresses, remplacez la liste ci-dessous.
 */
function diagnostic() {
  const adresses = ['contact@exemple-client.com'];   // ← vos adresses à tester
  const me = identity_();
  const out = {
    compte: me.email,
    domainesInternes: me.domains.length + ' : ' + me.domains.slice(0, 5).join(', ') + '…',
    listeBlanche: me.partners.length ? me.partners : '(vide — rien n\'est configuré)',
    sourceListeBlanche: (PropertiesService.getScriptProperties()
      .getProperty('partnerDomains') ? 'propriétés du script'
      : 'constante PARTNER_DOMAINS'),
    administrateurs: partnerAdmins_(),
    vousEtesAdministrateur: isPartnerAdmin_(me),
    classement: adresses.map(function (mail) {
      return mail + ' → ' +
        classifyPermission({ type: 'user', role: 'reader', emailAddress: mail }, me).label;
    })
  };
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}

/** Identité relue côté serveur — jamais celle annoncée par le navigateur. */
function identity_() {
  let mail = cacheGet_('me');
  if (!mail) {
    mail = withRetry_(function () {
      return Drive.About.get({ fields: 'user(emailAddress)' });
    }).user.emailAddress;
    cachePut_('me', mail);
  }
  return makeIdentity(mail, internalDomains_(), partnerDomains_());
}

function rootId_() {
  let id = cacheGet_('root');
  if (!id) {
    id = withRetry_(function () { return Drive.Files.get('root', { fields: 'id' }); }).id;
    cachePut_('root', id);
  }
  return id;
}

function driveMembers_(driveId) {
  if (!driveId) return [];
  const raw = cacheGet_('dm_' + driveId);
  if (raw) return JSON.parse(raw);
  let members = [];
  try {
    members = listAllPermissions(driveId).map(function (p) {
      return {
        id: p.id || null, type: p.type, role: p.role, emailAddress: p.emailAddress || null,
        domain: p.domain || null, displayName: p.displayName || null
      };
    });
  } catch (e) { /* Drive dont on ne peut pas lire la liste des membres */ }
  cachePut_('dm_' + driveId, JSON.stringify(members));
  return members;
}

function driveNames_() {
  const raw = cacheGet_('dn');
  if (raw) return JSON.parse(raw);
  const names = {};
  listDrives_().forEach(function (d) { names[d.id] = d.name; });
  cachePut_('dn', JSON.stringify(names));
  return names;
}

function listDrives_() {
  let drives = [], token = null;
  try {
    do {
      var resp = withRetry_(function () {
        return Drive.Drives.list({
          pageSize: 100, pageToken: token,
          fields: 'nextPageToken, drives(id,name,restrictions,' +
            'capabilities(canManageMembers,canShare,canEdit))'
        });
      });
      drives = drives.concat(resp.drives || []);
      token = resp.nextPageToken;
    } while (token);
  } catch (e) {
    // utilisateur sans accès aux Drives partagés (compte personnel, restriction d'admin) :
    // l'audit de Mon Drive doit continuer normalement
    return drives;
  }
  return drives;
}

/* --------------------------------------------------------- appels du client */

/**
 * Cibles proposées à l'écran de sélection : dossiers de premier niveau de Mon Drive
 * et Drives partagés accessibles. Volontairement léger (pas de membres) pour que
 * l'écran s'affiche vite.
 */
function getTargets() {
  const me = identity_();
  const about = withRetry_(function () { return Drive.About.get({ fields: 'user(displayName)' }); });

  let folders = [], token = null;
  do {
    var resp = withRetry_(function () {
      return Drive.Files.list({
        q: "'root' in parents and mimeType = '" + FOLDER_MIME + "' and trashed = false",
        pageSize: 200, pageToken: token, orderBy: 'name', corpora: 'user', spaces: 'drive',
        fields: 'nextPageToken, files(id,name)'
      });
    });
    folders = folders.concat(resp.files || []);
    token = resp.nextPageToken;
  } while (token);

  let names = {}, drives = listDrives_().map(function (d) {
    names[d.id] = d.name;
    // La propriété du Drive est établie ici : un Drive dont aucun gestionnaire n'est
    // chez vous appartient à une autre organisation et n'est pas votre exposition.
    const members = driveMembers_(d.id);
    const caps = d.capabilities || {};
    return {
      id: d.id, name: d.name, restrictions: d.restrictions || {},
      memberCount: members.length, ownership: driveOwnership(members, me),
      // sans canManageMembers, l'utilisateur ne peut pas agir sur ces partages
      manageable: !!caps.canManageMembers, canShare: !!caps.canShare,
      myRole: myRole(members, me),
      managerList: members.filter(function (m) { return m.role === 'organizer'; })
        .map(function (m) { return m.emailAddress || '?'; }).slice(0, 10)
    };
  });
  cachePut_('dn', JSON.stringify(names));

  return {
    me: me, rootId: rootId_(), levels: LEVELS, folders: folders, drives: drives,
    version: APP_VERSION, build: APP_BUILD,
    partnerAdmin: isPartnerAdmin_(me),   // le bouton de gestion n'est montré qu'à eux
    displayName: (about.user && about.user.displayName) || me.email,
    generated: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy 'à' HH:mm")
  };
}

/** Membres des seuls Drives partagés retenus par l'utilisateur. */
function getDriveMembers(driveIds) {
  return (driveIds || []).map(function (id) {
    return { id: id, members: driveMembers_(id) };
  });
}

/** Enregistrements complets pour des éléments précis (les dossiers choisis eux-mêmes). */
function scanItems(ids) {
  if (!ids || !ids.length) return [];
  let me = identity_(), rootId = rootId_(), names = driveNames_(), out = [];
  ids.slice(0, 100).forEach(function (id) {
    try {
      var f = withRetry_(function () {
        return Drive.Files.get(id, { fields: SINGLE_FILE_FIELDS, supportsAllDrives: true });
      });
      if (!f.permissions) {
        try { f.permissions = listAllPermissions(id); } catch (e) { f.permissions = []; }
      }
      out.push(toRecord_(f, me, names, new PathResolver(rootId, names, [f]),
        f.driveId ? driveScope_(f.driveId, me) : 'Mon Drive'));
    } catch (e) { /* élément illisible : ignoré */ }
  });
  return out;
}

/**
 * Analyse une page de résultats.
 * @param {Object} task {kind:'mydrive'|'drive'|'sharedWithMe', driveId, name}
 * @param {string} pageToken jeton de page, null pour la première
 * @return {Object} {records, nextPageToken, pending} — `pending` liste les éléments
 *   dont les permissions n'ont pas tenu dans le budget de temps : le client les
 *   réclame ensuite via hydrateFiles(). Rien n'est abandonné silencieusement.
 */
function scanPage(task, pageToken) {
  let me = identity_(), rootId = rootId_(), names = driveNames_();
  const args = {
    pageSize: task.kind === 'drive' ? 200 : 400, pageToken: pageToken || null,
    fields: FILE_FIELDS, supportsAllDrives: true, includeItemsFromAllDrives: true,
    q: 'trashed = false'
  };
  if (task.kind === 'folder') { args.q = "'" + task.folderId + "' in parents and trashed = false"; args.corpora = 'user'; args.spaces = 'drive'; }
  else if (task.kind === 'mydrive') { args.q = "'me' in owners and trashed = false"; args.corpora = 'user'; args.spaces = 'drive'; }
  else if (task.kind === 'sharedWithMe') { args.q = 'sharedWithMe and trashed = false'; args.corpora = 'user'; args.spaces = 'drive'; }
  else { args.corpora = 'drive'; args.driveId = task.driveId; }

  const resp = withRetry_(function () { return Drive.Files.list(args); });
  const files = resp.files || [];

  const members = {};
  if (task.kind === 'drive') members[task.driveId] = driveMembers_(task.driveId);
  const pending = hydratePermissions(files, members);

  const paths = new PathResolver(rootId, names, files);
  const scope = task.kind === 'sharedWithMe' ? 'Partagé avec moi'
    : (task.kind === 'drive' ? driveScope_(task.driveId, me) : 'Mon Drive');
  const records = files.map(function (f) { return toRecord_(f, me, names, paths, scope); });

  return { records: records, nextPageToken: resp.nextPageToken || null, pending: pending };
}

/** Complète les éléments laissés de côté par le budget de temps de scanPage(). */
function hydrateFiles(ids) {
  if (!ids || !ids.length) return {};
  let me = identity_(), out = {};
  ids.slice(0, 50).forEach(function (id) {
    try {
      var f = withRetry_(function () {
        return Drive.Files.get(id, { fields: 'id,mimeType', supportsAllDrives: true });
      });
      var perms = listAllPermissions(id);
      var s = summarizeFile(perms, me, f.mimeType === FOLDER_MIME);
      out[id] = { level: s.level.key, score: s.score, perms: s.perms };
    } catch (e) { /* élément devenu illisible : on garde ce que le scan avait */ }
  });
  return out;
}

/** Crée un Google Sheet à partir du CSV exporté depuis le tableau de bord. */
function exportCsv(csvText, rowCount) {
  if (typeof csvText !== 'string' || !csvText.length) throw new Error('Export vide.');
  if (Utilities.newBlob(csvText).getBytes().length > MAX_EXPORT_BYTES) {
    throw new Error('Export trop volumineux (> 20 Mo) : affinez les filtres.');
  }
  const name = 'Partages Drive — sélection ' +
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
  const file = withRetry_(function () {
    return Drive.Files.create(
      { name: name, mimeType: MimeType.GOOGLE_SHEETS },
      Utilities.newBlob(csvText, 'text/csv', name + '.csv'),
      { fields: 'id,webViewLink', supportsAllDrives: true });
  });
  return { url: file.webViewLink, name: name, rows: Number(rowCount) || 0 };
}

/** « Drive partagé » (le vôtre) ou « Drive externe » (celui d'une autre organisation). */
function driveScope_(driveId, me) {
  return driveOwnership(driveMembers_(driveId), me) === 'external'
    ? 'Drive externe' : 'Drive partagé';
}

/** Un fichier brut de l'API → une ligne du rapport. */
function toRecord_(f, me, names, paths, scope) {
  const isFolder = f.mimeType === FOLDER_MIME;
  const s = summarizeFile(f.permissions || [], me, isFolder);
  const owner = (f.owners && f.owners[0] && f.owners[0].emailAddress) || '';
  // Dans un Drive partagé, les fichiers appartiennent au Drive : `owners` est vide.
  // Le dernier contributeur est alors le seul indice de qui, chez vous, y travaille.
  const editor = (f.lastModifyingUser && f.lastModifyingUser.emailAddress) || '';
  const editorId = (f.lastModifyingUser && f.lastModifyingUser.permissionId) || '';
  const container = scope === 'Partagé avec moi' ? 'Partagé avec moi'
    : (f.driveId ? (names[f.driveId] || 'Drive partagé') : 'Mon Drive');
  return {
    id: f.id, name: f.name || '(sans nom)', mime: f.mimeType || '', folder: isFolder,
    scope: scope, container: container,
    // le chemin ne coûte des appels que pour ce qui est effectivement partagé
    path: (s.level.rank > 0 || isFolder) ? paths.resolve(f, names) : container,
    owner: owner, ownerIsMe: isSelf(me, owner),
    lastEditor: editor, lastEditorId: editorId,
    lastEditorInternal: !!editor && (isSelf(me, editor) || isInternal(me, editor)),
    level: s.level.key, score: s.score,
    modified: (f.modifiedTime || '').slice(0, 10),
    size: Number(f.size || f.quotaBytesUsed || 0),
    link: f.webViewLink || '', perms: s.perms
  };
}

/* ----------------------------------------- créateurs (Drive Activity API v2) */

/**
 * Qui a créé les éléments d'un Drive ? L'API Drive n'expose pas le créateur : seule
 * l'API Drive Activity le donne, et sous forme d'identifiant « people/<id> » — jamais
 * d'adresse. Cet identifiant est le même que l'identifiant de permission Drive, ce qui
 * permet de le résoudre côté navigateur avec les membres du Drive déjà connus,
 * sans recourir à l'API People ni à une portée supplémentaire.
 *
 * @return {Object} {creators: {fileId: personId}, nextPageToken, available}
 *   `available: false` signale que le service avancé n'est pas activé : le rapport
 *   retombe alors sur le dernier contributeur, sans échouer.
 */
function creatorsForDrive(driveId, pageToken) {
  try {
    var resp = withRetry_(function () {
      return DriveActivity.Activity.query({
        ancestorName: 'items/' + driveId,
        filter: 'detail.action_detail_case:CREATE',
        pageSize: 500,
        pageToken: pageToken || null,
        consolidationStrategy: { none: {} }
      });
    });
  } catch (e) {
    return {
      creators: {}, nextPageToken: null, available: false,
      error: String(e && e.message || e).slice(0, 200)
    };
  }
  const creators = {};
  (resp.activities || []).forEach(function (a) {
    const actor = (a.actors || [])[0];
    const known = actor && actor.user && actor.user.knownUser;
    if (!known || !known.personName) return;
    const pid = String(known.personName).replace('people/', '');
    (a.targets || []).forEach(function (t) {
      const name = t.driveItem && t.driveItem.name;      // « items/<fileId> »
      if (name) creators[String(name).replace('items/', '')] = pid;
    });
  });
  return { creators: creators, nextPageToken: resp.nextPageToken || null, available: true };
}

/* ------------------------------------------------- export Google Sheets natif */

var SHEET_SUM = 'Synthèse', SHEET_ITEMS = 'Éléments', SHEET_PERMS = 'Permissions';

/**
 * Crée le classeur et y écrit la synthèse + les en-têtes.
 * Les valeurs sont écrites en `RAW` : aucune cellule n'est interprétée comme une
 * formule, ce qui neutralise à la source toute injection via un nom de fichier.
 */
function createSheetsExport(payload) {
  const ss = withRetry_(function () {
    return Sheets.Spreadsheets.create({
      properties: { title: payload.title, locale: 'fr_FR' },
      sheets: [{ properties: { title: SHEET_SUM } },
      { properties: { title: SHEET_ITEMS } },
      { properties: { title: SHEET_PERMS } }]
    });
  });
  const id = ss.spreadsheetId;
  writeRows_(id, SHEET_SUM, 1, payload.summary);
  writeRows_(id, SHEET_ITEMS, 1, [payload.itemHeaders]);
  writeRows_(id, SHEET_PERMS, 1, [payload.permHeaders]);
  return { id: id, url: ss.spreadsheetUrl || 'https://docs.google.com/spreadsheets/d/' + id };
}

/** Écrit une tranche de lignes ; renvoie la prochaine ligne libre. */
function appendSheetRows(id, sheetName, startRow, rows) {
  writeRows_(id, sheetName, startRow, rows);
  return startRow + (rows ? rows.length : 0);
}

function writeRows_(id, sheetName, startRow, rows) {
  if (!rows || !rows.length) return;
  withRetry_(function () {
    return Sheets.Spreadsheets.Values.update({ values: rows }, id,
      "'" + sheetName + "'!A" + startRow, { valueInputOption: 'RAW' });
  });
}

/** Gel des en-têtes, gras, filtres, largeurs automatiques. */
function finishSheetsExport(id, itemCols, permCols) {
  const meta = withRetry_(function () {
    return Sheets.Spreadsheets.get(id, { fields: 'sheets(properties(sheetId,title))' });
  });
  const ids = {};
  meta.sheets.forEach(function (sh) { ids[sh.properties.title] = sh.properties.sheetId; });

  const reqs = [];
  [[SHEET_ITEMS, itemCols], [SHEET_PERMS, permCols]].forEach(function (pair) {
    const sid = ids[pair[0]];
    if (sid === undefined) return;
    reqs.push({
      repeatCell: {
        range: { sheetId: sid, startRowIndex: 0, endRowIndex: 1 },
        cell: {
          userEnteredFormat: {
            textFormat: { bold: true },
            backgroundColorStyle: { rgbColor: { red: .94, green: .94, blue: .92 } }
          }
        },
        fields: 'userEnteredFormat(textFormat,backgroundColorStyle)'
      }
    });
    reqs.push({
      updateSheetProperties: {
        properties: { sheetId: sid, gridProperties: { frozenRowCount: 1 } },
        fields: 'gridProperties.frozenRowCount'
      }
    });
    reqs.push({ setBasicFilter: { filter: { range: { sheetId: sid } } } });
    reqs.push({
      autoResizeDimensions: {
        dimensions: {
          sheetId: sid, dimension: 'COLUMNS',
          startIndex: 0, endIndex: pair[1]
        }
      }
    });
  });
  if (ids[SHEET_SUM] !== undefined) {
    reqs.push({
      repeatCell: {
        range: { sheetId: ids[SHEET_SUM], startRowIndex: 0, endRowIndex: 1 },
        cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 13 } } },
        fields: 'userEnteredFormat.textFormat'
      }
    });
    reqs.push({
      autoResizeDimensions: {
        dimensions: {
          sheetId: ids[SHEET_SUM],
          dimension: 'COLUMNS', startIndex: 0, endIndex: 6
        }
      }
    });
  }
  withRetry_(function () { return Sheets.Spreadsheets.batchUpdate({ requests: reqs }, id); });
  return { url: 'https://docs.google.com/spreadsheets/d/' + id };
}

/* ------------------------------------------------------------------ internes */

function listAllPermissions(fileId) {
  let out = [], token = null;
  do {
    var resp = withRetry_(function () {
      return Drive.Permissions.list(fileId, {
        pageSize: 100, pageToken: token, fields: PERM_FIELDS, supportsAllDrives: true
      });
    });
    out = out.concat(resp.permissions || []);
    token = resp.nextPageToken;
  } while (token);
  return out;
}

/**
 * files.list ne renvoie pas les permissions des éléments de Drive partagé.
 * Élément sans permission propre : on injecte les membres du Drive (hérités).
 * Élément avec permission propre : appel permissions.list.
 * @return {Array<string>} identifiants non traités faute de temps (repris par le client)
 */
function hydratePermissions(files, driveMembers) {
  let started = Date.now(), pending = [];
  files.forEach(function (f) {
    // L'héritage de Drive partagé est testé EN PREMIER : files.list peut renvoyer une
    // liste de permissions vide pour ces éléments, et un test « length < 100 » placé
    // avant sortirait de la boucle sans jamais injecter les membres du Drive —
    // l'élément serait alors classé « Non partagé » à tort.
    if (f.driveId && !f.hasAugmentedPermissions) {
      f.permissions = (driveMembers[f.driveId] || []).map(function (p) {
        return {
          type: p.type, role: p.role, emailAddress: p.emailAddress,
          domain: p.domain, displayName: p.displayName,
          permissionDetails: [{
            inherited: true, inheritedFrom: f.driveId,
            permissionType: 'member', role: p.role
          }]
        };
      });
      return;
    }
    if (f.permissions && f.permissions.length && f.permissions.length < 100) return;
    if (!f.shared && !f.driveId && f.permissions) return;
    if (Date.now() - started > HYDRATE_BUDGET_MS) { pending.push(f.id); return; }
    try {
      f.permissions = listAllPermissions(f.id);
    } catch (e) {
      f.permissions = f.permissions || [];
    }
  });
  return pending;
}

/** Résolution des chemins « Mon Drive / Dossier / Sous-dossier », avec cache utilisateur. */
function PathResolver(rootId, driveNames, seedFiles) {
  const cache = CacheService.getUserCache();
  const local = {};
  (seedFiles || []).forEach(function (f) {
    local[f.id] = { name: f.name, parents: f.parents || [] };
  });

  function node(id) {
    if (local[id]) return local[id];
    const hit = cacheGet_('n_' + id);
    if (hit) { local[id] = JSON.parse(hit); return local[id]; }
    try {
      var f = withRetry_(function () {
        return Drive.Files.get(id, { fields: 'id,name,parents', supportsAllDrives: true });
      });
      local[id] = { name: f.name, parents: f.parents || [] };
    } catch (e) {
      local[id] = { name: '…', parents: [] };
    }
    cachePut_('n_' + id, JSON.stringify(local[id]));
    return local[id];
  }

  this.resolve = function (f, names) {
    names = names || driveNames || {};
    let parts = [], seen = {}, cur = (f.parents || [])[0];
    while (cur && !seen[cur] && parts.length < 25) {
      seen[cur] = true;
      if (cur === rootId) { parts.push('Mon Drive'); break; }
      if (names[cur]) { parts.push(names[cur]); break; }
      var n = node(cur);
      parts.push(n.name);
      cur = (n.parents || [])[0];
    }
    if (!parts.length) parts.push(f.driveId ? (names[f.driveId] || 'Drive partagé') : 'Mon Drive');
    return parts.reverse().join(' / ');
  };
}

