---
title: "Coder sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Coder sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Coder_CloudRun.md @ e69407af sha256:03951d62ffdb -->

# Coder sur Google Cloud Run {#coder-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Coder_CloudRun.png" alt="Coder sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Coder est une plateforme open source auto-hébergée pour le provisionnement d'environnements de développement à distance (espaces de travail) définis comme du code avec Terraform. Les développeurs obtiennent des environnements cohérents et prêts à coder, tandis que les équipes de plateforme conservent le code source et les dépendances sur leur propre infrastructure. Ce module déploie le plan de contrôle Coder sur **Cloud Run v2** au-dessus de la fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Coder et sur la manière de les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à toutes les applications Cloud Run — identité de service, ingress et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au [guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## Ce que coûte Coder sur RAD, et comment cela se compare {#what-coder-costs-on-rad-and-how-that-compares}

**Le module Cloud Run de Coder sur RAD coûte environ 167,44 $ US par mois dans un projet Google Cloud que vous possédez, plus des frais de module uniques de 175 crédits (17,50 $ US).** Coder est le plan de contrôle open source pour le provisionnement d'espaces de travail de développement à distance définis par Terraform. GKE Autopilot convient à Coder qui doit rester actif, s'adapter à travers les pods ou fonctionner à côté d'autres charges de travail Kubernetes ; pour le coût le plus bas, ce module Cloud Run est généralement le bon choix — consultez le [guide GKE](Coder_GKE.md) si vous avez besoin de l'autre.

