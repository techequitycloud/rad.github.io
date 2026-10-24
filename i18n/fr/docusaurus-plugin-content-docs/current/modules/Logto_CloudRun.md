---
title: "Logto sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Logto sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Logto_CloudRun.md @ e69407af sha256:4b2580955582 -->

# Logto sur Google Cloud Run {#logto-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Logto_CloudRun.png" alt="Logto sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Logto est un fournisseur d'identité open source sous licence MPL-2.0 — une
alternative à Auth0 qui prend en charge OIDC et OAuth 2.0 et offre des flux de
connexion, des connecteurs sociaux/d'entreprise, la multi-location et une console
d'administration. Ce module déploie Logto sur **Cloud Run v2** au-dessus de la
fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère
l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Logto et sur la manière
de les explorer et de les opérer depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications Cloud Run —
identité de service, entrée et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — veuillez vous référer au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## Ce que coûte Logto sur RAD, et comment cela se compare {#what-logto-costs-on-rad-and-how-that-compares}

**Le module Cloud Run de Logto sur RAD coûte environ 110 $ US par mois dans votre
propre projet, sans frais par utilisateur ou par MAU.** RAD facture 175 crédits
une fois par déploiement dans votre propre projet (157,5 crédits, soit 10 % de
moins, dans un projet géré par RAD), plus le temps de build. Logto se déploie
également sur GKE Autopilot pour environ 150 $ US par mois — consultez le
[guide GKE](Logto_GKE.md) si vous en avez besoin pour qu'il s'exécute là-bas.
Si vous n'en avez besoin qu'occasionnellement, un projet géré par RAD peut être
supprimé et restauré dans les 30 jours pour quelques crédits, de sorte que ce
chiffre mensuel devient quelques dollars au lieu de 110 $ US — voir **Mettez-le
en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 175 crédits (17,50 $ US au prix de la recharge) | 157,5 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût de fonctionnement Google Cloud | Facturé par Google à votre propre compte de facturation, environ **110 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **49 crédits par jour**, soit environ 1 470 par mois (environ 147,00 $ US au prix de la recharge, moins avec un abonnement) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est détenu en réserve |

10 crédits coûtent 1 $ US en recharge unique, et moins avec un abonnement mensuel.
Dans un projet géré par RAD, la base de données, le serveur de fichiers et le
réseau sont partagés par toutes les applications du projet, de sorte qu'une
deuxième application n'ajoute pas une deuxième base de données.

