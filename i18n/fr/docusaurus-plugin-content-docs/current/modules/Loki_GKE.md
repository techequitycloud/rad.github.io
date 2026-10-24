---
title: "Loki sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Loki sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Loki_GKE.md @ 1665a43e sha256:f8c9acee4891 -->

# Loki sur GKE Autopilot {#loki-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Loki_GKE.png" alt="Loki sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Grafana Loki est un système d'agrégation de logs hautement disponible et
horizontalement scalable — souvent décrit comme "Prometheus pour les logs".
Contrairement aux indexeurs de logs en texte intégral, Loki n'indexe qu'un petit
ensemble de labels par flux de logs plutôt que le texte complet de chaque ligne,
ce qui maintient les coûts de stockage et d'exploitation à un niveau bas. Il est
normalement interrogé avec **LogQL** via **Grafana** (en tant que source de
données) ou l'outil **LogCLI**, avec un agent tel que **Promtail** ou **Grafana
Alloy** qui y envoie les logs. Ce module déploie **Loki lui-même, pas Grafana**,
sur **GKE Autopilot** au-dessus de la fondation [App_GKE](App_GKE.md), qui
provisionne et gère l'infrastructure partagée Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Loki et sur la façon
de les explorer et de les exploiter depuis la console Google Cloud et la ligne
de commande. Pour les mécanismes communs à toutes les applications GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et le cycle de vie du
déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## Ce que coûte Loki sur RAD, et comment cela se compare {#what-loki-costs-on-rad-and-how-that-compares}

**Le module GKE Autopilot de Loki sur RAD coûte environ 40 US$ par mois dans
votre propre projet.** RAD facture 40 crédits une fois par déploiement dans
votre propre projet (36 crédits, 10 % de moins, dans un projet géré par RAD),
plus le temps de build. La même application se déploie également sur Cloud Run
pour environ 16 US$ par mois — voir le [guide Cloud Run](Loki_CloudRun.md) pour
l'option à moindre coût. Si vous n'en avez besoin qu'occasionnellement, un
projet géré par RAD peut être supprimé et restauré dans les 30 jours pour
quelques crédits, de sorte que ce chiffre mensuel devient quelques dollars
seulement — voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 40 crédits (4,00 US$ au prix de la recharge) | 36 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **40 US$ par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **63 crédits par jour**, soit environ 1 890 par mois (environ 189,00 US$ au prix de la recharge, moins avec un abonnement) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum de crédits achetés est conservé en réserve |

10 crédits coûtent 1 US$ en recharge unique, et moins avec un abonnement
mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers
et le réseau sont partagés par toutes les applications du projet, de sorte
qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix
catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Pod GKE Autopilot, 1x vCPU / 0,5 GiB | 34 US$ |
| Cloud NAT et réseau | 5 US$ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 US$ |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 US$ si c'est votre seul cluster, sinon ~73 US$ |
| **Total** | **environ 40 US$** |

### Comment cela se compare {#how-it-compares}

- Le **plan Pro de Grafana Cloud** facture des **frais de plateforme de 19 US$
  par mois** plus l'utilisation — 0,050 US$/Go traité, 0,400 US$/Go écrit et
  0,100 US$/Go conservé, avec 30 jours de rétention inclus.
- Le module Loki de RAD coûte environ 40 US$ par mois dans votre propre projet
  — plus que les frais de base de Grafana Cloud pour un très faible volume de
  logs, mais il **n'est pas mesuré par le volume d'ingestion** : les logs
  restent dans votre propre projet et bucket plutôt que dans une plateforme
  multi-locataire partagée, et il n'y a pas de frais d'écriture/rétention par
  Go à budgétiser.
- Comparaison auto-gérée : à 1 vCPU / 0,5 GiB, Loki tient confortablement sur un
  droplet Hetzner CPX22 ou DigitalOcean 2 vCPU/4 Go (tous deux ~24 US$/mois) —
  mais vous gérez alors vous-même le câblage du stockage d'objets, les
  sauvegardes et les mises à niveau.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Loki s'exécute dans **un projet géré par RAD pour vous**, vous avez une
