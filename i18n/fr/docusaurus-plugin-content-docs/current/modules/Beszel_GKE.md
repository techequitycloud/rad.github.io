---
title: "Beszel sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Beszel sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Beszel_GKE.md @ e69407af sha256:8e93bc757630 -->

# Beszel sur GKE Autopilot {#beszel-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Beszel_GKE.png" alt="Beszel sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Beszel est un hub de surveillance de serveurs léger et open source — métriques
historiques des ressources, statistiques des conteneurs Docker et alertes
configurables, basé sur PocketBase (Go plus une base de données SQLite
intégrée). Ce module déploie le hub Beszel sur **GKE Autopilot** au-dessus de
la fondation [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure partagée Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Beszel et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et
la ligne de commande. Pour les mécanismes communs à toutes les applications GKE
— Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## Ce que coûte Beszel sur RAD, et comment cela se compare {#what-beszel-costs-on-rad-and-how-that-compares}

**Le module GKE Autopilot de Beszel sur RAD coûte environ 42 US$ par mois dans votre propre projet Google Cloud, sans frais de licence supplémentaires** — Beszel est open source. Dans un projet géré par RAD pour vous, le même déploiement est facturé à **67 crédits par jour** (environ 2 010 par mois, soit environ 201 US$ au prix de la recharge). Ou consultez le [guide Cloud Run](Beszel_CloudRun.md) pour l'option moins chère. Si vous n'avez besoin de Beszel qu'occasionnellement — pour des études, une démo, un projet de courte durée — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour quelques crédits, de sorte que ce chiffre mensuel devient quelques dollars à la place. Voir **Mettre en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

Beszel est open source, il n'y a donc pas de frais de licence. Vous payez pour trois choses :

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 75 crédits (7,50 US$ au prix de la recharge) | 67,5 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build (environ 3 à 6 crédits) | Idem |
| Coût de fonctionnement Google Cloud | Facturé par Google à votre propre compte de facturation, environ **42 US$ par mois** pour la configuration par défaut (tableau ci-dessous) | Facturé à l'heure en crédits ; RAD publie **67 crédits par jour**, environ 2 010 par mois (environ 201 US$ au prix de la recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 US$ pour une recharge unique, et moins pour un forfait mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût de fonctionnement par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (valeur par défaut du module) | Par mois |
|---|---|
| Pod GKE Autopilot, 1x vCPU / 1 GiB | 36,08 US$ |
| Cloud NAT et réseau | 5 US$ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 US$ |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 |
| **Total (hors frais de cluster GKE partagé)** | **environ 42 US$** |

Ces prix sont les mêmes en africa-south1 (Johannesburg).

- **GKE Autopilot ne se met pas à l'échelle à zéro.** Au moins un pod est toujours en cours d'exécution, de sorte que le coût ci-dessus s'applique que l'application soit utilisée ou non ; des pods supplémentaires ne sont ajoutés qu'en cas de charge.

### Comment cela se compare, pour la surveillance d'une petite flotte de serveurs {#how-it-compares-for-monitoring-a-small-server-fleet}

Beszel n'est livré que sous forme de binaire/image Docker auto-hébergé — le projet ne vend pas de version hébergée, donc la comparaison honnête est un serveur nu :

- Un Hetzner CPX22 ou un DigitalOcean droplet (2 vCPU/4 Go, environ 24 US$/mois) ou un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go, environ 49 US$/mois) ferait fonctionner Beszel confortablement — en fait surdimensionné, car l'empreinte propre de Beszel ici n'est que de 1 vCPU/1 GiB, donc une classe d'instance plus petite et moins chère ferait tout aussi bien l'affaire.
- La différence est ce qui est géré pour vous : sur un VPS nu, vous possédez le système d'exploitation, les correctifs de sécurité et votre propre discipline de sauvegarde. Le module de RAD vous offre le calcul, Secret Manager et Cloud Monitoring déjà câblés, pour les frais de module plus l'utilisation de Google Cloud ci-dessus.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Beszel s'exécute dans **un projet géré par RAD pour vous**, la suppression de l'ensemble du projet — plutôt que la suppression de ce seul module — délie d'abord sa facturation, puis demande à Google de supprimer le projet purement et simplement. Google le conserve, récupérable, pendant 30 jours, et comme la facturation est déjà déliée, rien n'est facturé pendant qu'il attend. Contrairement à la suppression d'un module, cela ne démolit pas Cloud SQL, aucune VM ou la ressource de calcul une par une : l'ensemble du projet s'arrête simplement.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **La restauration est une vérification, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet peut demander à Google de récupérer le projet et de rattacher son compte de facturation, puis d'exécuter **Update** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes, et une mise à jour ne facture jamais les frais de module à nouveau. Pour une chaîne typique de 2 à 3 déploiements, cela ne coûte qu'une poignée de crédits au total (environ 5 à 10 crédits, moins de 1 US$).
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet dont RAD ne gère que la facturation), le restaurer vous-même dans les 30 jours — après quoi Google le supprime définitivement — et effacer à nouveau le seuil d'admission du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude/démo conviennent). Google indique que la plupart des services fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.
- **Un véritable manque : les sauvegardes nocturnes ne survivent pas.** Les sauvegardes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud Storage désactivée, il est donc très probable qu'il disparaisse dès que le projet est supprimé — même si le projet lui-même est récupérable pendant 30 jours. Copiez une sauvegarde (vers Google Drive, ou un bucket en dehors du projet) avant de la supprimer s'il y a quelque chose à conserver ; pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

