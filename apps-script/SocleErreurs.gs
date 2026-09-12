/**
 * Socle — échecs. Introduit en v0.3.
 *
 * Ce module n'est pas entré par duplication : il n'existait rien à
 * factoriser. Il est entré par ce que la mesure a trouvé dans six projets —
 * 118 exceptions levées dont 9 disent quoi faire ensuite, et 17 blocs `catch`
 * qui décident en silence qu'un échec n'a pas eu lieu.
 *
 * Le défaut n'est pas d'absorber un échec : certains le méritent, et un cache
 * qui ne répond pas ne doit pas arrêter une génération. Le défaut est que
 * **rien ne distingue « ça n'a pas eu lieu » de « je n'ai pas su »**. Un Drive
 * dont on n'a pas pu lire les membres rend une liste vide, et la liste vide
 * devient « propriétaire inconnu » ; un fichier illisible disparaît d'un
 * rapport d'audit qui se déclare complet. Un rendu faux qui se dit réussi
 * coûte plus cher qu'un échec, parce que personne ne va chercher la cause
 * d'un succès.
 *
 * D'où la doctrine, en trois sorts et pas un de plus. À chaque échec, il faut
 * en nommer un :
 *
 *   absorber   l'échec est prévu et sans conséquence sur le résultat. On rend
 *              une valeur de repli, **et on compte**. Le compteur est la
 *              trace : c'est ce qui empêche l'absorption d'être un oubli.
 *   lever      l'échec empêche de continuer. On lève une erreur qui porte son
 *              remède — le module refuse d'en construire une sans.
 *   signaler   l'échec concerne quelqu'un d'autre que celui qui exécute.
 *              C'est l'affaire de SocleCourriel, à qui l'on passe ce bilan.
 *
 * Ce fichier se recopie tel quel. Il ne dépend d'aucun autre module du socle.
 */

const SOCLE_ERREURS_VERSION_ = '0.9.1';

/**
 * Registre des échecs absorbés, pour la durée de l'exécution.
 *
 * Un objet `const` muté en place, et non `let` : une liaison `let` de portée
 * globale traverse mal les fichiers d'un même projet Apps Script.
 *
 * Il ne va pas dans `PropertiesService` : ce registre est le bilan **d'une
 * exécution**, pas un état de reprise. Le persister ferait cumuler les échecs
 * de lundi avec ceux de mardi dans le même rapport.
 */
const SOCLE_ERREURS_REGISTRE_ = { causes: {} };

const SOCLE_ERREURS_MARQUE_ = 'socleErreurAttendue';

const socleErreursTexte_ = (valeur) => String(valeur ?? '').trim();

const socleErreursMessage_ = (erreur) => socleErreursTexte_(
  (erreur && erreur.message) || erreur);

