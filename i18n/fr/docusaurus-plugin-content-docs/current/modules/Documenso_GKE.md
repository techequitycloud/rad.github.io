---
title: "Documenso sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Documenso sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Documenso_GKE.md @ 1665a43e sha256:c3b11f1cb01f -->

# Documenso sur GKE Autopilot {#documenso-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Documenso_GKE.png" alt="Documenso sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Documenso est une alternative open source à DocuSign — une application Next.js
pour envoyer, signer et gérer des documents de signature électronique sur une
infrastructure que vous contrôlez. Ce module déploie Documenso sur **GKE
Autopilot** en s'appuyant sur la fondation [App_GKE](App_GKE.md), qui
provisionne et gère l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Documenso et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE
— Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — veuillez vous référer au [guide de la fondation
App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## Ce que coûte Documenso sur RAD, et comment cela se compare {#what-documenso-costs-on-rad-and-how-that-compares}

**Le module Documenso sur GKE Autopilot de RAD coûte environ 142,62 $ US par mois, sans licence par signataire.** Cela se compare à 25 $ US par mois pour le plan Individuel de Documenso ou 40 $ US par mois pour son plan Équipes (5 utilisateurs, 8 $ US par utilisateur supplémentaire). Un serveur autogéré est moins cher en espèces, mais vous gérez alors la base de données, les sauvegardes, les correctifs de sécurité et les mises à niveau vous-même. Pour le coût le plus bas, le [guide Cloud Run](Documenso_CloudRun.md) exécute le même Documenso pour environ 83,61 $ US par mois. Les chiffres sont à jour au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

Si vous n'en avez besoin qu'occasionnellement — pour des études, une démo, une activité saisonnière — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits, de sorte que les 142,62 $ US deviennent quelques dollars par mois. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 110 crédits (11 $ US au prix de la recharge) | 99 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Le même |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **142,62 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **108 crédits par jour**, environ 3 240 par mois (environ 324 $ US au prix de la recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge unique, et moins pour un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Pod GKE Autopilot, 2x vCPU / 2 Gio | 72,16 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 |
| **Total** | **environ 142,62 $ US** |

### Comment cela se compare {#how-it-compares}

| Option | Par mois | Qui l'exécute |
|---|---|---|
| Documenso, plan Individuel | 25 $ US par mois | Documenso |
| Documenso, plan Équipes (5 utilisateurs) | 40 $ US par mois | Documenso |
| **RAD, GKE Autopilot, votre propre projet** | **Environ 142,62 $ US** | Automatisation de RAD, dans votre projet |
| **RAD, GKE Autopilot, un projet géré par RAD** | **Environ 324 $ US** | RAD |

- Les plans hébergés de Documenso facturent par mois, quel que soit le nombre de documents que vous signez réellement ; le coût de RAD est l'infrastructure, qui est la même que vous envoyiez une enveloppe par mois ou cent.
- Le plan gratuit de Documenso vous limite à 5 documents par mois — le module de RAD exécute le même logiciel open source sans limite de documents.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Documenso s'exécute dans **un projet géré par RAD pour vous**, vous avez une deuxième option qui va bien
au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour presque
rien.** Cela convient bien mieux à Documenso dont vous n'avez besoin qu'occasionnellement — pour des études, une démo, une activité saisonnière — que de le faire fonctionner en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google
  de supprimer le projet. Google ne supprime pas le projet immédiatement : il le conserve, récupérable,
  pendant 30 jours. Comme la facturation est déjà déliée, rien n'est facturé pendant qu'il attend. Contrairement
  à la suppression d'un module, cela ne supprime pas Cloud SQL, la VM NFS ou le pod GKE un par un — l'ensemble du projet,
  et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet
  peut le restaurer. RAD demande à Google de restaurer le projet et de rattacher son compte de facturation,
  puis vous demande d'exécuter **Mettre à jour** sur chaque déploiement pour confirmer que tout est revenu. Parce que
  rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est
  une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela coûte **une
  poignée de crédits (moins de 1 $ US)** au total pour une chaîne de déploiement typique de la taille de Documenso, contre
  les 104 crédits (10,35 $ US) que coûte un redéploiement complet.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, pas 142,62 $ US.** Déployez Documenso, utilisez-le
  pendant un certain temps, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Mettre à jour, et
  supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez les frais de module qu'une seule fois, les builds, et
  les heures pendant lesquelles Documenso était réellement en ligne.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un projet que vous avez apporté et dont RAD ne gère
  que la facturation), et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime
  définitivement. La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés
  doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude et de démo
  conviennent). Google indique que la plupart des services fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.