Si Coder n'est nécessaire qu'occasionnellement — une démo, un essai, une charge de travail saisonnière ou d'étude — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits, de sorte que les 167,44 $ US deviennent quelques dollars par mois à la place. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 175 crédits (17,50 $ US au prix de la recharge) | 157,5 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build (environ 3 à 6) | Idem |
| Coût de fonctionnement Google Cloud | Facturé par Google à votre propre compte de facturation, environ **167,44 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **77 crédits par jour**, soit environ 2310 par mois (environ 231 $ US au prix de la recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge unique, moins sur un plan. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût de fonctionnement par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Cloud Run, 2x vCPU / 4 GiB (toujours actif) | 110,42 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| **Total** | **environ 167,44 $ US** |

### Comment cela se compare {#how-it-compares}

- Si vous l'exécutez vous-même, un VPS exécutant le plan de contrôle Coder et PostgreSQL vous coûtera moins cher en espèces : dimensionné à environ 2 vCPU/4 GiB, un VPS comparable (Hetzner ou DigitalOcean) coûte environ 24 à 48 $ par mois, ou une VM GCP de classe `e2-standard-2` environ 49 $ — plus votre propre temps pour les sauvegardes, les correctifs de sécurité et les mises à niveau, que le Cloud SQL géré par RAD, Secret Manager et la surveillance couvrent pour vous.
- RAD ne prétend jamais être moins cher que l'infrastructure nue en termes monétaires — ce n'est généralement pas le cas. La différence est ce que RAD gère pour vous : les correctifs, les sauvegardes, les secrets et la surveillance, ainsi que la possibilité de mettre Coder en pause gratuitement plutôt que de payer pour une capacité inactive (voir ci-dessous).
- La majeure partie des coûts de fonctionnement ci-dessus est la base de données PostgreSQL gérée (et, le cas échéant, le serveur de fichiers partagé) — la partie qu'une comparaison avec un VPS nu doit exécuter et sauvegarder à la main.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Coder s'exécute dans **un projet géré par RAD pour vous**, vous avez une deuxième option qui va bien au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour presque rien.** Cela convient bien mieux à Coder dont vous n'avez besoin qu'occasionnellement que de le faire fonctionner en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le projet. Google ne supprime pas le projet immédiatement : il le conserve, récupérable, pendant 30 jours. Comme la facturation est déjà déliée, rien n'est facturé pendant qu'il attend. Contrairement à la suppression d'un module, cela ne détruit pas les ressources Cloud SQL ou Cloud Run une par une — l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet peut le restaurer. RAD demande à Google de restaurer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter **Mettre à jour** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela représente une poignée de crédits (moins de 1 $ US) au total pour une chaîne Coder typique, contre les 180 crédits que coûte un redéploiement complet.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, et non 167,44 $ US.** Déployez Coder, utilisez-le, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Mettre à jour, et supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez que les frais de module une seule fois, les builds, et les heures où il était réellement actif.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un projet que vous apportez et que RAD ne gère que pour la facturation), et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime définitivement. La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés doit toujours dépasser le seuil du palier (100 crédits pour le palier sandbox que la plupart des utilisations d'étude et de démo conviennent). Google indique que la plupart des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.
- **Une lacune réelle : le bucket de sauvegarde ne survit pas.** Les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket n'est **pas** protégé par la suppression logicielle de Cloud Storage, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé Coder et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Cloud Run maintient le CPU toujours alloué, il ne se met donc jamais à l'échelle zéro de lui-même. L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ 180 crédits (18 $ US) dans votre propre projet. La suppression ne permet d'économiser de l'argent que si Coder devait rester inutilisé pendant environ 4 jours ou plus, que ce soit dans votre propre projet ou dans un projet géré par RAD.
- **La majeure partie des coûts de fonctionnement est généralement la base de données.** Elle ne s'arrête que si rien d'autre dans le projet ne l'utilise, de sorte que la suppression de Coder alors que quelque chose d'autre partage le projet n'économise que la partie calcul de cette application.
- **Conservez d'abord vos données.** Les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du déploiement et sont supprimées avec lui, alors copiez la dernière sauvegarde avant de supprimer si vous voulez la conserver.
- **Notez vos paramètres.** RAD ne recrée pas un déploiement supprimé pour vous ; vous entrez à nouveau les paramètres lorsque vous déployez.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant obtient l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est interrompue et les données sont conservées, afin que personne ne reçoive de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais propres à RAD et estimations de crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour la fenêtre de récupération de 30 jours et ce qu'elle dit sur les objets Cloud Storage sans suppression logicielle. Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Coder s'exécute comme un seul binaire Go (`coder server`) dans un conteneur sur Cloud Run v2. Le déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service de plan de contrôle Go, 2 vCPU / 4 GiB par défaut, CPU toujours alloué |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — Coder nécessite PostgreSQL 13+ ; MySQL est rejeté au moment de la planification |
| Stockage d'objets | Cloud Storage | Un bucket `storage` provisionné automatiquement (disponible pour l'opérateur) |
| Build d'image | Cloud Build + Artifact Registry | Wrapper personnalisé léger construit À PARTIR de `ghcr.io/coder/coder` |
| Secrets | Secret Manager | Mot de passe de la base de données géré automatiquement — Coder n'a pas besoin de son propre secret d'application |
| Ingress | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut, équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Coder nécessite PostgreSQL 13+ ; une validation au moment de la planification rejette les moteurs MySQL.
- **Le plan de contrôle est sans état.** Tout l'état — modèles, espaces de travail, utilisateurs, sessions, file d'attente de build et clés de signature auto-générées de Coder — réside dans PostgreSQL. Pas de NFS, pas de Redis, pas de secret d'application géré par Common.
- **`cpu_always_allocated = true` et `min_instance_count = 1`.** `coder server` exécute des démons de provisionnement intégrés qui interrogent continuellement la base de données pour les builds d'espaces de travail en attente et terminent les connexions des agents d'espaces de travail — ce travail en arrière-plan est bloqué par la limitation du CPU basée sur les requêtes ou la mise à l'échelle à zéro.
- **L'URL de connexion est assemblée au moment de l'exécution.** Le point d'entrée personnalisé construit `CODER_PG_CONNECTION_URL` (une URL `postgres://` avec un mot de passe encodé en URL) à partir des variables `DB_*` injectées par la fondation, préférant le chemin TCP IP privé avec `sslmode=require` sur Cloud Run.
- **`CODER_ACCESS_URL` est défini automatiquement** à partir de l'URL de service Cloud Run injectée, de sorte que les URL de connexion d'espace de travail/agent et les URI de redirection OAuth sont corrects dès le départ.
- **Un job `db-init` s'exécute à chaque apply** pour créer de manière idempotente la base de données et le rôle Coder ; Coder exécute ses propres migrations de schéma au démarrage du serveur.
- **Les sondes de santé ciblent `/healthz`** (non authentifié) avec un délai initial de 60 secondes pour la migration de schéma au premier démarrage.
- Le **mot de passe de la base de données** est généré automatiquement et stocké dans Secret Manager.
- **`application_version = "latest"` correspond à une balise épinglée** (`v2.24.1`) via l'ARG de build `CODER_VERSION` spécifique à l'application — les balises GHCR de Coder sont préfixées par semver.

