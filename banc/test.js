// Banc d'essai — se lance hors de Google :
//
//     node banc/test.js
//
// Il couvre `Classify.gs`, qui est de la logique pure : c'est là que se décide
// ce qui compte comme interne, externe ou partenaire, et une erreur y produit
// un rapport faux qui a l'air juste. `Code.gs` n'est pas simulé — il n'est
// qu'un assemblage d'appels à l'API Drive — mais le banc vérifie tout de même
// sur lui l'invariant qui casserait l'outil en silence : les fonctions que le
// client appelle par leur nom doivent rester des `function` déclarées.
//
// Ce banc a été écrit AVANT la conversion en ES6+, pour figer le comportement
// existant. Un test qui n'a jamais vu passer l'ancien code ne prouve rien de
// la conversion.

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const DOSSIER = path.join(RACINE, 'apps-script');

let passes = 0;
const echecs = [];
let courante = '';
const section = (titre) => { courante = titre; console.log(`\n— ${titre}`); };
const verifier = (condition, message) => {
  if (condition) { passes += 1; return; }
  echecs.push(`${courante} · ${message}`);
  console.log(`  ÉCHEC : ${message}`);
};
const egal = (obtenu, attendu, message) => verifier(
  JSON.stringify(obtenu) === JSON.stringify(attendu),
  `${message} — attendu ${JSON.stringify(attendu)}, obtenu ${JSON.stringify(obtenu)}`);

// ---------------------------------------------------------------------------

const sandbox = { console, JSON, Math, Number, String, Object, Array, Boolean, RegExp, Error, Date };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(DOSSIER, 'Classify.gs'), 'utf8'),
  sandbox, { filename: 'Classify.gs' });
const lire = (expression) => vm.runInContext(expression, sandbox);

// Les noms internes prennent un « _ » à la conversion ; le banc accepte les
// deux formes, pour pouvoir tourner avant comme après.
const fn = (nom) => {
  const trouve = lire(`typeof ${nom}_ === 'function' ? ${nom}_ : (typeof ${nom} === 'function' ? ${nom} : null)`);
  if (!trouve) throw new Error(`Ni ${nom} ni ${nom}_ n'existe dans Classify.gs`);
  return trouve;
};

const makeIdentity = fn('makeIdentity');
const classifyPermission = fn('classifyPermission');
const summarizeFile = fn('summarizeFile');
const driveOwnership = fn('driveOwnership');
const myRole = fn('myRole');
const isGrant = fn('isGrant');
const principalOf = fn('principalOf');
const riskScore = fn('riskScore');
const emailDomain = fn('emailDomain');

const MOI = makeIdentity('alice@cooperl.test',
  ['cooperl.test', 'cooperl-secondaire.test', '@AVEC-AROBASE.test '],
  ['client.test']);

// ---------------------------------------------------------------------------

section('A. Identité de la personne auditée');
{
  egal(emailDomain('a@B.FR'), 'b.fr', 'le domaine est extrait et mis en minuscules');
  egal(emailDomain('sans-arobase'), '', 'une adresse sans arobase ne rend aucun domaine');

  egal(MOI.domains, ['cooperl.test', 'cooperl-secondaire.test', 'avec-arobase.test'],
    'les domaines secondaires sont normalisés : arobase retirée, espaces coupés, minuscules');
  egal(MOI.partners, ['client.test'], 'les partenaires sont à part');
  egal(MOI.consumer, false, 'un compte de domaine n’est pas un compte grand public');

  const doublon = makeIdentity('a@x.test', ['x.test'], ['x.test']);
  egal(doublon.partners, [],
    'un domaine à la fois interne et partenaire reste interne — l’interne l’emporte');

  // Le domaine principal se déduit de l'adresse : sans cela, une organisation
  // qui ne déclare aucun domaine secondaire verrait TOUS ses collègues classés
  // « hors de l'organisation ». C'est le cas par défaut, donc le plus exposé.
  const sansDeclaration = makeIdentity('alice@cooperl.test', [], []);
  egal(sansDeclaration.domains, ['cooperl.test'],
    'le domaine principal est déduit de l’adresse, même sans déclaration');
  egal(classifyPermission({ type: 'user', emailAddress: 'bob@cooperl.test' }, sansDeclaration).key,
    'internal', 'et un collègue du domaine principal est donc bien interne');

  const perso = makeIdentity('bob@gmail.com', [], []);
  egal(perso.consumer, true, 'une adresse Gmail est reconnue comme compte grand public');
  egal(perso.domains, [], 'et son domaine n’est jamais compté comme interne');
}

