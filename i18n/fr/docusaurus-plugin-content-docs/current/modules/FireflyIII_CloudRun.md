---
title: "Firefly III sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Firefly III sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/FireflyIII_CloudRun.md @ 1665a43e sha256:a858ff49f65b -->

# Firefly III sur Google Cloud Run {#firefly-iii-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/FireflyIII_CloudRun.png" alt="Firefly III sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Firefly III est un gestionnaire de finances personnelles auto-hébergé, gratuit,
open source et sous licence AGPL. Il suit les comptes, les transactions, les
budgets, les factures, les catégories et les transactions récurrentes, et
expose une API REST complète. Ce module déploie Firefly III sur **Cloud Run v2**
au-dessus du socle [App_CloudRun](App_CloudRun.md), qui provisionne et gère
l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Firefly III et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications Cloud
Run — identité de service, ingress et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — veuillez vous référer au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## Ce que coûte Firefly III sur RAD, et comment cela se compare {#what-firefly-iii-costs-on-rad-and-how-that-compares}

**Dans un projet Google Cloud que vous possédez, Firefly III sur le module Cloud Run de RAD coûte environ 84 $ US par mois, plus 7,50 $ US une fois par déploiement et aucune licence par utilisateur.** GKE Autopilot est l'alternative pour les charges de travail qui doivent rester actives en permanence ou fonctionner aux côtés d'autres applications Kubernetes ; voir le [guide GKE](FireflyIII_GKE.md), environ 110 $ US par mois. Firefly III est un gestionnaire de finances personnelles gratuit et open source avec comptabilité en partie double, budgets et classification des transactions basée sur des règles. Les chiffres sont valables au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

Si cela s'exécute dans un projet géré par RAD pour vous, il peut être supprimé et restauré dans les 30 jours pour quelques crédits au lieu de rester en fonctionnement — ainsi, un déploiement à usage occasionnel coûte quelques dollars par mois, et non 84 $ US. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 75 crédits (7,50 $ US au prix de la recharge) | 67,5 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût de fonctionnement Google Cloud | Facturé par Google à votre propre compte de facturation, environ **84 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **32 crédits par jour**, soit environ 960 par mois (environ 96 $ US au prix de la recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est maintenu en réserve |

10 crédits coûtent 1 $ US pour une recharge ponctuelle, et moins avec un abonnement mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût de fonctionnement par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Cloud Run, 1 vCPU / 2 Gio, mise à l'échelle à zéro | 13 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51 $ US |
| Serveur de fichiers NFS/cache : une petite VM | 13 $ US |
| Passerelle Cloud NAT et adresse IP | 5 $ US |
| Cloud Storage pour les sauvegardes | 1 $ US |
| **Total** | **environ 84 $ US** |

### Comment cela se compare {#how-it-compares}

Nous n'avons pas trouvé de plan commercial géré/SaaS spécifiquement pour Firefly III au 8 octobre 2026, donc la comparaison honnête est avec l'exécution par vous-même :

| Option | Par mois | Qui l'exécute |
|---|---|---|
| Hetzner CPX22 (2 vCPU/4 Go) | ~24 $ US | Vous : OS, mises à jour, sauvegardes, correctifs de sécurité |
| DigitalOcean 2 vCPU/4 Go Droplet | 24 $ US | Vous : OS, mises à jour, sauvegardes, correctifs de sécurité |
| GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) | ~49 $ US | Vous : OS, mises à jour, sauvegardes, correctifs de sécurité |
| **RAD, Cloud Run, votre propre projet** | **84 $ US**, plus 7,50 $ US une fois | L'automatisation de RAD, dans votre projet |
| RAD, GKE Autopilot | environ 110 $ US ; voir le [guide GKE Autopilot](FireflyIII_GKE.md) | RAD |

L'empreinte propre de Firefly III ici (1 vCPU / 2 Gio) est plus légère que celle de la boîte de référence, donc un niveau plus petit et moins cher des mêmes fournisseurs l'exécuterait également confortablement.

