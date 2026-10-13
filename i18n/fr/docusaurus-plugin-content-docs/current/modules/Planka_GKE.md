---
title: "Planka sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Planka sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Planka_GKE.md @ e69407af sha256:79aca83f7956 -->

# Planka sur GKE Autopilot {#planka-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Planka_GKE.png" alt="Planka sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Planka est une application de tableau kanban open source, auto-hébergée,
similaire à Trello, avec un backend Node.js (Sails.js) et un frontend React,
utilisée pour la gestion de projets d'équipe et personnels — tableaux, listes,
cartes, dates d'échéance, étiquettes et pièces jointes. Ce module déploie
Planka sur **GKE Autopilot** au-dessus de la fondation
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée
de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Planka et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à chaque application GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## Ce que coûte Planka sur RAD, et comment cela se compare {#what-planka-costs-on-rad-and-how-that-compares}

**L'exécution de Planka dans votre propre projet Google Cloud coûte environ
136,37 $ US/mois en infrastructure, plus des frais de module uniques de 110
crédits RAD** (dimensionnés à 2 vCPU / 4 GiB sur les pods GKE Autopilot). RAD
facture les frais de module une seule fois, au moment du déploiement — jamais
plus lors d'une mise à jour — plus le temps de build mesuré en crédits ;
l'utilisation de Google Cloud elle-même est facturée à votre propre compte de
facturation au prix catalogue de Google. Sur un projet **géré par RAD**, les
mêmes ressources sont mesurées à l'heure en crédits au prix catalogue plus la
marge de RAD — environ 105 crédits/jour — et les frais de module sont 10 %
inférieurs, à 99 crédits. Voir "Mettez-le en pause gratuitement" ci-dessous
pour savoir comment un déploiement Planka géré par RAD peut être arrêté, sans
frais de fonctionnement, jusqu'à ce que vous en ayez à nouveau besoin. (ou
voir le [guide Cloud Run](Planka_CloudRun.md) pour l'option moins chère)

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| Élément | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module | 110 crédits (une fois) | 99 crédits (une fois) |
| Temps de build | ~3-6 crédits, mesuré par minute de build | idem, mesuré en crédits au prix catalogue + marge de RAD |
| Coût de fonctionnement Google Cloud | ~136,37 $ US/mois, facturé à votre propre compte de facturation au prix catalogue de Google | ~105 crédits/jour, mesuré à l'heure au prix catalogue + marge de RAD |

**Coût de fonctionnement par défaut dans votre propre projet**

| Ressource | $ US/mois (prix catalogue Google, us-central1) |
|---|---|
| Pod GKE Autopilot, 2x vCPU / 4 GiB | 79,35 |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 |
| Cloud NAT et réseau | 5 |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 |
| Frais de gestion de cluster GKE\* | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 |
| **Total** | **136,37 $** |

\* Non inclus dans le total ci-dessus — il est partagé entre toutes les
applications GKE exécutées dans le même projet, il est donc de 0 $ si c'est
votre seul cluster GKE.

### Comment cela se compare {#how-it-compares}

- Nous n'avons pas pu vérifier un prix SaaS commercial actuel, directement
  comparable, pour ce projet open source exact, donc la comparaison honnête
  est un serveur auto-géré nu : Hetzner CPX22 (2 vCPU/4 Go, ~24 $/mois), un
  DigitalOcean 2 vCPU/4 Go Droplet (~24 $/mois), ou un GCP Compute Engine
  e2-standard-2 (2 vCPU/8 Go, ~49 $/mois).
- RAD ne prétend **pas** battre un VPS nu sur le prix affiché — ce n'est
  généralement pas le cas. Ce que RAD ajoute pour le même montant ou un
  montant similaire est une base de données gérée, des identifiants détenus
  par Secret Manager, la surveillance et la mise à jour en un clic, dont
  aucun n'est fourni gratuitement par un VPS nu.
- Sur un VPS nu, c'est vous qui appliquez les correctifs de sécurité du
  système d'exploitation/de la base de données, effectuez et testez les
  sauvegardes et renouvelez les certificats ; Cloud SQL géré par RAD, Secret
  Manager et la surveillance gèrent les trois pour vous.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

