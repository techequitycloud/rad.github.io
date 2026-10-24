---
title: "Azimutt sur Google Cloud Run"
description: "Référence de configuration pour le déploiement d'Azimutt sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Azimutt_CloudRun.md @ 1665a43e sha256:94a95456a2b0 -->

# Azimutt sur Google Cloud Run {#azimutt-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Azimutt_CloudRun.png" alt="Azimutt sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Azimutt est un explorateur de schémas de base de données open source de nouvelle
génération et un outil ERD (diagramme d'entité-relation) pour les bases de données
réelles, construit avec Elixir/Phoenix. Il permet aux équipes d'explorer, de
documenter et de concevoir de grands schémas (des milliers de tables), de rechercher
parmi les colonnes et les relations, et de partager des diagrammes. Ce module déploie
Azimutt sur **Cloud Run v2** au-dessus du socle [App_CloudRun](App_CloudRun.md), qui
provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'Azimutt utilise et sur la manière de
les explorer et de les opérer depuis la console Google Cloud et la ligne de commande.
Pour les mécanismes communs à chaque application Cloud Run — identité de service,
entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — reportez-vous au [guide du socle App_CloudRun](App_CloudRun.md) plutôt
que de les répéter ici.

---

## Ce que coûte Azimutt sur RAD, et comment cela se compare {#what-azimutt-costs-on-rad-and-how-that-compares}

**Le module Cloud Run d'Azimutt sur RAD coûte environ 89 $ US par mois dans un projet que vous possédez, sans frais de licence pour le logiciel lui-même.** RAD facture des frais de module uniques de 110 crédits (11 $ US au prix de la recharge) dans un projet que vous possédez, et 99 crédits (10 % de moins) dans un projet géré par RAD. Si Azimutt doit fonctionner en continu sur plusieurs pods ou à côté d'autres charges de travail Kubernetes, consultez plutôt le [guide GKE](Azimutt_GKE.md). Les chiffres sont valables au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

Si vous n'en avez besoin qu'occasionnellement — pour préparer une certification, une démo, un besoin saisonnier — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits, de sorte que les quelque 89 $ US par mois deviennent presque rien. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

Vous payez pour trois choses :

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 110 crédits (11 $ US au prix de la recharge) | 99 crédits (10 % de moins) |
| Temps de build | Quelques crédits, facturés à la minute de build | Idem |
| Coût de fonctionnement Google Cloud | Facturé par Google à votre propre compte de facturation, environ 89 $ US par mois pour la configuration par défaut (tableau ci-dessous) | Facturé à l'heure en crédits ; RAD publie **26 crédits par jour**, soit environ 780 par mois (environ 78 $ US au prix de la recharge, 62 $ US au tarif du plan Scale) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge ponctuelle, et moins avec un plan mensuel. Dans un projet géré par RAD, la base de données est partagée par toutes les applications du projet, donc une deuxième application n'en ajoute pas une deuxième.

**Coût de fonctionnement par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Cloud Run, 2x vCPU / 4 Gio (scaleToZero) | 31,53 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| **Total** | **environ 89 $ US** |

### Comment cela se compare {#how-it-compares}

- **Aucun concurrent SaaS de marque n'est un équivalent parfait pour Azimutt, donc la comparaison honnête est un simple serveur autogéré.** En exécutant le même logiciel open source vous-même, un Hetzner CPX22 (2 vCPU/4 Go, environ 24 $/mois) ou un DigitalOcean 2 vCPU/4 Go Droplet (également 24 $/mois) est à peu près de la même taille ; un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) coûte environ 49 $/mois.
- **RAD n'est pas moins cher qu'un VPS nu en termes d'argent, et n'essaie pas de l'être.** Ce que RAD ajoute pour un prix similaire, c'est une base de données gérée, Secret Manager pour les identifiants, et une surveillance qui serait autrement votre propre travail à configurer, patcher et sauvegarder.
- **Le temps de l'administrateur est le coût réel qu'un VPS ne montre pas.** Les correctifs de sécurité, les sauvegardes et les mises à niveau de version sur un serveur nu sont un travail que quelqu'un doit continuer à faire ; les services gérés de RAD absorbent cela.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Azimutt s'exécute dans **un projet géré par RAD pour vous**, vous avez une option qui va bien au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour presque rien.** Cela convient bien mieux à une utilisation occasionnelle — préparation d'une certification, démo, besoin saisonnier — qu'à l'exécution continue d'Azimutt.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer purement et simplement le projet. Google ne le supprime pas immédiatement : il conserve le projet, récupérable, pendant 30 jours, et comme la facturation est déjà déliée, rien n'est facturé pendant cette attente. Contrairement à la suppression d'un seul module, cela ne détruit pas la base de données, aucune VM ou la ressource de calcul une par une — l'ensemble du projet s'arrête simplement, et rien n'est facturé entre-temps.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours, seul le propriétaire du projet peut le restaurer. RAD demande à Google de restaurer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter **Update** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits au total (moins de 1 $ US), contre le paiement des frais de module et une reconstruction complète.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un projet dont RAD gère uniquement la facturation), vous devez le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est admise comme la création d'un nouveau projet, donc votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude et de démo conviennent). Google indique que la plupart des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.
- **Un véritable manque : les sauvegardes ne survivent pas.** Tout ce qu'Azimutt écrit dans un bucket de sauvegarde à l'intérieur du projet est très probablement perdu dès que vous supprimez le projet, même si le projet lui-même est récupérable pendant 30 jours — la suppression logicielle de Cloud Storage est explicitement désactivée pour ce bucket. Quiconque a personnalisé le déploiement et souhaite conserver ce travail doit copier une sauvegarde (vers Google Drive ou un bucket en dehors du projet) avant de la supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

