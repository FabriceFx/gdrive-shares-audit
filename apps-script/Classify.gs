/**
 * Classification des partages : niveaux d'exposition, rôles, score de risque.
 * Port JavaScript de gdshares/classify.py — les deux versions doivent rester alignées.
 *
 * Les noms de fonctions y sont volontairement restés proches de ceux du module
 * Python : c'est ce qui permet de relire les deux côte à côte et de voir qu'ils
 * disent la même chose. Tous portent un « _ » final — aucun n'est un point
 * d'entrée, et l'éditeur Apps Script ne propose au menu d'exécution que les
 * `function` déclarées.
 */

const CONSUMER_DOMAINS = ['gmail.com', 'googlemail.com'];
const FOLDER_MIME = 'application/vnd.google-apps.folder';

const LEVELS = [
  { key: 'public_indexed', rank: 60, label: 'Public sur le web (indexable)', short: 'Public web', icon: '🌐', status: 'critical', hint: "Accessible à tout internaute, et référençable par les moteurs de recherche." },
  { key: 'public_link', rank: 50, label: 'Public : toute personne disposant du lien', short: 'Lien public', icon: '🔗', status: 'critical', hint: "Accessible sans authentification à quiconque possède l'URL." },
  { key: 'external_domain', rank: 45, label: 'Ouvert à un domaine externe entier', short: 'Domaine externe', icon: '🏢', status: 'serious', hint: "Tous les comptes d'une autre organisation y ont accès." },
  { key: 'external_user', rank: 40, label: "Partagé hors de l'organisation", short: 'Externe', icon: '👤', status: 'serious', hint: "Des comptes extérieurs à votre organisation sont destinataires." },
  { key: 'partner', rank: 38, label: 'Partagé avec un partenaire référencé', short: 'Partenaire', icon: '🤝', status: 'warning', hint: "Destinataire hors organisation, mais figurant dans votre liste de domaines partenaires approuvés." },
  { key: 'domain_indexed', rank: 30, label: "Toute l'organisation (trouvable en recherche)", short: 'Org. trouvable', icon: '🏛️', status: 'warning', hint: "Tout collaborateur du domaine peut le trouver et l'ouvrir." },
  { key: 'domain_link', rank: 25, label: "Toute l'organisation via le lien", short: 'Org. lien', icon: '🏛️', status: 'warning', hint: "Tout collaborateur du domaine disposant du lien peut l'ouvrir." },
  { key: 'internal', rank: 15, label: 'Partagé en interne (personnes nommées)', short: 'Interne', icon: '👥', status: 'good', hint: "Partage nominatif avec des membres de l'organisation." },
  { key: 'private', rank: 0, label: 'Non partagé', short: 'Privé', icon: '🔒', status: 'neutral', hint: "Vous seul (et le cas échéant les membres du Drive partagé) y avez accès." },
];

/** Index par clé. Objet `const` muté en place : une liaison `let` globale traverse mal les fichiers. */
const BY_KEY = {};
LEVELS.forEach((niveau) => { BY_KEY[niveau.key] = niveau; });

const ROLE_LABELS = {
  owner: 'Propriétaire', organizer: 'Gestionnaire', fileOrganizer: 'Gestionnaire de contenu',
  writer: 'Éditeur', commenter: 'Commentateur', reader: 'Lecteur',
};
const ROLE_RANK = { reader: 1, commenter: 2, writer: 3, fileOrganizer: 4, organizer: 5, owner: 6 };
const WRITE_ROLES = ['writer', 'fileOrganizer', 'organizer', 'owner'];

/** Bases du score par niveau d'exposition. Sorties du corps de `riskScore_` pour être relisibles. */
const RISK_BASE = {
  public_indexed: 95, public_link: 85, external_domain: 72, external_user: 60,
  partner: 38, domain_indexed: 42, domain_link: 36, internal: 18, private: 0,
};

const emailDomain_ = (email) => (email && email.includes('@')
  ? email.split('@').pop().toLowerCase() : '');

const normaliserDomaine_ = (domaine) => String(domaine || '')
  .trim().replace(/^@/, '').trim().toLowerCase();

/**
 * Identité de l'utilisateur audité : ce qui compte comme « interne » pour lui.
 * `extraDomains` porte les domaines secondaires et alias de l'organisation — sans eux,
 * une collègue dont l'adresse est sur un domaine secondaire serait comptée externe.
 */
const makeIdentity_ = (email, extraDomains, partnerDomains) => {
  const mail = (email || '').toLowerCase();
  const dom = emailDomain_(mail);
  const consumer = !dom || CONSUMER_DOMAINS.includes(dom);

  const domains = [];
  (extraDomains || []).forEach((brut) => {
    const d = normaliserDomaine_(brut);
    if (d && !domains.includes(d)) domains.push(d);
  });
  if (!consumer && !domains.includes(dom)) domains.push(dom);

  // Liste blanche : externes approuvés. Un domaine interne ne peut pas être partenaire.
  const partners = [];
  (partnerDomains || []).forEach((brut) => {
    const d = normaliserDomaine_(brut);
    if (d && !domains.includes(d) && !partners.includes(d)) partners.push(d);
  });

  return { email: mail, domain: consumer ? '' : dom, consumer, domains, partners };
};

const isSelf_ = (me, email) => !!email && email.toLowerCase() === me.email;

const isInternalDomain_ = (me, domain) => (domain
  ? (me.domains || []).includes(normaliserDomaine_(domain)) : false);

