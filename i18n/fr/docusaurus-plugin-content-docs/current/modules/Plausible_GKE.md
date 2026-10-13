---
title: "Plausible Analytics sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Plausible Analytics sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Plausible_GKE.md @ e69407af sha256:328ed778209b -->

# Plausible Analytics sur GKE Autopilot {#plausible-analytics-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Plausible_GKE.png" alt="Plausible Analytics sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Plausible Analytics Community Edition est la principale plateforme d'analyse web
open source, sous licence AGPL-3.0, axée sur la confidentialité — une
alternative légère, sans cookies, conforme au RGPD/CCPA/PECR à Google Analytics
que vous possédez et hébergez entièrement. Ce module déploie Plausible CE sur
**GKE Autopilot** sur la base de la fondation [App_GKE](App_GKE.md), qui
provisionne et gère l'infrastructure partagée de Google Cloud et Kubernetes.

Plausible est une application Elixir/Phoenix avec **deux magasins de données** :
Cloud SQL PostgreSQL 15 ne contient que les comptes et la configuration du site,
et **ClickHouse contient tous les événements analytiques**. ClickHouse est fourni
par le module séparé [ClickHouse_GKE](ClickHouse_GKE.md) et est
**obligatoire** — déployez-le en premier. Il n'y a délibérément **pas de
variante Plausible_CloudRun** : ClickHouse ne peut pas fonctionner sur Cloud
Run, donc cette paire suit le modèle GKE uniquement (comme Supabase et
Temporal).

Ce guide se concentre sur les services cloud que Plausible utilise et sur la
façon de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à chaque application GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## Ce que Plausible coûte sur RAD, et comment cela se compare {#what-plausible-costs-on-rad-and-how-that-compares}

**L'exécution de Plausible dans votre propre projet Google Cloud coûte environ
104,74 $ US/mois en infrastructure, plus des frais de module uniques de 110
crédits RAD** (dimensionnés à 1 vCPU / 0,5 Gio sur les pods GKE Autopilot). RAD
facture les frais de module une seule fois, au moment du déploiement — jamais
plus lors d'une mise à jour — plus le temps de build mesuré en crédits ;
l'utilisation de Google Cloud elle-même est facturée à votre propre compte de
facturation au prix catalogue de Google. Sur un projet **géré par RAD**, les
mêmes ressources sont mesurées à l'heure en crédits au prix catalogue plus la
marge de RAD — environ 92 crédits/jour — et les frais de module sont inférieurs
de 10 %, soit 99 crédits. Voir "Mettre en pause gratuitement" ci-dessous pour
savoir comment un déploiement Plausible géré par RAD peut être arrêté, sans
frais de fonctionnement, jusqu'à ce que vous en ayez à nouveau besoin.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| Élément | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module | 110 crédits (une fois) | 99 crédits (une fois) |
| Temps de build | ~3-6 crédits, mesurés par minute de build | idem, mesurés en crédits au prix catalogue + marge de RAD |
| Coût de fonctionnement Google Cloud | ~104,74 $/mois, facturés à votre propre compte de facturation au prix catalogue de Google | ~92 crédits/jour, mesurés à l'heure au prix catalogue + marge de RAD |

**Coût de fonctionnement par défaut dans votre propre projet**

| Ressource | $/mois (prix catalogue Google, us-central1) |
|---|---|
| Pod GKE Autopilot, 1x vCPU / 0,5 Gio | 34,29 |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 |
| Cloud NAT et réseau | 5 |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 |
| Frais de gestion de cluster GKE\* | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 |
| **Total** | **104,74 $** |

\* Non inclus dans le total ci-dessus — il est partagé entre toutes les
applications GKE exécutées dans le même projet, il est donc de 0 $ si c'est
votre seul cluster GKE.

### Comment cela se compare {#how-it-compares}