- **Un véritable manque : les sauvegardes nocturnes ne survivent pas.** Les sauvegardes sont écrites dans un bucket à l'intérieur
  du projet, et ce bucket n'est **pas** protégé par la suppression logicielle de Cloud Storage, il est donc
  très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est
  récupérable pendant 30 jours. Si vous avez personnalisé les données et que vous souhaitez les conserver, copiez une sauvegarde
  (vers Google Drive, ou un bucket en dehors du projet) avant de supprimer, comme pour le flux de travail de redéploiement ci-dessous. Pour une
  installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

GKE maintient au moins un pod en cours d'exécution, il ne se met donc jamais à l'échelle à zéro de lui-même. L'option ci-dessus
ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ 114 crédits
  (11,45 $ US), et environ une heure, car RAD recrée le projet et les services partagés avant Documenso. La suppression permet d'économiser de l'argent une fois que Documenso resterait inutilisé
  pendant environ **2 jours ou plus** dans votre propre projet (environ 4,75 $ US par jour), ou environ
  **1 jour ou plus** dans un projet géré par RAD (108 crédits par jour).
- **Supprimez tout ce que Documenso utilise.** La majeure partie du coût d'exécution est la base de données et la VM NFS/cache. Elles ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc la suppression de Documenso alors que quelque chose d'autre partage le projet n'économise que la partie calcul de Documenso.
- **Conservez d'abord vos données.** Les sauvegardes nocturnes de la base de données sont écrites dans un bucket à l'intérieur du déploiement, et ce bucket est supprimé avec lui. Avant de supprimer, copiez la dernière sauvegarde sur Google Drive, ou dans un bucket que vous conservez.
- **Notez vos paramètres.** RAD ne recrée pas un déploiement supprimé pour vous ; vous entrez les
  paramètres à nouveau lorsque vous déployez.

### Sessions de labo et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de labo, pour la formation.** Un formateur anime une session pour une classe. Chaque participant dispose de Documenso dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute Documenso pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais propres à RAD et estimations de crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les mécanismes et la fenêtre de pause/restauration. [Tarification Documenso](https://documenso.com/pricing) pour les chiffres des plans Individuel et Équipes ;

## 1. Vue d'ensemble {#1-overview}

Documenso s'exécute comme une seule charge de travail Next.js construite à partir d'une image personnalisée légère
basée sur l'image officielle `documenso/documenso`. Le déploiement connecte
un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods Next.js sur le port 3000, 2 vCPU / 2 Gio par défaut |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — le moteur est fixé à `POSTGRES_15` ; MySQL n'est pas pris en charge |
| Persistance des fichiers | Cloud Filestore (NFS) | Activé par défaut, monté à `/mnt/nfs`, mais non utilisé pour le stockage de documents (voir ci-dessous) |
| Stockage d'objets | Cloud Storage | Un bucket `uploads` + compte de service HMAC, provisionné pour le transport de téléchargement compatible S3 en option |
| Secrets | Secret Manager | `NEXTAUTH_SECRET`, `NEXT_PRIVATE_ENCRYPTION_KEY`, `NEXT_PRIVATE_ENCRYPTION_SECONDARY_KEY`, clés HMAC et (en option) mot de passe SMTP auto-générés ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing / Gateway API | Domaine personnalisé activé par défaut avec une IP statique réservée ; revient à un nom d'hôte `nip.io` si aucun domaine n'est défini |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** `database_type = "POSTGRES_15"` est la
  valeur par défaut. La pile Next.js + Prisma de Documenso ne prend pas en charge MySQL, mais
  contrairement à d'autres modules, ce n'est **pas appliqué par une précondition de plan** —
  changer `database_type` de Postgres casse silencieusement
  l'application plutôt que de faire échouer le plan.
