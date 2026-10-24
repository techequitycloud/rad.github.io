---
title: "Ghostfolio sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Ghostfolio sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Ghostfolio_GKE.md @ e69407af sha256:df9d816e20c4 -->

# Ghostfolio sur GKE Autopilot {#ghostfolio-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Ghostfolio_GKE.png" alt="Ghostfolio sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ghostfolio est une application open source de gestion de patrimoine sous licence
AGPL pour le suivi de la valeur nette, des portefeuilles d'investissement et de
l'allocation d'actifs sur plusieurs comptes et plateformes de courtage — une
alternative axée sur la confidentialité aux outils commerciaux de suivi de
portefeuille. Ce module déploie Ghostfolio sur **GKE Autopilot** au-dessus de
la fondation [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure
partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Ghostfolio et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — veuillez vous référer au
[guide de la fondation App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## Ce que coûte Ghostfolio sur RAD, et comment cela se compare {#what-ghostfolio-costs-on-rad-and-how-that-compares}

**L'exécution de Ghostfolio dans votre propre projet Google Cloud coûte environ
106,53 $ US/mois en frais Google Cloud, en plus d'un coût de module RAD unique
de 110 crédits** (99 crédits — 10 % de moins — dans un projet géré par RAD).
Ghostfolio est une application open source de gestion de patrimoine pour le
suivi de la valeur nette, des portefeuilles d'investissement et de
l'allocation d'actifs sur plusieurs comptes et plateformes. Si vous déployez
dans un projet géré par RAD, vous pouvez tout mettre en pause gratuitement et
reprendre plus tard — voir "Mettez-le en pause gratuitement" ci-dessous.

*Ghostfolio est également disponible sur Cloud Run — voir le
[guide Cloud Run](Ghostfolio_CloudRun.md) pour l'option à moindre coût ; ce
guide couvre la variante GKE.*

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module | **110 crédits** (une fois) | **99 crédits** (une fois, 10 % de moins) |
| Temps de build | ~3–6 crédits (une fois, par build) | ~3–6 crédits (une fois, par build) |
| Coût d'exécution Google Cloud | ~106,53 $ US/mois, facturé à votre propre compte de facturation Google au prix catalogue | ~92 crédits/jour (~9,20 $ US/jour), mesuré à l'heure au prix catalogue plus la marge de RAD |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | $ US/mois (prix catalogue Google, us-central1) |
|---|---|
| Pod GKE Autopilot, 1 vCPU / 1 GiB | 36,08 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 $ |
| **Total** | **106,53 $ US** |

### Comment cela se compare {#how-it-compares}

- Il n'existe pas de version officielle hébergée/cloud de Ghostfolio pour
  comparer, donc la comparaison honnête se fait avec une infrastructure gérée
  par soi-même, et non avec un SaaS concurrent.
- Un VPS nu dimensionné à environ 1 vCPU / 1 GiB — un Hetzner CPX22 (2 vCPU/4
  Go, ~24 $ US/mois), un DigitalOcean 2 vCPU/4 Go Droplet (24 $ US/mois), ou
  le propre Compute Engine e2-standard-2 de GCP (2 vCPU/8 Go, ~49 $ US/mois)
  — est généralement moins cher que le prix affiché par RAD ; un VPS d'une ou
  deux tailles inférieures le serait encore plus.
- Ce prix inférieur n'inclut pas le temps de l'administrateur : patcher le
  système d'exploitation, faire tourner les sauvegardes de base de données,
  renouveler les certificats TLS et surveiller les temps d'arrêt. Cloud SQL,
  Secret Manager et la surveillance gérés par RAD le font pour vous, ce qui
  est le véritable échange, et non le prix affiché.
- RAD ne prétend pas être moins cher qu'un VPS nu en termes d'argent — ce
  n'est généralement pas le cas. L'intérêt de RAD est ce qui est géré pour
  vous.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Ghostfolio est exécuté dans un **projet géré par RAD**, vous pouvez arrêter
de le payer entièrement sans le détruire. La suppression de ce projet
désassocie d'abord sa facturation, puis demande à Google de supprimer
définitivement le projet — la suppression logicielle récupérable de 30 jours
de Google. Contrairement à la suppression du module Ghostfolio seul, cela ne
détruit pas Cloud SQL, aucune VM ou la ressource de calcul une par une : tout
le projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car
la facturation est déjà désassociée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet,
demande à Google de restaurer le projet et de rattacher son compte de
facturation, puis vous demande d'exécuter une mise à jour sur chaque
déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit
individuellement, cette mise à jour trouve les mêmes ressources déjà présentes
— c'est une vérification, pas une reconstruction, et une mise à jour ne facture
jamais à nouveau les frais de module. Cela ne coûte qu'une poignée de crédits
de temps de build au total — environ 5 à 10 crédits, moins de 1 $ US, pour une
chaîne de déploiement typique de 2 à 3. Les frais de module de 99 crédits ne
sont pas facturés à nouveau.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet que RAD
gère uniquement pour la facturation), vous devez le restaurer vous-même dans
les 30 jours — après cela, Google le supprime définitivement — et la
restauration est admise comme la création d'un nouveau projet, donc votre
solde de crédits achetés doit toujours dépasser le seuil du niveau (100
crédits pour le niveau sandbox que la plupart des utilisations d'étude/démo
conviennent). Google indique que la plupart des services fonctionnent à nouveau
pleinement dans les 36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à
l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud
Storage explicitement désactivée, il est donc très probable qu'il disparaisse
dès que vous supprimez le projet — même si le projet lui-même est récupérable
pendant 30 jours. Si vous avez personnalisé Ghostfolio et que vous souhaitez
conserver ce travail, copiez une sauvegarde (vers Google Drive ou un bucket en
dehors du projet) avant de supprimer. Pour une installation par défaut sans
rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre façon : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Si Ghostfolio se trouve dans votre propre projet (ou si plus de 30 jours se
sont écoulés sur un projet géré par RAD), la façon d'arrêter de payer est de
supprimer le déploiement et de le redéployer plus tard lorsque vous en aurez
à nouveau besoin.

Un redéploiement coûte à nouveau les frais de module, plus les builds :
environ **110 + ~3–6 crédits** (~11,45 $ US) dans votre propre projet, ou
**99 + ~3–6 crédits** sur un projet géré par RAD.

La suppression ne permet d'économiser de l'argent que si Ghostfolio restait
inutilisé suffisamment longtemps pour compenser ce coût de redéploiement par
rapport à son propre coût d'exécution : environ **4 jours ou plus** d'inactivité
dans votre propre projet (par rapport à sa facture Google Cloud d'environ
106,53 $ US/mois), ou **environ 2 jours ou plus** d'inactivité dans un projet
géré par RAD (par rapport à ses ~92 crédits/jour).

La majeure partie du coût d'exécution de Ghostfolio est la base de données et
la VM de fichier/cache partagée. Elles ne s'arrêtent que si rien d'autre dans
le projet ne les utilise, donc la suppression de cette application alors que
quelque chose d'autre partage le projet n'économise que la part de calcul de
cette application sur le total ci-dessus.

Priorité aux données : les sauvegardes nocturnes vont dans un bucket à
l'intérieur du déploiement et sont supprimées avec lui, donc copiez la
dernière sauvegarde avant de supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour
  une classe. Chaque participant obtient l'application dans son propre projet
  Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation
  définie par le formateur. Soit le formateur finance toutes les places, soit
  chaque participant paie la sienne. Tout est supprimé à la fin de la session
  et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil :** un partenaire
  exécute l'application pour un client à partir d'un portefeuille cloisonné
  qu'il finance, et règle directement avec le client. Si le portefeuille
  devient faible, la facturation est suspendue et les données sont conservées,
  afin que personne ne reçoive de frais inattendus. À la fin, le partenaire
  transfère le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF,
  NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing
Catalog ; radmodules.dev/pricing pour les frais propres à RAD et les
estimations de crédits quotidiens ; [documentation de Google sur la
suppression/restauration de projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour les mécanismes de pause/restauration.

## 1. Vue d'ensemble {#1-overview}

Ghostfolio s'exécute comme une charge de travail web NestJS (Prisma ORM). Le
déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | API NestJS + frontend Angular, 1 vCPU / 1 GiB par défaut, autoscalé horizontalement |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — l'ORM Prisma de Ghostfolio ne prend pas en charge MySQL |
| Cache et file d'attente | Redis (**requis**, non optionnel) | Mise en cache des données de marché, sessions et gestion des files d'attente/jobs Bull |
| Secrets | Secret Manager | `ACCESS_TOKEN_SALT` et `JWT_SECRET_KEY` auto-générés ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing | Service `LoadBalancer` externe par défaut ; domaine personnalisé optionnel + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par
  la couche d'application partagée ; l'ORM Prisma de Ghostfolio ne prend pas en
  charge d'autres moteurs.
- **Redis est obligatoire, non optionnel.** Le point de terminaison de santé de
  Ghostfolio vérifie directement la connectivité Redis, de sorte que
  l'application ne signale jamais être saine sans elle.
- **`ACCESS_TOKEN_SALT` et `JWT_SECRET_KEY` sont générés automatiquement** et stockés dans Secret
  Manager. Les deux bloquent le démarrage. La rotation de `ACCESS_TOKEN_SALT` après le
  premier démarrage invalide chaque jeton de sécurité anonyme précédemment
  émis.
- **Pas de compte administrateur pré-rempli.** Le premier visiteur de l'URL
  déployée clique sur "Get Started" et l'application crée un jeton de sécurité
  aléatoire en tant que propriétaire du compte — il n'y a pas de formulaire
  email/mot de passe ou d'assistant de première exécution à compléter.
- **`service_type = "LoadBalancer"` par défaut.** Ghostfolio est une interface utilisateur web
  accessible par navigateur, donc contrairement aux applications internes
  uniquement (bases de données, outils d'administration), elle a besoin d'un
  Service publiquement accessible.
- **Aucun stockage de fichiers/médias en masse n'est provisionné.** `enable_nfs`
  par défaut `false` et `storage_buckets` est toujours vide.
- **`DATABASE_URL` est composé à l'exécution.** La chaîne de connexion Prisma de
  Ghostfolio est un DSN d'autorité d'URL ; sur GKE, le point d'entrée cloud
  utilise la boucle de retour `127.0.0.1` du sidecar cloud-sql-proxy avec `sslmode=disable`
  lorsque `enable_cloudsql_volume = true` (par défaut).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté `gcloud container clusters get-credentials <cluster> --region <region> --project <project>` et que `PROJECT`,
`REGION` et `NAMESPACE` sont définis. Les noms des ressources sont rapportés dans
les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Ghostfolio {#a-gke-autopilot--the-ghostfolio-workload}

Ghostfolio s'exécute comme un déploiement Kubernetes derrière un Service.
Autopilot gère automatiquement le provisionnement des nœuds et le bin-packing.

- **Console :** Kubernetes Engine → Workloads → sélectionnez le déploiement.
- **CLI :**
  ```bash
  kubectl get deployment -n "$NAMESPACE"
  kubectl get pods -n "$NAMESPACE" -o wide
  kubectl describe deployment <deployment-name> -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" -l app=<app-label> --tail=100
  ```

Voir [App_GKE](App_GKE.md) pour la mise à l'échelle, la stratégie de déploiement
et les budgets d'interruption de pod.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Ghostfolio stocke toutes les données d'application dans une instance Cloud SQL
pour PostgreSQL 15 gérée, accessible via un sidecar cloud-sql-proxy écoutant
sur `127.0.0.1`. Lors du premier déploiement, un job d'initialisation crée la base
de données et le rôle de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les drapeaux, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

### C. Redis (requis) {#c-redis-required}

Redis prend en charge la mise en cache des données de marché, les sessions et la
gestion des files d'attente/jobs Bull.

- **CLI :**
  ```bash
  kubectl exec -it -n "$NAMESPACE" <pod-name> -- sh -c 'echo -e "PING\r" | nc $REDIS_HOST $REDIS_PORT'
  # Confirm the pod's injected Redis env vars:
  kubectl exec -n "$NAMESPACE" <pod-name> -- env | grep REDIS
  ```

### D. Secret Manager {#d-secret-manager}

Deux secrets cryptographiques sont générés automatiquement : `ACCESS_TOKEN_SALT` et
`JWT_SECRET_KEY`. Le mot de passe de la base de données est géré séparément par la
fondation et synchronisé dans le cluster via `SecretSync`.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

### E. Réseau et ingress {#e-networking--ingress}

Le Service `LoadBalancer` par défaut expose une IP externe. Un Ingress Kubernetes avec
un domaine personnalisé et un certificat géré peut être ajouté via `enable_custom_domain`.

- **CLI :**
  ```bash
  kubectl get svc -n "$NAMESPACE"
  kubectl get ingress -n "$NAMESPACE"
  ```

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux des conteneurs sont automatiquement acheminés vers Cloud Logging
via l'agent de journalisation GKE ; les métriques sont acheminées vers Cloud
Monitoring.

- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" resource.labels.namespace_name="'"$NAMESPACE"'"' --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Ghostfolio {#3-ghostfolio-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation exécute `db-init.sh` en utilisant `postgres:15-alpine`, créant de manière
  idempotente le rôle, la base de données et les autorisations de
  l'application.
- **Les migrations et le seeding s'exécutent à CHAQUE démarrage de conteneur**,
  dans le même processus que le serveur. Le `docker/entrypoint.sh` en amont exécute `prisma migrate deploy`,
  puis `prisma db seed`, puis démarre le serveur — une migration échouée fait planter
  le conteneur bruyamment au lieu de déployer un pod sain avec une base de
  données vide.
- **`ACCESS_TOKEN_SALT` et `JWT_SECRET_KEY` sont immuables après le premier démarrage.** La
  rotation de `ACCESS_TOKEN_SALT` invalide chaque jeton de sécurité précédemment émis. La
  rotation de `JWT_SECRET_KEY` déconnecte tout le monde.
- **Pas de formulaire de première exécution à remplir.** Le premier visiteur
  crée son propre jeton de sécurité via "Get Started" — aucune étape
  d'amorçage administrateur n'est requise.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `GET /api/v1/health`,
  qui vérifie les connexions à la base de données ET à Redis et renvoie `503`
  jusqu'à ce que les deux soient sains.
- **Inspecter l'exécution du job :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Ghostfolio sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec leur comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `ghostfolio` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Le `ghostfolio/ghostfolio` de Docker Hub publie une vraie balise `latest` — épingler pour des builds reproductibles. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_resources` | `{ cpu_limit="1000m", memory_limit="1Gi" }` | 1 vCPU / 1 GiB est suffisant pour une utilisation typique. |
| `container_port` | `3333` | Le `DEFAULT_PORT` de Ghostfolio. |
| `enable_cloudsql_volume` | `true` | Exécute le sidecar cloud-sql-proxy ; `DB_IP` se résout en `127.0.0.1` et le point d'entrée cloud utilise `sslmode=disable`. |
| `container_image_source` | `custom` | Cloud Build enveloppe l'image `ghostfolio/ghostfolio` pré-construite avec un mince point d'entrée cloud. |

### Groupe 6 — Placement et réseau Kubernetes {#group-6--kubernetes-placement--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Ghostfolio est une interface utilisateur web accessible par navigateur — ne pas passer à `ClusterIP` sans un chemin d'entrée séparé. |
| `namespace_name` | (auto-généré) | Espace de noms Kubernetes. |

### Groupe 15 — Base de données {#group-15--database}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_database_name` | `ghostfolio` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `application_database_user` | `ghostfolio` | Utilisateur de la base de données de l'application. Mot de passe auto-généré dans Secret Manager. |

### Groupe 13 — Jobs et NFS {#group-13--jobs--nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré. Pas de job de migration séparé — les migrations s'exécutent à l'intérieur du conteneur de l'application à chaque démarrage. |
| `enable_nfs` | `false` | Non requis — Ghostfolio n'a pas de stockage de fichiers/médias en masse. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/api/v1/health`, délai de 30s, seuil de 12 échecs | Vérifie la connectivité de la base de données ET de Redis. |
| `health_check_config` | HTTP `/api/v1/health`, délai de 30s, seuil de 3 échecs | Même point de terminaison que la sonde de démarrage. |

### Groupe 21 — Redis {#group-21--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | REQUIS — toujours transférer inconditionnellement, ne jamais conditionner à `redis_host != ""`. |
| `redis_host` | `""` | Point de terminaison Redis. Laisser vide pour utiliser l'adresse IP du serveur NFS. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis (sensible). Aliasé à l'exécution sur la variable d'environnement `REDIS_PASSWORD` de Ghostfolio. |

---

## 5. Sorties {#5-outputs}

Retournées lors d'un déploiement réussi — le moyen le plus rapide de localiser
et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `service_url` | URL de l'application déployée (IP du LoadBalancer, domaine personnalisé ou DNS interne). |
| `namespace` | Espace de noms Kubernetes. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `storage_buckets` | Toujours vide — Ghostfolio n'a pas besoin de stockage de fichiers/médias en masse. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `ACCESS_TOKEN_SALT` (auto-généré) | Ne jamais faire tourner après le premier démarrage | Critique | Le faire tourner invalide chaque jeton de sécurité précédemment émis. |
| `JWT_SECRET_KEY` (auto-généré) | Ne faire tourner que pendant une fenêtre de maintenance | Critique | Le faire tourner invalide toutes les sessions actives. |
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `enable_redis` | `true`, toujours transféré inconditionnellement | Critique | Sans cela, le point de terminaison de santé de Ghostfolio ne signale jamais être sain. |
| `service_type` | `LoadBalancer` | Élevé | Passer à `ClusterIP` sans un chemin d'entrée séparé rend l'application inaccessible depuis l'extérieur du cluster. |
| `enable_cloudsql_volume` | `true` | Élevé | Le désactiver supprime le sidecar proxy, de sorte que `DB_IP` revient à l'IP privée brute et que la branche `sslmode` du point d'entrée cloud ne correspond plus à une connexion en boucle. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activation sans un `backup_uri` valide fait échouer le job d'importation. |

---

Pour le comportement de la fondation référencé tout au long — Workload
Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**.
La configuration d'application spécifique à Ghostfolio partagée avec la
variante Cloud Run est décrite dans **[Ghostfolio_Common](Ghostfolio_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Ghostfolio sur GKE Autopilot](../labs/Ghostfolio_GKE.md) —
  déployez-le étape par étape, avec les écrans de la console et les commandes à
  chaque étape.
- [Ghostfolio sur Google Cloud Run](Ghostfolio_CloudRun.md) — la même
  application sur Cloud Run, lorsque vous avez besoin de l'autre cible de
  déploiement.
- [Ghostfolio Common — Configuration d'application partagée](Ghostfolio_Common.md)
  — la configuration partagée par les deux cibles de déploiement.