section('B. Classement d’une permission');
{
  const niveau = (p) => classifyPermission(p, MOI).key;

  egal(niveau({ type: 'anyone', allowFileDiscovery: true }), 'public_indexed',
    'lien public indexable');
  egal(niveau({ type: 'anyone', allowFileDiscovery: false }), 'public_link',
    'lien public non indexé');
  egal(niveau({ type: 'domain', domain: 'cooperl.test', allowFileDiscovery: true }), 'domain_indexed',
    'domaine interne trouvable en recherche');
  egal(niveau({ type: 'domain', domain: 'COOPERL-SECONDAIRE.test' }), 'domain_link',
    'un domaine secondaire est interne, quelle que soit sa casse');
  egal(niveau({ type: 'domain', domain: 'client.test' }), 'partner',
    'un domaine partenaire n’est pas un domaine externe quelconque');
  egal(niveau({ type: 'domain', domain: 'inconnu.test' }), 'external_domain',
    'un domaine inconnu entier est une exposition sérieuse');
  egal(niveau({ type: 'user', emailAddress: 'alice@cooperl.test' }), 'private',
    'moi-même ne suis pas un partage');
  egal(niveau({ type: 'user', emailAddress: 'bob@cooperl-secondaire.test' }), 'internal',
    'un collègue sur un domaine secondaire est interne');
  egal(niveau({ type: 'user', emailAddress: 'paul@client.test' }), 'partner',
    'un destinataire partenaire est nommé comme tel');
  egal(niveau({ type: 'user', emailAddress: 'x@inconnu.test' }), 'external_user',
    'un destinataire inconnu est externe');

  // Le piège du compte grand public : sans domaine interne, seul « moi » est interne.
  const perso = makeIdentity('bob@gmail.com', [], []);
  egal(classifyPermission({ type: 'user', emailAddress: 'bob@gmail.com' }, perso).key, 'private',
    'sur un compte grand public, moi-même reste privé');
  egal(classifyPermission({ type: 'user', emailAddress: 'autre@gmail.com' }, perso).key, 'external_user',
    'et tout autre gmail est externe — pas « interne » parce que même domaine');
}

section('C. Ce qui compte comme partage');
{
  verifier(!isGrant({ deleted: true, type: 'user', emailAddress: 'x@y.test' }, MOI),
    'une permission supprimée n’est pas un partage');
  verifier(!isGrant({ type: 'user', emailAddress: 'alice@cooperl.test' }, MOI),
    'ma propre permission n’est pas un partage');
  verifier(isGrant({ type: 'anyone' }, MOI), 'un lien public en est un');

  egal(principalOf({ type: 'anyone' }), 'Tout internaute', 'le public se nomme');
  egal(principalOf({ type: 'domain', domain: 'x.test' }), '@x.test', 'un domaine porte son arobase');
  egal(principalOf({ type: 'user', displayName: 'Paul' }), 'Paul',
    'à défaut d’adresse, le nom affiché');
  egal(principalOf({ type: 'user' }), '(inconnu)',
    'et à défaut de tout, « inconnu » — jamais une case vide qu’on lirait « personne »');
}

section('D. Propriété d’un Drive partagé');
{
  egal(driveOwnership([], MOI), 'unknown', 'sans membre, on ne conclut pas');
  egal(driveOwnership([{ role: 'writer', emailAddress: 'x@inconnu.test' }], MOI), 'unknown',
    'sans gestionnaire, on ne conclut pas non plus');
  egal(driveOwnership([{ role: 'organizer', emailAddress: 'bob@cooperl.test' }], MOI), 'internal',
    'un gestionnaire interne rend le Drive interne');
  egal(driveOwnership([{ role: 'organizer', emailAddress: 'x@inconnu.test' }], MOI), 'external',
    'un gestionnaire uniquement externe le rend externe');
  egal(driveOwnership([
    { role: 'organizer', emailAddress: 'x@inconnu.test' },
    { role: 'organizer', emailAddress: 'alice@cooperl.test' },
  ], MOI), 'internal', 'il suffit d’un gestionnaire interne');

  egal(myRole([{ type: 'user', emailAddress: 'alice@cooperl.test', role: 'organizer' }], MOI),
    'organizer', 'mon rôle est lu dans les membres');
  egal(myRole([{ type: 'group', emailAddress: 'equipe@cooperl.test', role: 'organizer' }], MOI),
    '', 'un accès par groupe ne rend aucun rôle nominatif');
}

