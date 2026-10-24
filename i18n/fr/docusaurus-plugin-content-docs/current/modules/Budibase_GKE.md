---
title: "Budibase sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Budibase sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Budibase_GKE.md @ e69407af sha256:42f58442a152 -->

# Budibase sur GKE Autopilot {#budibase-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Budibase_GKE.png" alt="Budibase sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Budibase est une plateforme low-code open source pour la création d'outils
internes, d'applications métier et de workflows basés sur vos données. Ce module
déploie Budibase sur **GKE Autopilot** sur la base de la fondation
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée de
Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Budibase et sur la
manière de les explorer et de les exploiter à partir de la console Google Cloud
et de la ligne de commande. Pour les mécanismes communs à toutes les
applications GKE — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## Ce que coûte Budibase sur RAD, et comment cela se compare {#what-budibase-costs-on-rad-and-how-that-compares}

**Le module Budibase sur GKE Autopilot de RAD coûte environ 85 US$ par mois dans votre propre projet Google Cloud, sans frais de licence supplémentaires** — Budibase est open source. Dans un projet géré par RAD pour vous, le même déploiement est facturé à **83 crédits par jour** (environ 2 490 par mois, soit environ 249 US$ au prix de la recharge). Ou consultez le [guide Cloud Run](Budibase_CloudRun.md) pour l'option à moindre coût. Si vous n'avez besoin de Budibase qu'occasionnellement — pour des études, une démo, un projet de courte durée — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour quelques crédits, de sorte que ce chiffre mensuel devient quelques dollars à la place. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

Budibase est open source, il n'y a donc pas de frais de licence. Vous payez pour trois choses :

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 110 crédits (11 US$ au prix de la recharge) | 99 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build (environ 3 à 6 crédits) | Idem |
| Coût de fonctionnement Google Cloud | Facturé par Google à votre propre compte de facturation, environ **85 US$ par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré toutes les heures en crédits ; RAD publie **83 crédits par jour**, environ 2 490 par mois (environ 249 US$ au prix de la recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde acheté minimum est conservé en réserve |

10 crédits coûtent 1 US$ en recharge unique, et moins avec un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût de fonctionnement par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Pod GKE Autopilot, 2x vCPU / 4 Gio | 79,35 US$ |
| Cloud NAT et réseau | 5 US$ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 US$ |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 |
| **Total (hors frais de cluster GKE partagé)** | **environ 85 US$** |

Ces prix sont les mêmes en africa-south1 (Johannesburg).

- **GKE Autopilot ne se met pas à l'échelle à zéro.** Au moins un pod est toujours en cours d'exécution, de sorte que le coût ci-dessus s'applique que quelqu'un utilise ou non l'application ; des pods supplémentaires ne sont ajoutés qu'en cas de charge.

### Comment cela se compare {#how-it-compares}

L'équipe de Budibase vend un **Budibase Cloud** hébergé :

| Plan | Par mois | Notes |
|---|---|---|
| Pro | 19 US$ | Plan cloud d'entrée de gamme |
| Premium | 49 US$ | Plus de créateurs, crédits IA, rétention des logs |
| Business | 299 US$ | Limites plus élevées, plus d'espaces de travail |
| Enterprise | Personnalisé | Contacter les ventes |

Budibase Cloud facture par niveau de plan (créateurs, crédits IA, espaces de travail), et non par la puissance de calcul réellement utilisée par cette application, ce n'est donc pas une comparaison directe avec le tableau ci-dessus — c'est l'alternative officielle si vous préférez ne pas gérer d'infrastructure du tout. Le module de RAD exécute le même Budibase open source sur une infrastructure que vous pouvez voir et qui s'adapte à votre propre utilisation plutôt qu'aux limites de sièges/créateurs d'un plan.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Budibase s'exécute dans **un projet géré par RAD pour vous**, la suppression de l'ensemble du projet — plutôt que la suppression de ce seul module — délie d'abord sa facturation, puis demande à Google de supprimer complètement le projet. Google le conserve, récupérable, pendant 30 jours, et comme la facturation est déjà déliée, rien n'est facturé pendant cette attente. Contrairement à la suppression d'un seul module, cela ne supprime pas Cloud SQL, aucune VM ou la ressource de calcul une par une : l'ensemble du projet s'arrête simplement.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **La restauration est une vérification, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet peut demander à Google de restaurer le projet et de rattacher son compte de facturation, puis d'exécuter **Update** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes, et une mise à jour ne facture jamais les frais de module à nouveau. Pour une chaîne de déploiement typique de 2 à 3 déploiements, cela ne coûte qu'une poignée de crédits au total (environ 5 à 10 crédits, moins de 1 US$).
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un projet dont RAD gère uniquement la facturation), le restaurer vous-même dans les 30 jours — après quoi Google le supprime définitivement — et atteindre à nouveau le seuil d'admission du niveau (100 crédits pour le niveau sandbox qui convient à la plupart des utilisations d'étude/démo). Google indique que la plupart des services sont de nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.
- **Une lacune réelle : les sauvegardes nocturnes ne survivent pas.** Les sauvegardes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud Storage désactivée, il est donc très probable qu'il disparaisse dès que le projet est supprimé — même si le projet lui-même est récupérable pendant 30 jours. Copiez une sauvegarde (vers Google Drive, ou un bucket en dehors du projet) avant de la supprimer s'il y a quelque chose d'important à conserver ; pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