- **Build personnalisé, non pré-construit.** `container_image_source = "custom"` construit une
  image légère `FROM docker.io/documenso/documenso:${DOCUMENSO_VERSION}` qui
  ajoute `bash`, `curl`, `postgresql-client`, et `openssl`, plus un
  point d'entrée personnalisé. Le `sh start.sh` de l'image amont exécute les migrations Prisma
  et démarre le serveur Next.js — il n'y a pas de job de migration séparé.
- **Cloud SQL est atteint via le sidecar Auth Proxy.** `enable_cloudsql_volume
  = true` exécute un sidecar cloud-sql-proxy ; le point d'entrée assemble
  `NEXT_PRIVATE_DATABASE_URL` à partir des valeurs `DB_*` injectées, en se basant sur
  un socket Unix, un proxy `127.0.0.1`, ou une IP directe + SSL selon ce qui est
  injecté.
- **Redis est désactivé par défaut et non requis.** Documenso utilise un
  fournisseur de jobs locaux basé sur PostgreSQL (`enable_redis = false`). Activez-le
  uniquement si vous passez Documenso au fournisseur de jobs `bullmq` (Redis).
- **NFS est activé par défaut mais Documenso ne l'utilise pas pour les documents.**
  Les documents sont stockés dans PostgreSQL par défaut
  (`NEXT_PUBLIC_UPLOAD_TRANSPORT = "database"`). L'instance Filestore que cela
  provisionne existe principalement comme hôte Redis de secours requis par la précondition du plan
  lorsque `enable_redis = true` — avec Redis désactivé (par défaut), c'est
  un surcoût effectivement inutilisé.
- **Un certificat de signature est requis pour la signature réelle de documents.**
  `NEXT_PRIVATE_SIGNING_TRANSPORT = "local"` attend un certificat `.p12`. Si
  aucun n'est fourni, le point d'entrée auto-génère un certificat auto-signé
  jetable afin que l'application démarre — mais la signature avec celui-ci n'est pas
  sûre pour la production.
- **`webapp_url` est vide par défaut.** Tant qu'il n'est pas défini, `NEXTAUTH_URL` et
  `NEXT_PUBLIC_WEBAPP_URL` sont par défaut `http://localhost:3000` ; le point d'entrée
  les met à niveau vers le `GKE_SERVICE_URL` injecté par la plateforme
  automatiquement au démarrage, mais la définition explicite de `webapp_url` est recommandée une fois qu'un domaine stable est connu.
