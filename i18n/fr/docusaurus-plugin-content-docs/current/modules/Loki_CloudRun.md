---
title: "Loki sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Loki sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Loki_CloudRun.md @ 1665a43e sha256:4368c4a7ba75 -->

# Loki sur Google Cloud Run {#loki-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Loki_CloudRun.png" alt="Loki sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Grafana Loki est un système d'agrégation de logs horizontalement scalable et
hautement disponible — souvent décrit comme « Prometheus pour les logs ». Contrairement
aux indexeurs de logs en texte intégral, Loki n'indexe qu'un petit ensemble
d'étiquettes par flux de logs plutôt que le texte complet de chaque ligne, ce qui
maintient les coûts de stockage et d'exploitation à un niveau bas. Il est
normalement interrogé avec **LogQL** via **Grafana** (en tant que source de
données) ou l'outil **LogCLI**, avec un agent tel que **Promtail** ou **Grafana
Alloy** qui y envoie les logs. Ce module déploie **Loki lui-même, pas Grafana**,
sur **Cloud Run v2** au-dessus de la fondation [App_CloudRun](App_CloudRun.md),
qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud que Loki utilise et sur la façon de
les explorer et de les exploiter depuis la Google Cloud Console et la ligne de
commande. Pour les mécanismes communs à chaque application Cloud Run — identité
de service, ingress et équilibrage de charge, mise à l'échelle et concurrence,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes
et cycle de vie du déploiement — reportez-vous au [guide de la fondation
App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## Ce que coûte Loki sur RAD, et comment cela se compare {#what-loki-costs-on-rad-and-how-that-compares}

**Loki sur le module Cloud Run de RAD coûte environ 16 $ US par mois dans votre propre projet.** RAD facture 40 crédits une fois par déploiement dans votre propre projet (36 crédits, 10 % de moins, dans un projet géré par RAD), plus le temps de build. Loki se déploie également sur GKE Autopilot pour environ 40 $ US par mois — consultez le [guide GKE](Loki_GKE.md) si vous en avez besoin pour qu'il y fonctionne à la place. Si vous n'en avez besoin qu'occasionnellement, un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour quelques crédits, de sorte que ce chiffre mensuel devient quelques dollars à la place — voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 40 crédits (4,00 $ US au prix de la recharge) | 36 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût de fonctionnement Google Cloud | Facturé par Google à votre propre compte de facturation, environ **16 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **7 crédits par jour**, environ 210 par mois (environ 21,00 $ US au prix de la recharge, moins sur un plan) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge ponctuelle, et moins sur un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût de fonctionnement par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Cloud Run, 1x vCPU / 0,5 GiB (chaud) | 10 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| **Total** | **environ 16 $ US** |

### Comment cela se compare {#how-it-compares}

- Le **plan Pro de Grafana Cloud** facture des **frais de plateforme de 19 $ US par mois** plus
  l'utilisation — 0,050 $ US/Go traité, 0,400 $ US/Go écrit et 0,100 $ US/Go conservé, avec 30 jours de
  rétention inclus.
- Le module Loki de RAD coûte environ 16 $ US par mois dans votre propre projet — plus que
  les frais de base de Grafana Cloud à très faible volume de logs, mais il **n'est pas mesuré par le volume d'ingestion** : les logs restent dans votre propre projet et bucket plutôt que dans une plateforme multi-locataire partagée, et il n'y a pas de frais d'écriture/rétention par Go à budgétiser.
- Comparaison auto-gérée : à 1 vCPU / 0,5 GiB, Loki tient confortablement
  sur un droplet Hetzner CPX22 ou DigitalOcean 2 vCPU/4 Go (tous deux ~24 $ US/mois) — mais alors vous gérez
  vous-même le câblage du stockage d'objets, les sauvegardes et les mises à niveau.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Loki s'exécute dans **un projet géré par RAD pour vous**, vous avez une deuxième option qui va
bien au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour
presque rien.** Cela convient bien mieux à Loki dont vous n'avez besoin qu'occasionnellement — évaluation, environnement de démonstration, charge de travail saisonnière ou intermittente — que de le faire fonctionner en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google
  de supprimer le projet. Google ne supprime pas le projet immédiatement : il le conserve,
  récupérable, pendant 30 jours. Comme la facturation est déjà déliée, rien n'est facturé pendant qu'il
  attend. Contrairement à la suppression d'un module, cela ne supprime pas la base de données, aucune VM ou la
  ressource de calcul une par une — l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte quelques crédits, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet peut
  le restaurer. RAD demande à Google de récupérer le projet et de rattacher son compte de facturation, puis
  vous demande d'exécuter **Mettre à jour** sur chaque déploiement pour confirmer que tout est revenu. Parce que
  rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est
  une vérification, pas une reconstruction, et une mise à jour ne facture plus jamais les frais de module. Pour Loki derrière un petit Services_GCP et Project_GCP, cela représente environ **une poignée de crédits (moins de 1 $ US)** au total, contre environ 45 crédits (4,50 $ US) que coûte un redéploiement complet.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, pas 16 $ US.**
  Déployez Loki, utilisez-le pendant un certain temps, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin,
  confirmez avec Mettre à jour, et supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez les frais de module
  qu'une seule fois, les builds, et le temps pendant lequel il a été réellement actif.
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un que RAD gère uniquement pour la facturation), et
  vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime définitivement.
  La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés doit toujours
  dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'évaluation conviennent). Google
  affirme que la plupart des services fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.
