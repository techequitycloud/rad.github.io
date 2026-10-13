---
title: "Mealie sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Mealie sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Mealie_GKE.md @ e69407af sha256:a8e87e2da94e -->

# Mealie sur GKE Autopilot {#mealie-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Mealie_GKE.png" alt="Mealie sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Mealie est un gestionnaire de recettes et un planificateur de repas auto-hébergé
open-source avec un backend FastAPI et un frontend Vue, offrant une
importation automatique de recettes par URL ainsi qu'un éditeur d'interface
utilisateur manuel. Ce module déploie Mealie sur **GKE Autopilot** au-dessus
de la fondation [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure partagée Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Mealie et sur la
manière de les explorer et de les opérer depuis la Google Cloud Console et la
ligne de commande. Pour les mécanismes communs à chaque application GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et le cycle de vie du
déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## Ce que coûte Mealie sur RAD, et comment cela se compare {#what-mealie-costs-on-rad-and-how-that-compares}

**Le module GKE Autopilot de Mealie sur RAD coûte environ 91 US$ par mois dans votre propre projet, sans abonnement par foyer.** RAD facture 40 crédits une fois par déploiement dans votre propre projet (36 crédits, 10 % de moins, dans un projet géré par RAD), plus le temps de build. La même application se déploie également sur Cloud Run pour environ 68 US$ par mois — voir le [guide Cloud Run](Mealie_CloudRun.md) pour l'option à moindre coût. Si vous n'en avez besoin qu'occasionnellement, un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour quelques crédits, de sorte que ce chiffre mensuel devient quelques dollars au lieu de cela — voir **Mettre en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 40 crédits (4,00 US$ au prix de la recharge) | 36 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût de fonctionnement Google Cloud | Facturé par Google à votre propre compte de facturation, environ **91 US$ par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **85 crédits par jour**, soit environ 2 550 par mois (environ 255,00 US$ au prix de la recharge, moins avec un abonnement) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est détenu en réserve |

10 crédits coûtent 1 US$ pour une recharge ponctuelle, et moins avec un abonnement mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût de fonctionnement par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Pod GKE Autopilot, 1 vCPU / 0,5 Gio | 34 US$ |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51 US$ |
| Cloud NAT et réseau | 5 US$ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 US$ |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 US$ si c'est votre seul cluster, sinon ~73 US$ |
| **Total** | **environ 91 US$** |

### Comment cela se compare {#how-it-compares}

- **Plan to Eat**, un gestionnaire de recettes et un planificateur de repas hébergé, coûte **5,95 US$ par mois** (49 US$ par an, soit environ 4,08 US$ par mois facturés annuellement) et couvre un foyer sur le web, iPhone et Android.
- Le module Mealie de RAD coûte environ 91 US$ par mois dans votre propre projet — plus qu'un seul abonnement Plan to Eat en termes monétaires pour un foyer. L'intérêt de RAD ici est de posséder vos données de recettes sans verrouillage d'abonnement et avec un accès API complet, et cela n'a plus de sens isolément si un foyer veut juste un planificateur de repas bon marché — cela convient mieux aux autres applications auto-hébergées déjà en cours d'exécution dans le même projet.
- Comparaison auto-gérée : à 1 vCPU / 0,5 Gio avec une base de données Postgres, un droplet Hetzner CPX22 ou DigitalOcean 2 vCPU/4 Go (~24 US$/mois) est à portée, mais vous gérez Postgres, les sauvegardes et les mises à niveau vous-même.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Mealie fonctionne dans **un projet géré par RAD pour vous**, vous avez une deuxième option qui va bien au-delà de la mise à l'échelle à zéro : **supprimer l'ensemble du projet, et le restaurer dans les 30 jours pour presque rien.** Cela convient bien mieux à Mealie dont vous n'avez besoin qu'occasionnellement — pour l'évaluer, un environnement de démonstration, une charge de travail saisonnière ou intermittente — que de le faire fonctionner en continu.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le projet. Google ne supprime pas le projet immédiatement : il le conserve, récupérable, pendant 30 jours. Comme la facturation est déjà déliée, rien n'est facturé pendant qu'il attend. Contrairement à la suppression d'un module, cela ne détruit pas la base de données, aucune VM ou la ressource de calcul une par une — l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte quelques crédits, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet peut le restaurer. RAD demande à Google de récupérer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter **Update** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Pour Mealie derrière Services_GCP (un cluster GKE, une base de données Postgres) et Project_GCP, cela représente environ **une poignée de crédits (moins de 1 US$)** au total, contre environ 45 crédits (4,50 US$) que coûte un redéploiement complet.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, pas 91 US$.** Déployez Mealie, utilisez-le pendant un certain temps, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Update, et supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez les frais de module qu'une seule fois, les builds, et le temps réel où il était actif.
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet dont RAD gère uniquement la facturation), et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime définitivement. La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés doit toujours dépasser le seuil du palier (100 crédits pour le palier sandbox que la plupart des utilisations d'évaluation conviennent). Google indique que la plupart des services fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.
- **Un véritable manque : les sauvegardes nocturnes ne survivent pas.** Les sauvegardes et autres fichiers générés sont écrits dans un bucket à l'intérieur du projet, et ce bucket n'est **pas** protégé par la suppression logicielle de Cloud Storage, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé Mealie et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive, ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau, plus les builds — environ 45 crédits (4,50 US$) au total. La suppression ne permet d'économiser de l'argent que si Mealie restait inutilisé assez longtemps pour compenser ce coût de redéploiement par rapport à son propre coût de fonctionnement — environ **2 jours ou plus**, à la fois dans votre propre projet (environ 3,04 US$ par jour) et dans un projet géré par RAD (85 crédits par jour).
- **La majeure partie du coût de fonctionnement est généralement partagée.** Pour Mealie, il s'agit de la base de données. Ils ne s'arrêtent que si rien d'autre dans le projet ne les utilise, donc la suppression de cette application pendant que quelque chose d'autre partage le projet n'économise que la partie de calcul propre à cette application.
- **Conservez d'abord vos données.** Les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec celui-ci, alors copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant obtient l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est interrompue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais RAD et estimation des crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les mécanismes de pause/restauration et ce qu'il dit sur les objets Cloud Storage sans suppression logicielle ; [Plan to Eat](https://www.plantoeat.com/pricing/). Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Mealie fonctionne comme une seule charge de travail web FastAPI/Vue. Le déploiement
relie un petit ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pod FastAPI, 1 vCPU / 512 Mio par défaut |
| Base de données | Cloud SQL pour PostgreSQL 15 | Mealie lit des variables d'environnement discrètes `POSTGRES_*`, pas un DSN construit |
| Stockage d'objets | Cloud Storage | Un bucket `data` est créé pour les images de recettes et monté automatiquement à `/app/data` |
| Cache et file d'attente | aucun | Mealie n'a pas de dépendance Redis ou de file d'attente |
| Secrets | Secret Manager | Mot de passe de la base de données uniquement — Mealie n'a pas de credential d'administrateur configurable par env |
| Ingress | Cloud Load Balancing | Équilibreur de charge externe, domaine personnalisé optionnel + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL est le moteur standardisé.** `Mealie_Common` corrige
  `database_type = "POSTGRES_15"` et définit `DB_ENGINE=postgres` explicitement.
- **Pas de build de conteneur personnalisé.** L'image officielle pré-construite
  (`ghcr.io/mealie-recipes/mealie`) est utilisée directement.
- **Compte administrateur par défaut, pas de première inscription — et il n'est PAS
  configurable.** Le credential initial de Mealie ne peut plus être défini via
  des variables d'environnement à partir de la v3.x (voir le
  [guide commun](Mealie_Common.md)). Chaque déploiement démarre le même
  compte bien connu : `changeme@example.com` / `MyPassword`. Connectez-vous immédiatement
  après le premier déploiement et complétez la réinitialisation forcée du mot de passe.
- **`workload_type = "Deployment"`, pas `StatefulSet`.** Mealie ne conserve aucun état local
  au-delà de ce qui est déjà dans Cloud SQL — pas de PVC, pas de montage NFS requis.
- **Les images de recettes sont persistées par défaut.** `Mealie_Common` déclare une
  entrée `gcs_volumes` montant le bucket GCS `data` à `/app/data`, de sorte que
  les images de recettes téléchargées survivent à un redémarrage de pod.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis.

### A. GKE Autopilot — la charge de travail Mealie {#a-gke-autopilot--the-mealie-workload}

- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  ```

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Les pods atteignent la base de données en privé via le sidecar **cloud-sql-proxy** sur
`127.0.0.1`.

- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

### C. Cloud Storage {#c-cloud-storage}

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
  kubectl get svc -n "$NAMESPACE" -o wide
  ```

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

- **CLI :**
  ```bash
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100 -f
  ```

---

## 3. Comportement de l'application Mealie {#3-mealie-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job d'initialisation exécute
  `create-db-and-user.sh`, créant de manière idempotente le rôle d'application et
  la base de données.
- **Migrations de schéma au démarrage.** Mealie applique ses propres migrations internes
  automatiquement à chaque démarrage de pod.
- **Credential administrateur par défaut fixe — non configurable.** Mealie crée
  `changeme@example.com` / `MyPassword` lors de la première initialisation de la base de données. Il s'agit
  d'un défaut en amont codé en dur (aucune variable d'environnement ne le remplace à partir de la v3.x), et non d'un
  secret généré — une réinitialisation de mot de passe est forcée lors de la première connexion, et les opérateurs
  doivent la compléter immédiatement après le déploiement.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/api/app/about`.
- **Inspecter l'exécution du job :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour Mealie sont listés ; toutes les autres entrées sont héritées de [App_GKE](App_GKE.md) avec son comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `mealie` | Nom de base des ressources. |
| `application_version` | `latest` | Mealie publie un véritable tag `latest`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `prebuilt` | Aucun build personnalisé nécessaire. |
| `container_port` | `9000` | Port natif par défaut de Mealie. |
| `min_instance_count` / `max_instance_count` | `0` / `1` | Bornes de mise à l'échelle HPA. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `storage_buckets` | un bucket `data` | Créé et monté automatiquement à `/app/data`. |
| `stateful_pvc_enabled` | `null` (auto, désactivé) | Non utilisé — Mealie est sans état au niveau du pod. |

### Groupe 12 (16) — Backend de base de données {#group-12-16--database-backend}

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
| `startup_probe_config` / `health_check_config` | HTTP `/api/app/about` | Les sondes ciblent le véritable point d'information de Mealie. |

---

## 5. Sorties {#5-outputs}

| Sortie | Description |
|---|---|
| `service_name` / `service_url` / `service_external_ip` | Identité et adresse du service Kubernetes. |
| `database_instance_name` / `database_name` / `database_user` / `database_host` / `database_port` | Détails de connexion Cloud SQL. |
| `storage_buckets` | Le bucket `data` pour les images de recettes. |
| `kubernetes_ready` | Indique si la charge de travail a atteint l'état Prêt. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `container_image_source` | `prebuilt` (par défaut) | Élevé | `"custom"` déclenche un Cloud Build inutile sans Dockerfile dans ce module. |
| Credential administrateur par défaut (`changeme@example.com` / `MyPassword`) | Connectez-vous et modifiez-le immédiatement après le premier déploiement | **Critique** | Il s'agit d'un défaut en amont fixe et publiquement documenté — et non d'un secret généré — dès que la base de données s'initialise, toute personne connaissant le credential par défaut de Mealie peut se connecter tant que vous n'avez pas effectué la réinitialisation forcée du mot de passe lors de la première connexion. |
| `gcs_volumes` pour les images de recettes | Laisser vide (utiliser le montage `/app/data` propre au module) | Moyen | `Mealie_Common` monte déjà le bucket `data` à `/app/data`. Fournir une liste `gcs_volumes` non vide remplace entièrement ce montage — si le remplacement ne couvre pas également `/app/data`, les images de recettes téléchargées retombent sur le système de fichiers éphémère du pod et ne survivent pas à un redémarrage. |
| Variables `db_*_env_var_name` | Laisser leurs valeurs par défaut spécifiques à Mealie | Critique | La modification/suppression de celles-ci rompt la connexion Postgres de Mealie — il lit `POSTGRES_*`, pas `DB_*`. |

---

Pour le comportement de la fondation référencé tout au long — Workload Identity,
ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC,
sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**. La configuration
d'application spécifique à Mealie partagée avec la variante Cloud Run est décrite dans
**[Mealie_Common](Mealie_Common.md)**.

## Guides associés {#related-guides}

- [Lab pratique : Mealie sur GKE Autopilot](../labs/Mealie_GKE.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [Mealie sur Google Cloud Run](Mealie_CloudRun.md) — la même application sur Cloud Run, pour quand vous avez besoin de l'autre cible de déploiement.
- [Mealie Common — Configuration d'application partagée](Mealie_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [Grocy sur GKE Autopilot](Grocy_GKE.md), [Homebox sur GKE Autopilot](Homebox_GKE.md), [Wallos sur GKE Autopilot](Wallos_GKE.md), [LubeLogger sur GKE Autopilot](LubeLogger_GKE.md) dans la solution **Gestion de la maison et de la vie**.