section('E. Score de risque');
{
  const niveauDe = (cle) => lire('BY_KEY')[cle];
  const score = (cle, grants, dossier) => riskScore(niveauDe(cle), grants, !!dossier, MOI);

  // Les bases sont figées, et pas seulement ordonnées : ce sont des chiffres
  // publiés dans le rapport, et les voir bouger en silence rendrait
  // incomparables deux audits successifs.
  egal(lire('RISK_BASE'), {
    public_indexed: 95, public_link: 85, external_domain: 72, external_user: 60,
    partner: 38, domain_indexed: 42, domain_link: 36, internal: 18, private: 0,
  }, 'le barème des niveaux est celui qui a été publié');

  egal(score('private', []), 0, 'un fichier non partagé ne porte aucun risque');
  // 85 de base, +1 parce que le public compte aussi comme un destinataire
  // externe (rang 50 ≥ 40), +2 parce que le lien n'expire pas.
  egal(score('public_link', [{ type: 'anyone', role: 'reader' }]), 88,
    'lien public permanent : 85 + 1 destinataire externe + 2 de permanence');
  egal(score('public_link', [{ type: 'anyone', role: 'reader', expirationTime: '2026-12-01' }]), 86,
    'un lien qui expire ne prend pas les 2 points de permanence');
  verifier(score('public_indexed', [{ type: 'anyone', allowFileDiscovery: true }])
    > score('public_link', [{ type: 'anyone' }]),
    'un lien indexable pèse plus lourd qu’un lien simple');
  verifier(score('internal', [{ type: 'user', emailAddress: 'bob@cooperl.test', role: 'reader' }])
    < score('external_user', [{ type: 'user', emailAddress: 'x@inconnu.test', role: 'reader' }]),
    'un partage interne pèse moins qu’un partage externe');

  const lecture = score('external_user', [{ type: 'user', emailAddress: 'x@inconnu.test', role: 'reader' }]);
  const ecriture = score('external_user', [{ type: 'user', emailAddress: 'x@inconnu.test', role: 'writer' }]);
  verifier(ecriture > lecture, 'un externe qui peut écrire pèse plus qu’un externe qui lit');

  verifier(score('external_user', [{ type: 'user', emailAddress: 'x@inconnu.test', role: 'reader' }], true)
    > lecture, 'un dossier pèse plus qu’un fichier — il porte ce qu’il contient');

  const beaucoup = Array.from({ length: 20 }, (_, i) => ({
    type: 'user', emailAddress: `x${i}@inconnu.test`, role: 'writer',
  }));
  const borne = score('public_indexed', beaucoup, true);
  verifier(borne <= 100, `le score reste borné à 100 (obtenu ${borne})`);
  verifier(borne >= 0, 'et jamais négatif');
}

section('F. Synthèse d’un fichier');
{
  const resume = summarizeFile([
    { type: 'user', emailAddress: 'alice@cooperl.test', role: 'owner' },
    { type: 'user', emailAddress: 'bob@cooperl.test', role: 'writer' },
    { type: 'anyone', allowFileDiscovery: false, role: 'reader' },
    { type: 'user', emailAddress: 'paul@client.test', role: 'commenter' },
    { type: 'user', emailAddress: 'parti@inconnu.test', role: 'reader', deleted: true },
  ], MOI, false);

  egal(resume.level.key, 'public_link', 'le niveau retenu est le plus exposé de tous');
  egal(resume.perms.length, 3,
    'ma propre permission et une permission supprimée ne comptent pas');
  egal(resume.perms.map((p) => p.level), ['public_link', 'partner', 'internal'],
    'les lignes sont triées du plus exposé au moins exposé');
  egal(resume.perms[0].principal, 'Tout internaute', 'le public arrive en tête');
  egal(resume.perms[2].roleLabel, 'Éditeur', 'les rôles sont traduits');
  verifier(resume.score > 0, 'et le score accompagne le niveau');

  const prive = summarizeFile([{ type: 'user', emailAddress: 'alice@cooperl.test', role: 'owner' }],
    MOI, false);
  egal(prive.level.key, 'private', 'un fichier que je suis seul à voir reste privé');
  egal(prive.score, 0, 'et son score est nul');
}

