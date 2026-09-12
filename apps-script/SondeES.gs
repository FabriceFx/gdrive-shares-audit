/**
 * Sonde ECMAScript — à recopier dans un projet Apps Script et à exécuter une
 * fois depuis l'éditeur. Introduite en v0.1.
 *
 * Google annonce que le moteur V8 « prend en charge la syntaxe ECMAScript
 * moderne », sans jamais nommer de version garantie. Il n'existe donc aucune
 * page à citer : ce qui est disponible se **mesure**, dans le moteur qui
 * exécutera réellement le code, le jour où on se pose la question.
 *
 * Chaque essai passe par `eval`, et c'est indispensable : une construction que
 * le moteur ne sait pas analyser — le chaînage optionnel, par exemple — ferait
 * échouer le chargement du fichier entier si elle y était écrite en clair.
 * Passée à `eval`, elle n'est analysée qu'à l'exécution, et l'échec devient un
 * résultat au lieu d'une panne.
 *
 * Le résultat vaut pour le jour où on l'obtient : Google met V8 à jour sans
 * préavis, et une construction absente aujourd'hui peut apparaître demain.
 */

const SONDE_ES_ESSAIS_ = [
  ['ES2015', 'fonction fléchée', '(() => 1)()'],
  ['ES2015', 'gabarit de chaîne', '`a${1}b`'],
  ['ES2015', 'déstructuration', 'const [a] = [1]; const { b } = { b: 2 }; a + b'],
  ['ES2015', 'paramètre par défaut', '((x = 1) => x)()'],
  ['ES2015', 'reste et étalement', '((...r) => r.length)(...[1, 2])'],
  ['ES2015', 'classe', 'class Z { constructor() { this.v = 1; } } new Z().v'],
  ['ES2015', 'Map et Set', 'new Map([[1, 2]]).get(1) + new Set([3]).size'],
  ['ES2016', 'Array.includes', '[1].includes(1)'],
  ['ES2016', 'exposant **', '2 ** 3'],
  ['ES2017', 'Object.entries', 'Object.entries({ a: 1 }).length'],
  ['ES2017', 'async / await', '(async () => 1)() instanceof Promise'],
  ['ES2018', 'étalement d’objet', '({ ...{ a: 1 } }).a'],
  ['ES2019', 'Object.fromEntries', 'Object.fromEntries([["a", 1]]).a'],
  ['ES2019', 'Array.flat', '[[1]].flat().length'],
  ['ES2019', 'catch sans liaison', 'try { null.x; } catch { 1; }'],
  ['ES2020', 'chaînage optionnel ?.', '({}).a?.b === undefined'],
  ['ES2020', 'coalescence ??', '(null ?? 1)'],
  ['ES2020', 'BigInt', 'typeof 1n'],
  ['ES2020', 'Promise.allSettled', 'typeof Promise.allSettled'],
  ['ES2021', 'String.replaceAll', '"aa".replaceAll("a", "b")'],
  ['ES2021', 'affectation logique ||=', 'let z = 0; z ||= 1; z'],
  ['ES2021', 'séparateur numérique', '1_000'],
  ['ES2022', 'Array.at', '[1, 2].at(-1)'],
  ['ES2022', 'Object.hasOwn', 'Object.hasOwn({ a: 1 }, "a")'],
  ['ES2022', 'champ privé de classe', 'class P { #x = 1; lire() { return this.#x; } } new P().lire()'],
  ['ES2022', 'await de haut niveau', 'typeof structuredClone'],
  ['ES2023', 'Array.findLast', '[1, 2].findLast((x) => x === 1)'],
  ['ES2023', 'Array.toSorted', '[2, 1].toSorted()[0]'],
  ['ES2024', 'Object.groupBy', 'Object.groupBy([1], (x) => x)'],
  ['ES2024', 'Array.fromAsync', 'typeof Array.fromAsync'],
];

/**
 * Écrit dans le journal ce que ce moteur accepte, norme par norme.
 *
 * `function` déclarée, et non `const` fléchée : c'est un point d'entrée, il
 * doit apparaître au menu d'exécution de l'éditeur.
 */
function sonderLeMoteur() {
  const resultats = SONDE_ES_ESSAIS_.map(([norme, quoi, essai]) => {
    try {
      // eslint-disable-next-line no-eval
      const valeur = eval(essai);
      const inutilisable = valeur === undefined || valeur === 'undefined';
      return { norme, quoi, accepte: !inutilisable, detail: inutilisable ? 'rend undefined' : '' };
    } catch (erreur) {
      return { norme, quoi, accepte: false, detail: String(erreur.message || erreur).slice(0, 90) };
    }
  });

  const parNorme = {};
  resultats.forEach(({ norme, accepte }) => {
    parNorme[norme] = parNorme[norme] || { oui: 0, non: 0 };
    parNorme[norme][accepte ? 'oui' : 'non'] += 1;
  });

  const lignes = [
    `Sonde ECMAScript — ${Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm')}`,
    '',
    ...resultats.map(({ norme, quoi, accepte, detail }) => `${accepte ? '  oui ' : '  NON '}`
      + `${norme}  ${quoi}${detail ? `  — ${detail}` : ''}`),
    '',
    'Résumé par norme :',
    ...Object.keys(parNorme).sort().map((norme) => {
      const { oui, non } = parNorme[norme];
      return `  ${norme} : ${oui}/${oui + non}`;
    }),
    '',
    'Ce relevé vaut pour aujourd’hui : Google met V8 à jour sans préavis.',
    'Ne pas adopter une construction sur la foi de ce qui marche dans Node —',
    'le banc d’essai tourne hors de Google, le déploiement non.',
  ];

  Logger.log(lignes.join('\n'));
  return resultats;
}