- **Un véritable manque : les sauvegardes nocturnes ne survivent pas.** Les sauvegardes et autres fichiers générés sont
  écrits dans un bucket à l'intérieur du projet, et ce bucket **n'est pas** protégé par la suppression logicielle de Cloud
  Storage, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même
  si le projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé Loki et
  que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive, ou un bucket en dehors du projet)
  avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a
  pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la
fenêtre de 30 jours passée, la façon d'arrêter de payer est de supprimer le déploiement et de le déployer
à nouveau lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau, plus les builds — environ
  45 crédits (4,50 $ US) au total. La suppression permet d'économiser de l'argent
  seulement si Loki resterait inutilisé assez longtemps pour compenser ce coût de redéploiement
  par rapport à son propre coût de fonctionnement — environ **9 jours ou plus**, à la fois dans votre propre projet
  (environ 0,53 $ US par jour) et dans un projet géré par RAD (7 crédits par jour).
- **Rien ici n'est partagé.** Loki ne dépend pas d'une base de données, d'une VM ou d'un cluster qui lui est propre, donc sa suppression permet d'économiser immédiatement son coût de fonctionnement complet.
- **Conservez d'abord vos données.** Les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont
  supprimées avec lui, alors copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de labo et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de labo, pour la formation.** Un formateur anime une session pour une classe. Chaque participant obtient
  l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par
  le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne.
  Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire exécute l'application pour un client à partir d'un
  portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible,
  la facturation est interrompue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin,
  le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par
carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais RAD et estimation des crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les mécanismes de pause/restauration et ce qu'il dit sur les objets Cloud Storage sans suppression logicielle ; [Grafana Cloud](https://grafana.com/pricing/). Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Loki s'exécute en tant que conteneur binaire Go unique sur Cloud Run v2, en **mode
monolithique** (`-target=all`, le mode par défaut de Loki, qui exécute chaque
composant interne — distributeur, ingester, querier, compactor — dans un seul
processus). Le déploiement relie un ensemble restreint de services Google Cloud
centrés sur GCS :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service binaire Go, 1 vCPU / 512 Mio par défaut, facturation basée sur les requêtes |
| Stockage d'objets | Cloud Storage | Un seul bucket `storage` — le véritable backend de stockage d'objets de Loki pour les chunks et l'index TSDB expédié, pas un stockage de fichiers accessoire |
| Secrets | Secret Manager | Aucun généré — `Loki_Common` déclare `secret_ids = {}` |
| Ingress | URL Cloud Run | URL `run.app` par défaut ; équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de base de données, pas de Redis.** L'état durable de Loki (chunks,
  index TSDB) réside entièrement dans un bucket GCS. `database_type = "NONE"` et `enable_redis` n'ont
  aucun effet sur la propre configuration de Loki.
