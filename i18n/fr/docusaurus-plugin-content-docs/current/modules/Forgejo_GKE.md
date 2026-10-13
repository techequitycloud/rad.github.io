---
title: "Forgejo sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Forgejo sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Forgejo_GKE.md @ e69407af sha256:cdbe4c9e121c -->

# Forgejo sur GKE Autopilot {#forgejo-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Forgejo_GKE.png" alt="Forgejo sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Forgejo est un service Git léger, autohébergé et géré par la communauté — un
fork de Gitea — offrant l'hébergement de dépôts, le suivi des problèmes, les
pull requests, un runner CI/CD (Actions) intégré, la révision de code et un
registre de paquets à partir d'un seul binaire Go. Ce module déploie Forgejo
sur **GKE Autopilot** en s'appuyant sur la fondation [App_GKE](App_GKE.md),
qui provisionne et gère l'infrastructure partagée Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Forgejo et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — veuillez vous référer au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## Ce que coûte Forgejo sur RAD, et comment cela se compare {#what-forgejo-costs-on-rad-and-how-that-compares}

**Dans un projet Google Cloud que vous possédez, le module GKE Autopilot de Forgejo sur RAD coûte environ 143 US$ par mois, plus 11 US$ une fois par déploiement et aucune licence par utilisateur.** Pour le coût le plus bas, le [module Cloud Run](Forgejo_CloudRun.md) exécute le même Forgejo pour environ 84 US$ par mois. Forgejo est une forge Git légère et autohébergée, un fork communautaire de Gitea, avec hébergement de dépôts, gestion des problèmes, pull requests et un runner Actions intégré. Les chiffres sont ceux du 8 octobre 2026 ; les sources sont listées à la fin de cette section.

Si cela s'exécute dans un projet géré par RAD pour vous, il peut être supprimé et restauré dans les 30 jours pour quelques crédits au lieu de rester en fonctionnement — ainsi, un déploiement à usage occasionnel coûte quelques dollars par mois, et non 143 US$. Voir **Mettre en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 110 crédits (11 US$ au prix de la recharge) | 99 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût de fonctionnement Google Cloud | Facturé par Google à votre propre compte de facturation, environ **143 US$ par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **108 crédits par jour**, environ 3 240 par mois (environ 324 US$ au prix de la recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 US$ pour une recharge ponctuelle, et moins avec un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût de fonctionnement par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Pod GKE Autopilot, 2 vCPU / 2 GiB, fonctionnant en permanence | 72 US$ |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51 US$ |
| Serveur de fichiers NFS/cache : une petite VM | 13 US$ |
| Passerelle et adresse IP Cloud NAT | 5 US$ |
| Cloud Storage pour les sauvegardes | 1 US$ |
| **Total** | **environ 143 US$** |

Le niveau gratuit de GKE couvre les frais de gestion d'un cluster Autopilot ou zonal par compte de facturation, donc le total ci-dessus suppose qu'il s'agit de ce cluster ; sinon, ajoutez environ 73 US$ par mois.

### Comment cela se compare {#how-it-compares}

Nous n'avons pas trouvé de plan commercial géré/SaaS spécifiquement pour Forgejo au 8 octobre 2026, donc la comparaison honnête est avec l'exécution par vous-même :

| Option | Par mois | Qui l'exécute |
|---|---|---|
| Hetzner CPX22 (2 vCPU/4 Go) | ~24 US$ | Vous : OS, mises à jour, sauvegardes, correctifs de sécurité |
| DigitalOcean 2 vCPU/4 Go Droplet | 24 US$ | Vous : OS, mises à jour, sauvegardes, correctifs de sécurité |
| GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) | ~49 US$ | Vous : OS, mises à jour, sauvegardes, correctifs de sécurité |
| **RAD, GKE Autopilot, votre propre projet** | **143 US$**, plus 11 US$ une fois | L'automatisation de RAD, dans votre projet |
| RAD, Cloud Run | environ 84 US$ ; voir le [guide Cloud Run](Forgejo_CloudRun.md) | RAD |

