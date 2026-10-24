---
title: "Seerr sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Seerr sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Seerr_GKE.md @ 1665a43e sha256:d713a6d7dc1b -->

# Seerr sur GKE Autopilot {#seerr-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Seerr_GKE.png" alt="Seerr sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Seerr est la fusion en 2026 de **Jellyseerr** et **Overseerr** — une interface
utilisateur de requête open-source, sous licence MIT, qui se place devant un
serveur multimédia Jellyfin, Plex ou Emby. Les utilisateurs parcourent et
demandent des titres ; un administrateur approuve la requête, et Seerr
appelle les API de Sonarr et Radarr pour déclencher l'acquisition. Ce module
déploie Seerr sur **GKE Autopilot** au-dessus de la fondation
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée de
Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Seerr et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à chaque application GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et le cycle de vie du
déploiement — veuillez vous référer au [guide de la fondation
App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## Ce que coûte Seerr sur RAD, et comment cela se compare {#what-seerr-costs-on-rad-and-how-that-compares}

**L'exécution de Seerr dans votre propre projet GCP coûte environ 149,81 $/mois en frais Google Cloud ; les frais de module de RAD sont de 110 crédits une seule fois (ou 99 crédits dans un projet géré par RAD), couvrant la configuration et le support — pas la facture cloud continue, que Google vous facture directement dans votre propre projet ou que RAD facture à l'heure en crédits dans un projet géré par RAD.**
Ou consultez le guide Cloud Run pour la cible de déploiement alternative ; dans tous les cas, si vous déployez dans un projet géré par RAD, vous pouvez tout mettre en pause gratuitement lorsque vous ne l'utilisez pas — voir [Mettez-le en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module | 110 crédits, une fois | 99 crédits, une fois (10 % de moins) |
| Temps de build | facturé en crédits pendant l'exécution du build (quelques crédits, généralement) | idem |
| Coût d'exécution Google Cloud | ~149,81 $/mois, facturé à votre propre compte de facturation au prix catalogue de Google | ~111 crédits/jour, facturé à l'heure par RAD au prix catalogue majoré d'une marge |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Pod GKE Autopilot, 2 vCPU / 4 GiB | 79,35 $ |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ |
| Cloud NAT et réseau | 5,00 $ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 $ |
| **Total** | **149,81 $** |

### Comment cela se compare {#how-it-compares}

- L'exécuter vous-même sur un VPS nu reste l'option la moins chère en espèces — Hetzner CPX22 (2 vCPU/4 Go) coûte environ **24 $/mois**, un Droplet DigitalOcean 2 vCPU/4 Go est également à **24 $/mois**, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) est à environ **49 $/mois** — plus le temps de l'administrateur pour les sauvegardes, les correctifs de sécurité et les mises à niveau, que Cloud SQL géré par RAD, Secret Manager et la surveillance couvrent pour vous — mais le prix de RAD n'est jamais destiné à battre un VPS, seulement à remplacer le temps d'administration qu'un VPS nécessite encore.
- Seerr se trouve devant un serveur multimédia domestique plutôt que l'internet public, il fonctionne donc en continu mais avec un faible trafic — notez que ce module nécessite `alwaysOn` de calcul pour maintenir l'acquisition déclenchée par les requêtes réactive, c'est pourquoi son propre coût d'exécution est plus élevé que la plupart des applications de ce lot.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

**C'est le titre pour un projet géré par RAD.** La suppression d'un projet géré par RAD délie
d'abord sa facturation, puis demande à Google de supprimer purement et simplement le projet — la
suppression logicielle récupérable de 30 jours de Google. Contrairement à la suppression d'un
seul module, cela ne supprime pas Cloud SQL, aucune VM ou la ressource de calcul une par une :
l'ensemble du projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la
facturation est déjà déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google
de restaurer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter
Update sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été
individuellement détruit, cette mise à jour trouve les mêmes ressources déjà présentes — c'est
une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de
module à nouveau. Cela ne coûte qu'une poignée de crédits (moins de 1 $ US) au total pour une
chaîne typique de 2-3 déploiements.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet que RAD gère uniquement
pour la facturation), vous devez le restaurer vous-même dans les 30 jours — après cela, Google le
supprime définitivement — et la restauration est admise comme la création d'un nouveau projet,
donc votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour
le niveau sandbox qui convient à la plupart des utilisations d'étude/démo). Google affirme que la
plupart des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une
restauration.

**Un véritable manque :** les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du
projet, et ce bucket a la suppression logicielle de Cloud Storage explicitement désactivée, il
est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet
lui-même est récupérable pendant 30 jours. Si vous avez personnalisé l'application et que vous
souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive ou un bucket en dehors
du projet) avant de la supprimer. Pour une installation par défaut sans rien d'irremplaçable,
cela n'a pas d'importance.