**Coût de fonctionnement par défaut dans votre propre projet** (us-central1, prix
catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Cloud Run, 2x vCPU / 4 GiB (chaud) | 39 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| **Total** | **environ 110 $ US** |

### Comment cela se compare {#how-it-compares}

- **Auth0** (B2C) commence à **35 $ US par mois** avec son plan Essentials pour
  jusqu'à 500 utilisateurs actifs mensuels, puis évolue avec les MAU ; son plan
  B2B Essentials commence à **150 $ US par mois**. Un niveau gratuit couvre
  jusqu'à 25 000 MAU mais supprime la plupart des fonctionnalités
  d'entreprise.
- Le module Logto de RAD coûte environ 110 $ US par mois dans votre propre
  projet — plus que le niveau d'entrée d'Auth0 pour un très faible nombre
  d'utilisateurs, mais il n'a **pas de facturation basée sur les MAU ni de
  niveau de tarification par locataire à dépasser**, et vous détenez vous-même
  la base de données des utilisateurs et les clés de signature plutôt que de
  confier chaque connexion à un tiers.
- Comparaison autogérée : l'empreinte de 2 vCPU / 4 GiB de Logto est proche
  d'une instance GCP Compute Engine e2-standard-2 (environ 49 $ US/mois) ou
  d'une machine Hetzner/DigitalOcean plus grande, et vous auriez toujours
  besoin d'exécuter et de patcher PostgreSQL et la couche NFS/cache dont il
  dépend vous-même.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Logto s'exécute dans **un projet géré par RAD pour vous**, vous avez une
deuxième option qui va bien au-delà de la mise à l'échelle à zéro : **supprimez
l'ensemble du projet et restaurez-le dans les 30 jours pour presque rien.**
Cela convient bien mieux à Logto dont vous n'avez besoin qu'occasionnellement
— évaluation, environnement de démonstration, charge de travail saisonnière ou
intermittente — que de le faire fonctionner en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord
  sa facturation, puis demande à Google de supprimer le projet. Google ne
  supprime pas le projet immédiatement : il le conserve, récupérable, pendant
  30 jours. Comme la facturation est déjà déliée, rien n'est facturé pendant
  qu'il attend. Contrairement à la suppression d'un module, cela ne détruit
  pas la base de données, aucune VM ou la ressource de calcul une par une —
  l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte quelques crédits, pas une reconstruction.** Dans les
  30 jours, le propriétaire du projet peut le restaurer. RAD demande à Google
  de restaurer le projet et de rattacher son compte de facturation, puis vous
  demande d'exécuter **Update** sur chaque déploiement pour confirmer que tout
  est revenu. Comme rien n'a été détruit individuellement, cette mise à jour
  trouve les mêmes ressources déjà présentes — c'est une vérification, pas une
  reconstruction, et une mise à jour ne facture jamais à nouveau les frais de
  module. Pour Logto derrière Services_GCP (une petite VM NFS/cache, une base
  de données Postgres) et Project_GCP, cela représente environ **une poignée
  de crédits (moins de 1 $ US)** au total, contre environ 180 crédits (18,00 $
  US) que coûte un redéploiement complet.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars,
  pas 110 $ US.** Déployez Logto, utilisez-le un certain temps, supprimez le
  projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez
  avec Update, et supprimez-le à nouveau lorsque vous avez terminé. Vous ne
  payez les frais de module qu'une seule fois, les builds et le temps pendant
  lequel il était réellement en ligne.
- **Ce dont cela a besoin.** Vous devez posséder le projet (pas un projet dont
  RAD gère uniquement la facturation), et vous le restaurez vous-même dans les
  30 jours — après cela, Google le supprime définitivement. La restauration
  est admise comme la création d'un nouveau projet : votre solde de crédits
  achetés doit toujours dépasser le seuil du niveau (100 crédits pour le
  niveau sandbox que la plupart des évaluations utilisent). Google indique que
  la plupart des services fonctionnent à nouveau pleinement dans les 36 heures
  suivant une restauration.
- **Une véritable lacune : les sauvegardes nocturnes ne survivent pas.** Les
  sauvegardes et autres fichiers générés sont écrits dans un bucket à
  l'intérieur du projet, et ce bucket n'est **pas** protégé par la
  suppression logicielle de Cloud Storage, il est donc très probable qu'il
  disparaisse dès que vous supprimez le projet — même si le projet lui-même
  est récupérable pendant 30 jours. Si vous avez personnalisé Logto et que
  vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google
  Drive ou un bucket en dehors du projet) avant de supprimer. Pour une
  installation par défaut sans rien d'irremplaçable, cela n'a pas
  d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre
propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter
de payer est de supprimer le déploiement et de le redéployer lorsque vous en
avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau, plus les
  builds — environ 180 crédits (18,00 $ US) au total. La suppression ne permet
  d'économiser de l'argent que si Logto reste inutilisé assez longtemps pour
  compenser ce coût de redéploiement par rapport à son propre coût de
  fonctionnement — environ **5 jours ou plus**, à la fois dans votre propre
  projet (environ 3,66 $ US par jour) et dans un projet géré par RAD (49
  crédits par jour).
- **La majeure partie du coût de fonctionnement est généralement partagée.**
  Pour Logto, il s'agit de la base de données et de la VM de fichiers/cache
  partagée. Elles ne s'arrêtent que si rien d'autre dans le projet ne les
  utilise, donc la suppression de cette application pendant que quelque chose
  d'autre partage le projet n'économise que la partie calcul de cette
  application.
