---
title: "Dify sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Dify sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Dify_CloudRun.md @ e69407af sha256:043ed0780c38 -->

# Dify sur Google Cloud Run {#dify-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Dify_CloudRun.png" alt="Dify sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Dify est une plateforme open source de développement d'applications LLM pour la création
d'applications d'IA de qualité production avec un constructeur de flux de travail visuel, un
pipeline RAG, un framework d'agents, une gestion multi-modèles et une observabilité
intégrée. Ce module déploie Dify sur **Cloud Run v2** sur la base de la fondation
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Dify et sur la manière de les explorer
et de les opérer depuis la console Google Cloud et la ligne de commande. Pour les mécanismes
communs à toutes les applications Cloud Run — identité de service, entrée et équilibrage de
charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, sauvegardes et cycle de vie du déploiement — veuillez vous référer au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## Ce que coûte Dify sur RAD, et comment cela se compare {#what-dify-costs-on-rad-and-how-that-compares}

**Le module Cloud Run de Dify sur RAD coûte environ 102 $ US par mois dans un projet Google Cloud
que vous possédez, plus des frais de module uniques de 175 crédits (17,50 $ US).** Dify est un
constructeur visuel pour les applications LLM de production, avec un pipeline RAG, un framework
d'agents et une observabilité intégrée. GKE Autopilot convient aux Dify qui doivent rester
opérationnels, s'adapter à travers les pods ou fonctionner aux côtés d'autres charges de travail
Kubernetes ; pour le coût le plus bas, ce module Cloud Run est généralement le bon choix —
consultez le [guide GKE](Dify_GKE.md) si vous avez besoin de l'autre.

Si Dify n'est nécessaire qu'occasionnellement — une démo, un essai, une charge de travail
saisonnière ou d'étude — un projet géré par RAD peut être supprimé et restauré dans les 30 jours
pour une poignée de crédits, de sorte que les 102 $ US deviennent quelques dollars par mois.
Voir **Mettre en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 175 crédits (17,50 $ US au prix de la recharge) | 157,5 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build (environ 3 à 6) | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **102 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **32 crédits par jour**, environ 960 par mois (environ 96 $ US au prix de la recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US lors d'une recharge unique, moins sur un plan. Dans un projet géré par
RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les
applications du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième base de
données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Cloud Run, 2x vCPU / 4 GiB (scaleToZero) | 31,53 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| **Total** | **environ 102 $ US** |

### Comment cela se compare {#how-it-compares}

- L'offre gérée du projet, **Dify Cloud**, propose un plan Sandbox gratuit, puis 590 $ par
  espace de travail par an (environ 49 $ par mois) sur Professional et 1 590 $ par espace de
  travail par an (environ 133 $ par mois) sur Team.
- Si vous l'exécutez vous-même, un VPS exécutant l'API, le worker et les conteneurs web de Dify
  ainsi que PostgreSQL vous coûtera moins cher en espèces : dimensionné à environ 2 vCPU/4 GiB,
  un VPS comparable (Hetzner ou DigitalOcean) coûte environ 24 à 48 $ par mois, ou une VM GCP
  `e2-standard-2` de classe environ 49 $ — plus votre propre temps pour les sauvegardes, les
  correctifs de sécurité et les mises à niveau, que le Cloud SQL géré, Secret Manager et la
  surveillance de RAD couvrent pour vous.
- RAD ne prétend jamais être moins cher que l'infrastructure nue en termes monétaires — ce n'est
  généralement pas le cas. La différence est ce que RAD gère pour vous : les correctifs, les
  sauvegardes, les secrets et la surveillance, plus la possibilité de mettre Dify en pause
  gratuitement plutôt que de payer pour une capacité inactive (voir ci-dessous).
- La majeure partie du coût d'exécution ci-dessus est la base de données PostgreSQL gérée (et,
  le cas échéant, le serveur de fichiers partagé) — la partie qu'une comparaison avec un VPS nu
  doit exécuter et sauvegarder manuellement.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Dify s'exécute dans **un projet géré par RAD pour vous**, vous avez une deuxième option qui va