### Ne payez que pendant que vous l'utilisez, l'autre façon : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet (ou une fois que vous avez dépassé la fenêtre de restauration de 30 jours ci-dessus), l'alternative est de supprimer Seerr purement et simplement et de le redéployer plus tard. Un redéploiement coûte à nouveau les frais de module, plus les builds — environ 110 + 3-6 crédits de temps de build.

La suppression ne permet d'économiser de l'argent que si Seerr devait rester inutilisé assez longtemps pour compenser ce coût de redéploiement par rapport à son propre coût d'exécution quotidien — par rapport au total du projet ci-dessus, cela représente environ 2 jours ou plus. La majeure partie du coût d'exécution ici est généralement la base de données et la VM NFS/cache ; elles ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc la suppression de cette application pendant que quelque chose d'autre partage le projet n'économise que la partie calcul de cette application.

**Conservez d'abord les données :** les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui, alors copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour une classe. Chaque
  participant obtient l'application dans son propre projet Google Cloud pendant 15 minutes à 24
  heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance
  toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la
  session et les crédits non utilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil :** un partenaire exécute l'application
  pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le
  client. Si le portefeuille est faible, la facturation est interrompue et les données sont
  conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire
  transfère le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et
  ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; radmodules.dev/pricing pour les frais propres à RAD et les estimations de crédits quotidiens ; https://cloud.google.com/resource-manager/docs/delete-restore-projects pour les mécanismes de pause/restauration.

## 1. Vue d'ensemble {#1-overview}

Seerr s'exécute comme un seul pod Node.js/Next.js. Le déploiement relie un
petit ensemble de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pod de processus Node.js unique, 2 vCPU / 4 GiB par défaut |
| Base de données | Cloud SQL PostgreSQL 15 | Contient les données de requête/utilisateur ; les migrations s'exécutent automatiquement à chaque démarrage de pod |
| Stockage d'objets | Cloud Storage | Un bucket `storage` monté à `/app/config` via GCS FUSE (ou un PVC StatefulSet optionnel) — contient `settings.json`, les propres paramètres de l'application Seerr |
| Cache et file d'attente | aucun | Seerr n'a pas de dépendance Redis ou de file d'attente |
| Secrets | Secret Manager | Seulement le mot de passe de la base de données généré — le premier administrateur de Seerr provient de l'assistant de configuration web de l'application |
| Ingress | Cloud Load Balancing | Équilibreur de charge externe, domaine personnalisé optionnel + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Véritablement pré-construit — pas d'image personnalisée.** Le répertoire
  `Seerr_Common` de `scripts/` est vide. `container_image_source = "prebuilt"` déploie
  `ghcr.io/seerr-team/seerr` directement.
- **`DB_TYPE=postgres` est défini inconditionnellement** par `Seerr_Common` — voir le
  [§3 du guide Cloud Run](Seerr_CloudRun.md#-the-db_type-trap--the-most-important-thing-to-know-about-this-module)
  pour l'explication complète ; le même piège et la même solution s'appliquent ici.
- **Port 5055, chemin de santé `/api/v1/status`.** Confirmé via des tests locaux
  `docker run` et un déploiement en direct (le pod a signalé `3/3 Running`,
  `GET /api/v1/status` a renvoyé du JSON réel via `kubectl exec`).
- **Un bug de permission GCS-FUSE spécifique à GKE, trouvé et corrigé.** Le
  conteneur de Seerr s'exécute en tant que `uid=1000/gid=1000`. L'intégration gcsfuse
  de Cloud Run applique automatiquement cet UID/GID au montage ; le **pilote
  CSI GKE GCS FUSE ne le fait pas** — sans correction explicite, le pod
  boucle en cas de crash au premier démarrage avec `EACCES: permission denied` en essayant de
  créer `/app/config/logs/`. `Seerr_Common` monte le volume avec
  `uid=1000`, `gid=1000`, `file-mode=0664`, `dir-mode=0775`
  pour corriger cela. Voir §3.
- **Deux éléments d'état distincts.** PostgreSQL contient les données de
  requête/utilisateur. Les propres paramètres de l'application Seerr (serveurs
  multimédias connectés, curseurs de découverte, agents de notification)
  résident dans un simple fichier `settings.json` sous `/app/config` —
  indépendamment du backend de la base de données.
