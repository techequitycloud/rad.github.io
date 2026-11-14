---
title: "Mealie sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Mealie sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Mealie_CloudRun.md @ 40c83c3f sha256:2ec2d8505293 -->

# Mealie sur Google Cloud Run {#mealie-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Mealie_CloudRun.png" alt="Mealie sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Mealie est un gestionnaire de recettes et un planificateur de repas auto-hébergé et open source, avec un backend FastAPI et un frontend Vue, offrant une importation automatique de recettes par URL ainsi qu'un éditeur d'interface utilisateur manuel. Ce module déploie Mealie sur **Cloud Run v2** au-dessus du socle [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud que Mealie utilise et sur la façon de les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à chaque application Cloud Run — identité de service, ingress et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au [guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## Ce que coûte Mealie sur RAD, et comment cela se compare {#what-mealie-costs-on-rad-and-how-that-compares}

**Le module Cloud Run de Mealie sur RAD coûte environ 68 $ US par mois dans votre propre projet, sans abonnement par foyer.** RAD facture 40 crédits une fois par déploiement dans votre propre projet (36 crédits, 10 % de moins, dans un projet géré par RAD). Les builds sont inclus dans le prix. Mealie se déploie également sur GKE Autopilot pour environ 91 $ US par mois — consultez le [guide GKE](Mealie_GKE.md) si vous avez besoin qu'il y soit exécuté à la place. Si vous n'en avez besoin qu'occasionnellement, un projet géré par RAD peut être supprimé et restauré dans les 30 jours sans frais supplémentaires, de sorte que ce chiffre mensuel devient quelques dollars à la place — voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet que RAD gère pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 40 crédits (4,00 $ US au prix de la recharge) | 36 crédits (10 % de moins) |
| Builds | Inclus dans le prix : pas de frais de build pour la création, 5 mises à jour par mois (mois calendaire UTC) gratuites puis 2 crédits chacune, et rien pour la suppression ou pour un build échoué. Les sessions de lab et les projets clients sont l'exception : ils sont toujours facturés pour le temps de build à la minute | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **68 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **61 crédits par jour**, environ 1 830 par mois (environ 183 $ US au prix de la recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