> Ce module déploie le **plan de contrôle** Coder. Le provisionnement d'espaces de travail réels nécessite en outre un provisionneur configuré et une cible de calcul (par exemple, un cluster Kubernetes ou un modèle de VM cloud), configurés après le déploiement via le système de modèles de Coder.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de services et de ressources sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Coder {#a-cloud-run--the-coder-service}

Coder s'exécute comme un service Cloud Run v2 avec un CPU toujours alloué et une instance minimale chaude, de sorte que les démons de provisionnement en cours de processus continuent d'interroger les builds d'espaces de travail même sans requêtes entrantes. Chaque déploiement crée une révision immuable ; le trafic peut être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Coder stocke tout — utilisateurs, organisations, modèles, état de l'espace de travail, file d'attente des jobs de provisionnement et ses clés de signature — dans une instance Cloud SQL pour PostgreSQL 15 gérée. Le service se connecte via IP privée avec `sslmode=require` (le DSN de Coder sous forme d'URL ne peut pas contenir le chemin du socket Unix) ; le job `db-init` crée la base de données et le rôle de l'application lors du premier déploiement.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe se trouvent dans les [Sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** dédié (suffixe `storage`) est provisionné automatiquement. Coder n'en a pas besoin pour le fonctionnement du plan de contrôle — le plan de contrôle ne conserve aucun fichier sur disque — mais il est disponible pour les ressources de modèle ou l'utilisation par l'opérateur.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket>/        # bucket name is in the Outputs
  ```

### D. Cloud Build et Artifact Registry {#d-cloud-build--artifact-registry}

`container_image_source = "custom"` déclenche un Cloud Build qui enveloppe `ghcr.io/coder/coder:<version>` avec le point d'entrée cloud et pousse le résultat vers Artifact Registry (l'image de base est d'abord mise en miroir, `enable_image_mirroring = true`).

- **Console :** Cloud Build → Historique ; Artifact Registry → Dépôts.
- **CLI :**
  ```bash
  gcloud builds list --project "$PROJECT" --limit 5
  gcloud artifacts docker images list <region>-docker.pkg.dev/$PROJECT/<repo> --limit 5
  ```

### E. Secret Manager {#e-secret-manager}

Le mot de passe de la base de données est le seul secret du déploiement — stocké dans Secret Manager et injecté au moment de l'exécution sous le nom `DB_PASSWORD`, puis encodé en URL dans l'URL de connexion par le point d'entrée. Coder auto-génère ses clés de signature et les persiste dans PostgreSQL, de sorte qu'aucun secret de session/application n'existe à gérer.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### F. Réseau et ingress {#f-networking--ingress}

Le service est accessible à son URL `run.app` par défaut ; le point d'entrée exporte cette URL sous le nom `CODER_ACCESS_URL`, à partir de laquelle Coder construit les URL de connexion d'espace de travail et d'agent. Un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peut être superposé ; les paramètres d'ingress et le contrôle d'égression VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux de conteneurs (structurés, vers STDOUT) sont acheminés vers Cloud Logging ; les métriques Cloud Run et Cloud SQL sont acheminées vers Cloud Monitoring, avec des vérifications de disponibilité et des politiques d'alerte facultatives.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Coder {#3-coder-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job `db-init` (`postgres:15-alpine`) se connecte en tant que superutilisateur `postgres` et crée de manière idempotente le rôle Coder (`LOGIN CREATEDB`), crée la base de données, accorde tous les privilèges et réaffecte la propriété du schéma `public` au rôle de l'application (les migrations de Coder créent tous les objets là). Le job s'exécute à chaque apply et peut être réexécuté en toute sécurité.
- **Les migrations s'exécutent au démarrage.** Coder applique ses propres migrations de schéma chaque fois que `coder server` démarre — les mises à niveau de version ne nécessitent aucune étape de migration manuelle. Le premier démarrage sur une base de données vierge prend plus de temps ; la sonde de démarrage autorise jusqu'à ~8 minutes avant d'abandonner.
- **Assemblage DSN au moment de l'exécution.** Le point d'entrée cloud construit `CODER_PG_CONNECTION_URL` à partir de `DB_HOST`/`DB_IP`/`DB_USER`/`DB_PASSWORD`/`DB_NAME` : sur Cloud Run, il préfère l'IP privée avec `sslmode=require` (le chemin du socket Cloud SQL ne peut pas résider dans une autorité d'URL) ; le mot de passe est encodé en pourcentage afin que les caractères spéciaux ne cassent jamais l'URL. Un `CODER_PG_CONNECTION_URL` explicitement fourni l'emporte.
- **URL d'accès.** `CODER_ACCESS_URL` est défini à partir de `CLOUDRUN_SERVICE_URL` injecté. Coder construit les URL de connexion d'espace de travail/agent et les URI de redirection OAuth à partir de celui-ci — si vous placez le service derrière un domaine personnalisé, définissez `CODER_ACCESS_URL` dans `environment_variables` sur ce domaine.
- **Pas de secrets d'application.** Coder génère et persiste ses clés de signature dans PostgreSQL. La recréation de conteneurs, la mise à l'échelle et les redéploiements sont sûrs ; rien ne se désynchronise.
- **Configuration au premier démarrage.** La première visite à l'URL du service vous invite à créer le compte administrateur initial (propriétaire) — complétez-le rapidement, car le point de terminaison est publiquement accessible jusque-là (`ingress_settings = "all"` par défaut).
- **Le provisionnement de l'espace de travail est une étape du jour 2.** Le plan de contrôle seul n'exécute aucun espace de travail. Créez un modèle (Terraform) pointant vers une cible de calcul — par exemple, un cluster GKE ou des VM GCE — et assurez-vous que le provisionneur dispose des informations d'identification nécessaires.
- **Chemin de santé.** Les sondes de démarrage, de vivacité et de disponibilité ciblent `/healthz`, que Coder sert non authentifié avec HTTP 200 une fois le serveur démarré.

Vérification :

```bash
SERVICE_URL=$(gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)')
curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/healthz"     # expect 200
curl -s "$SERVICE_URL/api/v2/buildinfo"                             # Coder version info
```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour Coder sont listés ; toutes les autres entrées sont héritées de [App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `coder` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Coder` | Nom convivial affiché dans la console. |
| `application_version` | `latest` | Balise de version de Coder ; `latest` correspond à la balise épinglée `v2.24.1` via l'ARG de build `CODER_VERSION`. Incrémenter pour déclencher une nouvelle build d'image et une nouvelle révision. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` | `2000m` | CPU par instance. |
| `memory_limit` | `4Gi` | Mémoire par instance ; Coder nécessite au moins 2 Gi pour un fonctionnement fiable. |
| `min_instance_count` | `1` | Garder ≥ 1 — les démons de provisionnement en cours de processus doivent rester chauds pour prendre en charge les builds d'espaces de travail. |
| `max_instance_count` | `1` | Garder à 1 — plus d'une instance est le mode haute disponibilité de Coder, qui nécessite une licence premium. |
| `cpu_always_allocated` | `true` | Facturation basée sur l'instance. Garder `true` — l'interrogation du provisionneur et les connexions d'agent sont bloquées par la limitation basée sur les requêtes. Définir `false` uniquement pour une évaluation de l'interface utilisateur. |
| `container_port` | `3000` | Port HTTP de Coder (`CODER_HTTP_ADDRESS = 0.0.0.0:3000`). |
| `container_image_source` | `custom` | Requis — l'image amont ne contient pas le point d'entrée qui assemble l'URL de connexion à la base de données et l'URL d'accès. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy ; le point d'entrée se connecte toujours via IP privée TCP car le DSN de Coder sous forme d'URL ne peut pas contenir le chemin du socket. |
| `enable_image_mirroring` | `true` | L'image de base GHCR est mise en miroir dans Artifact Registry avant le build. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 5 — Contrôle d'accès et d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Coder doit être accessible par les développeurs et les agents d'espace de travail ; restreindre avec IAP ou Cloud Armor plutôt qu'avec un ingress interne uniquement. |
| `enable_iap` | `false` | Exiger la connexion Google devant l'authentification propre à Coder. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Configuration `CODER_*` supplémentaire (par exemple, `CODER_OIDC_*` pour l'authentification unique, `CODER_ACCESS_URL` pour un domaine personnalisé). `CODER_HTTP_ADDRESS`, `CODER_TELEMETRY_ENABLE=false` et `CODER_VERBOSE=false` sont pré-définis par `Coder_Common`. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager (par exemple, un secret client OIDC). |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupes 7-10 — Sauvegarde, CI/CD, SQL personnalisé, équilibreur de charge et CDN {#groups-710--backup-cicd-custom-sql-lb--cdn}

Comportement standard d'App_CloudRun — voir [App_CloudRun](App_CloudRun.md). Entrées clés : `backup_schedule`, `enable_backup_import`, `enable_cicd_trigger`, `enable_binary_authorization`, `enable_cloud_armor`, `application_domains`, `enable_cdn`.

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Non requis — le plan de contrôle est sans état ; tout l'état réside dans PostgreSQL. |
| `nfs_mount_path` | `/home/coder/data` | Uniquement lorsque `enable_nfs=true`. Doit être un répertoire réel — jamais un sous-chemin de `/opt/coder`, qui est le **binaire** du codeur (un fichier) ; le montage par-dessus empêche le démarrage du conteneur. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Coder nécessite PostgreSQL 13+ — MySQL est rejeté par une validation au moment de la planification. |
| `db_name` | `coder` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `coder` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16-64) ; les caractères spéciaux sont sûrs — le point d'entrée encode le mot de passe en URL. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré (`postgres:15-alpine`). |
| `cron_jobs` | `[]` | Jobs récurrents déclenchés par Cloud Scheduler. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/healthz`, délai initial de 60s, 30 échecs | Seuil généreux (~8 min) pour la migration de schéma au premier démarrage sur une instance Cloud SQL vierge. |
| `liveness_probe` | HTTP `/healthz`, délai initial de 60s | Sonde de vivacité contre le point de terminaison de santé non authentifié de Coder. |
| `uptime_check_config` | désactivé, chemin `/` | Vérification de disponibilité de Cloud Monitoring ; pointez-la vers `/healthz` lors de l'activation. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 21 — Redis / Groupe 22 — VPC-SC {#group-21--redis--group-22--vpc-sc}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Non requis — les sessions et la file d'attente de build résident dans PostgreSQL. |
| `enable_vpc_sc` | `false` | Application standard du périmètre — voir [App_CloudRun](App_CloudRun.md). |

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service (URL d'accès de Coder). |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom de la base de données / utilisateur de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés (inclut le bucket `storage`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, vérifications de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

Les validations au moment de la planification dans `validation.tf` détectent les pires combinaisons tôt : ordre min/max des instances, Redis sans hôte, moteurs non-PostgreSQL et un sidecar proxy Cloud SQL avec `database_type = "NONE"`.

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critique | Coder nécessite PostgreSQL 13+ ; MySQL est rejeté au moment de la planification. |
| `db_name` / `db_user` | défini une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit tous les modèles, espaces de travail, utilisateurs et clés de signature. |
| `container_image_source` | `custom` | Critique | L'image amont ne peut pas assembler `CODER_PG_CONNECTION_URL` à partir des variables `DB_*` de la fondation — le serveur ne se connecte jamais à PostgreSQL. |
| `container_port` | `3000` | Critique | Doit correspondre à `CODER_HTTP_ADDRESS = 0.0.0.0:3000` ; une non-concordance échoue à chaque sonde de santé. |
| `cpu_always_allocated` | `true` | Élevé | Sous facturation basée sur les requêtes, les démons de provisionnement en cours de processus sont limités à ~0 entre les requêtes — les builds d'espaces de travail sont bloqués en silence. |
| `min_instance_count` | `1` | Élevé | À `0`, le plan de contrôle se met à l'échelle zéro et aucun provisionneur n'interroge — les builds d'espaces de travail en file d'attente attendent la prochaine requête entrante pour réveiller une instance. |
| `memory_limit` | `4Gi` (≥ `2Gi`) | Élevé | En dessous de 2 Gi, le serveur Go risque un OOM lors des pics de build d'espaces de travail et des importations de modèles. |
| `application_version` | balise épinglée (par exemple `v2.24.1`) | Élevé | Les balises GHCR de Coder sont préfixées par semver (`vX.Y.Z`) ; `latest` est mappé à une épingle par le module — ne remplacer qu'avec une balise réelle. |
| Chemin / délai `startup_probe` | `/healthz`, 60s | Élevé | Pointer les sondes vers un chemin authentifié renvoie 401/403 et la révision ne devient jamais prête ; réduire le seuil tue les premiers démarrages en pleine migration. |
| `CODER_ACCESS_URL` (via `environment_variables`) | URL de service (auto) ou domaine personnalisé | Élevé | Une URL d'accès incorrecte interrompt les connexions des agents d'espace de travail et les URI de redirection OAuth — définissez-la explicitement lorsque vous utilisez un domaine personnalisé. |
| `enable_nfs` / `nfs_mount_path` | `false` / répertoire réel | Élevé | NFS est inutile ; si activé, un montage sous `/opt/coder` masque le binaire du codeur et le conteneur ne peut pas démarrer. |
| `enable_redis` | `false` | Moyen | Coder ne lit jamais Redis ; l'activer provisionne un point de terminaison que rien n'utilise. |
| `enable_iap` / `enable_cloud_armor` | activer pour les équipes privées | Moyen | Jusqu'à la création du premier compte administrateur, la page de configuration est publiquement accessible à l'URL `run.app`. |
| `enable_backup_import` | `false` sauf restauration | Moyen | L'activation sans un `backup_file` valide échoue au job d'importation. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise à l'échelle et concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à Coder partagée avec la variante GKE est décrite dans **[Coder_Common](Coder_Common.md)**.

<!-- related-guides -->

## Guides connexes {#related-guides}

- [Lab pratique : Coder sur Cloud Run](../labs/Coder_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Coder sur GKE Autopilot](Coder_GKE.md) — la même application sur Kubernetes, pour lorsque vous avez besoin de l'autre cible de déploiement.
- [Coder Common — Configuration d'application partagée](Coder_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [code-server sur Google Cloud Run](CodeServer_CloudRun.md), [Gitea sur Google Cloud Run](Gitea_CloudRun.md), [Hoppscotch sur Google Cloud Run](Hoppscotch_CloudRun.md) dans la solution **Environnements de développement Cloud**.
