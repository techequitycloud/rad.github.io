---
title: "InvenTree sur Google Cloud Run"
description: "Référence de configuration pour le déploiement d'InvenTree sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/InvenTree_CloudRun.md @ 1665a43e sha256:2ca04cc0a5dc -->

# InvenTree sur Google Cloud Run {#inventree-on-google-cloud-run}

InvenTree est un système de gestion d'inventaire gratuit et open source : il
suit les pièces et composants, les emplacements et mouvements de stock, les
fournisseurs, les nomenclatures, ainsi que les commandes d'achat et de vente. Il
est utilisé par les équipes matérielles, les ateliers de fabrication (makerspaces)
et les petits fabricants. Ce module déploie InvenTree sur **Cloud Run v2**
au-dessus de la fondation [App_CloudRun](App_CloudRun.md), qui provisionne et
gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'InvenTree utilise et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toute application Cloud Run —
identité de service, entrée et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au [guide de la
fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## Ce que coûte InvenTree sur RAD et comment cela se compare {#what-inventree-costs-on-rad-and-how-that-compares}

**InvenTree sur le module Cloud Run de RAD coûte environ 70 US$ par mois dans
votre propre projet, plus des frais de module de 75 crédits (7,50 US$) une fois
par déploiement, sans licence par utilisateur.** Si vous n'en avez besoin que
pour une période limitée — un projet d'inventaire, une courte série de
production — consultez la section "Mettez-le en pause gratuitement" ci-dessous
pour arrêter de payer sans perdre vos données d'inventaire. InvenTree n'est
disponible que sous forme de module Cloud Run sur RAD ; il n'existe pas de
variante GKE.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 75 crédits (7,50 US$) | 67,5 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **70,19 US$ par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **26 crédits par jour** |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 US$ pour une recharge ponctuelle, moins sur un plan. Dans
un projet géré par RAD, la base de données, le serveur de fichiers et le réseau
sont partagés par toutes les applications du projet, de sorte qu'une deuxième
application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix
catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Cloud Run, 1 vCPU / 2 Gio (scaleToZero) | 13,16 US$ |
| Cloud SQL pour MySQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 US$ |
| Cloud NAT et réseau | 5,00 US$ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 US$ |
| **Total** | **environ 70,19 US$** |

### Comment cela se compare {#how-it-compares}

- InvenTree n'a pas de plan SaaS hébergé officiel à comparer — il est distribué
  comme une application auto-hébergée pour les équipes matérielles et les
  ateliers de fabrication — donc la comparaison honnête est un serveur nu, ce
  qui est aussi la façon dont la plupart des petites équipes l'exécutent
  aujourd'hui.
- L'empreinte d'InvenTree (1 vCPU, 2 Gio, plus une base de données MySQL) est
  proche d'un Hetzner CPX22 ou d'un droplet DigitalOcean 2 vCPU/4 Go (environ
  24 $/mois) ou d'un GCP Compute Engine e2-standard-2 (environ 49 $/mois) —
  moins cher en espèces, mais vous devez alors gérer MySQL, les sauvegardes,
  les correctifs de sécurité et les mises à niveau de Django vous-même.
- Ce que RAD ajoute par rapport à un VPS nu : Cloud SQL géré avec des
  sauvegardes automatisées et une récupération ponctuelle, Secret Manager pour
  le mot de passe de la base de données, et la surveillance — utile pour un
  système de nomenclature dont dépend une équipe de fabrication, où une base de
  données perdue est un catalogue de pièces perdu.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si InvenTree fonctionne dans un projet géré par RAD pour vous et que vous
prévoyez d'y revenir — une pause entre les cours, une accalmie saisonnière, ou
simplement ne pas savoir si vous en aurez besoin le mois prochain — c'est la
meilleure option, et cela ne coûte presque rien.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La suppression d'un projet géré par RAD délie d'abord sa facturation, puis
demande à Google de supprimer purement et simplement le projet : la suppression
logicielle récupérable de 30 jours de Google. Contrairement à la suppression
d'InvenTree en tant que module unique, cela ne démantèle pas le service Cloud
Run, la base de données Cloud SQL et le réseau un par un — l'ensemble du projet
s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la
facturation est déjà déliée.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet,
demande à Google de restaurer le projet et de rattacher son compte de
facturation, puis vous demande d'exécuter la mise à jour sur chaque déploiement
pour confirmer que tout est revenu. Parce que rien n'a été détruit
individuellement, cette mise à jour trouve les mêmes ressources déjà présentes
— c'est une vérification, pas une reconstruction, et une mise à jour ne facture
jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits
(moins de 1 US$) en temps de build pour une chaîne de déploiements typique.

Ce qu'il faut : vous devez posséder le projet (pas un projet dont RAD gère
uniquement la facturation), vous devez le restaurer vous-même dans les 30 jours
— après cela, Google le supprime définitivement — et la restauration est admise
comme la création d'un nouveau projet, donc votre solde de crédits achetés doit
toujours dépasser le seuil du palier (100 crédits pour le palier sandbox que la
plupart utilisent conviennent). Google indique que la plupart des services
fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.