const SocleErreurs = {
  version: SOCLE_ERREURS_VERSION_,

  /**
   * Construit une erreur qui porte son remède.
   *
   * `quoiFaire` est obligatoire, et ce refus est l'essentiel : un message
   * d'erreur dit quoi faire ensuite, pas ce qui a échoué. « Échec de la
   * synchronisation » n'apprend rien à qui le lit ; « le dossier n'est plus
   * partagé avec ce compte — repartagez-le, puis relancez » se traite.
   *
   * `cause` porte le détail technique. Il est gardé à part et non concaténé au
   * message : ce qu'un utilisateur final lit n'est pas ce qu'un administrateur
   * lit, et les deux textes se tirent ensuite de la même erreur.
   */
  erreur: ({ quoi, quoiFaire, cause }) => {
    const sujet = socleErreursTexte_(quoi);
    const remede = socleErreursTexte_(quoiFaire);
    if (sujet === '') {
      throw new Error('SocleErreurs.erreur : « quoi » est obligatoire. '
        + 'Renseignez ce qui ne va pas, du point de vue de qui lira le message.');
    }
    if (remede === '') {
      throw new Error(
        `SocleErreurs.erreur : « quoiFaire » est obligatoire pour « ${sujet} ». `
        + 'Une erreur qui ne dit pas quoi faire ensuite laisse son lecteur devant '
        + 'un constat, et il improvisera. Renseignez le geste attendu.');
    }
    const erreur = new Error(`${sujet} ${remede}`);
    erreur[SOCLE_ERREURS_MARQUE_] = true;
    erreur.quoi = sujet;
    erreur.quoiFaire = remede;
    erreur.cause = socleErreursTexte_(cause);
    return erreur;
  },

  /** Vrai si l'erreur a été construite par ce module, donc porte un remède. */
  estAttendue: (erreur) => !!(erreur && erreur[SOCLE_ERREURS_MARQUE_] === true),

  /**
   * Exécute l'opération ; si elle échoue, compte l'échec sous cette cause et
   * rend la valeur de repli.
   *
   * `cause` est obligatoire et nomme **la cause, pas l'occurrence** : on
   * agrège par cause et non par victime, sans quoi un rapport aligne trois
   * cents lignes portant le même défaut et n'est plus lu.
   *
   * Ce que fait ce module et que ne fait pas un `catch` nu : la valeur de
   * repli est rendue **et** l'échec reste comptable. `bilan()` permet ensuite
   * au rapport de dire « 12 Drives dont les membres n'ont pas pu être lus »
   * plutôt que de laisser croire qu'ils n'avaient pas de membres.
   */
  absorber: (cause, operation, repli) => {
    const nom = socleErreursTexte_(cause);
    if (nom === '') {
      throw new Error(
        'SocleErreurs.absorber : une cause doit être nommée. Absorber un échec sans '
        + 'le nommer, c\'est exactement le catch muet que ce module remplace. '
        + 'Nommez la cause, pas l\'occurrence : « lecture des membres du Drive », '
        + 'et non « Drive 1A2B ».');
    }
    try {
      return operation();
    } catch (erreur) {
      const registre = SOCLE_ERREURS_REGISTRE_.causes;
      const connue = registre[nom] || { occurrences: 0, premierMessage: '', dernierMessage: '' };
      const message = socleErreursMessage_(erreur);
      registre[nom] = {
        occurrences: connue.occurrences + 1,
        premierMessage: connue.premierMessage || message,
        dernierMessage: message,
      };
      return repli;
    }
  },

  /**
   * Ce qui a été absorbé depuis le dernier oubli, agrégé par cause.
   *
   * Destiné au compte rendu final : un chiffre s'accompagne toujours de ce qui
   * le produit, et une exécution qui a absorbé douze échecs ne doit pas se
   * présenter comme une exécution parfaite.
   */
  bilan: () => {
    const causes = Object.keys(SOCLE_ERREURS_REGISTRE_.causes)
      .map((nom) => ({ cause: nom, ...SOCLE_ERREURS_REGISTRE_.causes[nom] }))
      .sort((a, b) => b.occurrences - a.occurrences);
    return {
      total: causes.reduce((somme, c) => somme + c.occurrences, 0),
      causes,
    };
  },

  /** Remet le registre à zéro. À appeler au début d'une exécution. */
  oublier: () => {
    const total = SocleErreurs.bilan().total;
    SOCLE_ERREURS_REGISTRE_.causes = {};
    return { oubliees: total };
  },

  /**
   * Le texte destiné à qui s'est servi de l'outil.
   *
   * Une erreur attendue rend son remède. Une exception imprévue — un défaut du
   * code — ne se déguise pas en conseil : on dit qu'elle est imprévue, et on
   * donne de quoi la rapporter. Faire passer un bug pour un problème de saisie
   * envoie l'utilisateur corriger ce qui n'a rien à se reprocher.
   */
  pourLUtilisateur: (erreur) => {
    if (SocleErreurs.estAttendue(erreur)) return `${erreur.quoi} ${erreur.quoiFaire}`;
    return 'Une erreur imprévue est survenue — ce n\'est pas votre saisie qui est en '
      + 'cause. Signalez-la à l\'administrateur de l\'outil, avec l\'heure à laquelle '
      + 'elle s\'est produite.';
  },

  /**
   * Le texte destiné au journal et à l'administrateur : tout, y compris ce que
   * l'utilisateur n'a pas besoin de lire.
   */
  pourLeJournal: (erreur) => {
    if (SocleErreurs.estAttendue(erreur)) {
      return [
        `Attendue : ${erreur.quoi}`,
        `Remède annoncé : ${erreur.quoiFaire}`,
        erreur.cause ? `Cause : ${erreur.cause}` : '',
      ].filter((l) => l !== '').join('\n');
    }
    const pile = (erreur && erreur.stack) ? `\n${erreur.stack}` : '';
    return `Imprévue : ${socleErreursMessage_(erreur)}${pile}`;
  },
};