- **`DB_PASS`, pas `DB_PASSWORD`.** La source de données TypeORM de Seerr
  lit une variable d'environnement spécifiquement nommée `DB_PASS`. Ce
  module définit `db_password_env_var_name = "DB_PASS"` pour correspondre.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis.

### A. GKE Autopilot — la charge de travail Seerr {#a-gke-autopilot--the-seerr-workload}

- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  ```

### B. Cloud SQL — données de requête/utilisateur {#b-cloud-sql--requestuser-data}

- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql databases list --instance=<instance-name> --project "$PROJECT"
  ```

### C. Stockage — Cloud Storage ou un PVC de bloc {#c-storage--cloud-storage-or-a-block-pvc}

- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~seerr"
  kubectl get pvc -n "$NAMESPACE"    # only when stateful_pvc_enabled = true
  ```

### D. Secret Manager {#d-secret-manager}

- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~seerr"
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

## 3. Comportement de l'application Seerr {#3-seerr-application-behaviour}

- **Pas de job de schéma de base de données au premier déploiement.** Le
  `dist/index.js` de Seerr appelle `dbConnection.runMigrations()` explicitement à chaque
  démarrage de pod, il n'y a donc pas de job d'initialisation dans ce module et
  aucun n'est nécessaire. `initialization_jobs` est vide par défaut.
- **La configuration initiale est entièrement dans l'interface web de
  l'application.** Il n'y a aucune information d'identification
  d'administrateur pré-remplie — connectez-vous au service et complétez
  l'assistant de configuration de Seerr : serveur multimédia d'abord, puis
  Sonarr/Radarr.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent toutes
  deux `GET /api/v1/status`.
- **Inspecter l'exécution du job (ne devrait rien montrer, par conception) :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  ```

### ⚠ Le bug UID/GID de GCS-FUSE — le piège spécifique à GKE que ce module corrige {#-the-gcs-fuse-uidgid-bug--the-gke-specific-gotcha-this-module-fixes}

Le conteneur de Seerr s'exécute en tant que `uid=1000/gid=1000` (l'utilisateur
`node` — confirmé via `docker run ghcr.io/seerr-team/seerr id`), et au premier
démarrage tente `mkdir '/app/config/logs/'`.

- **Sur Cloud Run**, l'intégration gcsfuse de la plateforme applique
  automatiquement `uid:1000/gid:1000` au volume monté, ce qui fonctionne sans
  configuration supplémentaire.
- **Sur GKE**, le **pilote CSI GCS FUSE ne définit pas par défaut un UID
  inscriptible.** Un montage `gcs_volumes` nu est détenu par root, et le
  conteneur non-root boucle en cas de crash avec `EACCES: permission denied`.

`Seerr_Common` corrige cela en définissant des `mount_options` explicites sur
le volume de stockage qu'il déclare pour `/app/config` :

```hcl
mount_options = [
  "implicit-dirs", "stat-cache-ttl=60s", "type-cache-ttl=60s",
  "uid=1000", "gid=1000", "file-mode=0664", "dir-mode=0775",
]
```

