---
title: "Authentik sur Google Cloud Run"
description: "Référence de configuration pour le déploiement d'Authentik sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Authentik_CloudRun.md @ e69407af sha256:183dc265f985 -->

# Authentik sur Google Cloud Run {#authentik-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Authentik_CloudRun.png" alt="Authentik sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

authentik ([goauthentik.io](https://goauthentik.io/)) est un fournisseur d'identité
open source (MIT, open-core) : authentification unique via OIDC et SAML, LDAP et
SCIM, authentification multifacteur et authentification proxy — une alternative
auto-hébergée à Okta, Auth0 et Keycloak. Ce module déploie authentik sur **Cloud
Run v2** au-dessus de la fondation [App_CloudRun](App_CloudRun.md), qui provisionne
et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'authentik utilise et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à chaque application Cloud Run —
identité de service, entrée et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au [guide de la
fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## Ce que coûte Authentik sur RAD, et comment cela se compare {#what-authentik-costs-on-rad-and-how-that-compares}

**Authentik sur le module Cloud Run de RAD coûte environ 170 $ US par mois dans un projet que vous possédez, sans frais de licence pour le logiciel lui-même.** RAD facture des frais de module uniques de 175 crédits (17,50 $ US au prix de la recharge) dans un projet que vous possédez, et 157,5 crédits (10 % de moins) dans un projet géré par RAD. Si Authentik doit fonctionner en continu sur des pods ou à côté d'autres charges de travail Kubernetes, consultez plutôt le [guide GKE](Authentik_GKE.md). Les chiffres sont à jour au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

Si vous n'en avez besoin qu'occasionnellement — pour étudier en vue d'une certification, une démo, un besoin saisonnier — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits, de sorte que les quelque 170 $ US par mois deviennent presque rien. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

Vous payez pour trois choses :

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 175 crédits (17,50 $ US au prix de la recharge) | 157,5 crédits (10 % de moins) |
| Temps de build | Quelques crédits, facturés à la minute de build | Idem |
| Coût de fonctionnement Google Cloud | Facturé par Google à votre propre compte de facturation, environ 170 $ US par mois pour la configuration par défaut (tableau ci-dessous) | Facturé à l'heure en crédits ; RAD publie **78 crédits par jour**, soit environ 2 340 par mois (environ 234 $ US au prix de la recharge, 187 $ US au taux du plan Scale) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge unique, et moins pour un plan mensuel. Dans un projet géré par RAD, la base de données et le serveur de fichiers/cache sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'en ajoute pas un deuxième.

**Coût de fonctionnement par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Cloud Run, 2x vCPU / 2 GiB (alwaysOn) | 99,90 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| **Total** | **environ 170 $ US** |

### Comment cela se compare {#how-it-compares}

- Auth0, l'un des fournisseurs d'identité qu'authentik vise à remplacer, facture par utilisateurs actifs mensuels : son plan B2C Essentials commence **à partir de 35 $/mois**, Professionnel **à partir de 240 $/mois** ; le B2B commence encore plus haut (Essentials à partir de 150 $, Professionnel à partir de 800 $) — et le niveau gratuit est plafonné à 25 000 MAU. Le coût d'authentik ici est une infrastructure fixe, indépendante du nombre d'identités que vous gérez.
- **RAD exécute le projet open source lui-même, et non une location hébergée par un fournisseur.** Vous obtenez le même logiciel, sur votre propre infrastructure (ou celle de RAD), au lieu d'un abonnement par siège ou par utilisation qui augmente indépendamment de ce que vous utilisez réellement.
- **Par rapport à un serveur auto-géré nu :** L'exécution du même logiciel open source par vous-même, un Hetzner CPX22 (2 vCPU/4 Go, environ 24 $/mois) ou un DigitalOcean 2 vCPU/4 Go Droplet (également 24 $/mois) est à peu près la même chose ; un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) coûte environ 49 $/mois. RAD n'est pas moins cher en termes d'argent — la différence est la base de données gérée, Secret Manager et la surveillance qui viennent avec le module au lieu d'être votre propre travail.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Authentik s'exécute dans **un projet géré par RAD pour vous**, vous avez une option qui va bien au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour presque rien.** Cela convient bien mieux à une utilisation occasionnelle — étudier pour une certification, une démo, un besoin saisonnier — que de faire fonctionner Authentik en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer purement et simplement le projet. Google ne le supprime pas immédiatement : il conserve le projet, récupérable, pendant 30 jours, et comme la facturation est déjà déliée, rien n'est facturé pendant qu'il attend. Contrairement à la suppression d'un module, cela ne détruit pas la base de données, aucune VM ou la ressource de calcul une par une — l'ensemble du projet s'arrête simplement, et rien n'est facturé entre-temps.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours, seul le propriétaire du projet peut le restaurer. RAD demande à Google de restaurer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter **Update** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits au total (moins de 1 $ US), par rapport au paiement des frais de module et d'une reconstruction complète.
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet dont RAD gère uniquement la facturation), vous devez le restaurer vous-même dans les 30 jours — après quoi Google le supprime définitivement — et la restauration est admise comme la création d'un nouveau projet, de sorte que votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox qui convient à la plupart des utilisations d'étude et de démo). Google indique que la plupart des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.
- **Un véritable manque : les sauvegardes ne survivent pas.** Tout ce qu'Authentik écrit dans un bucket de sauvegarde à l'intérieur du projet est très probablement perdu dès que vous supprimez le projet, même si le projet lui-même est récupérable pendant 30 jours — ce bucket a la suppression logicielle de Cloud Storage explicitement désactivée. Quiconque a personnalisé le déploiement et souhaite conserver ce travail doit copier une sauvegarde (vers Google Drive ou un bucket en dehors du projet) avant de la supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

C'est la solution de repli pour un projet que vous possédez, ou une fois que la fenêtre de restauration de 30 jours ci-dessus est passée : **supprimez le déploiement et redéployez-le lorsque vous en aurez à nouveau besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau, plus les builds : environ 180 crédits (environ 18 $ US) dans votre propre projet, ou 162,5 crédits dans un projet géré par RAD, car RAD reconstruit les ressources à partir de zéro. La suppression permet d'économiser de l'argent une fois qu'Authentik resterait inutilisé assez longtemps pour compenser ce coût de redéploiement par rapport à son propre coût de fonctionnement — environ 3 jours ou plus dans votre propre projet (5,68 $ US/jour) ou 2 jours ou plus dans un projet géré par RAD (78 crédits/jour).
- **La majeure partie du coût de fonctionnement est généralement une infrastructure partagée.** La base de données et la VM de fichiers ou de cache ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, de sorte que la suppression d'Authentik pendant qu'une autre application partage le projet n'économise que la partie calcul d'Authentik.
- **Conservez d'abord vos données.** Tout ce qu'Authentik écrit dans un bucket de sauvegarde à l'intérieur du déploiement est supprimé avec lui — copiez la dernière sauvegarde (vers Google Drive, ou un bucket que vous conservez) avant de la supprimer si vous voulez la conserver.
- **RAD ne recrée pas un déploiement supprimé pour vous.** Vous saisissez à nouveau les paramètres lorsque vous redéployez.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant dispose d'Authentik dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute Authentik pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais de RAD et estimation des crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les mécanismes de pause/restauration ; [Tarification Auth0](https://auth0.com/pricing). Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

authentik s'exécute comme un conteneur Python/Django sur Cloud Run v2, avec son
worker d'arrière-plan (`ak worker`) colocalisé dans le même conteneur. Le
déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Serveur + worker colocalisé, 2 vCPU / 2 GiB par défaut, CPU toujours actif, min 1 instance |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — authentik nécessite PostgreSQL ≥ 14 ; MySQL est bloqué |
| Cache et file d'attente | **Aucun — pas de Redis** | authentik ≥ 2025.10 a déplacé le cache, les sessions, la file d'attente des tâches et la couche de canal WebSocket dans PostgreSQL |
| Stockage de médias | Cloud Storage (GCS Fuse) | Bucket monté à `/media` pour les icônes téléchargées et les arrière-plans de flux |
| Secrets | Secret Manager | Stable `AUTHENTIK_SECRET_KEY`, mot de passe de démarrage `akadmin`, mot de passe de base de données |
| Image | Artifact Registry + Cloud Build | Build personnalisé léger `FROM ghcr.io/goauthentik/server` (point d'entrée cloud + lanceur de worker) |
| Entrée | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut ; équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire et est le *seul* magasin de données.** Pas de Redis, pas de backend de recherche — les sessions, le cache et la file d'attente des tâches résident tous dans Cloud SQL.
- **Le worker est colocalisé.** Le point d'entrée du conteneur démarre `ak worker` en arrière-plan à côté du serveur (le même modèle que le worker Sidekiq de Chatwoot). C'est pourquoi `cpu_always_allocated = true` et `min_instance_count = 1` sont les valeurs par défaut : les tâches planifiées, la synchronisation des avant-postes et la file d'attente basée sur Postgres doivent continuer à être traitées entre les requêtes, les avant-postes maintiennent un WebSocket vers le serveur, et la latence de connexion est importante pour un IdP. La variable documente le retour en arrière lab/démo (`false` + `min_instance_count = 0`).
- **`max_instance_count = 5`.** authentik est sans état entre les instances — tout l'état est dans PostgreSQL — donc plusieurs instances (chacune avec son propre worker) sont sûres.
- **`AUTHENTIK_SECRET_KEY` est généré automatiquement** et stocké dans Secret Manager. Il doit rester stable pendant toute la durée de vie du déploiement — sa rotation invalide toutes les sessions et rend les champs chiffrés illisibles.
- **Le compte administrateur `akadmin` est amorcé au premier démarrage** avec `bootstrap_email` (par défaut `admin@techequity.cloud`) et un mot de passe sauvegardé par Secret Manager. Les variables de démarrage s'appliquent uniquement au **premier** démarrage.
- **`application_version = "latest"` est épinglé.** authentik ne publie pas de balise `latest` sur GHCR ; le build épingle `latest` à une version connue et fonctionnelle (`2026.5.4`) via l'ARG de build spécifique à l'application `AUTHENTIK_VERSION`.
- **Les migrations s'exécutent automatiquement au démarrage** (protégées par un verrou consultatif), de sorte que les mises à niveau de version n'ont pas besoin de tâche de migration distincte — le seuil généreux de la sonde de démarrage couvre la suite de migrations du premier démarrage.
- **Les points de terminaison de santé ne sont pas authentifiés** : démarrage `GET /-/health/ready/`, vivacité `GET /-/health/live/`.
- **Les avant-postes LDAP/RADIUS sont hors de portée sur Cloud Run** (écouteurs non-HTTP de longue durée). Le SSO du navigateur (OIDC/SAML) et l'avant-poste intégré fonctionnent normalement.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de service et de ressource sont
rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service authentik {#a-cloud-run--the-authentik-service}

authentik s'exécute comme un service Cloud Run v2 avec une facturation basée sur l'instance (CPU toujours actif) afin que le worker colocalisé continue de traiter entre les requêtes. Chaque déploiement crée une révision immuable.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

authentik stocke *tout* ici — utilisateurs, groupes, flux, fournisseurs, sessions, cache et file d'attente des tâches d'arrière-plan. Le service se connecte en privé via le **Cloud SQL Auth Proxy** sur un socket Unix ; le point d'entrée du conteneur mappe les variables `DB_*` injectées sur la convention `AUTHENTIK_POSTGRESQL__*` d'authentik et définit le mode SSL par type de connexion. Lors du premier déploiement, un seul job `db-init` crée la base de données et le rôle spécifiques au locataire.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe se trouvent dans les [Sorties](#5-outputs) (les noms de base de données et d'utilisateur sont préfixés par le locataire). Voir [App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage — médias {#c-cloud-storage--media}

Un bucket dédié est monté à `/media` via GCS Fuse pour les médias téléchargés (icônes d'application, arrière-plans de flux). Les téléchargements survivent au remplacement et à la mise à l'échelle des instances.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<media-bucket>/        # bucket name is in the Outputs
  ```

### D. Secret Manager {#d-secret-manager}

Deux secrets authentik sont générés automatiquement :

- `AUTHENTIK_SECRET_KEY` — signe les sessions/cookies et dérive le chiffrement interne. **Ne le faites jamais pivoter.**
- `AUTHENTIK_BOOTSTRAP_PASSWORD` — le mot de passe initial `akadmin`, appliqué uniquement au premier démarrage.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~authentik"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [Authentik_Common](Authentik_Common.md) pour le modèle de secret complet.

### E. Réseau et entrée {#e-networking--ingress}

Le service est accessible à son URL `run.app` par défaut. Un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peuvent être superposés. Pour un IdP, un nom d'hôte stable et frontal TLS est important — les URI de redirection OIDC/SAML que vous enregistrez dans les applications clientes doivent correspondre à l'URL sur laquelle les utilisateurs accèdent à authentik.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux du serveur **et du worker** sont tous deux acheminés vers Cloud Logging (ils partagent le stdout/stderr du conteneur). Les métriques Cloud Run et Cloud SQL sont acheminées vers Cloud Monitoring.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application authentik {#3-authentik-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Une seule tâche d'initialisation exécute `db-init.sh` en utilisant `postgres:15-alpine` : elle attend PostgreSQL, crée le rôle et la base de données spécifiques au locataire, accorde les privilèges et accorde de manière défensive `cloudsqlsuperuser` (afin que toute future `CREATE EXTENSION` dans les migrations en amont réussisse). La tâche est idempotente et peut être réexécutée en toute sécurité.
- **Démarrage auto-migrant.** Le serveur d'authentik exécute ses propres migrations Django à chaque démarrage, protégées par un verrou consultatif PostgreSQL. Il n'y a pas de tâche de migration distincte. Le premier démarrage exécute la suite complète — attendez-vous à plusieurs minutes avant que `/-/health/ready/` ne renvoie 200 ; la sonde de démarrage autorise environ 11 minutes.
- **Première connexion.** Connectez-vous en tant que **`akadmin`** en utilisant la valeur `bootstrap_email` et le mot de passe dans le secret `...-bootstrap-password`. Si les variables de démarrage étaient absentes au premier démarrage, complétez la configuration à `<service-url>/if/flow/initial-setup/` à la place.
- **Les applications et les fournisseurs sont configurés dans l'application après le déploiement.** Les fournisseurs OIDC/SAML, les applications, les avant-postes et les flux sont des configurations authentik, pas des entrées Terraform — créez-les dans l'interface d'administration (`<service-url>/if/admin/`) une fois le service opérationnel.
- **Colocation du worker.** `ak worker` s'exécute dans le même conteneur ; ses lignes de journal sont entrelacées avec celles du serveur dans Cloud Logging. Il nécessite le CPU toujours actif par défaut — le passage à la facturation basée sur les requêtes limite le worker entre les requêtes.
- **Points de terminaison de santé.**
  ```bash
  curl -s "$SERVICE_URL/-/health/ready/" -o /dev/null -w '%{http_code}\n'   # 200 = migrated + DB reachable
  curl -s "$SERVICE_URL/-/health/live/"  -o /dev/null -w '%{http_code}\n'   # 200 = process alive
  ```
- **Inspecter l'exécution des tâches :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour authentik sont listés ; toutes les autres entrées sont héritées de [App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |
| `bootstrap_email` | `admin@techequity.cloud` | E-mail du compte `akadmin` intégré, défini au premier démarrage. |
| `bootstrap_password` | `""` (généré automatiquement) | Mot de passe initial `akadmin`. **Premier démarrage uniquement** ; stocké dans Secret Manager. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Court suffixe qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails auxquels sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `authentik` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Balise de version d'authentik ; `latest` est épinglé à `2026.5.4` au moment de la construction (pas de balise `latest` en amont). Épinglez explicitement en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | Image wrapper légère construite via Cloud Build (ajoute le point d'entrée cloud + le lanceur de worker). |
| `cpu_limit` | `2000m` | CPU par instance — partagé par le serveur et le worker. |
| `memory_limit` | `2Gi` | Mémoire par instance — 2 GiB est le seuil fiable pour le serveur + le worker. |
| `cpu_always_allocated` | `true` | **Gardez vrai.** Le worker colocalisé et les WebSockets des avant-postes travaillent entre les requêtes. Passez à `false` + `min_instance_count = 0` uniquement pour un démarrage à froid lab/démo axé sur les coûts. |
| `min_instance_count` | `1` | Maintient le worker en marche et les WebSockets des avant-postes connectés. |
| `max_instance_count` | `5` | Sûr à augmenter — authentik est sans état entre les instances. |
| `container_port` | `9000` | Port HTTP d'authentik. |
| `enable_cloudsql_volume` | `true` | Socket Unix Auth Proxy — le point d'entrée définit `SSLMODE=disable` pour l'Auth Proxy (répertoire de socket ou TCP en boucle ; le proxy ne parle pas SSL lui-même), `require` uniquement pour le TCP direct vers tout autre hôte. |
| `timeout_seconds` | `300` | Durée maximale de la requête. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | authentik est un IdP orienté utilisateur ; les navigateurs et les redirections OAuth doivent y accéder. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via VPC. |
| `enable_iap` | `false` | IAP devant un IdP double-verrouille chaque connexion et bloque les rappels OIDC des identités non-Google — laissez désactivé sauf si vous savez que vous en avez besoin. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres `AUTHENTIK_*` supplémentaires (par exemple, e-mail/SMTP : `AUTHENTIK_EMAIL__HOST`, …). Ne définissez pas `AUTHENTIK_SECRET_KEY` ou `AUTHENTIK_POSTGRESQL__*` ici. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 10 — Équilibreur de charge, CDN et domaine personnalisé {#group-10--load-balancer-cdn--custom-domain}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Équilibreur de charge HTTPS global + WAF Cloud Armor — recommandé pour un IdP public. |
| `application_domains` | `[]` | Nom(s) d'hôte personnalisé(s). Enregistrez les URI de redirection OIDC par rapport au domaine que les utilisateurs atteignent réellement. |
| `enable_cdn` | `false` | Le CDN ajoute peu pour un IdP (trafic dynamique, authentifié). |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Le bucket `/media` est déclaré par `Authentik_Common`. |
| `enable_nfs` | `true` | Optionnel ; authentik conserve les médias sur GCS, pas sur NFS. |
| `gcs_volumes` | `[]` | Montages GCS Fuse supplémentaires ; `/media` est ajouté automatiquement. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | authentik nécessite PostgreSQL — les valeurs MySQL sont rejetées par la validation. |
| `db_name` | `authentik` | Nom de base de la base de données (préfixé par le locataire au déploiement). Immuable après le premier déploiement. |
| `db_user` | `authentik` | Nom de base de l'utilisateur de la base de données de l'application (préfixé par le locataire). |
| `database_password_length` | `32` | Longueur du mot de passe généré (16-64). |

### Groupe 13 — Tâches et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser la seule tâche `db-init` intégrée. |
| `cron_jobs` | `[]` | Non nécessaire — le worker colocalisé exécute les tâches planifiées d'authentik. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/-/health/ready/`, délai 60s, 40×15s | Non authentifié. Seuil généreux pour les migrations au premier démarrage (budget ~11 min). |
| `liveness_probe` | HTTP `/-/health/live/`, délai 60s, 3×30s | Vérification de la vivacité du processus non authentifiée. |
| `uptime_check_config` | désactivé | Vérification de la disponibilité Cloud Monitoring optionnelle (pointez-la vers `/-/health/live/`). |

### Groupe 21 — Redis {#group-21--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | **Inerte.** authentik ≥ 2025.10 a entièrement supprimé Redis ; `main.tf` épingle `enable_redis = false`. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | Noms de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application (préfixé par le locataire). |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés (inclut le bucket `/media`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, vérifications de la disponibilité. |
| `initialization_jobs` | Noms des tâches de configuration (`db-init`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` / `github_repository_*` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur de fondation [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et les combinaisons* au moment de la planification — une configuration invalide échoue à la **planification** avec une erreur claire et nommée avant qu'aucune ressource ne soit créée, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'au moment de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `AUTHENTIK_SECRET_KEY` (généré automatiquement) | Ne jamais faire pivoter | Critique | Sa rotation invalide **toutes** les sessions actives et rend les champs chiffrés (informations d'identification stockées, jetons) illisibles. |
| `database_type` | `POSTGRES_15` | Critique | MySQL est bloqué par la validation — authentik nécessite PostgreSQL ≥ 14. |
| `db_name` / `db_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données d'identité. |
| Ports d'écoute du worker (gérés par le point d'entrée) | Laisser les valeurs par défaut de boucle locale `AUTHENTIK_LISTEN__*` du point d'entrée | Critique | Le `ak worker` colocalisé démarre également un écouteur HTTP et hérite du `0.0.0.0:9000` par défaut du serveur ; s'il gagne la course de liaison, il répond à **toutes** les routes — y compris les points de terminaison de santé — avec des 200 vides : une interface utilisateur vierge avec des sondes fantômes saines. Le point d'entrée épingle le worker aux ports de boucle locale (`127.0.0.1:9001`/`9444`/`9301`) afin que le serveur possède `:9000` — un 200 avec un corps vide signifie que le mauvais processus a répondu. |
| `min_instance_count` | `1` (avec CPU toujours actif) | Élevé | `0` permet à l'instance de s'arrêter : les WebSockets des avant-postes se déconnectent et les tâches d'arrière-plan (tâches planifiées, synchronisation des avant-postes) sont retardées jusqu'à ce que la prochaine requête réveille une instance. |
| `cpu_always_allocated` | `true` | Élevé | La facturation basée sur les requêtes limite le worker colocalisé entre les requêtes — la file d'attente des tâches stagne même à `min=1`. |
| `startup_probe.path` | `/-/health/ready/` (non authentifié) | Moyen | Pointer la sonde vers une page authentifiée renvoie 401/403 au sondeur — la révision ne devient jamais prête même si authentik a démarré correctement. |
| `bootstrap_password` / `bootstrap_email` | Définir avant le premier déploiement | Moyen | Appliqué uniquement au **premier** démarrage. Les modifier ultérieurement n'a aucun effet — gérez `akadmin` dans l'application, ou utilisez `/if/flow/initial-setup/` si les variables de démarrage étaient absentes au premier démarrage. |
| `application_version` | Épingler une version | Moyen | `latest` est silencieusement épinglé à `2026.5.4` ; un épinglage explicite rend les mises à niveau délibérées. Les balises inexistantes échouent le Cloud Build avec `MANIFEST_UNKNOWN`. |
| `memory_limit` | `2Gi` | Moyen | Le serveur + le worker partagent la limite ; des valeurs inférieures risquent un OOM pendant les migrations ou les importations de flux. |
| `environment_variables` → `AUTHENTIK_POSTGRESQL__*` | Laisser non défini | Moyen | Le point d'entrée mappe les valeurs `DB_*` injectées ; le codage en dur de noms de base de données courts s'authentifie en tant que rôle inexistant (les noms sont préfixés par le locataire). |
| Avant-postes LDAP/RADIUS | Pas sur Cloud Run | Faible | Les écouteurs non-HTTP ne peuvent pas être servis par Cloud Run — utilisez la variante GKE ou un hôte externe pour ces avant-postes. |
| `enable_iap` | `false` | Moyen | IAP double-verrouille chaque connexion et interrompt les rappels OAuth/SAML des parties externes. |

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise à l'échelle et
concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à authentik
partagée avec la variante GKE est décrite dans
**[Authentik_Common](Authentik_Common.md)**.

<!-- related-guides -->

## Guides associées {#related-guides}

- [Lab pratique : Authentik sur Cloud Run](../labs/Authentik_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Authentik sur GKE Autopilot](Authentik_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Authentik Common — Configuration d'application partagée](Authentik_Common.md) — la configuration partagée par les deux cibles de déploiement.