C'est l'option principale sur un projet **géré par RAD**, et elle est
gratuite pendant la pause. La suppression d'un projet géré par RAD
déliaisonne d'abord sa facturation, puis demande à Google de supprimer le
projet lui-même — la suppression logicielle récupérable de 30 jours de
Google. Contrairement à la suppression d'un seul module, cela ne détruit pas
la base de données, une VM ou la ressource de calcul une par une : l'ensemble
du projet s'arrête simplement, et comme la facturation est déjà déliée, rien
n'est facturé pendant qu'il attend.

La restauration — dans les 30 jours, et uniquement par le propriétaire du
projet — demande à Google de restaurer le projet et de rattacher son compte
de facturation, puis vous demande d'exécuter la mise à jour sur chaque
déploiement pour confirmer que tout est revenu. Parce que rien n'a été
détruit individuellement, cette mise à jour trouve les mêmes ressources déjà
présentes : c'est une vérification, pas une reconstruction, et une mise à
jour ne facture jamais à nouveau les frais de module. L'ensemble de la
restauration ne coûte qu'une poignée de crédits (moins de 1 $ US) en temps de
build pour une chaîne de déploiements typique. Ce qu'il faut : vous devez
être propriétaire du projet (pas seulement faire gérer sa facturation par
RAD), vous devez le restaurer vous-même dans les 30 jours — après cela,
Google le supprime définitivement — et la restauration est admise comme la
création d'un nouveau projet, de sorte que votre solde de crédits achetés
doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox
qui convient à la plupart des utilisations d'étude et de démonstration).
Google indique que la plupart des services fonctionnent à nouveau
complètement dans les 36 heures suivant une restauration.

**Un véritable manque :** les sauvegardes nocturnes sont écrites dans un
bucket à l'intérieur du projet, et ce bucket a la suppression logicielle de
Cloud Storage explicitement désactivée, de sorte que le bucket de sauvegarde
est très probablement supprimé dès que vous supprimez le projet — même si le
projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé
ce déploiement et que vous souhaitez conserver ce travail, copiez une
sauvegarde (vers Google Drive, ou un bucket en dehors du projet) avant de
supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela
n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

L'autre levier, pour un **propre projet** (ou un projet géré par RAD au-delà
de sa fenêtre de restauration de 30 jours), consiste à supprimer Planka
purement et simplement et à le redéployer plus tard. Un redéploiement coûte
à nouveau les frais de module plus les builds — environ **113-116 crédits**
au total pour ce module.

La suppression ne permet d'économiser de l'argent que si Planka devait rester
inutilisé assez longtemps pour compenser ce coût de redéploiement par
rapport à son propre coût de fonctionnement — pour ce module, cela représente
environ 3 jours ou plus d'inactivité, sur la base de son propre coût de
fonctionnement de 136,37 $ US/mois ci-dessus. La majeure partie de ce coût de
fonctionnement est généralement la base de données et toute VM de fichier/cache
partagée, et elles ne s'arrêtent que si rien d'autre dans le projet ne les
utilise, de sorte que la suppression de cette application seule n'économise
que sa propre part de calcul si quelque chose d'autre partage le projet.

