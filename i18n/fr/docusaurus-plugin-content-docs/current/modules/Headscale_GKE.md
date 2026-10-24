---
title: "Headscale sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Headscale sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Headscale_GKE.md @ 1665a43e sha256:c743610de167 -->

# Headscale sur GKE Autopilot {#headscale-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Headscale_GKE.png" alt="Headscale sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Headscale est une implémentation open source et auto-hébergée du serveur de
coordination Tailscale — un plan de contrôle pour un VPN maillé WireGuard
privé, compatible avec les clients Tailscale officiels. Headscale n'est **pas**
une passerelle ou un relais VPN en soi : il authentifie les nœuds, distribue
la clé publique et l'allocation IP de chaque pair, et maintient la carte
réseau du maillage synchronisée. Le trafic chiffré réel entre les appareils
circule directement, de pair à pair, via WireGuard (ou via l'infrastructure
de relais DERP publique de Tailscale). Ce module déploie Headscale sur
**GKE Autopilot** au-dessus de la fondation [App_GKE](App_GKE.md), qui
provisionne et gère l'infrastructure partagée Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Headscale et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE
— Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et le cycle de vie du
déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## Ce que coûte Headscale sur RAD, et comment cela se compare {#what-headscale-costs-on-rad-and-how-that-compares}

**L'exécution d'un pod Headscale sur GKE Autopilot dans votre propre projet Google Cloud coûte environ 42,08 $/mois en frais Google Cloud**, en plus d'un frais de module RAD unique de 75 crédits facturé une fois au moment du déploiement. Headscale est une réimplémentation open source et indépendante d'un serveur de coordination WireGuard privé, compatible avec les clients Tailscale officiels — ce n'est pas une version hébergée d'un produit commercial, il n'y a donc pas de prix SaaS à comparer. Dans un projet géré par RAD, les frais de module tombent à 67,5 crédits (10 % de moins) et le coût d'exécution est mesuré à l'heure en crédits au lieu d'être facturé directement par Google — voir [Mettez-le en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) ci-dessous pour l'avantage unique d'un projet géré par RAD qu'un VPS auto-hébergé ne peut égaler — ou voir le [guide Cloud Run](Headscale_CloudRun.md) pour l'option à moindre coût.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module (unique) | 75 crédits | 67,5 crédits (10 % de moins) |
| Temps de build | ~3-6 crédits par build, dans les deux cas | ~3-6 crédits par build, dans les deux cas |
| Coût d'exécution Google Cloud | 42,08 $/mois, facturé par Google au prix catalogue | ~67 crédits/jour, mesuré au prix catalogue plus la marge de RAD |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Pod GKE Autopilot, 1x vCPU / 1 GiB | 36,08 $ |
| Cloud NAT et réseau | 5,00 $ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 $ |
| **Total** | **42,08 $** |

*Les frais de gestion de cluster GKE sont exclus du total ci-dessus car ils sont partagés entre toutes les applications GKE du projet — 0 $ si c'est le seul, sinon environ 73 $/mois répartis entre le nombre d'applications que vous exécutez.*

### Comment cela se compare {#how-it-compares}

- Une comparaison auto-gérée : Hetzner CPX22 (2 vCPU/4 Go) coûte environ 24 $/mois, un Droplet DigitalOcean 2 vCPU/4 Go coûte le même 24 $/mois, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) coûte environ 49 $/mois — plus que ce dont ce serveur de coordination léger de 1 vCPU/1 GiB a besoin, mais le point de référence le plus petit et le plus souvent cité.
- Headscale n'a pas besoin de sa propre base de données dans ce déploiement (il utilise SQLite en interne), donc la majeure partie de son coût d'exécution dans son propre projet ci-dessus est le petit serveur de fichiers NFS, et non une instance Postgres gérée.
- Le compromis administratif est le même que pour chaque entrée ici : un VPS moins cher, auto-patché, contre le serveur de fichiers géré par RAD, Secret Manager et la surveillance.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