- Les créateurs de Plausible vendent également **Plausible Analytics Cloud**,
  dont le niveau le moins cher (Starter) est de **9 $/mois pour un maximum de
  10 000 pages vues mensuelles** — vérifié sur leur page de tarification le 8
  octobre 2026 — passant à 14 $/mois (Growth) et 19 $/mois (Business) à mesure
  que le trafic et le nombre de sites augmentent. L'auto-hébergement ici est un
  coût fixe d'environ 105 $ US/mois (plus le coût de fonctionnement propre du
  module ClickHouse séparé et obligatoire — non inclus dans le total ci-dessus)
  quel que soit le volume de pages vues, il dépasse donc le prix du plan cloud
  une fois que le trafic d'un site dépasse un niveau bas, et n'a jamais besoin
  d'une mise à niveau par la suite.
- Sur un VPS nu, c'est vous qui appliquez les correctifs de sécurité du
  système d'exploitation/de la base de données, effectuez et testez les
  sauvegardes, et renouvelez les certificats ; Cloud SQL géré par RAD, Secret
  Manager et la surveillance gèrent les trois pour vous.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

C'est l'option principale sur un projet **géré par RAD**, et elle est gratuite
pendant la pause. La suppression d'un projet géré par RAD dissocie d'abord sa
facturation, puis demande à Google de supprimer le projet lui-même — la
suppression logicielle récupérable de 30 jours de Google. Contrairement à la
suppression d'un seul module, cela ne détruit pas la base de données, une VM ou
la ressource de calcul une par une : l'ensemble du projet s'arrête simplement,
et comme la facturation est déjà dissociée, rien n'est facturé pendant qu'il
attend.

La restauration — dans les 30 jours, et uniquement par le propriétaire du
projet — demande à Google de restaurer le projet et de rattacher son compte de
facturation, puis vous demande d'exécuter une mise à jour sur chaque
déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit
individuellement, cette mise à jour trouve les mêmes ressources déjà présentes
: c'est une vérification, pas une reconstruction, et une mise à jour ne facture
jamais les frais de module à nouveau. L'ensemble de la restauration ne coûte
qu'une poignée de crédits (moins de 1 $ US) en temps de build pour une chaîne
de déploiements typique. Ce qu'il faut : vous devez être propriétaire du projet
(pas seulement faire gérer sa facturation par RAD), vous devez le restaurer
vous-même dans les 30 jours — après quoi Google le supprime définitivement — et
la restauration est admise comme la création d'un nouveau projet, de sorte que
votre solde de crédits achetés doit toujours dépasser le seuil du palier (100
crédits pour le palier sandbox que la plupart des utilisations d'étude et de
démonstration conviennent). Google indique que la plupart des services
fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.

**Un véritable manque :** les sauvegardes nocturnes sont écrites dans un bucket
à l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud
Storage explicitement désactivée, de sorte que le bucket de sauvegarde est très
probablement parti dès que vous supprimez le projet — même si le projet lui-même
est récupérable pendant 30 jours. Si vous avez personnalisé ce déploiement et
que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google
Drive ou un bucket en dehors du projet) avant de supprimer. Pour une
installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

L'autre levier, pour un **projet propre** (ou un projet géré par RAD au-delà de
sa fenêtre de restauration de 30 jours), consiste à supprimer Plausible
définitivement et à le redéployer plus tard. Un redéploiement coûte à nouveau
les frais de module plus les builds — environ **113-116 crédits** au total pour
ce module.

La suppression ne permet d'économiser de l'argent que si Plausible reste
inutilisé suffisamment longtemps pour compenser ce coût de redéploiement par
rapport à son propre coût de fonctionnement — pour ce module, cela représente
environ 4 jours ou plus d'inactivité, basé sur son coût de fonctionnement de
104,74 $ US/mois mentionné ci-dessus. La majeure partie de ce coût de
fonctionnement est généralement la base de données et toute VM de fichier/cache
partagée, et ils ne s'arrêtent que lorsque rien d'autre dans le projet ne les
utilise, de sorte que la suppression de cette application seule n'économise que
sa propre part de calcul si quelque chose d'autre partage le projet.

