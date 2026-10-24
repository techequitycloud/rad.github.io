---
title: "Dify sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Dify sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Dify_GKE.md @ e69407af sha256:ab8a0ac143f1 -->

# Dify sur GKE Autopilot {#dify-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Dify_GKE.png" alt="Dify sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Dify est une plateforme open-source de développement d'applications LLM pour la création
d'applications d'IA de qualité production avec un constructeur de flux de travail visuel, un
pipeline RAG, un framework d'agents, une gestion multi-modèles et une observabilité intégrée. Ce
module déploie Dify sur **GKE Autopilot** sur la base de la fondation [App_GKE](App_GKE.md), qui
provisionne et gère l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Dify et sur la manière de les explorer
et de les opérer depuis la console Google Cloud et la ligne de commande. Pour les mécanismes
communs à toutes les applications GKE — Workload Identity, ingress, autoscaling, CI/CD, Cloud
Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et le cycle de vie du
déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md) plutôt que de les
répéter ici.

---

## Ce que coûte Dify sur RAD, et comment cela se compare {#what-dify-costs-on-rad-and-how-that-compares}

**Dify sur le module GKE Autopilot de RAD coûte environ 149,81 $ US par mois dans un projet
Google Cloud que vous possédez, plus des frais de module uniques de 300 crédits (30 $ US).** Dify
est un constructeur visuel pour les applications LLM de production, avec un pipeline RAG, un
framework d'agents et une observabilité intégrée. Pour le coût le plus bas, le [guide Cloud
Run](Dify_CloudRun.md) exécute le même Dify pour environ 102 $ US par mois ; choisissez GKE ici
seulement si Dify doit rester opérationnel en continu, s'adapter à travers les pods, ou
fonctionner à côté d'autres charges de travail Kubernetes.