Source : [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects).

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois la fenêtre de restauration de 30 jours ci-dessus passée, la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer lorsque vous en avez besoin.

- **Ce que coûte un redéploiement.** Les frais de module à nouveau, plus les builds : environ 79 crédits (environ 7,90 US$) au prix de la recharge, et environ 15 à 20 minutes de temps de build (moyenne de la plateforme RAD). La suppression ne permet d'économiser de l'argent que si Beszel resterait inutilisé pendant environ **3 jours ou plus** — dans votre propre projet, cela représente environ 1,40 US$ par jour, et dans un projet géré par RAD, c'est 67 crédits par jour.
- La majeure partie du coût de fonctionnement ici est généralement la base de données et/ou la VM ou le cluster de fichiers/cache partagé. Ils ne s'arrêtent que si rien d'autre dans le projet ne les utilise, donc la suppression de Beszel pendant qu'une autre application partage le projet n'économise que la partie calcul de Beszel.
- **Conserver les données en premier.** Les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui, alors copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant dispose de l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite fixée par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais RAD et estimation des crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour la fenêtre de pause/restauration et la mise en garde sur le bucket de sauvegarde ; les prix changent, vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Beszel s'exécute en tant que Kubernetes **StatefulSet** à réplica unique sur
Autopilot, servant son interface utilisateur web et son API REST sur le port
8090 et persistant tout l'état sur un volume persistant de bloc monté à
`/beszel_data`. Le déploiement relie un ensemble délibérément restreint de services
Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pod Go unique, StatefulSet, 1 vCPU / 1 GiB par défaut, port 8090 |
| Base de données | **Aucune** | Beszel intègre sa propre base de données PocketBase/SQLite — aucun Cloud SQL n'est provisionné |
| Stockage persistant | Persistent Disk (PVC) | PVC de bloc de 20 Gi à `/beszel_data` pour tout l'état (StatefulSet) |
| Cache et file d'attente | **Aucun** | Beszel n'utilise pas Redis ; `enable_redis` est désactivé |
| Secrets | Secret Manager | Aucun secret d'application injecté — le premier administrateur est créé dans l'interface utilisateur |
| Ingress | Cloud Load Balancing | Service `ClusterIP` par défaut ; domaine personnalisé facultatif + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de base de données, pas de Redis.** Beszel est autonome — `database_type = "NONE"`,
  `enable_cloudsql_volume = false`, et `enable_redis = false`. Tout l'état est la
  base de données SQLite intégrée sous `/beszel_data`.
