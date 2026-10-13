---
title: "Zitadel sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Zitadel sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Zitadel_CloudRun.md @ e69407af sha256:6496318b8fde -->

# Zitadel sur Google Cloud Run {#zitadel-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Zitadel_CloudRun.png" alt="Zitadel sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Zitadel est une plateforme open source et cloud-native de gestion des identités et des accès (IAM)
fournissant OpenID Connect, OAuth 2.0, SAML et la gestion des utilisateurs/organisations. Ce
module déploie Zitadel sur **Cloud Run v2** au-dessus de la fondation [App_CloudRun](App_CloudRun.md),
qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud que Zitadel utilise et sur la manière de les explorer et de les opérer
depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à
chaque application Cloud Run — identité de service, ingress et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## Ce que coûte Zitadel sur RAD, et comment cela se compare {#what-zitadel-costs-on-rad-and-how-that-compares}

**L'exécution de Zitadel sur Cloud Run dans votre propre projet Google Cloud coûte environ 167,44 $/mois en frais Google Cloud**, en plus d'un frais de module RAD unique de 300 crédits facturé une fois au moment du déploiement. Zitadel a besoin d'une base de données PostgreSQL derrière lui et fonctionne en permanence plutôt que de se mettre à l'échelle à zéro, ce qui représente la majeure partie des 167,44 $ ci-dessus. Dans un projet géré par RAD, les frais de module tombent à 270 crédits (10 % de moins) et le coût d'exécution est mesuré à l'heure en crédits au lieu d'être facturé directement par Google — voir [Mettez-le en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) ci-dessous pour le seul avantage géré par RAD qu'un VPS auto-hébergé ne peut pas égaler — ou voir le [guide GKE](Zitadel_GKE.md) si vous préférez l'exécuter sur Kubernetes, qui est également l'option la moins chère pour cette application.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module (unique) | 300 crédits | 270 crédits (10 % de moins) |
| Temps de build | ~3-6 crédits par build, dans les deux cas | ~3-6 crédits par build, dans les deux cas |
| Coût d'exécution Google Cloud | 167,44 $/mois, facturé par Google au prix catalogue | ~77 crédits/jour, mesuré au prix catalogue plus la marge de RAD |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Cloud Run, 2x vCPU / 4 Gio (toujours actif) | 110,42 $ |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ |
| Cloud NAT et réseau | 5,00 $ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ |
| **Total** | **167,44 $** |

### Comment cela se compare {#how-it-compares}

- ZITADEL, le fournisseur derrière ce projet open source, vend également une version Cloud hébergée : sa [page de tarification](https://zitadel.com/pricing) (vérifiée le 8 octobre 2026) liste un niveau gratuit à 0 $/mois pour un maximum de 100 utilisateurs actifs quotidiens et un niveau Pro à 100 $/mois pour un maximum de 25 000 utilisateurs actifs quotidiens, avec un prix personnalisé pour l'Enterprise au-delà.
- Pour un petit déploiement (quelques applications internes, bien en dessous de 100 DAU), le niveau gratuit de ZITADEL Cloud est plus avantageux que le coût d'exécution de 167,44 $/mois de RAD en termes monétaires ; le module de RAD devient plus adapté une fois que vous souhaitez votre propre instance Postgres dédiée, un contrôle total de l'infrastructure, ou une utilisation au-delà du plafond DAU du niveau gratuit sans facture SaaS récurrente.
- Une alternative VPS nue fonctionne également : un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) à environ 49 $/mois, ou une boîte Hetzner/DigitalOcean de taille similaire à environ 24 $/mois, peut auto-héberger Zitadel et Postgres ensemble — moins cher que RAD en termes monétaires, sans aucune des sauvegardes gérées, des correctifs ou de la surveillance que RAD fournit.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

C'est l'avantage principal d'un projet géré par RAD, et il ne coûte rien pendant la pause.
La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le
projet purement et simplement — la suppression logicielle récupérable de 30 jours de Google. Contrairement à la suppression d'un module,
cela ne démolit **pas** Cloud SQL, aucune VM, ou la ressource de calcul une par une : l'ensemble du
projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà
déliée.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de restaurer le
projet et de rattacher son compte de facturation, puis vous demande d'exécuter la mise à jour sur chaque déploiement pour
confirmer que tout est revenu. Parce que rien n'a été détruit individuellement, cette mise à jour trouve
les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture
jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits (moins de 1 $ US) au total pour une chaîne de déploiement typique de 2-3.

