---
title: "Zitadel sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Zitadel sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Zitadel_GKE.md @ e69407af sha256:9f41a1805b22 -->

# Zitadel sur GKE Autopilot {#zitadel-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Zitadel_GKE.png" alt="Zitadel sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Zitadel est une plateforme open source et cloud-native de gestion des identités et des accès (IAM)
fournissant OpenID Connect, OAuth 2.0, SAML et la gestion des utilisateurs/organisations. Ce
module déploie Zitadel sur **GKE Autopilot** au-dessus de la fondation [App_GKE](App_GKE.md),
qui provisionne et gère l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Zitadel et sur la manière de les explorer et de les exploiter
depuis la Google Cloud Console et la ligne de commande. Pour les mécanismes communs à chaque application GKE — Workload Identity, ingress, autoscaling, CI/CD, Cloud
Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement —
référez-vous au [guide de la fondation App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## Ce que coûte Zitadel sur RAD, et comment cela se compare {#what-zitadel-costs-on-rad-and-how-that-compares}

**L'exécution de pods Zitadel sur GKE Autopilot dans votre propre projet Google Cloud coûte environ 136,37 $/mois en frais Google Cloud**, en plus d'un frais de module RAD unique de 175 crédits facturé une fois au moment du déploiement. Zitadel a besoin d'une base de données PostgreSQL derrière lui, ce qui, avec le pod lui-même, représente les 136,37 $ ci-dessus. Dans un projet géré par RAD, les frais de module tombent à 157,5 crédits (10 % de moins) et le coût d'exécution est mesuré à l'heure en crédits au lieu d'être facturé directement par Google — voir [Mettez-le en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) ci-dessous pour le seul avantage géré par RAD qu'un VPS auto-hébergé ne peut égaler — ou voir le [guide Cloud Run](Zitadel_CloudRun.md) pour l'alternative.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module (unique) | 175 crédits | 157,5 crédits (10 % de moins) |
| Temps de build | ~3-6 crédits par build, dans les deux cas | ~3-6 crédits par build, dans les deux cas |
| Coût d'exécution Google Cloud | 136,37 $/mois, facturé par Google au prix catalogue | ~105 crédits/jour, mesuré au prix catalogue plus la marge de RAD |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Pod GKE Autopilot, 2x vCPU / 4 GiB | 79,35 $ |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ |
| Cloud NAT et réseau | 5,00 $ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 $ |
| **Total** | **136,37 $** |

*Les frais de gestion de cluster GKE sont exclus du total ci-dessus car ils sont partagés entre toutes les applications GKE du projet — 0 $ si c'est la seule, sinon environ 73 $/mois répartis sur le nombre d'applications que vous exécutez.*

### Comment cela se compare {#how-it-compares}

- ZITADEL, le fournisseur derrière ce projet open source, vend également une version Cloud hébergée : sa [page de tarification](https://zitadel.com/pricing) (vérifiée le 8 octobre 2026) liste un niveau gratuit à 0 $/mois pour un maximum de 100 utilisateurs actifs quotidiens et un niveau Pro à 100 $/mois pour un maximum de 25 000 utilisateurs actifs quotidiens, avec un prix personnalisé pour l'Enterprise au-delà.
- Pour un petit déploiement (une poignée d'applications internes, bien en dessous de 100 DAU), le niveau gratuit de ZITADEL Cloud est plus avantageux que le coût d'exécution de 136,37 $/mois de RAD en termes monétaires ; le module de RAD devient plus adapté une fois que vous souhaitez votre propre instance Postgres dédiée, un contrôle total de l'infrastructure, ou une utilisation au-delà du plafond de DAU du niveau gratuit sans facture SaaS récurrente.
- Une alternative VPS nu fonctionne également : un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) à environ 49 $/mois, ou une machine Hetzner/DigitalOcean de taille similaire à environ 24 $/mois, peut auto-héberger Zitadel et Postgres ensemble — moins cher que RAD en termes monétaires, sans aucune des sauvegardes gérées, des correctifs ou de la surveillance fournis par RAD.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

C'est l'avantage principal d'un projet géré par RAD, et il ne coûte rien lorsqu'il est en pause.
La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le
projet purement et simplement — la suppression logicielle récupérable de 30 jours de Google. Contrairement à la suppression d'un module,
cela ne **détruit pas** Cloud SQL, aucune VM, ou la ressource de calcul une par une : l'ensemble
du projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà
déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de restaurer le
projet et de rattacher son compte de facturation, puis vous demande d'exécuter la mise à jour sur chaque déploiement pour
confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve
les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture
jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits (moins de 1 $ US) au total pour une chaîne de déploiement typique de 2-3.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD gère uniquement la facturation), vous devez
le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est
admise comme la création d'un nouveau projet, donc votre solde de crédits achetés doit toujours dépasser le
seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude/démo conviennent). Google dit que la plupart
des services fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a
la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous
supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez
personnalisé Zitadel et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive, ou un bucket
en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable,
cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre façon : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que 30 jours se sont écoulés sur un projet géré par RAD, il n'y a pas de pause gratuite —
la suppression supprime les ressources définitivement, et le retour de Zitadel signifie un redéploiement à partir de
zéro. Cela coûte environ 178-181 crédits (les 175 crédits de frais de module plus un build).