- **StatefulSet avec un PVC de bloc par défaut.** `stateful_pvc_enabled = true` (la
  valeur par défaut de GKE), donc `workload_type` se résout automatiquement en `StatefulSet` et un Persistent Disk de 20 Gi
  est monté à `/beszel_data`. Un PVC de bloc est le support durable correct
  pour SQLite (contrairement à un montage de fichier réseau). Parce que le PVC couvre `/beszel_data`,
  le volume GCS FUSE au même chemin est désactivé pour éviter un double montage.
- **Le réplica unique est délibéré.** `min_instance_count = max_instance_count = 1`.
  Beszel est une application à écrivain unique (un fichier SQLite) ; ne **pas** augmenter
  le nombre de réplicas.
- **Mise à jour de style `Recreate`.** Un seul pod peut posséder le PVC SQLite à la fois ; le
  StatefulSet remplace le pod plutôt que d'en exécuter deux sur le même volume.
- **Port 8090.** Le hub de Beszel écoute sur 8090 ; le port du conteneur et les sondes sont définis
  en conséquence.
- **`ClusterIP` par défaut.** Le Service est interne par défaut ; exposez le hub
  via la passerelle/Ingress avec un domaine personnalisé (et un certificat géré), ou définissez
  un LoadBalancer, afin que les agents distants et les navigateurs puissent l'atteindre.
- **Chemin de santé `/api/health`.** Les sondes de démarrage et de vivacité atteignent le point de terminaison de santé public et non authentifié du hub
  (200 lorsque prêt).
- **L'administrateur initial est créé dans l'interface utilisateur.** Aucun mot de passe administrateur n'est stocké dans Secret
  Manager ; ouvrez le hub après le déploiement et complétez la configuration du superutilisateur
  de PocketBase lors du premier démarrage.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION`, et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Beszel {#a-gke-autopilot--the-beszel-workload}

Beszel est planifié comme un StatefulSet à réplica unique sur Autopilot, qui facture
le CPU/la mémoire que le pod demande réellement. Comme l'application est à écrivain unique, elle n'est
pas mise à l'échelle horizontalement.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail Beszel pour voir le
  pod, le StatefulSet et les événements. Kubernetes Engine → Services & Ingress montre comment il
  est exposé.
- **CLI :**
  ```bash
  kubectl get statefulset,pods,svc,pvc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=beszel
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de charge de travail
(Déploiement vs StatefulSet).

### B. Persistent Disk (PVC) — le volume `/beszel_data` {#b-persistent-disk-pvc--the-beszel_data-volume}

L'état entier de Beszel (la base de données SQLite, la configuration téléchargée et les métriques historiques)
réside sur un volume persistant de bloc revendiqué par le StatefulSet et monté à
`/beszel_data` (20 Gi par défaut).

- **Console :** Kubernetes Engine → Stockage → Persistent Volume Claims ; Compute
  Engine → Disques.