bien au-delà de la mise à l'échelle à zéro : **supprimer l'ensemble du projet et le restaurer
dans les 30 jours pour presque rien.** Cela convient bien mieux à Dify dont vous n'avez besoin
qu'occasionnellement que de le faire fonctionner en continu.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation,
  puis demande à Google de supprimer le projet. Google ne supprime pas le projet
  immédiatement : il le conserve, récupérable, pendant 30 jours. Comme la facturation est déjà
  déliée, rien n'est facturé pendant qu'il attend. Contrairement à la suppression d'un module,
  cela ne supprime pas Cloud SQL, la VM ou les ressources Cloud Run une par une — l'ensemble du
  projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours,
  le propriétaire du projet peut le restaurer. RAD demande à Google de récupérer le projet et de
  rattacher son compte de facturation, puis vous demande d'exécuter **Update** sur chaque
  déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit
  individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une
  vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module
  à nouveau. Cela représente une poignée de crédits (moins de 1 $ US) au total pour une chaîne
  Dify typique, contre les 180 crédits que coûte un redéploiement complet.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, pas 102 $ US.**
  Déployez Dify, utilisez-le, supprimez le projet. Restaurez-le la prochaine fois que vous le
  voulez, confirmez avec Update, et supprimez-le à nouveau lorsque vous avez terminé. Vous ne
  payez les frais de module qu'une seule fois, les builds et les heures pendant lesquelles il a
  été réellement actif.
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet que vous apportez et
  dont RAD ne gère que la facturation), et vous le restaurez vous-même dans les 30 jours —
  après cela, Google le supprime définitivement. La restauration est admise comme la création
  d'un nouveau projet : votre solde de crédits achetés doit toujours dépasser le seuil du palier
  (100 crédits pour le palier sandbox que la plupart des utilisations d'étude et de démo
  conviennent). Google indique que la plupart des services sont à nouveau pleinement
  opérationnels dans les 36 heures suivant une restauration.
- **Un véritable manque : le bucket de sauvegarde ne survit pas.** Les sauvegardes nocturnes
  sont écrites dans un bucket à l'intérieur du projet, et ce bucket n'est **pas** protégé par la
  suppression logicielle de Cloud Storage, il est donc très probable qu'il disparaisse dès que
  vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si
  vous avez personnalisé Dify et que vous souhaitez conserver ce travail, copiez une sauvegarde
  (vers Google Drive ou un bucket en dehors du projet) avant de supprimer. Pour une
  installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payer uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Cloud Run se met déjà à l'échelle à zéro entre les requêtes. L'option ci-dessus ne s'applique
qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours
passée, la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer
lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ
  180 crédits (18 $ US) dans votre propre projet. La suppression ne permet d'économiser de
  l'argent que si Dify resterait inutilisé pendant environ 6 jours ou plus, que ce soit dans
  votre propre projet ou dans un projet géré par RAD.
- **La majeure partie du coût d'exécution est généralement la base de données et le serveur de
  fichiers ou de cache partagé.** Ils ne s'arrêtent que lorsque rien d'autre dans le projet ne
  les utilise, de sorte que la suppression de Dify pendant que quelque chose d'autre partage le
  projet n'économise que la partie calcul de cette application.
- **Gardez vos données en premier.** Les sauvegardes nocturnes sont écrites dans un bucket à
  l'intérieur du déploiement et sont supprimées avec lui, alors copiez la dernière sauvegarde
  avant de la supprimer si vous voulez la conserver.
