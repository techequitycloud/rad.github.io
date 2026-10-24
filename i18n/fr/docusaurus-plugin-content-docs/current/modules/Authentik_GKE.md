---
title: "Authentik sur GKE Autopilot"
description: "Référence de configuration pour le déploiement d'Authentik sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Authentik_GKE.md @ 1665a43e sha256:2c9fa9042e47 -->

# Authentik sur GKE Autopilot {#authentik-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Authentik_GKE.png" alt="Authentik sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

authentik ([goauthentik.io](https://goauthentik.io/)) est un fournisseur
d'identité open source (MIT, open-core) : authentification unique via OIDC et
SAML, LDAP et SCIM, authentification multifacteur et authentification par
proxy — une alternative auto-hébergée à Okta, Auth0 et Keycloak. Ce module
déploie authentik sur **GKE Autopilot** sur la base de la fondation
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée
Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud qu'authentik utilise et sur la
façon de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## Ce que coûte Authentik sur RAD, et comparaison {#what-authentik-costs-on-rad-and-how-that-compares}

**Le module GKE Autopilot d'Authentik sur RAD coûte environ 150 $ US par mois dans un projet que vous possédez, sans frais de licence pour le logiciel lui-même.** RAD facture des frais de module uniques de 175 crédits (17,50 $ US au prix de la recharge) dans un projet que vous possédez, et de 157,5 crédits (10 % de moins) dans un projet géré par RAD. GKE convient à Authentik qui doit rester actif en permanence ou s'adapter à travers les pods ; pour le coût le plus bas, le [module Cloud Run](Authentik_CloudRun.md) exécute le même Authentik pour environ 170 $ US par mois. Les chiffres sont à jour au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

Si vous n'en avez besoin qu'occasionnellement — pour préparer une certification, une démo, un besoin saisonnier — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits, de sorte que les quelque 150 $ US par mois deviennent presque rien. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

Vous payez pour trois choses :

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 175 crédits (17,50 $ US au prix de la recharge) | 157,5 crédits (10 % de moins) |
| Temps de build | Quelques crédits, facturés à la minute de build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ 150 $ US par mois pour la configuration par défaut (tableau ci-dessous) | Facturé à l'heure en crédits ; RAD publie **111 crédits par jour**, soit environ 3 330 par mois (environ 333 $ US au prix de la recharge, 266 $ US au tarif du plan Scale) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge unique, et moins avec un plan mensuel. Dans un projet géré par RAD, la base de données et le serveur de fichiers/cache sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'en ajoute pas une deuxième.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Pod GKE Autopilot, 2x vCPU / 4 GiB | 79,35 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| Frais de gestion de cluster GKE | 0 $ US si c'est votre seul cluster Autopilot/zonal sur le compte de facturation, sinon environ 73 $ US (partagés entre toutes les applications GKE du projet) |
| **Total** | **environ 150 $ US** |

### Comparaison {#how-it-compares}

- Auth0, l'un des fournisseurs d'identité qu'authentik vise à remplacer, facture par utilisateurs actifs mensuels : son plan B2C Essentials commence **à partir de 35 $/mois**, Professionnel **à partir de 240 $/mois** ; le B2B commence encore plus haut (Essentials à partir de 150 $, Professionnel à partir de 800 $) — et le niveau gratuit plafonne à 25 000 MAU. Le coût d'authentik ici est une infrastructure fixe, indépendante du nombre d'identités que vous gérez.
- **RAD exécute le projet open source lui-même, et non une location hébergée par un fournisseur.** Vous obtenez le même logiciel, sur votre propre infrastructure (ou celle de RAD), au lieu d'un abonnement par siège ou par utilisation qui augmente indépendamment de ce que vous utilisez réellement.
- **Par rapport à un serveur auto-géré nu :** L'exécution du même logiciel open source par vous-même, un Hetzner CPX22 (2 vCPU/4 Go, environ 24 $/mois) ou un DigitalOcean 2 vCPU/4 Go Droplet (également 24 $/mois) est à peu près la même chose ; un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) coûte environ 49 $/mois. RAD n'est pas moins cher que cela en termes monétaires — la différence est la base de données gérée, Secret Manager et la surveillance qui viennent avec le module au lieu d'être votre propre travail.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Authentik s'exécute dans **un projet géré par RAD pour vous**, vous avez une option qui va bien au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour presque rien.** Cela convient bien mieux à une utilisation occasionnelle — étudier pour une certification, une démo, un besoin saisonnier — que l'exécution continue d'Authentik.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer purement et simplement le projet. Google ne le supprime pas immédiatement : il conserve le projet, récupérable, pendant 30 jours, et comme la facturation est déjà déliée, rien n'est facturé pendant qu'il attend. Contrairement à la suppression d'un module, cela ne détruit pas la base de données, aucune VM ou la ressource de calcul une par une — l'ensemble du projet s'arrête simplement, et rien n'est facturé entre-temps.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours, seul le propriétaire du projet peut le restaurer. RAD demande à Google de récupérer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter **Update** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits au total (moins de 1 $ US), contre le paiement des frais de module et une reconstruction complète.
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet dont RAD gère uniquement la facturation), vous devez le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est admise comme la création d'un nouveau projet, de sorte que votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox qui convient à la plupart des utilisations d'étude et de démo). Google indique que la plupart des services fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.
- **Un véritable manque : les sauvegardes ne survivent pas.** Tout ce qu'Authentik écrit dans un bucket de sauvegarde à l'intérieur du projet est très probablement perdu dès que vous supprimez le projet, même si le projet lui-même est récupérable pendant 30 jours — la suppression logicielle de Cloud Storage est explicitement désactivée sur ce bucket. Quiconque a personnalisé le déploiement et souhaite conserver ce travail doit copier une sauvegarde (vers Google Drive ou un bucket en dehors du projet) avant de la supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre façon : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