- **CLI :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE" <pvc-name>
  gcloud compute disks list --project "$PROJECT" --filter="name~beszel"
  ```

> **Attention :** Ce PVC **est** la base de données. La suppression du StatefulSet avec son PVC,
> ou la suppression du disque sous-jacent, efface tout l'historique de surveillance et le compte
> administrateur. Voir [App_GKE](App_GKE.md) pour les détails sur le StatefulSet et la classe de stockage.

### C. Secret Manager {#c-secret-manager}

Beszel n'injecte **aucun** secret d'application — il n'y a pas de clé de chiffrement, de secret JWT
ou de mot de passe de base de données à gérer (la base de données est SQLite intégrée, et l'administrateur est créé
dans l'interface utilisateur). Une liste de secrets ne montre que ce que la fondation elle-même crée.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~beszel"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration de Secret Store CSI si vous ajoutez des secrets
via `secret_environment_variables`.

### D. Réseau et ingress {#d-networking--ingress}

Par défaut, la charge de travail est exposée en tant que service `ClusterIP` (intra-cluster uniquement). Activez
un domaine personnalisé avec un certificat géré par Google, ou un LoadBalancer/Gateway, afin que
les agents distants et les navigateurs puissent atteindre le hub. Une IP statique peut être réservée afin que l'adresse
survive aux redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails des IP statiques.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Le stdout/stderr des pods s'écoule vers Cloud Logging ; les métriques GKE s'écoulent vers Cloud Monitoring, avec
des vérifications de disponibilité et des politiques d'alerte facultatives. (Notez que Beszel lui-même est un produit de surveillance
— la surveillance GCP ici observe le *hub*, pas les machines que Beszel surveille.)

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Beszel {#3-beszel-application-behaviour}

- **Pas de job d'initialisation ; le schéma est auto-géré.** Beszel crée et migre sa base de données
  PocketBase/SQLite intégrée automatiquement au premier démarrage (et à chaque mise à niveau de version).
  Il n'y a pas de job `db-init` car il n'y a pas de base de données externe.
- **L'état réside sur le PVC de bloc.** Tout ce qui se trouve sous `/beszel_data` — la base de données SQLite,
  la configuration et les métriques historiques — est persisté sur le volume persistant.
  Les redémarrages de pod et les mises à niveau de version rattachent le même PVC, de sorte que l'historique
  survit.
- **La configuration initiale se fait dans l'interface utilisateur.** Atteignez l'URL du service et complétez
  la création du compte superutilisateur (administrateur) de PocketBase lors du premier démarrage. Il n'y a pas
  de credential administrateur auto-généré dans Secret Manager. Après avoir créé l'administrateur, ajoutez les
  systèmes à surveiller et installez l'agent Beszel sur chacun (le hub affiche la commande d'installation de l'agent
  et la clé publique).
- **Écrivain unique — ne pas mettre à l'échelle.** Un fichier SQLite sur un seul PVC signifie qu'un seul pod peut
  écrire. `min = max = 1`, et un seul pod peut posséder le PVC à la fois. Une garde au moment de la planification
  rejette `min_instance_count > max_instance_count`.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/api/health`, qui renvoie
  `200` une fois le hub prêt. Confirmez le port/env injecté :
  ```bash
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- env | grep -i port
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls
les paramètres spécifiques ou notables pour Beszel sont listés ; toute autre entrée est
héritée de [App_GKE](App_GKE.md) avec son comportement et ses valeurs par défaut standard.

### Groupe — Identité de l'application {#group--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `beszel` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image Beszel. `latest` résout l'image de base en `0.9.1` ; définissez un tag explicite pour contrôler les mises à niveau. |

### Groupe — Exécution et mise à l'échelle {#group--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par pod ; Beszel est léger, 1 vCPU est suffisant. |
| `memory_limit` | `1Gi` | Mémoire par pod ; 512 Mi–1 Gi est typique. |
| `min_instance_count` | `1` | Maintenu à 1 — un écrivain SQLite. |
| `max_instance_count` | `1` | **Ne pas augmenter.** Plus d'un pod corrompt la base de données SQLite partagée. |
| `enable_cloudsql_volume` | `false` | Pas de sidecar Cloud SQL Auth Proxy ; Beszel utilise SQLite intégré. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Beszel dans Artifact Registry. |

### Groupe — Backend GKE et cluster {#group--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Interne par défaut ; exposer via un domaine personnalisé / LoadBalancer pour les agents externes. |
| `workload_type` | `null` → `StatefulSet` | Se résout automatiquement en `StatefulSet` car `stateful_pvc_enabled = true`. |
| `session_affinity` | `None` | Pod unique, donc le routage persistant est inutile. |

### Groupe — StatefulSet {#group--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | Beszel est stateful — un PVC de bloc soutient sa base de données SQLite. |
| `stateful_pvc_size` | `20Gi` | Taille du PVC par pod pour `/beszel_data`. |
| `stateful_pvc_mount_path` | `/beszel_data` | Chemin de montage pour la base de données SQLite et l'historique des métriques. |

### Groupe — Stockage et système de fichiers {#group--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS est désactivé ; Beszel persiste sur le PVC de bloc, pas sur NFS. |
| `gcs_volumes` | `[]` | Montages GCS Fuse supplémentaires (le volume GCS `/beszel_data` est désactivé lorsque le PVC est utilisé). |
| `create_cloud_storage` | `true` | Provisionner le(s) bucket(s) de stockage déclaré(s). |

### Groupe — Cache et file d'attente Redis {#group--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` (effectif) | La variable elle-même par défaut `true`, mais le wrapper `main.tf` code en dur `enable_redis = false` dans l'appel de la Fondation et ne transmet jamais `var.enable_redis` — Beszel n'utilise pas Redis. |