- **RAD n'est généralement pas moins cher en espèces qu'un VPS nu — la différence réside dans ce qui est géré pour vous.** Le prix d'un VPS n'inclut pas le temps de l'administrateur pour les sauvegardes, les correctifs de sécurité et les mises à niveau du système d'exploitation ; le Cloud SQL géré par RAD (où cette application utilise une base de données), Secret Manager et la surveillance couvrent cela à la place.
- **Forgejo est une forge Git légère et autohébergée, un fork communautaire de Gitea, avec hébergement de dépôts, gestion des problèmes, pull requests et un runner Actions intégré.** Cela détermine quelle colonne est importante : une opération prévisible et sans intervention vaut plus pour la plupart des équipes utilisant ce type d'outil que de réduire de quelques dollars la facture mensuelle.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Forgejo s'exécute dans **un projet géré par RAD pour vous**, vous avez une option au-delà de la mise à l'échelle : **supprimer l'ensemble du projet et le restaurer dans les 30 jours pour presque rien.** Cela convient bien mieux à un déploiement dont vous n'avez besoin qu'occasionnellement — pour étudier en vue d'une certification, une démo, un besoin saisonnier — que de le faire fonctionner en continu.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le projet. Google ne le supprime pas immédiatement : il le conserve, récupérable, pendant 30 jours, et comme la facturation est déjà déliée, rien n'est facturé pendant cette attente. Contrairement à la suppression d'un module, cela ne détruit pas Cloud SQL, la VM ou GKE Autopilot un par un — l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet peut le restaurer. RAD demande à Google de restaurer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter **Update** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela coûte une poignée de crédits de temps de build au total (moins de 1 US$) pour une chaîne de déploiement typique de 2 à 3.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, pas 143 US$.** Déployez Forgejo, utilisez-le pour une session, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Update, et supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez qu'une seule fois les frais de module, les builds et les heures où il était réellement en ligne.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un projet que vous apportez et dont RAD ne gère que la facturation), et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime définitivement. La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude/démo conviennent). Google indique que la plupart des services fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.
- **Un véritable manque : les sauvegardes nocturnes ne survivent pas.** Les sauvegardes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé ce déploiement et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

GKE maintient au moins un pod en cours d'exécution, de sorte que Forgejo ne se met jamais à l'échelle à zéro de lui-même. L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ 115 crédits (11,50 US$). La suppression permet d'économiser de l'argent si Forgejo devait rester inutilisé pendant environ 3 jours ou plus dans votre propre projet (environ 4,75 US$ par jour), ou environ 1 jour ou plus dans un projet géré par RAD (108 crédits par jour).
- **Supprimez tout ce que Forgejo utilise.** La majeure partie du coût de fonctionnement est généralement la base de données et toute VM de fichier/cache partagée. Elles ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc la suppression de cette application pendant que quelque chose d'autre partage le projet n'économise que la partie calcul de cette application.
- **Conservez d'abord les données.** Les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui, alors copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.
- **Notez vos paramètres.** RAD ne recrée pas un déploiement supprimé pour vous ; vous entrez à nouveau les paramètres lorsque vous déployez.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant reçoit Forgejo dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits non utilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais propres à RAD et estimation des crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour le mécanisme de pause/restauration. Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Forgejo s'exécute comme un seul binaire Go supervisé par `s6` à l'intérieur de l'image
`codeberg.org/forgejo/forgejo` standard, enveloppé par un point d'entrée de plateforme mince qui
compose la connexion à la base de données au moment de l'exécution. Le déploiement relie un
ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods Forgejo sur le port 3000 (HTTP), 2 vCPU / 2 Gi par défaut |
| Base de données | Cloud SQL pour PostgreSQL 15 | Verrouillé en pratique — `db-init.sh` utilise `psql` ; le menu déroulant `database_type` liste MYSQL/NONE comme options mais elles ne sont pas prises en charge |
| Persistance des fichiers | Cloud Filestore (NFS) | Activé par défaut ; les dépôts, les objets LFS et les pièces jointes vivent sous le montage NFS (`/mnt/nfs`), partagé entre les pods |
| Stockage d'objets | Cloud Storage | Un bucket générique, inutilisé, suffixé par `data` est provisionné par défaut par la fondation — Forgejo lui-même ne stocke rien dans GCS |
| Secrets | Secret Manager | `SECRET_KEY` et `INTERNAL_TOKEN` auto-générés, plus le mot de passe de la base de données ; livrés aux pods via des fichiers montés CSI car le CRD GKE SecretSync interdit `__` dans les clés de secrets synchronisés |
| Ingress | Cloud Load Balancing (API Gateway) | Équilibreur de charge externe avec une IP statique réservée ; la prise en charge du domaine personnalisé est activée par défaut, avec un retour à un nom d'hôte HTTPS `nip.io` auto-provisionné si aucun domaine n'est défini |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est le seul moteur qui fonctionne réellement.** `database_type`
  par défaut à `POSTGRES_15` ; le script du job `db-init` est entièrement
  écrit pour `psql`, donc la sélection de MySQL ou `NONE` interrompt la configuration de la base de données même si
  les métadonnées de la variable les listent comme options.