Une lacune réelle : les sauvegardes nocturnes sont écrites dans un bucket à
l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud
Storage explicitement désactivée, il est donc très probable qu'il disparaisse
dès que vous supprimez le projet, même si le projet lui-même est récupérable
pendant 30 jours. L'exportation nocturne de la base de données d'InvenTree est
conservée dans ce bucket ; pour une installation par défaut sans rien
d'irremplaçable au-delà de ce qui se trouve dans la base de données, c'est la
seule copie qui vaille la peine d'être conservée.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que la fenêtre de 30 jours ci-dessus est
passée, la solution de repli est de supprimer InvenTree purement et simplement
et de le redéployer plus tard.

- **Ce que coûte un redéploiement :** les frais de module à nouveau, plus les
  builds — environ les frais de module indiqués ci-dessus plus 3 à 6 crédits de
  temps de build.
- **Quand cela en vaut la peine :** la suppression ne permet d'économiser de
  l'argent que si InvenTree devait rester inutilisé pendant environ 3 jours ou
  plus dans votre propre projet (environ 3 jours ou plus dans un projet géré
  par RAD). La base de données MySQL représente la majeure partie du coût de
  fonctionnement ici, donc la suppression d'InvenTree seule permet d'économiser
  toute la facture ci-dessus, à moins que quelque chose d'autre dans le projet
  ne la partage.
- **Conservez d'abord les données.** Les sauvegardes nocturnes sont écrites
  dans un bucket à l'intérieur du déploiement, et ce bucket est supprimé avec
  lui — copiez la dernière sauvegarde (vers Google Drive, ou un bucket que vous
  conservez) avant de la supprimer si vous voulez la garder.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour
  une classe. Chaque participant obtient l'application dans son propre projet
  Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation
  définie par le formateur. Soit le formateur finance toutes les places, soit
  chaque participant paie la sienne. Tout est supprimé à la fin de la session
  et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire
  exécute l'application pour un client à partir d'un portefeuille cloisonné
  qu'il finance, et règle directement avec le client. Si le portefeuille est
  faible, la facturation est suspendue et les données sont conservées, de sorte
  que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère
  le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF,
  NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud
Billing Catalog ; frais RAD et estimation des crédits quotidiens de
[radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Google Cloud :
supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour le mécanisme de pause/restauration. Les prix changent ; vérifiez chaque
source avant de vous fier à un chiffre.

---

## 1. Vue d'ensemble {#1-overview}

InvenTree fonctionne comme une application Python/Django servie par gunicorn sur
Cloud Run v2. Chaque révision exécute **deux conteneurs construits à partir de
la même image** : le conteneur web et un sidecar de travail en arrière-plan
django-q `qcluster`. Le déploiement connecte un ensemble ciblé de services Google
Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Conteneur web (1 vCPU / 2 Gio) plus un sidecar `qcluster` (1 vCPU / 1 Gio) ; CPU toujours alloué ; mise à l'échelle à zéro par défaut |
| Base de données | Cloud SQL pour MySQL 8.0 | Schéma créé par les migrations Django dans un job d'initialisation `migrate` dédié |
| Système de fichiers partagé | NFS (serveur NFS Services_GCP) | Optionnel (`enable_nfs = false` par défaut) — nécessaire pour persister le répertoire de données d'InvenTree |
| Stockage d'objets | Cloud Storage | Un bucket `data` (par défaut de la fondation) et un bucket `storage` (d'InvenTree_Common) sont créés ; aucun n'est monté dans le conteneur |
| Secrets | Secret Manager | Mot de passe de la base de données uniquement — le module ne génère aucun secret d'application |
| Entrée | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` du numéro de projet ; équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Utilisez l'URL du numéro de projet.** InvenTree vérifie l'hôte de chaque
  requête par rapport à `INVENTREE_SITE_URL`, que la fondation injecte à partir de l'URL
  prédite `https://<service>-<project-number>.<region>.run.app`. L'URL `*.a.run.app` sous forme de hachage que Cloud Run
  annonce également renvoie **HTTP 500** (`INVE-E7`). La sortie `service_url`
  est la forme du numéro de projet.