### Groupe — Observabilité et santé {#group--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/health` 15s de délai | Sonde de démarrage ; fenêtre de 10 tentatives pour la création du schéma au premier démarrage. |
| `liveness_probe` | HTTP `/api/health` 30s de délai | Sonde de vivacité. |
| `uptime_check_config` | `{ enabled=false, path="/api/health" }` | Vérification de disponibilité Cloud Monitoring facultative sur le hub. |

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
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Beszel. |
| `statefulset_name` | Nom du StatefulSet Beszel. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` | Noms des jobs de configuration (aucun par défaut). |
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

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration via le moteur de fondation [App_GKE](App_GKE.md), qui valide les valeurs *et les combinaisons* au moment de la planification — IAP sans identités autorisées, un type de charge de travail `Deployment` combiné à `stateful_pvc_enabled = true`, des valeurs de mémoire ResourceQuota en unités binaires, `min_instance_count > max_instance_count`. Une configuration invalide échoue la **planification** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| PVC StatefulSet / disque sous-jacent | Ne jamais supprimer | Critique | Le PVC **est** la base de données SQLite — sa suppression efface tout l'historique de surveillance et le compte administrateur. |
| `max_instance_count` | `1` | Critique | L'exécution de plus d'un pod sur le PVC SQLite partagé provoque des conflits de verrouillage et une corruption de la base de données. |
| `stateful_pvc_enabled` | `true` | Critique | Le désactiver supprime le volume de bloc durable, de sorte que l'état SQLite est perdu au redémarrage du pod. |
| `workload_type` | laisser `null` (→ StatefulSet) | Élevé | La définition de `Deployment` avec `stateful_pvc_enabled = true` échoue à une garde au moment de la planification. |
| `enable_cloudsql_volume` / `database_type` | `false` / pas de SQL | Élevé | Beszel n'a pas de base de données externe ; l'activation de Cloud SQL provisionne une instance inutilisée et configure mal le démarrage. |
| `service_type` / domaine personnalisé | exposer délibérément | Élevé | Laissé comme `ClusterIP` sans Ingress, les agents distants en dehors du cluster ne peuvent pas atteindre le hub. |
| `enable_iap` | uniquement pour l'interface utilisateur, jamais avec des agents hors Google | Élevé | IAP bloque toutes les requêtes non authentifiées, y compris le rapport de métriques de l'agent. |
| `quota_memory_requests` / `_limits` | unités binaires (`1Gi`, `1024Mi`) | Critique | Les entiers bruts sont des octets et bloquent toute planification de pod dans l'espace de noms. |
| `container_port` | `8090` | Moyen | Le hub n'écoute que sur 8090 ; le modifier sans faire correspondre l'image rompt les sondes et le service. |
| `application_version` | épingler explicitement | Moyen | `latest` résout l'image de base en `0.9.1` ; épinglez un vrai tag pour contrôler les mises à niveau et les migrations de schéma. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**.
La configuration d'application spécifique à Beszel partagée avec la variante Cloud Run est
décrite dans **[Beszel_Common](Beszel_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Beszel sur GKE Autopilot](../labs/Beszel_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Beszel sur Google Cloud Run](Beszel_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Beszel Common — Configuration d'application partagée](Beszel_Common.md) — la configuration partagée par les deux cibles de déploiement.