- **`max_instance_count` est effectivement épinglé à `1`.** `Loki_Common` remplace
  `max_instance_count = 1` dans la configuration qu'il transmet à `App_CloudRun`, quelle que soit
  la valeur passée. Le compactor de Loki (rétention/suppression) est un véritable singleton et
  la configuration intégrée utilise un **anneau en mémoire** (`common.ring.kvstore.store: inmemory`)
  avec `replication_factor: 1`, qui ne peut pas se coordonner entre plusieurs instances.
- **Mono-locataire, pas d'authentification.** La configuration intégrée définit `auth_enabled: false`. Il n'y a
  pas d'isolation par locataire et pas d'authentification intégrée — l'API HTTP de Loki est
  accessible par quiconque peut atteindre l'URL du service, sous réserve de `ingress_settings`.
- **Facturation basée sur les requêtes par défaut (`cpu_always_allocated = false`).** L'ingestion, la
  requête et le cycle de compaction interne de Loki s'exécutent tous en réponse directe aux
  requêtes HTTP, sans travail de fond de longue durée qui nécessite du CPU en veille.
- **Piloté par fichier de configuration, pas par variable d'environnement.** Les paramètres de stockage/schéma de Loki résident
  entièrement dans un fichier de configuration intégré à l'image ; seul le nom du bucket GCS est
  modélisé au démarrage du conteneur via la variable d'environnement `LOKI_GCS_BUCKET`.
- **Pas de jobs d'initialisation.** `initialization_jobs` par défaut à `[]` — Loki n'a rien à
  amorcer.