- **Le répertoire de données est éphémère à moins que vous n'activiez NFS.**
  InvenTree conserve `config.yaml`, ses `secret_key.txt` générés, les médias
  téléchargés, les fichiers statiques collectés et les plugins sous `/home/inventree/data`.
  Avec la valeur par défaut `enable_nfs = false`, il s'agit du système de fichiers
  propre au conteneur et il est perdu à chaque démarrage à froid. Définissez
  `enable_nfs = true` et `nfs_mount_path = "/home/inventree/data"` pour tout déploiement que vous
  souhaitez conserver.
- **Les migrations sont un job, pas une étape de démarrage.** `INVENTREE_AUTO_UPDATE` est
  `"false"` ; le job d'initialisation `migrate` est propriétaire du
  schéma.
- **Le travailleur en arrière-plan a besoin de CPU en dehors des requêtes.**
  `cpu_always_allocated = true` (facturation basée sur l'instance) afin que le sidecar
  `qcluster` continue de sonder entre les requêtes.
- **La mise à l'échelle à zéro est activée par défaut** (`min_instance_count = 0`,
  `max_instance_count = 1`). Tant qu'aucune instance n'existe, le travailleur ne
  s'exécute pas non plus ; définissez `min_instance_count = 1` si les travaux planifiés
  sont importants.
- **Aucun compte administrateur n'est provisionné.** Le module ne crée aucun
  utilisateur admin et aucun secret admin (voir §3).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les