C'est la solution de repli pour un projet que vous possédez, ou une fois que la fenêtre de restauration de 30 jours ci-dessus est passée : **supprimez le déploiement et redéployez-le lorsque vous en aurez à nouveau besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau, plus les builds : environ 115 crédits (environ 11,50 $ US) dans votre propre projet, ou 104 crédits dans un projet géré par RAD, car RAD reconstruit les ressources à partir de zéro. La suppression permet d'économiser de l'argent une fois qu'Azimutt resterait inutilisé assez longtemps pour compenser ce coût de redéploiement par rapport à son propre coût de fonctionnement — environ 4 jours ou plus dans votre propre projet (2,95 $ US/jour) ou 4 jours ou plus dans un projet géré par RAD (26 crédits/jour).
- **La majeure partie du coût de fonctionnement est généralement l'infrastructure partagée.** La base de données ne s'arrête que si rien d'autre dans le projet ne l'utilise, donc la suppression d'Azimutt pendant qu'une autre application partage le projet n'économise que la partie calcul d'Azimutt.
- **Conservez d'abord vos données.** Tout ce qu'Azimutt écrit dans un bucket de sauvegarde à l'intérieur du déploiement est supprimé avec lui — copiez la dernière sauvegarde (vers Google Drive, ou un bucket que vous conservez) avant de la supprimer si vous voulez la conserver.
- **RAD ne recrée pas un déploiement supprimé pour vous.** Vous saisissez à nouveau les paramètres lorsque vous redéployez.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant dispose d'Azimutt dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire exécute Azimutt pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais de RAD et estimation quotidienne des crédits de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les mécanismes de pause/restauration. Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Azimutt s'exécute comme un conteneur Elixir/Phoenix unique sur Cloud Run v2, écoutant sur le port **4000**. Le déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Conteneur Phoenix, 2 vCPU / 4 Gio par défaut, autoscaling sans serveur ; mise à l'échelle à zéro activée |
| Base de données | Cloud SQL pour PostgreSQL 15 | Obligatoire — Azimutt ne prend pas en charge MySQL ou d'autres moteurs |
| Stockage d'objets | Cloud Storage | Un bucket est provisionné ; les téléchargements par défaut se font sur un disque éphémère local (`FILE_STORAGE_ADAPTER = local`) |
| Secrets | Secret Manager | `SECRET_KEY_BASE` Phoenix auto-généré ; mot de passe de la base de données |
| Build d'image | Cloud Build + Artifact Registry | Wrapper léger FROM `ghcr.io/azimuttapp/azimutt`, mis en miroir dans Artifact Registry |
| Ingress | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut ; équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la
  couche d'application partagée ; la sélection de tout autre moteur interrompt le
  démarrage. Toutes les données du projet Azimutt (schémas, diagrammes, mises en
  page, utilisateurs) résident dans Postgres.
