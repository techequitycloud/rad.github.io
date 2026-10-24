---
title: "SparkyFitness sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de SparkyFitness sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/SparkyFitness_GKE.md @ 1665a43e sha256:ef2623654c13 -->

# SparkyFitness sur GKE Autopilot {#sparkyfitness-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/SparkyFitness_GKE.png" alt="SparkyFitness sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

SparkyFitness est un outil auto-hébergé, assisté par l'IA, de suivi de l'alimentation, de la forme physique, de l'hydratation et de la santé familiale, construit comme un backend Node.js/Express (`codewithcj/sparkyfitness_server`) avec un frontend React séparé servi par nginx (`codewithcj/sparkyfitness`). Ce module déploie SparkyFitness sur **GKE Autopilot** sur la base de la fondation [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par SparkyFitness et sur la manière de les explorer et de les opérer depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à chaque application GKE — modèle namespace/Service, mise à l'échelle, CI/CD, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## Ce que coûte SparkyFitness sur RAD, et comment cela se compare {#what-sparkyfitness-costs-on-rad-and-how-that-compares}

**L'exécution de SparkyFitness dans votre propre projet GCP coûte environ 142,62 $/mois en frais Google Cloud ; les frais de module de RAD sont de 300 crédits (ou 270 crédits dans un projet géré par RAD), couvrant la configuration et le support — pas la facture cloud continue, que Google vous facture directement dans votre propre projet ou que RAD facture à l'heure en crédits dans un projet géré par RAD.**
Si un coût d'exécution inférieur est plus important que la cible de déploiement, consultez le guide Cloud Run pour l'option la moins chère ; sinon, si vous déployez dans un projet géré par RAD, vous pouvez tout mettre en pause gratuitement lorsque vous ne l'utilisez pas — voir [Mettez-le en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module | 300 crédits, une fois | 270 crédits, une fois (10 % de moins) |
| Temps de build | facturé en crédits pendant l'exécution du build (quelques crédits, généralement) | idem |
| Coût d'exécution Google Cloud | ~142,62 $/mois, facturé à votre propre compte de facturation au prix catalogue de Google | ~113 crédits/jour, facturé à l'heure par RAD au prix catalogue plus marge |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Pod GKE Autopilot, 2x vCPU / 2 GiB | 72,16 $ |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ |
| Cloud NAT et réseau | 5,00 $ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 $ |
| **Total** | **142,62 $** |

### Comment cela se compare {#how-it-compares}

- L'exécuter vous-même sur un VPS nu reste l'option la moins chère en espèces — Hetzner CPX22 (2 vCPU/4 Go) coûte environ **24 $/mois**, un Droplet DigitalOcean 2 vCPU/4 Go est également à **24 $/mois**, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) est à environ **49 $/mois** — plus le temps de l'administrateur pour les sauvegardes, les correctifs de sécurité et les mises à niveau, que le Cloud SQL géré par RAD, Secret Manager et la surveillance couvrent pour vous — mais le prix de RAD n'est jamais destiné à battre un VPS, seulement à remplacer le temps d'administration qu'un VPS nécessite encore.
- SparkyFitness est utilisé par une poignée de personnes quelques fois par jour, ce n'est pas un service continuellement chargé, donc le coût d'exécution ci-dessous est ce qui génère réellement la facture — pas les frais de module.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

**C'est le titre pour un projet géré par RAD.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer purement et simplement le projet — la suppression logicielle récupérable de 30 jours de Google. Contrairement à la suppression d'un module, cela ne détruit pas Cloud SQL, aucune VM ou la ressource de calcul une par une : l'ensemble du projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de restaurer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter la mise à jour sur chaque déploiement pour confirmer que tout est revenu. Parce que rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits (moins de 1 $ US) au total pour une chaîne de déploiement typique de 2-3.

Ce dont cela a besoin : vous devez être propriétaire du projet (pas un projet que RAD gère uniquement pour la facturation), vous devez le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est admise comme la création d'un nouveau projet, donc votre solde de crédits achetés doit toujours dépasser le seuil du palier (100 crédits pour le palier sandbox que la plupart des utilisations d'étude/démo conviennent). Google affirme que la plupart des services sont entièrement fonctionnels à nouveau dans les 36 heures suivant une restauration.

**Un véritable manque :** les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé l'application et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive, ou un bucket en dehors du projet) avant de la supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet (ou une fois que vous avez dépassé la fenêtre de restauration de 30 jours ci-dessus), l'alternative est de supprimer SparkyFitness purement et simplement et de le redéployer plus tard. Un redéploiement coûte à nouveau les frais de module, plus les builds — environ 300 + 3-6 crédits de temps de build.