const isPartnerDomain_ = (me, domain) => (domain
  ? (me.partners || []).includes(normaliserDomaine_(domain)) : false);

const isPartner_ = (me, email) => !!email && isPartnerDomain_(me, emailDomain_(email));

const isInternal_ = (me, email) => {
  if (!email) return false;
  return me.consumer ? isSelf_(me, email) : isInternalDomain_(me, emailDomain_(email));
};

/**
 * À qui appartient ce Drive partagé : 'internal', 'external' ou 'unknown'.
 * Un Drive dont aucun gestionnaire n'est chez vous appartient à une autre organisation :
 * vous y êtes invité, ce n'est pas votre exposition. Preuve positive exigée pour
 * conclure « external », car ce verdict sort le Drive des statistiques.
 */
const driveOwnership_ = (members, me) => {
  if (!members || !members.length) return 'unknown';
  const organizers = members.filter((m) => m.role === 'organizer');
  if (!organizers.length) return 'unknown';
  const mine = organizers.some((m) => isSelf_(me, m.emailAddress) || isInternal_(me, m.emailAddress));
  return mine ? 'internal' : 'external';
};

/**
 * Mon rôle dans ce Drive partagé, tel qu'il figure dans ses membres.
 * Rend '' si l'accès passe par un groupe : la capacité déclarée par l'API
 * (canManageMembers) fait alors autorité.
 */
const myRole_ = (members, me) => {
  const mine = (members || []).find((m) => m.type === 'user' && isSelf_(me, m.emailAddress));
  return mine ? (mine.role || '') : '';
};

const classifyPermission_ = (p, me) => {
  if (p.type === 'anyone') return p.allowFileDiscovery ? BY_KEY.public_indexed : BY_KEY.public_link;
  if (p.type === 'domain') {
    const dom = (p.domain || '').toLowerCase();
    if (!me.consumer && isInternalDomain_(me, dom)) {
      return p.allowFileDiscovery ? BY_KEY.domain_indexed : BY_KEY.domain_link;
    }
    return isPartnerDomain_(me, dom) ? BY_KEY.partner : BY_KEY.external_domain;
  }
  if (isSelf_(me, p.emailAddress)) return BY_KEY.private;
  if (isInternal_(me, p.emailAddress)) return BY_KEY.internal;
  return isPartner_(me, p.emailAddress) ? BY_KEY.partner : BY_KEY.external_user;
};

const isGrant_ = (p, me) => {
  if (p.deleted) return false;
  if ((p.type === 'user' || p.type === 'group') && isSelf_(me, p.emailAddress)) return false;
  return true;
};

const principalOf_ = (p) => {
  if (p.type === 'anyone') return 'Tout internaute';
  if (p.type === 'domain') return `@${p.domain || '?'}`;
  return p.emailAddress || p.displayName || '(inconnu)';
};

/**
 * Score de 0 à 100, à partir du niveau d'exposition et de ce que les
 * destinataires peuvent faire.
 *
 * Le `!base` en tête n'est pas une maladresse : il rend 0 pour `private`, dont
 * la base est 0, et coupe ainsi les bonus de dossier et de lien permanent. Un
 * fichier que personne d'autre ne voit ne porte aucun risque parce qu'il est
 * un dossier. Le remplacer par `base === undefined` changerait ce résultat.
 */
const riskScore_ = (level, grants, isFolder, me) => {
  const base = RISK_BASE[level.key];
  if (!base) return 0;

  let score = base;
  let externes = 0;
  let ecritureExterne = false;
  let ecriture = false;
  let lienPermanent = false;

  grants.forEach((p) => {
    const { rank } = classifyPermission_(p, me);
    const peutEcrire = WRITE_ROLES.includes(p.role);
    if (rank >= 40) {
      externes += 1;
      if (peutEcrire) ecritureExterne = true;
    }
    if (peutEcrire) ecriture = true;
    // Le lien public lui-même doit être sans expiration — pas un autre destinataire.
    if (p.type === 'anyone' && !p.expirationTime) lienPermanent = true;
  });

  if (ecritureExterne) score += 8;
  else if (ecriture) score += 4;
  score += Math.min(externes, 5);
  if (isFolder) score += 6;
  if (lienPermanent) score += 2;

  return Math.max(0, Math.min(100, score));
};

/** Niveau maximal, score et permissions normalisées (hors moi-même). */
const summarizeFile_ = (perms, me, isFolder) => {
  const grants = (perms || []).filter((p) => isGrant_(p, me));
  let top = BY_KEY.private;

  const rows = grants.map((p) => {
    const lv = classifyPermission_(p, me);
    if (lv.rank > top.rank) top = lv;
    const detail = (p.permissionDetails || [{}])[0] || {};
    return {
      principal: principalOf_(p), type: p.type, role: p.role,
      roleLabel: ROLE_LABELS[p.role] || p.role || '?', level: lv.key,
      discoverable: !!p.allowFileDiscovery, inherited: !!detail.inherited,
      inheritedFrom: detail.inheritedFrom || null, expires: p.expirationTime || null,
      pendingOwner: !!p.pendingOwner,
    };
  });

  rows.sort((a, b) => (BY_KEY[b.level].rank - BY_KEY[a.level].rank)
    || ((ROLE_RANK[b.role] || 0) - (ROLE_RANK[a.role] || 0))
    || (a.principal < b.principal ? -1 : 1));

  return { level: top, score: riskScore_(top, grants, isFolder, me), perms: rows };
};
