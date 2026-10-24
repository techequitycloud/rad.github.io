---
title: "Chibisafe sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Chibisafe sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Chibisafe_CloudRun.md @ 1665a43e sha256:e25445f1bfca -->

# Chibisafe sur Google Cloud Run {#chibisafe-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Chibisafe_CloudRun.png" alt="Chibisafe sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Chibisafe est un téléchargeur de fichiers et d'images auto-hébergé avec un
tableau de bord moderne, des téléchargements par glisser-déposer, des albums et
une API publique. Ce module déploie la **pile Chibisafe complète** — l'interface
utilisateur web à `/`, l'API REST sous `/api`, la référence OpenAPI à
`/docs`, et les fichiers téléchargés servis par leur nom — comme un
service unique sur **Cloud Run v2**, au-dessus de la fondation
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
partagée de Google Cloud. L'amont livre Chibisafe sous forme de trois
conteneurs (le backend chibisafe-server, un frontend Next.js et un proxy
inverse Caddy) ; ce module les combine en une seule image personnalisée.

> **Statut :** l'image full-stack n'a pas encore été construite ou déployée,
> donc le comportement ci-dessous est décrit à partir de la source du module et
> de la version `v6.5.5` de l'amont, non vérifié en direct.

Ce guide se concentre sur les services cloud utilisés par Chibisafe et sur la
manière de les explorer et de les exploiter depuis la Google Cloud Console et
la ligne de commande. Pour les mécanismes communs à chaque application Cloud
Run — identité de service, ingress et équilibrage de charge, mise à l'échelle
et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## Ce que coûte Chibisafe sur RAD, et comment cela se compare {#what-chibisafe-costs-on-rad-and-how-that-compares}

**Chibisafe sur le module Cloud Run de RAD coûte environ 33 US$ par mois dans votre propre projet Google Cloud, sans frais de licence supplémentaires** — Chibisafe est open source. Dans un projet géré par RAD pour vous, le même déploiement est facturé à **15 crédits par jour** (environ 450 par mois, soit environ 45 US$ au prix de la recharge). Ou consultez le [guide GKE](Chibisafe_GKE.md) pour une capacité toujours active sur les pods. Si vous n'avez besoin de Chibisafe qu'occasionnellement — pour des études, une démo, un projet de courte durée — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour quelques crédits, de sorte que ce chiffre mensuel devient quelques dollars à la place. Voir **Mettre en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

Chibisafe est open source, il n'y a donc pas de frais de licence. Vous payez pour trois choses :

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 40 crédits (4 US$ au prix de la recharge) | 36 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build (environ 3 à 6 crédits) | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **33 US$ par mois** pour la configuration par défaut (tableau ci-dessous) | Facturé à l'heure en crédits ; RAD publie **15 crédits par jour**, environ 450 par mois (environ 45 US$ au prix de la recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 US$ pour une recharge unique, et moins pour un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Cloud Run, 1x vCPU / 1 Gio (chaud) | 13,14 US$ |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 US$ |
| Cloud NAT et réseau | 5 US$ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 US$ |
| **Total** | **environ 33 US$** |

Les prix de Cloud SQL et des pods Cloud Run/GKE sont les mêmes à africa-south1 (Johannesburg) ; la petite VM coûte environ 10 % de plus là-bas.

- **Ce module est maintenu chaud par défaut** (`min_instance_count ≥ 1`), de sorte que le chiffre Cloud Run ci-dessus suppose déjà qu'il ne se met jamais à l'échelle zéro.

### Comment cela se compare, pour un hébergeur de fichiers personnel ou pour petite équipe {#how-it-compares-for-a-personal-or-small-team-file-host}

Chibisafe n'a pas d'offre hébergée officielle — il est livré sous forme de pile auto-hébergée, de sorte que la comparaison réaliste est un serveur nu :