Si Dify n'est nécessaire qu'occasionnellement — une démo, un essai, une charge de travail
saisonnière ou d'étude — un projet géré par RAD peut être supprimé et restauré dans les 30 jours
pour une poignée de crédits, de sorte que 149,81 $ US deviennent quelques dollars par mois
seulement. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 300 crédits (30 $ US au prix de la recharge) | 270 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build (environ 3 à 6) | Idem |
| Coût de fonctionnement Google Cloud | Facturé par Google à votre propre compte de facturation, environ **149,81 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **116 crédits par jour**, soit environ 3480 par mois (environ 348 $ US au prix de la recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge unique, moins sur un plan. Dans un projet géré par
RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les
applications du projet, donc une deuxième application n'ajoute pas une deuxième base de données.

**Coût de fonctionnement par défaut dans votre propre projet** (us-central1, prix catalogue
Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Pod GKE Autopilot, 2x vCPU / 4 Gio | 79,35 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 $ |
| **Total** | **environ 149,81 $ US** |

### Comment cela se compare {#how-it-compares}

- L'offre gérée du projet, **Dify Cloud**, propose un plan Sandbox gratuit, puis 590 $ par espace
  de travail par an (environ 49 $ par mois) sur le plan Professionnel et 1 590 $ par espace de
  travail par an (environ 133 $ par mois) sur le plan Équipe.
- Si vous l'exécutez vous-même, un VPS exécutant l'API, le worker et les conteneurs web de Dify
  ainsi que PostgreSQL vous coûte moins cher en espèces : dimensionné à environ 2 vCPU/4 Gio, un
  VPS comparable (Hetzner ou DigitalOcean) coûte environ 24 à 48 $ par mois, ou une VM de classe
  GCP `e2-standard-2` environ 49 $ — plus votre propre temps pour les sauvegardes, les correctifs de
  sécurité et les mises à niveau, que Cloud SQL, Secret Manager et la surveillance gérés par RAD
  couvrent pour vous.
- RAD ne prétend jamais être moins cher que l'infrastructure nue en termes monétaires — ce n'est
  généralement pas le cas. La différence est ce que RAD gère pour vous : les correctifs, les
  sauvegardes, les secrets et la surveillance, plus la possibilité de mettre Dify en pause
  gratuitement plutôt que de payer pour une capacité inactive (voir ci-dessous).
- La majeure partie du coût de fonctionnement ci-dessus est la base de données PostgreSQL gérée
  (et, le cas échéant, le serveur de fichiers partagé) — la partie qu'une comparaison avec un VPS
  nu doit exécuter et sauvegarder manuellement.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Dify fonctionne dans **un projet géré par RAD pour vous**, vous avez une deuxième option qui
va bien au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du projet et restaurez-le
dans les 30 jours pour presque rien.** Cela convient bien mieux à Dify dont vous n'avez besoin
qu'occasionnellement que de le faire fonctionner en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation,
  puis demande à Google de supprimer le projet. Google ne supprime pas le projet
  immédiatement : il le conserve, récupérable, pendant 30 jours. Comme la facturation est déjà
  déliée, rien n'est facturé pendant qu'il attend. Contrairement à la suppression d'un module,
  cela ne supprime pas les ressources Cloud SQL, la VM ou GKE Autopilot une par une — l'ensemble
  du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours,
  le propriétaire du projet peut le restaurer. RAD demande à Google de récupérer le projet et de
  rattacher son compte de facturation, puis vous demande d'exécuter **Update** sur chaque
  déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit
  individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une
  vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module
  à nouveau. Cela représente une poignée de crédits (moins de 1 $ US) au total pour une chaîne
  Dify typique, contre les 305 crédits que coûte un redéploiement complet.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, pas 149,81 $ US.**
  Déployez Dify, utilisez-le, supprimez le projet. Restaurez-le la prochaine fois que vous en
  avez besoin, confirmez avec Update, et supprimez-le à nouveau lorsque vous avez terminé. Vous
  ne payez qu'une seule fois les frais de module, les builds, et les heures où il était
  effectivement en ligne.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un projet que vous
  apportez et dont RAD ne gère que la facturation), et vous le restaurez vous-même dans les 30
  jours — après cela, Google le supprime définitivement. La restauration est admise comme la
  création d'un nouveau projet : votre solde de crédits achetés doit toujours dépasser le seuil
  du palier (100 crédits pour le palier sandbox que la plupart des utilisations d'étude et de
  démo conviennent). Google indique que la plupart des services fonctionnent à nouveau
  complètement dans les 36 heures suivant une restauration.
- **Un véritable manque : le bucket de sauvegarde ne survit pas.** Les sauvegardes nocturnes
  sont écrites dans un bucket à l'intérieur du projet, et ce bucket n'est **pas** protégé par la
  suppression logicielle de Cloud Storage, il est donc très probable qu'il disparaisse dès que
  vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si
  vous avez personnalisé Dify et que vous souhaitez conserver ce travail, copiez une sauvegarde
  (vers Google Drive, ou un bucket en dehors du projet) avant de supprimer. Pour une
  installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

GKE Autopilot maintient au moins un pod en cours d'exécution, il ne se met donc jamais à zéro de
lui-même. L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre
projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de supprimer
le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ 305
  crédits (30,50 $ US) dans votre propre projet. La suppression ne permet d'économiser de
  l'argent que si Dify devait rester inutilisé pendant environ 7 jours ou plus dans votre propre
  projet (5 $ US par jour), ou environ 3 jours ou plus dans un projet géré par RAD (116 crédits
  par jour).
- **La majeure partie du coût de fonctionnement est généralement la base de données et le
  serveur de fichiers ou de cache partagé.** Ils ne s'arrêtent que si rien d'autre dans le
  projet ne les utilise, donc la suppression de Dify alors que quelque chose d'autre partage le
  projet n'économise que la partie calcul de cette application.
- **Conservez vos données en premier.** Les sauvegardes nocturnes sont écrites dans un bucket à
  l'intérieur du déploiement et sont supprimées avec lui, alors copiez la dernière sauvegarde
  avant de la supprimer si vous voulez la conserver.
- **Notez vos paramètres.** RAD ne recrée pas un déploiement supprimé pour vous ; vous entrez
  les paramètres à nouveau lorsque vous déployez.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque
  participant reçoit l'application dans son propre projet Google Cloud pendant 15 minutes à 24
  heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance
  toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la
  session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire exécute l'application
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
supervisord) plus un frontend web Next.js séparé. Le déploiement relie un ensemble ciblé de
services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pod API+worker (2 vCPU / 4 Gio par défaut) + pod frontend web, autoscalé horizontalement |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — extension pgvector activée pour le stockage vectoriel |
| Stockage vectoriel | pgvector (dans la base de données) | Réutilise l'instance Cloud SQL ; aucune base de données vectorielle séparée n'est nécessaire |
| Fichiers partagés | Filestore (NFS) | Colocation d'hôte Redis partagé ; la VM NFS est également utilisée pour l'état des tâches |
| Stockage d'objets | Cloud Storage | Un bucket `gcs-dify<resource-prefix>-storage` dédié pour les fichiers et les actifs téléchargés |
| Cache et file d'attente de tâches | Redis | Requis pour le broker/backend Celery et le streaming LLM SSE/WebSocket |
| Secrets | Secret Manager | SECRET_KEY et mot de passe de base de données auto-générés |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé facultatif + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** MySQL et `NONE` ne sont pas pris en charge ; Dify
  nécessite PostgreSQL pour toutes les métadonnées, l'état du flux de travail et les comptes
  utilisateur.
