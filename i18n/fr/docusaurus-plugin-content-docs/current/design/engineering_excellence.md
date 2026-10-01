---
title: "L'excellence d'ingénierie, par défaut"
description: "Les principes d'ingénierie qui sous-tendent les modules de RAD Platform — valeurs par défaut sécurisées, moindre privilège, Terraform reproductible et préparation opérationnelle."
---
<!-- translated-from: docs/design/engineering_excellence.md @ 6b90c32 -->

# L'excellence d'ingénierie, par défaut {#engineering-excellence-by-default}

<img src="https://storage.googleapis.com/rad-public-2b65/guides/Engineering_Excellence.png" alt="L'excellence d'ingénierie, par défaut" style={{maxWidth: "100%", borderRadius: "8px"}} />

## Vue d'ensemble {#overview}

La plateforme RAD vous permet de déployer des solutions métier de niveau production — plateformes de contenu et
de commerce, ERP, santé, systèmes d'apprentissage, banque, assistants d'IA,
automatisation de workflows, et bien d'autres — en **quelques heures plutôt qu'en plusieurs semaines**.

Ce qui distingue RAD n'est pas seulement la rapidité. Chaque solution repose sur le même socle
durci, qui intègre les principes et pratiques d'ingénierie sur lesquels s'appuient les plus grandes
entreprises technologiques du monde pour exécuter des logiciels **de manière sécurisée, fiable et
rentable à grande échelle**. Vous n'assemblez pas ces pratiques vous-même, et vous
ne touchez jamais aux rouages de l'infrastructure : vous configurez chaque solution au moyen d'un ensemble guidé
de variables, et la plateforme applique en dessous une ingénierie éprouvée.

Ce document résume les résultats que RAD apporte selon six dimensions —
**sécurité, conformité, coûts, productivité des développeurs, modernisation et
montée en compétences** — ainsi que les pratiques éprouvées qui sous-tendent chacune d'elles.

---

## Le principe : des pratiques éprouvées, appliquées automatiquement {#the-principle-proven-practices-applied-automatically}

La plupart des équipes savent *à quoi* ressemble une bonne ingénierie — sécurité zero trust, moindre
privilège, défense en profondeur, intégrité de la chaîne d'approvisionnement, calcul élastique et correctement
dimensionné, observabilité complète, modifications auditables et expérience développeur en
libre-service. Peu ont le temps de tout mettre en œuvre correctement pour chaque
application, à chaque fois.

RAD le fait une seule fois, selon un niveau d'exigence élevé, et l'applique à **chaque** déploiement. Les
pratiques ci-dessous sont activées par défaut ; les plus déterminantes sont exposées sous forme de
simples interrupteurs et d'options de dimensionnement que vous contrôlez via la
configuration de chaque solution. Le travail d'ingénierie difficile est déjà fait — à la manière des meilleurs du
secteur.

---

## 1. Sécurité et Zero Trust {#1-security--zero-trust}

> **Pratiques appliquées :** accès Zero Trust, moindre privilège, défense en profondeur,
> sécurité par défaut, intégrité de la chaîne d'approvisionnement logicielle.

- **L'accès contrôlé par l'identité remplace le VPN.** Chaque requête est authentifiée auprès
  des identités Google de votre organisation avant d'atteindre l'application — aucun client
  VPN, aucun port de pare-feu ouvert. L'accès est accordé ou révoqué par identité et entièrement
  journalisé. *Se configure avec* `enable_iap`, `iap_authorized_users`,
  `iap_authorized_groups`.
- **Protection en périphérie.** Un pare-feu applicatif web mondial avec protection DDoS managée
  bloque les attaques de l'OWASP Top 10 (injection SQL, XSS, traversée de répertoires),
  applique une limitation de débit adaptative contre les robots et les abus, et restreint
  les chemins d'administration à des réseaux connus. *Se configure avec* `enable_cloud_armor`,
  `admin_ip_ranges`.
- **Les secrets ne sont jamais en clair.** Les mots de passe, clés d'API et jetons sont conservés dans un
  coffre de secrets managé et fournis à l'application uniquement à l'exécution — jamais
  visibles dans la configuration, les journaux ou les images. Les identifiants peuvent faire l'objet d'une rotation automatique afin de
  raccourcir leur durée de validité. *Se configure avec* `enable_auto_password_rotation`.
- **Une chaîne d'approvisionnement logicielle de confiance.** Seules les images de conteneurs portant une
  signature cryptographique valide sont autorisées à s'exécuter ; les images non signées, non analysées ou altérées
  sont rejetées avant leur démarrage. *Se configure avec* `enable_binary_authorization`.