- **Mise à l'échelle à zéro par défaut.** `min_instance_count = 0`,
  `max_instance_count = 3`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region "$REGION" --project "$PROJECT"`
et que `PROJECT`, `REGION`, et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Documenso {#a-gke-autopilot--the-documenso-workload}

Les pods Documenso sont planifiés sur Autopilot, qui facture le CPU/la mémoire que les pods demandent réellement. La charge de travail est un `Deployment` standard (non basé sur NFS dans le sens qui compte pour la stratégie de déploiement, puisque les documents résident dans Postgres, et non sur le partage NFS monté).

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail Documenso pour les pods, les révisions et les événements. Kubernetes Engine → Services et Ingress affiche l'IP/le nom d'hôte externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE" --selector="app.kubernetes.io/name=documenso" 2>/dev/null \
    || kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de charge de travail (Déploiement vs StatefulSet).

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Documenso stocke toutes les données d'application (utilisateurs, documents, destinataires, événements d'audit) dans une instance gérée de Cloud SQL pour PostgreSQL 15. Les pods l'atteignent via le sidecar **Cloud SQL Auth Proxy** ; aucune IP publique n'est exposée. Lors du premier déploiement, le job `db-init` crée le rôle et la base de données de l'application ; l'image Documenso elle-même exécute ensuite ses propres migrations Prisma au démarrage du conteneur.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT" --filter="name~documenso"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret Secret Manager contenant le mot de passe sont tous dans les [Sorties](#5-outputs). Voir [App_GKE](App_GKE.md) pour le modèle de connexion, les sauvegardes automatisées et la rotation des mots de passe.

### C. Cloud Storage et persistance des fichiers {#c-cloud-storage--file-persistence}

Un bucket **Cloud Storage** dédié (suffixe `uploads`, compatible CORS pour
l'accès direct depuis le navigateur) et un compte de service détenant une **clé HMAC** sont
provisionnés automatiquement, accordant au SA de stockage `roles/storage.objectAdmin`
sur le bucket. Il s'agit d'une infrastructure optionnelle : Documenso n'y écrit que si
vous définissez `NEXT_PUBLIC_UPLOAD_TRANSPORT=s3` et connectez les variables d'environnement secrètes `S3_ACCESS_KEY` /
`S3_SECRET_KEY` — par défaut, les documents sont stockés dans
PostgreSQL. Séparément, un volume **NFS (Cloud Filestore)** est monté à
`/mnt/nfs` mais n'est pas écrit par l'application dans sa configuration
par défaut.

- **Console :** Cloud Storage → Buckets ; Filestore → Instances.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~documenso"
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### D. Secret Manager {#d-secret-manager}

Documenso nécessite trois secrets au démarrage — `NEXTAUTH_SECRET`,
`NEXT_PRIVATE_ENCRYPTION_KEY`, et `NEXT_PRIVATE_ENCRYPTION_SECONDARY_KEY` —
tous validés par Zod par l'application Next.js, qui ne démarrera pas sans eux.
De plus, `S3_ACCESS_KEY` / `S3_SECRET_KEY` (informations d'identification HMAC, utilisées uniquement si
le transport de téléchargement S3 est activé) et, lorsque `smtp_host` est défini,
`NEXT_PRIVATE_SMTP_PASSWORD` sont générés. Le mot de passe de la base de données est géré
séparément par la fondation. Sur GKE, les secrets sont projetés dans les pods via le
pilote CSI du Secret Store.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~documenso"
  gcloud secrets versions access latest --secret=<nextauth-secret-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation du Secret Store CSI.

### E. Réseau et ingress {#e-networking--ingress}

Contrairement à de nombreux modules d'application, Documenso active par défaut `enable_custom_domain =
true` : une passerelle Kubernetes avec une IP statique réservée est provisionnée
automatiquement. Si `application_domains` est laissé vide, un nom d'hôte `nip.io`
basé sur l'IP statique auto-générée est utilisé afin que l'application soit accessible via
HTTPS immédiatement.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get svc,gateway -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails de l'IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les métriques GKE et Cloud SQL sont acheminées vers Cloud Monitoring. Des vérifications de disponibilité et des politiques d'alerte optionnelles sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Documenso {#3-documenso-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job `db-init` exécute `db-init.sh` en utilisant
  `postgres:15-alpine`. Il attend que Cloud SQL accepte les connexions, puis
  crée de manière idempotente le rôle et la base de données de l'application (privilège `CREATEDB`,
  propriété définie sur la base de données cible), accorde les privilèges de schéma,
  et enfin signale au sidecar Cloud SQL Auth Proxy (`POST
  /quitquitquit`) de s'arrêter afin que le job puisse se terminer. Le job peut être
  réexécuté en toute sécurité (`execute_on_apply = true`, `max_retries = 3`).
- **Les migrations s'exécutent automatiquement, pas de job séparé.** Le `start.sh` de l'image officielle Documenso
  exécute les migrations Prisma contre `NEXT_PRIVATE_DATABASE_URL` à chaque démarrage du conteneur,
  puis lance le serveur autonome Next.js.
- **`NEXT_PRIVATE_DATABASE_URL` est assemblé au démarrage.** Le point d'entrée personnalisé
  le construit à partir des `DB_USER`/`DB_PASSWORD`/`DB_HOST`/
  `DB_NAME`/`DB_PORT` injectés par la plateforme, en fonction de si `DB_HOST` est un chemin de socket Unix, un
  bouclage `127.0.0.1` Auth Proxy, ou une IP directe (auquel cas
  `sslmode=require` est forcé). `NEXT_PRIVATE_DIRECT_DATABASE_URL` le reflète.
- **Pas de compte administrateur de démarrage.** Ce module ne crée pas d'utilisateur administrateur/propriétaire Documenso. La première personne à s'inscrire via l'interface utilisateur web de l'application devient le propriétaire du compte — comportement standard de Documenso en amont, non provisionné par ce module.
- **Le certificat de signature est une étape post-déploiement requise pour la signature réelle.**
  Sans certificat fourni, le point d'entrée auto-génère un certificat auto-signé jetable `.p12` à `/opt/documenso/cert.p12` afin que l'application démarre et que les fonctionnalités non liées à la signature fonctionnent, en affichant un avertissement sonore. Pour la signature en production, fournissez un certificat réel via `secret_environment_variables` en mappant
  `NEXT_PRIVATE_SIGNING_LOCAL_FILE_CONTENTS` (`.p12` encodé en base64) et
  `NEXT_PRIVATE_SIGNING_PASSPHRASE`.
- **Résolution de l'URL de l'application web.** `NEXTAUTH_URL` / `NEXT_PUBLIC_WEBAPP_URL` par défaut
  à `http://localhost:3000`. Si toujours à cette valeur par défaut lorsque le conteneur
  démarre, le point d'entrée écrase les deux avec le
  `GKE_SERVICE_URL` injecté par la plateforme. Définissez `webapp_url` explicitement une fois qu'un domaine personnalisé est
  enregistré afin que les rappels OAuth/e-mail restent stables lors des redéploiements.
