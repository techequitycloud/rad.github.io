---
title: "Filebrowser sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Filebrowser sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Filebrowser_GKE.md @ 1665a43e sha256:6d170ecdb862 -->

# Filebrowser sur GKE Autopilot {#filebrowser-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Filebrowser_GKE.png" alt="Filebrowser sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

File Browser est un gestionnaire de fichiers web léger et open source écrit en Go. Il
sert une arborescence de répertoires via HTTP pour la navigation, le téléchargement,
l'édition et le partage de fichiers. Ce module déploie Filebrowser sur **GKE Autopilot**
au-dessus de la fondation [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Filebrowser et sur la manière
de les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications GKE — Workload Identity,
ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au [guide de la fondation
App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## Ce que coûte Filebrowser sur RAD, et comment cela se compare {#what-filebrowser-costs-on-rad-and-how-that-compares}

**Dans un projet Google Cloud que vous possédez, le module GKE Autopilot de Filebrowser sur RAD coûte environ 42 US$ par mois, plus 7,50 US$ une fois par déploiement et aucune licence par utilisateur.** Filebrowser est un gestionnaire de fichiers web léger et auto-hébergé avec une base de données SQLite intégrée. Les chiffres sont valables au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

Si cela s'exécute dans un projet géré par RAD pour vous, il peut être supprimé et restauré dans les 30 jours pour quelques crédits au lieu de rester en fonctionnement — ainsi, un déploiement à usage occasionnel coûte quelques dollars par mois, et non 42 US$. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 75 crédits (7,50 US$ au prix de la recharge) | 67,5 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Le même |
| Coût de fonctionnement Google Cloud | Facturé par Google à votre propre compte de facturation, environ **42 US$ par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **67 crédits par jour**, soit environ 2 010 par mois (environ 201 US$ au prix de la recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde acheté minimum est conservé en réserve |

10 crédits coûtent 1 US$ pour une recharge unique, et moins pour un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, donc une deuxième application n'ajoute pas une deuxième base de données.

**Coût de fonctionnement par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Pod GKE Autopilot, 1 vCPU / 1 GiB, fonctionnant en permanence | 36 US$ |
| Passerelle et adresse IP Cloud NAT | 5 US$ |
| Cloud Storage pour les sauvegardes | 1 US$ |
| **Total** | **environ 42 US$** |

Le niveau gratuit de GKE couvre les frais de gestion d'un cluster Autopilot ou zonal par compte de facturation, donc le total ci-dessus suppose qu'il s'agit de ce cluster ; sinon, ajoutez environ 73 US$ par mois.

### Comment cela se compare {#how-it-compares}

Nous n'avons pas trouvé de plan commercial géré/SaaS spécifiquement pour Filebrowser lui-même au 8 octobre 2026, donc la comparaison honnête est avec l'exécution par vous-même :

| Option | Par mois | Qui l'exécute |
|---|---|---|
| Hetzner CPX22 (2 vCPU/4 Go) | ~24 US$ | Vous : OS, mises à jour, sauvegardes, correctifs de sécurité |
| DigitalOcean 2 vCPU/4 Go Droplet | 24 US$ | Vous : OS, mises à jour, sauvegardes, correctifs de sécurité |
| GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) | ~49 US$ | Vous : OS, mises à jour, sauvegardes, correctifs de sécurité |
| **RAD, GKE Autopilot, votre propre projet** | **42 US$**, plus 7,50 US$ une fois | L'automatisation de RAD, dans votre projet |

L'empreinte propre de Filebrowser ici (1 vCPU / 1 GiB) est plus légère que celle de cette machine de référence, donc un niveau plus petit et moins cher des mêmes fournisseurs l'exécuterait également confortablement.

- **RAD n'est généralement pas moins cher en espèces qu'un VPS nu — la différence réside dans ce qui est géré pour vous.** Le prix d'un VPS n'inclut pas le temps de l'administrateur pour les sauvegardes, les correctifs de sécurité et les mises à niveau du système d'exploitation ; le Cloud SQL géré par RAD (où cette application utilise une base de données), Secret Manager et la surveillance couvrent cela à la place.
- **Filebrowser est un gestionnaire de fichiers web léger et auto-hébergé avec une base de données SQLite intégrée.** Cela détermine quelle colonne est importante : un fonctionnement prévisible et sans intervention vaut plus pour la plupart des équipes utilisant ce type d'outil que de réduire de quelques dollars la facture mensuelle.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Filebrowser s'exécute dans **un projet géré par RAD pour vous**, vous avez une option au-delà de la mise à l'échelle : **supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour presque rien.** Cela convient bien mieux à un déploiement dont vous n'avez besoin qu'occasionnellement — pour une certification, une démo, un besoin saisonnier — que de le faire fonctionner en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le projet. Google ne le supprime pas immédiatement : il le conserve, récupérable, pendant 30 jours, et comme la facturation est déjà déliée, rien n'est facturé pendant cette attente. Contrairement à la suppression d'un module, cela ne démantèle pas GKE Autopilot un par un — l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet peut le restaurer. RAD demande à Google de restaurer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter **Update** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela coûte une poignée de crédits de temps de build au total (moins de 1 US$) pour une chaîne de 2 à 3 déploiements typique.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, et non 42 US$.** Déployez Filebrowser, utilisez-le pour une session, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Update, et supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez que les frais de module une fois, les builds, et les heures pendant lesquelles il était réellement en ligne.
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet que vous apportez et dont RAD ne gère que la facturation), et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime définitivement. La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox qui convient à la plupart des utilisations d'étude/démo). Google indique que la plupart des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.

### Payez uniquement pendant que vous l'utilisez, l'autre façon : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

GKE maintient au moins un pod en cours d'exécution, de sorte que Filebrowser ne se met jamais à l'échelle à zéro de lui-même. L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ 80 crédits (8 US$). La suppression permet d'économiser de l'argent si Filebrowser resterait inutilisé pendant environ 6 jours ou plus dans votre propre projet (environ 1,40 US$ par jour), ou environ 2 jours ou plus dans un projet géré par RAD (67 crédits par jour).
- **Notez vos paramètres.** RAD ne recrée pas un déploiement supprimé pour vous ; vous entrez à nouveau les paramètres lorsque vous déployez.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant reçoit Filebrowser dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits non utilisés sont restitués au formateur.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais propres à RAD et estimation des crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour le mécanisme de pause/restauration. Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Filebrowser s'exécute comme une charge de travail web Go unique. Il est
délibérément minimal — pas de base de données SQL, pas de cache, pas de file
d'attente — de sorte que le déploiement relie un petit ensemble de services
Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pod Go unique, 1 vCPU / 1 GiB par défaut ; `min = max = 1` |
| État persistant | Cloud Storage (GCS FUSE) **ou** un PVC de bloc | Monté à `/database` ; contient la base de données SQLite intégrée |
| Base de données | Aucune (SQLite intégrée) | `database_type = NONE` ; aucune instance Cloud SQL n'est provisionnée |
| Cache et file d'attente | Aucun | Filebrowser n'utilise pas Redis |
| Secrets | Secret Manager | Aucun secret d'application généré ; les utilisateurs vivent dans la base de données SQLite |
| Ingress | Cloud Load Balancing | `ClusterIP` Service par défaut ; domaine personnalisé + certificat géré disponibles |

**Valeurs par défaut judicieuses à connaître à l'avance :**

- **L'état réside dans un fichier SQLite intégré à `/database`.** Filebrowser
  n'a pas de base de données Cloud SQL. Ses utilisateurs, ses paramètres et ses
  liens de partage sont stockés dans `/database/filebrowser.db`. Par défaut, `/database`
  est un PVC de bloc sur un StatefulSet ; ce n'est qu'avec `stateful_pvc_enabled = false` qu'il
  s'agit d'un bucket Cloud Storage monté via GCS FUSE (voir ci-dessous).
- **GCS FUSE vs. PVC de bloc.** Avec `stateful_pvc_enabled = true` (par défaut), la charge de
  travail devient un **StatefulSet** avec un PVC de bloc persistant (par défaut
  `20Gi`) monté à `/database`, et le volume GCS FUSE est
  automatiquement désactivé pour éviter un double montage au même chemin. Un PVC
  de bloc offre à SQLite un verrouillage de fichier POSIX approprié et est le
  choix le plus robuste pour un gestionnaire de fichiers avec état.
- **Instance unique par conception.** `min_instance_count = max_instance_count = 1`. SQLite ne tolère pas les
  écritures concurrentes — conservez une seule réplique.
- **La connexion par défaut est `admin` / `admin`.** Filebrowser
  initialise cela au premier démarrage ; changez-le dans l'interface web
  immédiatement après le déploiement.
- **Pas de Redis, pas de job d'initialisation.** `enable_redis = false` et aucun job
  `db-init` ne s'exécute ; le pod est prêt dès que le conteneur démarre.
- **Port conteneur 80.** Filebrowser sert du HTTP/1.1 simple sur le port 80.
- **Le domaine personnalisé est activé par défaut.** `enable_custom_domain = true` et
  `reserve_static_ip = true` ; fournissez `application_domains` pour servir un nom d'hôte avec un
  certificat géré par Google.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Filebrowser {#a-gke-autopilot--the-filebrowser-workload}

Filebrowser s'exécute comme un StatefulSet à réplique unique (`stateful_pvc_enabled = true`, par
défaut ; un déploiement lorsqu'il est `false`) planifié sur Autopilot, qui facture le
CPU/mémoire réellement demandé par le pod.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail Filebrowser pour voir
  les pods, les révisions et les événements. Kubernetes Engine → Services & Ingress affiche le
  Service et toute adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl get statefulset,pvc -n "$NAMESPACE"          # when stateful_pvc_enabled = true
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de charge de travail
(Déploiement vs StatefulSet).

### B. Cloud Storage / PVC de bloc — état persistant {#b-cloud-storage--block-pvc--persistent-state}

Filebrowser n'a pas de base de données Cloud SQL. Sa base de données SQLite intégrée
(`/database/filebrowser.db`) est stockée sur le montage `/database` :

- **Par défaut — StatefulSet (`stateful_pvc_enabled = true`) :** un **PersistentVolumeClaim** de bloc
  (par défaut `20Gi`, StorageClass `standard-rwo`) monté à `/database` ; le volume GCS FUSE
  est désactivé pour éviter un double montage. Gardez-le activé : la base de données de Filebrowser est
  bbolt, qui écrit à des décalages arbitraires que GCS FUSE rejette.
- **Déploiement (`stateful_pvc_enabled = false`) :** un bucket **Cloud Storage** dédié
  monté via GCS FUSE à travers le pilote CSI.

- **Console :** Cloud Storage → Buckets ; ou Kubernetes Engine → Storage → PVCs.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~storage"   # GCS FUSE mode
  gcloud storage ls gs://<data-bucket>/filebrowser.db
  kubectl get pvc -n "$NAMESPACE"                                            # PVC mode
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK, GCS FUSE et les PVC StatefulSet.

### C. Secret Manager {#c-secret-manager}

Filebrowser ne génère **aucun secret d'application** — il n'y a pas de clé de chiffrement
ou de secret JWT à gérer, car tout l'état d'identité réside dans la base de données SQLite.
Secret Manager est toujours utilisé par la fondation pour les secrets gérés par la plateforme
(par exemple, les jetons CI/CD si configurés).

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~filebrowser"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store CSI.

### D. Réseau et ingress {#d-networking--ingress}

Par défaut, le Service est `ClusterIP`, avec `enable_custom_domain = true` et
`reserve_static_ip = true` afin qu'un Ingress avec un certificat géré par Google puisse servir
un nom d'hôte fourni sur une IP stable. Sans domaine personnalisé, la charge de travail est accessible
dans le cluster à `http://<service>.<namespace>.svc.cluster.local`.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails des IP statiques.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les flux stdout/stderr des pods vers Cloud Logging ; les métriques GKE vers Cloud Monitoring.
Des tests de disponibilité et des politiques d'alerte optionnels sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Filebrowser {#3-filebrowser-application-behaviour}

- **Pas de configuration de base de données au premier déploiement.** Il n'y a pas de job
  `db-init` et pas d'instance Cloud SQL. Au premier démarrage, le binaire
  Filebrowser crée sa base de données SQLite à `/database/filebrowser.db` si elle n'existe
  pas déjà et initialise l'utilisateur par défaut `admin`/`admin`.
- **Persistance de l'état.** Les utilisateurs, les paramètres et les liens de partage
  résident entièrement dans `/database/filebrowser.db` sur le montage `/database` (bucket GCS
  FUSE ou PVC de bloc), survivant aux redémarrages et aux redéploiements. `FB_ROOT = /srv`
  est l'arborescence de fichiers que l'application sert.
- **Les identifiants par défaut doivent être modifiés.** La connexion
  initialisée `admin`/`admin` est bien connue. Connectez-vous et
  changez le mot de passe (et idéalement le nom d'utilisateur) dans l'interface web
  immédiatement après le premier déploiement.
- **Contrainte d'écriture unique.** La base de données SQLite intégrée ne prend
  pas en charge les écritures concurrentes. Conservez `min_instance_count = max_instance_count = 1` ; un PVC de
  bloc StatefulSet offre un verrouillage de fichier approprié mais reste à
  réplique unique.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent
  **`/health`** — le point de terminaison de santé non authentifié de
  Filebrowser, qui renvoie `200` dès que le serveur écoute :
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- wget -qO- http://localhost:80/health
  ```
- **Pas de Redis.** `enable_redis = false` ; Filebrowser est un gestionnaire de fichiers
  autonome sans file d'attente ni cache. La valeur par défaut App_GKE de
  `enable_redis = true` est explicitement remplacée.
- **L'image personnalisée nécessite `imagePullPolicy = Always`.** L'image est un wrapper
  léger construit et mis en miroir dans Artifact Registry ; App_GKE définit
  `imagePullPolicy = Always` pour les images personnalisées/mises en miroir afin qu'un
  rebuild-redeploy tire toujours la nouvelle couche.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour Filebrowser sont listés ; toutes les autres entrées sont héritées de [App_GKE](App_GKE.md) avec son comportement et ses valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `filebrowser` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image Filebrowser. `latest` se résout en `v2.32.0` épinglé au moment du build ; épingler explicitement en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par pod ; Filebrowser est léger. |
| `memory_limit` | `1Gi` | Mémoire par pod ; 256 Mi sont amplement suffisants pour le serveur Go. |
| `min_instance_count` | `1` | Nombre minimal de répliques. Garder à 1 — SQLite est à écriture unique. |
| `max_instance_count` | `1` | **Garder à 1** pour éviter les écritures SQLite concurrentes. |
| `container_port` | `80` | Écouteur HTTP/1.1 de Filebrowser. |
| `enable_cloudsql_volume` | `false` | Filebrowser n'a pas de Cloud SQL ; laisser `false`. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Filebrowser dans Artifact Registry. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service Kubernetes est exposé ; le faire précéder d'un Ingress via `enable_custom_domain`. |
| `workload_type` | `null` | Se résout automatiquement en `StatefulSet` lorsque `stateful_pvc_enabled = true`, sinon `Deployment`. |
| `session_affinity` | `None` | Réplique unique, donc le routage persistant est inutile. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | Définir `true` pour stocker `/database` sur un PVC de bloc au lieu de GCS FUSE (recommandé pour le verrouillage de fichiers SQLite). |
| `stateful_pvc_size` | `20Gi` | Taille de stockage PVC par pod. |
| `stateful_pvc_mount_path` | `/database` | Chemin de montage — doit correspondre au répertoire de `FB_DATABASE`. |
| `stateful_pvc_storage_class` | `standard-rwo` | StorageClass (`standard-rwo` PD équilibré ; `premium-rwo` pour des IOPS plus élevées). |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protéger la disponibilité pendant les mises à niveau de nœuds. |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles pendant les interruptions volontaires. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/health` 15s de délai | Sonde de démarrage ; Filebrowser expose `/health` une fois prêt. |
| `liveness_probe` | HTTP `/health` 30s de délai | Sonde de vivacité sur le point de terminaison non authentifié `/health`. |
| `uptime_check_config` | `{enabled=false, path="/health"}` | Test de disponibilité Cloud Monitoring ; désactivé par défaut. |
| `alert_policies` | `[]` | Politiques d'alerte métrique optionnelles. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS est désactivé par défaut ; non nécessaire pour Filebrowser. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer le bucket Filebrowser `/database` (et tout `storage_buckets` supplémentaire). |
| `storage_buckets` | `[]` | Buckets supplémentaires à provisionner. |
| `gcs_volumes` | `[]` | Montages GCS FUSE supplémentaires. Le bucket `/database` est ajouté automatiquement (sauf si un PVC est utilisé). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 15 — Cache et file d'attente Redis {#group-15--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Hérité d'App_GKE et **non** remplacé par ce module. Filebrowser n'utilise pas Redis, donc définissez-le sur `false` lors du déploiement — le laisser activé crée une dépendance inutilisée. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

Non applicable — Filebrowser n'a pas de base de données SQL. `database_password_length` et
`db_name` / `db_user` sont transmis à la fondation uniquement pour la compatibilité ;
`database_type` est fixé à `NONE` par `Filebrowser_Common`.

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner Ingress pour les noms d'hôte personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable à travers les redéploiements. |

### Groupe 20 — Proxy conscient de l'identité (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger une connexion Google devant Filebrowser. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque l'IAP est activé (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

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
| `stage_service_cluster_ips` | Carte des ClusterIPs pour les services spécifiques à chaque étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Filebrowser. |
| `storage_buckets` | Buckets Cloud Storage créés (inclut le bucket `/database` en mode GCS FUSE). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` | Noms des jobs d'initialisation (vide par défaut). |
| `statefulset_name` | Nom du StatefulSet (lorsque `stateful_pvc_enabled = true`). |
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

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur de la fondation [App_GKE](App_GKE.md), qui valide les valeurs *et les combinaisons* au moment de la planification — IAP sans identifiants OAuth, `min_instance_count > max_instance_count`, `workload_type = Deployment` avec `stateful_pvc_enabled = true`, valeurs de mémoire ResourceQuota sans suffixes d'unité binaire. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'au moment de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| Volume `/database` (bucket ou PVC) | Ne jamais supprimer | Critique | La base de données SQLite intégrée réside ici ; sa suppression détruit tous les utilisateurs, les paramètres et les liens de partage. |
| `admin` / `admin` (connexion initiale) | Changer à la première connexion | Critique | Laisser les identifiants par défaut permet à quiconque peut atteindre le service de prendre le contrôle total. |
| `max_instance_count` | `1` | Élevé | >1 entraîne des écritures concurrentes sur la base de données SQLite unique, la corrompant. |
| `stateful_pvc_mount_path` | `/database` | Élevé | Doit correspondre au répertoire de `FB_DATABASE` ; une non-concordance stocke la base de données sur un disque éphémère et entraîne une perte d'état au redémarrage. |
| `stateful_pvc_enabled` + `enable_gcs_storage_volume` | Laisser Common désactiver GCS FUSE | Élevé | Les deux à `/database` double-montent ; Common définit automatiquement `enable_gcs_storage_volume = false` lorsque le PVC est activé — ne forcez pas les deux. |
| `container_port` | `80` | Élevé | Filebrowser écoute sur le port 80 ; un port différent fait échouer la sonde de démarrage et le pod ne devient jamais prêt. |
| Chemin `startup_probe` / `liveness_probe` | `/health` | Élevé | Pointer les sondes vers un chemin authentifié renvoie 401/403 et le pod ne devient jamais prêt. |
| `enable_cloudsql_volume` | `false` | Moyen | Filebrowser n'a pas de Cloud SQL ; l'activation ajoute un sidecar Auth Proxy inutile. |
| `enable_redis` | `true` | Moyen | Filebrowser n'a pas de Redis, mais la valeur par défaut App_GKE de `true` est héritée inchangée — définissez-la explicitement sur `false`, sinon une dépendance inutilisée est câblée. |
| `enable_iap` | identifiants requis | Élevé | L'activation de l'IAP sans `iap_oauth_client_id`/`secret` expose silencieusement le service non authentifié (bloqué par une garde au moment de la planification). |
| `application_version` | épingler en production | Moyen | `latest` se résout en `v2.32.0` épinglé au moment du build ; épingler explicitement pour contrôler les mises à niveau. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Filebrowser
partagée avec la variante Cloud Run est décrite dans
**[Filebrowser_Common](Filebrowser_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Filebrowser sur GKE Autopilot](../labs/Filebrowser_GKE.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [Filebrowser Common — Configuration d'application partagée](Filebrowser_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [Kopia sur GKE Autopilot](Kopia_GKE.md), [UrBackup sur GKE Autopilot](UrBackup_GKE.md) dans la solution **Sauvegarde et reprise après sinistre**.