- **Cloud SQL est atteint via le sidecar Auth Proxy sur le bouclage.**
  `enable_cloudsql_volume = true` par défaut, donc un sidecar `cloud-sql-proxy`
  écoute sur `127.0.0.1:5432` ; le point d'entrée de la plateforme sélectionne `SSL_MODE=disable`
  pour ce saut.
- **Déploiement (pas StatefulSet), basé sur NFS, capable de s'adapter à zéro.**
  `workload_type = "Deployment"`, `min_instance_count = 0`,
  `max_instance_count = 3`. Parce que `enable_nfs = true` par défaut, la
  fondation force la stratégie de déploiement `Recreate` (voir
  [App_GKE](App_GKE.md)) de sorte qu'une mise à jour n'exécute jamais deux pods contre le même volume NFS
  et la même base de données simultanément.
- **NFS est activé par défaut**, monté à `/mnt/nfs` (`GITEA__server__APP_DATA_PATH`)
  — c'est là que les dépôts, les objets Git LFS et les pièces jointes persistent.
- **L'affinité de session est `ClientIP`.**
- **Pas de job de migration séparé.** `GITEA__security__INSTALL_LOCK = "true"` ignore
  l'installateur web de Forgejo ; l'image `forgejo/forgejo` crée et migre son
  propre schéma au démarrage du conteneur contre la base de données vide que le job `db-init`
  a préparée.