La suppression ne permet d'économiser de l'argent que si Zitadel resterait inutilisé assez longtemps pour compenser ce
coût de redéploiement par rapport à son propre coût d'exécution — pour Zitadel, cela représente environ 4 jours ou plus.
La majeure partie de ce coût d'exécution est généralement la base de données — elle ne s'arrête que si rien d'autre dans le projet ne l'utilise, donc la suppression de cette application alors que quelque chose d'autre partage le projet n'économise que sa propre part de calcul.

Gardez les données en premier : les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui,
donc copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

Sessions de lab, pour la formation : un formateur anime une session pour une classe. Chaque participant dispose de
l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par
le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne.
Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.

Environnements gérés, pour les cabinets de conseil : un partenaire exécute l'application pour un client à partir d'un
portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible,
la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le
partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR,
par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les propres frais de RAD et les estimations de crédits quotidiens ; [documentation de Google sur la suppression/restauration de projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les affirmations de pause/restauration. Prix de ZITADEL Cloud sur [zitadel.com/pricing](https://zitadel.com/pricing), vérifiés le 8 octobre 2026.

## 1. Vue d'ensemble {#1-overview}

Zitadel s'exécute comme une seule charge de travail web Go. Le déploiement relie un ensemble ciblé
de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods Go, 2 vCPU / 4 GiB par défaut, autoscalés horizontalement |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — Zitadel ne prend en charge que PostgreSQL ; MySQL est rejeté au moment de la planification |
| Stockage d'objets | Cloud Storage | Un bucket provisionné automatiquement (utilisation par l'opérateur ; l'état principal réside dans Postgres) |
| Cache et file d'attente | Aucun | Zitadel stocke tout l'état dans PostgreSQL — pas de Redis, pas de file d'attente |
| Secrets | Secret Manager | `ZITADEL_MASTERKEY` auto-généré et mot de passe administrateur initial ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing | LoadBalancer externe avec affinité `ClientIP` ; domaine personnalisé optionnel + certificat géré |

**Valeurs par défaut judicieuses à connaître à l'avance :**

- **PostgreSQL est obligatoire.** `database_type = POSTGRES_15` par défaut ; une garde de validation au moment de la planification
  rejette MySQL et tout moteur non-Postgres. PostgreSQL 13/14 sont également
  acceptés.
- **`ZITADEL_MASTERKEY` est généré automatiquement et immuable.** Il fait exactement 32
  octets et chiffre toutes les données sensibles au repos. **Ne le faites jamais pivoter après le premier démarrage** —
  cela rendrait illisibles les données précédemment chiffrées (secrets client, matériel clé).
- **Zitadel exécute sa propre configuration + migrations.** Le conteneur démarre avec
  `zitadel start-from-init`, qui crée le schéma et applique les migrations
  de manière idempotente au premier démarrage — il n'y a pas de job de migration séparé.
- **Un administrateur de première instance est créé au premier démarrage.** L'organisation `ZITADEL` et l'administrateur
  humain `zitadel-admin` sont initialisés avec un mot de passe généré à partir de Secret Manager
  (`PASSWORDCHANGEREQUIRED = false`), afin que vous puissiez vous connecter immédiatement.
- **HTTP/2 avec TLS terminé en amont.** `ZITADEL_EXTERNALSECURE = true`,
  `ZITADEL_EXTERNALPORT = 443`, `ZITADEL_TLS_ENABLED = false`. Zitadel sert HTTP/2 en clair
  sur 8080 et fait confiance au LoadBalancer GKE pour terminer TLS sur `:443`. Définissez
  `container_protocol = "h2c"` si vous avez besoin d'HTTP/2 de bout en bout pour les clients API gRPC.
- **`ZITADEL_EXTERNALDOMAIN` doit être défini pour l'accès externe.** Sur GKE, le point d'entrée
  le dérive de l'URL de service injectée, qui est l'adresse intra-cluster ; derrière une
  adresse IP externe ou un domaine personnalisé, vous devez remplacer `ZITADEL_EXTERNALDOMAIN` par l'hôte public
  (voir le tableau des pièges) ou l'émetteur OIDC et les redirections de la console échouent.
- **L'affinité de session est `ClientIP`.** Les requêtes du même client restent sur le même
  pod — utile pour le flux de session de l'interface utilisateur de la console.
- **Un minimum de 1 réplica est maintenu** (GKE ne prend pas en charge la mise à l'échelle à zéro) avec
  `max_instance_count = 5` ; une adresse IP externe statique est réservée par défaut afin que l'adresse
  survive aux redéploiements.
- **NFS est désactivé par défaut.** Zitadel conserve tout l'état dans PostgreSQL et n'écrit jamais
  sur le montage (`enable_nfs = false`).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Zitadel {#a-gke-autopilot--the-zitadel-workload}

Les pods Zitadel sont planifiés sur Autopilot, qui facture le CPU/la mémoire que les pods
demandent réellement. L'autoscaling horizontal des pods dimensionne le déploiement entre le nombre
minimum et maximum de réplicas. Un sidecar Cloud SQL Auth Proxy s'exécute à côté du conteneur.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail Zitadel pour voir les pods,
  les révisions et les événements. Kubernetes Engine → Services et Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> -c zitadel --tail=100
  kubectl logs -n "$NAMESPACE" deploy/<service-name> -c zitadel | grep cloud-entrypoint
  ```

Voir [App_GKE](App_GKE.md) pour savoir comment Autopilot, la mise à l'échelle et le type de charge de travail (Déploiement
vs StatefulSet) sont gérés.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Zitadel stocke toutes les données d'application (organisations, utilisateurs, projets, applications,
sessions, clés) dans une instance gérée de Cloud SQL pour PostgreSQL 15. Les pods l'atteignent
privatement via le sidecar **Cloud SQL Auth Proxy** sur `127.0.0.1` ; aucune IP publique n'est
exposée. Lors du premier déploiement, un job d'initialisation crée la base de données de l'application et un
rôle avec `CREATEDB`/`CREATEROLE` ; Zitadel crée ensuite son propre schéma via
`start-from-init`.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT" --filter="name~zitadel"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret Manager contenant le
mot de passe sont tous affichés dans les [Sorties](#5-outputs). Pour le modèle de connexion,
les sauvegardes automatisées et la rotation des mots de passe, voir [App_GKE](App_GKE.md).

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** est provisionné automatiquement (prévention de l'accès public
appliquée), et le compte de service de la charge de travail se voit accorder l'accès. Zitadel conserve son
état principal dans PostgreSQL, de sorte que le bucket est disponible pour l'utilisation par l'opérateur. Des buckets
supplémentaires peuvent être déclarés via `storage_buckets`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<bucket>/          # bucket name is in the Outputs
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### D. Secret Manager {#d-secret-manager}

Deux secrets sont générés automatiquement et stockés dans Secret Manager : `ZITADEL_MASTERKEY`
(chiffre toutes les données au repos) et le mot de passe administrateur initial (initialise l'humain de première instance
au démarrage). Ils sont livrés au pod via le pilote CSI Secret Store. Le
mot de passe de la base de données est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~zitadel"
  # Read the initial admin password to log in the first time:
  gcloud secrets versions access latest \
    --secret="secret-<resource_prefix>-zitadel-admin-password" --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store CSI, et
[Zitadel_Common](Zitadel_Common.md) pour la criticité de la clé maîtresse. Notez que le
CRD GKE SecretSync rejette `__` dans les clés synchronisées — les clés secrètes de Zitadel
(`ZITADEL_MASTERKEY`, `ZITADEL_FIRSTINSTANCE_ORG_HUMAN_PASSWORD`) utilisent des
tirets bas simples et ne sont pas affectées.

### E. Réseau et Ingress {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe de Cloud Load Balancing avec une
adresse statique réservée. Un domaine personnalisé avec un certificat géré par Google peut être
activé. Étant donné que Zitadel sert gRPC + REST sur HTTP/2, définissez `container_protocol = "h2c"`
pour HTTP/2 de bout en bout lorsque cela est requis.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails de l'adresse IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les flux stdout/stderr des pods vers Cloud Logging ; les métriques GKE et Cloud SQL vers Cloud
Monitoring. Des vérifications de disponibilité et des politiques d'alerte facultatives sont disponibles. Les
lignes de journal `[cloud-entrypoint]` affichent le mode SSL de la base de données résolu et le domaine externe.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Zitadel {#3-zitadel-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job d'initialisation exécute `db-init.sh` en utilisant
  `postgres:15-alpine`. Il se connecte via le sidecar Cloud SQL Auth Proxy et
  crée de manière idempotente la base de données de l'application et un rôle avec `LOGIN CREATEDB
  CREATEROLE`, accorde les privilèges sur la base de données et le schéma `public`, puis signale au
  proxy de s'arrêter afin que le pod du job se termine. Le job peut être réexécuté en toute sécurité et ne
  crée **pas** le schéma de Zitadel — Zitadel le fait lui-même.
- **Configuration + migrations au démarrage.** Le conteneur exécute `zitadel start-from-init`, qui
  crée le schéma et applique les migrations de manière idempotente à chaque démarrage. La mise à niveau de la
  version de l'application applique les modifications de schéma sans étape de migration séparée.
- **`ZITADEL_MASTERKEY` est immuable après le premier démarrage.** Il est généré une fois (exactement
  32 octets) et écrit dans Secret Manager. Le modifier rend toutes les données précédemment chiffrées
  illisibles. Ne le touchez que lors d'une migration planifiée et comprise.
- **Administrateur de première exécution.** Connectez-vous avec le nom d'utilisateur `zitadel-admin` (par défaut) et le mot de passe
  de Secret Manager :
  ```bash
  gcloud secrets versions access latest \
    --secret="secret-<resource_prefix>-zitadel-admin-password" --project "$PROJECT"
  ```
  Créez ensuite un véritable administrateur, désactivez ou restreignez le compte initialisé, et configurez vos
  organisations, projets et applications OIDC/SAML dans la console.
- **Le domaine externe doit correspondre à l'hôte du navigateur.** L'émetteur OIDC et les URI de redirection de la console
  sont construits à partir de `ZITADEL_EXTERNALDOMAIN`. Sur GKE, le point d'entrée le dérive de l'URL de service
  injectée (intra-cluster), donc pour l'accès externe, vous **devez** définir
  `ZITADEL_EXTERNALDOMAIN` (via `environment_variables`) sur l'hôte de l'IP du LoadBalancer ou
  le domaine personnalisé — sinon les connexions et l'échange de jetons échouent. Corrigez un
  déploiement en cours si l'IP a été attribuée après le déploiement :
  ```bash
  kubectl set env deploy/<service-name> -n "$NAMESPACE" \
    ZITADEL_EXTERNALDOMAIN=zitadel.example.com
  ```
- **Chemin de santé.** Les sondes de démarrage, de vivacité et de disponibilité ciblent `/debug/healthz` — un
  point de terminaison `200` non authentifié. Prévoyez environ 7 à 8 minutes au premier démarrage pour la configuration + les migrations.
- **Inspecter la configuration / les jobs en cours d'exécution :**
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -c zitadel -- env | grep ZITADEL_
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres
spécifiques ou notables pour Zitadel sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec son comportement standard et ses valeurs par défaut.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail autorisées à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `zitadel` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Zitadel` | Nom lisible par l'homme affiché dans la console. |
| `application_version` | `latest` | Tag d'image Zitadel ; mappé à un tag épinglé (`v2.71.0`) lorsque `latest`. Épinglez explicitement en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | Zitadel est un build personnalisé léger À PARTIR de l'image ghcr — laissez comme `custom`. |
| `container_resources` | `{ cpu_limit = "2000m", memory_limit = "4Gi" }` | CPU/mémoire par pod. |
| `container_port` | `8080` | Zitadel sert gRPC + REST sur HTTP/2 sur 8080. |
| `container_protocol` | `http1` | Définissez `h2c` pour HTTP/2 de bout en bout pour les clients API gRPC. |
| `min_instance_count` | `1` | Réplicas minimum ; GKE maintient ≥ 1 (pas de mise à l'échelle à zéro). |
| `max_instance_count` | `5` | Réplicas maximum ; peut être augmenté en toute sécurité — tout l'état est dans PostgreSQL. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy (gardez `true` sur GKE). |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image construite dans Artifact Registry. |
| `timeout_seconds` | `300` | Durée maximale de la requête. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres `ZITADEL_*` supplémentaires — définissez `ZITADEL_EXTERNALDOMAIN` ici pour l'accès externe. Les valeurs principales de la base de données/TLS/clé maîtresse sont définies automatiquement. |
| `secret_environment_variables` | `{}` | Mappage de var d'environnement → nom de secret Secret Manager (évitez `__` dans les clés). |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation. **N'activez pas la rotation de la clé maîtresse.** |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | LoadBalancer externe pour la console et les points de terminaison OIDC. |
| `workload_type` | `null` → Déploiement | Déploiement sans état ; Zitadel conserve tout l'état dans PostgreSQL. |
| `session_affinity` | `ClientIP` | Routage persistant pour le flux de session de l'interface utilisateur de la console. |
| `namespace_name` | `""` (auto-généré) | Espace de noms Kubernetes pour la charge de travail. |
| `termination_grace_period_seconds` | `60` | Secondes à attendre après SIGTERM avant SIGKILL. |
| `enable_network_segmentation` | `false` | Créer des ressources Kubernetes NetworkPolicy. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` (désactivé) | Non nécessaire — Zitadel stocke tout l'état dans PostgreSQL, pas sur disque. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protéger la disponibilité pendant les mises à niveau de nœuds. |
| `pdb_min_available` | `1` | Nombre minimum de pods disponibles pendant les interruptions volontaires. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/debug/healthz`, délai de 60s | Sonde de démarrage. Prévoir environ 7 à 8 minutes au premier démarrage. |
| `liveness_probe` | HTTP `/debug/healthz`, délai de 60s | Sonde de vivacité. |
| `uptime_check_config` | _(défini)_ | Vérification de disponibilité Cloud Monitoring facultative. |
| `alert_policies` | `[]` | Politiques d'alerte métrique facultatives. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | Non utilisé — Zitadel n'a pas de tâches récurrentes planifiées par la plateforme. |
| `additional_services` | `[]` | Services sidecar ou auxiliaires (aucun requis pour Zitadel). |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Désactivé par défaut : Zitadel est entièrement basé sur PostgreSQL et n'écrit jamais sur le montage. |
| `nfs_mount_path` | `/opt/zitadel/storage` | Chemin de montage à l'intérieur du conteneur (non utilisé). |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer le(s) bucket(s) GCS déclaré(s). |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Un bucket `data` est déclaré par défaut ; étendez la liste pour des buckets supplémentaires. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse via le pilote CSI. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 15 — Redis {#group-15--redis}

Zitadel n'utilise pas Redis (tout l'état est dans PostgreSQL). `enable_redis` est par défaut
`false` et doit être désactivé ; les entrées `redis_*` sont inertes pour ce module.

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | PostgreSQL uniquement (13/14/15). MySQL est rejeté au moment de la planification. |
| `application_database_name` | `zitadel` | Nom de la base de données de l'application. Immuable après le premier déploiement. |
| `application_database_user` | `zitadel` | Utilisateur de la base de données de l'application (privilèges `CREATEDB`/`CREATEROLE` accordés). Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré. |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données sans interruption de service. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde Cloud SQL automatisé (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmentez à 30-90 pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner Ingress pour les noms d'hôtes personnalisés + certificat géré (une passerelle avec une IP statique est provisionnée automatiquement). N'oubliez pas de définir `ZITADEL_EXTERNALDOMAIN` pour qu'il corresponde. |
| `application_domains` | `[]` | Noms d'hôtes à servir. |
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

> **Attention :** L'activation d'IAP nécessite une authentification d'identité Google pour **toutes** les requêtes entrantes,
> y compris les clients OIDC/machine et les points de terminaison de jetons. N'activez IAP que pour une
> console entièrement privée.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google devant Zitadel. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque IAP est activé (sensible). |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attacher une politique Cloud Armor (WAF) au backend Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à un accès privilégié. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend GKE Ingress. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de localiser
et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Mappage des ClusterIP pour les services spécifiques à l'étape. |
| `service_external_ip` | IP du LoadBalancer externe (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Zitadel. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via le proxy d'authentification) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | Statut et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration (`db-init`) et d'importation (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | Statut et détails CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | Statut VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et statut CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur de fondation [App_GKE](App_GKE.md), qui valide les valeurs *et les combinaisons* au moment de la planification — un `database_type` non-Postgres, `enable_cloudsql_volume` avec `database_type = NONE`, IAP sans identifiants OAuth, `min_instance_count > max_instance_count`, Redis activé sans hôte résolvable, un `redis_port`/`backup_retention_days` hors de portée, et `quota_memory_*` sans suffixe d'unité binaire. Une configuration invalide échoue la **planification** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'au moment de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `ZITADEL_MASTERKEY` (auto-généré) | Ne jamais faire pivoter après le premier démarrage | Critique | Le faire pivoter rend toutes les données précédemment chiffrées (secrets client, matériel clé) illisibles de manière permanente. |
| `database_type` | `POSTGRES_15` | Critique | Zitadel ne prend en charge que PostgreSQL ; MySQL/autre est rejeté au moment de la planification, et un mauvais moteur interrompt le démarrage. |
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/le rôle et détruit toutes les données d'identité. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activation sans source de sauvegarde valide fait échouer le job d'importation. |
| `ZITADEL_EXTERNALDOMAIN` | Définir sur l'hôte externe | Critique | Sur GKE, il est par défaut l'URL intra-cluster ; pour l'accès externe, vous devez le définir sur l'hôte IP du LoadBalancer ou le domaine personnalisé, sinon l'émetteur OIDC et les redirections de la console échouent et chaque connexion échoue. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy est requis pour la connectivité PostgreSQL ; sa désactivation avec une base de données configurée est bloquée par une garde au moment de la planification. |
| `min_instance_count` | `1` | Élevé | GKE nécessite min ≥ 1 ; la garde de validation rejette les valeurs invalides. Maintenir 1 maintient l'IdP toujours accessible. |
| `enable_iap` | uniquement pour les consoles privées | Élevé | IAP bloque toutes les requêtes non authentifiées, y compris les clients OIDC/machine et les points de terminaison de jetons. |
| `session_affinity` | `ClientIP` | Élevé | Sans persistance, les sessions de l'interface utilisateur de la console peuvent rebondir entre les pods en cours de flux. |
| `container_port` | `8080` | Élevé | Zitadel écoute sur 8080 ; un port non concordant fait que la charge de travail ne devient jamais prête. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers nus sont des octets et bloquent toute planification de pod dans l'espace de noms. |
| `application_version` | Épingler une version | Élevé | `latest` correspond à un tag épinglé aujourd'hui, mais l'épinglage explicite évite les migrations surprises lors du redéploiement. |
| `enable_nfs` | `false` (non utilisé) | Faible | Désactivé par défaut ; Zitadel ne stocke aucun état sur disque, donc l'activer ne fait que gaspiller un montage NFS. |
| `enable_pod_disruption_budget` | `true` | Moyen | La désactivation permet à GKE d'évincer tous les pods simultanément pendant la maintenance. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité des données d'identité. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Zitadel
partagée avec la variante Cloud Run est décrite dans
**[Zitadel_Common](Zitadel_Common.md)**.

<!-- related-guides -->

## Guides connexes {#related-guides}

- [Labo pratique : Zitadel sur GKE Autopilot](../labs/Zitadel_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Zitadel sur Google Cloud Run](Zitadel_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Zitadel Common — Configuration d'application partagée](Zitadel_Common.md) — la configuration partagée par les deux cibles de déploiement.