- **Azimutt se connecte à Postgres via TCP IP privée avec SSL, pas le socket.**
  Ecto/postgrex ne peut pas analyser le DSN du socket Unix de Cloud SQL, donc le
  point d'entrée cloud construit `DATABASE_URL` contre `DB_IP` et définit
  `DATABASE_ENABLE_SSL=true`. Le socket Cloud SQL est toujours monté (`enable_cloudsql_volume = true`)
  purement pour que le job `db-init` puisse créer le rôle/la base de données sans SSL.
- **`SECRET_KEY_BASE` est généré automatiquement** et stocké dans Secret Manager. Le
  faire pivoter après le premier démarrage déconnecte chaque session active ; ne le
  faites pivoter que pendant une fenêtre de maintenance.
- **La mise à l'échelle à zéro est activée par défaut** (`min_instance_count = 0`,
  `cpu_always_allocated = false`). Azimutt est une application requête/réponse et un démarrage à froid
  se reconnecte proprement à Postgres. Les démarrages à froid ajoutent quelques
  secondes de latence après l'inactivité ; définissez `min_instance_count = 1` pour les éviter.
- **Les migrations s'exécutent automatiquement à chaque démarrage.** La commande du
  conteneur est `/app/bin/migrate && /app/bin/server`, donc une mise à niveau de version applique ses
  modifications de schéma au démarrage — prévoyez un temps supplémentaire au premier
  démarrage.
- **`application_version = "latest"` correspond au tag `main` d'Azimutt.** Azimutt ne publie
  pas de tag `:latest` ; épinglez à une version spécifique en production.