- Un Hetzner CPX22 ou un droplet DigitalOcean (2 vCPU/4 Go, environ 24 US$/mois) ou un GCP e2-standard-2 (2 vCPU/8 Go, environ 49 US$/mois) le ferait fonctionner confortablement — surdimensionné pour l'empreinte 1 vCPU/1 Gio de Chibisafe ici, donc une classe d'instance plus petite et moins chère ferait tout aussi bien l'affaire.
- Sur un VPS nu, vous possédez le système d'exploitation, les correctifs de sécurité et votre propre discipline de sauvegarde. Le module de RAD vous offre le calcul, Secret Manager et Cloud Monitoring déjà câblés, pour les frais de module plus l'utilisation de Google Cloud ci-dessus.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Chibisafe s'exécute dans **un projet géré par RAD pour vous**, la suppression de l'ensemble du projet — plutôt que la suppression de ce seul module — délie d'abord sa facturation, puis demande à Google de supprimer le projet purement et simplement. Google le conserve, récupérable, pendant 30 jours, et comme la facturation est déjà déliée, rien n'est facturé pendant qu'il attend. Contrairement à la suppression d'un module, cela ne démantèle pas Cloud SQL, aucune VM ou la ressource de calcul une par une : l'ensemble du projet s'arrête simplement.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **La restauration est une vérification, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet peut demander à Google de récupérer le projet et de rattacher son compte de facturation, puis d'exécuter **Mettre à jour** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes, et une mise à jour ne facture plus les frais de module. Pour une chaîne de déploiement typique de 2 à 3 déploiements, cela ne coûte qu'une poignée de crédits au total (environ 5 à 10 crédits, moins de 1 US$).
- **Ce qu'il faut.** Vous devez posséder le projet (pas un projet dont RAD gère uniquement la facturation), le restaurer vous-même dans les 30 jours — après quoi Google le supprime définitivement — et atteindre à nouveau le seuil d'admission du niveau (100 crédits pour le niveau sandbox qui convient à la plupart des utilisations d'étude/démo). Google indique que la plupart des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.
- **Un véritable manque : les sauvegardes nocturnes ne survivent pas.** Les sauvegardes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud Storage désactivée, il est donc très probable qu'il disparaisse dès que le projet est supprimé — même si le projet lui-même est récupérable pendant 30 jours. Copiez une sauvegarde (vers Google Drive, ou un bucket en dehors du projet) avant de la supprimer s'il y a quelque chose à conserver ; pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

Source : [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects).

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que la fenêtre de restauration de 30 jours ci-dessus est passée, la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer lorsque vous en avez besoin.

- **Ce que coûte un redéploiement.** Les frais de module à nouveau, plus les builds : environ 44 crédits (environ 4,40 US$) au prix de la recharge, et environ 15 à 20 minutes de temps de build (moyenne de la propre plateforme de RAD). La suppression ne permet d'économiser de l'argent que si Chibisafe devait rester inutilisé pendant environ **3 jours ou plus** — dans votre propre projet, cela représente environ 1,09 US$ par jour, et dans un projet géré par RAD, c'est 15 crédits par jour.
- La majeure partie du coût d'exécution ici est généralement la base de données et/ou la VM ou le cluster de fichiers/cache partagé. Ils ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, de sorte que la suppression de Chibisafe alors qu'une autre application partage le projet n'économise que la partie calcul de Chibisafe.
- **Conserver les données en premier.** Les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui, alors copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant obtient l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est mise en pause et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais RAD et estimation des crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour la fenêtre de pause/restauration et la mise en garde concernant le bucket de sauvegarde ; les prix changent, vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Chibisafe s'exécute comme un conteneur unique, construit sur mesure, sur Cloud
Run v2 — Caddy devant deux processus Node.js (backend et frontend) — sans
base de données externe. Le déploiement connecte un ensemble ciblé de services
Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Image full-stack construite sur mesure (Caddy sur le port 8000 → backend + frontend Next.js sur boucle locale) ; 1 vCPU / 1 Gio par défaut ; `min=max=1` (instance unique) |
| Base de données | Aucune | Chibisafe conserve sa base de données SQLite, ses téléchargements et ses journaux sur le volume monté — aucune instance Cloud SQL n'est créée |
| Stockage persistant | Cloud Storage (GCS Fuse) | Un bucket `storage` est toujours provisionné et monté à `/data` via GCS Fuse (nécessite `gen2`) ; **pas** un périphérique de bloc durable |
| Secrets | Secret Manager | Optionnel `ADMIN_PASSWORD` (géré par `enable_api_key`, désactivé par défaut) |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut, publique par défaut (`ingress_settings = "all"`) |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **SQLite est la seule "base de données".** `database_type` est fixé à `NONE` par `Chibisafe_Common` ; les nombreuses variables `database_*`/`db_*`/`sql_instance_*` reflétées dans `variables.tf` existent uniquement pour la parité de convention de la Fondation et n'ont aucun effet.
- **La persistance est GCS Fuse, pas un périphérique de bloc — et le module le dit.** Cloud Run n'a pas d'option PVC/stockage de bloc, donc le seul bucket `storage` est monté à `/data` via GCS Fuse. Le propre `module_description` de ce module avertit explicitement : *"Considérez Chibisafe_GKE avec un PVC de bloc pour un stockage SQLite durable en production."* Les sémantiques de verrouillage de fichiers POSIX de GCS Fuse sont plus faibles qu'un vrai système de fichiers, ce qui est un risque réel pour une application SQLite à un seul rédacteur sous une charge d'écriture soutenue.
- **Instance unique, rédacteur unique.** `min_instance_count = max_instance_count
  = 1` par défaut — ne pas dépasser 1 sans repenser le stockage.
- **Image construite sur mesure avec un verrouillage de version spécifique à l'application.** Le Dockerfile est basé sur `chibisafe/chibisafe-server` (backend à `/app`), copie le frontend Next.js `chibisafe/chibisafe` (`/opt/chibisafe-web`) et un binaire Caddy statique `2.11.4`, et lit son propre argument de build `CHIBISAFE_VERSION` (pas le générique `APP_VERSION` que la Fondation injecte ; une balise verrouille le backend et le frontend) ; `application_version = "latest"` est verrouillé à `v6.5.5` au moment de la construction.
- **Pas de Redis, jamais.** Le module reflète une variable `enable_redis` (par défaut `true`) pour la parité de convention de la Fondation, mais `main.tf` transmet toujours `enable_redis = false` à App_CloudRun quelle que soit sa valeur — Chibisafe n'a pas de dépendance Redis.
- **`enable_cloudsql_volume` est inerte.** Sa valeur par défaut déclarée est déjà `false`, et `main.tf` code en dur `enable_cloudsql_volume = false` dans l'appel à App_CloudRun — la valeur de la variable est ignorée de toute façon.
- **Ingress public par défaut.** `ingress_settings = "all"` — Chibisafe est une interface utilisateur publique de téléchargement/hébergement de fichiers consultée directement. (Ce module a été précédemment affecté par un bug généralisé où le boilerplate "charge de travail de base de données" copié-collé définissait par défaut `ingress_settings` à `"internal"` ; la source actuelle confirme que la valeur par défaut ici est correctement `"all"`.)
- **Mot de passe administrateur.** Le compte propriétaire de la première exécution de Chibisafe est `admin`. Avec `enable_api_key = true` (la valeur par défaut de ce module, et requise par un garde-fou au moment du plan lorsque `ingress_settings = "all"`), son mot de passe est une valeur aléatoire `ADMIN_PASSWORD` de Secret Manager ; sinon, c'est la valeur par défaut bien connue de l'amont `admin` — changez-la immédiatement après la première connexion.
- **Le chemin de santé est `/api/health`.** Les variables `startup_probe` / `liveness_probe` de ce module ciblent `/api/health` via le proxy Caddy intégré au conteneur : un `200 {"status":"yes"}` littéral, non authentifié, qui prouve que le proxy et le backend fonctionnent. `/` est l'interface utilisateur web, dont le code de statut est le choix du frontend plutôt qu'un signal de santé. Les variables séparées `startup_probe_config` / `health_check_config` (maintenant également par défaut à `/api/health`) sont remplacées pour ce module — voir §6.
- **Les téléchargements de plus de 32 Mio nécessitent une taille de bloc plus petite.** Voir §3.
- **Tout l'état réside sous un seul montage.** Le point d'entrée lie symboliquement les répertoires `/app/database`, `/app/uploads` et `/app/logs` de l'image dans des sous-répertoires du volume GCS Fuse unique (`/data`), migrant tout contenu amorcé par l'image lors du premier démarrage.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des services et des ressources sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Chibisafe {#a-cloud-run--the-chibisafe-service}

Chibisafe s'exécute comme un service Cloud Run v2 unique. Chaque déploiement crée une révision immuable ; avec `min=max=1`, il y a normalement exactement une instance de conteneur active.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud Storage — le volume d'état persistant {#b-cloud-storage--the-persistent-state-volume}

Chibisafe n'a pas de service de base de données à inspecter — son état entier (base de données SQLite, fichiers téléchargés et journaux) réside sur le seul bucket Cloud Storage monté via GCS Fuse à `/data` (nécessite `execution_environment = "gen2"`). Chibisafe_Common provisionne toujours ce bucket `storage` ; des buckets supplémentaires peuvent être déclarés via `storage_buckets`, et des montages GCS Fuse supplémentaires via `gcs_volumes`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~chibisafe"
  gcloud storage ls gs://<data-bucket>/database gs://<data-bucket>/uploads gs://<data-bucket>/logs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les mécanismes de montage GCS Fuse et les options CMEK.

### C. Secret Manager {#c-secret-manager}

Chibisafe ne génère **aucun secret par défaut**. Le seul secret optionnel est un mot de passe administrateur aléatoire, géré par `enable_api_key` (par défaut `true` dans ce module) : lorsqu'il est activé, une valeur aléatoire de 24 caractères est stockée dans Secret Manager (suffixe de nom `api-key`) et injectée comme variable d'environnement `ADMIN_PASSWORD` via le chemin de référence standard de Cloud Run Secret Manager — le backend de Chibisafe amorce son compte administrateur de première exécution à partir de cette valeur au lieu de la valeur par défaut bien connue de l'amont.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~chibisafe"
  gcloud secrets versions access latest --secret=<api-key-secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation. Notez que (contrairement à la variante GKE) le `outputs.tf` de ce module n'affiche **pas** le nom du secret généré comme sortie — localisez-le avec le filtre `gcloud secrets
list` ci-dessus.

### D. Réseau et ingress {#d-networking--ingress}

Le service est accessible à son URL `run.app` par défaut (`ingress_settings = "all"`), ce qui convient à une interface utilisateur publique de téléchargement/hébergement de fichiers. Un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peut être superposé via `enable_cloud_armor`.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run sont envoyées à Cloud Monitoring. Les vérifications de disponibilité et les politiques d'alerte optionnelles sont désactivées par défaut (`uptime_check_config.enabled = false`).

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Chibisafe {#3-chibisafe-application-behaviour}

- **Pas de job d'initialisation ou de migration.** Chibisafe gère son propre stockage SQLite ; `Chibisafe_Common` n'injecte pas de job `db-init`/migration (`database_type =
  NONE`). La variable `initialization_jobs` est transmise à la fondation mais n'est utile que pour les tâches de chargement de données personnalisées.
- **Déplacement de l'état au premier démarrage.** L'image conserve l'état mutable sous trois répertoires frères dans son WORKDIR — `/app/database` (SQLite), `/app/uploads` (fichiers/miniatures) et `/app/logs`. Le point d'entrée (`entrypoint.sh`) lie symboliquement chacun d'eux dans un sous-répertoire du volume GCS Fuse unique (`/data`), migrant tout contenu amorcé par l'image dans le volume vide au premier démarrage. C'est idempotent lors des redémarrages — les répertoires déjà liés symboliquement sont laissés tels quels. Le même script de point d'entrée est partagé avec la variante GKE, qui monte un PVC de bloc au même chemin à la place.
- **Compte administrateur.** Au premier démarrage, le backend crée le compte propriétaire `admin`. Si `enable_api_key = true` (la valeur par défaut), une valeur aléatoire est générée et injectée comme `ADMIN_PASSWORD`, que le backend utilise comme mot de passe de ce compte au lieu de la valeur par défaut bien connue de l'amont (`admin`) ; sinon, connectez-vous avec `admin`/`admin` et changez-le immédiatement. `ADMIN_PASSWORD` est transmis uniquement au processus backend — le point d'entrée le supprime de l'environnement du frontend et de Caddy.
- **Pas d'alias de variable d'environnement de base de données.** `database_type = NONE` — il n'y a pas d'injection ou d'alias `DB_HOST`/`DB_USER` à craindre ; SQLite réside entièrement sur le volume GCS Fuse `/data`.
- **Processus et ports.** `tini` est PID 1 ; le point d'entrée (après le déplacement d'état ci-dessus) démarre trois processus :

  | Processus | Écoute sur | Sert |
  |---|---|---|
  | Caddy | `0.0.0.0:$PORT` (= `container_port`, par défaut `8000`) | Le seul écouteur vers lequel Cloud Run achemine |
  | backend chibisafe-server | `127.0.0.1:18000` (boucle locale uniquement) | `/api/*`, `/docs*` |
  | frontend Next.js | `127.0.0.1:18001` (boucle locale uniquement) | L'interface utilisateur web |

  Ils sont supervisés en mode **fail-fast** : si l'un d'eux se termine, les autres sont arrêtés et le conteneur se termine avec le statut 1, de sorte que Cloud Run le redémarre (choisi plutôt que supervisord, qui maintiendrait un conteneur en bonne santé avec un frontend mort).
- **Routage** (Caddyfile `v6.5.5` de l'amont, même ordre) : tout chemin nommant un fichier sous `/data/uploads` est servi directement par Caddy (le backend ne sert pas les téléchargements en production) ; `/api/*` → backend (l'API REST — voir la sortie `api_url`) ; `/docs*` → backend (la référence Scalar OpenAPI) ; tout le reste → frontend (l'interface utilisateur web à `/`, par exemple `/dashboard`, `/login`). Deux déviations par rapport à l'amont : l'en-tête `Host` est conservé, de sorte que les liens de fichiers construits par le backend sont corrects sans définir "Servir les téléchargements depuis" ; et `X-Forwarded-For`/`X-Real-IP` sont définis sur l'IP client que Caddy résout lui-même (plages Google front-end fiables, sélection stricte la plus à droite), de sorte qu'un client ne peut pas les usurper.
- **Frontend → backend.** Le rendu côté serveur du frontend appelle le backend directement à `BASE_API_URL=http://127.0.0.1:18000`, défini par le point d'entrée — rien ne dépend de l'interpolation de `$(VAR)` par Cloud Run, ce qu'il ne fait pas. Le navigateur appelle le `/api` de même origine.
- **Environnement du conteneur.** `NODE_ENV=production` est la seule valeur par défaut à l'échelle du conteneur ; `HOST`/`HOSTNAME`/`PORT` pour les deux processus Node sont définis par processus par le point d'entrée. `PORT` n'est délibérément **pas** injecté par `Chibisafe_Common` car Cloud Run réserve ce nom de variable d'environnement et le définit automatiquement à partir de `container_port` — l'injecter explicitement provoquerait une erreur 400 lors de l'appel de création de service. Caddy écoute sur ce `PORT`.
- **`container_port` est actif ici (contrairement à la variante GKE).** `chibisafe.tf` fusionne `container_port = var.container_port` dans la configuration du module que la Fondation lit, donc changer cette variable modifie réellement le port vers lequel Cloud Run achemine et la valeur `PORT` sur laquelle Caddy écoute. Il ne doit pas être `18000` ou `18001` (les ports internes) ; le conteneur refuse de démarrer.
- **Téléchargements de plus de 32 Mio.** Cloud Run plafonne un corps de requête HTTP/1 à 32 Mio, et la taille de bloc de téléchargement par défaut de Chibisafe est d'environ 81 Mo, de sorte que les téléchargements de fichiers de plus de 32 Mio échouent sur Cloud Run jusqu'à ce qu'un administrateur réduise la **Taille de bloc** dans les paramètres du tableau de bord (par exemple, à 25-30 Mo). Ceci est dérivé de la source amont et de la limite documentée de Cloud Run, non mesuré en direct. `Chibisafe_GKE` derrière un LoadBalancer n'a pas un tel plafond.
- **Mémoire.** Le `1Gi` par défaut contient maintenant deux processus Node plus Caddy ; cela n'a pas encore été mesuré en direct — augmentez `memory_limit` si les révisions sont tuées par manque de mémoire.
- **Mise à jour d'un déploiement existant.** Une MISE À JOUR d'un déploiement effectué avec la version précédente uniquement backend reconstruit l'image automatiquement (le hachage de contenu du répertoire scripts change), conserve le port `8000`, supprime la variable d'environnement `HOST=0.0.0.0` à l'échelle du conteneur (maintenant définie par processus) et laisse les données sur `/data` intactes. `/` passe d'une réponse JSON 404 à l'interface utilisateur web.
- **Chemin de santé.** Les sondes de démarrage et de vivacité sont toutes deux **HTTP** `GET
  /api/health` (variables `startup_probe`/`liveness_probe` de ce module, par défaut `initial_delay_seconds = 15` / `30`), envoyées via Caddy au backend, qui renvoie un 200 littéral une fois le service démarré, sans authentification requise. Voir §6 pour savoir pourquoi les variables séparées `startup_probe_config` / `health_check_config` n'ont en fait aucune importance ici.
- **Inspecter la configuration en cours d'exécution :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --project "$PROJECT" \
    --format='value(status.url)'
  gcloud run revisions describe <revision-name> --region "$REGION" --project "$PROJECT" \
    --format='value(spec.containers[0].env)'
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour Chibisafe sont listés ; toute autre entrée est héritée de [App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Court suffixe qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails autorisés à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `chibisafe` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Chibisafe` | Nom lisible par l'homme affiché dans la console. |
| `description` | _(défini)_ | Description du service. |
| `application_version` | `latest` | Balise d'image `chibisafe/chibisafe-server` ; `latest` est épinglé à `v6.5.5` au moment de la construction via l'argument de construction `CHIBISAFE_VERSION` spécifique à l'application. |
| `enable_api_key` | `true` | Génère une valeur aléatoire de 24 caractères dans Secret Manager, injectée comme `ADMIN_PASSWORD`, amorçant le premier identifiant administrateur au lieu de la valeur par défaut de l'amont. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | 1 vCPU par défaut. |
| `memory_limit` | `1Gi` | 1 Gio par défaut. Le texte de description mentionne "index vectoriels"/"collections" — un artefact de copier-coller d'un module de base de données vectorielle ; ignorez la formulation, la valeur par défaut est correcte. |
| `min_instance_count` / `max_instance_count` | `1` / `1` | Maintenir à 1 — Chibisafe est une application SQLite à un seul rédacteur sur un seul montage GCS Fuse. |
| `container_port` | `8000` | Le port du proxy Caddy. Actif (voir §3) — modifie à la fois la route Cloud Run et la variable d'environnement injectée `PORT`. Ne doit pas être `18000`/`18001`. |
| `execution_environment` | `gen2` | Requis pour le montage GCS Fuse `/data`. |
| `timeout_seconds` | `300` | Durée maximale de la requête (0 à 3600 secondes). |
| `enable_cloudsql_volume` | `false` | **Inerte** — `main.tf` code en dur `false` à la Fondation quelle que soit la valeur de cette variable. Chibisafe n'a pas de base de données Cloud SQL. |
| `container_protocol` | `http1` | La description mentionne "requis pour Chibisafe gRPC" — un autre artefact de copier-coller ; Chibisafe n'a pas d'interface gRPC. Laisser à `http1`. |
| `service_annotations` / `service_labels` | `{}` | Annotations/étiquettes de service Cloud Run personnalisées. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image construite dans Artifact Registry. |
| `traffic_split` | `[]` | Répartir le trafic entre les révisions pour les déploiements échelonnés. |
| `max_revisions_to_retain` | `7` | Déclaré pour la parité de convention ; non transmis par le `main.tf` de ce module. |
| `container_image_source` / `container_image` / `container_build_config` / `container_resources` | `custom` / `""` / `{enabled=true}` / `{1000m,512Mi}` | Espaces réservés inertes reflétés par la Fondation — la construction réelle (Dockerfile, argument de construction `CHIBISAFE_VERSION`) provient de la configuration fixe de `Chibisafe_Common`, pas de ces variables. |

### Groupe 5 — Accès et réseau {#group-5--access--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Public par défaut — Chibisafe est une interface utilisateur de téléchargement de fichiers directement consultée. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via VPC. |
| `enable_iap` | `false` | Exiger la connexion Google. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. `NODE_ENV=production` et `HOST=0.0.0.0` sont définis automatiquement. |
| `secret_environment_variables` | `{}` | Mappage variable d'environnement → nom de secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et maintenance {#group-7--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration standard de Cloud Build / Cloud Deploy d'App_CloudRun — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`,
`custom_sql_scripts_path`, `custom_sql_scripts_use_root` sont transmis à la
Fondation mais sont une opération nulle — Chibisafe n'a pas de base de données
SQL (`database_type =
NONE`).

### Groupe 10 — Équilibreur de charge, CDN et rétention d'images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner un équilibreur de charge HTTPS global + WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage, système de fichiers et Redis (inerte) {#group-11--storage-filesystem--redis-inert}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne le bucket `storage` toujours présent. |
| `storage_buckets` | `[]` | Buckets GCS supplémentaires au-delà du bucket de données auto-provisionné. |
| `enable_nfs` | `true` | Doit rester `true` sur Cloud Run : la base de données SQLite de Chibisafe, les téléchargements et les journaux résident sous `/data`, et GCS FUSE ne peut pas héberger une base de données SQLite. |
| `nfs_mount_path` | `/data` | Chemin de montage à l'intérieur du conteneur (pertinent uniquement si `enable_nfs` est défini). |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse supplémentaires. Le bucket Chibisafe `storage` est automatiquement ajouté à `/data`. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `enable_redis` | `true` (mis en miroir, **inerte**) | Déclaré uniquement pour la parité de convention de la Fondation — `main.tf` transmet toujours `enable_redis = false` à App_CloudRun quelle que soit cette valeur. Chibisafe n'a pas de dépendance Redis. |

### Groupe 12 — Backend de base de données (non applicable) {#group-12--database-backend-not-applicable}

`database_type` est fixé à `NONE` par `Chibisafe_Common`. Toutes les autres variables du Groupe 12 — `sql_instance_name`, `sql_instance_base_name`, `database_password_length`, `application_database_name`, `application_database_user`, `db_password_env_var_name`, `db_host_env_var_name`, `db_user_env_var_name`, `db_name_env_var_name`, `db_port_env_var_name`, `service_url_env_var_name`, `enable_mysql_plugins`/`mysql_plugins`, `enable_postgres_extensions`/`postgres_extensions`, `enable_auto_password_rotation`/`rotation_propagation_delay_sec` — sont déclarées uniquement pour la mise en miroir de la convention de la Fondation et n'ont aucun effet sur ce module.

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Aucun job par défaut n'est injecté ; à utiliser uniquement pour les tâches de chargement de données personnalisées. |
| `cron_jobs` | `[]` | Jobs Cloud Run planifiés récurrents ; aucun par défaut. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/health`, délai initial de 15s | La sonde de démarrage effective et active (voir §3). |
| `liveness_probe` | HTTP `/api/health`, délai initial de 30s | La sonde de vivacité effective et active. |
| `startup_probe_config` | HTTP `/api/health`, activé | **Inerte pour ce module** — la fondation d'App_CloudRun préfère toujours le `startup_probe` spécifique à l'application fourni via `application_config` à cette variable autonome, donc la modifier n'a aucun effet sur la sonde déployée. |
| `health_check_config` | HTTP `/api/health`, activé | Même inertie que `startup_probe_config` — `liveness_probe` (Groupe 14, ci-dessus) est ce qui est réellement déployé. |
| `uptime_check_config` | `{ enabled=false, path="/api/health" }` | Vérification de disponibilité Cloud Monitoring ; désactivée par défaut. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 23 — VPC Service Controls et journalisation d'audit {#group-23--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode de simulation. |
| `organization_id` | `""` | Remplacement pour les projets imbriqués dans des dossiers. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Retournées lors d'un déploiement réussi — le moyen le plus rapide de localiser
et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_url` | URL de l'interface web de Chibisafe (servie à `/`). La même origine sert l'API REST sous `/api`, la référence OpenAPI à `/docs` et les fichiers téléchargés par leur nom. |
| `api_url` | URL de base de l'API REST (`<service_url>/api`), pour les clients et scripts de téléchargement ; `GET <api_url>/health` renvoie `200 {"status":"yes"}`. |
| `service_name` | Nom du service Cloud Run. |
| `chibisafe_url` | Alias de `service_url` (l'interface web) ; accessible uniquement depuis le même VPC lorsque `ingress_settings` est `internal`. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URLs de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsque `enable_cloud_armor` est activé). |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Statut de surveillance, canaux, tests de disponibilité. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `initialization_jobs` | Noms des jobs d'initialisation personnalisés. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | Statut et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | Statut VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et statut CMEK. |

Notez l'absence de sortie pour le secret optionnel `enable_api_key` —
contrairement à `Chibisafe_GKE` (qui expose `chibisafe_api_key_secret_id`), ce
module ne révèle pas le nom du secret généré ; trouvez-le via `gcloud secrets list
--filter="name~chibisafe"`.

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur de base [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et les combinaisons* au moment de la planification — un `container_port`/`timeout_seconds`/`backup_retention_days` hors de portée, un runtime `gen1` combiné à `gcs_volumes`, un `traffic_split` invalide. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| Modèle de persistance | GCS Fuse `/data` (seule option de ce module) | Critique | SQLite sur les sémantiques de verrouillage de fichiers POSIX de GCS Fuse n'est pas entièrement sûr en cas d'écritures soutenues/concurrentes. Les métadonnées du module recommandent explicitement `Chibisafe_GKE` (PVC de bloc) pour le stockage de production durable ; utilisez cette variante Cloud Run uniquement pour les téléchargeurs légers/à faible trafic. |
| `max_instance_count` | `1` | Critique | Chibisafe est une application SQLite à écrivain unique ; la mise à l'échelle au-delà d'une instance risque de corrompre la base de données SQLite sur le montage GCS Fuse partagé par des écrivains concurrents. |
| `startup_probe` / `liveness_probe` `path` | `/api/health` | Moyen | `/api/health` est un 200 littéral via le proxy vers le backend. `/` est l'interface web, dont le code d'état est le choix du frontend, donc une sonde à cet endroit n'est pas un signal de santé fiable. |
| `container_port` | `8000` | Moyen | `18000`/`18001` entrent en collision avec les ports internes du backend/frontend et le conteneur refuse de démarrer. |
| Taille du bloc de téléchargement | réduire à 25–30 Mo dans les paramètres du tableau de bord | Moyen | La limite de 32 MiB du corps de requête HTTP/1 de Cloud Run rejette les blocs par défaut de Chibisafe d'environ 81 Mo, de sorte que les téléchargements de fichiers de plus de 32 MiB échouent (dérivé d'une source en amont, non mesuré en direct). |
| `enable_api_key` | `true` pour tout déploiement en dehors d'un réseau de confiance | Élevé | Avec `ingress_settings = all` (la valeur par défaut) et `enable_api_key = false`, la garde-fou au moment de la planification rejette la configuration ; sans cela, le compte `admin` conserverait le mot de passe bien connu en amont `admin` jusqu'à ce que quelqu'un le change. |
| `ingress_settings` | `all` | Moyen | Confirmez que votre copie de travail de ce module n'a pas régressé à `internal` — un bug historique de copier-coller à l'échelle de la flotte a fait que plusieurs modules `ingress_settings` ont été définis par défaut sur `internal`, ce qui rendrait ce téléchargeur de fichiers public complètement inaccessible malgré la réussite des contrôles de santé. |
| `startup_probe_config` / `health_check_config` | laisser tel quel ; comprendre qu'ils sont inertes | Faible | La fondation d'App_CloudRun préfère toujours les `startup_probe`/`liveness_probe` spécifiques à l'application fournis via `application_config` à ces variables autonomes lorsque les deux sont présentes, donc la modification de ces deux n'a aucun effet sur la sonde déployée. |
| `enable_cloudsql_volume` | `false` (seule valeur qui compte) | Faible | `main.tf` code en dur `false` à la Fondation, quelle que soit la valeur de cette variable ; Chibisafe n'a pas de base de données Cloud SQL. |
| `enable_redis` | toute valeur (inerte) | Faible | `main.tf` transmet toujours `enable_redis = false` — la modification de cette variable n'a aucun effet ; ne vous fiez pas à elle pour ajouter la connectivité Redis. |
| `memory_limit` / `min_instance_count` / `container_protocol` descriptions | ignorer la formulation | Faible | Le texte de description de ces variables fait référence à des "index vectoriels", des "collections", du "chargement d'index" et du "gRPC" — un copier-coller résiduel d'un modèle de module de base de données vectorielle. Chibisafe est un téléchargeur de fichiers sans rien de tout cela ; les valeurs par défaut numériques/chaînes elles-mêmes (`1Gi`, `1`, `http1`) sont correctes et non affectées. |
| `database_type` / `db_*` / `sql_instance_*` variables | `NONE` / inerte | Faible | Chibisafe n'a pas de base de données SQL ; celles-ci n'existent que pour la mise en miroir des variables de la Fondation et sont ignorées silencieusement. |
| `enable_api_key` découvrabilité du secret | utiliser `gcloud secrets list --filter="name~chibisafe"` | Faible | Le `outputs.tf` de ce module n'expose pas le nom du secret généré en tant que sortie (contrairement au `Chibisafe_GKE` de `chibisafe_api_key_secret_id`). |

---

Pour le comportement de la fondation référencé tout au long — identité de service,
mise à l'échelle et concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP,
Autorisation binaire, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à Chibisafe
partagée avec la variante GKE se trouve dans le module `Chibisafe_Common`
(`modules/Chibisafe_Common/README.md`) ; la variante GKE elle-même est
documentée dans **[Chibisafe_GKE](Chibisafe_GKE.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Chibisafe sur Cloud Run](../labs/Chibisafe_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Chibisafe sur GKE Autopilot](Chibisafe_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [Chibisafe Common — Configuration d'application partagée](Chibisafe_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [Gokapi sur Google Cloud Run](Gokapi_CloudRun.md), [Cloudreve sur Google Cloud Run](Cloudreve_CloudRun.md) dans la solution **Partage et transfert de fichiers**.
