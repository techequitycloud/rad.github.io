---
title: "Azimutt sur GKE Autopilot"
description: "Référence de configuration pour le déploiement d'Azimutt sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Azimutt_GKE.md @ e69407af sha256:4a6d6024dbec -->

# Azimutt sur GKE Autopilot {#azimutt-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Azimutt_GKE.png" alt="Azimutt sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Azimutt est un explorateur de schémas de base de données open source de nouvelle
génération et un outil ERD (diagramme d'entité-relation) pour les bases de données
réelles, construit avec Elixir/Phoenix. Il permet aux équipes d'explorer, de
documenter et de concevoir de grands schémas (des milliers de tables), de rechercher
parmi les colonnes et les relations, et de partager des diagrammes. Ce module
déploie Azimutt sur **GKE Autopilot** sur la base de la fondation
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée de Google
Cloud et Kubernetes.

Ce guide se concentre sur les services cloud qu'Azimutt utilise et sur la façon de
les explorer et de les opérer depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications GKE — Workload
Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## Ce que coûte Azimutt sur RAD, et comment cela se compare {#what-azimutt-costs-on-rad-and-how-that-compares}

**Le module GKE Autopilot d'Azimutt sur RAD coûte environ 136 $ US par mois dans un projet que vous possédez, sans frais de licence pour le logiciel lui-même.** RAD facture des frais de module uniques de 175 crédits (17,50 $ US au prix de la recharge) dans un projet que vous possédez, et 157,5 crédits (10 % de moins) dans un projet géré par RAD. GKE convient à Azimutt qui doit rester opérationnel en continu ou s'adapter à plusieurs pods ; pour le coût le plus bas, le [module Cloud Run](Azimutt_CloudRun.md) exécute le même Azimutt pour environ 89 $ US par mois. Les chiffres sont valables au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

Si vous n'en avez besoin qu'occasionnellement — pour préparer une certification, une démo, un besoin saisonnier — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits, de sorte que les quelque 136 $ US par mois deviennent presque rien. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

Vous payez pour trois choses :

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 175 crédits (17,50 $ US au prix de la recharge) | 157,5 crédits (10 % de moins) |
| Temps de build | Quelques crédits, facturés à la minute de build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ 136 $ US par mois pour la configuration par défaut (tableau ci-dessous) | Facturé à l'heure en crédits ; RAD publie **105 crédits par jour**, soit environ 3 150 par mois (environ 315 $ US au prix de la recharge, 252 $ US au tarif du plan Scale) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge ponctuelle, et moins avec un plan mensuel. Dans un projet géré par RAD, la base de données est partagée par toutes les applications du projet, donc une deuxième application n'en ajoute pas une deuxième.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Pod GKE Autopilot, 2x vCPU / 4 Gio | 79,35 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| Frais de gestion de cluster GKE | 0 $ US si c'est votre seul cluster Autopilot/zonal sur le compte de facturation, sinon environ 73 $ US (partagés entre toutes les applications GKE du projet) |
| **Total** | **environ 136 $ US** |

### Comment cela se compare {#how-it-compares}

- **Aucun concurrent SaaS de marque n'est une correspondance exacte pour Azimutt, donc la comparaison honnête est un simple serveur auto-géré.** En exécutant le même logiciel open source vous-même, un Hetzner CPX22 (2 vCPU/4 Go, environ 24 $/mois) ou un DigitalOcean 2 vCPU/4 Go Droplet (également 24 $/mois) est à peu près de la même forme ; un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) coûte environ 49 $/mois.
- **RAD n'est pas moins cher qu'un VPS nu en termes d'argent, et n'essaie pas de l'être.** Ce que RAD ajoute pour un prix similaire est une base de données gérée, Secret Manager pour les identifiants, et une surveillance qui serait autrement votre propre travail à configurer, patcher et sauvegarder.
- **Le temps de l'administrateur est le coût réel qu'un VPS ne montre pas.** Les correctifs de sécurité, les sauvegardes et les mises à niveau de version sur un serveur nu sont un travail que quelqu'un doit continuer à faire ; les services gérés de RAD absorbent cela.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Azimutt s'exécute dans **un projet géré par RAD pour vous**, vous avez une option qui va bien au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour presque rien.** Cela convient bien mieux à une utilisation occasionnelle — préparation d'une certification, démonstration, besoin saisonnier — qu'à une exécution continue d'Azimutt.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le projet purement et simplement. Google ne le supprime pas immédiatement : il conserve le projet, récupérable, pendant 30 jours, et comme la facturation est déjà déliée, rien n'est facturé pendant cette attente. Contrairement à la suppression d'un module, cela ne détruit pas la base de données, aucune VM ou la ressource de calcul une par une — l'ensemble du projet s'arrête simplement, et rien n'est facturé entre-temps.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours, seul le propriétaire du projet peut le restaurer. RAD demande à Google de récupérer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter **Mettre à jour** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits au total (moins de 1 $ US), contre le paiement des frais de module et une reconstruction complète.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un projet dont RAD gère uniquement la facturation), vous devez le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est admise comme la création d'un nouveau projet, donc votre solde de crédits achetés doit toujours dépasser le seuil du palier (100 crédits pour le palier sandbox qui convient à la plupart des utilisations d'étude et de démonstration). Google indique que la plupart des services sont de nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.
- **Un véritable manque : les sauvegardes ne survivent pas.** Tout ce qu'Azimutt écrit dans un bucket de sauvegarde à l'intérieur du projet est très probablement perdu dès que vous supprimez le projet, même si le projet lui-même est récupérable pendant 30 jours — la suppression logicielle de Cloud Storage est explicitement désactivée pour ce bucket. Quiconque a personnalisé le déploiement et souhaite conserver ce travail doit copier une sauvegarde (vers Google Drive ou un bucket en dehors du projet) avant de la supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