- **pgvector est toujours activé.** L'extension `vector` est installée automatiquement sur
  l'instance Cloud SQL, faisant de la même instance de base de données le stockage vectoriel —
  aucun service supplémentaire n'est requis.
- **Redis est requis.** Celery (exécution de flux de travail, indexation de documents, appels
  LLM asynchrones) et le bus d'événements SSE/WebSocket dépendent tous deux de Redis. Le
  désactiver interrompt tout traitement en arrière-plan.
- **NFS est activé par défaut.** La VM du serveur NFS héberge le processus Redis lorsqu'aucun
  hôte Redis externe n'est défini.
- **Un frontend web est déployé automatiquement.** Un déploiement `langgenius/dify-web` est connecté à
  l'URL du service API — vous n'avez pas besoin de le configurer séparément.
- **SECRET_KEY est auto-généré** et stocké dans Secret Manager ; il signe les sessions Dify et
  ne doit jamais être modifié après le premier déploiement.
- **Les migrations de base de données s'exécutent à chaque démarrage de pod** (via `MIGRATION_ENABLED=true`),
  de sorte que les mises à niveau de version appliquent automatiquement les modifications de
  schéma.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les
autres identifiants sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Dify {#a-gke-autopilot--the-dify-workload}

Dify exécute deux déploiements Autopilot : le pod API+worker (Flask/gunicorn + Celery via
supervisord) et le frontend web (Next.js). L'autoscaling horizontal des pods dimensionne chaque
déploiement entre le nombre minimal et maximal de réplicas.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail Dify API ou web
  pour voir les pods, les événements et l'utilisation des ressources. Kubernetes Engine → Services
  & Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de l'autoscaling et du type de charge de
travail (Deployment vs StatefulSet).

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Dify stocke toutes les données d'application (flux de travail, bases de connaissances, comptes
utilisateur, clés API) dans une instance Cloud SQL pour PostgreSQL 15 gérée. Les pods se
connectent en privé via le sidecar **Cloud SQL Auth Proxy** sur un socket Unix — aucune IP
publique n'est exposée. Lors du premier déploiement, un job d'initialisation crée la base de
données et l'utilisateur de l'application. L'extension `pgvector` est installée
automatiquement afin que la même instance serve de stockage vectoriel.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les drapeaux
  et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret Manager