- **Chemin de santé.** La sonde de démarrage est **HTTP** `GET /` sur le port 3000 avec un
  budget généreux (`period_seconds = 30`, `failure_threshold = 20`, ≈10
  minutes) pour absorber le démarrage à froid plus les migrations Prisma ; la sonde de vivacité est
  **HTTP** `GET /` avec un délai initial de 60s. Documenso n'a pas de point de terminaison de santé dédié.
- **Inspectez le job d'initialisation et la configuration en cours d'exécution :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E 'DATABASE_URL|WEBAPP_URL|SIGNING'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement telles qu'elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour Documenso sont listés ; toutes les autres entrées sont héritées de [App_GKE](App_GKE.md) avec son comportement et ses valeurs par défaut standard. La liste complète de toutes les variables déclarées, y compris celles héritées inchangées de la Fondation, se trouve dans le [README du module](https://github.com/techequitycloud/partner-modules/blob/main/modules/Documenso_GKE/README.md).

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources pour le suivi des coûts/de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `documenso` | Nom de base pour les ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Documenso` | Nom lisible par l'homme affiché dans la console GCP. |
| `application_version` | `latest` | Définit l'argument de build `DOCUMENSO_VERSION` pour l'image de base `FROM docker.io/documenso/documenso:${DOCUMENSO_VERSION}` construite sur mesure. |
| `description` | `"Documenso - The Open Source DocuSign Alternative"` | Remplit le champ de description de la charge de travail GKE. |
| `application_description` | `"Documenso on GKE Autopilot"` | **Non référencé** — `description` (ci-dessus) a la priorité et contrôle la description de la charge de travail à la place. |
| `webapp_url` | `""` | URL publique de l'instance. Définir après le premier déploiement (ou l'enregistrement d'un domaine personnalisé) afin que les rappels NextAuth et les liens e-mail soient stables. |
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure, sans déployer la charge de travail. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` | `2000m` | 2 vCPU par pod (remplacement spécifique à l'application ; la variable générique `container_resources` n'est pas transmise pour ce module). |
| `memory_limit` | `2Gi` | Mémoire par pod. |
| `min_instance_count` | `0` | Mise à l'échelle à zéro par défaut. |
| `max_instance_count` | `3` | Plafond HPA. |
| `container_port` | `3000` | Port du serveur Next.js de Documenso. |
| `container_protocol` | `http1` | HTTP/1.1 ; `h2c` est disponible si un futur amont nécessite gRPC/HTTP2. |
| `timeout_seconds` | `300` | Durée maximale de la requête. |
| `enable_cloudsql_volume` | `true` | Sidecar Auth Proxy — requis pour la connectivité DB sur GKE. |
| `enable_image_mirroring` | `true` | Met en miroir l'image construite dans Artifact Registry. |
| `container_image_source` / `container_image` / `container_resources` / `container_build_config` | — | **Non référencé.** `Documenso_Common` effectue toujours la construction personnalisée et définit ses propres limites de ressources à partir de `cpu_limit`/`memory_limit` ; ces variables reflétées par la Fondation n'ont aucun effet sur ce module. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Variables d'environnement supplémentaires en texte clair ; les variables Documenso principales sont injectées automatiquement. |
| `secret_environment_variables` | `{}` | Références Secret Manager supplémentaires injectées comme variables d'environnement. |
| `smtp_host` | `""` | Nom d'hôte du serveur SMTP. Laissez vide pour désactiver l'e-mail (invitations, notifications de signature). |
| `smtp_port` / `smtp_secure_enabled` | `587` / `false` | Utilisez `465` + `true` pour TLS implicite, sinon STARTTLS sur `587`. |
| `smtp_user` | `""` | Nom d'utilisateur d'authentification SMTP. |
| `smtp_password` | `""` | Génère automatiquement une valeur Secret Manager lorsqu'il est vide et que `smtp_host` est défini. |
| `mail_from` | `""` | Adresse de l'expéditeur pour les e-mails Documenso sortants. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | IP externe/passerelle pour l'interface utilisateur de Documenso. |
| `workload_type` | `Deployment` | Documenso n'utilise pas de StatefulSet/PVC. |
| `session_affinity` | `ClientIP` | Routage persistant pour qu'un client atteigne le même pod. |
| `network_tags` | `["nfsserver"]` | Requis pour la connectivité NFS lorsque `enable_nfs = true` (par défaut). |
| `gke_cluster_name` / `namespace_name` | `""` | Laissez vide pour la découverte automatique / le nom d'espace de noms auto-généré. |
| `gke_cluster_selection_mode` / `enable_multi_cluster_service` / `prereq_gke_subnet_cidr` / `extra_service_ports` | — | **Non référencé** par ce module — variables reflétées par la Fondation sans effet ici. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