- **Notez vos paramètres.** RAD ne recrée pas un déploiement supprimé pour vous ; vous entrez
  les paramètres à nouveau lorsque vous déployez.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque
  participant obtient l'application dans son propre projet Google Cloud pendant 15 minutes à 24
  heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance
  toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la
  session et les crédits inutilisés retournent au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute l'application
  pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le
  client. Si le portefeuille est faible, la facturation est suspendue et les données sont
  conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire
  transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et
ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais
propres à RAD et estimations de crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ;
[Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour la fenêtre de récupération de 30 jours et ce qu'elle dit sur les objets Cloud Storage sans
suppression logicielle ; [Dify Cloud](https://dify.ai/pricing). Les prix changent ; vérifiez
chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Dify s'exécute comme un conteneur API Python/Flask (avec un worker Celery intégré sous
supervisord) plus un service de frontend web Next.js distinct. Le déploiement relie un ensemble
ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 (gen2) | Service API+worker (2 vCPU / 4 GiB par défaut) + service de frontend web, autoscaling basé sur les requêtes |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — extension pgvector activée pour le stockage vectoriel |
| Stockage vectoriel | pgvector (dans la base de données) | Réutilise l'instance Cloud SQL ; aucune base de données vectorielle séparée n'est nécessaire |
| Fichiers partagés | Filestore (NFS) | Fournit l'hôte Redis par défaut (la VM du serveur NFS co-héberge Redis) |
| Stockage d'objets | Cloud Storage | Un bucket `storage` dédié (`gcs-dify<tenant-prefix>-storage`) pour les fichiers et les actifs téléchargés |
| Cache et file d'attente de tâches | Redis | Requis pour le broker/backend Celery et le streaming LLM SSE/WebSocket |
| Secrets | Secret Manager | SECRET_KEY et mot de passe de base de données auto-générés |
| Entrée | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut, équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** MySQL et `NONE` ne sont pas pris en charge ; Dify
  nécessite PostgreSQL pour toutes les métadonnées, l'état du flux de travail et les comptes
  utilisateur.
- **pgvector est toujours activé.** L'extension `vector` est installée
  automatiquement sur l'instance Cloud SQL, faisant de la même instance de base de données le
  stockage vectoriel — aucun service supplémentaire n'est requis.
- **Redis est requis.** Celery (exécution de flux de travail, indexation de documents, appels
  LLM asynchrones) et le bus d'événements SSE/WebSocket dépendent tous deux de Redis. Le
  désactiver interrompt tout traitement en arrière-plan.
- **NFS est activé par défaut.** La VM du serveur NFS héberge le processus Redis lorsqu'aucun
  hôte Redis externe n'est défini. Nécessite un environnement d'exécution gen2.
- **Un service de frontend web est déployé automatiquement.** Un service Cloud Run `langgenius/dify-web`
  est connecté à l'URL du service API — vous n'avez pas besoin de le configurer séparément.
  Accédez à Dify via la sortie `web_url`.
- **SECRET_KEY est auto-généré** et stocké dans Secret Manager ; il signe les sessions Dify et
  ne doit jamais être modifié après le premier déploiement.
- **Les migrations de base de données s'exécutent à chaque démarrage d'instance** (via `MIGRATION_ENABLED=true`),
  de sorte que les mises à niveau de version appliquent automatiquement les modifications de
  schéma.
- **L'environnement d'exécution gen2 est requis** pour les montages NFS et les volumes GCS Fuse.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de
services et de ressources sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — les services Dify {#a-cloud-run--the-dify-services}

Dify s'exécute sous la forme de deux services Cloud Run v2 : le service API+worker (Flask/gunicorn
+ Celery via supervisord) et le frontend web (Next.js). Chaque déploiement crée une révision
immuable ; le trafic peut être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service API ou le service web pour les révisions, le
  trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Dify stocke toutes les données d'application (flux de travail, bases de connaissances, comptes
utilisateur, clés API) dans une instance Cloud SQL pour PostgreSQL 15 gérée. Le service se
connecte en privé via le **Cloud SQL Auth Proxy** sur un socket Unix — aucune IP publique n'est
exposée. Lors du premier déploiement, un Job d'initialisation crée la base de données et
l'utilisateur de l'application. L'extension `pgvector` est installée
automatiquement afin que la même instance serve de stockage vectoriel.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les
  indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe se trouvent