- **L'inscription est ouverte par défaut.** Azimutt permet à toute personne ayant
  l'URL de créer un compte. Restreignez l'accès après avoir créé votre premier
  compte (domaine personnalisé + IAP, ou les propres paramètres d'authentification
  d'Azimutt via `environment_variables`).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de services et de ressources sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Azimutt {#a-cloud-run--the-azimutt-service}

Azimutt s'exécute en tant que service Cloud Run v2 qui s'adapte automatiquement en fonction de la charge des requêtes entre le nombre minimal et maximal d'instances. Chaque déploiement crée une révision immuable ; le trafic peut être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  # Confirm the composed DB wiring the entrypoint logged at boot:
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" \
    --limit 50 | grep cloud-entrypoint
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Azimutt stocke toutes les données de l'application (schémas, diagrammes, mises en page, utilisateurs, sources) dans une instance gérée de Cloud SQL pour PostgreSQL 15. Sur Cloud Run, le service se connecte via l'**IP privée** de l'instance avec SSL (`DATABASE_ENABLE_SSL=true`) — Ecto ne peut pas analyser le DSN du socket. Lors du premier déploiement, un job d'initialisation crée la base de données et le rôle de l'application ; Azimutt exécute ensuite ses propres migrations Ecto au démarrage.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les drapeaux, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe se trouvent dans les [Sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** est provisionné pour Azimutt. Avec la valeur par défaut `FILE_STORAGE_ADAPTER = "local"`, Azimutt écrit les fichiers téléchargés sur le disque éphémère local du conteneur plutôt que dans ce bucket ; le bucket existe pour les opérateurs qui basculent Azimutt vers un adaptateur de fichiers compatible S3. Les données du projet elles-mêmes résident dans Postgres.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<bucket-name>/          # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### D. Secret Manager {#d-secret-manager}

Le **`SECRET_KEY_BASE`** de Phoenix est généré automatiquement et stocké dans Secret Manager (utilisé pour signer et chiffrer les cookies de session). Le mot de passe de la base de données est géré séparément par le socle.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~secret-key-base"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### E. Cloud Build et Artifact Registry {#e-cloud-build--artifact-registry}

L'image d'Azimutt est un wrapper léger construit FROM `ghcr.io/azimuttapp/azimutt` ; Cloud Build produit l'image wrappée et elle est mise en miroir dans Artifact Registry (`enable_image_mirroring = true`). Le tag de base provient de l'argument de build `AZIMUTT_VERSION` (avec `latest` mappé à `main`).

- **Console :** Cloud Build → Historique ; Artifact Registry → Dépôts.
- **CLI :**
  ```bash
  gcloud builds list --project "$PROJECT" --limit 5
  gcloud artifacts docker images list <region>-docker.pkg.dev/$PROJECT/<repo> --include-tags
  ```

### F. Réseau et entrée {#f-networking--ingress}

Le service est accessible par son URL `run.app` par défaut. Un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peuvent être superposés ; les paramètres d'entrée et de sortie VPC contrôlent la connectivité. La sortie VPC est requise pour qu'Azimutt puisse atteindre l'IP privée de Cloud SQL.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run et Cloud SQL sont envoyées à Cloud Monitoring, avec des tests de disponibilité et des stratégies d'alerte facultatifs. Les lignes `cloud-entrypoint` affichent le chemin `DATABASE_URL` résolu, `PHX_HOST` et `PORT`.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Azimutt {#3-azimutt-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job d'initialisation exécute `db-init.sh` en utilisant `postgres:15-alpine`. Il crée de manière idempotente le rôle d'application (`LOGIN CREATEDB`) et la base de données, accorde `ALL` sur la base de données et le schéma `public`, et `ALTER` le propriétaire du schéma — Azimutt a besoin de tous les droits DDL car il exécute ses propres migrations. Le job peut être réexécuté en toute sécurité.
- **Les migrations s'exécutent au démarrage.** La commande du conteneur est `/app/bin/migrate && /app/bin/server`, donc Ecto applique les migrations en attente à chaque démarrage avant que le point d'accès Phoenix ne se lie. La mise à niveau de `application_version` applique automatiquement les modifications de schéma — pas d'étape de migration séparée.
- **Le câblage de la base de données d'exécution est composé par le point d'entrée.** `DATABASE_URL` est construit à partir des variables `DB_*` injectées, le mot de passe est encodé en URL, et sur Cloud Run la connexion utilise l'IP privée (`DB_IP`) avec `DATABASE_ENABLE_SSL=true`. `PHX_HOST` est dérivé de l'URL de service injectée (schéma supprimé).
- **`SECRET_KEY_BASE` est stable et effectivement immuable.** Il est généré une fois et écrit dans Secret Manager. Le faire pivoter invalide chaque cookie de session actif — tous les utilisateurs sont déconnectés. Ne le faites pivoter que pendant une fenêtre de maintenance.
- **Chemin de santé.** Les sondes de démarrage et de disponibilité ciblent la racine Phoenix `/` — le premier point d'accès qui renvoie 200 une fois que le serveur a démarré et s'est connecté à Postgres. Prévoyez environ 1 à 2 minutes au premier démarrage pour les migrations (la sonde de démarrage fournit un délai initial de 60 secondes plus une fenêtre de nouvelle tentative).
- **Configuration de la première exécution.** Ouvrez l'URL du service et créez le premier compte Azimutt via la page d'inscription. L'inscription est ouverte par défaut — restreignez l'accès par la suite.
- **Inspecter l'exécution du job d'initialisation :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour Azimutt sont listés ; toutes les autres entrées sont héritées de [App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails autorisés à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `azimutt` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Azimutt` | Nom lisible par l'homme affiché dans l'interface utilisateur de la plateforme. |
| `application_version` | `latest` | Tag de l'image Azimutt ; `latest` correspond au tag `main`. Épinglez à une version en production. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `2000m` | CPU par instance. |
| `memory_limit` | `4Gi` | Mémoire par instance. |
| `min_instance_count` | `0` | `0` active la mise à l'échelle à zéro ; définissez `1` pour les jobs Oban en arrière-plan ou pour éviter les démarrages à froid. |
| `max_instance_count` | `5` | Nombre maximal d'instances. |
| `container_port` | `4000` | Phoenix écoute sur 4000 ; les sondes doivent correspondre. |
| `cpu_always_allocated` | `false` | Facturation basée sur les requêtes (CPU facturé uniquement pendant le service). Définissez `true` (avec `min ≥ 1`) uniquement pour les jobs Oban en arrière-plan. |
| `enable_cloudsql_volume` | `true` | Monte le socket Cloud SQL pour le job `db-init` ; l'application se connecte toujours via TCP. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Entrée publique ; définissez `internal` pour restreindre au VPC/LB. |
| `enable_iap` | `false` | Exiger la connexion Google devant Azimutt. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. `PHX_SERVER`, `FILE_STORAGE_ADAPTER`, `PORT`, `PHX_HOST` et `DATABASE_URL` sont définis automatiquement — ne les écrasez pas. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager. `SECRET_KEY_BASE` est injecté automatiquement. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Provisionne et monte un partage NFS Filestore à `nfs_mount_path` (`/opt/azimutt/storage`). Avec la valeur par défaut `FILE_STORAGE_ADAPTER = local`, Azimutt écrit toujours les téléchargements dans son propre répertoire de travail éphémère plutôt que sur ce montage. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse facultatifs (nécessite gen2). |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `db_name` | `azimutt` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `azimutt` | Utilisateur de la base de données de l'application. Mot de passe auto-généré dans Secret Manager. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/` 60s de délai | Sonde de démarrage ; prévoir du temps pour les migrations au premier démarrage. |
| `liveness_probe` | HTTP `/` | Sonde de vivacité. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 21 — Cache et file d'attente Redis {#group-21--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Désactivé par défaut — Azimutt utilise PostgreSQL (Oban) pour les jobs en arrière-plan, pas Redis. |
| `redis_host` | `""` | Point d'accès Redis (uniquement si une fonctionnalité en aval le requiert). |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

Comportement standard d'App_CloudRun — `enable_vpc_sc`, `vpc_sc_dry_run`,
`enable_audit_logging`. Voir [App_CloudRun](App_CloudRun.md).

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point d'accès / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et les combinaisons* au moment de la planification — un réplica en lecture sans son primaire, IAP sans identités autorisées, un runtime `gen1` avec des montages NFS/GCS, un `database_type` qui ne correspond pas à une extension activée, un `redis_port`/`backup_retention_days` hors de portée. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence si erroné |
|---|---|---|---|
| `SECRET_KEY_BASE` (auto-généré) | Ne jamais faire pivoter en dehors d'une fenêtre de maintenance | Critique | Le faire pivoter invalide chaque cookie de session actif — tous les utilisateurs sont déconnectés. |
| `db_name` / `db_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/le rôle et orpheline toutes les données Azimutt. |
| `container_port` | `4000` | Critique | Phoenix se lie au port 4000 ; un port non concordant fait que chaque sonde atteint un port mort et la révision ne devient jamais prête. |
| `enable_cloudsql_volume` | `true` | Élevé | Le montage du socket est ce qui permet à `db-init` de créer le rôle/la base de données sans SSL ; le désactiver interrompt le démarrage du premier déploiement. |
| `application_version` | Épingler une version | Élevé | `latest` correspond au tag `main` roulant ; un changement inattendu en amont peut casser un redéploiement. |
| `memory_limit` | `4Gi` | Élevé | Sous-dimensionner la VM Elixir BEAM risque des arrêts OOM lors du rendu de grands schémas. |
| `ingress_settings` / `enable_iap` | Restreindre après le premier compte | Élevé | L'inscription est ouverte par défaut ; laisser le service publiquement accessible permet à quiconque de créer un compte. |
| `FILE_STORAGE_ADAPTER` (auto `local`) | Laisser `local` sauf si vous utilisez S3 | Moyen | `local` écrit les téléchargements sur un disque éphémère — ils sont perdus lors du redéploiement/de la mise à l'échelle à zéro. Les données du projet dans Postgres sont sûres. |
| `min_instance_count` | `0` (ou `1` pour les jobs en arrière-plan) | Moyen | La mise à l'échelle à zéro ajoute une latence de démarrage à froid ; les jobs Oban en arrière-plan nécessitent `min ≥ 1` + `cpu_always_allocated = true`. |
| `enable_redis` | `false` | Faible | Azimutt utilise Postgres/Oban, pas Redis — l'activer n'a aucun effet sur Azimutt lui-même. |

---

Pour le comportement du socle référencé tout au long — identité de service, mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à Azimutt partagée avec la variante GKE est décrite dans **[Azimutt_Common](Azimutt_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Azimutt sur Cloud Run](../labs/Azimutt_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Azimutt sur GKE Autopilot](Azimutt_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [Azimutt Common — Configuration d'application partagée](Azimutt_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Metabase sur Google Cloud Run](Metabase_CloudRun.md), [CloudBeaver sur Google Cloud Run](CloudBeaver_CloudRun.md), [NocoDB sur Google Cloud Run](NocoDB_CloudRun.md) dans la solution **BI en libre-service**.