section('F bis. Un Drive illisible se compte, il ne disparaît pas');
{
  // Le défaut qui a motivé le portage sur le socle : un Drive dont les membres
  // ne sont pas lisibles rendait `[]`, et `[]` devient « propriétaire inconnu »
  // dans driveOwnership_. Rien ne distinguait « ce Drive n'a aucun membre » de
  // « je n'ai pas su les lire », et le rapport se déclarait complet.
  const monter = (reponse) => {
    const bac = {
      console: { log: () => {}, warn: () => {}, error: () => {} },
      JSON, Math, Number, String, Object, Array, Boolean, RegExp, Error, Date,
      CacheService: { getUserCache: () => ({ get: () => null, put: () => {} }) },
      Utilities: { sleep: () => {}, formatDate: () => '2026-09-12 00:00:00' },
      Session: { getScriptTimeZone: () => 'Europe/Paris' },
      Drive: { Permissions: { list: reponse } },
    };
    bac.globalThis = bac;
    vm.createContext(bac);
    ['SocleErreurs.gs', 'SocleReprises.gs', 'SocleApi.gs', 'Classify.gs', 'Code.gs']
      .forEach((nom) => vm.runInContext(
        fs.readFileSync(path.join(DOSSIER, nom), 'utf8'), bac, { filename: nom }));
    return (expression) => vm.runInContext(expression, bac);
  };

  // Drive lisible : deux membres, rien d'absorbé.
  const lisible = monter(() => ({
    permissions: [
      { id: '1', type: 'user', role: 'organizer', emailAddress: 'a@x.test' },
      { id: '2', type: 'user', role: 'writer', emailAddress: 'b@x.test' },
    ],
  }));
  egal(lisible("driveMembers_('D1').length"), 2, 'un Drive lisible rend ses membres');
  egal(lisible('SocleErreurs.bilan().total'), 0, 'et n’absorbe rien');

  // Drive illisible : même repli qu’avant, mais compté et nommé.
  const illisible = monter(() => {
    throw new Error('You do not have permission to access this shared drive');
  });
  egal(illisible("driveMembers_('D2')"), [],
    'un Drive illisible rend toujours une liste vide — le repli n’a pas changé');
  const bilan = illisible('SocleErreurs.bilan()');
  egal(bilan.total, 1, 'mais l’échec est désormais compté');
  // Aucun accès direct à causes[0] : un banc qui s’écroule sur l’échec qu’il
  // vient de constater cache tous ceux qui suivent.
  const cause = bilan.causes[0] || {};
  egal(cause.cause, 'membres d’un Drive illisibles',
    'et nommé par sa cause, pas par sa victime');
  verifier(/do not have permission/.test(String(cause.dernierMessage)),
    'le message d’origine est gardé — c’est lui qui dit quoi corriger');

  // Et la conséquence qu’on ne voulait plus taire.
  egal(illisible("driveOwnership_([], { email: 'moi@x.test', domains: ['x.test'] })"),
    'unknown',
    'une liste vide devient « propriétaire inconnu » : c’est exactement pourquoi '
    + 'elle ne doit pas se confondre avec « je n’ai pas su lire »');

  // Une erreur transitoire, elle, est rejouée avant d’être absorbée.
  let appels = 0;
  const passager = monter(() => {
    appels += 1;
    if (appels < 3) throw new Error('Rate Limit Exceeded');
    return { permissions: [{ id: '1', type: 'user', role: 'organizer', emailAddress: 'a@x.test' }] };
  });
  egal(passager("driveMembers_('D3').length"), 1,
    'une surcharge passagère est rattrapée par les reprises');
  egal(passager('SocleErreurs.bilan().total'), 0, 'et rien n’est absorbé');
}

