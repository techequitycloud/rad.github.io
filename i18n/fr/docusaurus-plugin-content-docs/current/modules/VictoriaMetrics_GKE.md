---
title: "VictoriaMetrics sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de VictoriaMetrics sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/VictoriaMetrics_GKE.md @ 1665a43e sha256:2e3643348a0f -->

# VictoriaMetrics sur GKE Autopilot {#victoriametrics-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/VictoriaMetrics_GKE.png" alt="VictoriaMetrics sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

VictoriaMetrics est une base de données de séries temporelles rapide,
économique et compatible avec Prometheus — le backend de stockage de métriques
auto-hébergé standard à associer au module Grafana de ce catalogue. Il
accepte l'ingestion Prometheus `remote_write`, le protocole de ligne InfluxDB,
Graphite et OpenTSDB via HTTP simple, et répond aux requêtes compatibles
PromQL. Ce module déploie VictoriaMetrics sur **GKE Autopilot** sur la base
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée de
Google Cloud et Kubernetes.

Il n'existe **pas de variante Cloud Run** de ce module — voir §1 ci-dessous
pour en savoir plus.

Ce guide se concentre sur les services cloud utilisés par VictoriaMetrics et
sur la manière de les explorer et de les opérer depuis la Google Cloud
Console et la ligne de commande. Pour les mécanismes communs à toutes les
applications GKE — Workload Identity, ingress, autoscaling, CI/CD, Cloud
Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et le
cycle de vie du déploiement — reportez-vous au [guide de la fondation
App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## Ce que coûte VictoriaMetrics sur RAD et comparaison {#what-victoriametrics-costs-on-rad-and-how-that-compares}

**L'exécution de VictoriaMetrics sur GKE Autopilot dans votre propre projet Google Cloud coûte environ 42,08 $ US/mois en frais Google Cloud**, en plus d'un coût de module RAD unique de 75 crédits (7,50 $ US) facturé une seule fois au moment du déploiement. Il n'existe pas de variante Cloud Run de ce module. Dans un projet géré par RAD, le coût du module tombe à 67,5 crédits (10 % de moins) et le coût d'exécution est mesuré à l'heure en crédits — voir [Mettez-le en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Coût du module (unique) | 75 crédits | 67,5 crédits (10 % de moins) |
| Temps de build | ~3-6 crédits par build, dans les deux cas | ~3-6 crédits par build, dans les deux cas |
| Coût d'exécution Google Cloud | 42,08 $ US/mois, facturé par Google au prix catalogue | ~52 crédits/jour (environ 1560/mois, 156 $ US au prix de la recharge), mesuré au prix catalogue plus la marge de RAD |

10 crédits coûtent 1 $ US pour une recharge unique, et moins pour un plan mensuel.

**Coût d'exécution par défaut dans votre propre projet**

| Ressource (par défaut du module) | Par mois |
|---|---|
| Pod GKE Autopilot, 1x vCPU / 1 Gio | 36,08 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| **Total** | **42,08 $ US** |

*Les frais de gestion de cluster GKE sont exclus du total ci-dessus car ils sont partagés entre toutes les applications GKE du projet — 0 $ si c'est la seule, sinon environ 73 $/mois répartis entre le nombre d'applications que vous exécutez.*

### Comparaison {#how-it-compares}

- Les créateurs du projet vendent **VictoriaMetrics Cloud**, à partir de **200 $/mois** pour une instance gérée (500 000 séries temporelles actives) — vérifié sur la page de tarification de VictoriaMetrics, le 8 octobre 2026. Le coût d'exécution de RAD dans votre propre projet (~42 $/mois) représente environ un cinquième de ce prix de départ, bien que VictoriaMetrics Cloud inclue un stockage élastique et des limites d'ingestion que ce pod de taille fixe n'essaie pas d'égaler.
- Une comparaison VPS autogérée, dimensionnée selon les valeurs par défaut de VictoriaMetrics (1 vCPU / 1 Gio) : un Hetzner CPX11 ou un Droplet DigitalOcean 1 vCPU/2 Go coûte environ 6-12 $/mois, moins cher en espèces que l'une ou l'autre des options RAD ici — plus votre propre temps pour les sauvegardes et les correctifs, et aucun plan de contrôle Kubernetes à exécuter.
- VictoriaMetrics est presque toujours associé à Grafana comme backend de métriques ; le coût d'exécution de ce module est délibérément minimal (pas de NFS, pas de base de données gérée — VictoriaMetrics gère son propre stockage sur disque) de sorte que le coût total de la paire est dominé par celui des deux qui nécessite le plus de calcul.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

C'est l'avantage principal d'un projet géré par RAD, et il ne coûte rien lorsqu'il est en pause.
La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer
complètement le projet — la suppression logicielle récupérable de 30 jours de Google. Contrairement à la suppression d'un module,
cela ne détruit **pas** Cloud SQL, aucune VM, ou la ressource de calcul une par une : l'ensemble
du projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà
déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de restaurer le
projet et de rattacher son compte de facturation, puis vous demande d'exécuter la mise à jour sur chaque déploiement pour
confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve
les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture
jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits (moins de 1 $ US) au total pour une chaîne de déploiement typique
de 2-3.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD gère uniquement la facturation), vous devez
le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est
admise comme la création d'un nouveau projet, donc votre solde de crédits achetés doit toujours dépasser
le seuil du palier (100 crédits pour le palier sandbox que la plupart des utilisations d'étude/démo conviennent). Google indique que la plupart
des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a
la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous
supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez
personnalisé VictoriaMetrics et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive, ou un bucket
en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable,
cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que 30 jours se sont écoulés sur un projet géré par RAD, il n'y a pas de pause gratuite —
la suppression supprime les ressources définitivement, et la remise en service de VictoriaMetrics signifie un redéploiement à
partir de zéro. Cela coûte environ 78-81 crédits dans votre propre projet, ou environ
70,5-73,5 crédits dans un projet géré par RAD.

La suppression ne permet d'économiser de l'argent que si VictoriaMetrics reste inutilisé suffisamment longtemps pour compenser ce
coût de redéploiement par rapport à son propre coût d'exécution — environ 6 jours ou plus dans votre propre projet
(environ 1,40 $ US par jour), ou environ 1 jour ou plus dans un projet géré par RAD
(52 crédits par jour).

Priorité aux données : les sauvegardes nocturnes sont stockées dans un bucket au sein du déploiement et sont supprimées avec celui-ci.
Copiez la dernière sauvegarde avant de supprimer si vous souhaitez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

Sessions de lab, pour la formation : un formateur anime une session pour une classe. Chaque participant dispose de
l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par
le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne.
Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.

Environnements gérés, pour les sociétés de conseil : un partenaire exécute l'application pour un client à partir d'un
portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible,
la facturation est interrompue et les données sont conservées, afin que personne ne reçoive de frais inattendus. À la fin,
le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR,
par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les frais propres à RAD et les estimations de crédits quotidiens ; [documentation de Google sur la suppression/restauration de projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les affirmations de pause/restauration ; [tarification de VictoriaMetrics Cloud](https://victoriametrics.com/products/cloud/).

## 1. Vue d'ensemble {#1-overview}

VictoriaMetrics s'exécute en tant que charge de travail de base de données de
séries temporelles à nœud unique et avec état sur Autopilot. Le déploiement
relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pod VictoriaMetrics unique, 1 vCPU / 1 Gio par défaut |
| Stockage persistant | Disque persistant via StatefulSet PVC | Requis — monté à `/victoria-metrics-data` ; classe de stockage `standard` (HDD `pd-standard`) par défaut |
| Secrets | aucun | VictoriaMetrics n'a pas d'authentification intégrée — aucun secret Secret Manager n'est créé |
| Ingress | Cloud Load Balancing | `ClusterIP` par défaut (interne uniquement, par conception — voir ci-dessous) ; `LoadBalancer` ou domaine personnalisé lorsque le scraping/l'interrogation externe est réellement nécessaire |

**Pourquoi GKE uniquement :** VictoriaMetrics stocke ses données de séries
temporelles sous forme de fichiers locaux mmap'd sur disque (confirmé via la
FAQ officielle : *"VictoriaMetrics stocke les données dans un stockage par
blocs..."*). Ceci est incompatible avec le système de fichiers éphémère par
révision de Cloud Run et avec la sémantique de verrouillage de fichiers/mmap
de GCS FUSE — la même classe de contrainte déjà documentée pour ClickHouse,
Elasticsearch et MongoDB dans ce catalogue. `VictoriaMetrics_GKE` nécessite donc
un véritable PersistentVolumeClaim de bloc (`stateful_pvc_enabled = true` par défaut) et
n'a pas de module Cloud Run équivalent.

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de base de données SQL, pas de Redis.** VictoriaMetrics gère sa
  propre TSDB embarquée. Aucune instance Cloud SQL n'est créée ; `enable_redis`
  est codé en dur à `false`.
- **Instance unique par défaut, et ce n'est pas un bouton "mettre à l'échelle
  plus tard".** `max_instance_count = 1` — VictoriaMetrics à nœud unique n'a pas de
  clustering ou de réplication intégrés. Deux pods écrivant sur le même PVC
  corrompraient les données.
- **Le PVC StatefulSet est requis, non facultatif.** Contrairement à
  certaines applications avec état de ce catalogue où un mécanisme de
  secours GCS FUSE existe, VictoriaMetrics n'a pas de mécanisme de secours —
  ses fichiers de données mmap'd ne sont pas compatibles FUSE, même en mode
  dégradé. `stateful_pvc_enabled = true` est la valeur par défaut et devrait le rester.
- **`ClusterIP` par défaut — c'est correct, pas un bug.** VictoriaMetrics est
  destiné à être scrappé et interrogé *en interne* par des clients
  compatibles Prometheus (un expéditeur `remote_write`, `vmagent` ou
  Grafana) exécutés dans le même cluster, et non exposé comme une
  application web publique. C'est le même modèle confirmé comme correct déjà
  documenté pour Qdrant et PhpMyAdmin dans ce catalogue — ne le "corrigez"
  pas en `LoadBalancer` en supposant qu'il s'agit du bug de copier-coller
  ClusterIP à l'échelle de la flotte trouvé ailleurs ; ce n'est
  véritablement pas le cas ici.
- **Classe de stockage HDD par défaut.** `stateful_pvc_storage_class = "standard"` (`pd-standard`),
  et non le `standard-rwo` basé sur SSD que de nombreux autres modules avec
  état utilisent par défaut — VictoriaMetrics est documenté comme tolérant
  un stockage à haute latence et à faible IOPS, ce qui évite de puiser dans
  le quota serré `SSD_TOTAL_GB`.
- **Configuration par indicateur CLI, pas par variables d'environnement.**
  VictoriaMetrics n'a pas de configuration basée sur des variables
  d'environnement. Le `ENTRYPOINT` de l'image personnalisée épingle
  `-storageDataPath`, `-httpListenAddr` et `-retentionPeriod`
  directement — voir §4.
- **Un seul point de terminaison `/health`** sert à la fois la sonde de
  démarrage et la sonde de vivacité — il n'y a pas de distinction distincte
  entre la disponibilité et la vivacité.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont signalés dans les [Sorties](#6-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail VictoriaMetrics {#a-gke-autopilot--the-victoriametrics-workload}

Le pod VictoriaMetrics s'exécute sur Autopilot, qui facture le CPU/la mémoire
que le pod demande réellement. `max_instance_count = 1` maintient un seul pod en
cours d'exécution — la mise à l'échelle horizontale n'est
intentionnellement pas prise en charge pour ce déploiement à nœud unique.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la
  charge de travail VictoriaMetrics pour les pods, les événements et
  l'utilisation des ressources. Kubernetes Engine → Services et Ingress
  affiche l'adresse IP du cluster (ou l'adresse IP externe si `LoadBalancer`
  est utilisée).
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot et du type de charge
de travail (StatefulSet).

### B. Stockage persistant — StatefulSet PVC (le seul backend pris en charge) {#b-persistent-storage--statefulset-pvc-the-only-supported-backend}

VictoriaMetrics persiste ses fichiers de données de séries temporelles à
`/victoria-metrics-data`. Contrairement à plusieurs autres applications avec état de ce
catalogue, il n'y a pas de mécanisme de secours GCS FUSE — un véritable
PersistentVolumeClaim de bloc est requis. La classe de stockage est
`standard` (HDD `pd-standard`) par défaut.

- **Console :** Kubernetes Engine → Stockage → PersistentVolumeClaims.
  Compute Engine → Disques pour voir le disque persistant sous-jacent.
- **CLI :**
  ```bash
  # PVC status
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE"

  # Confirm the mount and inspect on-disk data files inside the pod
  kubectl exec -n "$NAMESPACE" <pod-name> -- ls -la /victoria-metrics-data
  ```

Voir [App_GKE](App_GKE.md) pour les mécanismes de StatefulSet PVC et les
options de classe de stockage en général.

### C. Pas de secrets Secret Manager {#c-no-secret-manager-secrets}

VictoriaMetrics n'a pas d'authentification intégrée, donc `VictoriaMetrics_Common`
ne génère ni ne stocke de secrets. L'accès est entièrement géré au niveau de
la couche réseau — la valeur par défaut `ClusterIP`, ou IAP / Cloud Armor
si le service est délibérément rendu accessible de l'extérieur. Il n'y a
rien à récupérer de Secret Manager pour ce module.

### D. Réseau et ingress {#d-networking--ingress}

Par défaut, la charge de travail est exposée uniquement à l'intérieur du
cluster via un service `ClusterIP` — le modèle d'accès prévu est Grafana,
`vmagent`, ou un expéditeur Prometheus `remote_write` exécuté dans le
même cluster. Ne changez `service_type` en `LoadBalancer` que si vous avez
un besoin réel de scraper ou d'interroger depuis l'extérieur du cluster (et
ajoutez d'abord vos propres contrôles d'accès — VictoriaMetrics lui-même
n'en applique aucun).

- **Console :** Kubernetes Engine → Services et Ingress ; Réseau VPC →
  Adresses IP (lorsqu'une IP statique est réservée).
- **CLI :**
  ```bash
  kubectl get svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails des adresses IP statiques.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les sorties standard et d'erreur des pods sont acheminées vers Cloud Logging
; les métriques GKE sont acheminées vers Cloud Monitoring. Des tests de
disponibilité (uptime checks) optionnels (contre `/health`) et des
stratégies d'alerte sont disponibles, mais n'ont de sens que si le service
est accessible depuis l'origine du test.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application VictoriaMetrics {#3-victoriametrics-application-behaviour}

- **Pas de bootstrap de base de données, pas de jobs d'initialisation.**
  VictoriaMetrics gère sa propre TSDB embarquée. C'est un binaire
  autonome sans concept de schéma ou de migration — aucun job
  d'initialisation n'est injecté par défaut, et aucun n'est nécessaire. La
  charge de travail commence à servir dès que son répertoire de données est
  monté.
- **Point de terminaison de santé.** Un seul point de terminaison
  `/health` non authentifié (renvoie `OK`) sert à la fois les
  sondes de démarrage et de vivacité — il n'y a pas de distinction séparée
  entre la disponibilité et la vivacité, contrairement aux applications
  ayant une séquence de démarrage plus lourde.
- **Comment les métriques entrent.** VictoriaMetrics accepte plusieurs
  protocoles d'ingestion via HTTP simple sur le port `8428` :
  - Prometheus `remote_write` → `POST /api/v1/write`
  - Protocole de ligne InfluxDB → `/write`
  - Protocole Graphite plaintext / pickle
  - OpenTSDB `/api/put` et telnet put
  - Son propre agent piloté par la configuration de scraping, `vmagent`,
    peut également être déployé en tant que sidecar (via `additional_services`)
    pour extraire des métriques des points de terminaison Prometheus
    `/metrics`, reproduisant ce qu'un serveur Prometheus autonome ferait.
- **Comment l'interroger.** VictoriaMetrics expose une API de requête
  compatible PromQL (`/api/v1/query`, `/api/v1/query_range`, `/api/v1/series`, ...)
  — la même interface que l'API HTTP de Prometheus. Pointez Grafana vers
  celle-ci en utilisant le type de source de données **Prometheus** avec
  l'URL définie sur le nom DNS interne du service VictoriaMetrics (ou l'URL
  externe, si exposée), aucun plugin n'est requis.
- **La rétention est intégrée à l'image, non configurable à l'exécution.**
  `-retentionPeriod=12` (12 mois) est compilé dans le `ENTRYPOINT` de l'image
  personnalisée (voir §4). Il n'est pas exposé en tant que variable
  Terraform — le modifier nécessite d'éditer `VictoriaMetrics_Common/scripts/Dockerfile` et de forcer
  une reconstruction.
- **Pas de clustering.** Ce module déploie VictoriaMetrics en mode
  **nœud unique**. VictoriaMetrics propose également une édition "cluster"
  (`vminsert`/`vmstorage`/`vmselect`) pour la mise à
  l'échelle horizontale, mais il s'agit d'une topologie de déploiement
  totalement différente et ce n'est pas ce que ce module provisionne.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
VictoriaMetrics sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec son comportement et ses valeurs par défaut
standards.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail autorisées à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources pour le suivi des coûts/propriétés. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `victoriametrics` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `VictoriaMetrics` | Nom convivial affiché dans la Console. |
| `application_version` | `latest` | Tag de l'image VictoriaMetrics. `latest` correspond à une version épinglée connue et stable (`v1.148.0`) comme argument de build du Dockerfile, car l'image amont n'a pas de tag `latest` flottant propre. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par pod. |
| `memory_limit` | `1Gi` | Mémoire par pod. ~1 Go de RAM par million de séries temporelles actives est la directive de mise à l'échelle amont ; maintenez l'utilisation propre de VictoriaMetrics en dessous de ~50 % de la mémoire disponible pour la marge du cache de pages du système d'exploitation. |
| `min_instance_count` | `1` | Réplicas minimum. Maintenez à 1 — un StatefulSet avec `replicas=0` n'a rien pour servir les requêtes. |
| `max_instance_count` | `1` | Réplicas maximum. **Doit rester à 1** — pas de clustering/réplication en mode nœud unique. |
| `enable_vertical_pod_autoscaling` | `false` | Laissez Autopilot ajuster automatiquement les requêtes de ressources (désactive le HPA CPU/Mémoire). |
| `enable_image_mirroring` | `true` | Mettez en miroir l'image VictoriaMetrics dans Artifact Registry pour éviter les limites de débit de Docker Hub. |
| `timeout_seconds` | `300` | Délai d'attente de la requête en secondes (0–3600). |
| `termination_grace_period_seconds` | `60` | Secondes pendant lesquelles Kubernetes attend après SIGTERM que VictoriaMetrics vide les écritures en cours sur le disque. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Variables d'environnement supplémentaires. **VictoriaMetrics ne lit pas les variables d'environnement pour la configuration** — uniquement les indicateurs CLI intégrés à l'image (§4 ci-dessus) ; les valeurs ici n'ont aucun effet sur le binaire en cours d'exécution, sauf s'il lit cette variable exacte, ce qu'il ne fait pas par défaut. |
| `secret_environment_variables` | `{}` | Mappage variable d'environnement → nom de secret Secret Manager. Non renseigné par défaut — VictoriaMetrics n'a pas d'authentification intégrée. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Période de rappel de rotation de Secret Manager (30 jours par défaut). Non applicable sauf si vous ajoutez vos propres secrets. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `gke_cluster_name` | `""` | Nom du cluster cible. Découvert automatiquement lorsqu'il est vide. |
| `gke_cluster_selection_mode` | `primary` | Stratégie de sélection de cluster : `explicit`, `round-robin` ou `primary`. |
| `namespace_name` | `""` | Espace de noms Kubernetes. Généré automatiquement lorsqu'il est vide. |
| `workload_type` | `null` | Se résout automatiquement en `StatefulSet` lorsque `stateful_pvc_enabled = true` (par défaut). |
| `service_type` | `ClusterIP` | Comment le service est exposé. `ClusterIP` est correct et intentionnel ici — voir §1. |
| `session_affinity` | `None` | `None` ou `ClientIP`. |
| `enable_network_segmentation` | `false` | Crée des ressources Kubernetes NetworkPolicy pour la micro-segmentation. |
| `configure_service_mesh` | `false` | Active l'injection Istio pour l'espace de noms de l'application. |

### Groupe 7 — Configuration StatefulSet {#group-7--statefulset-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | **Requis** — les fichiers de données sur disque local mmap'd de VictoriaMetrics ne sont pas compatibles GCS FUSE, même en tant que solution de secours. Doit rester `true`. |
| `stateful_pvc_size` | `20Gi` | Taille du PVC par pod. Taille pour contenir la fenêtre de rétention complète (12 mois par défaut) plus les frais de fusion — ~20 % d'espace libre recommandé. |
| `stateful_pvc_mount_path` | `/victoria-metrics-data` | Chemin du conteneur pour le PVC. Doit correspondre à l'indicateur `-storageDataPath` intégré à l'image. |
| `stateful_pvc_storage_class` | `standard` | HDD `pd-standard` par défaut — VictoriaMetrics est documenté comme tolérant aux IOPS, évitant le quota serré `SSD_TOTAL_GB`. |
| `stateful_headless_service` | `null` | Crée un service sans tête pour des identités réseau stables. |
| `stateful_pod_management_policy` | `null` | `OrderedReady` assure des redémarrages séquentiels sûrs. |
| `stateful_update_strategy` | `null` | `RollingUpdate` pour des mises à jour sans interruption. |
| `stateful_fs_group` | `3000` | GID du groupe fsGroup défini dans le contexte de sécurité du pod. VictoriaMetrics s'exécute en tant que UID 1000/GID 2000 ; `3000` garantit que le PVC est accessible en écriture par le groupe. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Limite les comptes de CPU/mémoire/objets de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doit utiliser des unités binaires (`4Gi`, `8192Mi`)** — les entiers bruts sont lus comme des octets et bloquent la planification. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protège la disponibilité pendant les mises à niveau de nœuds. Avec `max_instance_count = 1`, un pod ne peut pas être évincé tout en satisfaisant `pdb_min_available = 1` — tenez-en compte dans la planification des mises à niveau de nœuds. |
| `pdb_min_available` | `1` | Nombre minimum de pods disponibles pendant les interruptions volontaires. |
| `enable_topology_spread` | `false` | Non significatif avec un seul réplica. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | `/health`, délai de 15s | Sonde HTTP. |
| `liveness_probe` | `/health`, délai de 30s | Sonde HTTP. Même point de terminaison que le démarrage — VictoriaMetrics n'a pas de distinction séparée entre la disponibilité et la vivacité. |
| `uptime_check_config` | `disabled` | Test de disponibilité Cloud Monitoring optionnel contre `/health`. Utile uniquement si le service est accessible depuis l'origine du test. |
| `alert_policies` | `[]` | Politiques d'alerte métrique optionnelles. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | VictoriaMetrics ne nécessite pas de job d'initialisation par défaut — il est autonome sans concept de schéma/migration. |
| `cron_jobs` | `[]` | CronJobs Kubernetes pour la maintenance périodique, par exemple une exportation de snapshot `vmbackup` scriptée. |
| `additional_services` | `[]` | Services sidecar ou auxiliaires déployés aux côtés de VictoriaMetrics — par exemple un sidecar de transfert de scraping `vmagent`. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard App_GKE Cloud Build / Cloud Deploy — voir
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 13 — NFS {#group-13--nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | VictoriaMetrics utilise un PVC de bloc pour le stockage — n'activez NFS que pour les jobs personnalisés qui nécessitent un système de fichiers partagé. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur. |
| `network_tags` | `["nfsserver"]` | Tags réseau de nœud/pod GKE ; `nfsserver` est requis lorsque NFS est activé. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne les buckets GCS définis dans `storage_buckets`. VictoriaMetrics lui-même ne déclare **aucun bucket par défaut** — son intégration GCS/S3 est uniquement pour la sauvegarde, jamais pour le stockage de requêtes en direct. |
| `storage_buckets` / `gcs_volumes` | `[]` | Buckets supplémentaires / montages GCS FUSE, sans rapport avec le stockage principal. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` | `7` | Nombre maximal d'images de conteneurs récentes à conserver dans Artifact Registry (pour l'image personnalisée). |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). Aucun mécanisme de sauvegarde par défaut n'est configuré pour VictoriaMetrics au-delà du hook de planification générique de la Fondation — utilisez `cron_jobs` avec `vmbackup` pour des sauvegardes instantanées conscientes de l'application. |
| `backup_retention_days` | `7` | Rétention. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restauration à partir d'une sauvegarde lors du déploiement. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne l'API Kubernetes Gateway avec des certificats SSL. N'a de sens que lorsque le service est délibérément rendu accessible de l'extérieur — `service_type` reste `ClusterIP` par défaut. |
| `application_domains` | `[]` | Noms d'hôtes à servir. |
| `reserve_static_ip` | `true` | Réserve une IP externe stable. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google via Kubernetes Gateway. Nécessite `enable_custom_domain`. Recommandé par rapport à un `LoadBalancer` nu si VictoriaMetrics est exposé en dehors du cluster, car il n'a pas d'authentification propre. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque l'IAP est activé (sensible). |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attache une politique Cloud Armor (WAF) au backend Ingress GKE. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à un accès privilégié. |
| `enable_cdn` | `false` | Active Cloud CDN via GCPBackendPolicy. Non pertinent pour une API de métriques. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode d'exécution à sec. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Pas de base de données SQL, pas de Redis, pas de secrets {#5-no-sql-database-no-redis-no-secrets}

Trois choses que ce module ne provisionne délibérément **pas**, contrairement
à la plupart des modules d'application de ce catalogue :

- **Pas d'instance Cloud SQL.** `database_type = "NONE"` est fixé par
  `VictoriaMetrics_Common`. VictoriaMetrics est lui-même une base de données.
- **Pas de Redis.** `enable_redis` est codé en dur à `false` dans
  `main.tf`, remplaçant la valeur par défaut `App_GKE` de
  `true`.
- **Pas de secrets Secret Manager.** La sortie `VictoriaMetrics_Common` de
  `secret_ids` est toujours `{}`. Il n'y a pas de clé API, de mot
  de passe administrateur ou de credential de quelque nature que ce soit à
  récupérer — le contrôle d'accès est entièrement au niveau de la couche
  réseau (`service_type`, IAP, Cloud Armor).

---

## 6. Sorties {#6-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le
moyen le plus rapide de localiser et d'explorer les ressources en cours
d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Mappage des ClusterIP pour les services spécifiques à l'étape (Cloud Deploy). |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre l'API HTTP de VictoriaMetrics — DNS `*.svc.cluster.local` interne par défaut. |
| `statefulset_name` | Nom du StatefulSet. |
| `storage_buckets` | Buckets Cloud Storage créés — vide par défaut (VictoriaMetrics n'en déclare aucun). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` | Noms des jobs de configuration personnalisés (vide par défaut). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Dépôt GitHub connecté. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 7. Pièges de configuration et valeurs par défaut judicieuses {#7-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `stateful_pvc_enabled` | `true` (par défaut, requis) | Critique | Sans PVC, il n'y a aucun mode de stockage pris en charge pour ce module — les fichiers de données mmap'd de VictoriaMetrics ne sont pas compatibles GCS FUSE, même en tant que solution de secours. Ne pas désactiver. |
| `stateful_pvc_mount_path` | `/victoria-metrics-data` (par défaut) | Critique | Doit correspondre à l'indicateur `-storageDataPath` intégré à l'image personnalisée. Une non-concordance signifie que le PVC est monté à un endroit où le binaire n'écrit jamais, et toutes les données résident dans la couche éphémère du pod — perdues à chaque redémarrage. |
| `service_type` | `ClusterIP` (par défaut) — **ne pas "corriger" en `LoadBalancer`** | Critique (si modifié négligemment) | C'est la valeur par défaut confirmée comme correcte pour cette application, et non le bug de copier-coller ClusterIP à l'échelle de la flotte documenté ailleurs dans ce catalogue. VictoriaMetrics n'a aucune authentification intégrée — l'exposer via `LoadBalancer` sans IAP ou Cloud Armor rend toutes les métriques ingérées lisibles/écritables/supprimables par quiconque peut atteindre l'IP. |
| `application_name` | défini une fois | Critique | Immuable après le premier déploiement ; le modifier recrée l'espace de noms et le PVC, perdant tout l'historique des métriques ingérées. |
| `max_instance_count` | `1` (fixe) | Critique | VictoriaMetrics à nœud unique n'a pas de clustering ou de réplication — un deuxième réplica écrivant sur le même PVC corrompt les fichiers de données. Il n'y a aucun moyen pris en charge de mettre à l'échelle ce module horizontalement ; utilisez l'édition de cluster VictoriaMetrics séparée (ce que ce module ne déploie pas) si vous en avez besoin. |
| `-retentionPeriod` (intégré à l'image) | `12` mois (par défaut) | Élevé | Pas une variable Terraform — modifier la rétention nécessite d'éditer `VictoriaMetrics_Common/scripts/Dockerfile` et de forcer une reconstruction de l'image. Les données plus anciennes que la fenêtre de rétention sont supprimées par VictoriaMetrics lui-même selon son propre calendrier ; il n'y a pas de suppression logicielle ou de corbeille. |
| `environment_variables` | inerte pour la configuration VictoriaMetrics | Moyen | VictoriaMetrics ne lit aucune variable d'environnement pour sa propre configuration — uniquement les indicateurs CLI intégrés à l'image. Ne vous attendez pas à ce qu'une variable d'environnement de type `VICTORIA_METRICS_*` modifie le comportement ; ce ne sera pas le cas, à moins que le binaire amont ne lise ce nom exact (ce qu'il ne fait pas par défaut). |
| `stateful_pvc_size` | généreux (20 Gio+, échelle à rétention × taux d'ingestion) | Élevé | Un PVC sous-dimensionné se remplit à mesure que les données de la fenêtre de rétention s'accumulent ; un disque plein arrête l'ingestion/les fusions. La capacité du PVC ne peut pas être diminuée après la création, et l'augmenter nécessite un redimensionnement conscient du StatefulSet. |
| `stateful_pvc_storage_class` | `standard` (HDD, par défaut) | Moyen | Ne peut pas être modifié après la création du PVC sans migration de données. Le HDD est la valeur par défaut saine (VictoriaMetrics est tolérant aux IOPS) — le passage à `standard-rwo`/SSD n'est pertinent que pour une très forte concurrence de requêtes et puise dans le quota serré `SSD_TOTAL_GB`. |
| `application_version` | épingler à un tag spécifique pour la production | Moyen | `latest` correspond à une version fixe épinglée (`v1.148.0`) au moment de la construction dans ce module — donc, contrairement à d'autres applications, "latest" ici ne dérive pas silencieusement lors de la reconstruction. Néanmoins, épinglez explicitement si vous avez besoin d'une reproductibilité stricte entre les environnements. |
| `min_instance_count` | `1` | Moyen | La mise à l'échelle à zéro ne laisse rien pour servir les requêtes ou accepter l'ingestion ; il n'y a pas de comportement de rechargement à froid sur lequel il faut compter pour un backend de métriques dont d'autres systèmes dépendent pour être toujours opérationnel. |
| `quota_memory_requests` / `_limits` | unités binaires | Critique | Les entiers bruts sont des octets et bloquent toute planification. |
| `enable_iap` / `enable_cloud_armor` | activer si `service_type` est modifié de `ClusterIP` | Élevé | VictoriaMetrics n'applique aucun contrôle d'accès propre — tout ce qui peut atteindre le port peut lire et écrire toutes les données de métriques. |
| `pdb_min_available` vs `min_instance_count` | soyez conscient de l'interaction | Moyen | `1`/`1` (les valeurs par défaut) signifie que le pod unique ne peut pas être évincé volontairement tout en satisfaisant le PDB — peut bloquer les mises à niveau de nœuds jusqu'à ce que Kubernetes revienne à d'autres stratégies d'éviction. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à
VictoriaMetrics est décrite dans **[VictoriaMetrics_Common](VictoriaMetrics_Common.md)**.

<!-- related-guides -->

## Guides connexes {#related-guides}

- [Lab pratique : VictoriaMetrics sur GKE Autopilot](../labs/VictoriaMetrics_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [VictoriaMetrics Common — Configuration d'application partagée](VictoriaMetrics_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [Loki sur Google Cloud Run](Loki_CloudRun.md), [Grafana sur Google Cloud Run](Grafana_CloudRun.md), [Uptime Kuma sur Google Cloud Run](UptimeKuma_CloudRun.md), [GlitchTip sur Google Cloud Run](GlitchTip_CloudRun.md) dans la solution **Observabilité et astreinte**.