dans les [Sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour le modèle de
connexion, les sauvegardes et la rotation des mots de passe.

### C. Filestore (NFS) et Cloud Storage {#c-filestore-nfs-and-cloud-storage}

Un partage **Filestore (NFS)** est monté dans le service. La VM du serveur NFS exécute également
le processus Redis utilisé comme broker Celery lorsqu'aucun hôte Redis externe n'est configuré.
Un bucket **Cloud Storage** dédié (`gcs-dify<tenant-prefix>-storage`) est provisionné pour les fichiers et les
actifs téléchargés ; le pilote `google-storage` de Dify y accède via l'identité du service Cloud
Run — aucun fichier de clé de compte de service n'est nécessaire.

- **Console :** Filestore → Instances ; Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket>/
  ```

Voir [App_CloudRun](App_CloudRun.md) pour le montage NFS, GCS Fuse et CMEK.

### D. Redis — Celery et bus d'événements {#d-redis--celery-and-event-bus}

Redis est requis pour trois fonctions dans Dify :

| Rôle | Base de données Redis | Objectif |
|---|---|---|
| Broker et backend Celery | db 1 | Met en file d'attente et suit toutes les tâches en arrière-plan (inférence LLM, indexation de documents) |
| Bus d'événements | db 0 | Streaming SSE/WebSocket pour la sortie LLM en temps réel |
| Cache général | db 0 | Mise en cache de l'application |

Lorsqu'aucun hôte Redis externe n'est configuré, l'adresse IP de la VM du serveur NFS est
utilisée comme point de terminaison Redis. Pour la production, pointez `redis_host` vers une
instance Memorystore for Redis dédiée.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager {#e-secret-manager}

La `SECRET_KEY` Dify (utilisée pour la signature JWT et le chiffrement de session) et le mot de
passe de la base de données sont stockés dans Secret Manager et injectés dans le service au
moment de l'exécution. La `SECRET_KEY` est générée une seule fois et ne doit pas être
tournée pendant que le déploiement est en cours d'exécution.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### F. Réseau et entrée {#f-networking--ingress}

Le service API est accessible à son URL `run.app` par défaut ; ouvrez la sortie `web_url`
dans un navigateur pour la console Dify. Un équilibreur de charge HTTPS externe avec un domaine
personnalisé, Cloud CDN et Cloud Armor peuvent être superposés.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux des conteneurs sont acheminés vers Cloud Logging ; les métriques Cloud Run et Cloud
SQL sont acheminées vers Cloud Monitoring, avec des vérifications de disponibilité et des
stratégies d'alerte facultatives.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Dify {#3-dify-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job d'initialisation
  (`db-init`) se connecte à Cloud SQL via le proxy d'authentification et crée de manière
  idempotente l'utilisateur et la base de données Dify. Il s'exécute automatiquement lors du
  premier déploiement et peut être réexécuté en toute sécurité.
- **Migrations au démarrage.** Chaque instance exécute les migrations de base de données
  Flask-Migrate de Dify au démarrage (`MIGRATION_ENABLED=true`), de sorte que la mise à niveau de la
  version de l'application applique automatiquement les modifications de schéma. Aucun job de
  migration séparé n'est nécessaire.
- **API + worker dans un seul conteneur.** Le conteneur personnalisé encapsule `langgenius/dify-api`
  avec supervisord. Le serveur API gunicorn (port 5001) et le worker Celery s'exécutent tous deux
  dans le même conteneur — ils partagent l'allocation CPU et mémoire. Dimensionnez en
  conséquence : 2 vCPU et 4 GiB est le minimum recommandé.
- **Frontend web.** Un service Cloud Run `langgenius/dify-web` est déployé automatiquement et
  connecté à l'URL Cloud Run calculée (prédite) du service API via `CONSOLE_API_URL`/`APP_API_URL`.
  Accédez à Dify via la sortie `web_url`.
- **Clés API du fournisseur LLM.** Les clés du fournisseur (OpenAI, Anthropic, etc.) sont
  configurées par espace de travail via la console web Dify et stockées dans la base de données
  de l'application. Utilisez `secret_environment_variables` uniquement pour la configuration au niveau de
  l'environnement qui ne peut pas être définie dans l'interface utilisateur.
- **CORS.** `WEB_API_CORS_ALLOW_ORIGINS` et `CONSOLE_CORS_ALLOW_ORIGINS` par défaut à `"*"`.
  Restreignez à votre domaine via `environment_variables` en production.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/health` avec un
  délai initial de 30 secondes. Les deux sondes HTTP fonctionnent correctement sur Cloud Run car
  l'API Dify sert le port 5001 sans complications TLS/redirection (contrairement aux
  applications basées sur PHP). La sonde de démarrage permet jusqu'à 30 × 10 = 300 secondes pour
  la configuration du premier démarrage.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement telles qu'elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres spécifiques ou notables pour Dify sont listés ; toutes les