- **RAD n'est généralement pas moins cher en espèces qu'un VPS nu — la différence est ce qui est géré pour vous.** Le prix d'un VPS n'inclut pas le temps de l'administrateur pour les sauvegardes, les correctifs de sécurité et les mises à niveau du système d'exploitation ; le Cloud SQL géré par RAD (où cette application utilise une base de données), Secret Manager et la surveillance couvrent cela à la place.
- **Firefly III est un gestionnaire de finances personnelles gratuit et open source avec comptabilité en partie double, budgets et classification des transactions basée sur des règles.** Cela détermine quelle colonne est importante : un fonctionnement prévisible et sans intervention est plus précieux pour la plupart des équipes utilisant ce type d'outil que de réduire de quelques dollars la facture mensuelle.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Firefly III s'exécute dans **un projet géré par RAD pour vous**, vous avez une option au-delà de la réduction d'échelle : **supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour presque rien.** Cela convient bien mieux à un déploiement dont vous n'avez besoin qu'occasionnellement — pour préparer une certification, une démo, un besoin saisonnier — que de le faire fonctionner en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le projet. Google ne le supprime pas immédiatement : il le conserve, récupérable, pendant 30 jours, et comme la facturation est déjà déliée, rien n'est facturé pendant qu'il attend. Contrairement à la suppression d'un module, cela ne détruit pas Cloud SQL, la VM ou Cloud Run un par un — l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet peut le restaurer. RAD demande à Google de récupérer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter **Update** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela coûte une poignée de crédits de temps de build au total (moins de 1 $ US) pour une chaîne typique de 2 à 3 déploiements.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, et non 84 $ US.** Déployez Firefly III, utilisez-le pour une session, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Update, et supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez que les frais de module une seule fois, les builds, et les heures pendant lesquelles il était réellement actif.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un projet que vous apportez et dont RAD ne gère que la facturation), et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime définitivement. La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés doit toujours dépasser le seuil du palier (100 crédits pour le palier sandbox qui convient à la plupart des utilisations d'étude/démo). Google indique que la plupart des services sont de nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.
- **Un véritable manque : les sauvegardes nocturnes ne survivent pas.** Les sauvegardes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé ce déploiement et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Cloud Run se met déjà à l'échelle à zéro entre les requêtes, de sorte que la majeure partie de son propre coût de calcul s'arrête d'elle-même lorsque personne ne l'utilise. L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de supprimer le déploiement et de le déployer à nouveau lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ 80 crédits (8 $ US). La suppression permet d'économiser de l'argent si Firefly III restait inutilisé pendant environ 3 jours ou plus dans votre propre projet (environ 2,79 $ US par jour), ou environ 3 jours ou plus dans un projet géré par RAD (32 crédits par jour).
- **Supprimez tout ce que Firefly III utilise.** La majeure partie du coût de fonctionnement est généralement la base de données et toute VM de fichier/cache partagée. Elles ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc la suppression de cette application pendant que quelque chose d'autre partage le projet n'économise que la partie calcul propre à cette application.
- **Conservez d'abord les données.** Les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui, alors copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.
- **Notez vos paramètres.** RAD ne recrée pas un déploiement supprimé pour vous ; vous entrez à nouveau les paramètres lorsque vous déployez.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant obtient Firefly III dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais propres à RAD et estimation quotidienne des crédits de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour le mécanisme de pause/restauration. Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Firefly III s'exécute comme un conteneur Laravel/PHP (Apache) sur Cloud Run v2. Le
déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service PHP/Apache, 1 vCPU / 2 Gio par défaut, autoscaling sans serveur ; mise à l'échelle à zéro prise en charge |
| Base de données | Cloud SQL pour PostgreSQL 15 | Moteur fixe — `DB_CONNECTION = pgsql` ; MySQL n'est pas utilisé |
| Stockage d'objets | Cloud Storage | Un bucket `fireflyiii-uploads` dédié provisionné automatiquement |
| Fichiers persistants | Filestore (NFS, facultatif) | Pièces jointes et données d'exécution montées à `/var/lib/fireflyiii` |
| Secrets | Secret Manager | `APP_KEY` et `STATIC_CRON_TOKEN` Laravel auto-générés ; mot de passe de la base de données |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la
  couche d'application partagée ; Firefly se connecte via l'**IP privée de Cloud
  SQL via TCP** avec `PGSQL_SSL_MODE = require` (Cloud SQL rejette le TCP IP privée non chiffré).
- **`APP_KEY` est générée automatiquement** et stockée dans Secret Manager. Cette
  clé Laravel chiffre les champs sensibles au repos et **ne doit jamais être
  pivotée après le premier démarrage** — la faire pivoter rend les données
  précédemment chiffrées illisibles.
- **`STATIC_CRON_TOKEN` est générée automatiquement.** Firefly n'effectue aucune
  planification en arrière-plan par lui-même ; un appelant doit atteindre
  `GET /api/v1/cron/<STATIC_CRON_TOKEN>` pour exécuter les transactions récurrentes, les rappels de
  factures et les budgets automatiques. Le module fournit un job `firefly-cron`
  intégré qui le fait quotidiennement à 03:00 UTC ; tout `cron_jobs` que vous
  ajoutez s'exécute à ses côtés.
- **La mise à l'échelle à zéro est activée par défaut** (`min_instance_count = 0`). Les démarrages
  à froid ajoutent 10 à 30 secondes de latence à la première requête après
  l'inactivité. Définissez `min_instance_count = 1` pour maintenir le service chaud.
- **La première exécution est `/register`.** Aucun administrateur n'est pré-initialisé
  — le premier compte créé devient le propriétaire/administrateur. Désactivez
  l'enregistrement ouvert par la suite dans **Administration → Settings**.
- **NFS est activé par défaut** pour persister les pièces jointes téléchargées et
  les données d'exécution à `/var/lib/fireflyiii` à travers les démarrages à froid et les
  révisions ; nécessite l'environnement d'exécution gen2.
- **Redis est désactivé par défaut.** Firefly III utilise la base de données pour
  le cache et la file d'attente ; une seule instance n'a pas besoin de Redis
  externe.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de
services et de ressources sont rapportés dans les [Sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service Firefly III {#a-cloud-run--the-firefly-iii-service}

Firefly III s'exécute comme un service Cloud Run v2 qui s'adapte automatiquement en
fonction de la charge des requêtes entre le nombre minimum et maximum d'instances.
Chaque déploiement crée une révision immuable ; le trafic peut être réparti entre les
révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic,
  les logs et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Firefly III stocke toutes les données de l'application (comptes, transactions, budgets,
factures, règles, utilisateurs) dans une instance Cloud SQL pour PostgreSQL 15 gérée.
Sur Cloud Run, le service se connecte via l'**IP privée de l'instance via TCP** avec
TLS requis (`PGSQL_SSL_MODE = require`) ; aucune IP publique n'est exposée. Lors du premier
déploiement, un job d'initialisation crée le rôle et la base de données de
l'application et accorde les privilèges.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes,
  les flags, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe
se trouvent dans les [Sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour
le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage et NFS {#c-cloud-storage--nfs}

Un bucket de téléchargement **Cloud Storage** dédié est provisionné automatiquement.
Lorsque NFS est activé (par défaut), les pièces jointes et le répertoire d'exécution
de Firefly III sont montés à partir d'un volume Filestore/NFS à `/var/lib/fireflyiii` afin
que les fichiers téléchargés survivent aux démarrages à froid et aux nouvelles
révisions.

- **Console :** Cloud Storage → Buckets ; Filestore → Instances.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<uploads-bucket>/        # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse, NFS et CMEK.

### D. Secret Manager {#d-secret-manager}

Deux secrets cryptographiques sont générés automatiquement et stockés dans Secret
Manager : la `APP_KEY` Laravel (chiffre les champs sensibles au repos) et le
`STATIC_CRON_TOKEN` (authentifie le point de terminaison cron). Le mot de passe de la
base de données est géré séparément par le socle.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~app-key OR name~cron-token"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### E. Cron (transactions récurrentes) {#e-cron-recurring-transactions}

Firefly III exécute les transactions récurrentes, les rappels de factures et les
budgets automatiques uniquement lorsqu'un appelant atteint son point de terminaison
cron. Il n'y a pas de planificateur intégré au processus.

- Un job planifié **`firefly-cron`** intégré (`curlimages/curl`, `0 3 * * *`) appelle
  `GET <service-url>/api/v1/cron/<STATIC_CRON_TOKEN>` quotidiennement. Il est toujours ajouté, et toutes les entrées
  `cron_jobs` que vous définissez lui sont ajoutées plutôt que de le remplacer.
- **CLI :**
  ```bash
  # Read the token, then trigger the cron manually to verify:
  TOKEN=$(gcloud secrets versions access latest --secret=<cron-token-secret> --project "$PROJECT")
  curl -s "$SERVICE_URL/api/v1/cron/$TOKEN"
  ```

### F. Réseau et ingress {#f-networking--ingress}

Le service est accessible par son URL `run.app` par défaut. Un équilibreur de charge
HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peuvent être
superposés ; les paramètres d'ingress et le contrôle d'egress VPC contrôlent la
connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les logs des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run et
Cloud SQL sont envoyées à Cloud Monitoring, avec des tests de disponibilité et des
règles d'alerte facultatifs.

- **Console :** Logging → Explorateur de logs ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Firefly III {#3-firefly-iii-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation exécute `db-init.sh` en utilisant `postgres:15-alpine`. Il crée de
  manière idempotente le rôle et la base de données de l'application et accorde les
  privilèges sur la base de données et le schéma `public`. Le job peut être
  réexécuté en toute sécurité.
- **Schéma créé au démarrage du conteneur.** Il n'y a **pas de job de migration
  séparé**. L'image `fireflyiii/core` exécute `php artisan migrate --force` et `firefly-iii:upgrade-database` à
  chaque démarrage, donc la mise à niveau de `application_version` applique
  automatiquement les modifications de schéma une fois que `db-init` a
  provisionné la base de données.
- **`APP_KEY` est immuable après le premier démarrage.** Elle est générée une fois
  et écrite dans Secret Manager. La faire pivoter rend tous les champs
  précédemment chiffrés illisibles. Ne la modifiez que lors d'une migration
  planifiée tenant compte de la perte de données.
- **La première exécution est `/register`.** Aucune information d'identification
  d'administrateur n'existe dans Secret Manager. Créez le compte propriétaire à
  `/register`, puis désactivez les enregistrements ultérieurs dans
  **Administration → Settings**.
- **Le point de terminaison Cron gère les éléments récurrents.** Confirmez le
  jeton et déclenchez-le :
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  curl -s "$SERVICE_URL/api/v1/cron/<STATIC_CRON_TOKEN>"
  ```
- **Chemin de santé.** La sonde de démarrage est TCP sur le port 8080 (délai
  initial de 30 s, 40 échecs autorisés) ; la sonde de vivacité cible le point de
  terminaison JSON non authentifié `/status` de Firefly III (HTTP 200, pas de
  connexion, délai initial de 300 s). Prévoyez une fenêtre généreuse pour le
  premier démarrage pendant l'exécution des migrations.
- **Inspecter l'exécution du job :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres spécifiques ou notables pour Firefly III sont
listés ; toutes les autres entrées sont héritées de [App_CloudRun](App_CloudRun.md)
avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `fireflyiii` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `FireflyIII` | Nom lisible par l'homme affiché dans la console. |
| `application_version` | `latest` | Tag d'image `fireflyiii/core` ; épingler à une version (par exemple `version-6.1.21`) en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `prebuilt` | Déploie directement l'image officielle `fireflyiii/core`. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `2Gi` | Mémoire par instance ; plancher de 512 Mio sur gen2. |
| `min_instance_count` | `0` | `0` active la mise à l'échelle à zéro ; définir `1` pour éviter les démarrages à froid. |
| `max_instance_count` | `1` | Nombre maximal d'instances. |
| `container_port` | `8080` | Firefly III (Apache) écoute sur le port 8080. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages NFS/GCS. |
| `enable_cloudsql_volume` | `false` | Cloud Run atteint Cloud SQL via TCP IP privée, pas le sidecar de socket. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image dans Artifact Registry. |
| `timeout_seconds` | `300` | Durée maximale de la requête ; augmenter pour les importations CSV volumineuses. |

### Groupe 5 — Accès et contrôle d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Accès public `run.app`. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via VPC. |
| `enable_iap` | `false` | Exiger la connexion Google devant Firefly III (recommandé pour les données financières personnelles). |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires (par exemple `MAIL_*`). Les valeurs principales (`DB_CONNECTION`, `PGSQL_SSL_MODE`, `TRUSTED_PROXIES`, `APP_ENV`, `APP_URL`) sont définies automatiquement. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. `APP_KEY` et `STATIC_CRON_TOKEN` sont injectés automatiquement. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Équilibreur de charge, CDN et rétention d'images {#group-9--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner un équilibreur de charge HTTPS global + WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 10 — Stockage et système de fichiers {#group-10--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer des buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets supplémentaires au-delà du bucket de téléchargement auto-provisionné. |
| `enable_nfs` | `true` | Persister les pièces jointes et les données d'exécution à `/var/lib/fireflyiii`. |
| `nfs_mount_path` | `/var/www/html/storage/upload` | Chemin de montage à l'intérieur du conteneur. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse (nécessite gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixé à PostgreSQL 15. |
| `db_name` | `fireflyiii` | Nom de la base de données, injecté comme `DB_DATABASE`. Immuable après le premier déploiement. |
| `db_user` | `fireflyiii` | Utilisateur de l'application, injecté comme `DB_USERNAME`. Mot de passe auto-généré dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | Jobs planifiés supplémentaires. L'appel quotidien `firefly-cron` à `/api/v1/cron/<STATIC_CRON_TOKEN>` est intégré et toujours ajouté à côté de ceux-ci. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | Port TCP 8080, délai de 30 s, 40 échecs | Sonde de démarrage. |
| `liveness_probe` | HTTP `/status`, délai de 300 s | Sonde de vivacité (200 non authentifié). |
| `uptime_check_config` | `{ enabled=false, path="/status" }` | Test de disponibilité Cloud Monitoring. |
| `alert_policies` | `[]` | Règles d'alerte métrique. |

### Groupe 21 — Redis {#group-21--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Backend de cache/session facultatif ; Firefly III utilise la base de données par défaut. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Point de terminaison et authentification Redis. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Retournées lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (IP privée Cloud SQL) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Statut de surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | Statut et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | Statut VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et statut CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et les combinaisons* au moment de la planification — un réplica en lecture sans son primaire, IAP sans identités autorisées, un environnement d'exécution `gen1` avec des montages NFS/GCS, un `redis_port`/`backup_retention_days` hors plage. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `APP_KEY` (auto-généré) | Ne jamais faire pivoter après le premier démarrage | Critique | Le faire pivoter rend tous les champs précédemment chiffrés illisibles — les données sont effectivement perdues. |
| `db_name` / `db_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activation sans un `backup_uri` valide fait échouer le job d'importation. |
| `PGSQL_SSL_MODE` (auto `require`) | Laisser tel quel | Élevé | Cloud SQL rejette le TCP IP privée non chiffré ; `disable` interrompt la connexion. |
| `STATIC_CRON_TOKEN` / job cron | Laisser le job `firefly-cron` intégré en place | Élevé | Sans appel cron planifié, les transactions récurrentes, les factures et les budgets automatiques ne se déclenchent jamais. |
| `enable_nfs` | `true` | Élevé | Le désactiver place les pièces jointes sur un disque éphémère — les fichiers téléchargés disparaissent au démarrage à froid / nouvelle révision. |
| `memory_limit` | `2Gi` | Élevé | En dessous de 512 Mio est rejeté sur gen2 ; une faible mémoire tue PHP par manque de mémoire lors des importations. |
| `enable_iap` | activer pour les données privées | Élevé | Firefly III contient des données financières ; le laisser publiquement accessible l'expose à toute personne ayant l'URL. |
| Enregistrement au premier démarrage | Désactiver après le premier administrateur | Élevé | Laisser l'enregistrement ouvert permet à toute personne ayant l'URL de créer un compte. |
| `min_instance_count` | `1` pour une utilisation quotidienne | Moyen | La mise à l'échelle à zéro ajoute une latence de démarrage à froid de 10 à 30 s après l'inactivité. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |
| `enable_cloud_armor` | activer pour la production | Moyen | L'interface utilisateur et l'API sont accessibles publiquement sans protection WAF. |

---

Pour le comportement du socle référencé tout au long — identité de service, mise à
l'échelle et concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à
Firefly III partagée avec la variante GKE est décrite dans
**[FireflyIII_Common](FireflyIII_Common.md)**.

<!-- related-guides -->

## Guides associées {#related-guides}

- [Lab pratique : Firefly III sur Cloud Run](../labs/FireflyIII_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Firefly III sur GKE Autopilot](FireflyIII_GKE.md) — la même application sur Kubernetes, pour les cas où vous avez besoin de l'autre cible de déploiement.
- [Firefly III Common — Configuration d'application partagée](FireflyIII_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [Ghostfolio sur Google Cloud Run](Ghostfolio_CloudRun.md), [Wallos sur Google Cloud Run](Wallos_CloudRun.md), [ActualBudget sur Google Cloud Run](ActualBudget_CloudRun.md) dans la solution **Suivi des finances et du patrimoine**.
