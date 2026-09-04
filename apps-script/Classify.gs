/**
 * Classification des partages : niveaux d'exposition, rôles, score de risque.
 * Port JavaScript de gdshares/classify.py — les deux versions doivent rester alignées.
 */

var CONSUMER_DOMAINS = ['gmail.com', 'googlemail.com'];
var FOLDER_MIME = 'application/vnd.google-apps.folder';

var LEVELS = [
  { key: 'public_indexed', rank: 60, label: 'Public sur le web (indexable)', short: 'Public web', icon: '🌐', status: 'critical', hint: "Accessible à tout internaute, et référençable par les moteurs de recherche." },
  { key: 'public_link', rank: 50, label: 'Public : toute personne disposant du lien', short: 'Lien public', icon: '🔗', status: 'critical', hint: "Accessible sans authentification à quiconque possède l'URL." },
  { key: 'external_domain', rank: 45, label: 'Ouvert à un domaine externe entier', short: 'Domaine externe', icon: '🏢', status: 'serious', hint: "Tous les comptes d'une autre organisation y ont accès." },
  { key: 'external_user', rank: 40, label: "Partagé hors de l'organisation", short: 'Externe', icon: '👤', status: 'serious', hint: "Des comptes extérieurs à votre organisation sont destinataires." },
  { key: 'partner', rank: 38, label: 'Partagé avec un partenaire référencé', short: 'Partenaire', icon: '🤝', status: 'warning', hint: "Destinataire hors organisation, mais figurant dans votre liste de domaines partenaires approuvés." },
  { key: 'domain_indexed', rank: 30, label: "Toute l'organisation (trouvable en recherche)", short: 'Org. trouvable', icon: '🏛️', status: 'warning', hint: "Tout collaborateur du domaine peut le trouver et l'ouvrir." },
  { key: 'domain_link', rank: 25, label: "Toute l'organisation via le lien", short: 'Org. lien', icon: '🏛️', status: 'warning', hint: "Tout collaborateur du domaine disposant du lien peut l'ouvrir." },
  { key: 'internal', rank: 15, label: 'Partagé en interne (personnes nommées)', short: 'Interne', icon: '👥', status: 'good', hint: "Partage nominatif avec des membres de l'organisation." },
  { key: 'private', rank: 0, label: 'Non partagé', short: 'Privé', icon: '🔒', status: 'neutral', hint: "Vous seul (et le cas échéant les membres du Drive partagé) y avez accès." }
];
var BY_KEY = LEVELS.reduce(function (acc, l) { acc[l.key] = l; return acc; }, {});

var ROLE_LABELS = {
  owner: 'Propriétaire', organizer: 'Gestionnaire', fileOrganizer: 'Gestionnaire de contenu',
  writer: 'Éditeur', commenter: 'Commentateur', reader: 'Lecteur'
};
var ROLE_RANK = { reader: 1, commenter: 2, writer: 3, fileOrganizer: 4, organizer: 5, owner: 6 };
var WRITE_ROLES = ['writer', 'fileOrganizer', 'organizer', 'owner'];

function emailDomain(email) {
  return email && email.indexOf('@') > -1 ? email.split('@').pop().toLowerCase() : '';
}

/**
 * Identité de l'utilisateur audité : ce qui compte comme « interne » pour lui.
 * `extraDomains` porte les domaines secondaires et alias de l'organisation — sans eux,
 * une collègue dont l'adresse est sur un domaine secondaire serait comptée externe.
 */
function makeIdentity(email, extraDomains, partnerDomains) {
  const mail = (email || '').toLowerCase();
  const dom = emailDomain(mail);
  const consumer = !dom || CONSUMER_DOMAINS.indexOf(dom) > -1;
  const norm = function (d) { return String(d || '').trim().replace(/^@/, '').trim().toLowerCase(); };
  const domains = [];
  (extraDomains || []).forEach(function (d) {
    d = norm(d);
    if (d && domains.indexOf(d) === -1) domains.push(d);
  });
  if (!consumer && domains.indexOf(dom) === -1) domains.push(dom);
  // liste blanche : externes approuvés. Un domaine interne ne peut pas être partenaire.
  const partners = [];
  (partnerDomains || []).forEach(function (d) {
    d = norm(d);
    if (d && domains.indexOf(d) === -1 && partners.indexOf(d) === -1) partners.push(d);
  });
  return { email: mail, domain: consumer ? '' : dom, consumer: consumer,
           domains: domains, partners: partners };
}

function isSelf(me, email) { return !!email && email.toLowerCase() === me.email; }

function isInternalDomain(me, domain) {
  if (!domain) return false;
  return (me.domains || []).indexOf(String(domain).toLowerCase().replace(/^@/, '')) > -1;
}

function isPartnerDomain(me, domain) {
  if (!domain) return false;
  return (me.partners || []).indexOf(String(domain).trim().replace(/^@/, '').toLowerCase()) > -1;
}