**Conservez d'abord les données :** les sauvegardes nocturnes vont dans un
bucket à l'intérieur du déploiement et sont supprimées avec lui, alors
copiez la dernière sauvegarde avant de la supprimer si vous souhaitez la
conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session
  pour une classe. Chaque participant dispose de l'application dans son
  propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite
  fixée par le formateur. Soit le formateur finance toutes les places, soit
  chaque participant paie la sienne. Tout est supprimé à la fin de la
  session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil :** un partenaire
  exécute l'application pour un client à partir d'un portefeuille cloisonné
  qu'il finance, et règle directement avec le client. Si le portefeuille
  devient faible, la facturation est suspendue et les données sont
  conservées, de sorte que personne ne reçoit de frais inattendus. À la fin,
  le partenaire transfère le projet et les déploiements deviennent la
  propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF,
  XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing
Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les
propres frais de RAD et les estimations de crédits quotidiens ; [Resource
Manager : supprimer et restaurer des
projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour les mécanismes de pause/restauration.

## 1. Vue d'ensemble {#1-overview}

Planka s'exécute comme une seule charge de travail web Node.js, servant à la
fois son API et son frontend React à partir d'un seul port. Le déploiement
relie un petit ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pod Node.js, 2 vCPU / 4 GiB par défaut |
| Base de données | Cloud SQL pour PostgreSQL 15 | Le constructeur de requêtes Knex de Planka ne prend en charge aucun autre moteur |
| Stockage d'objets | Cloud Storage | Un bucket `storage` est créé et monté à `/app/data` pour les pièces jointes, les avatars et les arrière-plans |
| Cache & file d'attente | aucun | Planka n'a pas de dépendance Redis ou de file d'attente — les mises à jour en temps réel passent par Socket.io en cours de processus |
| Secrets | Secret Manager | `SECRET_KEY` et `DEFAULT_ADMIN_PASSWORD` — deux secrets réels et fonctionnels — plus le mot de passe de la base de données |
| Ingress | Cloud Load Balancing | Équilibreur de charge externe, IP statique réservée, domaine personnalisé facultatif |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL est le seul moteur pris en charge.** `Planka_Common` corrige
  `database_type = "POSTGRES_15"`.
- **Une build personnalisée légère, pas l'image pré-construite.** Planka a
  besoin d'un point d'entrée cloud pour composer `DATABASE_URL` et dériver
  `BASE_URL`, donc `container_image_source = "custom"` construit `FROM
  ghcr.io/plankanban/planka:<version>` via
  Cloud Build.
- **`DATABASE_URL` est une chaîne de connexion d'autorité URL, mais SSL est
  défini via des variables d'environnement séparées — jamais un paramètre de
  requête `?sslmode=`.** Planka a deux chemins de connexion DB
  indépendants (le CLI de migration et le Sails ORM du serveur en cours
  d'exécution), chacun nécessitant une configuration SSL différente, et
  chacun ignorant un `?sslmode=` intégré à l'URL pour sa propre
  raison non liée. Sur GKE, le sidecar Cloud SQL Auth Proxy écoute sur
  `127.0.0.1` et termine TLS lui-même, de sorte que le point d'entrée ne
  définit **ni** `PGSSLMODE` ni `KNEX_REJECT_UNAUTHORIZED_SSL_CERTIFICATE` pour cette
  connexion en boucle — aucune configuration SSL n'est nécessaire du tout.
  Voir le [guide commun](Planka_Common.md) pour l'explication complète des
  deux chemins et la branche TCP IP privée.
- **Deux secrets d'application réels et fonctionnels.** `SECRET_KEY`
  (signature de session/jeton, requise au démarrage) et `DEFAULT_ADMIN_PASSWORD` (initialise
  le compte administrateur initial au premier démarrage de la base de données
  vide) sont tous deux réellement consommés par Planka. Il n'y a **pas
  d'invite de réinitialisation de mot de passe forcée**, alors changez le mot
  de passe initial immédiatement après le premier déploiement.
- **`workload_type` par défaut à `Deployment`, pas `StatefulSet`.** Planka
  ne conserve aucun état local au-delà de ce qui est déjà dans Cloud SQL.
- **`reserve_static_ip = true`** (remplaçant la valeur par défaut App_GKE de
  `false`). Le point d'entrée cloud dérive `BASE_URL` des
  valeurs `GKE_SERVICE_URL` injectées ; sans IP statique réservée,
  `BASE_URL` peut revenir à un DNS `*.svc.cluster.local` interne
  inaccessible, rompant les liens de pièces jointes et les notifications par
  e-mail.
- **Les pièces jointes persistent par défaut.** Le module monte le bucket
  GCS `storage` au chemin `/app/data` de Planka, qui contient
  tous les types de téléchargement. Si vous activez un PVC de bloc à la place
  (`stateful_pvc_enabled = true`), le montage du bucket est supprimé afin que les deux
  n'entrent jamais en collision.
- **Pas de Redis, pas de NFS.** `enable_redis` et `enable_nfs` sont tous
  deux par défaut à `false` — Planka n'a besoin ni d'un backend
  cache/file d'attente ni d'un partage de système de fichiers POSIX.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis.

### A. GKE Autopilot — la charge de travail Planka {#a-gke-autopilot--the-planka-workload}

- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E 'DB_HOST|DB_IP|BASE_URL'
  ```

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Les pods atteignent la base de données en privé via le sidecar
**cloud-sql-proxy** sur `127.0.0.1`. Lors du premier déploiement, un Job
d'initialisation crée la base de données et le rôle de l'application ; Planka
exécute ensuite ses propres migrations et son amorçage à chaque démarrage de
pod.

- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

### C. Cloud Storage {#c-cloud-storage}

- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~planka"
  ```

### D. Secret Manager {#d-secret-manager}

- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~planka"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

### E. Réseau et ingress {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe Cloud Load
Balancing avec une adresse statique réservée. Le `BASE_URL` de Planka (utilisé
pour les liens de pièces jointes et les notifications par e-mail) est dérivé
de cette adresse — mettez à jour `BASE_URL` explicitement si un domaine
personnalisé est ajouté par la suite.

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

## 3. Comportement de l'application Planka {#3-planka-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job
  d'initialisation exécute `db-init.sh`, créant de manière idempotente le rôle
  et la base de données de l'application (pas besoin de
  `CREATEROLE`/`CREATEDB`).
- **Migrations de schéma et amorçage à chaque démarrage.** Le
  `start.sh` de l'image officielle exécute `node db/init.js` (migrations +
  amorçage) avant de démarrer le serveur.
