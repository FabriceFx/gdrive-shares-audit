# Journal des modifications (Changelog)

Toutes les modifications notables apportées à ce projet sont documentées dans ce fichier.

Le format est basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.0.0/)
et ce projet adhère au [Semantic Versioning](https://semver.org/lang/fr/).

---

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