deuxième option qui va bien au-delà de la mise à l'échelle à zéro : **supprimez
l'ensemble du projet et restaurez-le dans les 30 jours pour presque rien.**
Cela convient bien mieux à Loki dont vous n'avez besoin qu'occasionnellement —
pour l'évaluer, un environnement de démonstration, une charge de travail
saisonnière ou intermittente — que de le faire fonctionner en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord
  sa facturation, puis demande à Google de supprimer le projet. Google ne
  supprime pas le projet immédiatement : il le conserve, récupérable, pendant
  30 jours. Comme la facturation est déjà déliée, rien n'est facturé pendant
  cette attente. Contrairement à la suppression d'un seul module, cela ne
  détruit pas la base de données, une VM ou la ressource de calcul une par une
  — l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte quelques crédits, pas une reconstruction.** Dans les
  30 jours, le propriétaire du projet peut le restaurer. RAD demande à Google
  de restaurer le projet et de rattacher son compte de facturation, puis vous
  demande d'exécuter **Mettre à jour** sur chaque déploiement pour confirmer
  que tout est revenu. Comme rien n'a été détruit individuellement, cette mise
  à jour trouve les mêmes ressources déjà présentes — c'est une vérification,
  pas une reconstruction, et une mise à jour ne facture jamais les frais de
  module à nouveau. Pour Loki derrière Services_GCP (un cluster GKE) et
  Project_GCP, cela représente environ **une poignée de crédits (moins de 1
  US$)** au total, contre les environ 45 crédits (4,50 US$) que coûte un
  redéploiement complet.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars,
  pas 40 US$.** Déployez Loki, utilisez-le un certain temps, supprimez le
  projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez
  avec Mettre à jour, et supprimez-le à nouveau lorsque vous avez terminé. Vous
  ne payez que les frais de module une fois, les builds, et le temps pendant
  lequel il a été réellement actif.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un
  projet dont RAD gère uniquement la facturation), et vous le restaurez
  vous-même dans les 30 jours — après cela, Google le supprime définitivement.
  La restauration est admise comme la création d'un nouveau projet : votre
  solde de crédits achetés doit toujours dépasser le seuil du niveau (100
  crédits pour le niveau sandbox que la plupart des utilisations d'évaluation
  conviennent). Google indique que la plupart des services sont à nouveau
  entièrement fonctionnels dans les 36 heures suivant une restauration.
- **Une lacune réelle : les sauvegardes nocturnes ne survivent pas.** Les
  sauvegardes et autres fichiers générés sont écrits dans un bucket à
  l'intérieur du projet, et ce bucket **n'est pas** protégé par la
  suppression logicielle de Cloud Storage, il est donc très probable qu'il
  disparaisse dès que vous supprimez le projet — même si le projet lui-même
  est récupérable pendant 30 jours. Si vous avez personnalisé Loki et que vous
  souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive ou
  un bucket en dehors du projet) avant de supprimer. Pour une installation par
  défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre
propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de
payer est de supprimer le déploiement et de le redéployer lorsque vous en avez
besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau, plus les
  builds — environ 45 crédits (4,50 US$) au total. La suppression ne permet
  d'économiser de l'argent que si Loki reste inutilisé assez longtemps pour
  compenser ce coût de redéploiement par rapport à son propre coût
  d'exécution — environ **4 jours ou plus**, à la fois dans votre propre
  projet (environ 1,34 US$ par jour) et dans un projet géré par RAD (63
  crédits par jour).
- **La majeure partie du coût d'exécution est généralement partagée.** Pour
  Loki, c'est la base de données. Ils ne s'arrêtent que si rien d'autre dans le
  projet ne les utilise, donc la suppression de cette application alors que
  quelque chose d'autre partage le projet n'économise que la partie calcul de
  cette application.
