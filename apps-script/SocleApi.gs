/**
 * Socle — pagination des API Google. Introduit en v0.5.
 *
 * 26 occurrences dans quatre projets, toutes de la même forme : une boucle
 * `do … while (pageToken)` qui accumule un champ de la réponse. Écrite à la
 * main, elle porte à chaque fois les mêmes deux défauts — aucune borne, et
 * aucun moyen de s'arrêter avant le plafond des six minutes.
 *
 * Ce fichier se recopie tel quel. Il ne dépend d'aucun autre module du socle :
 * la borne de temps se passe en paramètre plutôt que de venir de
 * SocleExecution.
 */

const SOCLE_API_VERSION_ = '0.9.1';

/**
 * Pages au plus, si l'appelant n'en dit rien.
 *
 * Une boucle de pagination sans borne est une boucle infinie en puissance :
 * il suffit qu'une API rende toujours le même jeton — ce qui arrive — pour
 * qu'elle tourne jusqu'à ce que Google la tue, sans rien écrire.
 */
const SOCLE_API_PAGES_MAX_ = 200;

const SocleApi = {
  version: SOCLE_API_VERSION_,

  /**
   * Parcourt toutes les pages d'un appel et rend les éléments accumulés.
   *
   *     const fichiers = SocleApi.parcourir(
   *       (jeton) => Drive.Files.list({ pageToken: jeton, pageSize: 200, fields: '…' }),
   *       { champ: 'files' });
   *
   * Rend `{ elements, pages, jetonSuivant, complet }`. `complet` est faux
   * quand on s'est arrêté avant la fin — borne de pages atteinte, ou budget
   * de temps épuisé — et `jetonSuivant` permet alors de reprendre là.
   *
   * **Le parcours ne rend jamais une liste partielle en la faisant passer
   * pour complète.** C'est le défaut des boucles écrites à la main : elles
   * s'arrêtent et rendent le tableau, sans que l'appelant sache qu'il est
   * tronqué.
   */
  parcourir: (appel, options = {}) => {
    const champ = String(options.champ || '').trim();
    if (champ === '') {
      throw new Error(
        'SocleApi.parcourir attend le nom du champ à accumuler. '
        + 'Indiquez « champ » : « files » pour Drive.Files.list, « users » pour '
        + 'AdminDirectory.Users.list.');
    }

    const pagesMax = options.pagesMax || SOCLE_API_PAGES_MAX_;
    const permet = typeof options.permet === 'function' ? options.permet : () => true;

    const elements = [];
    let jeton = options.jetonDepart || null;
    let pages = 0;

    do {
      if (!permet()) return { elements, pages, jetonSuivant: jeton, complet: false };
      const reponse = appel(jeton) || {};
      pages += 1;
      const lot = reponse[champ];
      if (lot && lot.length) Array.prototype.push.apply(elements, lot);
      jeton = reponse.nextPageToken || null;
      if (jeton && pages >= pagesMax) {
        return { elements, pages, jetonSuivant: jeton, complet: false };
      }
    } while (jeton);

    return { elements, pages, jetonSuivant: null, complet: true };
  },
};