- **Aucun compte administrateur n'est amorcé par Terraform.** Il n'y a pas de job d'initialisation qui
  crée un utilisateur administrateur Forgejo — voir la [Section 3](#3-forgejo-application-behaviour)
  pour l'étape manuelle.
- **`SECRET_KEY` et `INTERNAL_TOKEN` sont auto-générés** et stockés dans Secret
  Manager ; sur GKE, ils (et le mot de passe de la base de données) sont lus à partir de fichiers secrets montés CSI
  via la convention native `GITEA__section__KEY__FILE` de Forgejo.
- **`public_domain` / `public_url` par défaut à `localhost`.** Même si
  `enable_custom_domain = true` provisionne automatiquement un point de terminaison HTTPS accessible,
  `GITEA__server__DOMAIN` / `GITEA__server__ROOT_URL` ne sont pas automatiquement
  synchronisés avec celui-ci — définissez `public_domain` (et éventuellement `public_url`) sur le véritable
  nom d'hôte externe afin que les URL de clonage et les liens se résolvent correctement.
- **L'auto-enregistrement est ouvert par défaut** (`GITEA__service__DISABLE_REGISTRATION = "false"`).
- **Redis est provisionné mais n'est pas réellement câblé dans la configuration de Forgejo.**
  `enable_redis = true` par défaut et la fondation injecte `REDIS_HOST` /
  `REDIS_PORT` dans le conteneur, mais `Forgejo_Common` ne définit aucune
  variable `GITEA__cache__*` / `GITEA__session__*` / `GITEA__queue__*` pour
  les consommer — Forgejo revient à ses valeurs par défaut de cache/session intégrées
  à moins que vous n'ajoutiez ce câblage vous-même via `environment_variables`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Forgejo {#a-gke-autopilot--the-forgejo-workload}

Les pods Forgejo exécutent l'image `codeberg.org/forgejo/forgejo` derrière une fine build personnalisée
qui installe un point d'entrée de plateforme (`/platform-entrypoint.sh`), puis exécute
le point d'entrée Forgejo standard sous `s6`. Étant donné que la charge de travail est basée sur NFS par
défaut, le déploiement utilise la stratégie `Recreate`.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail Forgejo pour
  les pods, les révisions et les événements. Kubernetes Engine → Services et Ingress affiche l'IP
  externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE" --selector app=forgejo 2>/dev/null || kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de charge de travail
(Déploiement vs StatefulSet).

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Forgejo stocke toutes les métadonnées de l'application (utilisateurs, dépôts, problèmes, pull
requests, exécutions d'Actions) dans une instance Cloud SQL pour PostgreSQL 15 gérée. Les pods
l'atteignent via le sidecar **Cloud SQL Auth Proxy** sur `127.0.0.1:5432` ; aucune
IP publique n'est exposée. Lors du premier déploiement, le job `db-init` crée le rôle d'application
et la base de données ; Forgejo crée et migre ensuite son propre schéma au premier
démarrage du conteneur.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret Secret Manager contenant le
mot de passe sont tous dans les [Sorties](#5-outputs). Voir [App_GKE](App_GKE.md) pour le
modèle de connexion, les sauvegardes automatisées et la rotation des mots de passe.

### C. Cloud Filestore (NFS) — stockage des dépôts {#c-cloud-filestore-nfs--repository-storage}

Les données de dépôt de Forgejo, les objets Git LFS et les pièces jointes résident sur **NFS
(Cloud Filestore)**, monté à l'intérieur du pod à `/mnt/nfs` par défaut
(`GITEA__server__APP_DATA_PATH`). Aucun bucket GCS n'est utilisé pour les données d'application —
`Forgejo_Common` rapporte toujours une sortie `storage_buckets` vide — bien que la
valeur par défaut de la variable générique `storage_buckets` crée toujours un bucket inutilisé
suffixé par `data`, sauf si elle est remplacée.

- **Console :** Filestore → Instances ; Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"
  gcloud storage buckets list --project "$PROJECT" --filter="name~data"
  ```

Voir [App_GKE](App_GKE.md) pour la découverte/création de NFS et les montages GCS Fuse.

### D. Secret Manager {#d-secret-manager}

Deux secrets Forgejo sont générés automatiquement et stockés dans Secret Manager :
`SECRET_KEY` (chiffre les données sensibles telles que les jetons 2FA et OAuth) et
`INTERNAL_TOKEN` (authentifie les appels d'API internes de Forgejo). Le mot de passe de la base de données
est le secret géré par la fondation. Sur GKE, les trois sont projetés dans
les pods sous forme de fichiers via le pilote CSI Secret Store et lus par Forgejo via la
convention `GITEA__section__KEY__FILE` (`GITEA__database__PASSWD__FILE`,
`GITEA__security__SECRET_KEY__FILE`, `GITEA__security__INTERNAL_TOKEN__FILE`) —
car le CRD GKE SecretSync rejette `__` dans un `targetKey` de secret synchronisé,
ceux-ci sont matérialisés sous les clés simples `SECRET_KEY` / `INTERNAL_TOKEN`
plutôt que les noms `GITEA__` utilisés sur Cloud Run.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~forgejo"
  gcloud secrets versions access latest --secret=<secret-key-secret-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store CSI.

### E. Réseau et ingress {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe de Cloud Load Balancing
(`service_type = LoadBalancer`, `reserve_static_ip = true` afin que l'adresse
survive aux redéploiements) précédée d'une passerelle (`enable_custom_domain = true`), qui
provisionne un nom d'hôte HTTPS `nip.io` automatique lorsque aucun `application_domains`
n'est fourni. Seul le port HTTP (`container_port = 3000`) est câblé dans le
service Kubernetes — le `sshd` interne de Forgejo (supervisé par le même processus `s6`,
selon le Dockerfile) n'est **pas** exposé par ce module, donc
les URL de clonage `git+ssh://` ne sont pas accessibles en externe sans un réseau supplémentaire,
ajouté manuellement.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get svc,gateway -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails de l'IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les flux stdout/stderr des pods vers Cloud Logging ; les métriques GKE et Cloud SQL vers Cloud
Monitoring. Des vérifications de disponibilité et des politiques d'alerte optionnelles sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Forgejo {#3-forgejo-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job `db-init` exécute `db-init.sh` en utilisant
  `postgres:15-alpine`. Il attend que Cloud SQL accepte les connexions, crée (ou réinitialise le mot de passe) de manière idempotente
  le rôle d'application avec `CREATEDB`, crée la base de données appartenant à ce rôle et accorde des privilèges complets sur la base de données + le schéma `public`
  (PG15+). Aucune extension Postgres n'est installée par le script lui-même.
  Le job peut être réexécuté en toute sécurité (`execute_on_apply = true`, `max_retries = 3`) et
  signale au sidecar Cloud SQL Auth Proxy de s'arrêter (`POST /quitquitquit` sur
  `localhost:9091`) afin que le conteneur du Job se termine proprement.
- **Pas de job de migration séparé — la création du schéma se fait au démarrage du conteneur.**
  Avec `GITEA__security__INSTALL_LOCK = "true"`, l'installateur web de Forgejo est
  ignoré ; le point d'entrée `forgejo/forgejo` standard crée et migre le
  schéma dans la base de données vide au premier démarrage, et applique d'autres migrations
  lors des mises à niveau ultérieures.
- **Aucun compte administrateur n'est créé automatiquement.** Aucun job d'initialisation n'exécute une
  étape `forgejo admin user create` (ou équivalente), et l'auto-enregistrement est
  activé (`GITEA__service__DISABLE_REGISTRATION = "false"`), de sorte que toute personne pouvant
  atteindre le service peut créer un compte. L'étape côté opérateur pour amorcer
  le premier administrateur consiste à `kubectl exec` dans un pod en cours d'exécution et à utiliser
  la CLI d'administration de Forgejo. TODO : l'invocation exacte de la CLI et la confirmation
  que le binaire CLI est sur `PATH` à l'intérieur du conteneur déployé n'ont pas été vérifiées
  à partir de la source de ce dépôt — confirmer sur le pod en cours d'exécution
  (`kubectl exec -n "$NAMESPACE" deploy/<service-name> -- forgejo admin user create --help`)
  avant de s'y fier.
- **Câblage des variables d'environnement de connexion à la base de données.** La fondation injecte `DB_HOST` (l'adresse de bouclage du Cloud
  SQL Auth Proxy sur GKE), `DB_NAME`, `DB_USER` et le
  secret `DB_PASSWORD`. Étant donné que les références `$(VAR)` de style Kubernetes ne sont pas utilisées
  (Cloud Run ne les interpole pas, de sorte que le même point d'entrée fonctionne sur les deux
  plateformes), `/platform-entrypoint.sh` compose `GITEA__database__{HOST,NAME,USER,SSL_MODE}`
  au moment de l'exécution à partir des valeurs `DB_*` injectées, en sélectionnant `SSL_MODE=disable` pour
  les sauts de socket Unix / proxy de bouclage utilisés sur GKE.
  `GITEA__database__PASSWD` n'est pas injecté directement sur GKE ; Forgejo
  le lit plutôt à partir du fichier `GITEA__database__PASSWD__FILE` monté CSI.