- **Des certificats de charge de travail à courte durée de vie.** Lorsqu'un maillage de services est activé, le
  certificat TLS mutuel de chaque charge de travail est émis et renouvelé automatiquement avec une courte
  durée de validité, et une autorité de certification racine gérée par le client peut adosser le maillage
  pour les environnements qui exigent leur propre PKI.
- **Prévention de l'exfiltration de données.** Un périmètre de services autour de vos API cloud empêche
  la copie de données hors du projet — même au moyen d'un identifiant compromis — et
  maintient isolées les données de chaque tenant. Un mode d'observation sûr vous permet de valider le
  périmètre avant de l'appliquer. Disponible dans un projet que vous apportez vous-même ; il n'est
  pas proposé dans un projet géré par RAD, où le périmètre se trouverait dans l'organisation propre
  de RAD. *Se configure avec* `enable_vpc_sc`, `vpc_sc_dry_run`.
- **Le moindre privilège en standard.** Chaque déploiement s'exécute sous une identité dédiée
  au périmètre restreint plutôt que sous une identité par défaut étendue, utilise une identité de charge de travail
  sans clé (aucun fichier de clé de longue durée susceptible de fuiter) et chiffre les données au repos avec
  des clés contrôlées par le client. Les erreurs de configuration sont détectées et bloquées avant tout
  provisionnement.
- **Visibilité continue de la posture.** Des constats de sécurité centralisés et une journalisation d'audit
  à l'échelle du projet vous offrent une vue unique et durable de votre état de sécurité.

---

## 2. Conformité et gouvernance {#2-compliance--governance}

> **Pratiques appliquées :** gestion des modifications auditable, séparation des tâches,
> preuves sous forme de configuration, correction automatisée des dérives.

- **Chaque modification est relue, attribuable et réversible**, et chaque déploiement est
  enregistré et reproductible — les preuves de gestion des modifications qu'attendent les auditeurs, sans
  collecte manuelle.
- **Les contrôles sont de la configuration, pas des captures d'écran.** Les contrôles de la plateforme correspondent
  directement aux familles d'audit courantes qui sous-tendent **SOC 2, ISO 27001, HIPAA et le
  RGPD** — identités et accès, gestion des secrets, résidence des données et isolation
  réseau, intégrité de la chaîne d'approvisionnement, contrôles réseau, journalisation d'audit, sauvegarde et
  isolation des tenants.
- **La séparation des tâches est intégrée** grâce à des rôles opérationnels clairement séparés
  (administrateur, utilisateur, partenaire, agent, finance, support, formateur) — les preuves
  structurelles que recherchent les auditeurs.
- **Les dérives peuvent être corrigées en réappliquant.** Réappliquer la configuration éprouvée
  d'un déploiement (une mise à jour) annule les modifications non autorisées, et la validation bloque
  les erreurs de configuration avant même qu'elles ne prennent effet.