- **Identifiant d'amorçage administrateur réel — pas de réinitialisation
  forcée.** Planka amorce `admin@example.com` avec le `DEFAULT_ADMIN_PASSWORD` généré
  lors du premier démarrage (base de données vide), sans invite de
  réinitialisation de mot de passe forcée — connectez-vous et changez le mot
  de passe via l'interface utilisateur de Planka rapidement après le
  déploiement.
- **`DATABASE_URL` composé par le point d'entrée cloud.** Construit au
  démarrage du conteneur à partir des valeurs `DB_*` injectées par la
  fondation (le mot de passe est une valeur Secret Manager d'exécution,
  indisponible au moment de la planification). Voir [Planka_Common](Planka_Common.md)
  pour tous les détails.
- **Chemin de santé.** Les sondes de démarrage et de vivacité sont
  configurées via les variables `startup_probe`/`liveness_probe`. Le
  `server/healthcheck.js` de Planka cible le **chemin racine `/`** sans
  authentification, et les variables `startup_probe`/`liveness_probe` de ce
  module sont maintenant correctement par défaut à `path = "/"` pour
  correspondre.
- **Inspecter l'exécution du job :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Planka sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec son comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `planka` | Nom de base des ressources. |
| `application_version` | `latest` | Utilisé comme ARG de build `PLANKA_VERSION`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `custom` | Planka a besoin du wrapper de point d'entrée cloud — conservez `custom`. |
| `container_port` | `1337` | Port par défaut natif de Planka ; le port du conteneur et les sondes doivent correspondre. |
| `min_instance_count` / `max_instance_count` | `0` / `5` | Limites de mise à l'échelle HPA. |
| `container_resources.memory_limit` | `4Gi` | Planka nécessite au moins 2 Gi pour un fonctionnement fiable. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `workload_type` | `null` (→ `Deployment`) | Planka est sans état au niveau du pod. |
| `service_type` | `LoadBalancer` | Application kanban publique — une surcharge `ClusterIP` n'a pas de raison d'être ici. |
| `session_affinity` | `ClientIP` | Routage persistant pour qu'un client reste sur un seul pod. |

### Groupe 14 — Cloud Storage {#group-14--cloud-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `storage_buckets` | un bucket `storage` | Créé et monté automatiquement à `/app/data` (sauf si un PVC de bloc est activé). |
| `gcs_volumes` | `[]` | Non nécessaire pour les téléchargements — le module monte déjà son bucket à `/app/data`. |

### Groupe 16 — Configuration de la base de données {#group-16--database-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — Knex ne prend en charge aucun autre moteur. |
| `application_database_name` / `application_database_user` | `planka` / `planka` | Nom de la base de données PostgreSQL et nom d'utilisateur de l'application. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `/`, délai de 60s | Les sondes réellement appliquées au pod déployé, correspondant maintenant à la cible de santé réelle et non authentifiée de Planka (`server/healthcheck.js`). |
| `startup_probe_config` / `health_check_config` | HTTP `/`, délai de 60s | Valeurs par défaut au niveau de la fondation ; remplacées par `startup_probe`/`liveness_probe` ci-dessus — effectivement inertes. |

### Groupe 13 — NFS {#group-13--nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Non nécessaire — Planka n'a pas d'exigence de système de fichiers POSIX. |

### Groupe 15 — Redis {#group-15--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Planka n'a pas de dépendance de cache/file d'attente. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne un Ingress + certificat géré. |
| `reserve_static_ip` | `true` | Remplace la valeur par défaut App_GKE (`false`) afin que `BASE_URL` se résolve en une adresse réelle et accessible — voir §1. |

