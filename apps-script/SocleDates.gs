/**
 * Socle — dates. Introduit en v0.1.
 *
 * Une chaîne ISO écrite dans une cellule revient de `getValues()` sous forme
 * d'objet `Date`. `String(valeur)` rend alors « Thu May 14 2026 02:00:00
 * GMT+0200 ». L'affichage en anglais n'est que le symptôme : le vrai défaut
 * est que ces chaînes se comparent **alphabétiquement, sur le nom du jour**,
 * si bien que tout tri, tout minimum, tout maximum devient faux en silence.
 *
 * D'où la règle que ce module applique : normaliser **à la lecture**, jamais
 * à l'écriture — on ne maîtrise pas ce que Sheets fait d'une valeur en la
 * stockant. Et deux formats, pas un seul : `yyyy-MM-dd` pour stocker, parce
 * que c'est le seul qui se trie en tant que texte ; « 6 septembre 2026 »
 * pour lire, parce qu'une interface s'adresse à des humains. La conversion
 * appartient à la présentation, jamais à la donnée.
 *
 * Ce fichier se recopie tel quel. Il ne dépend d'aucun autre module du socle.
 */

const SOCLE_DATES_VERSION_ = '0.9.1';

/**
 * Noms de mois explicites, et non `Utilities.formatDate(…, 'MMMM')`.
 *
 * `formatDate` suit la locale du script, pas la langue demandée : un projet
 * bilingue afficherait « September » en français si la locale du script est
 * en anglais, et il n'existe aucun moyen de le lui interdire. La table coûte
 * douze chaînes par langue et rend le résultat déterministe.
 */
const SOCLE_DATES_MOIS_ = {
  fr: ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
    'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'],
  en: ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'],
};

const SOCLE_DATES_ISO_ = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/;
const SOCLE_DATES_FR_ = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;

const socleDatesFuseau_ = () => Session.getScriptTimeZone();

const socleDatesDeuxChiffres_ = (n) => (n < 10 ? `0${n}` : String(n));

/**
 * Rend un objet `Date` à partir de ce qu'une cellule peut contenir, ou `null`.
 *
 * **Ne devine jamais.** Un `new Date('01/02/2026')` rend le 2 janvier en
 * locale américaine et le 1er février ailleurs : la même cellule, lue par
 * deux scripts, donnerait deux dates. Seules deux écritures sont donc
 * acceptées — ISO et jj/mm/aaaa — et tout le reste rend `null`, à charge
 * pour l'appelant de dire « non mesuré » plutôt que d'inventer.
 *
 * Un nombre est refusé de la même façon : rien ne distingue un numéro de
 * série Sheets d'un identifiant, et se tromper y coûte une date en 1899.
 */
const socleDatesVersDate_ = (valeur) => {
  if (valeur instanceof Date) return Number.isNaN(valeur.getTime()) ? null : valeur;
  if (valeur === null || valeur === undefined || typeof valeur === 'number') return null;

  const texte = String(valeur).trim();
  if (texte === '') return null;

  const iso = SOCLE_DATES_ISO_.exec(texte);
  if (iso) {
    const [, a, m, j, h, mn, s] = iso;
    return new Date(Number(a), Number(m) - 1, Number(j),
      Number(h || 0), Number(mn || 0), Number(s || 0));
  }

  const fr = SOCLE_DATES_FR_.exec(texte);
  if (fr) {
    const [, j, m, a, h, mn, s] = fr;
    return new Date(Number(a), Number(m) - 1, Number(j),
      Number(h || 0), Number(mn || 0), Number(s || 0));
  }

  return null;
};

const SocleDates = {
  version: SOCLE_DATES_VERSION_,

  /**
   * Format de stockage : `yyyy-MM-dd`, ou `''` si la valeur n'est pas une date.
   *
   * `''` veut dire « je n'ai pas su lire », jamais « il n'y a rien » — et
   * c'est à l'appelant de le distinguer dans son rapport.
   */
  jour: (valeur) => {
    const date = socleDatesVersDate_(valeur);
    return date === null ? '' : Utilities.formatDate(date, socleDatesFuseau_(), 'yyyy-MM-dd');
  },

  /** Format de stockage avec l'heure : `yyyy-MM-dd HH:mm:ss`. Se trie aussi. */
  horodatage: (valeur) => {
    const date = socleDatesVersDate_(valeur);
    return date === null ? ''
      : Utilities.formatDate(date, socleDatesFuseau_(), 'yyyy-MM-dd HH:mm:ss');
  },

  maintenantJour: () => Utilities.formatDate(new Date(), socleDatesFuseau_(), 'yyyy-MM-dd'),

  maintenantHorodatage: () => Utilities.formatDate(
    new Date(), socleDatesFuseau_(), 'yyyy-MM-dd HH:mm:ss'),

  /**
   * Format de lecture : « 6 septembre 2026 ». Pour une interface, jamais pour
   * une cellule dont on trierait la colonne.
   */
  lisible: (valeur, langue = 'fr') => {
    const date = socleDatesVersDate_(valeur);
    if (date === null) return '';
    const mois = SOCLE_DATES_MOIS_[langue] || SOCLE_DATES_MOIS_.fr;
    const jour = date.getDate();
    if (langue === 'en') return `${mois[date.getMonth()]} ${jour}, ${date.getFullYear()}`;
    // « 1er » et non « 1 » : la seule irrégularité du français sur les quantièmes.
    const quantieme = jour === 1 ? '1er' : String(jour);
    return `${quantieme} ${mois[date.getMonth()]} ${date.getFullYear()}`;
  },

  /** « 6 septembre 2026 à 14:05 ». */
  lisibleAvecHeure: (valeur, langue = 'fr') => {
    const date = socleDatesVersDate_(valeur);
    if (date === null) return '';
    const heure = `${socleDatesDeuxChiffres_(date.getHours())}:${socleDatesDeuxChiffres_(date.getMinutes())}`;
    const jour = SocleDates.lisible(valeur, langue);
    return langue === 'en' ? `${jour} at ${heure}` : `${jour} à ${heure}`;
  },

  /** Vrai si le texte est déjà au format de stockage. Sert aux contrôles, pas aux conversions. */
  estJour: (texte) => /^\d{4}-\d{2}-\d{2}$/.test(String(texte ?? '')),

  /** Nombre de jours entiers entre deux valeurs, ou `null` si l'une n'est pas lisible. */
  ecartEnJours: (depuis, jusqua) => {
    const a = socleDatesVersDate_(depuis);
    const b = socleDatesVersDate_(jusqua);
    if (a === null || b === null) return null;
    const jour = 24 * 60 * 60 * 1000;
    return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())
      - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / jour);
  },
};