C'est la solution de repli pour un projet que vous possédez, ou une fois que la fenêtre de restauration de 30 jours ci-dessus est passée : **supprimez le déploiement, et redéployez-le lorsque vous en aurez à nouveau besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau, plus les builds : environ 180 crédits (environ 18 $ US) dans votre propre projet, ou 162,5 crédits dans un projet géré par RAD, car RAD reconstruit les ressources à partir de zéro. La suppression permet d'économiser de l'argent une fois qu'Azimutt resterait inutilisé assez longtemps pour compenser ce coût de redéploiement par rapport à son propre coût d'exécution — environ 4 jours ou plus dans votre propre projet (4,55 $ US/jour) ou 2 jours ou plus dans un projet géré par RAD (105 crédits/jour).
- **La majeure partie du coût d'exécution est généralement l'infrastructure partagée.** La base de données ne s'arrête que si rien d'autre dans le projet ne l'utilise, donc la suppression d'Azimutt alors qu'une autre application partage le projet n'économise que la partie calcul d'Azimutt.
- **Conservez d'abord vos données.** Tout ce qu'Azimutt écrit dans un bucket de sauvegarde à l'intérieur du déploiement est supprimé avec lui — copiez la dernière sauvegarde (vers Google Drive, ou un bucket que vous conservez) avant de la supprimer si vous voulez la conserver.
- **RAD ne recrée pas un déploiement supprimé pour vous.** Vous saisissez à nouveau les paramètres lorsque vous redéployez.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant dispose d'Azimutt dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire exécute Azimutt pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais RAD et estimation des crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les mécanismes de pause/restauration. Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Azimutt s'exécute comme une seule charge de travail web Elixir/Phoenix écoutant sur le port **4000**. Le déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods Phoenix, auto-scalés horizontalement ; facturés pour le CPU/la mémoire demandés |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — Azimutt ne prend pas en charge MySQL ou d'autres moteurs |
| Stockage de fichiers | Cloud Filestore (NFS) | Optionnel, désactivé par défaut (`enable_nfs = false`) : Azimutt écrit les téléchargements dans son propre répertoire de travail éphémère, jamais sur ce montage (voir ci-dessous) |
| Stockage d'objets | Cloud Storage | Un bucket est provisionné (disponible pour un adaptateur de fichiers compatible S3) |
| Secrets | Secret Manager | `SECRET_KEY_BASE` Phoenix auto-généré ; mot de passe de la base de données |
| Build d'image | Cloud Build + Artifact Registry | Wrapper léger FROM `ghcr.io/azimuttapp/azimutt`, mis en miroir dans Artifact Registry |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé optionnel + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la couche d'application partagée ; la sélection de tout autre moteur interrompt le démarrage. Toutes les données du projet Azimutt résident dans Postgres.
- **Azimutt se connecte à Postgres via la boucle de rappel du proxy d'authentification (pas de SSL).** Ecto ne peut pas analyser le DSN du socket Cloud SQL, donc sur GKE, le point d'entrée construit `DATABASE_URL` contre `127.0.0.1` (le sidecar Cloud SQL Auth Proxy, qui termine TLS) avec `DATABASE_ENABLE_SSL=false`. `enable_cloudsql_volume = true` est requis.
- **`container_port` et les sondes doivent être 4000.** Sur GKE, la plateforme n'injecte **pas** automatiquement `PORT`, donc le point d'entrée par défaut `PORT=4000` ; le port du service et les sondes doivent correspondre ou le pod ne deviendra jamais Prêt même si l'application est saine.
- **NFS est désactivé par défaut** (`enable_nfs = false`) car rien dans ce module n'y écrit — `FILE_STORAGE_ADAPTER` reste `local`, donc les téléchargements atterrissent sur le disque éphémère du pod, que NFS soit monté ou non. Les données du projet elles-mêmes (schémas, diagrammes, mises en page, utilisateurs) résident dans Postgres et ne sont pas affectées.
- **`SECRET_KEY_BASE` est généré automatiquement** et stocké dans Secret Manager. Le faire pivoter après le premier démarrage déconnecte chaque session active ; ne le faites pivoter que pendant une fenêtre de maintenance.
- **Un minimum de 1 réplica est maintenu** (`min_instance_count = 1`) — GKE ne prend pas en charge la mise à l'échelle à zéro, gardant Azimutt toujours accessible.
- **Les migrations s'exécutent automatiquement à chaque démarrage** (`/app/bin/migrate && /app/bin/server`) ; prévoyez un temps supplémentaire au premier démarrage.
- **`application_version = "latest"` correspond au tag `main` d'Azimutt.** Épinglez à une version spécifique en production.
- **L'inscription est ouverte par défaut.** Restreignez l'accès après avoir créé votre premier compte.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres identifiants sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Azimutt {#a-gke-autopilot--the-azimutt-workload}

Les pods Azimutt sont planifiés sur Autopilot, qui facture le CPU/la mémoire que les pods demandent réellement. L'autoscaling horizontal des pods dimensionne le déploiement entre le nombre minimal et maximal de réplicas.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail Azimutt pour voir les pods, les révisions et les événements. Kubernetes Engine → Services et Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl logs -n "$NAMESPACE" deploy/<service-name> | grep cloud-entrypoint  # resolved DB wiring
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de charge de travail (Deployment vs StatefulSet).

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Azimutt stocke toutes les données de l'application (schémas, diagrammes, mises en page, utilisateurs, sources) dans une instance gérée de Cloud SQL pour PostgreSQL 15. Les pods y accèdent via le **sidecar Cloud SQL Auth Proxy** sur `127.0.0.1` (TLS terminé par le proxy, donc `DATABASE_ENABLE_SSL=false`). Lors du premier déploiement, un job d'initialisation crée la base de données et le rôle de l'application ; Azimutt exécute ensuite ses propres migrations Ecto au démarrage.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les flags, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe sont tous affichés dans les [Sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes et la rotation des mots de passe, voir [App_GKE](App_GKE.md).

### C. Cloud Filestore (NFS) et Cloud Storage {#c-cloud-filestore-nfs--cloud-storage}

NFS est **désactivé par défaut** (`enable_nfs = false`) ; s'il est activé, il est monté sur `nfs_mount_path`, mais il n'est pas connecté au chemin de stockage d'Azimutt — avec le `FILE_STORAGE_ADAPTER = local` par défaut, Azimutt écrit toujours les téléchargements dans son propre répertoire de travail éphémère plutôt que sur ce montage. Un bucket **Cloud Storage** est également provisionné (disponible si vous passez Azimutt à un adaptateur de fichiers compatible S3). Les données du projet elles-mêmes (schémas, diagrammes, mises en page, utilisateurs) résident dans Postgres et ne sont pas affectées dans les deux cas.

- **Console :** Filestore → Instances ; Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"
  ```

Voir [App_GKE](App_GKE.md) pour le provisionnement NFS, les options CMEK et les montages GCS Fuse.

### D. Secret Manager {#d-secret-manager}

Le **`SECRET_KEY_BASE`** de Phoenix est généré automatiquement et stocké dans Secret Manager (utilisé pour signer et chiffrer les cookies de session). Le mot de passe de la base de données est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~secret-key-base"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation du Secret Store CSI.

### E. Cloud Build et Artifact Registry {#e-cloud-build--artifact-registry}

L'image d'Azimutt est un wrapper léger construit À PARTIR de `ghcr.io/azimuttapp/azimutt` ; Cloud Build produit l'image wrappée et elle est mise en miroir dans Artifact Registry (`enable_image_mirroring = true`). Comme il s'agit d'une image reconstruite/mise en miroir, App_GKE définit `imagePullPolicy = Always` afin que les nœuds ne servent jamais une couche mise en cache obsolète.

- **Console :** Cloud Build → Historique ; Artifact Registry → Dépôts.
- **CLI :**
  ```bash
  gcloud builds list --project "$PROJECT" --limit 5
  gcloud artifacts docker images list <region>-docker.pkg.dev/$PROJECT/<repo> --include-tags
  ```

### F. Réseau et ingress {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe de Cloud Load Balancing (`service_type = LoadBalancer`). Un domaine personnalisé avec un certificat géré par Google peut être activé, et une adresse IP statique peut être réservée afin que l'adresse survive aux redéploiements. `session_affinity = ClientIP` maintient un client lié à un pod.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails des adresses IP statiques.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les métriques GKE et Cloud SQL sont acheminées vers Cloud Monitoring. Des tests de disponibilité et des stratégies d'alerte optionnels sont disponibles. Les lignes `cloud-entrypoint` affichent le chemin `DATABASE_URL` résolu, `PHX_HOST` et `PORT`.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Azimutt {#3-azimutt-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job d'initialisation exécute `db-init.sh` en utilisant `postgres:15-alpine`. Il crée de manière idempotente le rôle d'application (`LOGIN CREATEDB`) et la base de données, accorde `ALL` sur la base de données et le schéma `public`, et `ALTER` le propriétaire du schéma — Azimutt a besoin de tous les droits DDL car il exécute ses propres migrations. Le job signale ensuite au sidecar Auth Proxy de s'arrêter (`/quitquitquit`) afin que le pod du job se termine. Peut être réexécuté en toute sécurité.
- **Les migrations s'exécutent au démarrage.** La commande du conteneur est `/app/bin/migrate && /app/bin/server`, donc Ecto applique les migrations en attente à chaque démarrage avant que le point de terminaison Phoenix ne se lie. La mise à niveau de `application_version` applique automatiquement les modifications de schéma.
- **Le câblage de la base de données d'exécution est composé par le point d'entrée.** Sur GKE, `DATABASE_URL` est construit contre la boucle de rappel du proxy d'authentification (`127.0.0.1`) avec `DATABASE_ENABLE_SSL=false`, et `PORT` est défini par défaut sur 4000 (GKE ne l'injecte pas automatiquement). `PHX_HOST` est dérivé de l'URL du service injecté.
- **`SECRET_KEY_BASE` est stable et effectivement immuable.** Le faire pivoter invalide chaque cookie de session actif — tous les utilisateurs sont déconnectés. Ne le faites pivoter que pendant une fenêtre de maintenance.
- **Chemin de santé.** La sonde de démarrage cible la racine Phoenix `/` et la sonde de vivacité `/health`, toutes deux avec un délai initial de 60 secondes. La sonde de vivacité est mise en miroir dans le contrôle de santé de la passerelle, qui nécessite un 200 littéral, elle ne doit donc pas pointer vers `/`. Les sondes et `container_port` doivent toutes deux être **4000** ou le pod ne deviendra jamais Prêt.
- **Configuration initiale.** Accédez au service via son adresse IP externe de LoadBalancer (ou son domaine personnalisé) et créez le premier compte Azimutt via la page d'inscription. L'inscription est ouverte par défaut — restreignez l'accès par la suite.
- **Inspecter l'exécution du job d'initialisation :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour Azimutt sont listés ; toutes les autres entrées sont héritées de [App_GKE](App_GKE.md) avec son comportement et ses valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Emails auxquels sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `azimutt` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Azimutt` | Nom lisible par l'homme affiché dans l'interface utilisateur de la plateforme. |
| `application_version` | `latest` | Tag d'image Azimutt ; `latest` correspond au tag `main`. Épinglez à une version en production. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `min_instance_count` | `1` | Réplicas minimum ; GKE ne prend pas en charge la mise à l'échelle à zéro. |
| `max_instance_count` | `5` | Réplicas maximum. |
| `container_port` | `4000` | Phoenix écoute sur le port 4000 ; les sondes et le port du service doivent correspondre. |
| `enable_cloudsql_volume` | `true` | Sidecar Auth Proxy pour la connexion à la base de données `127.0.0.1` ; requis. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service Kubernetes est exposé. |
| `workload_type` | `null` | Déploiement par défaut ; se résout automatiquement en StatefulSet si `stateful_pvc_enabled = true`. |
| `session_affinity` | `ClientIP` | Routage persistant pour qu'un client reste sur un pod. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Laisser vide — Azimutt est basé sur NFS et stocke les données du projet dans Postgres. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protéger la disponibilité pendant les mises à niveau des nœuds. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/`, délai de 60s, fenêtre d'échec de 30 × 15s | Sonde de démarrage ; laisser le temps pour les migrations au premier démarrage. Doit cibler le port 4000. |
| `liveness_probe` | HTTP `/health`, délai de 60s | Sonde de vivacité ; également le contrôle de santé de la passerelle, qui nécessite un 200 littéral. |
| `startup_probe_config` / `health_check_config` | HTTP `/`, sondes d'infrastructure au niveau App_GKE | Sondes structurées. |
| `uptime_check_config` | désactivé, chemin `/` | Vérification de disponibilité Cloud Monitoring facultative. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Désactivé par défaut : rien dans ce module n'écrit sur le montage NFS. Azimutt stocke les téléchargements avec `FILE_STORAGE_ADAPTER = local` sur le disque éphémère du conteneur ; les téléchargements durables nécessitent l'adaptateur `s3` d'Azimutt_Common, que l'activation de NFS n'a jamais fourni. Les données du projet résident dans PostgreSQL. |
| `nfs_mount_path` | `/opt/azimutt/storage` | Chemin de montage à l'intérieur du conteneur. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 15 — Cache et file d'attente Redis {#group-15--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Désactivé par défaut — Azimutt utilise PostgreSQL (Oban) pour les jobs en arrière-plan, pas Redis. |
| `redis_host` | `""` | Point de terminaison Redis (uniquement si une fonctionnalité en aval le requiert). |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_database_name` | `azimutt` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `application_database_user` | `azimutt` | Utilisateur de la base de données de l'application. Immuable après le premier déploiement. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupes 19-22 — Domaine personnalisé, IAP, Cloud Armor, VPC-SC {#groups-1922--custom-domain-iap-cloud-armor-vpc-sc}

Comportement standard d'App_GKE — `enable_custom_domain`, `reserve_static_ip`,
`enable_iap`, `enable_cloud_armor`, `enable_vpc_sc`, `enable_audit_logging`. Voir
[App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Carte des ClusterIP pour les services spécifiques à chaque étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Azimutt. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via le proxy d'authentification) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | Statut et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'importation (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
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

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur de fondation [App_GKE](App_GKE.md), qui valide les valeurs *et les combinaisons* au moment de la planification — un réplica en lecture sans son primaire, IAP sans identités autorisées, un runtime `gen1` avec des montages NFS/GCS, un `database_type` qui ne correspond pas à une extension activée, un `redis_port`/`backup_retention_days` hors plage, un `quota_memory_*` entier nu. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `SECRET_KEY_BASE` (auto-généré) | Ne jamais faire pivoter en dehors d'une fenêtre de maintenance | Critique | Le faire pivoter invalide chaque cookie de session actif — tous les utilisateurs sont déconnectés. |
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/le rôle et orpheline toutes les données Azimutt. |
| `container_port` | `4000` | Critique | Le point d'entrée par défaut `PORT=4000` sur GKE ; un port de service ou un port de sonde non concordant atteint un port mort et le pod ne devient jamais Prêt. |
| `enable_cloudsql_volume` | `true` | Critique | Le sidecar Auth Proxy fournit la connexion à la base de données `127.0.0.1` ; le désactiver laisse Azimutt sans base de données et bloque le démarrage `db-init`. |
| `enable_nfs` | `false` | Faible | L'activer provisionne Filestore, mais n'a aucun effet sur Azimutt lui-même — `FILE_STORAGE_ADAPTER` n'est jamais pointé vers le montage NFS, donc les téléchargements atterrissent toujours sur le disque éphémère du pod, quel que soit ce paramètre (les données du projet elles-mêmes sont en sécurité dans Postgres). |
| `min_instance_count` | `1` | Élevé | GKE exige min ≥ 1 ; la garde de validation rejette les valeurs invalides. |
| `application_version` | Épinglez une version | Élevé | `latest` correspond au tag roulant `main` ; un changement inattendu en amont peut casser un redéploiement. |
| `session_affinity` | `ClientIP` | Moyen | Sans persistance, les sessions UI rebondissent entre les pods. |
| `enable_iap` / domaine personnalisé | Restreindre après le premier compte | Élevé | L'inscription est ouverte par défaut ; laisser le LoadBalancer accessible publiquement permet à quiconque de créer un compte. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers nus sont traités comme des octets et bloquent toute planification de pod dans l'espace de noms. |
| `enable_redis` | `false` | Faible | Azimutt utilise Postgres/Oban, pas Redis — l'activer n'a aucun effet sur Azimutt lui-même. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**. La
configuration d'application spécifique à Azimutt partagée avec la variante Cloud Run est
décrite dans **[Azimutt_Common](Azimutt_Common.md)**.

<!-- related-guides -->

## Guides connexes {#related-guides}

- [Lab pratique : Azimutt sur GKE Autopilot](../labs/Azimutt_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Azimutt sur Google Cloud Run](Azimutt_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Azimutt Common — Configuration d'application partagée](Azimutt_Common.md) — la configuration partagée par les deux cibles de déploiement.