Source : [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects).

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que la fenêtre de restauration de 30 jours ci-dessus est passée, la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer lorsque vous en avez besoin.

- **Ce que coûte un redéploiement.** Les frais de module à nouveau, plus les builds : environ 114 crédits (environ 11,40 US$) au prix de la recharge, et environ 15 à 20 minutes de temps de build (moyenne de la plateforme RAD). La suppression ne permet d'économiser de l'argent que si Budibase devait rester inutilisé pendant environ **3 jours ou plus** — dans votre propre projet, cela représente environ 2,84 US$ par jour, et dans un projet géré par RAD, c'est 83 crédits par jour.
- La majeure partie du coût de fonctionnement ici est généralement la base de données et/ou la VM ou le cluster de fichiers/cache partagé. Ils ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc la suppression de Budibase alors qu'une autre application partage le projet n'économise que la partie calcul de Budibase.
- **Conservez les données en premier.** Les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui, alors copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant dispose de l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits non utilisés sont restitués au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais RAD et estimation des crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour la fenêtre de pause/restauration et la mise en garde sur le bucket de sauvegarde ; [Tarification Budibase Cloud](https://budibase.com/pricing/) ; les prix changent, vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Budibase s'exécute en tant que pod **tout-en-un** unique. L'image officielle `budibase/budibase`
regroupe **CouchDB + MinIO + Redis** et les applications/worker/proxy Budibase
ensemble et sert HTTP sur le **port 80** — il n'y a pas de base de données gérée
externe. Étant donné que tout l'état réside sur `/data`, la variante GKE s'exécute
en tant que **StatefulSet** avec un PVC de bloc monté à `/data`. Le déploiement
connecte un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pod tout-en-un unique, 2 vCPU / 4 Gio par défaut ; s'exécute en tant que **une** réplique (min = max = 1) |
| État persistant | Disque persistant (PVC de bloc) | `stateful_pvc_enabled = true` → StatefulSet avec un PVC de 20 Gio monté à `/data` |
| Base de données | Aucune (CouchDB intégré) | `database_type = "NONE"` — CouchDB, MinIO et Redis s'exécutent tous à l'intérieur du pod |
| Stockage d'objets | Cloud Storage | Un bucket de données provisionné automatiquement ; le propre magasin d'actifs de Budibase est le MinIO intégré |
| Cache et file d'attente | Redis intégré | S'exécute à l'intérieur du pod sur la boucle locale ; `enable_redis` est désactivé par défaut |
| Secrets | Secret Manager | Sept identifiants internes auto-générés injectés en tant que variables d'environnement de secret de service |
| Ingress | Cloud Load Balancing | Service LoadBalancer externe par défaut ; domaine personnalisé facultatif + certificat géré |

**Valeurs par défaut judicieuses à connaître à l'avance :**

- **StatefulSet avec un PVC de bloc sur `/data`.** `stateful_pvc_enabled = true` (par défaut),
  qui résout automatiquement `workload_type` en `StatefulSet`. Tous les documents CouchDB et
  objets MinIO persistent sur un PVC `standard-rwo` de 20 Gio monté à `/data`, de sorte que les données
  survivent aux redémarrages et redéploiements de pods.
- **S'exécute en tant que réplique unique.** `min_instance_count = 1` et `max_instance_count = 1`.
  Le pod tout-en-un contient tout l'état sur son propre PVC, de sorte que plusieurs répliques ne
  partageraient pas les données (split-brain).
- **Sept identifiants internes sont générés automatiquement** et stockés dans Secret
  Manager (`INTERNAL_API_KEY`, `JWT_SECRET`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`,
  `API_ENCRYPTION_KEY`, `REDIS_PASSWORD`, `COUCH_DB_PASSWORD`). Ceux-ci ne doivent jamais être
  tournés après le premier démarrage — les données sur `/data` sont chiffrées avec eux et deviennent
  illisibles s'ils changent.
- **Le port 80 est fixe.** Le proxy nginx de l'image tout-en-un sert toute l'application sur
  le port 80, donc `container_port` et les sondes de pod sont épinglées à 80.
- **Pas de base de données externe ni de job `db-init`.** Budibase auto-provisionne CouchDB et
  MinIO au premier démarrage ; `database_type` par défaut à `NONE`.
- **LoadBalancer externe par défaut.** `service_type = "LoadBalancer"` expose une
  adresse IP externe ; une adresse IP statique et un domaine personnalisé peuvent être ajoutés.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Budibase {#a-gke-autopilot--the-budibase-workload}

Budibase s'exécute en tant que pod **StatefulSet** sur Autopilot, qui facture le CPU/la mémoire
demandés par le pod. Comme il conserve tout l'état sur son PVC, il s'exécute en tant que réplique unique.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail Budibase pour voir
  le pod, les révisions et les événements. Kubernetes Engine → Services et Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get statefulset,pods,svc,pvc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de charge de travail
(Déploiement vs StatefulSet).

### B. État persistant (PVC de bloc sur `/data`) {#b-persistent-state-block-pvc-on-data}

Tout l'état de Budibase — le magasin de documents CouchDB intégré et le magasin d'objets MinIO —
persiste sur un **disque persistant de bloc** provisionné via le modèle de PVC StatefulSet
(`stateful_pvc_size = 20Gi`, `stateful_pvc_storage_class = standard-rwo`) et monté
à `/data`. C'est ce qui fait de GKE la plateforme Budibase durable.

- **Console :** Kubernetes Engine → Stockage → Revendications de volume persistant ; Compute
  Engine → Disques.
- **CLI :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE" <pvc-name>
  # Confirm the /data mount inside the pod:
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- df -h /data
  ```

### C. Magasin de données (CouchDB + MinIO intégrés) {#c-data-store-bundled-couchdb--minio}

Il n'y a **pas d'instance Cloud SQL** — `database_type = "NONE"`. CouchDB et MinIO s'exécutent
**à l'intérieur du pod** et persistent sur le PVC `/data`. Inspectez-les via le pod plutôt
qu'une console de base de données gérée :

- **CLI :**
  ```bash
  # Confirm database_type=NONE and the bundled-service env in the running pod:
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- env | grep -Ei 'couch|minio|redis'
  ```

### D. Cloud Storage {#d-cloud-storage}

Un bucket **Cloud Storage** dédié (suffixe de nom `storage`) est provisionné
automatiquement. Le propre magasin d'actifs/pièces jointes de Budibase est le MinIO intégré sur `/data` ;
ce bucket GCS est disponible pour l'intégration de stockage au niveau de la fondation.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### E. Redis (intégré) {#e-redis-bundled}

Redis s'exécute **à l'intérieur du pod** sur la boucle locale, authentifié avec le
`REDIS_PASSWORD` auto-généré. `enable_redis` est **désactivé par défaut** — n'activez pas un Redis externe
sauf si vous externalisez délibérément le cache.

- **CLI :**
  ```bash
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- env | grep -i redis
  ```

### F. Secret Manager {#f-secret-manager}

Sept identifiants internes sont générés automatiquement et stockés dans Secret Manager,
puis injectés en tant que variables d'environnement de secret de service : `INTERNAL_API_KEY`, `JWT_SECRET`,
`MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `API_ENCRYPTION_KEY`, `REDIS_PASSWORD`, et
`COUCH_DB_PASSWORD`. Ils ne doivent jamais être renouvelés après le premier démarrage.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~budibase"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration CSI de Secret Store et
[Budibase_Common](Budibase_Common.md) pour ce que chaque secret protège.

### G. Réseau et ingress {#g-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe de Cloud Load Balancing
(`service_type = "LoadBalancer"`). Un domaine personnalisé avec un certificat géré par Google
peut être activé, et une adresse IP statique peut être réservée afin que l'adresse survive aux redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails de l'adresse IP statique.

### H. Cloud Logging et Monitoring {#h-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les métriques GKE sont acheminées vers Cloud Monitoring.
Des vérifications de disponibilité et des politiques d'alerte facultatives sont disponibles.

- **Console :** Logging → Explorateur de logs ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Budibase {#3-budibase-application-behaviour}

- **Pas de bootstrap de base de données externe.** Avec `database_type = "NONE"`, il n'y a pas de
  job `db-init`. Budibase auto-provisionne son CouchDB et MinIO intégrés au premier démarrage
  à l'intérieur du pod. Seuls les `initialization_jobs` fournis par l'utilisateur sont honorés.
- **L'état persiste sur le PVC `/data`.** Les documents CouchDB et les objets MinIO sont
  écrits sur le PVC de bloc monté à `/data`, de sorte que les données survivent aux redémarrages,
  aux replanifications et aux mises à niveau de version des pods. Dimensionnez généreusement le PVC
  (`stateful_pvc_size = 20Gi` par défaut) — il augmente avec les données et les pièces jointes de l'application.
- **Les identifiants internes sont immuables après le premier démarrage.** Les sept secrets générés
  chiffrent les données sur `/data`. La modification de `API_ENCRYPTION_KEY` corrompt toutes
  les données chiffrées stockées ; la modification de `JWT_SECRET` invalide toutes les sessions ; la modification des
  identifiants MinIO ou CouchDB rompt l'accès aux magasins d'objets/documents sur le PVC.
  Ne les renouvelez que lors d'une réinitialisation planifiée.
- **Configuration initiale.** Budibase auto-hébergé est livré **sans compte administrateur par défaut**.
  Accédez à l'URL du LoadBalancer après le déploiement et créez l'administrateur initial
  (e-mail + mot de passe) via l'écran de configuration avant utilisation.
- **Chemin de santé.** La sonde de démarrage cible `/` ; la sonde de vivacité — qui est également
  répliquée dans la vérification de santé de la passerelle — cible `/builder`, car `/` répond avec une
  redirection et la vérification du backend de l'équilibreur de charge nécessite un `200` littéral. `/builder` est
  servi par le même amont que le trafic utilisateur réel (contrairement à `/health`, qui répond
  du processus worker même lorsque le serveur d'applications est en panne). Prévoyez jusqu'à ~8-9 minutes au
  premier démarrage (la sonde de démarrage utilise un délai initial de 60 secondes plus une fenêtre de 30 tentatives
  avec une période de 15 secondes) — le pod doit démarrer CouchDB, MinIO, Redis et la couche d'application.
- **StatefulSet à réplique unique.** Conservez `min_instance_count = max_instance_count = 1` ;
  le magasin de données est lié à un seul PVC et ne peut pas être partagé entre les répliques.
- **Vérifier la charge de travail en cours d'exécution :**
  ```bash
  kubectl get statefulset,pods,pvc -n "$NAMESPACE"
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- curl -s -o /dev/null -w '%{http_code}' localhost:80/
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls
les paramètres spécifiques ou notables pour Budibase sont listés ; toutes les autres entrées sont
héritées de [App_GKE](App_GKE.md) avec son comportement standard et ses valeurs par défaut.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `budibase` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `3.39.29` | Tag de l'image Budibase ; utilisé comme `FROM budibase/budibase:<tag>` pour le build de l'enveloppe légère. Incrémenter pour déclencher un nouveau build. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_port` | `80` | Le proxy nginx de l'image tout-en-un sert toute l'application sur le port 80 — le container_port et les sondes doivent être 80. |
| `container_resources` | `2000m` / `4Gi` | CPU et mémoire par pod ; le CouchDB/MinIO/Redis intégré + la couche d'application nécessitent une mémoire généreuse. |
| `min_instance_count` | `1` | Garder à 1 — le magasin de données est lié à un seul PVC. |
| `max_instance_count` | `1` | Garder à 1 — les répliques ne partageraient pas `/data`. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 6 — Backend et cluster GKE {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Expose une adresse IP externe pour l'interface utilisateur. |
| `workload_type` | `null` → `StatefulSet` | Se résout automatiquement en `StatefulSet` car `stateful_pvc_enabled = true`. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | **Doit rester vrai.** Budibase conserve tout l'état sur `/data` ; un PVC de bloc y est monté. |
| `stateful_pvc_size` | `20Gi` | Taille du PVC par pod ; augmente avec les données et les pièces jointes de l'application — dimensionnez généreusement. |
| `stateful_pvc_mount_path` | `/data` | Où le PVC est monté — répertoire de données CouchDB + MinIO de Budibase. |
| `stateful_pvc_storage_class` | `standard-rwo` | StorageClass de bloc pour le PVC. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 15 — Cache et file d'attente Redis {#group-15--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Redis s'exécute à l'intérieur du pod ; laissez désactivé sauf si vous externalisez le cache. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Utilisé uniquement si un Redis externe est activé. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Budibase intègre son propre CouchDB ; aucune base de données gérée externe n'est provisionnée. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

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
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Budibase. |
| `database_instance_name` / `database_name` / `database_user` | Rempli uniquement si une base de données gérée est utilisée ; vide pour Budibase (`database_type = NONE`). |
| `database_password_secret` / `database_host` / `database_port` | Secret / point de terminaison / port de la base de données (non utilisé pour Budibase). |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'importation (facultatifs) fournis par l'utilisateur. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
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

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur de fondation [App_GKE](App_GKE.md), qui valide les valeurs *et les combinaisons* au moment de la planification — un `workload_type = "Deployment"` à côté de `stateful_pvc_enabled = true`, `quota_memory_*` sans suffixes d'unité binaire, un `container_port` hors de portée, un `database_type` qui ne correspond pas à une extension activée, un `redis_port`/`backup_retention_days` hors de portée. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant qu'aucune ressource ne soit créée, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'au moment de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `stateful_pvc_enabled` | `true` | Critique | Si c'est faux, Budibase n'a pas de `/data` durable — tout l'état de CouchDB + MinIO est perdu lors de tout redémarrage/replanification de pod. |
| `API_ENCRYPTION_KEY` (auto-généré) | Ne jamais renouveler après le premier démarrage | Critique | Le renouveler corrompt toutes les données chiffrées stockées — elles ne peuvent pas être déchiffrées. |
| `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` / `COUCH_DB_PASSWORD` (auto-généré) | Ne jamais renouveler après le premier démarrage | Critique | Le renouveler rompt l'accès aux magasins d'objets/documents intégrés sur le PVC `/data`. |
| `max_instance_count` | `1` | Critique | Plus d'une réplique ne peut pas partager le PVC `/data` unique — split-brain et perte de données. |
| `JWT_SECRET` (auto-généré) | Ne renouveler que pendant une fenêtre de maintenance | Élevé | Le renouveler invalide toutes les sessions utilisateur actives, forçant une reconnexion immédiate. |
| `workload_type` | `null` (auto → StatefulSet) | Élevé | Forcer `Deployment` avec `stateful_pvc_enabled = true` fait échouer le plan ; un déploiement ne peut pas créer de modèles de PVC par pod. |
| `container_port` | `80` | Élevé | Le proxy nginx sert l'application sur le port 80 ; tout autre port fait échouer les sondes et le pod ne devient jamais prêt. |
| `database_type` | `NONE` | Élevé | La sélection d'un moteur externe provisionne une instance Cloud SQL inutilisée ; Budibase ne s'y connecte jamais. |
| `memory_limit` | `4Gi` | Élevé | L'exécution de CouchDB + MinIO + Redis + la couche d'application en dessous de ~2 Gio provoque des arrêts OOM au démarrage. |
| `stateful_pvc_size` | `20Gi`+ | Moyen | Un sous-dimensionnement risque de remplir le PVC à mesure que les données/pièces jointes de l'application augmentent, bloquant les écritures CouchDB/MinIO. |
| Premier compte administrateur | Créer immédiatement après le déploiement | Élevé | Budibase auto-hébergé est livré sans administrateur par défaut — une instance non réclamée peut être réclamée par quiconque accède à l'URL. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers nus sont des octets et bloquent toute planification de pod dans l'espace de noms. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**.
La configuration d'application spécifique à Budibase partagée avec la variante Cloud Run est
décrite dans **[Budibase_Common](Budibase_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Budibase sur GKE Autopilot](../labs/Budibase_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Budibase sur Google Cloud Run](Budibase_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Budibase Common — Configuration d'application partagée](Budibase_Common.md) — la configuration partagée par les deux cibles de déploiement.
