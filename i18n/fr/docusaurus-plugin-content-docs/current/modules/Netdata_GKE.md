---
title: "Netdata sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Netdata sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Netdata_GKE.md @ e69407af sha256:b6ea296f57b4 -->

# Netdata sur GKE Autopilot {#netdata-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Netdata_GKE.png" alt="Netdata sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Netdata est un agent open source de surveillance des performances et de la
santé en temps réel qui collecte des milliers de métriques par seconde (CPU,
mémoire, disque, réseau, conteneurs, services) sans configuration et les
visualise sur un tableau de bord web interactif intégré. Il est écrit en C
pour un minimum de surcharge et expose une API REST pour interroger les
données collectées. Ce module déploie Netdata sur **GKE Autopilot** sur la
base de la fondation [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud que Netdata utilise et sur la
façon de les explorer et de les opérer à partir de la console Google Cloud
et de la ligne de commande. Pour les mécanismes communs à chaque application
GKE — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## Ce que Netdata coûte sur RAD, et comment cela se compare {#what-netdata-costs-on-rad-and-how-that-compares}

**Le module Netdata sur GKE Autopilot de RAD coûte environ 42 à 115 $ US par mois, les frais de module étant facturés une seule fois en crédits RAD.** GKE Autopilot convient à Netdata qui doit rester opérationnel, s'adapter à plusieurs pods ou fonctionner aux côtés d'autres charges de travail Kubernetes ; pour le coût le plus bas, le [module Cloud Run](Netdata_CloudRun.md) exécute le même Netdata pour environ 19 $ US par mois. Si vous n'en avez besoin qu'occasionnellement — une démo, un projet saisonnier, quelque chose que vous évaluez — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits (moins de 1 $ US) au lieu de payer pour qu'il reste inactif. Voir **Mettez-le en pause gratuitement**, ci-dessous. Les chiffres sont ceux du 8 octobre 2026 ; les sources sont listées à la fin de cette section.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

RAD déploie **Netdata**, qui est open source, il n'y a donc pas de frais de licence par utilisateur. Vous payez pour trois choses :

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 75 crédits (8 $ US au prix de la recharge) | 67,5 crédits (10 % de moins) |
| Temps de build | Environ 3-6 crédits par build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **42 $ US par mois** pour la configuration par défaut (tableau ci-dessous) — plus si ce n'est pas votre seul cluster Autopilot | Mesuré à l'heure en crédits ; RAD publie **67 crédits par jour**, environ 2 010 par mois (environ 201 $ US au prix de la recharge, 161 $ US au tarif du plan Scale) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge ponctuelle, et moins avec un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas un deuxième ensemble de ceux-ci.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Pod GKE Autopilot, 1x vCPU / 1 Gio | 36,08 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 |
| **Total** | **environ 42 $ US** (environ 115 $ US si ce n'est pas votre seul cluster Autopilot) |

### Comment cela se compare {#how-it-compares}

| Option | Prix | Qui l'exécute |
|---|---|---|
| Netdata Cloud, plan Business | 4,50 $/nœud/mois, facturé annuellement | Netdata. Métriques, journaux et rétention illimités ; RBAC, SSO et journaux d'audit |
| Netdata Cloud, plan Communauté | Gratuit | Netdata. Limité à 5 nœuds connectés et 1 tableau de bord personnalisé par salle |
| **RAD, Cloud Run, votre propre projet** | **Environ 19 $ US**, plus 4 $ US une fois par déploiement | L'automatisation de RAD, dans votre projet |
| **RAD, Cloud Run, un projet géré par RAD** | **Environ 270 crédits (22-27 $ US)** | RAD |
| RAD, GKE Autopilot | Voir le [guide GKE](Netdata_GKE.md) | RAD |

Le niveau Cloud de Netdata facture par nœud connecté, ce qui convient à un parc de serveurs ; ce module déploie une seule instance Netdata qui se surveille elle-même (et tout ce qu'elle pointe), donc la comparaison est un nœud par rapport au prix Business de Netdata de 4,50 $/nœud/mois. **Un nœud auto-hébergé est de toute façon exempt de la propre licence de Netdata** (l'agent est open source) ; ce que les frais de RAD paient, c'est le déploiement, la mise à jour et la surface opérationnelle de qualité Cloud SQL que le plan Business devrait autrement acheter séparément sur votre propre serveur.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Netdata s'exécute dans **un projet géré par RAD pour vous**, vous avez une deuxième option qui va bien au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour presque rien.** Cela convient bien mieux à Netdata dont vous n'avez besoin qu'occasionnellement — une démo, une évaluation, un projet saisonnier — que de le faire fonctionner en continu.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le projet. Google ne supprime pas le projet immédiatement : il le conserve, récupérable, pendant 30 jours. Comme la facturation est déjà déliée, rien n'est facturé pendant qu'il attend. Contrairement à la suppression d'un module, cela ne détruit pas le cluster ou la ressource de calcul un par un — l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte quelques crédits, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet peut le restaurer. RAD demande à Google de restaurer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter **Update** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais à nouveau les frais de module. Cela coûte environ une poignée de crédits (moins de 1 $ US) au total pour une chaîne de déploiement typique de 2-3.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, pas 42 $ US.** Déployez Netdata, utilisez-le pendant un certain temps, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Update, et supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez que les frais de module une seule fois, les builds, et le temps pendant lequel Netdata était réellement actif.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un projet que vous apportez et dont RAD ne gère que la facturation), et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime définitivement. La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des études et des démos utilisent). Google indique que la plupart des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.
- **Un véritable manque : les sauvegardes nocturnes ne survivent pas.** Les sauvegardes sont écrites dans un bucket à l'intérieur du projet, et ce bucket n'est **pas** protégé par la suppression logicielle de Cloud Storage, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé Netdata et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre façon : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de supprimer le déploiement et de le déployer à nouveau lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ 80 crédits (8 $ US) dans votre propre projet, ou 72 crédits dans un projet géré par RAD. La suppression permet d'économiser de l'argent une fois que Netdata resterait inutilisé pendant environ 6 jours ou plus dans votre propre projet (environ 1,40 $ US par jour), ou environ 1 jour ou plus dans un projet géré par RAD (67 crédits par jour).
- **La majeure partie du coût d'exécution est généralement la base de données et toute VM de fichier/cache partagée.** Elles ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc la suppression de Netdata alors que quelque chose d'autre partage le projet n'économise que la partie calcul de cette application.
- **Gardez vos données en premier.** Les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui, donc copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant dispose de Netdata dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute Netdata pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour la fenêtre de récupération de 30 jours et ce qu'elle dit sur les objets Cloud Storage sans suppression logicielle ; frais RAD et estimations de crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Tarification Netdata Cloud](https://www.netdata.cloud/pricing/). Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Netdata s'exécute comme une seule charge de travail Kubernetes. Le déploiement
relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Un seul pod Netdata sur le port `19999`, 1 vCPU / 1 Gio par défaut |
| Base de données | Aucune | `database_type = "NONE"` — Netdata conserve sa propre base de données de métriques interne (dbengine) sur disque ; aucune instance Cloud SQL n'est créée |
| Persistance des fichiers | PVC de bloc par pod (par défaut) | `stateful_pvc_enabled = true` provisionne un PVC `standard-rwo` (SSD) de 20 Gio à `/var/lib/netdata` ; Cloud Filestore (NFS) est disponible mais désactivé par défaut |
| Stockage d'objets | Cloud Storage | Un bucket `storage` est toujours provisionné, mais uniquement monté à `/var/lib/netdata` via GCS FUSE lorsque le PVC de bloc est désactivé |
| Secrets | Secret Manager | `NETDATA_ADMIN_PASSWORD` optionnel (désactivé par défaut) — le tableau de bord local de Netdata n'a pas de connexion intégrée |
| Ingress | Service Kubernetes (`LoadBalancer` par défaut) | Domaine personnalisé optionnel via Kubernetes Gateway ; `ClusterIP`/`NodePort` disponibles |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de base de données.** Netdata n'est pas sauvegardé par Cloud SQL —
  tout l'état (le magasin de métriques dbengine, le journal d'alarmes/santé
  et la configuration) réside sur le volume persistant monté. La variante
  GKE transmet en dur `enable_cloudsql_volume = false` et il n'y a pas de job `db-init`.
- **Le PVC de stockage par blocs est le mécanisme de persistance par
  défaut.** `stateful_pvc_enabled = true` (et, comme aucun `workload_type` n'est défini,
  cela résout automatiquement la charge de travail en un **StatefulSet** —
  voir "Sélection automatique de StatefulSet" dans les conventions du
  référentiel). Le PVC utilise la StorageClass `standard-rwo` (basée sur SSD)
  par défaut, dimensionnée à `20Gi`, montée à `/var/lib/netdata`.
  De véritables sémantiques de périphérique de bloc sont requises car les
  fichiers dbengine de Netdata sont corrompus par GCS FUSE.
- **Le bucket GCS `storage` est créé de toute façon mais uniquement monté
  en tant que solution de secours.** `Netdata_GKE`'s `main.tf` définit
  `enable_gcs_storage_volume = !stateful_pvc_enabled`, donc avec le PVC par défaut (`true`), le
  montage GCS FUSE est ignoré pour éviter un double montage au même chemin.
  Désactivez `stateful_pvc_enabled` pour revenir au bucket GCS au lieu d'un PVC de
  bloc.
- **Redis est désactivé de force.** `Netdata_GKE`'s `main.tf` code en
  dur `enable_redis = false` dans l'appel à `App_GKE`, annulant la valeur par
  défaut de la variable `true` — Netdata n'utilise pas Redis.
- **Réplica unique par défaut.** `min_instance_count = 1`, `max_instance_count = 1`. Netdata
  écrit sa base de données de métriques sur un seul PVC ; l'exécution de
  plusieurs réplicas sur le même volume n'est pas prise en charge.
- **Pas d'authentification intégrée.** Le tableau de bord local de Netdata
  n'est pas authentifié par défaut — toute personne pouvant atteindre le
  Service peut afficher toutes les métriques collectées. Le secret
  `enable_admin_password` optionnel ne configure pas la propre connexion de Netdata ; il
  génère un identifiant stable pour un proxy inverse géré par l'opérateur ou
  un flux de revendication Netdata Cloud superposé devant lui.
- **`service_type` par défaut à `LoadBalancer`** (accès externe), de sorte
  que le tableau de bord est accessible depuis l'extérieur du cluster via une
  adresse IP externe dès que le Service est provisionné — aucune connexion
  intégrée ne le protège (voir la note d'authentification ci-dessus).
  Définissez `service_type = ClusterIP` pour le garder interne uniquement, ou configurez un
  domaine personnalisé via `enable_custom_domain` (qui par défaut `true`
  mais n'a aucun effet tant que `application_domains` n'est pas renseigné).
- **L'image est une construction personnalisée mince.** `Netdata_Common` livre
  un `Dockerfile` minimal (`FROM netdata/netdata:${NETDATA_VERSION}`) purement pour que la fondation
  puisse refléter l'image en amont dans Artifact Registry ; `application_version = "latest"`
  épingle la construction à une balise connue (`v2.2.6`) via l'ARG de
  construction `NETDATA_VERSION` spécifique à l'application.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Netdata {#a-gke-autopilot--the-netdata-workload}

Netdata s'exécute comme un seul pod planifié sur Autopilot, qui facture le
CPU/la mémoire que le pod demande réellement. Avec le `stateful_pvc_enabled
= true` par défaut, la charge de travail est un **StatefulSet** avec une identité de pod stable et un PVC dédié par pod.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de
  travail Netdata pour les pods, les révisions et les événements. Kubernetes
  Engine → Services & Ingress affiche l'adresse IP du ClusterIP ou l'adresse
  IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Voir [App_GKE](App_GKE.md) pour savoir comment Autopilot, la mise à l'échelle et le type de charge de travail (Deployment vs StatefulSet) sont gérés.

### B. Stockage persistant — PVC de bloc (par défaut) ou NFS {#b-persistent-storage--block-pvc-default-or-nfs}

Le magasin de métriques dbengine de Netdata, le journal d'alarmes/santé et la
configuration résident sous `/var/lib/netdata`. Par défaut, il s'agit d'un **PVC de
stockage par blocs** par pod (`stateful_pvc_enabled = true`, StorageClass `standard-rwo`,
`20Gi`) — requis car le format de fichier du dbengine nécessite de
véritables sémantiques de périphérique de bloc (GCS FUSE le corrompt). Cloud
Filestore (NFS) est disponible comme montage partagé alternatif (`enable_nfs`,
par défaut `false`) mais n'est pas le chemin recommandé pour les propres
fichiers de données de Netdata.

- **Console :** Kubernetes Engine → Storage → Persistent Volume Claims ;
  Filestore → Instances (uniquement si NFS est activé).
- **CLI :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  gcloud filestore instances list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour le provisionnement de PVC StatefulSet, le
compromis HDD/SSD `stateful_pvc_storage_class` et la découverte NFS.

### C. Cloud Storage (chemin de secours) {#c-cloud-storage-fallback-path}

Un bucket **Cloud Storage** (suffixe `storage`) est provisionné
automatiquement quelle que soit la configuration du PVC, et le compte de
service de la charge de travail y a accès. Il n'est monté dans le pod (via
GCS FUSE) que lorsque `stateful_pvc_enabled = false`, comme mécanisme de persistance de
secours pour `/var/lib/netdata`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~netdata"
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### D. Secret Manager {#d-secret-manager}

Netdata n'a pas de secrets générés obligatoires. Le **seul** secret optionnel
est `NETDATA_ADMIN_PASSWORD` (protégé par `enable_admin_password`, par défaut `false`) —
une valeur aléatoire de 32 caractères stockée dans Secret Manager et injectée
en tant que Secret Kubernetes natif (via `explicit_secret_values`, pas le chemin Secret
Store CSI/SecretSync). Il ne configure pas la propre authentification de
Netdata ; il existe en tant qu'identifiant stable pour un proxy inverse côté
opérateur ou une étape de revendication Netdata Cloud.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~netdata-admin-password"
  gcloud secrets versions access latest --secret=<admin-password-secret-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store CSI.

### E. Réseau et ingress {#e-networking--ingress}

Par défaut, la charge de travail est exposée en externe via une IP éphémère
ou réservée (`service_type = LoadBalancer`, `reserve_static_ip = true`). Définissez `service_type = ClusterIP` pour la
garder interne uniquement, ou configurez `application_domains` (avec `enable_custom_domain`, par
défaut `true`) pour un accès routé par Gateway avec un certificat géré.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails des IP statiques.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les flux stdout/stderr des pods vers Cloud Logging ; les métriques GKE vers
Cloud Monitoring. Des vérifications de disponibilité et des politiques
d'alerte optionnelles sont disponibles (`uptime_check_config`, désactivé par défaut ;
`alert_policies`).

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Netdata {#3-netdata-application-behaviour}

- **Pas de jobs d'initialisation par défaut.** `initialization_jobs` par défaut à
  `[]` — Netdata amorce sa propre base de données de métriques sur
  disque au premier démarrage ; il n'y a pas de job `db-init` ou de
  migration à attendre. Des jobs personnalisés peuvent être fournis pour les
  tâches de chargement/migration de données si nécessaire.
- **Pas d'assistant de première exécution / pas de portail de connexion.** Le
  tableau de bord est accessible et entièrement fonctionnel (sous réserve de
  `service_type`/ingress) dès que le pod est Prêt — Netdata ne nécessite pas la
  création d'un compte administrateur avant utilisation.
- **Les sondes de santé ciblent `/api/v1/info`.** La sonde de démarrage
  (`startup_probe` : `initial_delay=15s`, `timeout=5s`, `period=10s`,
  `failure_threshold=10`) et la sonde de vivacité (`liveness_probe` : `initial_delay=30s`,
  `timeout=5s`, `period=30s`, `failure_threshold=3`) sont toutes deux HTTP
  `GET /api/v1/info`, non authentifiées. Le même chemin est la valeur par défaut
  pour les variables `health_check_config`, `startup_probe_config` et `uptime_check_config` au
  niveau de la fondation.
  {/* TODO: verify exact response body/status contract of /api/v1/info in the deployed image — variable descriptions reference it as Netdata's "dedicated liveness endpoint" but do not specify the payload. */}
- **Mise à l'échelle à instance unique.** `min_instance_count = 1` / `max_instance_count = 1` par
  défaut — la base de données de métriques sur le PVC est écrite par un
  seul processus ; ne pas dépasser 1 sans vérifier la configuration
  distribuée/streaming de Netdata.
- **Épinglage de la version de l'image.** `application_version = "latest"` se résout à la valeur
  par défaut `v2.2.6` du Dockerfile épinglé au moment de la
  construction (l'ARG de construction `NETDATA_VERSION` spécifique à
  l'application, pas le générique `APP_VERSION` que la fondation injecte) —
  définissez une version explicite pour suivre une version différente.
- **Vérifier la charge de travail en cours d'exécution :**
  ```bash
  kubectl get pods,pvc -n "$NAMESPACE"
  kubectl exec -n "$NAMESPACE" <pod-name> -- wget -qO- http://127.0.0.1:19999/api/v1/info
  kubectl port-forward -n "$NAMESPACE" svc/<service-name> 19999:19999
  # then browse http://127.0.0.1:19999
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Netdata sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec son comportement standard et ses valeurs par
défaut.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `netdata` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Balise d'image `netdata/netdata` utilisée comme base de construction personnalisée ; `latest` est épinglé à une balise connue (`v2.2.6`) au moment de la construction. |
| `enable_admin_password` | `false` | Génère un identifiant Secret Manager pour une couche d'authentification côté opérateur. Le tableau de bord de Netdata reste non authentifié quelle que soit cette configuration. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` | `1000m` | 1 vCPU. |
| `memory_limit` | `1Gi` | Augmenter pour des nombres de collecte plus importants / une rétention plus longue. |
| `min_instance_count` | `1` | Maintenir à 1 pour éviter les démarrages à froid. |
| `max_instance_count` | `1` | **Maintenir à 1** — un PVC, un rédacteur. |
| `container_port` | `19999` | Fixé par `Netdata_Common` ; cette variable est uniquement informative et n'est pas transmise à `App_GKE`. |
| `enable_cloudsql_volume` | `false` | Netdata n'a pas de base de données Cloud SQL — maintenir `false`. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | IP publique par défaut ; définir `ClusterIP` pour la garder interne uniquement. |
| `workload_type` | `null` → `StatefulSet` | Se résout automatiquement en StatefulSet car `stateful_pvc_enabled = true`. |
| `session_affinity` | `None` | Pas de routage persistant nécessaire avec un seul réplica. |

### Groupe 7 — Configuration du StatefulSet {#group-7--statefulset-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | Provisionne un PVC de bloc par pod — requis pour que les fichiers dbengine de Netdata obtiennent de véritables sémantiques de périphérique de bloc (GCS FUSE les corrompt). |
| `stateful_pvc_size` | `20Gi` | Taille pour contenir votre fenêtre de rétention de collecte plus la surcharge. |
| `stateful_pvc_mount_path` | `/var/cache/netdata` | Où Netdata persiste sa base de données de métriques, son journal d'alarmes et sa configuration. |
| `stateful_pvc_storage_class` | `standard-rwo` (SSD) | Balanced-PD, basé sur SSD. Tire le quota régional `SSD_TOTAL_GB` — remplacer par `standard` (HDD) si le quota est limité ; le modèle d'écriture de Netdata ne nécessite pas d'IOPS SSD. |
| `stateful_fs_group` | `3000` | Rend le PVC accessible en écriture par le groupe ; Netdata s'exécute en tant que UID 1000 / GID 2000. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `GET /api/v1/info` | Sondes au niveau du conteneur câblées via `Netdata_Common`. |
| `health_check_config` / `startup_probe_config` | HTTP `GET /api/v1/info` | Configuration de la sonde au niveau de la fondation (même point de terminaison). |
| `uptime_check_config` | désactivé, chemin `/api/v1/info` | Activer pour un `google_monitoring_uptime_check_config` externe, utile uniquement une fois le Service publiquement accessible. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Désactivé par défaut — la persistance est gérée par le PVC de bloc du StatefulSet à la place. N'activer que si vous avez besoin d'un montage NFS partagé à d'autres fins que les propres données dbengine de Netdata. |
| `nfs_mount_path` | `/mnt/nfs` | Pas le même chemin que le montage PVC (`/var/lib/netdata`) — éviter de pointer NFS vers le chemin du PVC. |

### Groupe 15 — Redis (non utilisé) {#group-15--redis-not-used}

Netdata n'utilise pas Redis. `enable_redis` par défaut `true` au niveau de
la variable, mais `Netdata_GKE`'s `main.tf` transmet
inconditionnellement `enable_redis = false` à `App_GKE`, de sorte que la valeur par
défaut de la variable est inerte pour ce module — aucune connexion Redis n'est
jamais injectée.

### Groupe 16 — Backend de base de données (non utilisé) {#group-16--database-backend-not-used}

`database_type` est fixé à `NONE` par `Netdata_Common` ; aucune instance
Cloud SQL, base de données ou utilisateur n'est créé. Les variables
`application_database_name` (`netdatadb`) / `application_database_user` (`netdatauser`) et les
variables `db_*` associées sont déclarées uniquement pour la
compatibilité de la mise en miroir des variables de la fondation et n'ont
aucun effet.

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Active le routage basé sur Gateway, mais n'a aucun effet tant que `application_domains` n'est pas renseigné. |
| `application_domains` | `[]` | Noms d'hôtes personnalisés + certificat géré. |
| `reserve_static_ip` | `true` | IP externe stable lors des redéploiements, une fois que `service_type = LoadBalancer` ou une Gateway est utilisée. |

Toutes les autres entrées suivent le comportement standard de [App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le
moyen le plus rapide de localiser et d'explorer les ressources en cours
d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Carte des ClusterIP pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsque `service_type = LoadBalancer` et une IP statique est réservée). |
| `service_url` | URL pour atteindre Netdata. |
| `netdata_admin_password_secret_id` | ID du secret Secret Manager pour l'identifiant du mot de passe administrateur ; vide lorsque `enable_admin_password = false`. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `initialization_jobs` | Noms des jobs d'initialisation fournis par l'utilisateur (aucun par défaut). |
| `statefulset_name` | Nom du StatefulSet (lorsque `stateful_pvc_enabled = true`). |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa
> configuration via le moteur de fondation [App_GKE](App_GKE.md), qui
> valide les valeurs *et les combinaisons* au moment du plan — un
> `StatefulSet` forcé à côté d'un paramètre sans état, IAP sans
> identités autorisées, `quota_memory_*` donné comme des entiers bruts, un
> `container_port`/`backup_retention_days` hors de portée. `Netdata_GKE`
> protège en outre `min_instance_count <= max_instance_count` et IAP activé sans
> identifiants OAuth au moment du plan (voir `validation.tf`). Une
> configuration invalide fait échouer le **plan** avec une erreur claire et
> nommée avant la création de toute ressource, de sorte que la plupart des
> erreurs ci-dessous sont détectées en amont plutôt qu'à l'application ou à
> l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `service_type` (par défaut `LoadBalancer`) + `enable_admin_password` | Définir `service_type = ClusterIP` pour rester interne uniquement, ou ajouter une couche de proxy inverse/authentification avant d'exposer en externe | Critique | Le tableau de bord de Netdata n'a pas de connexion intégrée ; le Service `LoadBalancer` par défaut (ou un domaine personnalisé configuré) expose toutes les métriques d'hôte/conteneur collectées en externe sans couche d'authentification ajoutée par l'opérateur. |
| `stateful_pvc_enabled` | `true` | Critique | Le désactiver revient à GCS FUSE, ce qui corrompt les fichiers de métriques dbengine de Netdata — perte de données / bouclage de crash. |
| `max_instance_count` | `1` | Élevé | Le dbengine de Netdata est écrit par un seul processus sur un seul PVC ; la mise à l'échelle au-delà de 1 risque la corruption de fichiers/la contention de verrouillage. |
| `stateful_pvc_storage_class` | `standard-rwo` (SSD) | Moyen | Tire le quota régional serré `SSD_TOTAL_GB` ; passer à `standard` (HDD) sur les projets à quota limité — le modèle d'écriture de Netdata n'a pas besoin d'IOPS SSD. |
| `enable_nfs` | `false` (garder désactivé) | Moyen | NFS n'est pas le chemin pris en charge pour les propres fichiers de données de Netdata (`/var/lib/netdata`) ; ne l'activer que pour un montage partagé non lié à un chemin différent. |
| `application_version` | `latest` (→ épinglé `v2.2.6`) | Moyen | L'épinglage à une balise arbitraire qui n'existe pas en amont fait échouer l'étape de mise en miroir/construction de l'image Cloud Build. |
| `memory_limit` | `1Gi` (augmenter pour les grands nombres de collectes) | Moyen | Netdata conserve les métriques récentes en mémoire ; un sous-dimensionnement provoque des redémarrages OOM sous une forte charge de collecte. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont traités comme des octets et bloquent toute planification de pod dans l'espace de noms. |
| `enable_custom_domain` (par défaut `true`) avec `application_domains` vide | Renseigner `application_domains` ou laisser les deux seuls | Faible | `enable_custom_domain=true` seul n'a aucun effet tant qu'un domaine n'est pas listé — pas un risque fonctionnel, mais peut être déroutant lors de l'audit de l'exposition. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à
Netdata partagée avec la variante Cloud Run est décrite dans
**[Netdata_Common](Netdata_Common.md)**.

<!-- related-guides -->

## Guides associées {#related-guides}

- [Lab pratique : Netdata sur GKE Autopilot](../labs/Netdata_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Netdata sur Google Cloud Run](Netdata_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Netdata Common — Configuration d'application partagée](Netdata_Common.md) — la configuration partagée par les deux cibles de déploiement.