noms de service et de ressource sont rapportés dans les [Sorties](#5-outputs)
du déploiement.

### A. Cloud Run — le service InvenTree {#a-cloud-run--the-inventree-service}

InvenTree s'exécute en tant que service Cloud Run v2 avec deux conteneurs par
révision : le conteneur d'entrée (gunicorn sur le port 8000) et le sidecar
`qcluster` (pas de HTTP). Chaque déploiement crée une révision immuable ; le
trafic peut être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, les
  conteneurs, le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour MySQL 8.0 {#b-cloud-sql-for-mysql-80}

InvenTree stocke tous ses enregistrements — pièces, stock, commandes,
utilisateurs — dans une instance Cloud SQL pour MySQL 8.0 gérée. Le service se
connecte via l'**IP privée de l'instance via TCP** (`enable_cloudsql_volume = false`) : le point
d'entrée du wrapper définit `INVENTREE_DB_HOST` à partir de `DB_IP` de la
fondation. Lors du premier déploiement, le job `db-init` crée la base de
données et l'utilisateur, puis le job `migrate` crée le schéma.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les drapeaux, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de
passe se trouvent dans les [Sorties](#5-outputs). Voir
[App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et
la rotation des mots de passe.

### C. NFS — le répertoire de données d'InvenTree {#c-nfs--inventrees-data-directory}

Lorsque `enable_nfs = true`, le partage NFS Services_GCP est monté dans le conteneur
web et les jobs d'initialisation à `nfs_mount_path`, et dans le sidecar
`qcluster` à `/home/inventree/data`. Pointez `nfs_mount_path` vers
`/home/inventree/data` afin que les trois voient le même répertoire ; la valeur par
défaut `/var/lib/inventree` n'est pas un chemin qu'InvenTree lit ou écrit.

- **Console :** Compute Engine → Instances de VM (le serveur NFS Services_GCP).
- **CLI :**
  ```bash
  gcloud compute instances list --project "$PROJECT" --filter="name~nfs"
  ```

### D. Cloud Storage {#d-cloud-storage}

Deux buckets sont provisionnés par défaut : le bucket `data` de la
fondation (de `storage_buckets`) et un bucket `storage` fourni par
`InvenTree_Common`. Aucun n'est monté dans le conteneur (`gcs_volumes` est vide),
et InvenTree ne les lit ni ne les écrit. Le bucket `storage` est un endroit
pratique pour stocker des fichiers pour `enable_custom_sql_scripts`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  ```

### E. Secret Manager {#e-secret-manager}

`InvenTree_Common` ne génère aucun secret d'application. Le seul secret est le mot
de passe de la base de données, géré par la fondation. Toute clé nommée
credential que vous placez dans `environment_variables` est automatiquement déplacée
vers Secret Manager pendant `protect_sensitive_environment_variables = true`.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de
rotation.

### F. Réseau et entrée {#f-networking--ingress}

Le service est accessible par défaut à son URL `run.app` de numéro de
projet. Un équilibreur de charge HTTPS externe avec un domaine personnalisé,
Cloud CDN et Cloud Armor peuvent être superposés ; un domaine personnalisé
contourne également le problème des deux noms d'hôte ci-dessus.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  PROJECT_NUMBER=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
  echo "https://<service-name>-${PROJECT_NUMBER}.${REGION}.run.app"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux des deux conteneurs sont acheminés vers Cloud Logging ; les
métriques Cloud Run et Cloud SQL sont acheminées vers Cloud Monitoring. Le test
de disponibilité est **désactivé** par défaut (`uptime_check_config.enabled = false`).

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application InvenTree {#3-inventree-application-behaviour}

- **Chaîne d'initialisation en deux étapes.** `db-init` (`mysql:8.0-debian`, 3
  tentatives, 600 s) crée l'utilisateur et la base de données MySQL et vérifie
  que l'utilisateur peut se connecter. `migrate` (l'image de l'application,
  2 vCPU / 2 Gio, 1800 s, dépend de `db-init`) exécute `python3 manage.py migrate --noinput` puis
  compte les tables ; il échoue si moins de 10 existent, car `migrate` peut
  sortir 0 sans avoir rien appliqué.
- **Pourquoi pas `INVENTREE_AUTO_UPDATE`.** La migration en cours du fournisseur s'exécute
  dans le maître gunicorn avant que le port ne se lie (donc la sonde de
  démarrage tue la révision en pleine migration), sa branche de base de données
  vide est inaccessible, et les conteneurs web et worker se feraient concurrence
  sur le même schéma. Les deux conteneurs s'exécutent avec `INVENTREE_AUTO_UPDATE = "false"`.
- **Environnement requis.** Le point d'entrée du wrapper refuse de démarrer
  sans `INVENTREE_SITE_URL` (ou `CLOUDRUN_SERVICE_URL` en repli) et les
  `DB_IP`, `DB_NAME`, `DB_USER` et `DB_PASSWORD` de la
  fondation. Le module définit également `INVENTREE_USE_X_FORWARDED_PROTO = "true"` et
  `INVENTREE_SESSION_COOKIE_SECURE = "true"`, de sorte que les liens absolus sont `https://` et les
  cookies sont sécurisés derrière la terminaison TLS de Cloud Run.
- **Fichiers statiques.** Le conteneur web exécute `collectstatic` à chaque
  démarrage (le fournisseur `init.sh` ne le fait pas). Un échec est
  enregistré comme un avertissement et le conteneur démarre quand même —
  l'interface utilisateur peut alors s'afficher sans style.
- **Travailleur en arrière-plan.** Le sidecar `qcluster` exécute
  `/cloud-entrypoint.sh
  invoke worker` avec l'environnement d'infrastructure et les secrets de
  l'application (`inherit_app_env = true`), et avec `INVENTREE_AUTO_UPDATE` et
  `INVENTREE_COLLECTSTATIC` définis sur `false`. Désactiver
  `enable_background_worker` le supprime : l'interface utilisateur et l'API fonctionnent
  toujours, mais aucune tâche planifiée, notification ou génération d'étiquettes
  ne s'exécute.
- **Tests de santé.** Les sondes de démarrage et de vivacité sont HTTP
  `GET /` sur le port 8000. Le chemin racine répond par une redirection
  vers l'interface utilisateur web.
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"   # expect 302
  ```
- **Premier administrateur.** Le module ne crée aucun utilisateur InvenTree, et
  l'entrée `admin_email` n'est pas utilisée. Créez le premier superutilisateur
  vous-même — par exemple avec les propres paramètres `INVENTREE_ADMIN_USER`,
  `INVENTREE_ADMIN_EMAIL` et `INVENTREE_ADMIN_PASSWORD` d'InvenTree (voir la
  documentation InvenTree), fournis via `environment_variables` / `secret_environment_variables`.
- **Inspecter l'exécution du job :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
InvenTree sont listés ; toute autre entrée est héritée de
[App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `support_users` | `[]` | E-mails ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `inventree` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `InvenTree` | Nom lisible par l'homme affiché dans la console. |
| `application_version` | `1.5.4` | Tag `inventree/inventree`, passé comme ARG de build `INVENTREE_VERSION`. Épinglez une version exacte — la valeur de cette variante est celle qui prend effet. |
| `php_memory_limit` | `512M` | **Non utilisé** — InvenTree est une application Python. |
| `admin_email` | `admin@example.com` | **Non utilisé** — aucun compte administrateur n'est créé. |
| `enable_gcs_storage_volume` | `true` | **Non utilisé** — aucun bucket n'est monté par ce paramètre. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | Construit l'image du wrapper via Cloud Build. `"prebuilt"` ignore le point d'entrée du wrapper et son mappage `DB_*` → `INVENTREE_DB_*`. |
| `cpu_limit` | `1000m` | CPU pour le conteneur web. |
| `memory_limit` | `2Gi` | Mémoire pour le conteneur web. |
| `min_instance_count` | `0` | `0` active la mise à l'échelle à zéro. |
| `max_instance_count` | `1` | Limite supérieure de l'autoscaling. |
| `container_port` | `8000` | Port de gunicorn. |
| `execution_environment` | `gen2` | Environnement d'exécution Cloud Run. |
| `timeout_seconds` | `300` | Durée maximale de la requête. |
| `enable_cloudsql_volume` | `false` | Connexion via IP privée TCP au lieu du socket Auth Proxy. |
| `container_protocol` | `http1` | HTTP/1.1. |
| `cpu_always_allocated` | `true` | Requis pour le sidecar `qcluster`. |
| `enable_background_worker` | `true` | Exécute le sidecar `qcluster`. |
| `worker_cpu_limit` / `worker_memory_limit` | `1000m` / `1Gi` | Ressources du sidecar. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Entrée publique par défaut. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via VPC. |
| `enable_iap` | `false` | Exiger la connexion Google. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres InvenTree supplémentaires (`INVENTREE_*`). Fusionnés sur les valeurs par défaut du module, donc une clé ici l'emporte — ne pas écraser `INVENTREE_AUTO_UPDATE`, `INVENTREE_DATA_DIR` ou `INVENTREE_DB_ENGINE`. |
| `secret_environment_variables` | `{}` | Mappage de var d'env → nom de secret Secret Manager. |
| `protect_sensitive_environment_variables` | `true` | Déplace les clés nommées credential de `environment_variables` vers Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter pour la production. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Scripts SQL personnalisés et nommage NFS {#group-9--custom-sql-scripts--nfs-naming}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécute du SQL à partir d'un bucket GCS après le
provisionnement (vérifié de bout en bout sur ce module, exécuté en tant
qu'utilisateur de l'application). `nfs_instance_name` / `nfs_instance_base_name`
sélectionnent le serveur NFS ; laissez-les à leurs valeurs par défaut pour
utiliser le serveur Services_GCP. Voir [App_CloudRun](App_CloudRun.md).

### Groupe 10 — Équilibreur de charge, CDN et rétention d'images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner le LB HTTPS global + WAF Cloud Armor. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour le LB HTTPS. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend du LB HTTPS (nécessite Cloud Armor). |
| `max_images_to_retain` | `7` | Nettoyage des révisions/images. |
| `delete_untagged_images` / `image_retention_days` | `true` / `30` | Sans effet dans un déploiement Services_GCP — la propre politique du registre partagé s'applique. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer les buckets dans `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | La définition de ceci **remplace** la liste — l'ajout d'un bucket détruit le bucket `data` par défaut. |
| `enable_nfs` | `false` | Monter NFS dans le service, les jobs et le sidecar. Définissez `true` pour persister le répertoire de données. |
| `nfs_mount_path` | `/var/lib/inventree` | Définir sur `/home/inventree/data` lorsque `enable_nfs = true`. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse (nécessite gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | InvenTree est configuré pour MySQL. |
| `db_name` / `db_user` | `inventree` | Préfixé par le locataire au moment du déploiement. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16-64). Ne pas modifier sur un déploiement en cours. |
| `enable_auto_password_rotation` | `false` | Rotation automatisée du mot de passe. |
| `db_host_env_var_name` | `DB_IP` | Nom supplémentaire pour l'IP privée de la base de données ; redondant, car `DB_IP` est toujours injecté. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser la chaîne intégrée `db-init` → `migrate`. Une liste non vide la remplace entièrement. |
| `cron_jobs` | `[]` | Pas de tâches récurrentes planifiées par la plateforme par défaut — la propre planification d'InvenTree s'exécute dans le sidecar `qcluster`. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `GET /`, 30 s de délai, 15 s de période, 60 tentatives | Une longue fenêtre pour un premier démarrage à froid. |
| `liveness_probe` | HTTP `GET /`, 60 s de délai, 30 s de période, 3 tentatives | Correspond au test de santé de l'image du fournisseur (la racine du document). |
| `uptime_check_config` | `{ enabled = false, path = "/" }` | Test de disponibilité Cloud Monitoring — désactivé par défaut. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 21 — Redis {#group-21--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | InvenTree n'est pas connecté à Redis par ce module. |
| `redis_host` / `redis_port` | `""` / `6379` | Point de terminaison Redis. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` du numéro de projet du service — celle qu'InvenTree accepte. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (sensible) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (`db-init`, `migrate`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration
> via le moteur de fondation [App_CloudRun](App_CloudRun.md), qui valide les
> valeurs *et les combinaisons* au moment du plan. Une configuration invalide
> fait échouer le **plan** avec une erreur claire et nommée avant la création
> de toute ressource, de sorte que la plupart des erreurs ci-dessous sont
> détectées en amont plutôt qu'au moment de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `enable_nfs` / `nfs_mount_path` | `true` / `/home/inventree/data` | **Critique** | Avec les valeurs par défaut (`false` / `/var/lib/inventree`), le répertoire de données est éphémère : les médias téléchargés, les plugins, `config.yaml` et la clé secrète générée sont perdus à chaque démarrage à froid, et une nouvelle clé secrète invalide toutes les sessions et les jetons de réinitialisation de mot de passe. L'activation de NFS au chemin par défaut monte un répertoire qu'InvenTree n'utilise jamais. |
| URL de service utilisée par les personnes | l'URL du numéro de projet (sortie `service_url`) ou un domaine personnalisé | Élevé | L'URL `*.a.run.app` sous forme de hachage renvoie HTTP 500 (`INVE-E7`), car l'hôte ne correspond pas à `INVENTREE_SITE_URL`. |
| `db_name` / `db_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et perd toutes les données d'inventaire. |
| `storage_buckets` | laisser par défaut à moins que vous ne vouliez le remplacer | Élevé | La liste remplace la valeur par défaut — l'ajout d'un bucket détruit le bucket `data` et tout ce qu'il contient. |
| `environment_variables` | ne pas définir `INVENTREE_AUTO_UPDATE=true` | Critique | Réactive les migrations en cours dans les deux conteneurs : une course sur un schéma et une interruption de sonde en pleine migration. Une base de données à moitié migrée ne peut pas être réparée en réexécutant `migrate` (elle échoue avec `Duplicate column name`) — elle doit être supprimée et recréée. |
| `initialization_jobs` | `[]` | Élevé | Toute liste non vide remplace `db-init` → `migrate` ; sans eux, le schéma n'est jamais créé et l'application se ferme au démarrage. |
| `container_image_source` | `custom` | Critique | `prebuilt` déploie l'image de stock sans le point d'entrée du wrapper — pas de mappage `INVENTREE_DB_*`, donc InvenTree ne peut pas atteindre MySQL. |
| `application_version` | un tag exact | Moyen | Épinglez-le sur cette variante ; une épingle définie uniquement dans `InvenTree_Common` est écrasée. |
| `cpu_always_allocated` / `enable_background_worker` | `true` / `true` | Moyen | Avec le CPU basé sur les requêtes, le travailleur est gelé entre les requêtes ; sans le sidecar, aucune tâche en arrière-plan ne s'exécute. Les deux échouent silencieusement. |
| `min_instance_count` | `1` pour la production | Moyen | À `0`, il n'y a pas d'instance, et donc pas de travailleur en arrière-plan, pendant l'inactivité ; la première requête après l'inactivité attend un démarrage à froid. |
| `database_password_length` | Définir une fois | Élevé | Le modifier sur un déploiement en cours fait pivoter le mot de passe sans mettre à jour l'utilisateur de la base de données ; chaque connexion échoue alors jusqu'à ce que `db-init` soit réexécuté. |
| `enable_cloud_armor` | activer pour la production | Moyen | Le service est publiquement accessible sans protection WAF par défaut. |

---

Pour le comportement de la fondation référencé tout au long — identité de
service, mise à l'échelle et concurrence, entrée et équilibrage de charge,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en
miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration
d'application spécifique à InvenTree est décrite dans
**[InvenTree_Common](InvenTree_Common.md)**.

<!-- related-guides -->

## Guides associées {#related-guides}

- [Lab pratique : InvenTree sur Cloud Run](../labs/InvenTree_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [InvenTree Common — Configuration d'application partagée](InvenTree_Common.md) — la couche d'application sur laquelle ce module s'appuie.