- **Conservez d'abord vos données.** Les sauvegardes nocturnes vont dans un
  bucket à l'intérieur du déploiement et sont supprimées avec lui, alors
  copiez la dernière sauvegarde avant de supprimer si vous voulez la
  conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour
  une classe. Chaque participant obtient l'application dans son propre projet
  Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation
  définie par le formateur. Soit le formateur finance toutes les places, soit
  chaque participant paie la sienne. Tout est supprimé à la fin de la session
  et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire exécute
  l'application pour un client à partir d'un portefeuille cloisonné qu'il
  finance, et règle directement avec le client. Si le portefeuille est faible,
  la facturation est suspendue et les données sont conservées, de sorte que
  personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le
  projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF,
NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud
Billing Catalog ; frais RAD et estimation des crédits quotidiens de
[radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et
restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour les mécanismes de pause/restauration et ce qu'il dit sur les objets Cloud
Storage sans suppression logicielle ; [Grafana Cloud](https://grafana.com/pricing/).
Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Loki s'exécute en tant que pod binaire Go unique, en **mode monolithique**
(`-target=all`, le mode par défaut de Loki, qui exécute chaque composant interne —
distributeur, ingester, querier, compactor — dans un seul processus). Le
déploiement relie un ensemble étroit de services Google Cloud centrés sur GCS :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pod binaire Go, 1 vCPU / 512 Mio par défaut, type de charge de travail `Deployment` |
| Stockage d'objets | Cloud Storage | Un seul bucket `storage` — le véritable backend de stockage d'objets de Loki pour les chunks et l'index TSDB expédié, pas un stockage de fichiers accessoire |
| Secrets | Secret Manager | Aucun généré — `Loki_Common` déclare `secret_ids = {}` |
| Ingress | Cloud Load Balancing | `service_type = "LoadBalancer"` par défaut ; domaine personnalisé optionnel + IP statique |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de base de données, pas de Redis.** L'état durable de Loki (chunks,
  index TSDB) réside entièrement dans un bucket GCS. `database_type = "NONE"` et `enable_redis`
  n'ont aucun effet sur la propre configuration de Loki.
- **`max_instance_count` est effectivement épinglé à `1`.** `Loki_Common`
  remplace `max_instance_count = 1` dans la configuration qu'il transmet à `App_GKE`,
  quelle que soit la valeur transmise. Le compacteur de Loki (rétention/suppression)
  est un véritable singleton et la configuration intégrée utilise un **anneau en
  mémoire** (`common.ring.kvstore.store: inmemory`) avec `replication_factor: 1`, qui ne peut pas se coordonner
  entre plusieurs réplicas.
- **Mono-locataire, pas d'authentification.** La configuration intégrée définit
  `auth_enabled: false`. Il n'y a pas d'isolation par locataire et pas
  d'authentification intégrée — l'API HTTP de Loki est accessible par quiconque
  peut atteindre l'IP du LoadBalancer, sous réserve de la configuration
  `service_type`/ingress.
- **`workload_type = "Deployment"`, pas `"StatefulSet"`.** L'état durable de Loki est GCS, pas un
  disque local, donc un PVC de bloc par pod n'est pas requis pour la
  correction (une option `StatefulSet` existe via `stateful_pvc_enabled` pour la
  durabilité du cache d'index local, mais ce n'est pas la valeur par défaut).
- **`service_type = "LoadBalancer"`** expose Loki en externe par défaut, de sorte que les clients
  d'expédition de logs en dehors du cluster (ou même en dehors du projet)
  peuvent l'atteindre. Définissez `reserve_static_ip = true` (la valeur par défaut) pour une
  adresse stable entre les redéploiements.
- **Piloté par fichier de configuration, pas par variables d'environnement.** Les
  paramètres de stockage/schéma de Loki résident entièrement dans un fichier de
  configuration intégré à l'image ; seul le nom du bucket GCS est templatisé au
  démarrage du pod via la variable d'environnement `LOKI_GCS_BUCKET`.
- **Pas de jobs d'initialisation.** `initialization_jobs` est par défaut `[]` —
  Loki n'a rien à amorcer.
- **Image personnalisée, basée sur distroless.** Voir [§4](#4-loki-application-behaviour)
  et [§7](#7-configuration-pitfalls--sensible-defaults) pour comprendre pourquoi
  le Dockerfile de ce module semble inhabituel.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté `gcloud container clusters get-credentials <cluster> --region <region> --project <project>` et que
`PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les
autres identifiants sont signalés dans les [Sorties](#6-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Loki {#a-gke-autopilot--the-loki-workload}

Loki s'exécute en tant que pod unique sur Autopilot, déployé en tant que
`Deployment` par défaut. Parce que `max_instance_count` est effectivement épinglé à
`1`, cette charge de travail ne se déploie pas horizontalement — son
"mise à l'échelle" concerne réellement le dimensionnement des ressources
(`cpu_limit`, `memory_limit`), et non le nombre de réplicas.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge
  de travail Loki pour les pods, les révisions et les événements. Kubernetes
  Engine → Services et Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle
et du type de charge de travail (Déploiement vs StatefulSet).

### B. Cloud Storage — le backend de stockage d'objets de Loki {#b-cloud-storage--lokis-object-storage-backend}

Un bucket GCS `storage` dédié est le véritable backend de stockage de Loki,
et non un extra optionnel. Loki écrit les chunks de logs compressés et les
shards d'index TSDB expédiés directement dedans via son client de stockage
natif `gcs` (Application Default Credentials — le SA Workload Identity de
GKE se voit accorder `roles/storage.objectAdmin` sur le bucket).

- **Console :** Cloud Storage → Buckets → sélectionnez le bucket `storage`.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
  gcloud storage ls gs://<storage-bucket>/                 # top-level layout
  gcloud storage ls gs://<storage-bucket>/index_*/          # TSDB index shards (schema prefix "index_")
  gcloud storage du -s gs://<storage-bucket>/                # total bytes stored
  ```
  Les objets de chunk et les shards d'index s'accumulent respectivement sous la
  racine du bucket et les préfixes `index_*`, selon le `schema_config`
  intégré à l'image (`schema:
  v13`, `index.prefix: index_`, `index.period: 24h`).

Voir [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse (non
utilisés par le propre chemin de stockage de Loki, qui est un accès API GCS
natif, et non un système de fichiers monté).

### C. Secret Manager {#c-secret-manager}

Aucun secret n'est généré pour Loki — `Loki_Common` déclare `secret_ids = {}` et
`secret_values = {}`. Tous les secrets que vous ajoutez via `secret_environment_variables` sont vos
propres valeurs fournies par l'opérateur (par exemple, si vous mettez Loki en
face d'une couche d'authentification de proxy inverse).

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  ```

### D. Réseau et ingress {#d-networking--ingress}

Par défaut, la charge de travail est exposée via une IP de service
`LoadBalancer` externe (`service_type = "LoadBalancer"`), de sorte que les clients d'expédition
de logs en dehors du cluster peuvent y pousser des logs. Un domaine personnalisé
avec un certificat géré par Google peut être activé, et `reserve_static_ip = true` (la valeur
par défaut) maintient l'adresse stable entre les redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses
  IP.
- **CLI :**
  ```bash
  kubectl get svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés,
Cloud CDN et les IP statiques.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les sorties stdout/stderr des pods (les propres logs de processus de Loki, pas
les logs qu'il *ingère*) sont acheminées vers Cloud Logging ; les métriques GKE
sont acheminées vers Cloud Monitoring.

- **Console :** Logging → Explorateur de logs ; Monitoring → Tableaux de bord /
  Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Interroger Loki {#3-querying-loki}

Ce module déploie Loki **sans interface utilisateur web intégrée** — Loki est
une tête de ligne pour les logs, interrogée via LogQL. Deux façons courantes de
l'interroger une fois déployé :

- **`logcli`** (l'outil CLI officiel de Grafana), pointé vers l'adresse du
  service externe :
  ```bash
  export LOKI_ADDR="http://<external-ip>:3100"
  logcli labels                                             # discover available labels
  logcli query '{job="myapp"}' --limit=50                   # LogQL query
  ```
- **HTTP direct** contre l'API de requête :
  ```bash
  curl -s "http://<external-ip>:3100/loki/api/v1/query?query=%7Bjob%3D%22myapp%22%7D" | jq .
  ```
- **En tant que source de données Grafana** — ajoutez une source de données Loki
  dans Grafana pointant vers l'adresse externe du LoadBalancer ; c'est le
  modèle de production normal pour explorer et créer des tableaux de bord pour
  les logs ingérés.

---

## 4. Comportement de l'application Loki {#4-loki-application-behaviour}

- **Templatisation de la configuration au démarrage du pod, pas de migrations de
  base de données.** `Loki_Common` intègre un modèle de configuration dans
  l'image avec un seul espace réservé, `__LOKI_GCS_BUCKET__`. Le point d'entrée du
  conteneur substitue le nom réel du bucket (injecté comme variable d'env
  `LOKI_GCS_BUCKET`) par `sed` et écrit le résultat dans `/etc/loki/local-config.yaml`
  avant le démarrage de Loki — il n'y a pas d'étape de schéma de premier
  démarrage à attendre.
- **Pas de jobs d'initialisation nécessaires.** Loki n'a pas de base de données
  à amorcer, donc `initialization_jobs` est vide par défaut et ce module n'en injecte
  jamais.
- **Le chemin de santé est `/ready`.** Les sondes de démarrage et de vivacité
  ciblent le point de terminaison de disponibilité intégré et non authentifié
  de Loki, qui renvoie HTTP 200 une fois que le serveur écoute —
  généralement en quelques secondes.
- **Mode monolithique.** `-target=all` exécute chaque composant Loki dans le
  processus unique — la forme appropriée pour un déploiement mono-locataire de
  petite/moyenne taille.
- **Contrainte de mise à l'échelle à instance unique.** L'anneau en mémoire et
  le compacteur singleton signifient que Loki n'est pas conçu pour exécuter
  plus d'une instance simultanément. `Loki_Common` applique cela en épinglant
  `max_instance_count = 1` dans la configuration qu'il transmet à la Fondation, quelle que
  soit la valeur de l'entrée de la plateforme.
- **`workload_type` et durabilité.** `Deployment` est la valeur par défaut et est
  suffisante — l'état durable de Loki est GCS, pas un disque local. Un
  `StatefulSet` avec `stateful_pvc_enabled = true` (monté à `/var/cache/loki`) existe
  comme option pour la durabilité du cache d'index local/du scratch du
  compacteur lors des redémarrages de pod, mais n'est pas requis pour la
  correction.
- **Rétention.** La configuration intégrée définit `limits_config.retention_period: 720h` (30 jours)
  avec le compacteur effectuant la suppression (`retention_enabled: true`, `delete_request_store: gcs`).
- **Inspectez l'environnement du pod en cours d'exécution (par exemple pour
  confirmer que le bucket a bien été injecté) :**
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep LOKI_GCS_BUCKET
  ```

---

## 5. Variables de configuration {#5-configuration-variables}

Les variables sont regroupées exactement telles qu'elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Loki sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut
standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `loki` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | `"latest"` se résout en l'ARG de build `LOKI_VERSION` épinglé (`3.6.12`) — **pas** le générique `APP_VERSION`, que la Fondation forcerait autrement à une balise Loki `latest` non existante. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `min_instance_count` / `max_instance_count` | `1` / `1` | `max_instance_count` est **remplacé par `1` par `Loki_Common` quelle que soit cette valeur** — voir [§1](#1-overview). |
| `container_port` | `3100` | Port d'écoute HTTP de Loki — fixé par la configuration intégrée (`server.http_listen_port`). Modifier cela sans modifier également le modèle de configuration rompra le déploiement. |
| `container_resources` | `{ cpu_limit="1000m", memory_limit="512Mi" }` | Augmenter la mémoire pour les ensembles de labels à haute cardinalité ou une charge de requête élevée. |
| `enable_cloudsql_volume` | `false` | Désactivé — Loki n'a pas de base de données. |

### Groupe 6 — Cluster GKE {#group-6--gke-cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | L'exposition externe est la valeur par défaut — requise pour les clients d'expédition de logs en dehors du cluster. |
| `workload_type` | `Deployment` | Suffisant puisque l'état durable de Loki est GCS, pas un disque local. |
| `session_affinity` | `None` | Aucune persistance de pod nécessaire à l'échelle par défaut à réplica unique. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` (désactivé) | Optionnel : passer à un PVC de bloc par pod (monté à `/var/cache/loki`) pour la durabilité du cache d'index local lors des redémarrages. Non requis — l'état durable de Loki est GCS. |

### Groupe 11 — Automatisation de la charge de travail {#group-11--workload-automation}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Loki n'a pas besoin de job d'initialisation. |

### Groupe 14 — Cloud Storage {#group-14--cloud-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `storage_buckets` | `[]` | Buckets supplémentaires au-delà du bucket `storage` auto-provisionné que Loki utilise réellement pour les chunks/index. |

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Loki n'a pas d'utilisation intégrée pour Redis ; cela n'existe que pour la complétude de la mise en miroir de la Fondation. |

### Groupe 16 — Configuration de la base de données {#group-16--database-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixe — le stockage durable de Loki est le bucket GCS, pas Cloud SQL. Toutes les autres variables de base de données du Groupe 16 sont inertes. |

### Groupe 19 — Domaine personnalisé et réseau {#group-19--custom-domain--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `reserve_static_ip` | `true` | Maintient l'adresse du LoadBalancer stable entre les redéploiements — recommandé lorsque les clients externes codent en dur le point de terminaison de push de Loki. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

---

## 6. Sorties {#6-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `api_url` | URL pour atteindre Loki. |
| `storage_buckets` | Buckets de stockage créés — inclut le bucket `storage` que Loki utilise pour les chunks et l'index TSDB. |
| `database_instance_name` / `database_name` / `database_user` / `database_password_secret` | Toujours vide — `database_type = "NONE"`. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `monitoring_enabled` / `monitoring_notification_channels` | Statut et canaux de surveillance. |
| `initialization_jobs` | Toujours vide — Loki n'a pas besoin de job d'initialisation. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `cicd_enabled` / `cicd_configuration` | Statut et détails CI/CD. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | Statut VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et statut CMEK. |

---

## 7. Pièges de configuration et valeurs par défaut judicieuses {#7-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration via le moteur de la fondation [App_GKE](App_GKE.md), qui valide
> les valeurs *et les combinaisons* au moment de la planification. Une
> configuration invalide échoue à la **planification** avec une erreur claire
> et nommée avant la création de toute ressource, de sorte que la plupart des
> erreurs ci-dessous sont détectées en amont plutôt qu'à l'application ou à
> l'exécution.

> **Note pour les opérateurs/mainteneurs : pourquoi le Dockerfile de ce module
> semble inhabituel.** L'image officielle `grafana/loki` est **véritablement
> distroless** — l'inspection de son système de fichiers ne montre que
> `/usr/bin/loki`, sans shell, sans coreutils, et sans aucun lieur dynamique. Un
> modèle de Dockerfile standard (`RUN chmod +x
> /entrypoint.sh`) échoue carrément au moment de
> la construction (`exec: /bin/sh: no such file or
> directory`) car `RUN` a besoin d'un shell. La
> première tentative de correction — greffer un binaire busybox de la balise
> `busybox:stable` par défaut via un `COPY` multi-étapes — *a également*
> échoué, avec l'erreur plus confuse `exec /bin/busybox: no such file or
> directory`, car le binaire de
> `busybox:stable` est **lié dynamiquement** et la cible distroless n'a pas de
> lieur dynamique pour le satisfaire. La solution a été de passer à
> `busybox:musl`, vérifié via `file` comme étant véritablement **lié
> statiquement** (aucun interpréteur nécessaire) : `FROM busybox:musl AS busybox` dans une étape
> de construction uniquement, `COPY
> --from=busybox /bin/busybox /bin/busybox` dans l'image finale basée sur
> distroless, et `ENTRYPOINT ["/bin/busybox", "sh", "/entrypoint.sh"]` (busybox invoqué directement par chemin absolu —
> aucun lien symbolique d'applet n'existe, donc même le script d'entrée appelle
> `/bin/busybox sed ...` plutôt qu'un simple `sed`). Si vous touchez un jour à
> ce Dockerfile, ou le clonez pour une autre application basée sur distroless
> sur GKE, rappelez-vous : **vérifiez qu'une balise busybox greffée est
> véritablement statique** (`file
> <binary>` ne doit pas afficher
> `interpreter` / lié dynamiquement) avant de supposer qu'elle s'exécutera
> dans une cible distroless.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `max_instance_count` | Laisser par défaut (effectivement épinglé à `1`) | Critique | Même si `Loki_Common` remplace cela par `1` dans la configuration qu'il transmet à la Fondation, ne comptez pas sur la mise à l'échelle horizontale de Loki dans cette forme de déploiement — l'anneau en mémoire et le compacteur singleton ne sont pas conçus pour des réplicas concurrents. |
| `container_port` | `3100` (ne pas modifier sans également éditer le modèle de configuration) | Critique | Le `server.http_listen_port` de Loki est intégré au fichier de configuration, et non lu à partir de `container_port` à l'exécution — une non-concordance rompt le routage entre le service Kubernetes et le pod. |
| `service_type` | `LoadBalancer` pour l'expédition de logs externes | Élevé | La définition de `ClusterIP` rend Loki accessible uniquement depuis l'intérieur du cluster, bloquant les agents Promtail/Alloy s'exécutant ailleurs. |
| Contrôle d'accès | Aucun par défaut (`auth_enabled: false`) | Élevé | L'API HTTP de Loki (push et query) n'a pas d'authentification intégrée. Quiconque peut atteindre l'IP externe peut pousser ou interroger des logs. Protégez-le avec Cloud Armor, IAP, ou une couche d'authentification de proxy inverse si cela est important pour votre déploiement. |
| `application_version` | Épingler une balise explicite (par exemple `3.6.12`) pour la production | Moyen | `"latest"` se résout silencieusement à la balise que le Dockerfile de `Loki_Common` épingle actuellement, ce qui ne change que lorsque la source du module change. |
| `container_resources.memory_limit` | Augmenter au-dessus de `512Mi` pour les labels à haute cardinalité ou une charge de requête élevée | Moyen | Le moteur de requête de Loki et le cache d'index en mémoire peuvent manquer de mémoire sous charge avec la valeur par défaut conservatrice. |
| `reserve_static_ip` | `true` | Moyen | Avec `false`, l'IP externe peut changer lors du redéploiement et (selon la découverte GKE à l'échelle de la flotte documentée pour d'autres modules) les valeurs auto-référentielles de type `GKE_SERVICE_URL` peuvent revenir à un nom DNS interne inaccessible si elles sont calculées avant que l'IP éphémère du LoadBalancer ne soit connue. |
| `database_type` | Laisser à `NONE` | Faible | La définition de toute autre valeur n'a aucun effet — `Loki_Common` ne connecte jamais une connexion de base de données à la configuration de Loki, quoi qu'il arrive. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Loki
partagée avec la variante Cloud Run est décrite dans
**[Loki_Common](Loki_Common.md)**.

## Guides associés {#related-guides}

- [Lab pratique : Loki sur GKE Autopilot](../labs/Loki_GKE.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [Loki sur Google Cloud Run](Loki_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Loki Common — Configuration d'application partagée](Loki_Common.md) — la configuration partagée par les deux cibles de déploiement.