function isPartner(me, email) {
  return !!email && isPartnerDomain(me, emailDomain(email));
}

function isInternal(me, email) {
  if (!email) return false;
  return me.consumer ? isSelf(me, email) : isInternalDomain(me, emailDomain(email));
}

/**
 * À qui appartient ce Drive partagé : 'internal', 'external' ou 'unknown'.
 * Un Drive dont aucun gestionnaire n'est chez vous appartient à une autre organisation :
 * vous y êtes invité, ce n'est pas votre exposition. Preuve positive exigée pour
 * conclure « external », car ce verdict sort le Drive des statistiques.
 */
function driveOwnership(members, me) {
  if (!members || !members.length) return 'unknown';
  const organizers = members.filter(function (m) { return m.role === 'organizer'; });
  if (!organizers.length) return 'unknown';
  const mine = organizers.some(function (m) {
    return isSelf(me, m.emailAddress) || isInternal(me, m.emailAddress);
  });
  return mine ? 'internal' : 'external';
}

/**
 * Mon rôle dans ce Drive partagé, tel qu'il figure dans ses membres.
 * Renvoie '' si l'accès passe par un groupe : la capacité déclarée par l'API
 * (canManageMembers) fait alors autorité.
 */
function myRole(members, me) {
  const mine = (members || []).filter(function (m) {
    return m.type === 'user' && isSelf(me, m.emailAddress);
  })[0];
  return mine ? (mine.role || '') : '';
}

function classifyPermission(p, me) {
  if (p.type === 'anyone') return p.allowFileDiscovery ? BY_KEY.public_indexed : BY_KEY.public_link;
  if (p.type === 'domain') {
    var dom = (p.domain || '').toLowerCase();
    if (!me.consumer && isInternalDomain(me, dom)) {
      return p.allowFileDiscovery ? BY_KEY.domain_indexed : BY_KEY.domain_link;
    }
    return isPartnerDomain(me, dom) ? BY_KEY.partner : BY_KEY.external_domain;
  }
  if (isSelf(me, p.emailAddress)) return BY_KEY.private;
  if (isInternal(me, p.emailAddress)) return BY_KEY.internal;
  return isPartner(me, p.emailAddress) ? BY_KEY.partner : BY_KEY.external_user;
}

function isGrant(p, me) {
  if (p.deleted) return false;
  if ((p.type === 'user' || p.type === 'group') && isSelf(me, p.emailAddress)) return false;
  return true;
}

function principalOf(p) {
  if (p.type === 'anyone') return 'Tout internaute';
  if (p.type === 'domain') return '@' + (p.domain || '?');
  return p.emailAddress || p.displayName || '(inconnu)';
}

function riskScore(level, grants, isFolder, me) {
  let base = { public_indexed: 95, public_link: 85, external_domain: 72, external_user: 60,
               partner: 38, domain_indexed: 42, domain_link: 36, internal: 18, private: 0 }[level.key];
  if (!base) return 0;
  let score = base, ext = 0, extWrite = false, anyWrite = false, permanentLink = false;
  grants.forEach(function (p) {
    const rank = classifyPermission(p, me).rank;
    const write = WRITE_ROLES.indexOf(p.role) > -1;
    if (rank >= 40) { ext++; if (write) extWrite = true; }
    if (write) anyWrite = true;
    // le lien public lui-même doit être sans expiration — pas un autre destinataire
    if (p.type === 'anyone' && !p.expirationTime) permanentLink = true;
  });
  score += extWrite ? 8 : (anyWrite ? 4 : 0);
  score += Math.min(ext, 5);
  if (isFolder) score += 6;
  if (permanentLink) score += 2;
  return Math.max(0, Math.min(100, score));
}

/** Niveau maximal, score et permissions normalisées (hors moi-même). */
function summarizeFile(perms, me, isFolder) {
  const grants = (perms || []).filter(function (p) { return isGrant(p, me); });
  let top = BY_KEY.private;
  const rows = grants.map(function (p) {
    const lv = classifyPermission(p, me);
    if (lv.rank > top.rank) top = lv;
    const d = (p.permissionDetails || [{}])[0] || {};
    return {
      principal: principalOf(p), type: p.type, role: p.role,
      roleLabel: ROLE_LABELS[p.role] || p.role || '?', level: lv.key,
      discoverable: !!p.allowFileDiscovery, inherited: !!d.inherited,
      inheritedFrom: d.inheritedFrom || null, expires: p.expirationTime || null,
      pendingOwner: !!p.pendingOwner
    };
  });
  rows.sort(function (a, b) {
    return (BY_KEY[b.level].rank - BY_KEY[a.level].rank) ||
           ((ROLE_RANK[b.role] || 0) - (ROLE_RANK[a.role] || 0)) ||
           (a.principal < b.principal ? -1 : 1);
  });
  return { level: top, score: riskScore(top, grants, isFolder, me), perms: rows };
}