C'est la solution de repli pour un projet que vous possédez, ou une fois que la fenêtre de restauration de 30 jours ci-dessus est passée : **supprimez le déploiement et redéployez-le lorsque vous en aurez à nouveau besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau, plus les builds : environ 180 crédits (environ 18 $ US) dans votre propre projet, ou 162,5 crédits dans un projet géré par RAD, car RAD reconstruit les ressources à partir de zéro. La suppression permet d'économiser de l'argent une fois qu'Authentik resterait inutilisé assez longtemps pour compenser ce coût de redéploiement par rapport à son propre coût d'exécution — environ 4 jours ou plus dans votre propre projet (4,99 $ US/jour) ou 1 jour ou plus dans un projet géré par RAD (111 crédits/jour).
- **La majeure partie du coût d'exécution est généralement l'infrastructure partagée.** La base de données et la VM de fichiers ou de cache ne s'arrêtent que si rien d'autre dans le projet ne les utilise, donc la suppression d'Authentik pendant qu'une autre application partage le projet n'économise que la partie calcul d'Authentik.
- **Conservez d'abord vos données.** Tout ce qu'Authentik écrit dans un bucket de sauvegarde à l'intérieur du déploiement est supprimé avec lui — copiez la dernière sauvegarde (vers Google Drive, ou un bucket que vous conservez) avant de la supprimer si vous voulez la conserver.
- **RAD ne recrée pas un déploiement supprimé pour vous.** Vous saisissez à nouveau les paramètres lorsque vous redéployez.

### Sessions de labo et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de labo, pour la formation.** Un formateur anime une session pour une classe. Chaque participant dispose d'Authentik dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute Authentik pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais de RAD et estimation des crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les mécanismes de pause/restauration ; [Tarification Auth0](https://auth0.com/pricing). Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