**Conserver les données en premier :** les sauvegardes nocturnes vont dans un
bucket à l'intérieur du déploiement et sont supprimées avec lui, donc copiez la
dernière sauvegarde avant de supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour
  une classe. Chaque participant obtient l'application dans son propre projet
  Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation
  définie par le formateur. Soit le formateur finance toutes les places, soit
  chaque participant paie la sienne. Tout est supprimé à la fin de la session
  et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil :** un partenaire exécute
  l'application pour un client à partir d'un portefeuille cloisonné qu'il
  finance, et règle directement avec le client. Si le portefeuille est faible,
  la facturation est suspendue et les données sont conservées, de sorte que
  personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le
  projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF,
  NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing
Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les
propres frais de RAD et les estimations de crédits quotidiens ; [Resource
Manager: delete and restore
projects](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour les mécanismes de pause/restauration.
[https://plausible.io/#pricing](https://plausible.io/#pricing)

## 1. Vue d'ensemble {#1-overview}

Plausible fonctionne comme une charge de travail web Elixir/Phoenix (BEAM) sur
le port 8000. Le déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods Plausible, 1 vCPU par défaut, mise à l'échelle horizontale automatique de 1 à 10 réplicas |
| Base de données de configuration | Cloud SQL pour PostgreSQL 15 | Comptes, sites et paramètres UNIQUEMENT — pas d'événements analytiques |
| Magasin d'événements | ClickHouse ([ClickHouse_GKE](ClickHouse_GKE.md)) | **Obligatoire** — chaque page vue/événement atterrit ici ; déployez-le en premier |
| Secrets | Secret Manager | `SECRET_KEY_BASE` et `TOTP_VAULT_KEY` générés automatiquement ; mot de passe de la base de données ; mot de passe ClickHouse (appartenant à ClickHouse_GKE) |
| Build d'image | Cloud Build + Artifact Registry | Build personnalisé léger À PARTIR de `ghcr.io/plausible/community-edition` |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé facultatif + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **ClickHouse n'est pas facultatif.** Une garde de validation au moment de la
  planification **bloque l'apply lorsque `clickhouse_url` est vide**, et `module_dependency`
  est par défaut `["Services_GCP", "ClickHouse_GKE"]`. Connectez les sorties de ClickHouse_GKE :
  `clickhouse_url` = `clickhouse_internal_endpoint` (même cluster, préféré) ou `clickhouse_endpoint` ;
  `clickhouse_db` = `clickhouse_database` ; `clickhouse_user` = `clickhouse_username` ;
  `clickhouse_password_secret` = `clickhouse_password_secret_id`.
- **Le mot de passe ClickHouse traverse les limites des modules en toute
  sécurité.** Plausible référence le secret Secret Manager *créé par
  ClickHouse_GKE* ; la fondation accorde à l'AS de la charge de travail de
  Plausible `secretAccessor` dessus et l'injecte comme `CLICKHOUSE_PASSWORD`. Aucun mot de
  passe n'apparaît jamais dans les variables Terraform.
- **`application_version = "latest"` est une épingle, pas une étiquette.** CE ne publie **aucune
  étiquette `latest`** sur `ghcr.io/plausible/community-edition` ; le build épingle la version
  connue et stable `v3.2.1` via l'ARG de build spécifique à l'application
  `PLAUSIBLE_VERSION` (la Fondation injecte `APP_VERSION` et gagne cette fusion, d'où
  le nom d'ARG spécifique à l'application).
- **`SECRET_KEY_BASE` et `TOTP_VAULT_KEY` sont générés automatiquement** et stockés
  dans Secret Manager. Les deux doivent rester stables : la rotation de
  `SECRET_KEY_BASE` invalide toutes les sessions et déconnecte tous les
  utilisateurs ; la rotation de `TOTP_VAULT_KEY` rompt tous les appareils 2FA
  enregistrés.
- **L'inscription est ouverte par défaut.** Créez le premier compte à
  `<service URL>/register`, puis définissez `DISABLE_REGISTRATION = "true"` (ou `"invite_only"`) via
  `environment_variables`.
- **Port 8000 ; sondes sur `/api/health`.** Le point de terminaison de santé
  répond sans authentification, de sorte que les sondes de démarrage/vivacité ne
  voient jamais de 401/403.
- **La valeur par défaut fournie est de 512 Mio de mémoire**, pas 1 Gio —
  `container_resources` est par défaut `1000m` / `512Mi` dans ce module (voir
  § 4 ci-dessous), remplaçant la valeur par défaut de 1 Gio de la couche
  partagée. 1 Gio est un seuil recommandé pour l'exécution de BEAM plus la
  file d'attente de jobs Oban en cours de processus que les opérateurs devraient
  augmenter pour la production, et non ce qui est déployé tel quel.
- **Pas de NFS, pas de buckets GCS.** Tout l'état réside dans PostgreSQL et
  ClickHouse.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de
noms et les autres identifiants sont signalés dans les [Sorties](#5-outputs) du
déploiement.

### A. GKE Autopilot — la charge de travail Plausible {#a-gke-autopilot--the-plausible-workload}

Les pods Plausible sont planifiés sur Autopilot, qui facture le CPU/la mémoire
réellement demandés par les pods. L'autoscaling horizontal des pods dimensionne
le déploiement entre les nombres minimum et maximum de réplicas.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge
  de travail Plausible pour voir les pods, les révisions et les événements.
  Kubernetes Engine → Services et Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods -A | grep plausible          # find the namespace and pods
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/"$(kubectl get deploy -n "$NAMESPACE" -o jsonpath='{.items[0].metadata.name}')" --tail=100
  ```

Le point d'entrée enregistre sa configuration composée au démarrage — recherchez
les lignes `[plausible-entrypoint]` affichant l'hôte `DATABASE_URL`, l'hôte ClickHouse et
`BASE_URL`.

### B. Cloud SQL pour PostgreSQL 15 — comptes et configuration {#b-cloud-sql-for-postgresql-15--accounts-and-configuration}

Plausible stocke les comptes, les sites, les objectifs et les paramètres dans
une instance Cloud SQL pour PostgreSQL 15 gérée. Les pods l'atteignent en privé
via le sidecar **Cloud SQL Auth Proxy** — le point d'entrée se connecte toujours
sur TCP `127.0.0.1:5432` (les hôtes de chemin de socket sont convertis en
`127.0.0.1`, car les URL `postgresql://` ne peuvent pas transporter de chemins de
socket). Lors du premier déploiement, un job `db-init` (`postgres:15-alpine`) crée
le rôle et la base de données de l'application ; les propres migrations de
Plausible s'exécutent au démarrage du conteneur.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

**Les événements analytiques ne sont PAS ici.** Si vous interrogez PostgreSQL à
la recherche de pages vues, vous ne trouverez rien — les événements résident
dans ClickHouse.

### C. ClickHouse — le magasin d'événements (via ClickHouse_GKE) {#c-clickhouse--the-event-store-via-clickhouse_gke}

Chaque page vue et événement personnalisé est écrit dans ClickHouse, déployé et
détenu par le module [ClickHouse_GKE](ClickHouse_GKE.md) séparé (un StatefulSet
avec un volume persistant). Plausible se connecte en utilisant le `CLICKHOUSE_DATABASE_URL`
composé ; au premier démarrage, le `db createdb` de CE crée la base de données
d'événements si elle est manquante et `db migrate` applique le schéma
ClickHouse.

- **CLI :**
  ```bash
  kubectl get pods -A | grep clickhouse                 # the ClickHouse workload
  # Ping ClickHouse from inside the cluster (endpoint = the clickhouse_url you wired in):
  kubectl run ch-ping --rm -it --restart=Never --image=curlimages/curl -- \
    curl -s "<clickhouse_url>/ping"                     # expect: Ok.
  # Confirm the composed wiring inside the Plausible pod:
  kubectl exec -n "$NAMESPACE" deploy/<deploy-name> -- env | grep PLATFORM_CLICKHOUSE
  ```

### D. Secret Manager {#d-secret-manager}

Quatre secrets sont importants pour un Plausible en cours d'exécution :

| Secret | Propriétaire | But |
|---|---|---|
| `secret-<prefix>-plausible-secret-key-base` | Plausible_Common | Signature de session Phoenix — **ne jamais faire pivoter** (déconnecte tout le monde) |
| `secret-<prefix>-plausible-totp-vault-key` | Plausible_Common | Chiffre les secrets TOTP 2FA au repos — **ne jamais faire pivoter** (casse tous les 2FA) |
| Secret du mot de passe de la base de données | Fondation App_GKE | Mot de passe de l'utilisateur de l'application Cloud SQL |
| Secret du mot de passe ClickHouse | ClickHouse_GKE | Injecté comme `CLICKHOUSE_PASSWORD` ; l'AS de Plausible se voit accorder `secretAccessor` |

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~plausible"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

### E. Cloud Build et Artifact Registry — l'image personnalisée {#e-cloud-build--artifact-registry--the-custom-image}

L'image est un wrapper léger : `FROM ghcr.io/plausible/community-edition:<tag>` plus le point d'entrée cloud
(`plausible-entrypoint.sh`, pur POSIX `sh` — l'image n'a pas de bash/node/python).
Le point d'entrée encode les identifiants en URL avec un encodeur de pourcentage
purement shell, compose `DATABASE_URL` et `CLICKHOUSE_DATABASE_URL`, revient à
`BASE_URL` pour l'URL de service prédite par la plateforme, puis exécute
`db createdb` + `db migrate` (verrouillé de manière consultative) de CE avant
de `exec` le serveur.

- **CLI :**
  ```bash
  gcloud builds list --project "$PROJECT" --limit 5
  gcloud artifacts docker images list <region>-docker.pkg.dev/$PROJECT/<repo> --include-tags | grep plausible
  ```

Les modifications du point d'entrée sont intégrées à l'image — elles nécessitent
une reconstruction + un redéploiement. Les scripts de job (`create-db-and-user.sh`) sont
montés au moment de l'application — aucune reconstruction n'est nécessaire.

### F. Réseau et ingress {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe Cloud
Load Balancing avec une adresse statique réservée. Un domaine personnalisé avec
un certificat géré par Google peut être activé.

Sur les projets plafonnés en **quota d'adresses IP statiques externes
globales**, définissez `reserve_static_ip = false` et `enable_custom_domain = false`. La valeur par défaut
`enable_custom_domain = true` active la passerelle HTTPS par application (HTTPS nip.io sans
configuration) même sans domaine personnalisé, et la passerelle réserve une IP
statique **globale** ; avec les deux désactivés, le service revient à une IP
LoadBalancer éphémère et ne consomme aucune adresse statique. Le compagnon
[ClickHouse_GKE](ClickHouse_GKE.md) — dont le seul consommateur est Plausible
intra-cluster — peut en outre définir `service_type = "ClusterIP"` pour ne nécessiter aucune
adresse IP externe.

- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT" --filter="name~plausible"
  ```

Définissez `base_url` (ou laissez-le vide pour l'URL prédite par la
plateforme) — il pilote l'extrait de script de suivi que Plausible affiche pour
chaque site et les liens dans ses e-mails.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les flux stdout/stderr des pods vers Cloud Logging ; les métriques GKE et Cloud
SQL vers Cloud Monitoring. Un test de disponibilité facultatif cible
`/api/health`.

- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Plausible {#3-plausible-application-behaviour}

- **Amorçage de la base de données en deux phases.** Le job `db-init` crée
  le rôle et la base de données PostgreSQL (idempotent, peut être réexécuté en
  toute sécurité). Ensuite, à chaque démarrage de conteneur, le point d'entrée
  exécute `db createdb` de CE (crée la base de données d'événements ClickHouse
  si elle est manquante) et `db migrate` (migrations PostgreSQL + ClickHouse,
  verrouillées de manière consultative afin que les réplicas concurrents ne se
  concurrencent pas), avant `exec /entrypoint.sh run`.
- **Échec brutal en cas de ClickHouse manquant.** Si `PLATFORM_CLICKHOUSE_URL` est vide
  lors de l'exécution, le point d'entrée se termine avec le code 1 et une
  erreur explicite nommant la correction (déployer ClickHouse_GKE et définir
  `clickhouse_url`). En pratique, vous ne verrez jamais cela car la validation au
  moment de la planification le détecte en premier.
- **Premier compte via `/register`.** Il n'y a pas d'identifiants pré-remplis.
  Ouvrez `<service URL>/register`, créez le premier compte, ajoutez votre site, et
  Plausible affiche l'extrait de suivi (`<script defer data-domain="yourdomain.com" src=".../js/script.js"></script>`). Après cela, fermez
  l'inscription avec `DISABLE_REGISTRATION = "true"` (ou `"invite_only"`) dans
  `environment_variables` et appliquez via **Mise à jour**.
- **`BASE_URL` est important pour la justesse.** Il pilote l'URL de
  l'extrait et les liens des e-mails. Le point d'entrée le définit par défaut
  sur l'URL de service prédite par la plateforme (`GKE_SERVICE_URL`) ; définissez
  `base_url` explicitement lors de la diffusion derrière un domaine
  personnalisé.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent
  `GET /api/health`, qui n'est pas authentifié par conception et renvoie un corps
  de statut JSON tel que `{"sessions":"ok","postgres":"ok","clickhouse":"ok",...}` — une vérification rapide de bout en
  bout que les deux magasins de données sont accessibles. Ne redirigez pas les
  sondes vers des pages authentifiées (elles renverraient 401/403 et le pod ne
  deviendrait jamais Prêt).
- **Mises à niveau de version.** Définissez `application_version` sur une balise CE
  explicite (par exemple `v3.2.1`) et appliquez ; une nouvelle image est
  construite et les migrations s'exécutent au prochain démarrage.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Plausible sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec son comportement et ses valeurs par défaut
standards.

### Groupe 1 — Projet, identité et ClickHouse {#group-1--project-identity--clickhouse}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |
| `clickhouse_url` | `""` | **Effectivement requis** — le plan est bloqué lorsqu'il est vide. Point de terminaison de base `http(s)://host[:port]` nu, sans identifiants ni chemin : `clickhouse_internal_endpoint` de ClickHouse_GKE (préféré) ou `clickhouse_endpoint`. |
| `clickhouse_password_secret` | `""` | Sortie `clickhouse_password_secret_id` de ClickHouse_GKE. La fondation accorde l'accès à l'AS de la charge de travail et injecte `CLICKHOUSE_PASSWORD`. |
| `clickhouse_db` | `plausible_events_db` | Sortie `clickhouse_database` de ClickHouse_GKE. |
| `clickhouse_user` | `plausible` | Sortie `clickhouse_username` de ClickHouse_GKE. |
| `base_url` | `""` | `BASE_URL` public — pilote l'extrait de suivi et les liens des e-mails. Vide utilise l'URL de service prédite par la plateforme. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `plausible` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Balise d'image CE. `latest` épingle à `v3.2.1` au moment de la construction (CE n'a pas de balise `latest`) ; définissez une balise explicite pour la mise à niveau. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | Conservez `custom` — le point d'entrée de l'image wrapper compose les deux URL de base de données. |
| `container_port` | `8000` | `HTTP_PORT` de Plausible CE. |
| `container_resources` | `1000m` / `512Mi` | CPU/mémoire par pod. Augmentez la mémoire vers le seuil de 1 Gio BEAM+Oban pour la production. |
| `min_instance_count` / `max_instance_count` | `1` / `10` | Limites HPA. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy ; le point d'entrée utilise son écouteur TCP sur `127.0.0.1:5432`. |
| `enable_image_mirroring` | `true` | Mettez en miroir l'image de base dans Artifact Registry avant de construire. |
| `workload_type` | `Deployment` | Plausible est sans état (l'état réside dans Cloud SQL + ClickHouse). |

### Groupe 6 — Cluster GKE, variables d'environnement et secrets {#group-6--gke-cluster-environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires — par exemple `{ DISABLE_REGISTRATION = "true" }` après le premier compte. Ne définissez pas `DATABASE_URL`, `CLICKHOUSE_DATABASE_URL`, `SECRET_KEY_BASE` ou `TOTP_VAULT_KEY` ici. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager. |
| `gke_cluster_name` / `namespace_name` | `""` | Vide découvre automatiquement le cluster Services_GCP / génère automatiquement l'espace de noms. |
| `service_type` | `LoadBalancer` | Comment le service Kubernetes est exposé. |
| `session_affinity` | `None` | Sans état — tout pod peut servir toute requête. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/api/health`, délai de 30s, seuil 30 | Fenêtre généreuse pour les migrations au premier démarrage. |
| `health_check_config` | HTTP `/api/health`, période de 30s, seuil 3 | Sonde de vivacité. |
| `uptime_check_config` | désactivé, `/api/health` | Test de disponibilité Cloud Monitoring facultatif. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré (`postgres:15-alpine` + `create-db-and-user.sh`). |
| `cron_jobs` / `additional_services` | `[]` | CronJobs planifiés / services d'aide. |

### Groupe 15 — Redis {#group-15--redis}

`enable_redis`, `redis_host`, `redis_port`, `redis_auth` sont des **miroirs de
convention inertes** des variables de la Fondation — Plausible n'utilise pas
Redis.

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_database_name` | `plausible` | Nom de la base de données PostgreSQL (préfixé par le locataire par la fondation). Immuable après le premier déploiement. |
| `application_database_user` | `plausible` | Rôle de la base de données de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |

Les groupes 5 (IAP), 7 (sauvegarde/StatefulSet), 8 (ResourceQuota), 9 (SQL/PDB
personnalisé), 12 (CI/CD), 13 (NFS — désactivé), 14 (stockage/registre), 17
(importation de sauvegarde), 19 (domaine personnalisé/IP statique), 21 (Cloud
Armor/CDN) et 22 (VPC-SC/journalisation d'audit) sont des entrées App_GKE
standard — voir [App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen
le plus rapide de localiser et d'explorer les ressources en cours
d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` / `stage_service_cluster_ips` | ClusterIP(s) intra-cluster. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Plausible (ouvrir `/register` ici en premier). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application (magasin de configuration uniquement). |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via le proxy d'authentification) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (vide pour Plausible). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'importation (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Si le cluster/la charge de travail est prêt (réexécuter l'apply si `false` sur un nouveau cluster inline). |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration au moteur de la fondation [App_GKE](App_GKE.md), qui valide les
> valeurs *et les combinaisons* au moment de la planification. De plus, la
> propre garde de validation de `Plausible_GKE` rejette un `clickhouse_url` vide,
> des nombres d'instances `min > max`, IAP sans identifiants OAuth, et un
> sidecar Cloud SQL avec `database_type = "NONE"` — tout cela avant la création de
> toute ressource.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| ClickHouse_GKE `application_version` | Conserver le `24.12-alpine` épinglé | Critique | Remplacer l'épingle ClickHouse par une version non testée a cassé Plausible en amont (plausible/analytics#3855) — les migrations ou les requêtes échouent contre un ClickHouse incompatible. Plausible épingle les versions de ClickHouse pour une raison. |
| `SECRET_KEY_BASE` (généré automatiquement) | Ne jamais faire pivoter | Critique | La rotation invalide chaque session Phoenix — tous les utilisateurs sont déconnectés en même temps. |
| `TOTP_VAULT_KEY` (généré automatiquement) | Ne jamais faire pivoter | Critique | La rotation rend chaque appareil 2FA enregistré inutilisable ; les utilisateurs affectés sont bloqués de la connexion 2FA. |
| `clickhouse_url` | `clickhouse_internal_endpoint` de ClickHouse_GKE | Élevé (bloqué) | Laissé vide, le déploiement est **bloqué au moment de la planification** par la garde de validation — déployez ClickHouse_GKE d'abord et collez sa sortie. Une URL erronée mais non vide échoue à l'exécution (le point d'entrée/les migrations ne peuvent pas atteindre le magasin d'événements). |
| `clickhouse_password_secret` | `clickhouse_password_secret_id` de ClickHouse_GKE | Élevé | Secret manquant ou erroné → `CLICKHOUSE_PASSWORD` est absent et l'authentification ClickHouse échoue ; les pods bouclent en cas de crash lors de la migration. |
| `DISABLE_REGISTRATION` | `"true"` (ou `"invite_only"`) après le premier compte | Moyen | L'inscription reste **ouverte par défaut** — toute personne qui trouve l'URL peut créer un compte sur votre instance d'analyse. |
| `application_version` | `latest` (épingle `v3.2.1`) ou une balise CE explicite | Élevé | CE ne publie pas de balise `latest` ; sans l'épingle, la construction échouerait `MANIFEST_UNKNOWN`. Épinglez des versions explicites en production. |
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/le rôle et orpheline la configuration du compte/site. |
| `container_resources.memory_limit` | `1Gi` | Élevé | En dessous du seuil BEAM + Oban en cours de processus, les pods OOM sous charge ou pendant les migrations. |
| `base_url` | URL de domaine personnalisé si vous en utilisez un | Élevé | Un `BASE_URL` erroné place le mauvais script `src` dans chaque extrait de suivi et rompt les liens des e-mails. |
| Sonde `path` | `/api/health` | Élevé | Rediriger les sondes vers une page authentifiée renvoie 401/403 — le pod ne devient jamais Prêt même si l'application a démarré correctement. |
| `enable_cloudsql_volume` | `true` | Élevé | Le point d'entrée se connecte à `127.0.0.1:5432` via le sidecar Auth Proxy ; le désactiver rompt le chemin PostgreSQL (et est bloqué lorsque `database_type = "NONE"`). |
| `enable_iap` | `false` pour l'analyse publique | Élevé | IAP devant Plausible bloque le script de suivi sur vos sites web — les navigateurs des visiteurs ne peuvent pas POSTER des événements via un mur de connexion Google. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers nus sont des octets et bloquent toute planification de pod dans l'espace de noms. |
| Ordre de destruction | Plausible d'abord, puis ClickHouse | Moyen | Détruire ClickHouse pendant que Plausible est toujours en cours d'exécution laisse les pods boucler en cas de crash contre un magasin d'événements disparu (et la subvention secrète en suspens). |
| `enable_pod_disruption_budget` | `true` | Moyen | La désactivation permet à GKE d'expulser tous les pods simultanément pendant la maintenance. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Plausible
(secrets, point d'entrée, amorçage de la base de données) est décrite dans
**[Plausible_Common](Plausible_Common.md)**, et le magasin d'événements dans
**[ClickHouse_GKE](ClickHouse_GKE.md)**.

<!-- related-guides -->

## Guides connexes {#related-guides}

- [Lab pratique : Plausible Analytics sur GKE Autopilot](../labs/Plausible_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Plausible Common — Configuration d'application partagée](Plausible_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [ClickHouse sur GKE Autopilot](ClickHouse_GKE.md), [PostHog sur GKE Autopilot](PostHog_GKE.md), [Metabase sur GKE Autopilot](Metabase_GKE.md) dans la solution **Product Analytics**.
