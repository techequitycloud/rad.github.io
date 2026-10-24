---
title: "Homebox sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Homebox sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Homebox_GKE.md @ e69407af sha256:fe1d5d59e8df -->

# Homebox sur GKE Autopilot {#homebox-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Homebox_GKE.png" alt="Homebox sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Homebox est un système open source d'inventaire et d'organisation domestique
auto-hébergé avec un backend API REST Go (style Echo, Ent ORM) et un frontend
Vue 3/Nuxt intégré au même binaire — suivez les articles, joignez des photos et
organisez-les par emplacement. Ce module déploie Homebox sur **GKE Autopilot**
sur la base de la fondation [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure partagée Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Homebox et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à chaque application GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et le cycle de vie du
déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## Ce que coûte Homebox sur RAD, et comment cela se compare {#what-homebox-costs-on-rad-and-how-that-compares}

**L'exécution d'un pod Homebox sur GKE Autopilot dans votre propre projet Google Cloud coûte environ 91,31 $/mois en frais Google Cloud**, en plus d'un frais de module RAD unique de 40 crédits facturé une seule fois au moment du déploiement. Homebox est une petite application d'inventaire domestique avec une base de données Postgres modeste derrière elle — il n'y a pas de SaaS hébergé commercial pour ce projet open source exact à nommer. Dans un projet géré par RAD, les frais de module tombent à 36 crédits (10 % de moins) et le coût d'exécution est mesuré à l'heure en crédits au lieu d'être facturé directement par Google — voir [Mettez-le en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) ci-dessous pour le seul avantage géré par RAD qu'un VPS auto-hébergé ne peut pas égaler — ou voir le [guide Cloud Run](Homebox_CloudRun.md) pour l'option à moindre coût.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module (unique) | 40 crédits | 36 crédits (10 % de moins) |
| Temps de build | ~3-6 crédits par build, dans les deux cas | ~3-6 crédits par build, dans les deux cas |
| Coût d'exécution Google Cloud | 91,31 $/mois, facturé par Google au prix catalogue | ~85 crédits/jour, mesuré au prix catalogue plus la marge de RAD |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Pod GKE Autopilot, 1 vCPU / 0,5 Gio | 34,29 $ |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ |
| Cloud NAT et réseau | 5,00 $ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 $ |
| **Total** | **91,31 $** |

*Les frais de gestion de cluster GKE sont exclus du total ci-dessus car ils sont partagés entre toutes les applications GKE du projet — 0 $ si c'est la seule, sinon environ 73 $/mois répartis entre le nombre d'applications que vous exécutez.*

### Comment cela se compare {#how-it-compares}

- Une comparaison auto-gérée : Hetzner CPX22 (2 vCPU/4 Go) coûte environ 24 $/mois, un Droplet DigitalOcean 2 vCPU/4 Go est le même 24 $/mois, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) est environ 49 $/mois — plus que ce dont cette application 1 vCPU/0,5 Gio a besoin seule, mais le plus petit point de référence largement cité ; une classe de vCPU partagée moins chère l'exécuterait également confortablement.
- La majeure partie du coût d'exécution ci-dessus est l'instance Postgres dédiée, qu'une boîte auto-gérée devrait également exécuter (et sauvegarder) elle-même.
- Le compromis habituel s'applique : moins cher en termes d'argent sur un VPS, sauvegardes et correctifs gérés sur RAD.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

C'est l'avantage principal d'un projet géré par RAD, et il ne coûte rien pendant la pause.
La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer
le projet purement et simplement — la suppression logicielle récupérable de 30 jours de Google. Contrairement à la suppression d'un module,
cela ne **détruit pas** Cloud SQL, aucune VM, ou la ressource de calcul une par une : l'ensemble
du projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà
déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de récupérer le
projet et de rattacher son compte de facturation, puis vous demande d'exécuter la mise à jour sur chaque déploiement pour
confirmer que tout est revenu. Parce que rien n'a été détruit individuellement, cette mise à jour trouve
les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture
jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits (moins de 1 $ US) au total pour une
chaîne de déploiement typique de 2-3.