C'est l'avantage principal d'un projet géré par RAD, et il ne coûte rien pendant la pause.
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
jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits (moins de 1 $ US) au total pour une chaîne
typique de 2-3 déploiements.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet pour lequel RAD ne gère que la facturation), vous devez
le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est
admise comme la création d'un nouveau projet, donc votre solde de crédits achetés doit toujours dépasser le
seuil du palier (100 crédits pour le palier sandbox que la plupart des utilisations d'étude/démo conviennent). Google affirme que la plupart
des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a
la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous
supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez
personnalisé Headscale et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive, ou un bucket
en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable,
cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre façon : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que 30 jours se sont écoulés sur un projet géré par RAD, il n'y a pas de pause gratuite —
la suppression supprime définitivement les ressources, et la remise en service de Headscale signifie un redéploiement à partir
de zéro. Cela coûte environ 78-81 crédits (les frais de module de 75 crédits plus un build).

La suppression ne permet d'économiser de l'argent que si Headscale reste inutilisé assez longtemps pour compenser ce
coût de redéploiement par rapport à son propre coût d'exécution — pour Headscale, c'est environ 6 jours ou
plus. La majeure partie de ce coût d'exécution est généralement la base de données (et, lorsque ce module en utilise une, le serveur de fichiers partagé VM ou le cluster GKE) — ceux-ci ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc la suppression de cette application pendant que quelque chose d'autre partage le projet n'économise que sa propre part de calcul.

Gardez les données en premier : les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui,
donc copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de labo et environnements gérés {#lab-sessions-and-managed-environments}

Sessions de labo, pour la formation : un formateur anime une session pour une classe. Chaque participant dispose de
l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par
le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne.
Tout est supprimé à la fin de la session et les crédits non utilisés sont reversés au formateur.

Environnements gérés, pour les cabinets de conseil : un partenaire exécute l'application pour un client à partir d'un
portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible,
la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le
partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR,
par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les propres frais de RAD et les estimations de crédits quotidiens ; [documentation de Google sur la suppression/restauration de projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les affirmations de pause/restauration.

## 1. Vue d'ensemble {#1-overview}

Headscale s'exécute comme un pod binaire Go unique sur GKE Autopilot, construit à partir d'une
image amont personnalisée basée sur `ko`. Le déploiement relie un ensemble ciblé
de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot, StatefulSet | Charge de travail Go, 1 vCPU / 1 GiB par défaut ; épinglé à un seul réplica |
| Base de données | SQLite intégré | Pas d'instance Cloud SQL — `database_type = "NONE"` |
| Persistance | **PVC de stockage par blocs réel** (par défaut) | `stateful_pvc_enabled = true` par défaut — `/var/lib/headscale` sur `pd-standard` HDD, pas GCS Fuse |
| Secrets | Secret Manager | Aucun — Headscale n'a pas de secrets au niveau de l'application dans ce module |
| Ingress | Cloud Load Balancing / Gateway API | IP statique externe + domaine personnalisé par défaut (`reserve_static_ip = true`, `enable_custom_domain = true`) |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **SQLite est la seule base de données prise en charge.** Il n'y a pas d'instance Cloud SQL
  externe ; tout l'état (registre des nœuds, clés de pré-authentification, clé privée du
  protocole Noise) réside dans un seul fichier SQLite sous `/var/lib/headscale`.
- **StatefulSet + PVC de bloc réel est la disposition par défaut, pas une option.**
  `stateful_pvc_enabled = true` par défaut exécute Headscale en tant que StatefulSet
  avec un PVC par pod — c'est la variante de plateforme qui résout réellement le
  problème de verrouillage de fichier SQLite que Cloud Run ne peut pas résoudre. `stateful_pvc_storage_class`
  par défaut à `standard` (HDD `pd-standard`, pas SSD) car les fichiers de Headscale
  sont petits et n'ont pas besoin d'IOPS élevés.
- **`max_instance_count` est codé en dur à `1` en aval, pas seulement par défaut.**
  `Headscale_Common` définit `config.max_instance_count = 1` comme une valeur littérale
  quelle que soit la valeur de la variable de ce module. Headscale n'a pas
  de support actif-actif.
- **La mise à l'échelle à zéro est activée par défaut** (`min_instance_count = 0`).
- **Un point d'entrée public stable est plus important ici que pour la plupart des applications.**
  `reserve_static_ip = true` et `enable_custom_domain = true` sont tous deux
  des valeurs par défaut — chaque appareil enregistré sur ce serveur a besoin d'une URL durable,
  pas seulement d'une session de navigateur.
- **MagicDNS est désactivé par défaut.** Il nécessite que `dns.base_domain` soit défini et
  réellement différent du domaine de `server_url`.
- **Pas de job d'initialisation par défaut.** Le fichier SQLite de Headscale est créé
  automatiquement au premier démarrage.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont signalés dans les [Sorties](#6-outputs) du déploiement.

### A. GKE Autopilot — le StatefulSet Headscale {#a-gke-autopilot--the-headscale-statefulset}

Headscale s'exécute par défaut en tant que StatefulSet à réplica unique (`workload_type`
se résout automatiquement en `StatefulSet` lorsque `stateful_pvc_enabled = true`). Parce que
`max_instance_count` est codé en dur à `1`, il n'y a pas de mise à l'échelle horizontale
à observer ici.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail Headscale
  pour les pods, les révisions et les événements.
- **CLI :**
  ```bash
  kubectl get statefulset,pods,pvc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot et du type de charge de travail
(Déploiement vs StatefulSet).

### B. Volume persistant — le PVC de stockage SQLite {#b-persistent-volume--the-sqlite-storage-pvc}

Avec `stateful_pvc_enabled = true` (la valeur par défaut), un PVC de stockage par blocs réel est
monté à `/var/lib/headscale`, contenant `db.sqlite` (+ sidecars `-wal`/`-shm`
en mode WAL), `noise_private.key` et la clé WireGuard héritée. Cela donne
au mode WAL de SQLite un véritable verrouillage de fichier POSIX — confirmé en direct comme
totalement exempt des erreurs d'écriture gcsfuse observées sur la variante Cloud Run.

- **Console :** Kubernetes Engine → Stockage → Revendications de volume persistant.
- **CLI :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE" <pvc-name>
  ```

Voir [App_GKE](App_GKE.md) pour les mécanismes du PVC StatefulSet et les options de classe de stockage.

### C. Réseau et ingress {#c-networking--ingress}

Par défaut, la charge de travail obtient une IP externe statique réservée et un Ingress Gateway API
pour un nom d'hôte personnalisé — important ici car chaque appareil client Tailscale enregistré
a besoin d'une URL durable pour atteindre le serveur de coordination.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get gateway,httproute,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés, Cloud CDN et les IP statiques.

### D. Cloud Logging et Monitoring {#d-cloud-logging--monitoring}

Les sorties standard et d'erreur des pods sont acheminées vers Cloud Logging. Au démarrage, un pod sain enregistre
la génération de la clé privée, "base de données ouverte avec succès" et "écoute et sert HTTP". Les métriques GKE sont acheminées vers Cloud Monitoring.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Headscale {#3-headscale-application-behaviour}

- **SQLite s'initialise automatiquement au démarrage.** Pas de job de configuration de base de données séparé — au
  premier démarrage, Headscale crée `db.sqlite` sous `/var/lib/headscale` et
  applique automatiquement ses propres migrations de schéma internes.
- **Génération automatique de la clé privée.** Au premier démarrage, Headscale génère sa
  clé privée de protocole Noise à `noise_private.key` si elle n'existe pas déjà.
  La perte de cette clé (ou du PVC) oblige chaque client précédemment enregistré
  à se réenregistrer.
- **Point de terminaison de santé.** `/health` est un véritable point de terminaison non authentifié —
  confirmé en direct renvoyant HTTP 200 avec "listening and serving HTTP" dans les
  journaux de l'application. Les sondes de démarrage et de vivacité le ciblent par
  défaut.
- **La configuration initiale est une étape manuelle post-déploiement — l'accès shell de GKE
  la rend simple.** Headscale n'est pas livré avec un flux d'inscription basé sur le Web.
  Créez le premier utilisateur et une clé de pré-authentification en exécutant directement dans le
  pod en cours d'exécution :
  ```bash
  POD=$(kubectl get pods -n "$NAMESPACE" -l app=<service-name> -o jsonpath='{.items[0].metadata.name}')

  # Create the first user/namespace:
  kubectl exec -n "$NAMESPACE" "$POD" -- /ko-app/headscale users create myuser

  # Issue a pre-auth key for that user (valid 1 hour, reusable):
  kubectl exec -n "$NAMESPACE" "$POD" -- /ko-app/headscale preauthkeys create \
    --user myuser --reusable --expiration 1h
  ```
  Voir le [labo pratique](../labs/Headscale_GKE.md) pour la procédure complète.
- **Connexion d'un client Tailscale réel.** Une fois qu'une clé de pré-authentification existe :
  ```bash
  tailscale up --login-server=<server_url> --authkey=<preauthkey>
  ```
- **Inspection des nœuds enregistrés :**
  ```bash
  kubectl exec -n "$NAMESPACE" "$POD" -- /ko-app/headscale nodes list
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls
les paramètres spécifiques ou notables pour Headscale sont listés ; toutes les autres entrées
sont héritées de [App_GKE](App_GKE.md) avec son comportement standard et
ses valeurs par défaut.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `headscale` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | `"latest"` se résout en la version amont épinglée `HEADSCALE_VERSION=0.26.1`. |
| `server_url` | `""` | URL publique du plan de contrôle, intégrée à l'enregistrement de chaque client. Par défaut, l'URL interne du cluster, ou l'IP statique réservée / le domaine personnalisé lorsqu'il est configuré. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `min_instance_count` | `0` | Mise à l'échelle à zéro. |
| `max_instance_count` | `1` | **Codé en dur à `1` en aval quelle que soit cette valeur** — voir [Pièges](#7-pitfalls--gotchas). |
| `cpu_limit` / `memory_limit` | `1000m` / `1Gi` | Limites de ressources par pod. |
| `container_port` | `8080` (déclaré, non transféré) | Fixé à 8080 via `Headscale_Common` quelle que soit la valeur de cette variable. |

### Groupe 6 — Configuration du backend GKE {#group-6--gke-backend-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `workload_type` | `null` (se résout automatiquement en `StatefulSet`) | Parce que `stateful_pvc_enabled = true` par défaut. |
| `service_type` | `LoadBalancer` | L'accessibilité publique provient de la passerelle (`enable_custom_domain`), pas de ce type de service — ce n'est pas le même bug "devrait être LoadBalancer" à l'échelle de la flotte observé sur les applications orientées navigateur ailleurs dans ce catalogue, puisque le point d'entrée réel côté client est le chemin de la passerelle/IP statique. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | **`true`** | La valeur par défaut, et la raison pour laquelle cette variante de plateforme ne partage pas le risque SQLite/gcsfuse de Cloud Run — voir [Pièges](#7-pitfalls--gotchas). |
| `stateful_pvc_mount_path` | `/var/lib/headscale` | Ne doit pas être modifié — c'est là que Headscale stocke sa base de données SQLite et ses clés. |
| `stateful_pvc_storage_class` | `standard` (HDD) | Délibérément pas SSD — petits fichiers, pas de besoin d'IOPS élevés, et le HDD tire du quota `DISKS_TOTAL_GB` beaucoup plus grand. |
| `stateful_pvc_size` | `20Gi` | Taille du PVC par pod. |

### Groupe 12 — Base de données (transférée pour compatibilité) {#group-12--database-forwarded-for-compatibility}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixé par `Headscale_Common` — aucune instance Cloud SQL n'est jamais créée. |

### Groupe 19 — Domaine personnalisé et réseau {#group-19--custom-domain--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne l'Ingress Gateway API — le point d'entrée public réel. |
| `reserve_static_ip` | `true` | Une URL de serveur stable est importante pour chaque appareil client enregistré. |

### Groupe 20 — Proxy conscient de l'identité {#group-20--identity-aware-proxy}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | **Ne jamais activer pour une utilisation normale** — IAP nécessite une identité Google, que la CLI `tailscale` ne peut pas présenter, bloquant l'enregistrement du client. |

### Groupe 22 — Observabilité et santé {#group-22--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/health`, délai de 15s, seuil 10 | Point de terminaison Headscale réel, non authentifié. |
| `liveness_probe` | HTTP `/health`, délai de 30s, seuil 3 | Même point de terminaison. |

---

## 5. Référence d'exploration des services GCP {#5-gcp-service-exploration-reference}

Voir le §2 ci-dessus — GKE Autopilot/StatefulSet, le volume persistant, le réseau,
et la journalisation/surveillance sont l'ensemble complet des services que ce module touche
directement (au-delà de l'infrastructure partagée VPC/IAM/Artifact Registry commune
à chaque déploiement `App_GKE`).

---

## 6. Sorties {#6-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide
de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `service_external_ip` | Équilibreur de charge externe/IP réservée. |
| `api_url` | URL pour atteindre Headscale — c'est ce que `server_url` prédit et ce contre quoi les clients s'enregistrent. |
| `storage_buckets` | Buckets Cloud Storage créés (le bucket `storage` — inutilisé comme montage lorsque `stateful_pvc_enabled = true`, la valeur par défaut). |
| `statefulset_name` | Nom du StatefulSet (présent avec la valeur par défaut `workload_type = "StatefulSet"`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` | Noms des jobs de configuration personnalisés (vide par défaut). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. Faux lors de la première application d'un tout nouveau cluster intégré — réappliquer pour terminer. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 7. Pièges et écueils {#7-pitfalls--gotchas}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service
> dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration
> via le moteur de fondation [App_GKE](App_GKE.md), qui valide
> les valeurs et les combinaisons au moment de la planification — voir [App_GKE](App_GKE.md) pour le
> comportement général de validation, ainsi que la section des gardes de validation
> spécifiques au module de `modules/Headscale_GKE/README.md`.

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `stateful_pvc_enabled` | Conserver `true` (la valeur par défaut) | **Critique si remplacé par `false`** | C'est le paramètre qui donne à la base de données SQLite de Headscale un véritable verrouillage de fichier POSIX. Le définir `false` revient au même volume basé sur GCS-Fuse que `Headscale_CloudRun`, réintroduisant le risque d'erreur d'écriture SQLite/gcsfuse (`BufferedWriteHandler.OutOfOrderError`) confirmé en direct que cette variante de plateforme existe spécifiquement pour éviter. Ne le désactivez que si vous avez une raison indépendante forte. |
| `stateful_pvc_storage_class` | `standard` (HDD, la valeur par défaut) | Moyen (coût/quota) | Passer à `standard-rwo`/`premium-rwo` (SSD) puise dans le quota régional `SSD_TOTAL_GB` beaucoup plus restreint sans réel avantage — les fichiers de Headscale sont petits et n'ont pas besoin d'IOPS élevés. |
| `max_instance_count` | Laisser à `1` (c'est codé en dur de toute façon) | Élevé | La variable est déclarée mais n'est jamais réellement lue par `Headscale_Common` — `config.max_instance_count` est un littéral `1`. Le définir plus haut donne une fausse impression que la mise à l'échelle horizontale est disponible. |
| `server_url` | Définir une fois, avant d'enregistrer les clients | Critique | Intégré à l'enregistrement de chaque client. Le modifier après l'enregistrement des clients nécessite de réenregistrer chaque nœud. |
| `enable_iap` | `false` | Critique | IAP nécessite une identité Google pour chaque requête. La CLI `tailscale` ne peut pas en présenter une, donc l'activation d'IAP bloque tout enregistrement de client et tout trafic de synchronisation de maillage. |
| Suppression du PVC/StatefulSet | Ne jamais supprimer tant que des nœuds sont enregistrés | Critique | La clé privée du protocole Noise et l'ensemble du registre des nœuds résident sur le PVC. Sa perte oblige chaque client à se réenregistrer à partir de zéro. Rappel de la règle générale du catalogue : la mise à l'échelle à zéro ne libère **pas** le PVC — seule sa suppression le fait. |
| MagicDNS (`dns.magic_dns`) | Laisser `false` à moins que vous ne définissiez également un véritable `dns.base_domain` | Moyen | L'activation de MagicDNS sans un `base_domain` valide et distinct du domaine de `server_url` produit une résolution DNS défectueuse pour les clients. |
| `reserve_static_ip` / `enable_custom_domain` | Conserver `true` (les valeurs par défaut) | Moyen | Sans URL stable, une adresse éphémère ou DNS interne peut changer lors d'un redéploiement, rompant silencieusement la capacité de chaque client enregistré à atteindre le serveur de coordination. |

---

Pour le comportement de base référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Headscale
partagée avec la variante Cloud Run est décrite dans
**[Headscale_Common](Headscale_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Labo pratique : Headscale sur GKE Autopilot](../labs/Headscale_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Headscale sur Google Cloud Run](Headscale_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Headscale Common — Configuration d'application partagée](Headscale_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [TechnitiumDNS sur GKE Autopilot](TechnitiumDNS_GKE.md), [AdGuard Home sur GKE Autopilot](AdGuardHome_GKE.md), [Gatus sur GKE Autopilot](Gatus_GKE.md) dans la solution **Réseau Zero-trust et DNS**.
