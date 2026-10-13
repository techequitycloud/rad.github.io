---
title: "Langfuse sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Langfuse sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Langfuse_GKE.md @ e69407af sha256:9f69bf181421 -->

# Langfuse sur GKE Autopilot {#langfuse-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Langfuse_GKE.png" alt="Langfuse sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Langfuse est une plateforme open source (licence MIT) d'ingénierie et d'observabilité LLM —
traçage, gestion des invites, évaluations et métriques pour les applications construites sur de grands
modèles de langage. Ce module déploie Langfuse sur **GKE Autopilot** au-dessus de la
fondation [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée de Google Cloud et
Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Langfuse et sur la manière de les explorer et de les exploiter
depuis la Google Cloud Console et la ligne de commande. Pour les mécanismes communs à
toutes les applications GKE — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC Service Controls, sauvegardes et le cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## Ce que coûte Langfuse sur RAD, et comment cela se compare {#what-langfuse-costs-on-rad-and-how-that-compares}

**Le module Langfuse sur GKE Autopilot de RAD coûte environ 136 $ US par mois dans un projet Google Cloud que vous possédez, plus des frais de module uniques de 175 crédits (17,50 $ US).** GKE convient au traçage Langfuse d'un volume élevé et constant d'appels LLM ; le [module Cloud Run](Langfuse_CloudRun.md) exécute le même Langfuse pour environ 167 $ US par mois, avec un coût de calcul permanent légèrement plus élevé mais sans le cluster. Si vous n'en avez besoin qu'occasionnellement, un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits, de sorte que ces 136 $ US deviennent quelques dollars par mois. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 175 crédits (17,50 $ US au prix de la recharge) | 157,5 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **136 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **105 crédits par jour**, soit environ 3150 par mois (environ 315 $ US au prix de la recharge, 252 $ US au tarif du plan Scale) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge unique, et moins pour un plan mensuel. Dans un projet
géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par chaque
application du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième
base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Pod GKE Autopilot, 2x vCPU / 4 GiB | 79,35 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Cloud NAT et réseau | 5,00 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ US |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 $ |
| **Total** | **environ 136 $ US** |

### Comment cela se compare {#how-it-compares}

- **Langfuse Cloud** (Hobby gratuit, Core 29 $/mois, Pro 199 $/mois — [langfuse.com/pricing](https://langfuse.com/pricing)) reste l'option la moins chère pour un volume de traces faible ou modéré ; l'auto-hébergement sur GKE devient rentable une fois que vous dépassez l'allocation de 100 000 unités/90 jours de Core ou que vous avez besoin que les données de traces restent dans votre propre projet.
- Un GCE e2-standard-2 (2 vCPU/8 Go, environ 49 $/mois) est la comparaison auto-gérée de taille plus proche, moins la base de données gérée et la mise à l'échelle horizontale des pods que GKE Autopilot ajoute automatiquement sous charge.
- Ou consultez le [guide Cloud Run](Langfuse_CloudRun.md), qui exécute le même Langfuse sans le cluster.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Langfuse s'exécute dans **un projet géré par RAD pour vous**, vous avez une deuxième option qui
va bien au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du projet et restaurez-le dans les
30 jours pour presque rien.** Cela convient bien mieux à Langfuse dont vous n'avez besoin qu'occasionnellement — un
projet de cours, une démo, une évaluation de courte durée — que de l'exécuter
en continu.

- **Comment ça marche.** La suppression d'un projet géré par RAD dissocie d'abord sa facturation, puis
  demande à Google de supprimer le projet. Google ne supprime pas le projet
  immédiatement : il le conserve, récupérable, pendant 30 jours. Comme la facturation est déjà
  dissociée, rien n'est facturé pendant l'attente. Contrairement à la suppression d'un module, cela ne
  détruit pas Cloud SQL ou le calcul propre à Langfuse un par un — l'ensemble du
  projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours, le
  propriétaire du projet peut le restaurer. RAD demande à Google de récupérer le projet et
  rattache son compte de facturation, puis vous demande d'exécuter **Update** sur chaque
  déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour
  trouve les mêmes ressources déjà présentes — c'est une vérification,
  pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Pour Langfuse
  derrière un petit Services_GCP et Project_GCP, c'est **une poignée de crédits
  (moins de 1 $ US)** au total, contre les 180 crédits que coûte un
  redéploiement complet.
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet que vous apportez et que RAD
  gère uniquement pour la facturation), et vous le restaurez vous-même dans les 30 jours — après
  cela, Google le supprime définitivement. La restauration est admise comme la création d'un nouveau
  projet : votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100
  crédits pour le niveau sandbox qui convient à la plupart des utilisations d'étude et de démo). Google indique que la plupart
  des services sont entièrement fonctionnels dans les 36 heures suivant une restauration.
- **Un véritable manque : le bucket de sauvegarde ne survit pas.** Les sauvegardes nocturnes de Langfuse
  sont écrites dans un bucket à l'intérieur du projet, et ce bucket n'est **pas** protégé
  par la suppression logicielle de Cloud Storage, il est donc très probable qu'il disparaisse dès que vous supprimez
  le projet — même si le projet lui-même est récupérable pendant 30 jours. Si
  vous avez personnalisé Langfuse et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google
  Drive, ou un bucket en dehors du projet) avant de supprimer, comme pour le
  flux de travail de redéploiement ci-dessous. Pour une installation par défaut sans rien d'irremplaçable
  dedans, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

GKE maintient au moins un pod en cours d'exécution, il ne se met donc jamais à l'échelle zéro de lui-même. L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre
propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de
supprimer le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ
  180 crédits (18,00 $ US), car RAD
  recrée le projet et les services partagés avant Langfuse. La suppression permet d'économiser de l'argent
  seulement si Langfuse resterait inutilisé pendant environ quatre jours
  ou plus, à la fois dans votre propre projet (environ 4,55 $ US par jour) et dans
  un projet géré par RAD (105 crédits par jour).
- **Supprimez tout ce que Langfuse utilise.** La majeure partie du coût d'exécution est généralement la base de données. Elle ne s'arrête que lorsque rien d'autre dans le projet ne l'utilise, donc la suppression de Langfuse alors que quelque chose d'autre partage le projet n'économise que la partie calcul de Langfuse.
- **Conservez vos données en premier.** Les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement
  et sont supprimées avec lui, alors copiez la dernière sauvegarde avant de supprimer si vous
  voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session Langfuse pour une classe. Chaque
  participant obtient Langfuse dans son propre projet Google Cloud pendant 15 minutes à 24
  heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places
  à l'avance, soit chaque participant paie pour la sienne. Tout est supprimé à la fin de la
  session, et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute Langfuse pour un client
  à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le
  portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de
  frais inattendus. À la fin de l'engagement, le partenaire transfère le projet
  et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES
et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ;
frais RAD et l'estimation quotidienne de 105 crédits de
[radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer
des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour
la fenêtre de récupération de 30 jours et ce qu'il dit sur les objets Cloud Storage sans
suppression logicielle. [Tarification Langfuse Cloud](https://langfuse.com/pricing). Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Langfuse s'exécute comme une charge de travail web Next.js. Ce module déploie la **ligne v2** (Postgres uniquement) ;
Langfuse v3 nécessite en outre ClickHouse, Redis et S3 et n'est pas couvert ici. Le
déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods Next.js, 2 vCPU / 4 GiB par défaut, mise à l'échelle horizontale automatique |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — Langfuse v2 ne prend pas en charge MySQL ou d'autres moteurs |
| Stockage d'objets | Cloud Storage | Un bucket dédié provisionné automatiquement ; pas de partage NFS (Langfuse n'a pas de mode de stockage de système de fichiers) |
| Secrets | Secret Manager | `NEXTAUTH_SECRET` et `SALT` auto-générés ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé facultatif + certificat géré |

**Valeurs par défaut judicieuses à connaître à l'avance :**

- **Langfuse v2 (Postgres uniquement) est épinglé.** L'image est construite `FROM langfuse/langfuse:2`
  via l'ARG de build `LANGFUSE_VERSION` ; `application_version = "latest"` se résout en `2`.
- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la couche d'application partagée ;
  la sélection de tout autre moteur interrompt le démarrage.
- **`NEXTAUTH_SECRET` et `SALT` sont générés automatiquement** et stockés dans Secret Manager,
  matérialisés dans l'espace de noms et injectés comme variables d'environnement. La validation d'environnement zod de Langfuse
  refuse de démarrer sans les deux — `NEXTAUTH_SECRET` signe les JWT de session, `SALT` hache les clés API.
- **Les migrations Prisma s'exécutent à chaque démarrage.** Le point d'entrée cloud compose `DATABASE_URL` à partir
  des variables `DB_*` injectées, puis passe le relais au démarrage propre de Langfuse, qui exécute
  `prisma migrate deploy`. Le job `db-init` ne crée que le rôle et la base de données.
- **Le premier utilisateur à s'inscrire devient le propriétaire.** `AUTH_DISABLE_SIGNUP = "false"` est injecté ;
  il n'y a pas de crédentiel d'administrateur pré-initialisé.
- **L'affinité de session est `ClientIP` par défaut** afin que les requêtes d'un client atteignent le même pod.
- **Un minimum de 1 réplica est maintenu** (GKE n'a pas de mise à l'échelle à zéro) ; un PodDisruptionBudget maintient
  le service disponible pendant les mises à niveau de nœuds.
- **Pas de Redis.** Langfuse v2 utilise une file d'attente et un cache basés sur PostgreSQL ; `enable_redis` reste
  `false`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres identifiants
sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Langfuse {#a-gke-autopilot--the-langfuse-workload}

Les pods Langfuse sont planifiés sur Autopilot, qui facture le CPU/la mémoire que les pods
demandent réellement. L'autoscaling horizontal des pods dimensionne le déploiement entre le nombre
minimum et maximum de réplicas.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail Langfuse pour voir les pods,
  les révisions et les événements. Kubernetes Engine → Services et Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de charge de travail (Déploiement vs
StatefulSet).

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Langfuse stocke toutes les données d'application (traces, observations, scores, invites, utilisateurs, projets,
clés API) dans une instance gérée de Cloud SQL pour PostgreSQL 15. Les pods y accèdent en privé via
le sidecar **Cloud SQL Auth Proxy** sur un écouteur de bouclage ; aucune adresse IP publique n'est exposée. Lors du
premier déploiement, un job d'initialisation crée le rôle et la base de données de l'application ; Langfuse
applique ensuite son schéma via `prisma migrate deploy` au démarrage.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=langfuse --database=langfuse --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret Manager contenant le mot de passe
sont tous affichés dans les [Sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes automatisées
et la rotation des mots de passe, voir [App_GKE](App_GKE.md).

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** dédié est provisionné automatiquement ; le compte de service de la charge de travail
se voit accorder l'accès. Langfuse v2 conserve toutes les données de trace et d'observabilité dans PostgreSQL ;
le bucket est disponible pour les exportations et les médias. Langfuse n'a pas de mode de stockage de système de fichiers,
donc un partage NFS ne serait jamais écrit.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<bucket>/          # bucket name is in the Outputs
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### D. Secret Manager {#d-secret-manager}

Deux secrets cryptographiques sont générés automatiquement et stockés dans Secret Manager :
`NEXTAUTH_SECRET` (signe les JWT de session) et `SALT` (hache les clés API). Les deux sont matérialisés dans
l'espace de noms via le pilote CSI Secret Store et injectés comme variables d'environnement, et les deux sont requis
au démarrage. Le mot de passe de la base de données est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données se trouve dans les [Sorties](#5-outputs). Voir [App_GKE](App_GKE.md)
pour l'intégration et la rotation du Secret Store CSI.

### E. Réseau et ingress {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe de Cloud Load Balancing. Un
domaine personnalisé avec un certificat géré par Google peut être activé, et une adresse IP statique est réservée
par défaut afin que l'adresse survive aux redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails de l'adresse IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les métriques GKE et Cloud SQL sont acheminées vers Cloud Monitoring.
Des vérifications de disponibilité et des politiques d'alerte facultatives sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Langfuse {#3-langfuse-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job d'initialisation exécute `db-init.sh` en utilisant
  `postgres:15-alpine`. Il se connecte via le proxy d'authentification Cloud SQL et crée de manière idempotente
  le rôle et la base de données de l'application et accorde les privilèges. Il ne crée **pas** de tables — le
  job peut être réexécuté en toute sécurité.
- **Migrations Prisma au démarrage.** Le point d'entrée cloud compose `DATABASE_URL` et délègue au
  démarrage propre de Langfuse, qui exécute `prisma migrate deploy` avant de lancer le serveur.
  La mise à niveau de la version de l'application applique les modifications de schéma sans étape de migration distincte.
- **`NEXTAUTH_SECRET` et `SALT` sont immuables après le premier démarrage.** Ils sont générés une fois et
  écrits dans Secret Manager. La modification de `NEXTAUTH_SECRET` invalide toutes les sessions actives ; la modification
  de `SALT` invalide définitivement toutes les clés API existantes (les clients SDK reçoivent alors `401`). Ne les faites pivoter
  que pendant une fenêtre de maintenance planifiée.
- **Le premier utilisateur est le propriétaire.** Lors de la première visite, la page d'inscription de Langfuse crée le compte initial,
  qui devient le propriétaire de l'instance. Après l'intégration, définissez `AUTH_DISABLE_SIGNUP = "true"`
  dans `environment_variables` pour empêcher toute inscription en libre-service ultérieure.
- **Adresse IP externe pour l'ingestion.** Le `service_type = LoadBalancer` par défaut expose une adresse IP externe
  afin que les clients SDK de votre application LLM puissent POSTer des traces. Définissez `NEXTAUTH_URL` sur l'URL externe après que
  l'adresse IP du LoadBalancer ou le domaine personnalisé est attribué :
  ```bash
  kubectl patch deploy <service-name> -n "$NAMESPACE" \
    -p '{"spec":{"template":{"spec":{"containers":[{"name":"langfuse","env":[
      {"name":"NEXTAUTH_URL","value":"https://langfuse.example.com"}
    ]}]}}}}'
  ```
  Ou définissez `environment_variables` dans la configuration du module avant le déploiement.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/` par défaut. Le seuil d'échec large de la sonde de démarrage
  (30 × 15s) s'adapte aux migrations Prisma au premier démarrage.
- **Les déploiements NFS utilisent `Recreate`.** Lorsque NFS est activé et qu'un serveur partagé est découvert,
  `App_GKE` définit la stratégie de mise à jour `Recreate` afin que deux pods ne se disputent jamais le volume partagé
  pendant une mise à jour.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques
ou notables pour Langfuse sont listés ; toutes les autres entrées sont héritées de [App_GKE](App_GKE.md)
avec son comportement standard et ses valeurs par défaut.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails auxquels sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources pour le suivi des coûts/de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `langfuse` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Langfuse Helpdesk` | Nom lisible par l'homme affiché dans la Console. **Clone-rot connu dans la source** (copié d'un modèle d'application de support) — à remplacer par `"Langfuse"` pour un déploiement réel. |
| `application_description` | `Langfuse Open-source Helpdesk on GKE Autopilot` | Brève description. Même clone-rot que `application_display_name` — à remplacer pour un déploiement réel. |
| `application_version` | `2` | Tag de l'image Langfuse. Épinglé à la ligne v2 (Postgres uniquement). |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | Langfuse construit une image wrapper légère à partir de `langfuse/langfuse:2`. |
| `container_resources` | `{ cpu_limit = "2000m", memory_limit = "4Gi" }` | Limites et requêtes CPU/mémoire ; minimum 2 GiB de mémoire. |
| `min_instance_count` | `1` | Réplicas minimum ; GKE n'a pas de mise à l'échelle à zéro. |
| `max_instance_count` | `5` | Réplicas maximum (limite supérieure HPA). |
| `container_port` | `3000` | Langfuse (Next.js) écoute sur le port 3000. |
| `timeout_seconds` | `300` | Durée maximale de réponse du pod backend (0–3600 secondes). |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Langfuse dans Artifact Registry avant le déploiement. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Ne définissez pas `NEXTAUTH_SECRET`, `SALT` ou `DATABASE_URL` ici. Définissez `AUTH_DISABLE_SIGNUP = "true"` ici après l'intégration. |
| `secret_environment_variables` | `{}` | Mappage de var d'env → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service Kubernetes est exposé. |
| `workload_type` | `Deployment` (auto) | `Deployment` (sans état par défaut) ou `StatefulSet`. |
| `session_affinity` | `ClientIP` | Routage persistant pour que les requêtes d'un client atteignent le même pod. |
| `network_tags` | `["nfsserver"]` | Tags réseau de nœud/pod ; `nfsserver` est requis lorsque `enable_nfs = true`. |
| `termination_grace_period_seconds` | `60` | Secondes à attendre après SIGTERM avant SIGKILL. |
| `enable_network_segmentation` | `false` | Créer des ressources Kubernetes NetworkPolicy. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` (auto) | Activer les modèles PVC. Non recommandé — Langfuse stocke tout l'état dans PostgreSQL. |
| `stateful_pvc_size` | `10Gi` | Taille de stockage PVC par pod. |
| `stateful_pvc_mount_path` | `/data` | Chemin de montage du conteneur pour le PVC. |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass pour les PVC. |
| `stateful_headless_service` | `null` (auto) | Créer un service sans tête pour des noms DNS de pod stables. |
| `stateful_pod_management_policy` | `null` (`OrderedReady`) | Ordre de création des pods. |
| `stateful_update_strategy` | `null` (`RollingUpdate`) | Stratégie de mise à jour. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Créer un Kubernetes ResourceQuota dans l'espace de noms. |
| `quota_cpu_requests` / `quota_cpu_limits` | `""` | Requêtes/limites CPU totales sur tous les pods. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | Requêtes/limites de mémoire totales (suffixe binaire, par exemple `4Gi`). |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protéger la disponibilité pendant les mises à niveau de nœuds. |
| `pdb_min_available` | `1` | Nombre minimum de pods disponibles pendant les interruptions volontaires. |
| `enable_topology_spread` | `false` | Répartir les pods uniformément entre les zones. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/`, délai de 60s, fenêtre d'échec de 30 × 15s | Sonde de démarrage. Couvre les migrations Prisma au premier démarrage. |
| `liveness_probe` | HTTP `/`, délai de 60s | Sonde de vivacité. |
| `startup_probe_config` / `health_check_config` | HTTP `/`, sondes d'infrastructure de niveau App_GKE | Sondes structurées. |
| `uptime_check_config` | désactivé, chemin `/` | Vérification de disponibilité facultative de Cloud Monitoring. |
| `alert_policies` | `[]` | Politiques d'alerte métrique facultatives. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | CronJobs Kubernetes planifiés. |
| `additional_services` | `[]` | Sidecar ou services d'aide déployés avec Langfuse. |

### Groupe 12 — Intégration CI/CD et GitHub {#group-12--cicd--github-integration}

Intégration standard App_GKE Cloud Build / Cloud Deploy — voir [App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`, `github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Laisser désactivé : Langfuse n'a pas de mode de stockage de système de fichiers, donc le partage n'est jamais utilisé, et un serveur NFS inaccessible bloquerait le démarrage. |
| `nfs_mount_path` | `/opt/langfuse/storage` | Chemin de montage à l'intérieur du conteneur. |
| `nfs_volume_name` | `nfs-data-volume` | Nom du volume pour le montage NFS. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer des buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets à provisionner. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse via le pilote CSI. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 15 — Cache et file d'attente Redis {#group-15--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Langfuse v2 utilise une file d'attente et un cache basés sur PostgreSQL — laisser `false`. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Utilisé uniquement si externalisation vers Redis. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — Langfuse nécessite PostgreSQL 15+. |
| `application_database_name` | `langfuse` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `application_database_user` | `langfuse` | Utilisateur de la base de données de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |
| `rotation_propagation_delay_sec` | `90` | Secondes à attendre après la rotation avant de redémarrer les pods. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter à 30–90 pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécuter du SQL à partir d'un bucket GCS après le provisionnement. Voir
[App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner Ingress pour les noms d'hôte personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |

### Groupe 20 — Proxy conscient de l'identité (IAP) {#group-20--identity-aware-proxy-iap}

> **Attention :** L'activation d'IAP nécessite une authentification d'identité Google pour **toutes** les requêtes entrantes,
> y compris l'ingestion de traces SDK. N'activez IAP que lorsque l'ingestion publique n'est pas nécessaire.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger une connexion Google devant Langfuse. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque IAP est activé (sensible). |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attacher une politique Cloud Armor (WAF) au backend Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à un accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la politique. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend Ingress de GKE. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode de simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Carte des ClusterIP pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Langfuse. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via le proxy d'authentification) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'importation (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration via le moteur de base [App_GKE](App_GKE.md), qui valide les valeurs *et les combinaisons* au moment de la planification — un réplica en lecture sans son primaire, IAP sans identités autorisées, un runtime `gen1` avec des montages NFS/GCS, un `database_type` qui ne correspond pas à une extension activée, un `redis_port`/`backup_retention_days` hors de portée. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant qu'aucune ressource ne soit créée, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `NEXTAUTH_SECRET` (auto-généré) | Ne jamais faire pivoter après le premier démarrage | Critique | Le faire pivoter invalide toutes les sessions actives, forçant une reconnexion immédiate pour tout le monde. |
| `SALT` (auto-généré) | Ne jamais faire pivoter après le premier démarrage | Critique | Le faire pivoter invalide de manière permanente toutes les clés API existantes — chaque client SDK les utilisant obtient `401` jusqu'à ce qu'elles soient renouvelées. |
| `application_database_name` / `application_database_user` | Définir une seule fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données de trace. |
| `application_version` | `2` (ligne v2) | Critique | Une balise v3 pointe la build vers une image nécessitant ClickHouse + Redis + S3 que ce module ne provisionne pas — le pod ne démarre pas. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans sauvegarde valide fait échouer le job d'importation. |
| `container_resources.memory_limit` | `4Gi` (≥ 2 Gio) | Élevé | En dessous de 2 Gio, Langfuse subit des OOM-kills lors des migrations de premier démarrage ou sous charge d'ingestion. |
| `session_affinity` | `ClientIP` | Élevé | Sans persistance, les sessions de l'interface utilisateur peuvent rebondir entre les pods. |
| `min_instance_count` | `1` | Élevé | GKE exige min ≥ 1 ; la garde de validation rejette les valeurs invalides. Garder 1 assure que l'ingestion est toujours disponible. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy est requis pour la connectivité PostgreSQL ; sa désactivation est bloquée par une garde de validation au moment de la planification. |
| `AUTH_DISABLE_SIGNUP` (`"false"` auto-injecté) | Désactiver après le premier propriétaire | Élevé | Laisser l'inscription ouverte permet à quiconque ayant l'URL de créer un compte. |
| `enable_iap` | uniquement lorsque l'ingestion SDK n'est pas nécessaire | Élevé | IAP bloque toutes les requêtes non authentifiées, y compris l'ingestion de traces SDK. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont des octets et bloquent toute planification de pod dans l'espace de noms. |
| `enable_pod_disruption_budget` | `true` | Moyen | La désactivation permet à GKE d'expulser tous les pods simultanément pendant la maintenance. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload Identity, autoscaling,
ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes, et
mise en miroir d'images — voir **[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Langfuse
partagée avec la variante Cloud Run est décrite dans **[Langfuse_Common](Langfuse_Common.md)**.

## Guides associés {#related-guides}

- [Lab pratique : Langfuse sur GKE Autopilot](../labs/Langfuse_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Langfuse sur Google Cloud Run](Langfuse_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Langfuse Common — Configuration d'application partagée](Langfuse_Common.md) — la configuration partagée par les deux cibles de déploiement.