section('G. Surface publique de Code.gs');
{
  // Ces noms sont appelés par le client via google.script.run[nom], c'est-à-dire
  // résolus à l'exécution : aucune vérification de syntaxe ne verrait leur
  // disparition. Un « Fonction de script introuvable » surgirait dans le
  // navigateur, au moment du clic, et pour ce seul bouton.
  const PUBLIQUES = [
    'doGet',
    'getTargets', 'getDriveMembers', 'scanItems', 'scanPage', 'hydrateFiles',
    'exportCsv', 'creatorsForDrive', 'createSheetsExport', 'appendSheetRows',
    'finishSheetsExport', 'getPartnerConfig', 'savePartnerDomains',
    // lancées à la main depuis l'éditeur : elles doivent rester au menu d'exécution
    'setInternalDomains', 'setPartnerDomains', 'setPartnerAdmins', 'diagnostic',
  ];
  const source = fs.readFileSync(path.join(DOSSIER, 'Code.gs'), 'utf8');
  const declarees = new Set(
    [...source.matchAll(/^function\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]));
  const perdues = PUBLIQUES.filter((nom) => !declarees.has(nom));
  egal(perdues, [],
    'toutes les fonctions appelées par leur nom restent des function déclarées');

  // L'inverse : ce qui est interne ne doit PAS rester au menu d'exécution.
  const internesDeclarees = [...declarees].filter((nom) => !PUBLIQUES.includes(nom));
  egal(internesDeclarees, [],
    'et rien d’interne ne traîne au menu d’exécution');
}