- **Conservez d'abord vos données.** Les sauvegardes nocturnes vont dans un
  bucket à l'intérieur du déploiement et sont supprimées avec lui, alors
  copiez la dernière sauvegarde avant de supprimer si vous voulez la
  conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour
  une classe. Chaque participant obtient l'application dans son propre projet
  Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une
  autorisation définie par le formateur. Soit le formateur finance toutes les
  places, soit chaque participant paie la sienne. Tout est supprimé à la fin
  de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire
  exécute l'application pour un client à partir d'un portefeuille cloisonné
  qu'il finance, et règle directement avec le client. Si le portefeuille
  devient faible, la facturation est suspendue et les données sont
  conservées, de sorte que personne ne reçoit de frais inattendus. À la fin,
  le partenaire transfère le projet et les déploiements deviennent la
  propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF,
NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud
Billing Catalog ; frais RAD et estimation des crédits quotidiens de
[radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et
restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour les mécanismes de pause/restauration et ce qu'il dit sur les objets Cloud
Storage sans suppression logicielle ; [Auth0](https://auth0.com/pricing). Les
prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Logto s'exécute en tant que conteneur Node.js sur Cloud Run v2. Le déploiement
relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Node.js, 2 vCPU / 4 GiB par défaut ; mise à l'échelle automatique sans serveur |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — Logto ne prend pas en charge MySQL ou d'autres moteurs |
| Stockage d'objets | Cloud Storage | Un bucket provisionné automatiquement ; facultatif pour Logto (tout l'état principal est dans Postgres) |
| Secrets | Secret Manager | Uniquement le mot de passe de la base de données — Logto n'a **aucun** secret d'application externe (les clés OIDC sont amorcées par la base de données) |
| Entrée | URL Cloud Run / Équilibrage de charge Cloud | URL par défaut `run.app` ; équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par
  la couche d'application partagée ; un garde-fou au moment du plan rejette
  tout `database_type` non-PostgreSQL.
- **Le cœur de Logto est publié sur le port 3001 ; la console d'administration
  (3002) ne l'est pas.** Cloud Run publie un seul port, donc seul le point de
  terminaison API / OIDC principal (3001) est accessible. La console
  d'administration — où le premier compte administrateur et les applications
  sont enregistrés — s'exécute sur 3002 et n'est **pas** exposée via l'URL
  `run.app`. Prévoyez un chemin séparé vers 3002 pour la configuration initiale
  (voir §3).
- **Il n'y a pas de secret d'application à protéger.** Logto génère ses clés
  de signature OIDC au premier démarrage et les stocke **dans la base de
  données**. Rien dans Secret Manager n'a besoin d'être protégé ou tourné,
  sauf le mot de passe de la base de données géré par la fondation. Protéger
  les clés de Logto signifie protéger Cloud SQL.
- **`min_instance_count = 1` par défaut.** Logto est un fournisseur d'identité sur le chemin de
  requête de chaque connexion, donc une instance est maintenue chaude pour
  éviter la latence de démarrage à froid sur les requêtes OIDC. Tout l'état
  est dans Postgres, donc `0` (mise à l'échelle à zéro) est sûr pour les
  données si vous préférez échanger les démarrages à froid contre le coût.
- **`cpu_always_allocated = false` (facturation basée sur les requêtes).** Le cœur de Logto est un
  fournisseur OIDC de requête/réponse sans travailleur de fond en cours de
  traitement qui doit s'exécuter sans requête entrante, donc le CPU n'est
  facturé que pendant le service.
- **La connexion contourne le socket Cloud SQL.** `enable_cloudsql_volume = true` injecte toujours le
  sidecar Auth Proxy, mais le pilote `slonik` de Logto ne peut pas analyser la
  forme DSN du socket Unix — le point d'entrée se connecte via l'**IP privée**
  injectée (`DB_IP`) avec `sslmode=no-verify` à la place (chiffré ; la vérification CA est
  ignorée pour le saut de la base de données uniquement).
- **Pas de Redis.** Logto est basé sur Postgres ; `enable_redis` par défaut `false`.
- **`ENDPOINT` est dérivé de l'URL du service.** Le point d'entrée définit l'émetteur
  OIDC de Logto et les URL absolues à partir de l'injecté `CLOUDRUN_SERVICE_URL` ;
  remplacez `ENDPOINT` via `environment_variables` pour un domaine personnalisé.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de
services et de ressources sont signalés dans les [Sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service Logto {#a-cloud-run--the-logto-service}

Logto s'exécute en tant que service Cloud Run v2 qui s'adapte automatiquement
à la charge de requêtes entre le nombre minimal et maximal d'instances. Chaque
déploiement crée une révision immuable ; le trafic peut être réparti entre les
révisions pour des déploiements sûrs. Le port de conteneur publié est **3001**
(cœur Logto / OIDC).

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le
  trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  # Confirm the injected DB_HOST / DB_IP / ENDPOINT on the running revision:
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Logto stocke tout — utilisateurs, applications, connecteurs, clés de signature
OIDC et rôles par locataire — dans une instance gérée Cloud SQL pour
PostgreSQL 15. Sur Cloud Run, le sidecar Auth Proxy est injecté, mais
l'application se connecte via l'**IP privée** de l'instance (`DB_IP`) avec
`sslmode=no-verify` car le pilote de Logto ne peut pas utiliser la forme DSN du socket. Au
premier déploiement, un Job d'initialisation crée la base de données et le rôle
de l'application (avec `CREATEROLE`, requis pour les rôles RLS par locataire de
Logto).

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données (`logto`), l'utilisateur (`logto`) et le
secret du mot de passe se trouvent dans les [Sorties](#5-outputs). Voir
[App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et
la rotation des mots de passe.

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** est provisionné automatiquement. Logto conserve
tout l'état principal dans PostgreSQL, ce bucket est donc disponible pour des
ressources facultatives plutôt que pour un stockage d'exécution requis.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<bucket-name>/        # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### D. Secret Manager {#d-secret-manager}

Logto n'a **aucun secret d'application externe** — ses clés de signature OIDC
sont générées et stockées dans la base de données au premier démarrage. Le seul
secret en jeu est le **mot de passe de la base de données**, que la fondation
génère et gère.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~logto"
  gcloud secrets versions access latest --secret=<database_password_secret> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de
rotation.

### E. Réseau et entrée {#e-networking--ingress}

Le service est accessible par son URL `run.app` par défaut. L'émetteur OIDC de
Logto et toutes les URL de redirection absolues sont construits à partir de
`ENDPOINT`, que le point d'entrée dérive de l'URL du service — ainsi, l'hôte
visible par le navigateur, l'émetteur et les URI de redirection enregistrés
doivent tous concorder. Un équilibreur de charge HTTPS externe avec un domaine
personnalisé, Cloud CDN et Cloud Armor peuvent être superposés ; définissez
`ENDPOINT` sur le domaine personnalisé lorsque vous le faites.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux de conteneurs sont acheminés vers Cloud Logging ; les métriques
Cloud Run et Cloud SQL sont acheminées vers Cloud Monitoring, avec des tests
de disponibilité et des politiques d'alerte facultatifs. Le point d'entrée
imprime une ligne `[cloud-entrypoint]` signalant le mode de connexion DB résolu et `ENDPOINT` —
utile pour diagnostiquer les problèmes de connexion ou d'URL d'émetteur.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Logto {#3-logto-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job
  d'initialisation exécute `db-init.sh` en utilisant `postgres:15-alpine`. Il crée de manière
  idempotente le rôle d'application **avec `CREATEDB CREATEROLE`** (requis pour les rôles RLS
  par locataire de Logto) et la base de données de l'application, puis accorde
  les privilèges et transfère la propriété du schéma `public` au rôle de
  l'application. Le job peut être réexécuté en toute sécurité.
- **Schéma et clés OIDC amorcés au démarrage.** Au démarrage, Logto exécute
  `npm run cli db seed -- --swe` (`--swe` = amorcer-si-vide, idempotent) qui crée son schéma et génère
  les clés de signature privées OIDC **dans la base de données** — uniquement
  lorsque la base de données est vide. Ces clés ne sont pas stockées dans
  Secret Manager ; la base de données est leur seul dépositaire. Effacer la
  base de données régénère de nouvelles clés et invalide tous les jetons
  précédemment émis et les clients enregistrés.
- **Pas de secret d'application à faire pivoter.** Il n'y a pas de clé de
  chiffrement ou de secret JWT dans Secret Manager — seulement le mot de
  passe de la base de données géré par la fondation.
- **La console d'administration (3002) n'est pas publiée.** Cloud Run expose
  uniquement le cœur (3001). La console d'administration — où vous créez le
  premier administrateur et enregistrez les applications — s'exécute sur 3002
  et n'est pas accessible via l'URL `run.app`. Terminez la configuration initiale
  en plaçant Logto derrière un proxy qui achemine vers 3002, ou en exposant
  temporairement 3002 via un déploiement dédié. `ADMIN_ENDPOINT` par défaut le même hôte
  que `ENDPOINT` pour la cohérence des URL.
- **`ENDPOINT` doit correspondre à l'hôte visible par le navigateur.** Logto
  construit son émetteur OIDC et ses URL de redirection à partir de `ENDPOINT` ;
  le point d'entrée le définit à partir de `CLOUDRUN_SERVICE_URL`. Pour un domaine
  personnalisé, définissez `ENDPOINT` dans `environment_variables` avant de déployer.
- **Chemin de santé.** Les sondes de démarrage, de vivacité et de disponibilité
  ciblent `/api/status` — un point de terminaison non authentifié qui renvoie `200`
  une fois le cœur opérationnel. La sonde de démarrage permet une large
  fenêtre de premier démarrage (délai initial de 60 s + 30 tentatives) pour
  l'étape d'amorçage. Vérifiez-le manuellement :
  ```bash
  curl -s "$(gcloud run services describe <service-name> --region "$REGION" \
    --format='value(status.url)')/api/status"
  ```
- **Inspecter l'exécution du job :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Logto sont listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
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
| `application_name` | `logto` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Logto` | Nom lisible par l'homme affiché dans la console. |
| `description` | `Logto - open-source Auth0-alternative identity provider (OIDC)` | Description du service. |
| `application_version` | `latest` | Tag d'image Logto (`svhd/logto:<tag>`) ; épingler à une version spécifique (par exemple `1.33`) en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | Logto est construit comme un mince wrapper `FROM svhd/logto` — conserver `custom`. |
| `cpu_limit` | `2000m` | CPU par instance. |
| `memory_limit` | `4Gi` | Mémoire par instance ; Logto nécessite au moins 2 GiB pour un fonctionnement fiable. |
| `cpu_always_allocated` | `false` | Facturation basée sur les requêtes (CPU facturé uniquement pendant le service). Logto n'a pas de travailleur en arrière-plan à maintenir en vie. |
| `min_instance_count` | `1` | Garder 1 chaud pour que les requêtes OIDC/connexion ne subissent jamais un démarrage à froid ; `0` est sûr pour les données (tout l'état est dans Postgres). |
| `max_instance_count` | `5` | Plafond de coût ; doit être ≥ `min_instance_count`. |
| `container_port` | `3001` | Le cœur de Logto écoute sur 3001 ; la console d'administration (3002) n'est pas publiée. |
| `execution_environment` | `gen2` | Gen2 recommandé. |
| `timeout_seconds` | `300` | Durée maximale de la requête. |
| `enable_cloudsql_volume` | `true` | Injecte le sidecar Auth Proxy ; Logto se connecte toujours via `DB_IP` (DSN de socket non pris en charge par slonik). |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Entrée publique afin que les clients OIDC externes et les navigateurs puissent atteindre Logto. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via VPC. |
| `enable_iap` | `false` | Exiger la connexion Google. **Bloque le trafic OIDC/connexion non authentifié** — laisser désactivé pour un IdP public. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires. Définissez `ENDPOINT` ici pour un domaine personnalisé. Ne définissez pas `PORT` (Cloud Run le réserve) ou `DB_URL` (composé par le point d'entrée). |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. Logto n'en a pas besoin par défaut. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatique de la base de données (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9-11 — Équilibreur de charge / Stockage / SQL personnalisé {#group-911--load-balancer--storage--custom-sql}

`enable_cloud_armor`, `application_domains`, `enable_cdn`, et les paramètres de rétention d'Artifact Registry
(Groupe 9) ; `create_cloud_storage`, `storage_buckets`, `enable_nfs`,
`gcs_volumes` (Groupe 10) ; et `enable_custom_sql_scripts` et ses amis (Groupe 11) suivent tous le
comportement standard de [App_CloudRun](App_CloudRun.md). NFS est désactivé par
défaut — Logto n'a pas besoin de système de fichiers partagé.

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `db_name` | `logto` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `logto` | Utilisateur de la base de données de l'application (accordé `CREATEROLE`). Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/status`, 60s de délai, 30 tentatives | Large fenêtre de premier démarrage pour l'étape d'amorçage. |
| `liveness_probe` | HTTP `/api/status`, 60s de délai, 30s de période | Sonde de vivacité. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Test de disponibilité Cloud Monitoring. Désactivé par défaut ; activer et définir `path = "/api/status"` pour la surveillance de production. |

### Groupe 21 — Cache et file d'attente Redis {#group-21--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Logto utilise Postgres pour toute la persistance — laisser `false`. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

Toutes les autres entrées suivent le comportement standard de
[App_CloudRun](App_CloudRun.md).

---

## 5. Sorties {#5-outputs}

Retournées lors d'un déploiement réussi — le moyen le plus rapide de localiser
et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service (point de terminaison Logto core / OIDC). |
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

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration
> au moteur de fondation [App_CloudRun](App_CloudRun.md), qui valide les
> valeurs *et les combinaisons* au moment du plan — un `database_type` non-PostgreSQL,
> `min_instance_count > max_instance_count`, Redis activé sans hôte résolvable, `enable_cloudsql_volume` sans base de données. Une
> configuration invalide échoue au **plan** avec une erreur claire et nommée
> avant la création de toute ressource, de sorte que la plupart des erreurs
> ci-dessous sont détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| Base de données Cloud SQL | Sauvegarder ; ne jamais effacer | Critique | Les clés de signature OIDC de Logto résident dans la base de données. L'effacer régénère de nouvelles clés et invalide tous les jetons émis et les clients enregistrés. |
| `db_name` / `db_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/le rôle et détruit toutes les données d'identité. |
| `database_type` | `POSTGRES_15` | Critique | MySQL/autres moteurs sont rejetés au moment du plan ; Logto ne s'exécute que sur PostgreSQL. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans fichier de sauvegarde valide échoue au job d'importation. |
| `ENDPOINT` | Hôte réel visible par le navigateur | Élevé | Un émetteur non concordant interrompt la découverte OIDC, les URI de redirection et chaque rappel OAuth. |
| `container_port` | `3001` | Élevé | Le cœur écoute sur 3001 ; un mauvais port fait échouer chaque sonde et requête. La console d'administration (3002) est intentionnellement non publiée. |
| `enable_iap` | `false` pour un IdP public | Élevé | IAP bloque toutes les requêtes non authentifiées, y compris les flux OIDC/connexion que Logto est censé servir. |
| `memory_limit` | `4Gi` (≥ 2 GiB) | Élevé | En dessous de ~2 GiB, Logto est sujet aux OOM sous charge. |
| Accès à la console d'administration (3002) | Planifier un itinéraire avant la mise en service | Élevé | L'interface utilisateur de configuration/premier administrateur est sur 3002, inaccessible via l'URL `run.app` — la configuration initiale est bloquée sans chemin séparé. |
| `enable_cloudsql_volume` | `true` | Moyen | Le sidecar proxy est injecté pour la parité, mais Logto se connecte via `DB_IP` ; le désactiver supprime le sidecar sans nuire au chemin IP privée de l'application. |
| `min_instance_count` | `1` pour la production | Moyen | La mise à l'échelle à zéro (`0`) ajoute une latence de démarrage à froid à la première connexion après l'inactivité (sûr pour les données sinon). |
| `enable_redis` | `false` | Faible | Logto n'utilise pas Redis ; l'activer connecte une dépendance inutilisée. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — identité de
service, mise à l'échelle et concurrence, entrée et équilibrage de charge,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en
miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration
d'application spécifique à Logto partagée avec la variante GKE est décrite dans
**[Logto_Common](Logto_Common.md)**.

<!-- related-guides -->

## Guides associées {#related-guides}

- [Lab pratique : Logto sur Cloud Run](../labs/Logto_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Logto sur GKE Autopilot](Logto_GKE.md) — la même application sur Kubernetes, pour lorsque vous avez besoin de l'autre cible de déploiement.
- [Logto Common — Configuration d'application partagée](Logto_Common.md) — la configuration partagée par les deux cibles de déploiement.