- **Image personnalisée, basée sur distroless.** Voir [§4](#4-loki-application-behaviour)
  et [§7](#7-configuration-pitfalls--sensible-defaults) pour comprendre pourquoi le Dockerfile de
  ce module semble inhabituel.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de
services et de ressources sont rapportés dans les [Sorties](#6-outputs) du
déploiement.

### A. Cloud Run — le service Loki {#a-cloud-run--the-loki-service}

Loki s'exécute en tant que service Cloud Run v2 unique qui s'adapte
automatiquement à la charge des requêtes. Étant donné que `max_instance_count` est
effectivement épinglé à `1`, « autoscaling » signifie ici plutôt une
mise à l'échelle à zéro et inversement plutôt qu'une répartition horizontale.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les logs et
  les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud Storage — le backend de stockage d'objets de Loki {#b-cloud-storage--lokis-object-storage-backend}

Un bucket GCS `storage` dédié est le véritable backend de stockage de Loki, pas un
supplément optionnel. Loki y écrit directement les chunks de logs compressés et
les shards d'index TSDB expédiés via son client de stockage natif `gcs`
(Application Default Credentials — le compte de service d'exécution Cloud Run se
voit accorder `roles/storage.objectAdmin` sur le bucket).

- **Console :** Cloud Storage → Buckets → sélectionnez le bucket `storage`.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
  gcloud storage ls gs://<storage-bucket>/                 # top-level layout
  gcloud storage ls gs://<storage-bucket>/index_*/          # TSDB index shards (schema prefix "index_")
  gcloud storage du -s gs://<storage-bucket>/                # total bytes stored
  ```
  Les objets de chunk et les shards d'index s'accumulent respectivement sous la
  racine du bucket et les préfixes `index_*`, selon le `schema_config` intégré à
  l'image (`schema:
  v13`, `index.prefix: index_`, `index.period: 24h`).

Voir [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK (non
utilisées par le propre chemin de stockage de Loki, qui est un accès natif à
l'API GCS, pas un système de fichiers monté).

### C. Secret Manager {#c-secret-manager}

Aucun secret n'est généré pour Loki — `Loki_Common` déclare `secret_ids = {}` et
`secret_values = {}`. Tous les secrets que vous ajoutez via `secret_environment_variables` sont
vos propres valeurs fournies par l'opérateur (par exemple, si vous placez Loki
derrière une couche d'authentification de proxy inverse).

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  ```

### D. Réseau et ingress {#d-networking--ingress}

Le service est accessible à son URL `run.app` par défaut (`ingress_settings =
"all"`), ce qui
permet aux clients d'expédition de logs (Promtail, Alloy) en dehors du VPC du
projet de pousser les logs. Un équilibreur de charge HTTPS externe avec un
domaine personnalisé, Cloud CDN et Cloud Armor peuvent être superposés.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les propres logs de processus de Loki (pas les logs qu'il *ingère* — ce sont des
données d'application à l'intérieur du service Loki, pas des entrées Cloud
Logging) sont acheminés vers Cloud Logging ; les métriques Cloud Run sont
acheminées vers Cloud Monitoring, avec des vérifications de disponibilité et des
politiques d'alerte optionnelles.

- **Console :** Logging → Logs Explorer ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Interroger Loki {#3-querying-loki}

Ce module déploie Loki **sans interface web intégrée** — Loki est un frontal pour
les logs, interrogé via LogQL. Deux façons courantes de l'interroger une fois
déployé :

- **`logcli`** (l'interface CLI officielle de Grafana), pointée vers l'URL du service :
  ```bash
  export LOKI_ADDR="$SERVICE_URL"
  logcli labels                                             # discover available labels
  logcli query '{job="myapp"}' --limit=50                   # LogQL query
  ```
- **HTTP direct** contre l'API de requête :
  ```bash
  curl -s "$SERVICE_URL/loki/api/v1/query?query=%7Bjob%3D%22myapp%22%7D" | jq .
  ```
- **En tant que source de données Grafana** — ajoutez une source de données Loki dans Grafana
  pointant vers l'URL du service ; c'est le modèle de production normal pour
  explorer et créer des tableaux de bord des logs ingérés.

---

## 4. Comportement de l'application Loki {#4-loki-application-behaviour}

- **Modélisation de la configuration au démarrage du conteneur, pas de migrations de base de données.** `Loki_Common`
  intègre un modèle de configuration dans l'image avec un seul espace réservé,
  `__LOKI_GCS_BUCKET__`. Le point d'entrée du conteneur substitue le nom réel du bucket
  (injecté en tant que variable d'environnement `LOKI_GCS_BUCKET`) par `sed` et écrit le résultat dans
  `/etc/loki/local-config.yaml` avant le démarrage de Loki — il n'y a pas d'étape de schéma de premier démarrage
  à attendre.
- **Pas de jobs d'initialisation nécessaires.** Loki n'a pas de base de données à amorcer, donc
  `initialization_jobs` est vide par défaut et ce module n'en injecte jamais.
- **Le chemin de santé est `/ready`.** Les sondes de démarrage et de vivacité ciblent
  le point de terminaison de disponibilité intégré et non authentifié de Loki, qui renvoie
  HTTP 200 une fois que le serveur écoute — généralement en quelques secondes, car il n'y a pas de
  migration ou de travail lourd de premier démarrage.
- **Mode monolithique.** `-target=all` exécute chaque composant Loki (distributeur,
  ingester, querier, query-frontend, compactor) à l'intérieur du processus unique — la
  bonne forme pour un déploiement mono-locataire petit/moyen. Loki prend également en charge un
  mode microservices (conteneurs séparés par composant) pour les déploiements à très grande
  échelle, que ce module n'implémente pas.
- **Contrainte de mise à l'échelle à instance unique.** L'anneau en mémoire
  (`common.ring.kvstore.store: inmemory`) et le job de rétention singleton du compactor
  signifient que Loki n'est pas conçu pour exécuter plus d'une instance simultanément.
  `Loki_Common` applique cela en épinglant `max_instance_count = 1` dans la configuration qu'il
  transmet à la Fondation, quelle que soit la valeur d'entrée de la plateforme.
- **Rétention.** La configuration intégrée définit `limits_config.retention_period: 720h` (30
  jours) avec le compactor effectuant la suppression (`retention_enabled: true`,
  `delete_request_store: gcs`).
- **Inspecter l'environnement du conteneur en cours d'exécution (par exemple pour confirmer que le bucket
  a bien été injecté) :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

---

## 5. Variables de configuration {#5-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls
les paramètres spécifiques ou notables pour Loki sont listés ; toutes les autres entrées sont héritées
de [App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `loki` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | `"latest"` se résout en l'ARG de build `LOKI_VERSION` épinglé (`3.6.12`) — **pas** le `APP_VERSION` générique, que la Fondation forcerait autrement à une balise Loki `latest` inexistante. Définissez une balise explicite (par exemple `3.6.12`) pour épingler une version spécifique. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_port` | `3100` | Port d'écoute HTTP de Loki — fixé par la configuration intégrée (`server.http_listen_port`). Modifier cela sans modifier également le modèle de configuration entraînera une rupture du déploiement. |
| `max_instance_count` | `1` | **Remplacé par `1` par `Loki_Common` quelle que soit cette valeur** — voir [§1](#1-overview). |
| `cpu_limit` / `memory_limit` | `1000m` / `512Mi` | Limites de ressources par instance. Augmentez la mémoire pour les ensembles d'étiquettes à cardinalité élevée ou les charges de requête importantes. |
| `cpu_always_allocated` | `false` | Facturation basée sur les requêtes — Loki n'a pas de travail de fond inactif. |
| `enable_cloudsql_volume` | `false` | Désactivé — Loki n'a pas de base de données. |
| `execution_environment` | `gen2` | Gen2 recommandé. |

### Groupe 5 — Accès et réseau {#group-5--access--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` est requis pour que les clients d'expédition de logs externes (Promtail, Alloy) en dehors du VPC du projet puissent atteindre l'API de push. |
| `enable_iap` | `false` | L'activation d'IAP bloque les push/requêtes de logs non authentifiés provenant d'agents externes. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Variables d'environnement supplémentaires en texte clair, fusionnées sur `LOKI_GCS_BUCKET` (injectées automatiquement). Loki ne lit presque rien de l'environnement — sa configuration est pilotée par fichier. |
| `secret_environment_variables` | `{}` | Aucun secret n'est nécessaire par défaut. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `storage_buckets` | `[]` | Buckets supplémentaires au-delà du bucket `storage` auto-provisionné que Loki utilise réellement pour les chunks/index. |
| `enable_nfs` | `false` | Non nécessaire pour le propre stockage de Loki (basé sur GCS), contrairement aux applications basées sur SQLite dans ce catalogue. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixe — le stockage durable de Loki est le bucket GCS, pas Cloud SQL. Toutes les autres variables du groupe 12 sont inertes. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Loki n'a pas besoin de job d'initialisation. Laissé vide par ce module et `Loki_Common`. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `/ready`, délai de 30s | Point de terminaison de disponibilité intégré de Loki — devient sain en quelques secondes car il n'y a pas d'étape de migration. |

### Groupe 16 — Redis {#group-16--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Loki n'a pas d'utilisation intégrée pour Redis ; cela n'existe que pour la complétude de la mise en miroir de la Fondation. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

---

## 6. Sorties {#6-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `api_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `storage_buckets` | Buckets Cloud Storage créés — inclut le bucket `storage` que Loki utilise pour les chunks et l'index TSDB. |
| `database_instance_name` / `database_name` / `database_user` / `database_password_secret` | Toujours vide — `database_type = "NONE"`. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, vérifications de disponibilité. |
| `initialization_jobs` | Toujours vide — Loki n'a pas besoin de job d'initialisation. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `cicd_configuration` | État et détails CI/CD. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 7. Pièges de configuration et valeurs par défaut judicieuses {#7-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur de la fondation [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et les combinaisons* au moment de la planification. Une configuration invalide échoue à la **planification** avec une erreur claire et nommée avant qu'aucune ressource ne soit créée, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'au moment de l'application ou de l'exécution.

> **Note pour les opérateurs/mainteneurs : pourquoi le Dockerfile de ce module semble
> inhabituel.** L'image officielle `grafana/loki` est **véritablement distroless** —
> l'inspection de son système de fichiers ne montre que `/usr/bin/loki`, sans shell, sans coreutils,
> et sans aucun lieur dynamique. Un modèle de Dockerfile standard (`RUN chmod +x
> /entrypoint.sh`) échoue carrément au moment de la construction (`exec: /bin/sh: no such file or
> directory`) car `RUN` a besoin d'un shell. La première tentative de correction — greffer un
> binaire busybox à partir de la balise `busybox:stable` par défaut via un `COPY` multi-étapes —
> a *également* échoué, avec l'erreur plus confuse `exec /bin/busybox: no such file or
> directory`, car le binaire de `busybox:stable` est **lié dynamiquement** et la
> cible distroless n'a pas de lieur dynamique pour le satisfaire. La solution a été de passer à
> `busybox:musl`, vérifié via `file` comme étant véritablement **lié statiquement** (aucun
> interpréteur nécessaire) : `FROM busybox:musl AS busybox` dans une étape de construction uniquement, `COPY
> --from=busybox /bin/busybox /bin/busybox` dans l'image finale basée sur distroless,
> et `ENTRYPOINT ["/bin/busybox", "sh", "/entrypoint.sh"]` (busybox invoqué
> directement par chemin absolu — aucun lien symbolique d'applet n'existe, donc même le script d'entrée
> lui-même appelle `/bin/busybox sed ...` plutôt qu'un simple `sed`). Si vous
> touchez un jour ce Dockerfile, ou le clonez pour une autre application basée sur distroless,
> rappelez-vous : **vérifiez qu'une balise busybox greffée est véritablement statique** (`file
> <binary>` ne doit pas afficher `interpreter` / lié dynamiquement) avant de supposer qu'elle
> s'exécutera dans une cible distroless.

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `max_instance_count` | Laisser par défaut (effectivement épinglé à `1`) | Critique | Même si `Loki_Common` remplace cela par `1` dans la configuration qu'il transmet à la Fondation, ne comptez pas sur la mise à l'échelle horizontale de Loki dans cette forme de déploiement — l'anneau en mémoire et le compactor singleton ne sont pas conçus pour des instances concurrentes. |
| `container_port` | `3100` (ne pas modifier sans également éditer le modèle de configuration) | Critique | Le `server.http_listen_port` de Loki est intégré au fichier de configuration, non lu à partir de `container_port` au moment de l'exécution — une incompatibilité entre eux rompt le routage entre Cloud Run et le conteneur. |
| `ingress_settings` | `all` pour l'expédition de logs externes | Élevé | La définition de `internal` empêche les agents Promtail/Alloy s'exécutant en dehors du VPC du projet de pousser les logs. |
| `enable_iap` | `false` à moins que tous les clients d'expédition de logs ne puissent s'authentifier via IAP | Élevé | IAP bloque toutes les requêtes non authentifiées, y compris l'API de push utilisée par les agents d'expédition de logs. |
| Contrôle d'accès | Aucun par défaut (`auth_enabled: false`) | Élevé | L'API HTTP de Loki (push et query) n'a pas d'authentification intégrée. Quiconque peut atteindre l'URL du service peut pousser ou interroger des logs. Protégez-la avec IAP, une politique Cloud Armor ou une couche d'authentification de proxy inverse si cela est important pour votre déploiement. |
| `application_version` | Épinglez une balise explicite (par exemple `3.6.12`) pour la production | Moyen | `"latest"` se résout silencieusement à la balise que le Dockerfile de `Loki_Common` épingle actuellement, ce qui ne change que lorsque la source du module change — pas un `latest` en direct en amont, mais aussi pas quelque chose que vous contrôlez par déploiement sans définir une balise explicite. |
| `memory_limit` | Augmenter au-dessus de `512Mi` pour les étiquettes à cardinalité élevée ou les charges de requête importantes | Moyen | Le moteur de requête de Loki et le cache d'index en mémoire peuvent manquer de mémoire sous charge avec la valeur par défaut conservative. |
| `database_type` | Laisser à `NONE` | Faible | Définir autre chose n'a aucun effet — `Loki_Common` ne connecte jamais une base de données à la configuration de Loki, quoi qu'il arrive. |

---

Pour le comportement de la fondation référencé tout au long — identité de service,
mise à l'échelle et concurrence, ingress et équilibrage de charge, CI/CD, Cloud
Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images
— voir **[App_CloudRun](App_CloudRun.md)**. La configuration d'application
spécifique à Loki partagée avec la variante GKE est décrite dans
**[Loki_Common](Loki_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Labo pratique : Loki sur Cloud Run](../labs/Loki_CloudRun.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [Loki sur GKE Autopilot](Loki_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [Loki Common — Configuration d'application partagée](Loki_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [VictoriaMetrics sur GKE Autopilot](VictoriaMetrics_GKE.md), [Grafana sur Google Cloud Run](Grafana_CloudRun.md), [Uptime Kuma sur Google Cloud Run](UptimeKuma_CloudRun.md), [GlitchTip sur Google Cloud Run](GlitchTip_CloudRun.md) dans la solution **Observabilité et astreinte**.
