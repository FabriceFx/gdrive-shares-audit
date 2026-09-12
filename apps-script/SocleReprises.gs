/**
 * Socle — erreurs passagères. Introduit en v0.1.
 *
 * Une opération qui appelle un service Google une fois par ligne rencontrera
 * une erreur transitoire : sur trois cents appels ce n'est pas un risque à
 * couvrir, c'est une certitude statistique. Ce module la rattrape — et
 * surtout, il refuse de rattraper ce qui n'a aucune chance d'aboutir.
 *
 * **Le tri vaut la reprise**, et c'est la moitié qu'on oublie. Trois essais à
 * attentes doublantes coûtent 2,4 secondes d'attente pure par appel qui
 * échoue. Appliqué sans discernement à trois cents appels voués à échouer,
 * cela fait douze minutes de sommeil — soit deux fois le plafond d'une
 * exécution. Un backoff sans tri ne rend pas un outil robuste : il le rend
 * lent à échouer.
 *
 * Deux couches, complémentaires et souvent confondues : les **exceptions**
 * que lèvent les services Apps Script, et les **codes HTTP** que rend une API
 * appelée par `UrlFetchApp` — laquelle ne lève rien du tout quand on lui
 * passe `muteHttpExceptions`.
 *
 * Ce fichier se recopie tel quel. Il ne dépend d'aucun autre module du socle.
 */

const SOCLE_REPRISES_VERSION_ = '0.9.1';

const SOCLE_REPRISES_TENTATIVES_ = 3;
const SOCLE_REPRISES_ATTENTE_MS_ = 800;

/**
 * Plafond d'attente et dispersion, repris de `gdrive-shares-audit` — le projet
 * avait raison contre le socle, et c'est pour ce cas-là que l'outil d'état dit
 * de relire une divergence avant de recopier.
 *
 * Le plafond évite qu'une septième tentative n'attende une minute. La
 * dispersion — jusqu'à 500 ms tirés au hasard — évite que trois cents appels
 * lancés ensemble ne réessaient tous à la même seconde : sans elle, la reprise
 * reconstitue la surcharge qu'elle est censée absorber.
 */
const SOCLE_REPRISES_PLAFOND_MS_ = 16000;
const SOCLE_REPRISES_DISPERSION_MS_ = 500;

/** Codes HTTP qui valent la peine d'être rejoués. Tout le reste est définitif. */
const SOCLE_REPRISES_CODES_ = [429, 500, 502, 503, 504];

/**
 * Libellés réellement rendus par les services Apps Script et les API Google
 * — surcharge, quota par minute, erreurs serveur, coupures.
 *
 * Vérifiés sur des messages observés, pas devinés : un motif trop large
 * rejouerait un refus de droits, un motif trop étroit laisserait passer une
 * panne passagère pour une donnée manquante. Les deux erreurs coûtent, et
 * dans des directions opposées.
 */
const SOCLE_REPRISES_MOTIF_ = /rate limit|ratelimit|quota|too many|429|500|502|503|504|backend error|internal error|timeout|timed out|temporar|try again|unavailable|service error|réessayez/i;

const SocleReprises = {
  version: SOCLE_REPRISES_VERSION_,

  /** Sépare ce qui a une chance d'aboutir de ce qui n'en a aucune. */
  estTransitoire: (erreur) => SOCLE_REPRISES_MOTIF_.test(
    String((erreur && erreur.message) || erreur)),

  /**
   * Exécute l'opération, en la rejouant tant qu'elle échoue de façon
   * transitoire.
   *
   * Rend ce que rend l'opération ; **relève** l'erreur si elle n'est pas
   * transitoire ou si les tentatives sont épuisées. Jamais de valeur de repli
   * silencieuse : c'est à l'appelant de décider quoi faire d'un échec, et
   * surtout de pouvoir le dire dans son rapport. Une fonction qui rend
   * `null` en cas de panne transforme « je n'ai pas su lire » en « il n'y a
   * rien », et envoie quelqu'un chercher une donnée qui est déjà là.
   */
  avecReprises: (operation, options = {}) => {
    const tentativesMax = options.tentatives || SOCLE_REPRISES_TENTATIVES_;
    const transitoire = options.estTransitoire || SocleReprises.estTransitoire;
    let attente = options.attenteMs || SOCLE_REPRISES_ATTENTE_MS_;

    for (let tentative = 1; ; tentative += 1) {
      try {
        return operation();
      } catch (erreur) {
        if (tentative >= tentativesMax || !transitoire(erreur)) throw erreur;
        Utilities.sleep(attente + Math.floor(Math.random() * SOCLE_REPRISES_DISPERSION_MS_));
        attente = Math.min(attente * 2, options.plafondMs || SOCLE_REPRISES_PLAFOND_MS_);
      }
    }
  },

  /**
   * Appel HTTP avec reprise sur les codes qui la méritent.
   *
   * `muteHttpExceptions` est imposé : sans lui, `UrlFetchApp` lève sur un 429
   * et l'on perd le corps de la réponse, qui est presque toujours l'endroit
   * où l'API explique ce qui ne va pas. On rend donc la réponse sur un
   * succès, et l'on lève sur une erreur définitive — avec le code **et** le
   * début du corps dans le message, parce qu'un « Erreur 400 » sans le corps
   * n'a jamais aidé personne.
   */
  appelHttp: (url, options = {}, reglages = {}) => {
    const tentativesMax = reglages.tentatives || SOCLE_REPRISES_TENTATIVES_;
    let attente = reglages.attenteMs || SOCLE_REPRISES_ATTENTE_MS_;

    for (let tentative = 1; ; tentative += 1) {
      const reponse = UrlFetchApp.fetch(url, { ...options, muteHttpExceptions: true });
      const code = reponse.getResponseCode();
      if (code >= 200 && code < 400) return reponse;

      const rejouable = SOCLE_REPRISES_CODES_.includes(code);
      if (rejouable && tentative < tentativesMax) {
        Utilities.sleep(attente + Math.floor(Math.random() * SOCLE_REPRISES_DISPERSION_MS_));
        attente = Math.min(attente * 2, reglages.plafondMs || SOCLE_REPRISES_PLAFOND_MS_);
        continue;
      }

      // Chaque morceau dans sa variable, et un seul gabarit : des gabarits
      // imbriqués dans des ternaires ne se relisent pas, et l'on finit par ne
      // plus voir ce que le message dit vraiment.
      const cible = String(url).split('?')[0];
      const corps = String(reponse.getContentText() || '').slice(0, 300);
      const tentatives = rejouable ? ` après ${tentativesMax} tentatives` : '';
      const detail = corps ? ` — ${corps}` : '';
      // Le remède dépend du code : un 4xx vient de la requête, un 5xx du service.
      const remede = rejouable
        ? 'Réessayez plus tard : le service n\'a pas répondu malgré les reprises.'
        : 'Vérifiez la requête et les droits du compte : ce code ne se rejoue pas.';
      throw new Error(`Appel HTTP ${code} sur ${cible}${tentatives}${detail}. ${remede}`);
    }
  },
};