Ce qu'il faut : vous devez posséder le projet (pas un que RAD gère uniquement pour la facturation), vous devez
le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est
admise comme la création d'un nouveau projet, donc votre solde de crédits achetés doit toujours dépasser le
seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude/démo conviennent). Google dit que la plupart des
services fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a
la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous
supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez
personnalisé Zitadel et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive, ou un bucket
en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable,
cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que 30 jours se sont écoulés sur un projet géré par RAD, il n'y a pas de pause gratuite —
la suppression supprime les ressources définitivement, et la réactivation de Zitadel signifie un redéploiement à partir de
zéro. Cela coûte environ 303-306 crédits (les frais de module de 300 crédits plus un build).

La suppression ne permet d'économiser de l'argent que si Zitadel devait rester inutilisé assez longtemps pour compenser ce
coût de redéploiement par rapport à son propre coût d'exécution — pour Zitadel, c'est environ 6 jours ou plus.
La majeure partie de ce coût d'exécution est généralement la base de données — elle ne s'arrête que lorsque rien d'autre dans le projet ne l'utilise, donc la suppression de cette application alors que quelque chose d'autre partage le projet n'économise que sa propre part de calcul.

Priorité aux données : les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec celui-ci,
donc copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

Sessions de lab, pour la formation : un formateur anime une session pour une classe. Chaque participant obtient l'
application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le
formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne.
Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.