autres entrées sont héritées de [App_CloudRun](App_CloudRun.md) avec leur comportement
standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Court suffixe qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails auxquels sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `dify` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Dify - LLM Application Platform` | Nom convivial affiché dans la console. |
| `description` | _(défini)_ | Description du service. |
| `application_version` | `0.15.0` | Tag de version de l'image Dify ; s'applique aux conteneurs API et web. Épinglez à une version spécifique en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `2000m` | CPU par instance ; 2 vCPU minimum — gunicorn et Celery partagent cette allocation. |
| `memory_limit` | `4Gi` | Mémoire par instance ; 4 GiB recommandés pour la mise en cache des flux de travail LLM et le traitement des documents. |
| `min_instance_count` | `0` | Instances minimales (mise à l'échelle à zéro). Définissez ≥ 1 pour que le worker Celery maintienne sa connexion au broker Redis. |
| `max_instance_count` | `3` | Instances maximales. Agit comme un plafond de coût. |
| `cpu_always_allocated` | `false` | Valeur par défaut de démarrage à froid axée sur le coût (facturation basée sur les requêtes, associée à `min_instance_count=0`) : le CPU n'est facturé que lors du traitement d'une requête. Compromis — les pipelines asynchrones Celery (intégration de jeux de données, jobs planifiés/par lots) s'arrêtent lorsqu'ils sont mis à l'échelle à zéro ; le chat interactif et les applications fonctionnent toujours sur demande. Définissez `true` avec `min_instance_count >= 1` pour restaurer le fonctionnement continu. |
| `container_port` | `5001` | Le serveur API Dify écoute sur le port 5001. |
| `execution_environment` | `gen2` | **Requis** — gen2 est nécessaire pour les montages NFS et GCS Fuse. |
| `timeout_seconds` | `300` | Durée maximale de la requête. Augmentez à `3600` pour les flux de travail LLM de longue durée. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions de socket Unix. Requis pour la connectivité de la base de données. |
| `traffic_split` | `[]` | Allocation de trafic Canary/blue-green entre les révisions. Toutes les entrées doivent totaliser 100. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` (public), `internal`, ou `internal-and-cloud-load-balancing`. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminement du trafic RFC 1918 uniquement via le connecteur VPC. |
| `enable_iap` | `false` | Exiger la connexion Google via Identity-Aware Proxy. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires. Utilisez pour remplacer `WEB_API_CORS_ALLOW_ORIGINS`, `LOG_LEVEL`, etc. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager. Utilisez pour les clés API du fournisseur LLM. |
| `secret_propagation_delay` / `secret_rotation_period` | _(défini)_ | Attente de réplication / cadence de rotation. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmentez pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Instance NFS et SQL personnalisé {#group-9--nfs-instance--custom-sql}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `nfs_instance_name` / `nfs_instance_base_name` | _(défini)_ | Instance NFS existante / nom de base pour une instance intégrée. |
| `enable_custom_sql_scripts` / `custom_sql_scripts_bucket` / `custom_sql_scripts_path` / `custom_sql_scripts_use_root` | désactivé | Exécuter SQL à partir d'un bucket GCS après le provisionnement. Voir [App_CloudRun](App_CloudRun.md). |

### Groupe 10 — Domaine, CDN, Cloud Armor et rétention d'images {#group-10--domain-cdn-cloud-armor--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_domains` | `[]` | Noms d'hôtes personnalisés pour l'équilibreur de charge externe. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend de l'équilibreur de charge. Nécessite `enable_cloud_armor = true`. |
| `enable_cloud_armor` / `admin_ip_ranges` | désactivé | Attacher une politique WAF / restreindre l'accès privilégié. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume Filestore partagé ; fournit également l'hôte Redis par défaut. Nécessite gen2. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur. |
| `create_cloud_storage` / `storage_buckets` / `gcs_volumes` | _(défini)_ | Buckets supplémentaires / montages GCS Fuse. Le bucket `storage` (`gcs-dify<tenant-prefix>-storage`) est toujours provisionné. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Requis — ne pas modifier. Dify ne prend en charge que PostgreSQL. |
| `db_name` | `dify_db` | Nom de la base de données. **Immuable après le premier déploiement.** |
| `db_user` | `dify_user` | Utilisateur de l'application. **Immuable après le premier déploiement.** |
| `database_password_length` | `32` | Longueur du mot de passe généré (16-64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |
| `db_host_env_var_name` / `db_name_env_var_name` / `db_user_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | _(défini)_ | Noms sous lesquels les détails de connexion sont injectés (remplacements facultatifs). |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré. Fournissez une liste non vide pour le remplacer entièrement. |
| `cron_jobs` | `[]` | Jobs récurrents déclenchés par Cloud Scheduler. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `startup_probe_config` | HTTP `/health`, délai de 30 s | Sonde de démarrage — le conteneur ne reçoit pas de trafic tant que `/health` ne renvoie pas 200. |
| `liveness_probe` / `health_check_config` | HTTP `/health` | Sonde de vivacité. |
| `uptime_check_config` | désactivé, chemin `/health` | Vérification de disponibilité Cloud Monitoring ; définissez `enabled = true` pour le provisionner. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | **Requis.** Active Redis pour la file d'attente de tâches Celery et le streaming SSE/WebSocket. |
| `redis_host` | `""` | Laissez vide pour utiliser l'IP du serveur NFS ; définissez pour une instance Memorystore externe. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode de simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les
ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run (API Dify). |
| `web_url` | URL du frontend web Dify — ouvrez-la dans un navigateur pour accéder à la console Dify. |
| `api_url` | URL du service API Dify (consommée par l'interface utilisateur web et les intégrations externes). |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom de la base de données / utilisateur de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés. |
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

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `enable_redis` | `true` (requis) | Critique | Toutes les tâches Celery (exécution de flux de travail, indexation de documents, appels LLM asynchrones) échouent silencieusement sans Redis. |
| `enable_cloudsql_volume` | `true` (requis) | Critique | Le sidecar Auth Proxy est le seul chemin vers PostgreSQL ; le désactiver interrompt toute connectivité à la base de données. |
| `SECRET_KEY` (auto-généré) | immuable une fois défini | Critique | Toutes les instances doivent partager la même clé ; la faire pivoter déconnecte tous les utilisateurs et invalide les sessions actives. |
| `db_name` / `db_user` | défini une fois | Critique | Immuable après le premier déploiement ; le renommer recrée la base de données et détruit les données. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans `backup_uri` valide échoue le job d'importation. |
| `secret_environment_variables` pour les clés LLM | toujours utiliser des références secrètes | Critique | Les variables d'environnement en clair exposent les clés API dans les métadonnées de révision Cloud Run visibles dans la console. |
| `enable_redis` + `enable_nfs` | les deux `true` si pas de Redis externe | Critique | Sans NFS, il n'y a pas d'hôte Redis lorsque `redis_host` est vide — Celery ne démarre pas. |
| `redis_host` | hôte correct | Élevé | Un hôte incorrect produit une URL de broker Celery mal formée ; toutes les tâches asynchrones sont mises en file d'attente indéfiniment. |
| `database_type` | `POSTGRES_15` | Élevé | Dify nécessite PostgreSQL ; tout autre moteur échoue au démarrage. |
| `memory_limit` | `4Gi` | Élevé | Trop peu de mémoire provoque des arrêts OOM lors de l'ingestion de documents ou de la mise en cache des flux de travail LLM. |
| `min_instance_count` + `cpu_always_allocated` | livrer `0` / `false` (coût d'abord) ; définir `1`+ / `true` pour Celery continu | Élevé | Les valeurs par défaut livrées sont un choix délibéré axé sur le coût, et non une omission : la mise à l'échelle à zéro abandonne les tâches Celery en cours (intégration de jeux de données, jobs planifiés/par lots) pendant que le service est inactif. Le chat interactif et les applications fonctionnent toujours sur demande. Remplacez les deux paramètres ensemble pour restaurer le traitement en arrière-plan continu. |
| `timeout_seconds` | `300` (augmenter pour les flux de travail) | Élevé | Les flux de travail multi-étapes et l'indexation RAG peuvent dépasser 300 s ; augmentez à `3600` pour les déploiements complexes. |
| `execution_environment` | `gen2` | Élevé | gen1 ne prend pas en charge les montages NFS ou GCS Fuse. |
| `WEB_API_CORS_ALLOW_ORIGINS` | restreindre en production | Élevé | La valeur par défaut `"*"` autorise les requêtes inter-origines depuis n'importe quel domaine. |
| `application_version` | épingler à une version spécifique | Moyen | Les versions non épinglées risquent des migrations de schéma inattendues qui interrompent l'application lors du redéploiement. |
| `enable_iap` / `enable_cloud_armor` | activer pour la production | Moyen | La console Dify est accessible publiquement sans ces contrôles. |

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise à l'échelle
et concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La
configuration d'application spécifique à Dify partagée avec la variante GKE est décrite dans
**[Dify_Common](Dify_Common.md)**.

<!-- related-guides -->

## Guides associées {#related-guides}

- [Lab pratique : Dify sur Cloud Run](../labs/Dify_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Dify sur GKE Autopilot](Dify_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [Dify Common — Configuration d'application partagée](Dify_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [LiteLLM sur Google Cloud Run](LiteLLM_CloudRun.md), [Qdrant sur Google Cloud Run](Qdrant_CloudRun.md), [Crawl4AI sur Google Cloud Run](Crawl4AI_CloudRun.md), [Langfuse sur Google Cloud Run](Langfuse_CloudRun.md) dans la solution **AI Application Builder**.