- **Les déploiements basés sur NFS utilisent `Recreate`.** Les mises à jour terminent l'ancien pod avant
  de démarrer le nouveau, évitant ainsi que deux pods n'écrivent simultanément sur les mêmes données de dépôt sur
  NFS. `max_instance_count` reste par défaut à `3` (pas `1`) — Forgejo n'est pas une
  application à écrivain unique dans le même sens qu'une application basée sur SQLite, mais aucune
  vérification de la correction multi-réplique pour les écritures Git concurrentes sur le même
  répertoire de données basé sur NFS n'est documentée dans ce module, donc traitez la mise à l'échelle
  au-delà d'une seule réplique stable avec la même prudence que toute autre
  charge de travail de système de fichiers partagé.
- **Chemin de santé.** Les deux sondes sont **HTTP** `GET /api/healthz`, que Forgejo
  sert sans authentification une fois les migrations de base de données terminées : sonde de démarrage
  `initial_delay_seconds=0`, `timeout_seconds=10`, `period_seconds=30`,
  `failure_threshold=10` ; sonde de vivacité `initial_delay_seconds=60`,
  `timeout_seconds=5`, `period_seconds=30`, `failure_threshold=3`.
- **Inspecter le job d'initialisation et la configuration en cours d'exécution :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep GITEA__
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls
les paramètres spécifiques ou notables pour Forgejo sont listés ; toute autre entrée est
héritée de [App_GKE](App_GKE.md) avec son comportement et ses valeurs par défaut standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `forgejo` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `11` | Tag d'image `codeberg.org/forgejo/forgejo`, appliqué via l'argument de build `FORGEJO_VERSION` spécifique à l'application (`latest` correspond à `11` épinglé). |
| `description` | `Forgejo - Self-hosted Git service and source-code hosting` | Rempli le champ de description de la charge de travail. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `custom` | Construit un wrapper mince `FROM codeberg.org/forgejo/forgejo:${FORGEJO_VERSION}` qui ajoute le point d'entrée de câblage de la base de données de la plateforme. |
| `container_port` | `3000` | Port HTTP de Forgejo ; définit également `GITEA__server__HTTP_PORT`. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy sur le bouclage — requis sur GKE. |
| `cpu_limit` | `2000m` | 2 vCPU par pod (remplacement spécifique à Forgejo de la valeur par défaut générique `container_resources`). |
| `memory_limit` | `2Gi` | 2 Gi par pod (remplacement spécifique à Forgejo). |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `workload_type` | `Deployment` | Déploiement (basé sur NFS, stratégie `Recreate` — voir [App_GKE](App_GKE.md)). |
| `service_type` | `LoadBalancer` | IP externe pour l'interface utilisateur Forgejo/Git-over-HTTP. |
| `session_affinity` | `ClientIP` | Routage persistant pour qu'un client atteigne le même pod. |
| `public_domain` | `localhost` | Définit `GITEA__server__DOMAIN` ; utilisé pour construire les URL de clonage et les liens. À remplacer avant/après le premier déploiement. |
| `public_url` | `""` → `http://<public_domain>/` | Définit `GITEA__server__ROOT_URL`. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/healthz`, `failure_threshold=10`, `period_seconds=30` | Sonde de démarrage spécifique à l'application (voir [Section 3](#3-forgejo-application-behaviour)). |
| `liveness_probe` | HTTP `/api/healthz`, `initial_delay_seconds=60`, `period_seconds=30`, `failure_threshold=3` | Sonde de vivacité spécifique à l'application. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | NFS est activé par défaut afin que les dépôts, les objets LFS et les pièces jointes persistent et soient partagés entre les pods. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin monté, également défini comme `GITEA__server__APP_DATA_PATH`. C'est la valeur par défaut effective pour ce module — la valeur par défaut interne du module `Forgejo_Common` (`/data`) est remplacée par cette variante. |

### Groupe 15 — Redis {#group-15--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Injecte `REDIS_HOST` (par défaut l'IP du serveur NFS) / `REDIS_PORT` dans le conteneur, mais `Forgejo_Common` ne définit aucune configuration `GITEA__cache__*` / `GITEA__session__*` pour les consommer — voir la mise en garde dans la [Section 1](#1-overview). |
| `redis_host` | `""` | Remplacer pour pointer vers Cloud Memorystore ou une autre instance Redis. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` (sensible) | Mot de passe d'authentification Redis, si nécessaire. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Le seul moteur pris en charge par `db-init.sh` — ne pas modifier. |
| `db_name` | `forgejo` | Nom de la base de données, injecté comme `GITEA__database__NAME`. Immuable après le premier déploiement. |
| `db_user` | `forgejo` | Utilisateur de la base de données, injecté comme `GITEA__database__USER` ; mot de passe auto-généré dans Secret Manager et livré via `GITEA__database__PASSWD__FILE`. |
| `enable_postgres_extensions` | `true` | `postgres_extensions` par défaut à `["uuid-ossp"]`. Le propre schéma de Forgejo ne nécessite aucune extension Postgres ; il s'agit d'une commodité par défaut au niveau de la fondation. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne une passerelle avec une IP statique ; revient à un nom d'hôte HTTPS `nip.io` auto-généré lorsque `application_domains` est vide. |
| `application_domains` | `[]` | Noms d'hôtes personnalisés + certificat géré. |
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |

Toutes les autres entrées suivent le comportement standard de [App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de
localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Carte des ClusterIPs pour les services spécifiques à l'étape. |
| `service_external_ip` | IP de l'équilibreur de charge externe (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Forgejo. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (`127.0.0.1` via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (le bucket générique, inutilisé, suffixé par `data` par défaut). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration (`db-init`) et d'importation (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur de fondation [App_GKE](App_GKE.md), qui valide les valeurs *et les combinaisons* au moment de la planification — un `StatefulSet` forcé à côté d'un paramètre sans état, IAP sans identités autorisées, `quota_memory_*` donné comme des entiers bruts, un `container_port`/`backup_retention_days` hors de portée. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critique | `db-init.sh` est uniquement `psql` ; MySQL/`NONE` interrompt la configuration de la base de données même si les métadonnées de la variable les listent. |
| `db_name` / `db_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et orpheline tous les dépôts, problèmes et PR stockés sous l'ancien rôle. |
| `SECRET_KEY` / `INTERNAL_TOKEN` (auto-générés) | Ne jamais changer | Critique | La rotation de ceux-ci invalide les données chiffrées 2FA/OAuth et l'authentification API interne de Forgejo, interrompant les opérations Git et API. |
| `enable_nfs` | `true` | Critique | Le désactiver rend les dépôts, les objets LFS et les pièces jointes éphémères — perdus lors de la recréation du pod. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy sur `127.0.0.1:5432` est requis pour la connectivité de la base de données sur GKE ; la sélection du mode SSL du point d'entrée le suppose. |
| `public_domain` / `public_url` | Nom d'hôte externe réel | Élevé | Par défaut à `localhost` / `http://localhost/`, produisant des URL de clonage Git erronées et des liens brisés jusqu'à ce qu'ils soient remplacés. |
| `GITEA__service__DISABLE_REGISTRATION` (via `environment_variables`) | `true` pour les instances non publiques | Élevé | L'auto-enregistrement est ouvert par défaut et aucun compte administrateur n'est créé automatiquement — toute personne atteignant le service peut s'inscrire. |
| Compte administrateur initial | Créer manuellement après le déploiement | Élevé | Aucun job d'initialisation n'amorce un administrateur ; tant qu'un n'est pas créé via la CLI Forgejo, l'instance n'a pas d'utilisateur privilégié. |
| `enable_redis` | `true`, mais confirmer qu'il est réellement nécessaire | Moyen | `REDIS_HOST`/`REDIS_PORT` sont injectés sans effet à moins que vous n'ajoutiez également la configuration `GITEA__cache__*`/`GITEA__session__*` correspondante — provisionnement de capacité Redis sans avantage sinon. |
| `max_instance_count` | `3` (par défaut) | Moyen | Les répliques concurrentes partagent le même répertoire de données Git basé sur NFS et la même base de données Postgres ; la correction multi-réplique pour les écritures concurrentes n'est pas documentée ici — traitez la mise à l'échelle comme toute charge de travail de système de fichiers partagé. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont traités comme des octets et bloquent toute planification de pod dans l'espace de noms. |
| `storage_buckets` | Laisser tel quel ou définir `create_cloud_storage = false` | Faible | Le bucket par défaut suffixé par `data` est provisionné mais inutilisé par Forgejo (toutes les données de l'application résident sur NFS) — coût mineur inutile s'il est laissé activé inutilement. |
| `reserve_static_ip` | `true` | Moyen | Sans cela, l'IP externe peut changer lors des redéploiements, ce qui rompt le DNS et `public_domain`/`public_url`. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**.
La configuration d'application spécifique à Forgejo partagée avec la variante Cloud Run est
décrite dans **[Forgejo_Common](Forgejo_Common.md)**.

<!-- related-guides -->

## Guides associées {#related-guides}

- [Lab pratique : Forgejo sur GKE Autopilot](../labs/Forgejo_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Forgejo sur Google Cloud Run](Forgejo_CloudRun.md) — la même application sur Cloud Run, pour quand vous avez besoin de l'autre cible de déploiement.
- [Forgejo Common — Configuration d'application partagée](Forgejo_Common.md) — la configuration partagée par les deux cibles de déploiement.