Environnements gérés, pour les cabinets de conseil : un partenaire exécute l'application pour un client à partir d'un
portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible,
la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le
partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR,
par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les propres frais de RAD et les estimations de crédits quotidiens ; [documentation de Google sur la suppression/restauration de projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les affirmations de pause/restauration. Prix de ZITADEL Cloud sur [zitadel.com/pricing](https://zitadel.com/pricing), vérifiés le 8 octobre 2026.

## 1. Vue d'ensemble {#1-overview}

Zitadel s'exécute comme un conteneur Go unique sur Cloud Run v2. Le déploiement relie un
ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Go, 2 vCPU / 4 Gio par défaut ; HTTP/2 (gRPC + REST) sur le port 8080 |
| Base de données | Cloud SQL pour PostgreSQL 15 | Obligatoire — Zitadel ne prend en charge que PostgreSQL ; MySQL est rejeté au moment de la planification |
| Stockage d'objets | Cloud Storage | Un bucket provisionné automatiquement (utilisation par l'opérateur ; l'état principal réside dans Postgres) |
| Cache et file d'attente | Aucun | Zitadel stocke tout l'état dans PostgreSQL — pas de Redis, pas de file d'attente |
| Secrets | Secret Manager | `ZITADEL_MASTERKEY` et mot de passe administrateur initial générés automatiquement ; mot de passe de la base de données |
| Ingress | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut (publique) ; équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL est obligatoire.** `database_type = POSTGRES_15` par défaut ; une validation
  au moment de la planification rejette MySQL et tout moteur non-Postgres. PostgreSQL 13/14 sont également
  acceptés.
- **`ZITADEL_MASTERKEY` est généré automatiquement et immuable.** Il fait exactement 32
  octets et chiffre toutes les données sensibles au repos. **Ne le faites jamais pivoter après le premier démarrage** —
  cela rendrait les données précédemment chiffrées (secrets client, matériel de clé) illisibles.
- **Zitadel exécute sa propre configuration + migrations.** Le conteneur démarre avec
  `zitadel start-from-init`, qui crée le schéma et applique les migrations
  de manière idempotente au premier démarrage — il n'y a pas de tâche de migration distincte.
- **Un administrateur de première instance est créé au premier démarrage.** L'organisation `ZITADEL` et l'
  administrateur humain `zitadel-admin` sont initialisés avec un mot de passe généré par Secret Manager
  (`PASSWORDCHANGEREQUIRED = false`), afin que vous puissiez vous connecter immédiatement.
- **HTTP/2 avec TLS terminé en amont.** `ZITADEL_EXTERNALSECURE = true`,
  `ZITADEL_EXTERNALPORT = 443`, `ZITADEL_TLS_ENABLED = false`. Zitadel sert HTTP/2 en clair
  sur 8080 et fait confiance à Cloud Run pour terminer TLS sur `:443`. Définissez
  `container_protocol = "h2c"` si vous avez besoin d'HTTP/2 de bout en bout pour les clients API gRPC.
- **`ZITADEL_EXTERNALDOMAIN` est dérivé de l'URL du service.** Le point d'entrée le définit
  à partir de l'hôte `run.app` d'exécution. Derrière un domaine personnalisé, vous devez le remplacer (voir le
  tableau des pièges) ou l'émetteur OIDC et les redirections de la console pointeront vers le mauvais hôte.
- **Ingress public par défaut.** `ingress_settings = "all"` afin que la console et les points de terminaison OIDC
  soient accessibles. L'activation d'IAP place la connexion Google devant tout,
  y compris les clients OIDC/machine.
- **Le service est maintenu actif.** `cpu_always_allocated = true` et `min_instance_count = 1`
  (pas de mise à l'échelle à zéro), de sorte que les points de terminaison de jetons n'ont pas de latence de démarrage à froid ; `max_instance_count = 5`.
- **NFS est désactivé par défaut.** Zitadel conserve tout l'état dans PostgreSQL et n'écrit jamais
  sur un montage NFS, donc `enable_nfs = false`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de services et de ressources sont
signalés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Zitadel {#a-cloud-run--the-zitadel-service}

Zitadel s'exécute comme un service Cloud Run v2 qui s'adapte automatiquement en fonction de la charge de requêtes entre le
nombre minimal et maximal d'instances. Chaque déploiement crée une révision immuable ;
le trafic peut être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~zitadel"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  # Confirm the entrypoint's derived external domain / DB SSL mode:
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50 \
    | grep cloud-entrypoint
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et
la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Zitadel stocke toutes les données d'application (organisations, utilisateurs, projets, applications,
sessions, clés) dans une instance gérée de Cloud SQL pour PostgreSQL 15. Le service se connecte
privément via le **Cloud SQL Auth Proxy** sur un socket Unix ; aucune IP publique n'est
exposée. Lors du premier déploiement, un job d'initialisation crée la base de données de l'application et un
rôle avec `CREATEDB`/`CREATEROLE` ; Zitadel crée ensuite son propre schéma via
`start-from-init`.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT" --filter="name~zitadel"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe se trouvent dans les [Sorties](#5-outputs).
Voir [App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** est provisionné automatiquement (prévention de l'accès public
appliquée). Zitadel conserve son état principal dans PostgreSQL, de sorte que le bucket est disponible pour
l'utilisation par l'opérateur (exportations, actifs). Des buckets supplémentaires peuvent être déclarés via `storage_buckets`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<bucket>/        # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### D. Secret Manager {#d-secret-manager}

Deux secrets sont générés automatiquement et stockés dans Secret Manager : `ZITADEL_MASTERKEY`
(chiffre toutes les données au repos) et le mot de passe administrateur initial (initialise l'administrateur
humain de première instance au démarrage). Le mot de passe de la base de données est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~zitadel"
  # Read the initial admin password to log in the first time:
  gcloud secrets versions access latest \
    --secret="secret-<resource_prefix>-zitadel-admin-password" --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation, et
[Zitadel_Common](Zitadel_Common.md) pour la criticité de la clé maîtresse.

### E. Réseau et ingress {#e-networking--ingress}

Le service est accessible par son URL `run.app` par défaut, ce qui permet l'accès public dont la console et les points de terminaison OIDC ont besoin. Un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peuvent être superposés ; les paramètres d'ingress et le contrôle d'egress VPC contrôlent la connectivité. Étant donné que Zitadel sert gRPC + REST sur HTTP/2, définissez `container_protocol = "h2c"` pour un HTTP/2 de bout en bout si nécessaire.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux de conteneurs sont acheminés vers Cloud Logging ; les métriques Cloud Run et Cloud SQL sont acheminées vers Cloud
Monitoring, avec des vérifications de disponibilité et des politiques d'alerte facultatives. Les lignes de journal
`[cloud-entrypoint]` affichent le mode SSL de la base de données résolu et le domaine externe.

- **Console :** Logging → Logs Explorer ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Zitadel {#3-zitadel-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job d'initialisation exécute `db-init.sh` en utilisant
  `postgres:15-alpine`. Il se connecte via le Cloud SQL Auth Proxy et crée de manière idempotente
  la base de données de l'application et un rôle avec `LOGIN CREATEDB CREATEROLE`, puis
  accorde des privilèges sur la base de données et le schéma `public`. Le job peut être réexécuté en toute sécurité. Il
  ne crée **pas** le schéma de Zitadel — Zitadel le fait lui-même.
- **Configuration + migrations au démarrage.** Le conteneur exécute `zitadel start-from-init`, qui
  crée le schéma et applique les migrations de manière idempotente à chaque démarrage. La mise à niveau de la
  version de l'application applique les modifications de schéma sans étape de migration distincte.
- **`ZITADEL_MASTERKEY` est immuable après le premier démarrage.** Il est généré une fois (exactement
  32 octets) et écrit dans Secret Manager. Le modifier rend toutes les données précédemment chiffrées
  illlisibles. Ne le touchez que lors d'une migration planifiée et comprise.
- **Administrateur de première exécution.** Connectez-vous avec le nom d'utilisateur `zitadel-admin` (par défaut) et le mot de passe
  de Secret Manager :
  ```bash
  gcloud secrets versions access latest \
    --secret="secret-<resource_prefix>-zitadel-admin-password" --project "$PROJECT"
  ```
  Créez ensuite un véritable administrateur, désactivez ou restreignez le compte initial, et configurez vos
  organisations, projets et applications OIDC/SAML dans la console.
- **Le domaine externe doit correspondre à l'hôte du navigateur.** L'émetteur OIDC et la redirection de la console
  Les URI sont construits à partir de `ZITADEL_EXTERNALDOMAIN`. Le point d'entrée le dérive de l'
  URL `run.app` ; derrière un domaine personnalisé, définissez `ZITADEL_EXTERNALDOMAIN` (via
  `environment_variables`) sur cet hôte ou les connexions/échanges de jetons échoueront.
- **Chemin de santé.** Les sondes de démarrage, de vivacité et de disponibilité ciblent `/debug/healthz` — un
  point de terminaison `200` non authentifié. Prévoyez environ 7 à 8 minutes au premier démarrage (délai initial de 60 secondes
  plus une fenêtre de nouvelle tentative d'environ 450 secondes) pour la configuration + les migrations.
- **Inspecter la configuration / les jobs en cours d'exécution :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres
spécifiques ou notables pour Zitadel sont listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails auxquels sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `zitadel` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Zitadel` | Nom lisible par l'homme affiché dans la console. |
| `application_version` | `latest` | Tag d'image Zitadel ; mappé à un tag épinglé (`v2.71.0`) lorsque `latest`. Épinglez explicitement en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner l'infrastructure uniquement. |
| `container_image_source` | `custom` | Zitadel est un build personnalisé léger À PARTIR de l'image ghcr — laisser comme `custom`. |
| `cpu_limit` | `2000m` | CPU par instance ; 2 vCPU recommandés. |
| `memory_limit` | `4Gi` | Mémoire par instance. |
| `container_port` | `8080` | Zitadel sert gRPC + REST sur HTTP/2 sur 8080. |
| `container_protocol` | `http1` | Définir `h2c` pour HTTP/2 de bout en bout vers les clients API gRPC. |
| `min_instance_count` | `1` | Maintenu actif (pas de mise à l'échelle à zéro) afin que les points de terminaison de jetons n'aient pas de démarrage à froid. |
| `max_instance_count` | `5` | Nombre maximal d'instances ; sûr à augmenter — tout l'état est dans PostgreSQL. |
| `cpu_always_allocated` | `true` | Facturation basée sur l'instance ; maintient Zitadel réactif pour le trafic d'authentification. |
| `enable_cloudsql_volume` | `true` | Connexion socket du Cloud SQL Auth Proxy. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image construite dans Artifact Registry. |
| `timeout_seconds` | `300` | Durée maximale de la requête. |

### Groupe 5 — Contrôle d'accès et d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Ingress public pour la console et les points de terminaison OIDC/OAuth. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via VPC. |
| `enable_iap` | `false` | Exiger la connexion Google. **Bloque les clients OIDC/machine** — activer uniquement pour les consoles privées. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres `ZITADEL_*` supplémentaires (par exemple `ZITADEL_EXTERNALDOMAIN`, remplacements d'organisation/administrateur). Les valeurs principales de la base de données/TLS/clé maîtresse sont définies automatiquement. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. **Ne pas activer la rotation de la clé maîtresse.** |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde Cloud SQL automatisé (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 10 — Équilibreur de charge, CDN et rétention d'images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner un équilibreur de charge HTTPS global + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Domaines personnalisés — n'oubliez pas de définir `ZITADEL_EXTERNALDOMAIN` pour qu'il corresponde. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer le(s) bucket(s) GCS déclaré(s). |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Le bucket auto-provisionné ; étendre la liste pour des buckets supplémentaires. |
| `enable_nfs` | `false` | Désactivé par défaut : Zitadel est entièrement basé sur PostgreSQL et n'écrit jamais sur le montage. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse (nécessite gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | PostgreSQL uniquement (13/14/15). MySQL est rejeté au moment de la planification. |
| `db_name` | `zitadel` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `zitadel` | Utilisateur de la base de données de l'application (octroyé `CREATEDB`/`CREATEROLE`). Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré. |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | Non utilisé — Zitadel n'a pas de tâches récurrentes planifiées par la plateforme. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/debug/healthz`, délai de 60s | Sonde de démarrage. Prévoir environ 7 à 8 minutes au premier démarrage. |
| `liveness_probe` | HTTP `/debug/healthz`, délai de 60s | Sonde de vivacité. |
| `uptime_check_config` | _(défini)_ | Vérification de disponibilité Cloud Monitoring (points de terminaison publics uniquement). |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 21 — Redis {#group-21--redis}

Zitadel n'utilise pas Redis (tout l'état est dans PostgreSQL). `enable_redis` est par défaut
`false` et doit être désactivé ; les entrées `redis_*` sont inertes pour ce module.

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode de simulation. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service (la console Zitadel). |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, vérifications de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (`db-init`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration via le moteur de fondation [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et les combinaisons* au moment de la planification — un `database_type` non-Postgres, `enable_cloudsql_volume` avec `database_type = NONE`, `min_instance_count > max_instance_count`, Redis activé sans hôte résolvable, un `redis_port`/`backup_retention_days` hors de portée. Une configuration invalide échoue la **planification** avec une erreur claire et nommée avant qu'aucune ressource ne soit créée, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `ZITADEL_MASTERKEY` (auto-généré) | Ne jamais faire pivoter après le premier démarrage | Critique | Le faire pivoter rend toutes les données précédemment chiffrées (secrets client, matériel de clé) illisibles de manière permanente. |
| `database_type` | `POSTGRES_15` | Critique | Zitadel ne prend en charge que PostgreSQL ; MySQL/autre est rejeté au moment de la planification, et un moteur incorrect bloque le démarrage. |
| `db_name` / `db_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/le rôle et détruit toutes les données d'identité. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activation sans source de sauvegarde valide échoue le job d'importation. |
| `ZITADEL_EXTERNALDOMAIN` | Correspondre au navigateur/hôte | Critique | S'il ne correspond pas à l'hôte que les utilisateurs atteignent, l'émetteur OIDC et les redirections de la console sont incorrects et chaque échange de connexion/jeton échoue. Définissez-le explicitement derrière un domaine personnalisé. |
| `enable_cloudsql_volume` | `true` | Élevé | Le socket du proxy d'authentification est requis pour la connectivité PostgreSQL ; sa désactivation avec une base de données configurée est bloquée par une protection au moment de la planification. |
| `ingress_settings` | `all` | Élevé | `internal` bloque la console et tous les clients OIDC/OAuth externes. |
| `enable_iap` | uniquement pour les consoles privées | Élevé | IAP nécessite une connexion Google pour toutes les requêtes, bloquant les clients OIDC/machine et les points de terminaison de jetons. |
| `application_version` | Épingler une version | Élevé | `latest` correspond à un tag épinglé aujourd'hui, mais l'épinglage explicite évite les migrations surprises lors du redéploiement. |
| `memory_limit` | `4Gi` | Moyen | Un réglage trop bas risque un OOM sous charge ; gen2 impose également un plancher de 512 Mio. |
| `min_instance_count` | `1` | Moyen | `0` (mise à l'échelle à zéro) ajoute une latence de démarrage à froid aux requêtes de jetons/connexion après l'inactivité. |
| `enable_nfs` | `false` (par défaut) | Faible | Zitadel ne stocke aucun état sur disque ; l'activer n'ajoute qu'un montage NFS inutilisé. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité des données d'identité. |
| `enable_cloud_armor` | activer pour la production | Moyen | La console et les points de terminaison OIDC sont accessibles publiquement sans protection WAF. |

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise à l'échelle et
concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**.
La configuration d'application spécifique à Zitadel partagée avec la variante GKE est décrite dans
**[Zitadel_Common](Zitadel_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Zitadel sur Cloud Run](../labs/Zitadel_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Zitadel sur GKE Autopilot](Zitadel_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Zitadel Common — Configuration d'application partagée](Zitadel_Common.md) — la configuration partagée par les deux cibles de déploiement.
