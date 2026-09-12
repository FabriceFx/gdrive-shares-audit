# Journal des modifications (Changelog)

Toutes les modifications notables apportées à ce projet sont documentées dans ce fichier.

Le format est basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.0.0/)
et ce projet adhère au [Semantic Versioning](https://semver.org/lang/fr/).

---

## [5.4.0] - 2026-09-12

Portage sur le socle (`socle-apps-script` v0.9.0). Cinq modules recopiés,
24 occurrences à reprendre ramenées à 4 — les quatre dernières étant la feuille
de style, laissée hors périmètre : `Index.html` est engendré depuis
`gdshares/template.html`, et la modifier ici serait écrasé au prochain build.

### Corrigé

- **Trois `catch` faisaient disparaître des données d'un rapport qui se
  déclarait complet.** Un Drive dont les membres n'étaient pas lisibles rendait
  `[]`, et `[]` devient « propriétaire inconnu » : rien ne distinguait « ce
  Drive n'a aucun membre » de « je n'ai pas su les lire ». Deux autres
  écartaient silencieusement un élément illisible du balayage et de
  l'hydratation. Le repli n'a pas changé — c'était le bon — mais chaque échec
  est désormais **compté et nommé par sa cause**, et le bilan remonte avec les
  résultats de `scanPage` et de `getTargets`.
- **Trois `catch` sur les propriétés du script** retombaient sur les constantes
  du code sans le dire : la classification interne/externe/partenaire changeait
  alors en silence. Comptés eux aussi.
- **Les quatre messages levés portent leur remède** — ils disaient ce qui avait
  échoué, pas quoi faire ensuite.

### Modifié

- `withRetry_` délègue à `SocleReprises` en gardant son nom : une vingtaine de
  sites d'appel s'en lisent mieux. **Sa dispersion et son plafond ont été
  remontés dans le socle** — sur ce point, le projet avait raison contre lui.
- `listAllPermissions` passe par `SocleApi.parcourir` : borne contre la boucle
  infinie, et un parcours partiel ne se dit plus complet.
- `doGet` passe par `SocleWeb.page` : le mode X-Frame y est posé
  explicitement et fermé, là où il était laissé au défaut implicite.
- Les dates passent par `SocleDates` : format de lecture (« 12 septembre 2026
  à 13:26 ») pour l'interface, format de stockage pour le nom du fichier
  d'export, qui se trie ainsi dans Drive.

### Ajouté

- **Neuf assertions au banc** (59 → 68) autour du défaut qui a motivé le
  portage : un Drive lisible rend ses membres sans rien absorber ; un Drive
  illisible rend la même liste vide qu'avant **mais compte l'échec** ; une
  surcharge passagère est rattrapée par les reprises avant d'être absorbée.
  Le catch muet, réintroduit, fait échouer le banc.

## [5.3.0] - 2026-09-12

Mise aux normes ES6+ et premier banc d'essai. Aucun changement de comportement
attendu : la classification, les scores et l'interface sont inchangés.

### Modifié

- **Plus un seul `var` ni une seule `function (…)` anonyme.** 27 déclarations,
  38 fonctions anonymes, une boucle `for (var i…)` et un paramètre par défaut
  simulé (`tries = tries || 5`) convertis. Les 12 concaténations de chaînes
  portant une variable sont devenues des gabarits ; celles qui ne font que
  découper un long littéral sur plusieurs lignes sont restées, n'étant pas un
  reste d'ES5.
- **Les 20 fonctions internes sont devenues des `const` fléchées.** L'éditeur
  Apps Script ne propose au menu d'exécution que les `function` déclarées :
  seules y restent les 17 qui doivent y être — `doGet`, les 12 appelées par le
  client et les 4 lancées à la main par l'administrateur.
- **`PathResolver` est devenue une `class`.** Elle s'instancie avec `new`, ce
  qu'une fonction fléchée ne permet pas : la conversion mécanique l'avait
  cassée sans qu'aucune vérification de syntaxe ne le voie.
- **Les constantes globales passent de `var` à `const`**, et
  `build_apps_script.py` suit — il accepte les deux en lecture et écrit
  toujours `const`. L'argument du hissage qui justifiait `var` ne tenait pas :
  aucune de ces constantes n'est lue au chargement.

### Ajouté

- **Banc d'essai** (`node banc/test.js`), 59 assertions hors de Google. Il
  couvre `Classify.gs`, qui est de la logique pure — c'est là que se décide ce
  qui compte comme interne, externe ou partenaire, et une erreur y produit un
  rapport faux qui a l'air juste. Écrit **avant** la conversion, pour figer le
  comportement existant : un test qui n'a jamais vu passer l'ancien code ne
  prouve rien de la conversion.
- **Détecteur de « Fonction de script introuvable ».** Le client appelle le
  serveur par nom dynamique (`google.script.run[nom]`) : aucune vérification de
  syntaxe ne verrait la disparition d'une de ces fonctions, et l'erreur
  n'apparaîtrait que dans le navigateur, au clic, pour ce seul bouton. Le banc
  vérifie donc que les 17 noms publics restent déclarés, qu'aucun nom interne
  appelé n'est orphelin, et que le projet concaténé se charge.

### Notes

Le banc a été éprouvé sur sept défauts réintroduits ; six le font échouer. Le
septième — `lv.rank > top.rank` devenu `>=` — est un mutant équivalent : tous
les partages de même rang pointent le même objet de niveau.

## [5.2.0] - 2026-09-04

> **Le constat qui dérange :** *Partager un document prend 30 secondes. Mais ce partage dure souvent des années.*
> Un lien ouvert à la va-vite pour une réunion survit au projet, au contrat, et parfois même au départ du collaborateur. Personne ne le referme, tout simplement parce que dans l'interface native de Google Drive, personne ne le voit. On vit avec l'illusion d'un espace de travail maîtrisé, alors que des dizaines de portes dérobées restent grandes ouvertes. Cette version 5.2.0 apporte la lucidité totale et sépare enfin le risque réel du bruit de fond.

### Ajouté
- **Détection des Drives partagés externes** : identification automatique des Drives appartenant à des organisations tierces (clients, prestataires où aucun gestionnaire n'appartient à vos domaines). Leurs fichiers ne polluent plus vos statistiques d'exposition interne mais restent audités séparément.
- **Traçabilité des contributions dans les Drives tiers** : comptage précis et identification des créateurs (via l'API Drive Activity côté Apps Script) et derniers contributeurs de vos domaines ayant déposé des documents hors de votre périmètre.
- **Gestion affinée des rôles sur Drives partagés** : affichage du rôle utilisateur et indication des gestionnaires à contacter pour les Drives où l'utilisateur n'a pas les droits de gestion des membres.
- **Liste blanche de partenaires référencés** (`--partner-domains` et `setPartnerDomains`) : permet de distinguer les tiers de confiance légitimes des partages externes anormaux ou involontaires.
- **Déclaration des domaines secondaires et alias** (`--internal-domains` et `setInternalDomains`) : évite de classifier à tort des collègues d'autres entités du groupe comme des externes.
- **Export Google Sheets à 3 feuilles** : export direct natif (Synthèse, Éléments, Permissions) formaté en mode RAW, sans risque d'injection de formules.
- **Bilinguisme complet** : interface, alertes et documentation intégrale en français et anglais.

### Amélioré
- **Performance et passage à l'échelle** : pagination asynchrone côté Apps Script pour s'affranchir du plafond d'exécution de 6 minutes, avec reprise dynamique (`hydrateFiles`).
- **Résilience API** : mécanisme de rejeu automatique avec backoff exponentiel (`withRetry_`) face aux limitations de quotas Drive Workspace.
- **Tableau de bord HTML** : filtres multicritères instantanés, recherche plein texte, tri et liens profonds directs vers la gestion des partages dans Google Drive.

---

## [5.1.0] - 2026-08-20

### Ajouté
- Sélecteur interactif de périmètre avant analyse dans la WebApp Apps Script (Mon Drive complet, dossiers ciblés, Drives partagés spécifiques).
- Bouton de relance d'analyse in-situ sans rechargement de page pour conserver l'état du navigateur.
- Prise en compte de la portée OAuth restreinte `--metadata-only` en ligne de commande pour les environnements à contrainte stricte.

### Corrigé
- Gestion des comptes `@gmail.com` personnels pour lesquels tout destinataire tiers est rigoureusement considéré externe.

---

## [5.0.0] - 2026-06-15

### Ajouté
- Architecture unifiée : moteur Python CLI d'un côté, application web Google Apps Script de l'autre partageant le même gabarit visuel.
- Système de scoring de risque (0 à 100) pondérant la sensibilité des droits (écriture vs lecture), l'exposition publique et les partages sans date d'expiration.
- Classification rigoureuse sur 9 niveaux d'exposition (du public au strictement privé).
- Conformité de licence sous Elastic License 2.0.