Votre premier déploiement réussi sur RAD est exempt de frais de module, quel que soit le montant des frais : une fois par compte, pour un module que vous déployez et payez vous-même (dans une solution, les frais d'une application : la première à réussir ; jamais une session de lab ou un projet client).

10 crédits coûtent 1 $ US lors d'une recharge ponctuelle, et moins sur un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (valeur par défaut du module) | Par mois |
|---|---|
| Cloud Run, 1x vCPU / 0,5 Gio (scaleToZero) | 11 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| **Total** | **environ 68 $ US** |

### Comment cela se compare {#how-it-compares}

- **Plan to Eat**, un gestionnaire de recettes et un planificateur de repas hébergé, coûte **5,95 $ US par mois** (49 $ US par an, environ 4,08 $ US par mois facturé annuellement) et couvre un foyer sur le web, iPhone et Android.
- Le module Mealie de RAD coûte environ 68 $ US par mois dans votre propre projet — plus qu'un seul abonnement Plan to Eat en termes d'argent pour un foyer. L'intérêt de RAD ici est de posséder vos données de recettes sans verrouillage d'abonnement et avec un accès API complet, et cela n'a plus de sens isolément une fois qu'un foyer veut juste un planificateur de repas bon marché — il s'intègre mieux aux autres applications auto-hébergées déjà en cours d'exécution dans le même projet.
- Comparaison auto-gérée : avec 1 vCPU / 0,5 Gio et une base de données Postgres, un droplet Hetzner CPX22 ou DigitalOcean 2 vCPU/4 Go (~24 $ US/mois) est à portée, mais vous gérez Postgres, les sauvegardes et les mises à niveau vous-même.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Mealie s'exécute dans **un projet que RAD gère pour vous**, vous avez une deuxième option qui va bien au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour presque rien.** Cela convient bien mieux à Mealie dont vous n'avez besoin qu'occasionnellement — évaluation, environnement de démonstration, charge de travail saisonnière ou intermittente — que de le faire fonctionner en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ou les ressources qu'il contient, seront utilisables après sa restauration, de sorte que la restauration ne peut pas être considérée comme un moyen de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application et de les avoir stockées en dehors du projet. Si une restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le projet. Google ne supprime pas le projet immédiatement : il le conserve, récupérable, pendant 30 jours. Comme la facturation est déjà déliée, rien n'est facturé pendant qu'il attend. Contrairement à la suppression d'un module, cela ne détruit pas la base de données, aucune VM ou la ressource de calcul une par une — l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration est une vérification, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet peut le restaurer. RAD demande à Google de récupérer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter **Update** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Les mises à jour sont incluses dans le prix (5 par mois pour chaque déploiement), donc une restauration ne coûte normalement aucun crédit.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, et non les 183 $ US par mois pour le maintenir en fonctionnement.** Déployez Mealie, utilisez-le un certain temps, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Update, et supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez les frais de module qu'une seule fois et pour le temps où il était réellement actif.
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet dont RAD gère uniquement la facturation), et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime définitivement. La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés doit toujours dépasser le seuil du palier (100 crédits pour le palier sandbox que la plupart des utilisations d'évaluation conviennent). Google indique que la plupart des services sont de nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.
- **Un véritable manque : les sauvegardes nocturnes ne survivent pas.** Les sauvegardes et autres fichiers générés sont écrits dans un bucket à l'intérieur du projet, et ce bucket **n'est pas** protégé par la suppression logicielle de Cloud Storage, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé Mealie et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau (les builds sont inclus) — 40 crédits (4,00 $ US) au total. La suppression ne permet d'économiser de l'argent que si Mealie reste inutilisé assez longtemps pour compenser ce coût de redéploiement par rapport à son propre coût d'exécution — environ **2 jours ou plus**, à la fois dans votre propre projet (environ 2,26 $ US par jour) et dans un projet géré par RAD (61 crédits par jour).
- **La majeure partie du coût d'exécution est généralement partagée.** Pour Mealie, il s'agit de la base de données. Ils ne s'arrêtent que si rien d'autre dans le projet ne les utilise, donc la suppression de cette application pendant que quelque chose d'autre partage le projet n'économise que la partie calcul de cette application.
- **Conservez vos données en premier.** Les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui, alors copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant obtient l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est interrompue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais RAD et estimation des crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les mécanismes de pause/restauration et ce qu'il dit sur les objets Cloud Storage sans suppression logicielle ; [Plan to Eat](https://www.plantoeat.com/pricing/). Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Mealie s'exécute comme un conteneur FastAPI/Vue unique sur Cloud Run v2. Le déploiement connecte un ensemble restreint et ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service FastAPI, 1 vCPU / 512 Mio par défaut, mise à l'échelle à zéro |
| Base de données | Cloud SQL pour PostgreSQL 15 | Mealie lit des variables d'environnement discrètes `POSTGRES_*`, pas un DSN construit |
| Stockage d'objets | Cloud Storage | Un bucket `data` est créé pour les images de recettes et monté automatiquement à `/app/data` |
| Cache et file d'attente | aucun | Mealie n'a pas de dépendance Redis ou de file d'attente |
| Secrets | Secret Manager | Mot de passe de la base de données uniquement — Mealie n'a pas d'identifiant administrateur configurable par l'environnement |
| Ingress | URL Cloud Run | URL `run.app` par défaut ; équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est le moteur standardisé.** `Mealie_Common` corrige `database_type = "POSTGRES_15"` et définit `DB_ENGINE=postgres` explicitement — Mealie utilise SQLite intégré par défaut.
- **Pas de build de conteneur personnalisé.** Les variables d'environnement Postgres discrètes de Mealie n'ont pas besoin de construction DSN, donc l'image officielle pré-construite (`ghcr.io/mealie-recipes/mealie`) est utilisée directement.
- **Compte administrateur par défaut, pas de première inscription — et il n'est PAS configurable.** Contrairement à certaines applications de ce catalogue, Mealie ne permet pas au premier visiteur de s'inscrire en tant qu'administrateur, et contrairement aux versions antérieures de Mealie, son identifiant initial ne peut plus être défini via des variables d'environnement (les paramètres sous-jacents sont des champs privés, non liés à l'environnement à partir de la v3.x — voir le [guide commun](Mealie_Common.md) pour les détails au niveau du code source). Chaque déploiement démarre le **même compte bien connu** : `changeme@example.com` / `MyPassword`. Connectez-vous immédiatement après le premier déploiement et modifiez à la fois le mot de passe et, idéalement, l'e-mail de l'administrateur — Mealie force une réinitialisation du mot de passe lors de la première connexion, ce qui est la véritable limite de sécurité ici, pas le secret de l'identifiant initial.
- **Les images de recettes sont persistantes par défaut.** `Mealie_Common` déclare une entrée `gcs_volumes` montant le bucket GCS `data` au chemin `/app/data` de Mealie, de sorte que les images de recettes téléchargées survivent à un redémarrage de révision. Les données de *texte* de recette ne sont pas affectées dans tous les cas (stockées dans PostgreSQL).
- **Facturation basée sur les requêtes par défaut.** `cpu_always_allocated = false`, `min_instance_count = 0` — le scraping d'importation d'URL de Mealie s'exécute de manière synchrone dans la requête déclenchante, et non comme un job en arrière-plan.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de services et de ressources sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Mealie {#a-cloud-run--the-mealie-service}

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les logs et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Mealie stocke toutes les recettes, les plans de repas et les données utilisateur dans une instance Cloud SQL pour PostgreSQL 15 gérée, connectée en privé via le **Cloud SQL Auth Proxy** sur un socket Unix. Lors du premier déploiement, un job d'initialisation crée la base de données et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

### C. Cloud Storage {#c-cloud-storage}

Un bucket `data` est provisionné automatiquement pour les images de recettes, et est monté dans le conteneur à `/app/data` par défaut.

- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~mealie"
  ```

### D. Secret Manager {#d-secret-manager}

- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~mealie"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

### E. Réseau et ingress {#e-networking--ingress}

- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  ```

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Mealie {#3-mealie-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job d'initialisation exécute `create-db-and-user.sh` en utilisant `postgres:15-alpine`, créant de manière idempotente le rôle et la base de données de l'application.
- **Migrations de schéma au démarrage.** Mealie applique ses propres migrations internes automatiquement à chaque démarrage.
- **Identifiant administrateur par défaut fixe — non configurable.** Mealie crée `changeme@example.com` / `MyPassword` lors de la première initialisation de la base de données. Il s'agit d'une valeur par défaut codée en dur en amont (aucune variable d'environnement ne la remplace à partir de la v3.x), et non d'un secret généré — une réinitialisation de mot de passe est forcée lors de la première connexion, et les opérateurs doivent la compléter immédiatement après le déploiement.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/api/app/about` — le véritable point de terminaison d'information non authentifié de Mealie.
- **Inspecter l'exécution du job :**
  ```bash
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour Mealie sont listés ; toutes les autres entrées sont héritées de [App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `mealie` | Nom de base des ressources. |
| `application_version` | `latest` | Mealie publie une véritable balise `latest` — aucun remappage n'est nécessaire. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `prebuilt` | Aucune build personnalisée n'est nécessaire — les variables d'environnement Postgres discrètes ne nécessitent pas de construction DSN. |
| `container_port` | `9000` | Port natif par défaut de Mealie. |
| `cpu_always_allocated` | `false` | Facturation basée sur les requêtes. |
| `min_instance_count` / `max_instance_count` | `0` / `1` | Valeur par défaut de mise à l'échelle à zéro. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `storage_buckets` | un bucket `data` | Créé et monté automatiquement à `/app/data` pour les images de recettes. |
| `gcs_volumes` | `[]` | Vide signifie "utiliser le propre montage `/app/data` de `Mealie_Common`" ; une liste non vide le remplace. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixé par `Mealie_Common`. |
| `db_host_env_var_name` | `POSTGRES_SERVER` | Aliasse la plateforme `DB_HOST` sur le nom attendu de Mealie. |
| `db_user_env_var_name` | `POSTGRES_USER` | Aliasse `DB_USER`. |
| `db_password_env_var_name` | `POSTGRES_PASSWORD` | Aliasse `DB_PASSWORD`. |
| `db_name_env_var_name` | `POSTGRES_DB` | Aliasse `DB_NAME`. |
| `db_port_env_var_name` | `POSTGRES_PORT` | Aliasse `DB_PORT`. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `/api/app/about` délai de 30s | Les sondes ciblent le véritable point de terminaison d'information de Mealie. |

---

## 5. Sorties {#5-outputs}

| Sortie | Description |
|---|---|
| `service_name` / `service_url` | Nom du service Cloud Run et URL `run.app` par défaut. |
| `database_instance_name` / `database_name` / `database_user` / `database_host` / `database_port` | Détails de connexion Cloud SQL. |
| `storage_buckets` | Le bucket `data` pour les images de recettes. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `container_image_source` | `prebuilt` (par défaut) | Élevé | `"custom"` déclenche un Cloud Build inutile sans Dockerfile dans ce module — le build échoue. |
| Identifiant administrateur par défaut (`changeme@example.com` / `MyPassword`) | Connectez-vous et modifiez-le immédiatement après le premier déploiement | **Critique** | Il s'agit d'une valeur par défaut fixe, documentée publiquement en amont — pas un secret généré — dès que la base de données s'initialise, toute personne connaissant l'identifiant par défaut de Mealie peut se connecter jusqu'à ce que vous complétiez la réinitialisation forcée du mot de passe lors de la première connexion. |
| `gcs_volumes` pour les images de recettes | Laisser vide (utiliser le propre montage `/app/data` du module) | Moyen | `Mealie_Common` monte déjà le bucket `data` à `/app/data`. Fournir une liste `gcs_volumes` non vide remplace entièrement ce montage — si le remplacement ne couvre pas également `/app/data`, les images de recettes téléchargées retombent sur le système de fichiers éphémère de Cloud Run et ne survivent pas à un redémarrage de révision. Le texte de la recette n'est pas affecté. |
| Variables `db_*_env_var_name` | Laisser leurs valeurs par défaut spécifiques à Mealie | Critique | Modifier/effacer ces variables rompt entièrement la connexion Postgres de Mealie — il lit `POSTGRES_*`, pas `DB_*`. |

---

Pour le comportement du socle référencé tout au long — identité de service, mise à l'échelle et concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à Mealie partagée avec la variante GKE est décrite dans **[Mealie_Common](Mealie_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Mealie sur Cloud Run](../labs/Mealie_CloudRun.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [Mealie sur GKE Autopilot](Mealie_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Mealie Common — Configuration d'application partagée](Mealie_Common.md) — la configuration partagée par les deux cibles de déploiement.