- **La conformité par tenant** est assurée par des périmètres isolés (lors d'un déploiement dans votre propre projet),
  des identités dédiées et des limites de coûts et de ressources propres à chaque tenant.

| Domaine | Approche manuelle | Avec RAD |
|---|---|---|
| Préparation d'audit SOC 2 / ISO 27001 | Collecte manuelle des preuves | Cartographie des preuves de contrôle préassemblée ; les contrôles sont de la configuration |
| Piste d'audit | Reconstituée à partir de journaux épars | Chaque modification et chaque déploiement enregistrés, attribuables et exportables |
| Rotation des secrets | Manuelle ou par scripts sur mesure | Automatisée selon un calendrier |
| Dérive des contrôles | Revue manuelle périodique | La réapplication annule les dérives ; la validation bloque les erreurs de configuration avant l'application |

---

## 3. Optimisation des coûts {#3-cost-optimisation}

> **Pratiques appliquées :** FinOps — élasticité, dimensionnement adapté, automatisation du cycle de vie et
> transparence des coûts.

- **Calcul avec mise à l'échelle jusqu'à zéro.** Fixez le nombre minimal d'instances à zéro et les applications
  au repos ne coûtent rien ; vous payez à la requête et à la seconde, et la plateforme
  s'adapte automatiquement à la demande. *Se configure avec* `min_instance_count`,
  `max_instance_count`, `cpu_limit`, `memory_limit`.
- **Calcul Spot pour les travaux interruptibles.** Certains déploiements de référence GKE (comme
  les démonstrations bancaires) exécutent leurs nœuds sur de la capacité Spot pour un coût des nœuds inférieur
  d'environ **60–90%**, en contrepartie de préemptions occasionnelles à court préavis.
- **Cycle de vie du stockage automatisé.** Les anciennes révisions d'applications et images de conteneurs sont
  élaguées automatiquement, et le stockage objet bascule vers des niveaux moins coûteux au fil du temps —
  de sorte que le coût du stockage n'augmente pas insidieusement sans surveillance.
- **Délestage par la diffusion de contenu.** Servir le contenu pouvant être mis en cache depuis la périphérie mondiale
  réduit le calcul et la sortie réseau pour les applications principalement en lecture.
  *Se configure avec* `enable_cdn`.
- **Répartition et refacturation des coûts.** Une convention de nommage des ressources cohérente se répercute
  dans les libellés de facturation, ce qui permet un reporting des coûts par tenant et par application sans
  étiquetage manuel.
- **Services configurables par niveau.** Chaque service partagé coûteux propose un
  choix coût/performance — tailles de machine des bases de données, cache standard ou haute disponibilité,
  niveaux de stockage, et la possibilité de se passer entièrement d'un système de fichiers partagé
  (`enable_nfs`).
- **Les schémas coût/performance** — *Low Cost* (mise à l'échelle jusqu'à zéro), *Low Latency* (conserver une
  instance active) et *Balanced* — sont des points de départ judicieux que vous appliquez au moyen des
  options de dimensionnement ci-dessus.

---

## 4. Productivité des développeurs {#4-developer-productivity}

> **Pratiques appliquées :** platform engineering et plateformes de développement internes —
> chemins balisés, libre-service et convention plutôt que configuration.

- **Un catalogue de solutions prêtes à l'emploi.** Une bibliothèque en expansion couvre la gestion
  de contenu, l'ERP et les systèmes de gestion, la santé, l'éducation, la banque, la recherche, les outils d'IA
  et de LLM, l'automatisation de workflows et les frameworks applicatifs — la plupart disponibles
  pour les environnements d'exécution serverless (Cloud Run) et Kubernetes (GKE). Les équipes déploient une
  solution éprouvée au lieu d'en construire une.
- **Configuration en libre-service.** Un formulaire guidé organise chaque option en groupes
  logiques, dans un ordre clair et avec un texte d'aide, de sorte qu'un non-spécialiste peut déployer en toute confiance une pile
  complexe et sécurisée — sans écrire ni maintenir la moindre infrastructure.
- **Des valeurs par défaut affirmées, activables d'un seul interrupteur.** Des capacités transverses substantielles —
  accès contrôlé par l'identité, diffusion en périphérie, attestation d'images, périmètres de services
  (lors d'un déploiement dans votre propre projet), budgets d'interruption — ne sont chacune qu'à un paramètre près, préintégrées et cohérentes.
- **Convention plutôt que configuration.** Chaque solution suit la même forme et les
  mêmes noms d'options : dès qu'une équipe en maîtrise une, elle les connaît toutes.
- **Un chemin rapide et sûr vers la production**, avec un build et un déploiement automatisés et une validation
  cohérente à chaque modification.

---

## 5. Modernisation des applications {#5-application-modernisation}

> **Pratiques appliquées :** modernisation incrémentale — lift-and-shift, puis replatforming,
> puis refactoring — avec substitution par des services managés.

- **Une zone d'atterrissage pour le lift-and-shift.** Faites migrer un parc VMware existant vers Google
  Cloud grâce à un environnement de cloud privé clés en main et une connectivité sécurisée — aucun
  refactoring requis dans un premier temps.
- **Changer de plateforme sans réécrire.** Remplacez les piles de machines virtuelles construites à la main par
  des solutions managées à mise à l'échelle automatique issues du catalogue — WordPress, wikis, Odoo ERP,
  Moodle, OpenEMR, Cyclos, Ghost, Strapi, et bien d'autres — en conservant l'application tout en
  vous délestant de la charge d'exploitation.
- **Substitution par des services managés.** Les dépendances auto-hébergées sont remplacées par des
  équivalents managés, plus sûrs et nécessitant moins de maintenance :

  | Auto-hébergé | Remplacement managé |
  |---|---|
  | Base de données sur une VM | SQL managé (réseau privé, restauration à un instant donné, HA) |
  | Redis sur une VM | Cache en mémoire managé |
  | Serveur de fichiers sur une VM | Stockage de fichiers réseau managé |
  | Registre d'images auto-hébergé | Registre d'artefacts managé |
  | CI/CD auto-hébergé | Build et livraison managés |
  | Coffre de secrets auto-hébergé | Coffre de secrets managé |
  | Supervision auto-hébergée | Supervision et journalisation managées |
  | VPN pour l'accès d'administration | Accès contrôlé par l'identité |

- **Refactoriser vers le serverless** pour supprimer les dernières ressources de calcul préprovisionnées, en ne payant
  que ce qui s'exécute.
- **Le renforcement de la sécurité est offert.** Les déploiements modernisés héritent automatiquement du réseau
  privé, de l'accès contrôlé par l'identité, de l'attestation d'images, de la protection
  en périphérie et du chiffrement géré par le client.
- **Les outils de migration** prennent en charge la bascule des données (export, import et initialisation
  de la base de données), de sorte que le déplacement de données en production devient une opération de routine.

---

## 6. Formation et montée en compétences {#6-education--enablement}

> **Pratiques appliquées :** un apprentissage lié à des systèmes réels et en fonctionnement.

- **Un apprentissage aligné sur les certifications.** Sept parcours de certification Google Cloud —
  Associate Cloud Engineer, Professional Cloud Architect, Professional Cloud
  Developer, Professional Cloud Database Engineer, Professional Cloud Network
  Engineer, Professional Cloud DevOps Engineer et Professional Cloud Security
  Engineer — sont directement liés à des solutions fonctionnelles, de sorte que les apprenants explorent les concepts de manière pratique
  plutôt que dans l'abstrait.
- **Des labs pratiques** guident un professionnel dans le déploiement, l'exploitation, l'observation et le
  dépannage de chaque solution sur la plateforme.
- **Des guides d'exploitation par rôle** pour les administrateurs, utilisateurs, partenaires, agents,
  membres de la finance, du support et formateurs clarifient les responsabilités et les procédures.
- **Intégration rapide.** Des guides structurés et des solutions de référence rendent un nouveau
  contributeur productif en quelques heures plutôt qu'en plusieurs jours.

| Domaine | Sans RAD | Avec RAD |
|---|---|---|
| Préparation aux certifications | Formation séparée ; étude abstraite | Parcours liés à une infrastructure en fonctionnement ; exploration pratique |
| Intégration des développeurs | Des jours de documentation non structurée et de savoir tribal | Guides structurés et solutions de référence ; productif en quelques heures |
| Transfert de connaissances en sécurité | Ponctuel, dépendant des experts | Une revue de sécurité reproductible |

---

## Les résultats en un coup d'œil {#outcomes-at-a-glance}

| Dimension | Pratique éprouvée | Ce que vous obtenez | Résultat clé |
|---|---|---|---|
| Sécurité et Zero Trust | Zero trust, moindre privilège, défense en profondeur | Accès sans VPN, WAF/DDoS, secrets chiffrés, images signées | Des catégories entières d'attaques éliminées par défaut |
| Conformité et gouvernance | Modifications auditables, séparation des tâches | Preuves sous forme de configuration pour SOC 2 / ISO 27001 / HIPAA / RGPD | Une cartographie des preuves de contrôle préassemblée |
| Optimisation des coûts | FinOps — élasticité, dimensionnement adapté | Mise à l'échelle jusqu'à zéro, automatisation du cycle de vie, délestage en périphérie, refacturation | Les applications au repos ne coûtent rien ; le coût du stockage ne dérive pas |
| Productivité des développeurs | Platform engineering, libre-service | Un catalogue de solutions sécurisées, prêtes à l'emploi | Déployer une solution éprouvée au lieu d'en construire une |
| Modernisation | Lift-and-shift → replatforming → refactoring | Zone d'atterrissage, substitutions managées, outils de migration | Migrer et moderniser sans réécrire |
| Formation et montée en compétences | Apprentissage sur des systèmes réels | Parcours de certification, labs, guides par rôle | Nouveaux contributeurs productifs en quelques heures |

---

## Vous gardez la main {#you-stay-in-control}

Les bonnes pratiques sont la règle par défaut — mais c'est à vous de les ajuster. Chaque solution est façonnée
entièrement au moyen de variables de configuration, sans aucun code d'infrastructure à écrire ni à
maintenir. Quelques-uns des leviers que vous contrôlez :

- **Posture de sécurité :** `enable_iap`, `enable_cloud_armor`, `enable_binary_authorization`,
  `enable_vpc_sc` (lors d'un déploiement dans votre propre projet), `enable_auto_password_rotation`, `admin_ip_ranges`.
- **Coûts et performances :** `min_instance_count`, `max_instance_count`, `cpu_limit`,
  `memory_limit`, `enable_cdn`, `enable_nfs`, ainsi que les choix de niveau par service.
- **Accès et diffusion :** `iap_authorized_users`, `iap_authorized_groups`, domaines
  personnalisés et diffusion de contenu.

---

## En résumé {#in-summary}

Parce que la discipline d'ingénierie est déjà intégrée, chaque déploiement RAD est
**sécurisé, conforme, économique et prêt pour la production dès le premier jour** — et non
après des mois de durcissement. Vous obtenez les résultats pour lesquels les plus grandes
entreprises technologiques du monde conçoivent leurs systèmes, au travers d'une expérience simple et guidée, et ajustés à
vos besoins par la seule configuration.