---

## 5. Sorties {#5-outputs}

| Sortie | Description |
|---|---|
| `service_name` / `service_url` / `service_external_ip` | Identité et adresse du service Kubernetes. |
| `database_instance_name` / `database_name` / `database_user` / `database_host` / `database_port` | Détails de connexion Cloud SQL. |
| `storage_buckets` | Le bucket `storage` pour les pièces jointes. |
| `kubernetes_ready` | Si la charge de travail a atteint l'état Prêt. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence si erreur |
|---|---|---|---|
| `application_database_name` / `application_database_user` | Défini une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/le rôle et détruit toutes les données. |
| `container_image_source` | `custom` (par défaut) | Élevé | `"prebuilt"` déploie directement l'image officielle, en ignorant le point d'entrée cloud — Planka démarre sans `DATABASE_URL`. |
| Chemin `startup_probe` / `liveness_probe` | `/` (la valeur par défaut du module) | **Élevé** | Correspond à la cible de santé réelle et non authentifiée de Planka (selon `server/healthcheck.js`, un simple GET HTTP vers `/` vérifiant un 200). Si remplacé par un autre chemin, le pod peut ne pas devenir Prêt. |
| `reserve_static_ip` | `true` (déjà la valeur par défaut du module) | Élevé | `false` peut laisser `BASE_URL` pointer vers un DNS `*.svc.cluster.local` interne inaccessible, rompant les liens de pièces jointes et les notifications par e-mail. |
| `DEFAULT_ADMIN_PASSWORD` (secret généré) | Connectez-vous et changez-le immédiatement après le premier déploiement | **Critique** | Planka ne force pas la réinitialisation du mot de passe — toute personne qui obtient le mot de passe initial peut se connecter en tant qu'administrateur indéfiniment jusqu'à ce qu'il soit modifié. |
| `DATABASE_URL` / Configuration SSL | Ne jamais modifier manuellement — contrôlé par le point d'entrée cloud via les variables d'environnement `PGSSLMODE`/`KNEX_REJECT_UNAUTHORIZED_SSL_CERTIFICATE`, PAS un paramètre de requête `?sslmode=` | **Critique** | Planka a deux chemins de connexion DB indépendants avec des mécanismes SSL différents, confirmés par le traçage de la chaîne de dépendance réelle : (1) le CLI de migration (`server/db/knexfile.js`) lit `KNEX_REJECT_UNAUTHORIZED_SSL_CERTIFICATE` ; (2) le Sails ORM du serveur en cours d'exécution (`sails-postgresql` → `machinepack-postgresql`) analyse `DATABASE_URL` avec le `url.parse()` hérité de Node, qui **supprime silencieusement chaque paramètre de requête**, y compris `?sslmode=` — donc un sslmode intégré à l'URL ne fait rien pour le chemin d'exécution. Sans configuration `ssl` explicite, `pg` brut revient à la *variable d'environnement* `PGSSLMODE`, où `require` signifie "chiffrer ET vérifier" (pas "chiffrer uniquement" comme le libpq classique) — seul `PGSSLMODE=no-verify` ignore la vérification du certificat. Le certificat auto-signé de Cloud SQL n'est pas dans le bundle CA de Node, donc tout sauf `no-verify` échoue au démarrage avec `UNABLE_TO_VERIFY_LEAF_SIGNATURE` et le hook Sails `orm` ne se charge jamais. La connexion en boucle GKE (sidecar Cloud SQL Auth Proxy) n'a besoin d'aucune variable définie — le proxy termine déjà TLS. |
| `gcs_volumes` à `/app/data` | Laisser vide | Moyen | Le module monte déjà son bucket `storage` à `/app/data` ; un second montage au même chemin entre en conflit. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont des octets et bloquent toute planification de pod dans l'espace de noms. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Planka
partagée avec la variante Cloud Run est décrite dans
**[Planka_Common](Planka_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Planka sur GKE Autopilot](../labs/Planka_GKE.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [Planka sur Google Cloud Run](Planka_CloudRun.md) — la même application sur Cloud Run, pour quand vous avez besoin de l'autre cible de déploiement.
- [Planka Common — Configuration d'application partagée](Planka_Common.md) — la configuration partagée par les deux cibles de déploiement.