Il s'agit d'une classe de bugs connue dans ce catalogue — la même forme
d'échec a été précédemment trouvée et corrigée sur les variantes GKE de
Paperless, CodeServer et CloudBeaver (voir la découverte "GKE gcsfuse UID/GID
permission denied" du dépôt `CLAUDE.md`). Seerr est la dernière instance
confirmée, maintenant corrigée au niveau `Seerr_Common` afin que les deux
modules d'application héritent uniformément de la correction.

**Indicateur de diagnostic**, si vous rencontrez ce symptôme sur un fork de ce
module :

```bash
kubectl describe pod -n "$NAMESPACE" <seerr-pod>
# Look for: EACCES: permission denied, mkdir '/app/config/logs/'
```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Seerr sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec leur comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `seerr` | Nom de base des ressources. |
| `application_display_name` | `Seerr` | Nom lisible par l'homme affiché dans l'interface utilisateur de la plateforme. |
| `application_version` | `latest` | Tiré directement comme le tag d'image `ghcr.io/seerr-team/seerr` — aucune étape de build n'est impliquée. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_port` | `5055` | Confirmé via `docker run` local et déploiement en direct ; le service K8s et les sondes doivent tous être d'accord sur cette valeur. |
| `container_image_source` | `prebuilt` | Seerr ne prend en charge que l'image officielle ; `Seerr_Common` la code également en dur en interne. |
| `min_instance_count` / `max_instance_count` | `1` / `5` | Voir §6 ci-dessous. |

### Groupe 31 — Configuration de StatefulSet {#group-31--statefulset-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `false` | `settings.json` est un petit état JSON de fichier entier — sûr sur un volume GCS FUSE à `max_instance_count = 1`, donc un PVC de bloc est optionnel ici, contrairement aux applications SQLite en mode WAL de ce catalogue. |
| `stateful_pvc_mount_path` | `/app/config` | Correspond au chemin de montage par défaut de GCS FUSE. |
| `stateful_pvc_storage_class` | `standard` | HDD `pd-standard` — `settings.json` n'a pas besoin d'IOPS élevés. |

### Groupe 16 — Base de données {#group-16--database}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Requis — Seerr n'a pas de chemin non-Postgres. |
| `application_database_name` / `application_database_user` | `seerr` / `seerr` | Transmis à `Seerr_Common`, injecté comme `DB_NAME`/`DB_USER`. |
| `db_password_env_var_name` | `DB_PASS` | **Critique** — la source de données de Seerr lit spécifiquement `DB_PASS`, pas le `DB_PASSWORD` par défaut de la Fondation. |

### Groupe 11 — Automatisation de la charge de travail {#group-11--workload-automation}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Vide et reste généralement ainsi — `dbConnection.runMigrations()` s'exécute à chaque démarrage de pod à l'intérieur de l'application elle-même. |

### Groupe 14 — Cloud Storage {#group-14--cloud-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `gcs_volumes` | `[]` | Le montage du bucket `storage` corrigé en termes de permissions à `/app/config` est ajouté automatiquement (voir §3) ; utilisez ceci uniquement pour des volumes *supplémentaires*. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `/api/v1/status` (via `Seerr_Common`) | Point de terminaison de statut JSON `200` non authentifié ; le défaut `variables.tf` propre à la variante (HTTP `/`) est remplacé par le défaut plus précis de `Seerr_Common`. |

---

## 5. Sorties {#5-outputs}

| Sortie | Description |
|---|---|
| `service_name` / `service_url` / `service_external_ip` | Identité et adresse du service Kubernetes. |
| `database_instance_name` / `database_name` / `database_user` / `database_password_secret` | Identifiants de l'instance Cloud SQL et de la base de données Seerr. |
| `storage_buckets` | Le bucket `storage` supportant `/app/config` (inutilisé comme montage si `stateful_pvc_enabled = true`). |
| `kubernetes_ready` | Indique si la charge de travail a atteint l'état Prêt. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| Variable d'environnement `DB_TYPE` | Laissez la valeur par défaut de `Seerr_Common` (`postgres`) inchangée | **Critique** | Un `DB_TYPE` manquant/écrasé place silencieusement Seerr sur un fichier SQLite par pod effacé à chaque redémarrage. |
| GCS FUSE `mount_options` sur `/app/config` | Laissez la correction `Seerr_Common`/`uid=1000` de `gid=1000` en place | **Critique** | Sans cela, le pod boucle en cas de crash avec `EACCES: permission denied` au premier démarrage — un mode d'échec spécifique à GKE non observé sur Cloud Run. |
| `db_password_env_var_name` | Laissez à `DB_PASS` | **Critique** | La source de données TypeORM de Seerr lit spécifiquement `DB_PASS` ; le `DB_PASSWORD` par défaut de la Fondation n'est jamais lu seul. |
| `max_instance_count` | Définissez `1` si les changements de paramètres ne doivent jamais entrer en conflit | Moyen | `settings.json` est un fichier unique et mutable — des écritures concurrentes de plusieurs pods risquent une perte d'écriture. La valeur par défaut du module est `5`, plus lâche que la valeur sûre pour un seul rédacteur. |
| `stateful_pvc_enabled` | Laissez `false` à moins d'avoir une raison spécifique pour le stockage par blocs | Faible | `settings.json` n'a pas besoin de verrouillage de fichier POSIX comme le ferait une application SQLite en mode WAL ; GCS FUSE est une valeur par défaut appropriée ici, contrairement aux applications qui nécessitent réellement un véritable périphérique de bloc. |

---

Pour le comportement de la fondation référencé tout au long — Workload Identity,
ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC,
sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**. La
configuration d'application spécifique à Seerr partagée avec la variante Cloud
Run est décrite dans **[Seerr_Common](Seerr_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Seerr sur GKE Autopilot](../labs/Seerr_GKE.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [Seerr sur Google Cloud Run](Seerr_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Seerr Common — Configuration d'application partagée](Seerr_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [Jellyfin sur GKE Autopilot](Jellyfin_GKE.md), [Prowlarr sur GKE Autopilot](Prowlarr_GKE.md), [Jellystat sur GKE Autopilot](Jellystat_GKE.md), [Homepage sur GKE Autopilot](Homepage_GKE.md) dans la solution **Serveur multimédia**.