contenant le mot de passe sont tous affichés dans les [Sorties](#5-outputs). Pour le modèle de
connexion, les sauvegardes automatisées et la rotation des mots de passe, voir
[App_GKE](App_GKE.md).

### C. Filestore (NFS) et Cloud Storage {#c-filestore-nfs-and-cloud-storage}

Un partage **Filestore (NFS)** est monté dans chaque pod. La VM du serveur NFS exécute également
le processus Redis utilisé comme broker Celery lorsqu'aucun hôte Redis externe n'est configuré.
Un bucket **Cloud Storage** dédié (`gcs-dify<resource-prefix>-storage`) est provisionné pour les fichiers et les
actifs téléchargés ; le pilote `google-storage` de Dify y accède via Workload Identity — aucun
fichier de clé de compte de service n'est nécessaire.

- **Console :** Filestore → Instances pour le partage NFS ; Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<dify-storage-bucket>/
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h | grep -i nfs
  ```

Voir [App_GKE](App_GKE.md) pour les options de provisionnement NFS, GCS Fuse et CMEK.

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

Le `SECRET_KEY` de Dify (utilisé pour la signature JWT et le chiffrement de session) et le mot de
passe de la base de données sont stockés en tant que secrets Secret Manager et injectés dans les
pods au moment de l'exécution ; le texte en clair n'apparaît jamais dans les spécifications des
pods. Le `SECRET_KEY` est généré une seule fois et ne doit pas être renouvelé pendant que le
déploiement est en cours d'exécution — tous les pods doivent partager la même valeur.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données se trouve dans les [Sorties](#5-outputs).
Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store CSI.

### F. Réseau et ingress {#f-networking--ingress}

Par défaut, le service Dify est exposé via une adresse IP externe de Cloud Load Balancing. Un
domaine personnalisé avec un certificat géré par Google peut être activé, et une adresse IP
statique peut être réservée afin que l'adresse survive aux redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails de l'IP
statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les métriques GKE et
Cloud SQL sont acheminées vers Cloud Monitoring. Des vérifications de disponibilité et des
politiques d'alerte facultatives sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Dify {#3-dify-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job d'initialisation
  (`db-init`) se connecte à Cloud SQL via l'Auth Proxy et crée de manière
  idempotente l'utilisateur et la base de données Dify. Il s'exécute automatiquement et peut être
  réexécuté en toute sécurité.
- **Migrations au démarrage.** Chaque pod exécute les migrations de base de données Flask-Migrate
  de Dify au démarrage (`MIGRATION_ENABLED=true`), de sorte que la mise à niveau de la version de
  l'application applique automatiquement les modifications de schéma. Aucun job de migration
  séparé n'est nécessaire.
- **API + worker dans un seul pod.** Le conteneur personnalisé enveloppe `langgenius/dify-api` avec
  supervisord. Le serveur API gunicorn et le worker Celery s'exécutent tous deux dans le même
  pod — ils partagent l'allocation de CPU et de mémoire. Dimensionnez en conséquence : 2 vCPU et
  4 Gio est le minimum recommandé.
- **Frontend web.** Un déploiement `langgenius/dify-web` est déployé automatiquement et connecté à
  l'URL du service API. Accédez à Dify via l'adresse IP externe du service web ou la sortie
  `web_url`.
- **Clés API du fournisseur LLM.** Les clés du fournisseur (OpenAI, Anthropic, etc.) sont
  configurées par espace de travail via la console web Dify et stockées dans la base de données
  de l'application. Utilisez `secret_environment_variables` uniquement pour la configuration au niveau de
  l'environnement qui ne peut pas être définie dans l'interface utilisateur.
- **CORS.** `WEB_API_CORS_ALLOW_ORIGINS` et `CONSOLE_CORS_ALLOW_ORIGINS` par défaut à `"*"`.
  Restreignez à votre domaine via `environment_variables` en production.
- **Chemin de santé.** Les sondes de vivacité et de disponibilité ciblent `/health` avec un
  délai initial de 30 secondes pour permettre au serveur API et aux migrations de base de données
  de se terminer au premier démarrage.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres spécifiques ou notables pour Dify sont listés ; toutes les
autres entrées sont héritées de [App_GKE](App_GKE.md) avec son comportement standard et ses
valeurs par défaut.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails autorisés à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources pour le suivi des coûts et de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `dify` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Dify - LLM Application Platform` | Nom convivial affiché dans la console. |
| `description` | _(défini)_ | Annotation de description de la charge de travail. |
| `application_version` | `0.15.0` | Tag de version de l'image Dify ; s'applique aux conteneurs API et web. Épinglez à une version spécifique en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `2000m` | CPU par pod ; 2 vCPU minimum — gunicorn et Celery partagent cette allocation. |
| `memory_limit` | `4Gi` | Mémoire par pod ; 4 Gio recommandés pour la mise en cache du flux de travail LLM et le traitement des documents. |
| `min_instance_count` | `1` | Réplicas minimum. Gardez ≥ 1 pour que le worker Celery maintienne sa connexion au broker Redis. |
| `max_instance_count` | `3` | Réplicas maximum (plafond de l'autoscaler). |
| `container_port` | `5001` | Le serveur API Dify écoute sur le port 5001. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions de socket Unix. Requis pour la connectivité de la base de données. |
| `enable_vertical_pod_autoscaling` | `false` | VPA ajuste automatiquement les requêtes de ressources ; l'activer désactive HPA. |
| `enable_pod_disruption_budget` | `false` | Crée un PodDisruptionBudget pour une disponibilité minimale pendant la maintenance des nœuds. |
| `pdb_min_available` | `1` | Nombre minimum de pods disponibles pendant les perturbations. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Utilisez pour remplacer `WEB_API_CORS_ALLOW_ORIGINS`, `LOG_LEVEL`, etc. |
| `secret_environment_variables` | `{}` | Mappage de var d'env → nom de secret Secret Manager. Utilisez pour les clés API du fournisseur LLM. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service est exposé. |
| `session_affinity` | `ClientIP` | Routage persistant — recommandé pour l'état de session de Dify. |
| `workload_type` | `null` | Se résout automatiquement en `StatefulSet` lorsque le stockage par pod est activé. |
| `network_tags` | `['nfsserver']` | Tags de nœud/pod ; `nfsserver` est requis pour la connectivité NFS. |
| `gke_cluster_name` | `""` | Nom du cluster GKE. Laissez vide pour la découverte automatique. |
| `namespace_name` | `""` | Espace de noms Kubernetes. Auto-généré lorsqu'il est vide. |
| `termination_grace_period_seconds` | `60` | Secondes pendant lesquelles Kubernetes attend après SIGTERM avant de tuer de force. |

### Groupe 7 — Configuration StatefulSet {#group-7--statefulset-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Active les PVC par pod. La définition de `true` sélectionne automatiquement le type de charge de travail `StatefulSet`. |
| `stateful_pvc_size` | `10Gi` | Taille de stockage pour chaque PVC. |
| `stateful_pvc_mount_path` | `/data` | Chemin du conteneur où le PVC par pod est monté. |
| `stateful_pvc_storage_class` | `standard-rwo` | StorageClass Kubernetes pour le provisionnement de PVC. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` / `startup_probe` | HTTP `/health`, 30 s de délai | Sonde de démarrage — le conteneur ne reçoit pas de trafic tant que `/health` ne renvoie pas 200. |
| `health_check_config` / `liveness_probe` | HTTP `/health` | Sonde de vivacité. |
| `uptime_check_config` | désactivé | Vérification de disponibilité facultative de Cloud Monitoring. |
| `alert_policies` | `[]` | Politiques d'alerte métriques facultatives. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré. Fournissez une liste non vide pour le remplacer entièrement. |
| `cron_jobs` | `[]` | CronJobs Kubernetes planifiés. |
| `additional_services` | `[]` | Déploiements Kubernetes supplémentaires à côté de Dify (le frontend web est câblé automatiquement). |

### Groupe 12 — Intégration CI/CD et GitHub {#group-12--cicd--github-integration}

Intégration standard App_GKE Cloud Build / Cloud Deploy — voir
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume Filestore partagé ; fournit également l'hôte Redis par défaut lorsqu'aucun Redis externe n'est défini. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur. |
| `nfs_instance_name` | `""` | Nom d'une VM NFS GCE existante. Laissez vide pour la découverte automatique. |
| `nfs_instance_base_name` | `app-nfs` | Nom de base pour une VM NFS GCE intégrée lorsqu'aucune n'existe. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne des buckets GCS supplémentaires. Le bucket `gcs-dify<resource-prefix>-storage` est toujours provisionné par Dify_Common. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets supplémentaires au-delà du bucket de stockage auto-provisionné. |
| `gcs_volumes` | `[]` | Montages GCS Fuse via le pilote CSI. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `db_name` | `dify_db` | Nom de la base de données PostgreSQL. **Immuable après le premier déploiement.** |
| `db_user` | `dify_user` | Utilisateur de l'application. **Immuable après le premier déploiement.** |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmentez à 30–90 pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutez du SQL à partir d'un bucket GCS après le provisionnement. Voir
[App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne Ingress pour les noms d'hôte personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable à travers les redéploiements. **Ne définissez pas `false` pour Dify** — voir le piège critique dans [§6](#6-configuration-pitfalls--sensible-defaults) : les appels API du frontend web se résolvent en un nom d'hôte interne inaccessible sans cela. |

### Groupe 20 — Proxy sensible à l'identité (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google devant Dify. Nécessite `enable_custom_domain = true`. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque IAP est activé (sensible). |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | **Requis.** Active Redis pour la file d'attente de tâches Celery et le streaming SSE/WebSocket. |
| `redis_host` | `""` | Laissez vide pour utiliser l'IP du serveur NFS ; définissez explicitement pour une instance Memorystore externe. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de
localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes (API Dify). |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster du service API. |
| `stage_service_cluster_ips` | Mappage des ClusterIP pour les services spécifiques à l'étape (Cloud Deploy). |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `web_url` | URL du frontend web Dify (utilisez ceci pour ouvrir l'interface utilisateur du navigateur). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et (facultatifs) d'importation. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails du dépôt CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster et la charge de travail sont prêts. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `enable_redis` | `true` (obligatoire) | Critique | Toutes les tâches Celery (exécution de workflow, indexation de documents, appels LLM asynchrones) échouent silencieusement sans Redis. |
| `enable_cloudsql_volume` | `true` (obligatoire) | Critique | Le sidecar Auth Proxy est le seul chemin vers PostgreSQL ; le désactiver interrompt toute la connectivité à la base de données. |
| `SECRET_KEY` (auto-générée) | immuable une fois définie | Critique | Tous les pods doivent partager la même clé ; la faire pivoter déconnecte tous les utilisateurs et invalide les sessions actives. |
| `db_name` / `db_user` | défini une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données et détruit les données. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activation sans un `backup_uri` valide fait échouer le job d'importation. |
| `enable_redis` + `enable_nfs` | les deux `true` si pas de Redis externe | Critique | Sans NFS, il n'y a pas d'hôte Redis lorsque `redis_host` est vide — Celery ne démarre pas. |
| `secret_environment_variables` pour les clés LLM | toujours utiliser des références de secrets | Critique | Les variables d'environnement en clair exposent les clés API dans les spécifications de pod visibles via `kubectl describe pod`. |
| `enable_redis` + `redis_host` | hôte correct | Élevé | Un `redis_host` incorrect produit une URL de broker Celery mal formée ; toutes les tâches asynchrones restent en file d'attente indéfiniment. |
| `reserve_static_ip` + `service_type` | `true` / `LoadBalancer` — **ne pas modifier pour Dify** | Critique | Les `CONSOLE_API_URL`/`APP_API_URL` du frontend web se résolvent via la sentinelle `$(GKE_SERVICE_URL)` vers `local.service_url`, qui se rabat sur le nom d'hôte interne inaccessible `*.svc.cluster.local` si `reserve_static_ip=false` ou `service_type` est remplacé par autre chose que `LoadBalancer`. La page se charge, mais chaque appel API côté navigateur échoue avec `net::ERR_NAME_NOT_RESOLVED`. C'est une véritable exception à la convention `reserve_static_ip=false` de conservation du quota IP à l'échelle de la flotte. |
| `memory_limit` | `4Gi` | Élevé | Trop peu de mémoire provoque des arrêts OOM (Out Of Memory) pendant l'ingestion de documents ou la mise en cache de workflow LLM. |
| `min_instance_count` | `1` | Élevé | La mise à l'échelle à zéro provoque des démarrages à froid et l'abandon des tâches Celery en cours. |
| `timeout_seconds` | `300` (augmenter pour les workflows) | Élevé | Les workflows multi-étapes et l'indexation RAG peuvent dépasser 300 s ; augmenter à `3600` pour les déploiements complexes. |
| `WEB_API_CORS_ALLOW_ORIGINS` | restreindre en production | Élevé | Le `"*"` par défaut autorise les requêtes cross-origin depuis n'importe quel domaine. |
| `application_version` | épingler à une version spécifique | Moyen | Les versions non épinglées risquent des migrations de schéma inattendues qui cassent l'application lors du redéploiement. |
| `enable_iap` / `enable_cloud_armor` | activer pour la production | Moyen | La console Dify est publiquement accessible sans ces contrôles. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de base référencé partout — IAM et Workload Identity, autoscaling,
ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes, et
mise en miroir d'images — voir **[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Dify partagée
avec la variante Cloud Run est décrite dans **[Dify_Common](Dify_Common.md)**.

## Guides associés {#related-guides}

- [Lab pratique : Dify sur GKE Autopilot](../labs/Dify_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Dify sur Google Cloud Run](Dify_CloudRun.md) — la même application sur Cloud Run, pour quand vous avez besoin de l'autre cible de déploiement.
- [Dify Common — Configuration d'application partagée](Dify_Common.md) — la configuration partagée par les deux cibles de déploiement.