authentik s'exécute en tant que déploiement Python/Django sur GKE Autopilot,
avec son worker d'arrière-plan (`ak worker`) colocalisé dans le même conteneur de
pod. Le déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Déploiement, 2 vCPU / 4 GiB par défaut, 1 à 5 réplicas |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — authentik nécessite PostgreSQL ≥ 14 ; MySQL est bloqué |
| Cache et file d'attente | **Aucun — pas de Redis** | authentik ≥ 2025.10 a déplacé le cache, les sessions, la file d'attente des tâches et la couche de canal WebSocket vers PostgreSQL |
| Stockage de médias | Cloud Storage (GCS Fuse CSI) | Bucket monté à `/media` pour les icônes téléchargées et les arrière-plans de flux |
| Secrets | Secret Manager | Stable `AUTHENTIK_SECRET_KEY`, mot de passe de démarrage `akadmin`, mot de passe de base de données |
| Image | Artifact Registry + Cloud Build | Build personnalisé léger `FROM ghcr.io/goauthentik/server` (point d'entrée cloud + lanceur de worker) |
| Ingress | Cloud Load Balancing | Service LoadBalancer externe ; domaine personnalisé facultatif + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire et est le *seul* magasin de données.** Pas de
  Redis, pas de backend de recherche — les sessions, le cache et la file
  d'attente des tâches résident tous dans Cloud SQL.
- **Le worker est colocalisé.** Le point d'entrée du conteneur démarre
  `ak worker` en arrière-plan à côté du serveur (le même modèle que le worker
  Sidekiq de Chatwoot) — pas de déploiement de worker séparé. Gardez
  `min_instance_count ≥ 1` pour que le worker traite toujours.
- **`max_instance_count = 5`.** authentik est sans état à travers les pods — tout l'état est
  dans PostgreSQL — donc plusieurs réplicas (chacun avec son propre worker) sont
  sûrs.
- **`AUTHENTIK_SECRET_KEY` est généré automatiquement** et stocké dans Secret
  Manager. Il doit rester stable — sa rotation invalide toutes les sessions et
  rend les champs chiffrés illisibles. Les deux noms de secrets sont simples
  (sans `__`), ils passent donc la validation GKE SecretSync
  `targetKey` ; le mappage `AUTHENTIK_POSTGRESQL__*` se produit à l'intérieur du point
  d'entrée à partir des variables `DB_*` injectées.
- **Le compte administrateur `akadmin` est amorcé au premier démarrage** avec
  `bootstrap_email` (par défaut `admin@techequity.cloud`) et un mot de passe sauvegardé par
  Secret Manager. Les variables d'amorçage s'appliquent au **premier** démarrage
  uniquement.
- **`application_version = "latest"` est épinglé.** authentik ne publie pas de tag
  `latest` sur GHCR ; le build épingle `latest` à une version
  connue et fonctionnelle (`2026.5.4`) via l'ARG de build spécifique à
  l'application `AUTHENTIK_VERSION`.
- **Les migrations s'exécutent automatiquement au démarrage**, protégées par un
  verrou consultatif PostgreSQL afin que les pods concurrents n'entrent pas en
  collision — pas de job de migration séparé.
- **Les points de terminaison de santé ne sont pas authentifiés** : démarrage
  `GET /-/health/ready/`, vivacité `GET /-/health/live/`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail authentik {#a-gke-autopilot--the-authentik-workload}

Les pods authentik sont planifiés sur Autopilot, qui facture le CPU/la mémoire
demandés par les pods. L'autoscaling horizontal des pods dimensionne le
déploiement entre les nombres minimum et maximum de réplicas. Chaque pod
exécute le serveur, le worker d'arrière-plan et le sidecar Cloud SQL Auth
Proxy.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail
  authentik pour les pods, les révisions et les événements. Kubernetes Engine →
  Services & Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> -c <app-container> --tail=100
  kubectl describe hpa -n "$NAMESPACE"
  ```

Voir [App_GKE](App_GKE.md) pour Autopilot, la mise à l'échelle et la gestion
des types de charges de travail.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

authentik stocke *tout* ici — utilisateurs, groupes, flux, fournisseurs,
sessions, cache et file d'attente des tâches d'arrière-plan. Les pods
atteignent l'instance en privé via le sidecar **Cloud SQL Auth Proxy** ; le
point d'entrée du conteneur mappe les variables `DB_*` injectées sur la
convention `AUTHENTIK_POSTGRESQL__*` d'authentik et définit le mode SSL par type de
connexion — `disable` pour le TCP de bouclage du sidecar proxy
(`127.0.0.1` / `localhost` ; le proxy est terminé par TLS mais ne parle pas
SSL lui-même, donc exiger SSL échoue avec "le serveur ne prend pas en charge
SSL, mais SSL était requis"), `require` uniquement pour le TCP direct vers
tout autre hôte. Lors du premier déploiement, un seul job `db-init` crée la
base de données et le rôle à l'échelle du locataire.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les drapeaux, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de
passe se trouvent dans les [Sorties](#5-outputs) (les noms de base de données
et d'utilisateur sont préfixés par le locataire). Voir [App_GKE](App_GKE.md)
pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage — médias {#c-cloud-storage--media}

Un bucket dédié est monté à `/media` via le pilote GCS Fuse CSI pour les
médias téléchargés (icônes d'application, arrière-plans de flux), de sorte que
les téléchargements survivent au remplacement et à la mise à l'échelle des
pods.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<media-bucket>/        # bucket name is in the Outputs
  ```

### D. Secret Manager {#d-secret-manager}

Deux secrets authentik sont générés automatiquement :

- `AUTHENTIK_SECRET_KEY` — signe les sessions/cookies et dérive le chiffrement interne.
  **Ne le faites jamais pivoter.**
- `AUTHENTIK_BOOTSTRAP_PASSWORD` — le mot de passe initial `akadmin`, appliqué au premier
  démarrage uniquement.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~authentik"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [Authentik_Common](Authentik_Common.md) pour le modèle de secret complet
et [App_GKE](App_GKE.md) pour les détails de SecretSync.

### E. Réseau et ingress {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP de
LoadBalancer externe ; un domaine personnalisé avec un certificat géré par
Google peut être activé, et une adresse IP statique est réservée par défaut
afin que l'adresse survive aux redéploiements. Pour un IdP, un nom d'hôte
stable et frontal TLS est important — les URI de redirection OIDC/SAML que
vous enregistrez dans les applications clientes doivent correspondre à l'URL
sur laquelle les utilisateurs atteignent authentik.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux du serveur **et du worker** sont tous deux acheminés vers Cloud
Logging (ils partagent le stdout/stderr du conteneur). Les métriques GKE et
Cloud SQL sont acheminées vers Cloud Monitoring.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application authentik {#3-authentik-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un seul job
  d'initialisation exécute `db-init.sh` en utilisant `postgres:15-alpine` : il
  attend PostgreSQL, crée le rôle et la base de données à l'échelle du
  locataire, accorde les privilèges, accorde de manière défensive
  `cloudsqlsuperuser` et signale au sidecar proxy de s'arrêter afin que le job se
  termine. Idempotent et sûr à réexécuter.
- **Démarrage auto-migrant.** Le serveur d'authentik exécute ses propres
  migrations Django à chaque démarrage, protégé par un verrou consultatif
  PostgreSQL afin que les pods concurrents n'entrent pas en collision. Il n'y a
  pas de job de migration séparé. Le premier démarrage exécute la suite
  complète — attendez-vous à plusieurs minutes avant que `/-/health/ready/` ne
  renvoie 200 ; la sonde de démarrage autorise environ 11 minutes.
- **Première connexion.** Connectez-vous en tant que **`akadmin`** en
  utilisant la valeur `bootstrap_email` et le mot de passe dans le secret
  `...-bootstrap-password`. Si les variables de démarrage étaient absentes au premier
  démarrage, terminez la configuration à `<service-url>/if/flow/initial-setup/` à la place.
- **Les applications et les fournisseurs sont configurés dans l'application
  après le déploiement.** Les fournisseurs OIDC/SAML, les applications, les
  outposts et les flux sont des configurations authentik, pas des entrées
  Terraform — créez-les dans l'interface d'administration
  (`<service-url>/if/admin/`) une fois la charge de travail prête.
- **Colocation du worker.** `ak worker` s'exécute dans le même conteneur que
  le serveur ; ses lignes de journal sont entrelacées dans les journaux du pod
  (`kubectl logs ... | grep -i worker`). Gardez `min_instance_count ≥ 1` pour que les tâches planifiées et la
  synchronisation des outposts continuent de s'exécuter.
- **Points de terminaison de santé.**
  ```bash
  curl -s "$SERVICE_URL/-/health/ready/" -o /dev/null -w '%{http_code}\n'   # 200 = migrated + DB reachable
  curl -s "$SERVICE_URL/-/health/live/"  -o /dev/null -w '%{http_code}\n'   # 200 = process alive
  ```
- **Inspecter l'exécution du job :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
authentik sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec leur comportement standard et leurs valeurs par
défaut.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |
| `bootstrap_email` | `admin@techequity.cloud` | E-mail du compte `akadmin` intégré, défini au premier démarrage. |
| `bootstrap_password` | `""` (auto-généré) | Mot de passe initial `akadmin`. **Premier démarrage uniquement** ; stocké dans Secret Manager. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails accordés pour l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `authentik` | Nom de base des ressources (espace de noms, secrets, buckets). Ne pas modifier après le premier déploiement. |
| `application_display_name` | `authentik Identity Provider` | Nom lisible par l'homme. |
| `application_version` | `latest` | Tag de version authentik ; `latest` est épinglé à `2026.5.4` au moment du build (pas de tag `latest` en amont). Épinglez explicitement en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | Image wrapper légère construite via Cloud Build (ajoute le point d'entrée cloud + le lanceur de worker). |
| `min_instance_count` | `1` | Gardez ≥ 1 pour que le worker colocalisé continue de traiter. |
| `max_instance_count` | `5` | Sûr à augmenter — authentik est sans état à travers les pods. |
| `container_port` | `9000` | Port HTTP d'authentik (le service expose 80). |
| `container_resources` | `2000m` / `4Gi` | Partagé par le serveur + le worker ; la valeur par défaut d'Autopilot donne une marge de manœuvre pour la migration. |
| `enable_cloudsql_volume` | `true` | Sidecar Auth Proxy — gardez `true` sur GKE. |
| `enable_image_mirroring` | `true` | L'image de base GHCR est mise en miroir dans Artifact Registry. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres `AUTHENTIK_*` supplémentaires (par exemple, e-mail/SMTP : `AUTHENTIK_EMAIL__HOST`, …). Ne définissez pas `AUTHENTIK_SECRET_KEY` ou `AUTHENTIK_POSTGRESQL__*` ici. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager. Les clés doivent être sans `__` (CRD SecretSync). |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | IP externe pour l'authentification unique du navigateur et les rappels OAuth. |
| `workload_type` | `Deployment` (auto) | authentik est sans état ; StatefulSet est inutile. |
| `session_affinity` | `ClientIP` | Le routage persistant aide les connexions WebSocket de l'interface utilisateur d'administration. |
| `termination_grace_period_seconds` | `60` | Délai de grâce pour les tâches de worker en cours d'exécution lors de l'arrêt. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Lors de l'activation, dimensionnez les requêtes ≥ 2 fois un pod et utilisez des suffixes de mémoire binaires (`"8Gi"`). |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protège la disponibilité de la connexion pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Nombre minimum de pods pendant les perturbations volontaires. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/-/health/ready/`, délai de 60 s, 40 × 15 s | Non authentifié. Seuil généreux pour les migrations au premier démarrage (budget d'environ 11 min). |
| `liveness_probe` | HTTP `/-/health/live/`, délai de 60 s, 3 × 30 s | Vérification de la vivacité du processus non authentifiée. |
| `uptime_check_config` | désactivé | Vérification de la disponibilité de Cloud Monitoring facultative (pointez-la vers `/-/health/live/`). |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | Non nécessaire — le worker colocalisé exécute les tâches planifiées d'authentik. |
| `additional_services` | `[]` | Utilisez pour des outposts supplémentaires (par exemple, LDAP/RADIUS) si nécessaire. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard App_GKE Cloud Build / Cloud Deploy — voir
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`, `github_repository_url`,
`github_token`, `enable_cloud_deploy`, `enable_binary_authorization`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Facultatif ; authentik conserve les médias sur GCS, pas sur NFS. |
| `nfs_mount_path` | `/opt/authentik/storage` | Chemin de montage à l'intérieur du conteneur. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Le bucket `/media` est déclaré par `Authentik_Common`. |
| `gcs_volumes` | `[]` | Montages GCS Fuse supplémentaires ; `/media` est ajouté automatiquement. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 15 — Redis {#group-15--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | **Inerte.** authentik ≥ 2025.10 a entièrement supprimé Redis ; `main.tf` épingle `enable_redis = false`. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | authentik nécessite PostgreSQL — les valeurs MySQL sont rejetées par la validation. |
| `application_database_name` | `authentik` | Nom de base de la base de données (préfixé par le locataire au déploiement). Immuable après le premier déploiement. |
| `application_database_user` | `authentik` | Nom de base de l'utilisateur de la base de données de l'application (préfixé par le locataire). |
| `database_password_length` | `32` | Longueur du mot de passe généré (16-64). |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Ingress + certificat géré pour les noms d'hôte personnalisés. |
| `application_domains` | `[]` | Nom(s) d'hôte à servir. Enregistrez les URI de redirection OIDC par rapport au domaine que les utilisateurs atteignent réellement. |
| `reserve_static_ip` | `true` | IP externe stable à travers les redéploiements — important pour les noms d'hôte IdP épinglés au DNS. |

### Groupe 20 — Proxy sensible à l'identité (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | L'IAP devant un IdP double la connexion et interrompt les rappels OAuth/SAML — laissez-le désactivé à moins que vous ne sachiez que vous en avez besoin. |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Politique WAF sur le backend Ingress — recommandé pour un IdP public. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à un accès privilégié. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen
le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Mappage des ClusterIP pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe du LoadBalancer. |
| `service_url` | URL pour atteindre authentik. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom de la base de données de l'application / utilisateur (préfixé par le locataire). |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés (inclut le bucket `/media`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'importation (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` / `github_repository_*` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration
> au moteur de fondation [App_GKE](App_GKE.md), qui valide les valeurs *et les
> combinaisons* au moment du plan — une configuration invalide échoue le
> **plan** avec une erreur claire et nommée avant qu'aucune ressource ne soit
> créée, de sorte que la plupart des erreurs ci-dessous sont détectées en amont
> plutôt qu'au moment de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `AUTHENTIK_SECRET_KEY` (auto-généré) | Ne jamais faire pivoter | Critique | Sa rotation invalide **toutes** les sessions actives et rend les champs chiffrés (informations d'identification stockées, jetons) illisibles. |
| `database_type` | `POSTGRES_15` | Critique | MySQL est bloqué par la validation — authentik nécessite PostgreSQL ≥ 14. |
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données d'identité. |
| Ports d'écoute du worker (gérés par le point d'entrée) | Laissez les valeurs par défaut de bouclage `AUTHENTIK_LISTEN__*` du point d'entrée | Critique | Le `ak worker` colocalisé démarre également un écouteur HTTP et hérite du `0.0.0.0:9000` par défaut du serveur ; s'il gagne la course de liaison, il répond à **toutes** les routes — y compris les points de terminaison de santé — avec des 200 vides : une interface utilisateur vide pendant que les sondes kubelet semblent vertes. Le point d'entrée épingle le worker aux ports de bouclage (`127.0.0.1:9001`/`9444`/`9301`) afin que le serveur possède `:9000` — un 200 avec un corps vide signifie que le mauvais processus a répondu. |
| `min_instance_count` | `≥ 1` | Élevé | `0` est une sémantique invalide pour le worker colocalisé — les tâches d'arrière-plan et la synchronisation des outposts s'arrêtent ; les WebSockets des outposts se déconnectent. |
| Clés `secret_environment_variables` | Noms simples, sans `__` | Élevé | La CRD SecretSync rejette les clés avec `__` (par exemple `AUTHENTIK_POSTGRESQL__PASSWORD`) au moment de l'application — ce mappage appartient au point d'entrée, pas à un secret synchronisé. |
| `startup_probe.path` | `/-/health/ready/` (non authentifié) | Moyen | Pointer la sonde vers une page authentifiée renvoie 401/403 au kubelet — le pod ne devient jamais prêt même si authentik a démarré correctement. |
| `bootstrap_password` / `bootstrap_email` | Définir avant le premier déploiement | Moyen | Appliqué au **premier** démarrage uniquement. Les modifier ultérieurement n'a aucun effet — gérez `akadmin` dans l'application, ou utilisez `/if/flow/initial-setup/` si les variables de démarrage étaient absentes au premier démarrage. |
| `application_version` | Épingler une version | Moyen | `latest` est épinglé silencieusement à `2026.5.4` ; un épinglage explicite rend les mises à niveau délibérées. Les tags inexistants font échouer le Cloud Build avec `MANIFEST_UNKNOWN`. |
| `quota_memory_requests` / `_limits` | Unités binaires (`8Gi`), ≥ 2 fois un pod | Critique | Les entiers nus sont des octets et bloquent toute planification de pod ; un quota dimensionné à un pod bloque les mises à jour glissantes. |
| `environment_variables` → `AUTHENTIK_POSTGRESQL__*` | Laisser non défini | Moyen | Le point d'entrée mappe les valeurs `DB_*` injectées ; le codage en dur de noms de base de données courts s'authentifie en tant que rôle inexistant (les noms sont préfixés par le locataire). |
| `enable_iap` | `false` | Moyen | L'IAP double la connexion et interrompt les rappels OAuth/SAML des parties externes. |
| `enable_pod_disruption_budget` | `true` | Moyen | La désactivation permet à GKE d'expulser tous les pods simultanément pendant la maintenance — une panne de connexion complète. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à
authentik partagée avec la variante Cloud Run est décrite dans
**[Authentik_Common](Authentik_Common.md)**.

<!-- related-guides -->

## Guides connexes {#related-guides}

- [Lab pratique : Authentik sur GKE Autopilot](../labs/Authentik_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Authentik sur Google Cloud Run](Authentik_CloudRun.md) — la même application sur Cloud Run, pour quand vous avez besoin de l'autre cible de déploiement.
- [Authentik Common — Configuration d'application partagée](Authentik_Common.md) — la configuration partagée par les deux cibles de déploiement.