La suppression ne permet d'économiser de l'argent que si SparkyFitness reste inutilisé assez longtemps pour compenser ce coût de redéploiement par rapport à son propre coût d'exécution quotidien — par rapport au total du projet ci-dessus, cela représente environ 6 jours ou plus. La majeure partie du coût d'exécution ici est généralement la base de données et la VM NFS/cache ; elles ne s'arrêtent que si rien d'autre dans le projet ne les utilise, donc la suppression de cette application pendant que quelque chose d'autre partage le projet n'économise que la partie calcul de cette application.

**Gardez les données en premier :** les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui, donc copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour une classe. Chaque participant obtient l'application dans son propre projet Google Cloud pour une durée de 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil :** un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire remet le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; radmodules.dev/pricing pour les propres frais de RAD et les estimations de crédits quotidiens ; https://cloud.google.com/resource-manager/docs/delete-restore-projects pour les mécanismes de pause/restauration.

## 1. Vue d'ensemble {#1-overview}

Contrairement à la variante Cloud Run (qui doit exécuter les deux conteneurs dans un seul service multi-conteneurs en raison d'une contrainte de la plateforme Cloud Run — voir [SparkyFitness_CloudRun](SparkyFitness_CloudRun.md)), GKE n'a pas d'exigence HTTPS-only entre les Services intra-cluster, donc SparkyFitness se déploie en tant que **deux déploiements/services distincts**, correspondant exactement au modèle docker-compose du fournisseur :

- Le **backend** (`codewithcj/sparkyfitness_server`, port 3010) est l'**application principale** — le câblage standard Déploiement/Service/job d'initialisation de la Fondation.
- Le **frontend** (`codewithcj/sparkyfitness`, port 80) est une entrée **`additional_services`** : son propre Déploiement+Service, avec une **adresse IP de LoadBalancer externe statique réservée**, atteignant le backend à son nom DNS interne au cluster via HTTP simple.

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot (2 déploiements) | Backend (principal, 2 vCPU/2Gi par défaut) + frontend (`additional_services`, 0,5 vCPU/512Mi) |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — aucun autre moteur n'est pris en charge |
| Secrets | Secret Manager → Secret K8s | `SPARKY_FITNESS_API_ENCRYPTION_KEY`, `BETTER_AUTH_SECRET`, `SPARKY_FITNESS_APP_DB_PASSWORD` auto-générés ; mot de passe de la base de données |
| Ingress | IP de LoadBalancer externe réservée (frontend) | Déterministe à travers les redéploiements — connue au moment de la planification |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Aucun autre moteur n'est pris en charge.
- **Deux rôles de base de données, un géré par Terraform.** `db_user` (par défaut `sparky`) est le rôle d'administrateur/migration créé par le job `db-init` ; `app_db_user` (par défaut `sparky_app`) est un rôle à privilèges limités que le **backend crée et maintient lui-même** à chaque démarrage.
- **Pas de job de migration séparé.** Le backend exécute ses propres migrations de base de données à chaque démarrage de conteneur.
- **Le Service du backend est toujours exposé sur le port 80**, quelle que soit la valeur de `container_port` (3010) — c'est une convention générale d'App_GKE (le port du Service est fixe, targetPort mappe au port réel du conteneur). Le nginx du frontend est donc configuré pour proxifier vers `:80`, et non `:3010`.
- **Une IP statique est toujours réservée pour le LoadBalancer du frontend** afin que l'URL accessible par le navigateur (utilisée pour les vérifications CORS `SPARKY_FITNESS_FRONTEND_URL`) soit connue au moment de la planification et ne change jamais lors des redéploiements.
- **L'image du frontend est pré-construite ; le backend est une construction personnalisée légère.** Le backend hérite du `SparkyFitness_Common` de `image_source = "custom"` (un Dockerfile patchant ses constructeurs `pg.Pool` pour SSL Cloud SQL), donc une étape Cloud Build est exécutée pour lui ; `container_image_source` est délibérément laissé non défini ici afin que la configuration circule.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT`, `REGION` et `NAMESPACE` sont définis (le nom du namespace se trouve dans les [Sorties](#5-outputs) du déploiement).

### A. GKE Autopilot — les charges de travail SparkyFitness {#a-gke-autopilot--the-sparkyfitness-workloads}

Deux déploiements s'exécutent dans le même namespace : le backend (application principale) et le frontend (`additional_services`).

- **Console :** Kubernetes Engine → Charges de travail → filtrer par namespace.
- **CLI :**
  ```bash
  kubectl get deployments -n "$NAMESPACE"
  kubectl get pods -n "$NAMESPACE"
  kubectl get services -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deployment/<backend-deployment> --tail=100
  kubectl logs -n "$NAMESPACE" deployment/<frontend-deployment> --tail=100
  ```

Voir [App_GKE](App_GKE.md) pour la mise à l'échelle, les quotas de ressources et le comportement de déploiement.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

SparkyFitness stocke toutes les données de l'application dans une instance Cloud SQL pour PostgreSQL 15 gérée. Le backend (application principale) se connecte via le sidecar **Cloud SQL Auth Proxy** via `127.0.0.1` lorsque `enable_cloudsql_volume = true` (la valeur par défaut).

```bash
gcloud sql instances list --project "$PROJECT"
gcloud sql instances describe <instance-name> --project "$PROJECT"
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe se trouvent dans les [Sorties](#5-outputs). Voir [App_GKE](App_GKE.md) pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Secret Manager / Secrets Kubernetes {#c-secret-manager--kubernetes-secrets}

Trois secrets cryptographiques sont générés dans Secret Manager et matérialisés en tant que Secret Kubernetes pour le pod backend : `SPARKY_FITNESS_API_ENCRYPTION_KEY`, `BETTER_AUTH_SECRET`, `SPARKY_FITNESS_APP_DB_PASSWORD`.

```bash
gcloud secrets list --project "$PROJECT" --filter="name~sparkyfitness"
kubectl get secret -n "$NAMESPACE"
```

### D. Réseau et LoadBalancer du frontend {#d-networking--the-frontend-loadbalancer}

Le Service du frontend est un `LoadBalancer` épinglé à une IP externe statique réservée.

```bash
kubectl get service <frontend-service> -n "$NAMESPACE" -o wide
gcloud compute addresses list --project "$PROJECT" --filter="name~frontend-ip"
```

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

```bash
gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
  --project "$PROJECT" --limit 50
```

---

## 3. Comportement de l'application SparkyFitness {#3-sparkyfitness-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un seul job d'initialisation `db-init` crée uniquement le rôle **admin** (`db_user`) et la base de données (`db_name`).
- **Les migrations s'exécutent à chaque démarrage.** Le backend applique ses propres migrations de schéma au démarrage en utilisant les identifiants admin `db_user`.
- **`app_db_user` est auto-réparateur.** Le backend crée ou met à jour ce rôle à privilèges limités à chaque démarrage.
- **Création de compte au premier démarrage.** Inscrivez-vous via l'URL du frontend pour créer le premier compte utilisateur, puis définissez `admin_email` et redéployez pour accorder les privilèges d'administrateur.
- **Désactiver l'inscription après la première utilisation.** Définissez `disable_signup = true` une fois que le compte administrateur existe.
- **Chemin de santé.** `GET /api/health` sur le port 3010 (backend) — confirmé via la directive `HEALTHCHECK` du Dockerfile en amont.
- **IP de LB frontend réservée.** `public_uri` remplace l'URL `http://<reserved-ip>` auto-dérivée par un domaine personnalisé — définissez cette variable et l'enregistrement DNS du domaine, puis redéployez.
- **Inspecter l'exécution du job :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/db-init
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour SparkyFitness sont listés ; toute autre entrée est héritée de [App_GKE](App_GKE.md) avec son comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `sparkyfitness` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag les DEUX images de manière identique. Utilisez `latest` ou un tag préfixé par `v` exactement tel que publié en amont (par exemple `v0.17.3`). |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` / `memory_limit` | `2000m` / `2Gi` | Limites de ressources pour le **backend** (application principale). |
| `min_instance_count` / `max_instance_count` | `1` / `3` | Bornes de mise à l'échelle des réplicas. |
| `container_port` | `3010` | Port d'écoute du backend. |

### Groupe 5 — Configuration de l'application SparkyFitness {#group-5--sparkyfitness-application-config}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `public_uri` | `""` | Remplacement du domaine personnalisé pour l'URL du frontend. Laissez vide pour utiliser automatiquement l'IP statique réservée du LB. |
| `app_db_user` | `sparky_app` | Rôle d'exécution à privilèges limités, auto-créé par le backend. |
| `disable_signup` | `false` | Désactiver la nouvelle auto-inscription. |
| `admin_email` | `""` | Accorde l'administration à un utilisateur EXISTANT au démarrage. |
| `log_level` / `timezone` | `ERROR` / `Etc/UTC` | Verbosity des logs du backend / TZ. |

### Groupe 7 — SMTP (optionnel) {#group-7--smtp-optional}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `smtp_enabled` | `false` | Activer l'e-mail de réinitialisation de mot de passe/notification ; définir tous les champs `smtp_*` ensemble. |

### Groupe 11 — Jobs et Services {#group-11--jobs--services}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré. |
| `additional_services` | `[]` | Le frontend est déjà inclus automatiquement ; utilisez ceci pour tout service SUPPLÉMENTAIRE. |

### Groupe 14 — Observabilité et Santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `/api/health`, port 3010 | Cible le backend (application principale). |

### Groupe 16 — Base de données {#group-16--database}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `db_name` | `sparkyfitness_db` | Nom de la base de données. Immuable après le premier déploiement. |
| `db_user` | `sparky` | Rôle d'administrateur/migration. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy — se résout en `127.0.0.1` loopback (pas de TLS nécessaire). |

### Groupe 21 — Redis (non utilisé nativement) {#group-21--redis-not-used-natively}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | SparkyFitness n'utilise pas nativement Redis ; le câblage générique Redis de la Fondation est délibérément laissé activé comme une capacité pour les futures versions du backend. Définissez-le sur `false` pour éviter de provisionner un cache que rien ne lit. |

---

## 5. Sorties {#5-outputs}

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes du backend. |
| `namespace` | Namespace Kubernetes. |
| `frontend_url` | URL du frontend accessible par le navigateur — ouvrez-la pour accéder à l'application. |
| `backend_cluster_url` | URL interne au cluster de l'API backend. |
| `database_instance_name` / `database_name` / `database_user` | Identifiants Cloud SQL. |
| `database_password_secret` | Secret Manager contenant le mot de passe de la base de données admin. |
| `storage_buckets` | Buckets Cloud Storage créés (aucun par défaut). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `BETTER_AUTH_SECRET` (auto-généré) | Ne jamais faire pivoter après que les utilisateurs aient activé la 2FA | Critique | Le faire pivoter bloque tous les utilisateurs ayant la 2FA activée. |
| `SPARKY_FITNESS_API_ENCRYPTION_KEY` (auto-généré) | Ne jamais faire pivoter après la première connexion | Critique | Le faire pivoter invalide toutes les informations d'identification des sources de données externes stockées. |
| `db_name` / `db_user` | Définir une fois | Critique | Immuable après le premier déploiement ; la modification recrée la base de données et détruit toutes les données. |
| Port cible du proxy frontend | `80` (fixé par App_GKE), pas `container_port` | Élevé | Pointer le `SPARKY_FITNESS_SERVER_PORT` du frontend vers `3010` atteint un écouteur de Service inexistant — chaque appel `/api` reste bloqué. |
| `application_version` | Utiliser le tag exact de l'amont (`v0.17.3`) | Élevé | Un `0.17.3` nu (sans préfixe `v`) n'existe pas en amont — l'extraction échoue. |
| `admin_email` | Définir uniquement après la création du compte | Moyen | Le définir avant l'inscription n'a aucun effet. |
| `disable_signup` | `true` après le premier administrateur | Moyen | Laisser l'inscription ouverte permet à quiconque ayant l'URL de créer un compte. |
| `public_uri` | Définir avec un DNS réel lors de l'utilisation d'un domaine personnalisé | Moyen | Un `public_uri` inaccessible/incohérent rompt les vérifications CORS/d'origine de session. |

---

Pour le comportement de la fondation référencé tout au long — modèle de namespace, mise à l'échelle, ingress, CI/CD, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**. La configuration d'application spécifique à SparkyFitness partagée avec la variante Cloud Run est décrite dans **[SparkyFitness_Common](SparkyFitness_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : SparkyFitness sur GKE Autopilot](../labs/SparkyFitness_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [SparkyFitness sur Google Cloud Run](SparkyFitness_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [SparkyFitness Common — Configuration d'application partagée](SparkyFitness_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [Grocy sur GKE Autopilot](Grocy_GKE.md), [Mealie sur GKE Autopilot](Mealie_GKE.md), [Homebox sur GKE Autopilot](Homebox_GKE.md), [Wallos sur GKE Autopilot](Wallos_GKE.md) dans la solution **Gestion de la maison et de la vie**.