Ce dont cela a besoin : vous devez être propriétaire du projet (pas un projet que RAD gère uniquement pour la facturation), vous devez
le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est
admise comme la création d'un nouveau projet, donc votre solde de crédits achetés doit toujours dépasser
le seuil du palier (100 crédits pour le palier sandbox que la plupart des utilisations d'étude/démo conviennent). Google dit que la plupart
des services fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a
la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous
supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez
personnalisé Homebox et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive, ou un bucket
en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable,
cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre façon : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que 30 jours se sont écoulés sur un projet géré par RAD, il n'y a pas de pause gratuite —
la suppression supprime les ressources définitivement, et le retour de Homebox signifie un redéploiement
à partir de zéro. Cela coûte environ 43-46 crédits (les frais de module de 40 crédits plus un build).

La suppression ne permet d'économiser de l'argent que si Homebox reste inutilisé suffisamment longtemps pour compenser ce
coût de redéploiement par rapport à son propre coût d'exécution — pour Homebox, cela représente environ 2 jours ou
plus. La majeure partie de ce coût d'exécution est généralement la base de données (et, lorsque ce module en utilise une, la VM de serveur de fichiers partagé ou le cluster GKE) — ceux-ci ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc la suppression de cette application pendant que quelque chose d'autre partage le projet n'économise que sa propre part de calcul.

Gardez les données en premier : les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui,
alors copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

Sessions de lab, pour la formation : un formateur anime une session pour une classe. Chaque participant obtient l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits non utilisés sont reversés au formateur.

Environnements gérés, pour les sociétés de conseil : un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les propres frais de RAD et les estimations de crédits quotidiens ; [documentation de Google sur la suppression/restauration de projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les affirmations de pause/restauration.

## 1. Vue d'ensemble {#1-overview}

Homebox s'exécute comme un seul binaire Go (API + frontend intégré) — un pod,
pas de sidecars au-delà du proxy d'authentification Cloud SQL. Le déploiement relie un
ensemble restreint et ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pod Go/Echo, 1 vCPU / 512 Mio par défaut |
| Base de données | Cloud SQL pour PostgreSQL 15 | Homebox lit des variables d'environnement discrètes `HBOX_DATABASE_*`, pas un DSN construit |
| Stockage d'objets | Cloud Storage | Un bucket `data` est créé pour les photos/pièces jointes des articles et monté automatiquement à `/data` |
| Cache et file d'attente | aucun | Homebox n'a pas de dépendance Redis ou de file d'attente |
| Secrets | Secret Manager | Mot de passe de la base de données plus `HBOX_AUTH_API_KEY_PEPPER` (un vrai secret consommé par l'application) |
| Ingress | Cloud Load Balancing | Équilibreur de charge externe, domaine personnalisé facultatif + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL est le moteur standardisé.** `Homebox_Common` corrige
  `database_type = "POSTGRES_15"` et définit `HBOX_DATABASE_DRIVER=postgres`
  explicitement.
- **Pas de build de conteneur personnalisé.** L'image officielle pré-construite
  (`ghcr.io/sysadminsmedia/homebox`) est utilisée directement.
- **Auto-enregistrement ouvert, pas de compte administrateur par défaut.** Homebox ne
  livre pas de credential codé en dur : la première personne à soumettre le formulaire
  "Register" sur une nouvelle instance devient l'utilisateur administrateur initial. Voir le
  [guide commun](Homebox_Common.md) pour plus de détails. Les opérateurs doivent définir
  `HBOX_OPTIONS_ALLOW_REGISTRATION=false` après avoir terminé l'enregistrement.
- **`workload_type = "Deployment"`, pas `StatefulSet`.** Homebox ne conserve aucun
  état local au-delà de ce qui est déjà dans Cloud SQL — pas de PVC, pas de montage NFS
  requis.
- **Les photos d'articles sont persistantes par défaut.** `Homebox_Common` déclare une
  entrée `gcs_volumes` montant le bucket GCS `data` à `/data`, de sorte que les photos
  d'articles et les pièces jointes téléchargées survivent à un redémarrage de pod. Si vous activez le
  PVC de bloc à la place (`stateful_pvc_enabled = true`, monté à `/data`), le montage GCS FUSE
  est automatiquement supprimé afin que les deux n'entrent jamais en collision.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis.

### A. GKE Autopilot — la charge de travail Homebox {#a-gke-autopilot--the-homebox-workload}

- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  ```

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Les pods accèdent à la base de données en privé via le sidecar **cloud-sql-proxy** sur
`127.0.0.1`.

- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

### C. Cloud Storage {#c-cloud-storage}

- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~homebox"
  ```

### D. Secret Manager {#d-secret-manager}

- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~homebox"
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

## 3. Comportement de l'application Homebox {#3-homebox-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job d'initialisation exécute
  `create-db-and-user.sh`, créant de manière idempotente le rôle d'application et
  la base de données.
- **Migrations de schéma au démarrage.** L'ORM Ent de Homebox applique ses propres migrations internes
  automatiquement à chaque démarrage de pod.
- **Auto-enregistrement ouvert — pas de credential administrateur par défaut.** Le premier
  visiteur à remplir le formulaire "Register" devient l'administrateur. Il n'y a pas de
  credential à récupérer, réinitialiser ou faire pivoter — définissez
  `HBOX_OPTIONS_ALLOW_REGISTRATION=false` une fois que le compte administrateur existe pour
  fermer les inscriptions publiques.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/api/v1/status` —
  le véritable point de terminaison de statut non authentifié de Homebox.
- **Inspecter l'exécution du job :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls
les paramètres spécifiques ou notables pour Homebox sont listés ; toute autre entrée est
héritée de [App_GKE](App_GKE.md) avec son comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `homebox` | Nom de base pour les ressources. |
| `application_version` | `latest` | Homebox publie un véritable tag `latest`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `prebuilt` | Aucun build personnalisé nécessaire. |
| `container_port` | `7745` | Port par défaut natif de Homebox. |
| `min_instance_count` / `max_instance_count` | `0` / `1` | Limites de mise à l'échelle HPA. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `storage_buckets` | un bucket `data` | Créé et monté automatiquement à `/data`. |
| `stateful_pvc_enabled` | `null` (auto, désactivé) | Facultatif. La définition de `true` monte un PVC de bloc à `/data` et supprime le montage GCS FUSE à cet endroit ; le montage de bucket par défaut persiste déjà les photos. |

### Groupe 12 (16) — Backend de base de données {#group-12-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixé par `Homebox_Common`. |
| `db_host_env_var_name` | `HBOX_DATABASE_HOST` | Alias le `DB_HOST` de la plateforme sur le nom attendu de Homebox. |
| `db_user_env_var_name` | `HBOX_DATABASE_USERNAME` | Alias `DB_USER`. |
| `db_password_env_var_name` | `HBOX_DATABASE_PASSWORD` | Alias `DB_PASSWORD`. |
| `db_name_env_var_name` | `HBOX_DATABASE_DATABASE` | Alias `DB_NAME`. |
| `db_port_env_var_name` | `HBOX_DATABASE_PORT` | Alias `DB_PORT`. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` / `health_check_config` | HTTP `/api/v1/status` | Les sondes ciblent le véritable point de terminaison de statut de Homebox. |

---

## 5. Sorties {#5-outputs}

| Sortie | Description |
|---|---|
| `service_name` / `service_url` / `service_external_ip` | Identité et adresse du service Kubernetes. |
| `database_instance_name` / `database_name` / `database_user` / `database_host` / `database_port` | Détails de connexion Cloud SQL. |
| `storage_buckets` | Le bucket `data` pour les photos et pièces jointes des articles. |
| `kubernetes_ready` | Indique si la charge de travail a atteint l'état Prêt. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `container_image_source` | `prebuilt` (par défaut) | Élevé | `"custom"` déclenche un Cloud Build inutile sans Dockerfile dans ce module. |
| Première inscription | Compléter rapidement après le déploiement | **Moyen** | La première personne à s'inscrire sur une instance fraîche et publiquement accessible devient l'administrateur — tant que vous ne vous inscrivez pas et ne définissez pas `HBOX_OPTIONS_ALLOW_REGISTRATION=false`, toute personne qui découvre l'URL peut revendiquer le compte administrateur. |
| `gcs_volumes` pour les photos d'articles | Laisser vide (utiliser le montage `/data` du module) | **Élevé** | `Homebox_Common` monte déjà le bucket `data` à `/data`. Fournir une liste `gcs_volumes` non vide remplace entièrement ce montage — si le remplacement ne couvre pas également `/data`, les photos d'articles et les pièces jointes téléchargées reviennent au système de fichiers éphémère du pod et ne survivent pas à un redémarrage. |
| Variables `db_*_env_var_name` | Laisser leurs valeurs par défaut spécifiques à Homebox | Critique | La modification/suppression de ces variables interrompt la connexion Postgres de Homebox — il lit `HBOX_DATABASE_*`, pas `DB_*`. |
| `HBOX_DATABASE_SSL_MODE` | `disable` (déjà défini par ce module) | Critique | Sur GKE, `DB_HOST` se résout en `127.0.0.1` (le sidecar cloud-sql-proxy), qui termine lui-même le TLS et sert du texte brut sur le bouclage. Le client Postgres de Homebox définit par défaut `HBOX_DATABASE_SSL_MODE` à `require` et **panique au démarrage** (`tls error: server refused TLS connection`) à moins qu'on ne lui dise que la connexion locale n'est pas chiffrée. `Homebox_GKE` définit cela via `module_env_vars` — ne le supprimez pas. Non nécessaire sur Cloud Run, qui se connecte via un socket Unix (aucune négociation TLS ne s'applique là, quelle que soit cette configuration). |

---

Pour le comportement de la fondation référencé tout au long — Workload Identity,
ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC,
sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**. La configuration
d'application spécifique à Homebox partagée avec la variante Cloud Run est décrite dans
**[Homebox_Common](Homebox_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Homebox sur GKE Autopilot](../labs/Homebox_GKE.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [Homebox sur Google Cloud Run](Homebox_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Homebox Common — Configuration d'application partagée](Homebox_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Grocy sur GKE Autopilot](Grocy_GKE.md), [Mealie sur GKE Autopilot](Mealie_GKE.md), [Wallos sur GKE Autopilot](Wallos_GKE.md), [LubeLogger sur GKE Autopilot](LubeLogger_GKE.md) dans la solution **Gestion de la maison et de la vie**.