section('H. Intégrité du projet');
{
  // Deux fichiers concaténés, comme Apps Script les évalue. Une erreur de
  // syntaxe, ou deux constantes globales de même nom, et le projet ENTIER
  // refuse de se charger : toutes ses fonctions deviennent introuvables d'un
  // coup, y compris celles qui n'ont rien à voir.
  const fichiers = fs.readdirSync(DOSSIER).filter((n) => n.endsWith('.gs')).sort();
  const concatene = fichiers
    .map((nom) => fs.readFileSync(path.join(DOSSIER, nom), 'utf8')).join('\n');
  try {
    new vm.Script(concatene, { filename: 'projet.gs' });
    verifier(true, 'le projet concaténé est syntaxiquement valide');
  } catch (erreur) {
    verifier(false, `syntaxe du projet concaténé : ${erreur.message}`);
  }

  const declarations = new Map();
  const collisions = [];
  fichiers.forEach((nom) => {
    fs.readFileSync(path.join(DOSSIER, nom), 'utf8').split('\n').forEach((ligne) => {
      const trouve = /^(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)|^function\s+([A-Za-z_$][\w$]*)/
        .exec(ligne);
      if (!trouve) return;
      const id = trouve[1] || trouve[2];
      if (declarations.has(id)) collisions.push(`${id} (${declarations.get(id)} et ${nom})`);
      declarations.set(id, nom);
    });
  });
  egal(collisions, [], 'aucun nom de portée globale déclaré deux fois entre fichiers');

  // Tout nom appelé doit trouver sa définition quelque part, ou figurer parmi
  // les globales connues. C'est le détecteur de « Fonction de script
  // introuvable » : un renommage à moitié fait ne produit aucune erreur de
  // syntaxe — seulement une panne à l'exécution, dans le navigateur, au moment
  // du clic, et pour ce seul bouton.
  const GLOBALES = new Set([
    // services Apps Script appelés sans point
    'Drive', 'DriveActivity', 'HtmlService', 'CacheService', 'PropertiesService',
    'SpreadsheetApp', 'Session', 'Utilities', 'Logger', 'MimeType', 'UrlFetchApp',
    // globales du langage
    'String', 'Number', 'Boolean', 'Array', 'Object', 'Date', 'Error', 'RegExp',
    'Math', 'JSON', 'Set', 'Map', 'Promise', 'Symbol', 'parseInt', 'parseFloat',
    'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent',
    // mots-clés dont la forme ressemble à un appel
    'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'function',
    'new', 'do', 'else', 'delete', 'void', 'await', 'yield', 'eval',
  ]);

  /**
   * Ne garde que le code : ni commentaires, ni littéraux de chaîne.
   *
   * Sans cela, `fields: 'user(emailAddress)'` passerait pour un appel à une
   * fonction « user », et « (déjà interne) » pour un appel à « interne ». Les
   * expressions `${…}` des gabarits sont conservées : elles, c'est du code.
   */
  const codeSeul = (source) => {
    let sortie = '';
    let etat = 'code';
    let guillemet = '';
    // Une pile : chaque `${…}` ouvert y pousse la profondeur d'accolades qu'il
    // a traversée. Sans elle — c'est le défaut qui a coûté deux heures — la
    // première accolade fermante rencontrée après un gabarit rebasculait le
    // scanner en mode gabarit, où il avalait tout jusqu'au backtick suivant.
    const interpolations = [];

    for (let i = 0; i < source.length; i += 1) {
      const c = source[i];
      const suivant = source[i + 1];

      if (etat === 'ligne') {
        if (c === '\n') { etat = 'code'; sortie += '\n'; }
        continue;
      }
      if (etat === 'bloc') {
        if (c === '*' && suivant === '/') { etat = 'code'; i += 1; }
        continue;
      }
      if (etat === 'chaine') {
        if (c === '\\') { i += 1; continue; }
        if (c === guillemet) etat = 'code';
        continue;
      }
      if (etat === 'gabarit') {
        if (c === '\\') { i += 1; continue; }
        if (c === '`') { etat = 'code'; continue; }
        if (c === '$' && suivant === '{') {
          etat = 'code'; interpolations.push(0); i += 1; sortie += ' ';
        }
        continue;
      }

      // état « code »
      if (c === '/' && suivant === '/') { etat = 'ligne'; i += 1; continue; }
      if (c === '/' && suivant === '*') { etat = 'bloc'; i += 1; continue; }
      if (c === "'" || c === '"') { etat = 'chaine'; guillemet = c; sortie += ' '; continue; }
      if (c === '`') { etat = 'gabarit'; sortie += ' '; continue; }
      if (interpolations.length) {
        const dernier = interpolations.length - 1;
        if (c === '{') interpolations[dernier] += 1;
        else if (c === '}') {
          if (interpolations[dernier] === 0) {
            interpolations.pop(); etat = 'gabarit'; sortie += ' '; continue;
          }
          interpolations[dernier] -= 1;
        }
      }
      sortie += c;
    }
    return sortie;
  };

  const codeNu = codeSeul(concatene);

  const identifiants = (liste) => String(liste).split(',')
    .map((x) => x.trim().replace(/=.*$/, '').replace(/^\.\.\./, '').trim())
    .filter((x) => /^[A-Za-z_$][\w$]*$/.test(x));

  const definis = new Set([
    // déclarations, à toute profondeur
    ...[...codeNu.matchAll(/\b(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)]
      .map((m) => m[1]),
    // méthodes de classe, qui s'écrivent sans mot-clé
    ...[...codeNu.matchAll(/^\s{2,}([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/gm)].map((m) => m[1]),
    // paramètres : un `fn` passé en argument est appelé comme une fonction
    ...[...codeNu.matchAll(/\(([^()]*)\)\s*=>/g)].flatMap((m) => identifiants(m[1])),
    ...[...codeNu.matchAll(/function\s+[A-Za-z_$][\w$]*\(([^()]*)\)/g)]
      .flatMap((m) => identifiants(m[1])),
    ...[...codeNu.matchAll(/^\s{2,}[A-Za-z_$][\w$]*\(([^()]*)\)\s*\{/gm)]
      .flatMap((m) => identifiants(m[1])),
  ]);

  const appeles = new Set(
    [...codeNu.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]));
  const orphelins = [...appeles]
    .filter((nom) => !definis.has(nom) && !GLOBALES.has(nom)).sort();
  egal(orphelins, [],
    'tout nom appelé trouve sa définition, ou figure parmi les globales connues');
}

console.log(`\n${passes} assertion(s) passée(s), ${echecs.length} échec(s).`);
if (echecs.length > 0) {
  console.log('\nÉchecs :');
  echecs.forEach((e) => console.log(`  · ${e}`));
  process.exit(1);
}
