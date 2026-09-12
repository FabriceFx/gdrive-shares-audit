/**
 * Socle — applications web et interfaces HTML. Introduit en v0.4.
 *
 * Trois gestes que toute application web Apps Script refait, et que la mesure
 * a trouvés écrits quatre fois de quatre façons : servir une page, inclure un
 * fichier dans un gabarit, et rendre compte au navigateur de ce qui s'est
 * passé côté serveur.
 *
 * Le troisième est le seul qui mérite un module. Les quatre projets mesurés
 * affichent `erreur.message` brut à l'utilisateur : une exception imprévue
 * arrive donc telle quelle sous les yeux de quelqu'un du métier, sous la forme
 * d'un « Cannot read properties of undefined » qui ne lui apprend rien et
 * l'inquiète. `frontiere()` existe pour ça.
 *
 * Sa moitié navigateur vit dans SocleWebClient.html.
 *
 * Ce fichier se recopie tel quel. Il ne dépend d'aucun autre module du socle —
 * mais il sait reconnaître une erreur de `SocleErreurs` si elle passe par là,
 * à son champ `quoiFaire`, sans exiger que ce module soit présent.
 */

const SOCLE_WEB_VERSION_ = '0.9.1';

const socleWebTexte_ = (valeur) => String(valeur ?? '').trim();

const SocleWeb = {
  version: SOCLE_WEB_VERSION_,

  /**
   * Contenu d'un fichier du projet, pour un scriptlet de gabarit :
   *
   *     <?!= SocleWeb.inclure('SocleStyle') ?>
   *
   * La page hôte doit être construite par `createTemplateFromFile(…).evaluate()`,
   * sinon les scriptlets ne sont pas évalués et le contenu n'arrive jamais.
   */
  inclure: (nomFichier) => {
    const nom = socleWebTexte_(nomFichier);
    if (nom === '') {
      throw new Error('SocleWeb.inclure attend un nom de fichier. '
        + 'Indiquez-le sans son extension : « SocleStyle », et non « SocleStyle.html ».');
    }
    return HtmlService.createHtmlOutputFromFile(nom).getContent();
  },

  /**
   * Sert une page, avec le minimum que toute application web doit poser.
   *
   * `integrable` décide du mode X-Frame. **L'énumération ne comporte que
   * `ALLOWALL` et `DEFAULT`** : un `DENY` écrit de mémoire vaudrait `undefined`
   * et ferait échouer l'appel. C'est vérifié sur la documentation, pas
   * supposé — et c'est la raison pour laquelle ce module prend un booléen
   * plutôt qu'un nom de mode : on ne peut pas s'y tromper.
   *
   * `integrable: true` n'est utile que pour afficher la page dans un cadre
   * d'un autre domaine — un ticket Jira, un intranet. Le défaut est fermé.
   */
  page: ({ fichier, titre, gabarit, donnees, integrable }) => {
    const nom = socleWebTexte_(fichier);
    if (nom === '') {
      throw new Error('SocleWeb.page attend un fichier à servir. '
        + 'Renseignez « fichier » avec le nom du fichier HTML, sans son extension.');
    }

    let sortie;
    if (gabarit) {
      const modele = HtmlService.createTemplateFromFile(nom);
      Object.keys(donnees || {}).forEach((cle) => { modele[cle] = donnees[cle]; });
      sortie = modele.evaluate();
    } else {
      sortie = HtmlService.createHtmlOutputFromFile(nom);
    }

    const nomPage = socleWebTexte_(titre);
    if (nomPage !== '') sortie.setTitle(nomPage);

    // Sans cette balise, la page s'affiche en taille bureau sur un téléphone,
    // réduite au point d'être illisible.
    sortie.addMetaTag('viewport', 'width=device-width, initial-scale=1');

    sortie.setXFrameOptionsMode(integrable
      ? HtmlService.XFrameOptionsMode.ALLOWALL
      : HtmlService.XFrameOptionsMode.DEFAULT);

    return sortie;
  },

  /**
   * Enveloppe une fonction appelée par le navigateur.
   *
   * Elle **rend un résultat structuré au lieu de lever** : ce qui traverse
   * `google.script.run` n'est pas garanti de porter les champs propres d'une
   * `Error`, et l'on ne veut pas que le navigateur ait à deviner ce qu'il a
   * reçu. Le client reçoit donc toujours la même forme :
   *
   *     { ok: true,  valeur }
   *     { ok: false, message, reference }
   *
   * `message` est ce que l'utilisateur peut lire. Une erreur qui porte un
   * champ `quoiFaire` — ce que construit `SocleErreurs` — rend son remède ;
   * toute autre exception rend un message qui **dit qu'elle est imprévue**,
   * plutôt que de se faire passer pour un problème de saisie. Faire porter à
   * l'utilisateur la faute d'un défaut du code l'envoie corriger ce qui n'a
   * rien à se reprocher.
   *
   * `reference` est l'horodatage à la seconde : c'est ce que l'utilisateur
   * cite en signalant l'incident, et ce qui permet de retrouver la trace dans
   * le journal, où le détail technique est resté.
   */
  frontiere: (nom, operation) => {
    try {
      return { ok: true, valeur: operation() };
    } catch (erreur) {
      const reference = Utilities.formatDate(
        new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
      const remede = socleWebTexte_(erreur && erreur.quoiFaire);
      const attendue = remede !== '';

      console.error(`[${nom}] ${reference}\n`
        + `${attendue ? 'Attendue' : 'Imprévue'} : ${(erreur && erreur.message) || erreur}\n`
        + `${(erreur && erreur.stack) || ''}`);

      return {
        ok: false,
        reference,
        message: attendue
          ? socleWebTexte_(erreur.message)
          : 'Une erreur imprévue est survenue — ce n\'est pas votre saisie qui est en '
            + `cause. Signalez-la à l'administrateur en citant la référence ${reference}.`,
      };
    }
  },
};