Non utilisé par Documenso (`workload_type = "Deployment"` par défaut). Toutes les variables `stateful_*` sont héritées inchangées de [App_GKE](App_GKE.md).

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

`enable_resource_quota` et toutes les variables `quota_*` sont déclarées pour la parité de convention de la Fondation mais ne sont **pas transmises** par ce module — elles n'ont aucun effet sur le déploiement de Documenso.

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protège la disponibilité pendant les mises à niveau de nœuds. |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles pendant les perturbations volontaires. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/`, `failure_threshold=20`, `period_seconds=30` | Sonde spécifique à Documenso transmise via la sortie `config` du module commun ; remplace effectivement la valeur par défaut générique `startup_probe_config` de la Fondation pour cette application. |
| `liveness_probe` | HTTP `/`, `initial_delay_seconds=60`, `failure_threshold=3` | Même mécanisme que `startup_probe` ; remplace la valeur par défaut générique `health_check_config`. |
| `uptime_check_config` | désactivé | Vérification de disponibilité optionnelle de Cloud Monitoring. |

### Groupe 11 — Automatisation de la charge de travail {#group-11--workload-automation}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré (crée uniquement la base de données et le rôle). |
| `cron_jobs` / `additional_services` | `[]` | Pas de jobs planifiés ni de sidecars par défaut. |

### Groupe 12 — Intégration CI/CD et GitHub {#group-12--cicd--github-integration}

Intégration standard de Cloud Build / Cloud Deploy d'App_GKE — voir
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`, `binauthz_evaluation_mode` (ce dernier **est**
transmis par Documenso, contrairement à plusieurs autres variables reflétées du Groupe 12 dans
d'autres modules).

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Provisionne Filestore. Non utilisé pour le stockage de documents par défaut — voir [Vue d'ensemble](#1-overview). Principalement pertinent comme hôte Redis de secours si `enable_redis` est activé ultérieurement. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur (non utilisé par la configuration par défaut de l'application). |
| `nfs_instance_name` / `nfs_instance_base_name` | `""` / `app-nfs` | VM NFS existante à réutiliser, ou le nom de base pour une VM intégrée. |
| `nfs_volume_name` | `nfs-data-volume` | **Non transmis** par ce module — n'a aucun effet. |

### Groupe 14 — Cloud Storage {#group-14--cloud-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `storage_buckets` | `[{ name_suffix = "data" }]` | `Documenso_Common` provisionne également toujours son propre bucket `uploads` (compatible CORS), indépendamment de ce paramètre. |
| `gcs_volumes` | `[]` | Aucun volume GCS Fuse monté par défaut. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Rétention d'image Artifact Registry. |

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Documenso utilise un fournisseur de jobs locaux basé sur PostgreSQL et ne nécessite pas Redis. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Pertinent uniquement si vous passez Documenso au fournisseur de jobs `bullmq`. |
| `cubejs_api_url` / `hub_api_url` | `http://localhost:4000` / `http://localhost:8080` | **Restes inertes** du modèle de variable dérivé de Formbricks de ce module — transmis à `Documenso_Common` mais jamais lu par aucune variable d'environnement, Dockerfile ou logique de point d'entrée. Aucun effet sur le déploiement. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | **Non appliqué au moment du plan** — le fait de modifier cette valeur pour autre chose que Postgres rompt le schéma Prisma de Documenso au moment de l'exécution plutôt que de faire échouer le plan. |
| `db_name` | `documenso` | La base de données réellement créée et injectée comme `DB_NAME`. |
| `db_user` | `documenso` | Le rôle réellement créé et injecté comme `DB_USER` ; mot de passe auto-généré dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe auto-généré. |
| `enable_postgres_extensions` / `postgres_extensions` | `false` / `[]` | Le schéma Prisma de Documenso ne nécessite aucune extension personnalisée. |
| `enable_mysql_plugins` / `mysql_plugins` | `false` / `[]` | Non applicable — Documenso nécessite PostgreSQL. |
| `sql_instance_name` / `sql_instance_base_name` | `""` / `app-sql` | Instance Cloud SQL existante à réutiliser, ou le nom de base pour une instance intégrée. |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | `false` / `90` | Rotation du mot de passe de la base de données sans interruption de service. |

`application_database_name` (par défaut `documensodb`) et
`application_database_user` (par défaut `documensouser`) sont également déclarés sur
ce module mais ne sont **pas transmis** à la Fondation — `main.tf` connecte
`db_name`/`db_user` (ci-dessus) à la place. La définition des variables `application_database_*`
n'a aucun effet. Les cinq variables `db_*_env_var_name` (hôte, nom,
mot de passe, port, utilisateur) sont également déclarées mais non transmises.

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. `backup_uri` est la valeur réellement transmise à la Fondation. |
| `backup_file` | `backup.sql` | **Non référencé** — `backup_uri` (ci-dessus) est ce qui est réellement utilisé ; la définition de `backup_file` n'a aucun effet. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutez du SQL à partir d'un bucket GCS après le provisionnement. Voir
[App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne une passerelle + IP statique par défaut (contrairement à la plupart des autres modules, qui désactivent cela par défaut). |
| `application_domains` | `[]` | Si vide, un nom d'hôte `nip.io` basé sur l'IP statique auto-générée est utilisé. |
| `reserve_static_ip` | `true` | Maintient l'adresse externe stable lors des redéploiements. |
| `static_ip_name` | `""` | Laissez vide pour une génération automatique. |
| `network_name` | `""` | **Non référencé** — la découverte réseau est codée en dur en interne ; n'a aucun effet. |

### Groupe 20 — Proxy conscient de l'identité (IAP) {#group-20--identity-aware-proxy-iap}

`enable_iap`, `iap_authorized_users`/`iap_authorized_groups`,
`iap_oauth_client_id`/`iap_oauth_client_secret` (sensible), `iap_support_email`
— filtrage IAP standard d'App_GKE devant la passerelle. Voir [App_GKE](App_GKE.md).

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

`enable_cloud_armor`, `admin_ip_ranges`, `cloud_armor_policy_name`, `enable_cdn`
— configuration WAF/CDN standard d'App_GKE. Voir [App_GKE](App_GKE.md).

### Groupe 22 — Contrôles de service VPC et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

`enable_vpc_sc`, `vpc_cidr_ranges`, `vpc_sc_dry_run`, `organization_id`,
`enable_audit_logging` — configuration de périmètre VPC-SC standard d'App_GKE. Voir
[App_GKE](App_GKE.md).

### Groupe 0 — Métadonnées du module {#group-0--module-metadata}

Métadonnées de la plateforme/UI uniquement (`module_description`, `module_documentation`,
`module_dependency`, `requires_services`, `module_services`, `credit_cost`,
`require_credit_purchases`, `enable_purge`, `public_access`,
`require_services_gcp_module`, `shared_users`, `technical_support_users`,
`resource_creator_identity`, `impersonation_service_account`,
`job_execution_wait_timeout`) plus trois variables déclarées mais inertes
(`application_module`, `explicit_secret_values`, `scripts_dir` — le module
connecte ses propres valeurs secrètes et son chemin de scripts en interne à partir de
`Documenso_Common`). Aucune de celles-ci n'affecte l'infrastructure déployée ; voir le
[README du module](https://github.com/techequitycloud/partner-modules/blob/main/modules/Documenso_GKE/README.md#module-metadata-group-0)
pour le tableau complet.

Toutes les autres entrées suivent le comportement standard de [App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen
le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Mappage des ClusterIP pour les services spécifiques à chaque étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Documenso. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (via le proxy d'authentification) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (le bucket `uploads`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration (`db-init`) et d'importation (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration via le moteur de base [App_GKE](App_GKE.md), qui valide les valeurs *et les combinaisons* au moment du plan — un `StatefulSet` forcé à côté d'un paramètre sans état, IAP sans identités autorisées, `quota_memory_*` donné comme des entiers bruts, un `container_port`/`backup_retention_days` hors de portée. Le `validation.tf` de ce module bloque en outre `min_instance_count > max_instance_count`, `enable_redis = true` sans `redis_host` ni `enable_nfs`, `enable_iap = true` sans les deux identifiants OAuth, et `enable_cloudsql_volume = true` avec `database_type = "NONE"`. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource — mais `database_type` loin de Postgres n'est *pas* l'une des vérifications, donc cette erreur n'est détectée qu'à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critique | Non validé par le plan — le passage à MySQL/SQL Server rompt Prisma et toutes les requêtes à l'exécution, pas au moment du plan. |
| Certificat de signature (`NEXT_PRIVATE_SIGNING_LOCAL_FILE_CONTENTS`) | Fournir un vrai `.p12` après le déploiement | Critique | Sans cela, le point d'entrée auto-signe un certificat jetable — les documents "signent" mais la signature n'est pas fiable pour les lecteurs de PDF ; non sûr pour la production. |
| `NEXT_PRIVATE_ENCRYPTION_KEY` / `_SECONDARY_KEY` (auto-généré) | Ne jamais modifier directement | Critique | Ceux-ci chiffrent les données Documenso ; ne les faites pivoter que via l'emplacement de la clé secondaire, jamais en régénérant la clé primaire sur place. |
| `webapp_url` | Définir une fois que l'URL/le domaine est connu | Élevé | S'il n'est pas défini, `NEXTAUTH_URL`/`NEXT_PUBLIC_WEBAPP_URL` suivent ce que `GKE_SERVICE_URL` résout à chaque démarrage ; une valeur explicite maintient la stabilité des rappels d'authentification et des liens e-mail lors des redéploiements. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy est requis pour le chemin de connectivité de base de données par défaut du point d'entrée sur GKE. |
| `db_name` / `db_user` | Définir une fois | Élevé | Le renommage après le premier déploiement pointe l'application vers un rôle/une base de données différente (vide) — `application_database_name`/`application_database_user` sont des leurres inertes ; les modifier n'a aucun effet. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont traités comme des octets et bloquent toute planification de pod dans l'espace de noms. |
| `enable_nfs` | `true` (par défaut) ou `false` si Redis reste désactivé | Moyen | Filestore est facturé que l'application y écrive ou non ; avec `enable_redis = false` (par défaut), le montage NFS est un surcoût inutilisé. |
| `smtp_host` | Définir pour la production | Moyen | S'il est vide, aucune variable `NEXT_PRIVATE_SMTP_*` n'est injectée — aucun e-mail d'invitation ou de notification de signature n'est envoyé. |
| `enable_custom_domain` / `reserve_static_ip` | `true` (par défaut) | Moyen | Sans IP ou domaine stable, le repli `nip.io` peut changer, rompant `webapp_url`/les rappels OAuth lors des redéploiements. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de base référencé partout — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Documenso
partagée avec la variante Cloud Run (secrets, le job `db-init` et le
point d'entrée personnalisé) est décrite dans **Documenso_Common** (source du module :
`modules/Documenso_Common`).

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Documenso sur GKE Autopilot](../labs/Documenso_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Documenso sur Google Cloud Run](Documenso_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Documenso Common — Configuration d'application partagée](Documenso_Common.md) — la configuration partagée par les deux cibles de déploiement.
