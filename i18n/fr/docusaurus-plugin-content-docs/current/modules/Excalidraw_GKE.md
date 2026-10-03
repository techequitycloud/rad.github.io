---
title: "Excalidraw sur GKE Autopilot"
description: "Référence de configuration pour le déploiement d'Excalidraw sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Excalidraw_GKE.md @ 15fd4c7 sha256:00da0442ddf2 -->

# Excalidraw sur GKE Autopilot {#excalidraw-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Excalidraw_GKE.png" alt="Excalidraw sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Excalidraw est un tableau blanc virtuel open source (MIT) pour esquisser des
diagrammes, des wireframes et des dessins collaboratifs rapides de style
dessiné à la main. La distribution auto-hébergée est une **application
statique à page unique servie par nginx** — il n'y a pas de backend, de base
de données ou de comptes utilisateur, et les dessins sont stockés dans le
propre navigateur du visiteur. Ce module déploie ce frontend statique sur
**GKE Autopilot** sur la base de la fondation [App_GKE](App_GKE.md), qui
provisionne et gère l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud qu'Excalidraw utilise et sur la
manière de les explorer et de les exploiter à partir de la console Google
Cloud et de la ligne de commande. Pour les mécanismes communs à chaque
application GKE — Workload Identity, ingress, autoscaling, CI/CD, Cloud
Armor, IAP, Binary Authorization, VPC Service Controls et le cycle de vie du
déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Excalidraw s'exécute comme une seule charge de travail web nginx sans état.
Étant donné que l'application n'a pas de backend, le déploiement ne relie
qu'un ensemble minimal de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods nginx statiques sur le **port 80**, auto-mis à l'échelle horizontalement ; facturés pour le CPU/la mémoire demandés |
| Image de conteneur | Artifact Registry | Build personnalisé léger `FROM excalidraw/excalidraw`, mis en miroir dans le registre du projet |
| Base de données | _Aucune_ | Excalidraw n'a pas de backend — aucune instance Cloud SQL n'est créée |
| Stockage d'objets | _Aucun_ | Aucun bucket GCS n'est provisionné ; les dessins sont stockés dans le navigateur |
| Cache et file d'attente | _Aucun_ | Pas de Redis, pas de file d'attente de messages |
| Secrets | _Aucun_ | Pas de clés de chiffrement, de secrets JWT ou de mots de passe de base de données — Secret Manager n'est pas utilisé |
| Ingress | Cloud Load Balancing | Équilibreur de charge externe, domaine personnalisé facultatif + certificat géré |

**Valeurs par défaut judicieuses à connaître à l'avance :**

- **Entièrement sans état — aucune donnée n'est stockée côté serveur.** Les
  dessins persistent dans le stockage local de chaque navigateur et sont
  exportés/importés sous forme de fichiers `.excalidraw`. Le
  replanification des pods, les redéploiements et la mise à l'échelle ne
  perdent **aucune** donnée serveur car il n'y en a pas.
- **Un minimum de 1 réplica est maintenu** (GKE ne prend pas en charge la
  mise à l'échelle à zéro) pour que le tableau blanc reste toujours
  accessible. Le wrapper épingle `min_instance_count = 1`.
- **Charge de travail de déploiement, pas StatefulSet.** Il n'y a pas de
  volume persistant par pod — chaque pod sert le même bundle statique, donc
  un simple `Deployment` est utilisé et les pods sont
  entièrement interchangeables.
- **Port fixe 80.** L'écouteur nginx est intégré à l'image ; `container_port`
  est par défaut à 80 et ne doit pas être modifié.
- **Pas de Cloud SQL, Secret Manager, Redis, NFS ou GCS.** Les
  fonctionnalités de fondation correspondantes sont inertes pour cette
  application — les activer provisionne une infrastructure inutilisée.
- **Équilibreur de charge externe par défaut** afin que le tableau blanc soit
  accessible par navigateur ; une IP statique réservée maintient l'adresse
  stable lors des redéploiements.
- **Entrées héritées `homeserver_url` / `homeserver_name`.** Reportées du
  modèle Element et toujours injectées comme `HOMESERVER_URL` / `HOMESERVER_NAME`, que
  l'application SPA statique ignore. Elles sont masquées du formulaire de
  déploiement.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté `gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Excalidraw {#a-gke-autopilot--the-excalidraw-workload}

Les pods Excalidraw sont planifiés sur Autopilot, qui facture le CPU/la
mémoire que les pods demandent réellement. L'autoscaling horizontal des pods
dimensionne le déploiement entre le nombre minimum (`1`) et maximum de réplicas. Étant donné que chaque pod est
identique et sans état, la mise à l'échelle est sûre et ne nécessite aucune
coordination.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la
  charge de travail Excalidraw pour les pods, les révisions et les
  événements. Kubernetes Engine → Services et Ingress affiche l'adresse IP
  externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100      # nginx access/error logs
  kubectl describe hpa -n "$NAMESPACE"                                # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour savoir comment Autopilot, la mise à l'échelle et le type de charge de travail sont gérés.

### B. Artifact Registry — l'image de conteneur {#b-artifact-registry--the-container-image}

L'image Excalidraw est un build personnalisé léger `FROM excalidraw/excalidraw` que Cloud Build produit et pousse dans l'Artifact Registry du projet (`enable_image_mirroring
= true`). App_GKE définit `imagePullPolicy=Always` pour les images personnalisées/mises en miroir afin qu'une balise reconstruite soit toujours
re-téléchargée.

- **Console :** Artifact Registry → Dépôts.
- **CLI :**
  ```bash
  gcloud artifacts repositories list --project "$PROJECT" --location "$REGION"
  gcloud artifacts docker images list <repo-path> --include-tags
  gcloud builds list --project "$PROJECT" --region "$REGION" --limit 5
  # Confirm the digest running in the cluster matches the freshly built image:
  kubectl get pod -n "$NAMESPACE" -o jsonpath='{.items[0].status.containerStatuses[0].imageID}'
  ```

### C. Base de données, Secret Manager, Cloud Storage, Redis — non utilisés {#c-database-secret-manager-cloud-storage-redis--not-used}

Excalidraw ne provisionne **aucun** de ces éléments. Il n'y a pas
d'instance Cloud SQL, pas de secret Secret Manager, pas de bucket GCS et pas
de Redis pour ce déploiement. Les éléments suivants renverront des résultats
vides pour l'application — c'est normal :

```bash
gcloud sql instances list --project "$PROJECT" --filter="name~excalidraw"   # (none)
gcloud secrets list --project "$PROJECT" --filter="name~excalidraw"          # (none)
gcloud storage buckets list --project "$PROJECT" --filter="name~excalidraw"  # (none)
```

La collaboration en direct fonctionne, mais via le propre serveur de salle
hébergé d'Excalidraw (`oss-collab.excalidraw.com`, chiffré de bout en bout), et non un service de votre projet —
voir les valeurs par défaut ci-dessus. L'hébergement de la collaboration
nécessiterait un build source du frontend et un serveur `excalidraw-room` séparé, que ce module ne déploie **pas**.

### D. Réseau et ingress {#d-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe de
Cloud Load Balancing. Un domaine personnalisé avec un certificat géré par
Google peut être activé, et une adresse IP statique peut être réservée afin
que l'adresse survive aux redéploiements. Cloud CDN est un bon choix pour les
actifs statiques.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC →
  Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés, Cloud CDN et l'adresse IP statique.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les logs stdout/stderr des pods (logs nginx) sont envoyés à Cloud Logging ;
les métriques GKE sont envoyées à Cloud Monitoring. Des vérifications de
disponibilité et des stratégies d'alerte facultatives sont disponibles ; une
vérification de disponibilité publique du chemin racine est un signal de
santé naturel pour le frontend statique.

- **Console :** Logging → Explorateur de logs ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Excalidraw {#3-excalidraw-application-behaviour}

- **Pas de configuration au premier déploiement.** Il n'y a pas de base de
  données, pas de job d'initialisation et pas de migrations. Un pod est
  prêt dès que nginx commence à servir le bundle statique — généralement en
  une ou deux secondes.
- **Pas de comptes, pas de connexion, pas de persistance côté serveur.** Le
  frontend auto-hébergé n'a pas d'authentification et ne stocke rien côté
  serveur. Les dessins de chaque utilisateur sont stockés dans le **stockage
  local de leur propre navigateur** ; utilisez **Exporter** (`.excalidraw`, PNG ou SVG) pour enregistrer ou partager le travail.
- **Les pods sont interchangeables.** Chaque réplica sert le même bundle
  statique, de sorte que les requêtes n'ont pas besoin d'affinité de session
  et que la mise à l'échelle ne nécessite aucune coordination — contrairement
  aux modules d'application avec état.
- **Certaines fonctionnalités optionnelles utilisent les services hébergés
  d'Excalidraw.** Le bundle amont relie la collaboration en direct (`oss-collab.excalidraw.com` et Firebase), "Exporter vers un lien" (`json.excalidraw.com`), les fonctionnalités AI texte-vers-diagramme et diagramme-vers-code (`oss-ai.excalidraw.com`) et le navigateur de bibliothèques de formes (`libraries.excalidraw.com`) aux serveurs d'Excalidraw, et non à quoi que ce soit dans votre projet. Rien n'est contacté lors d'un simple chargement de page — seulement lorsqu'un utilisateur invoque la fonctionnalité — et la collaboration est chiffrée de bout en bout, mais ce contenu quitte le projet. Les URL sont compilées dans le frontend au moment de la construction, donc ce module ne peut pas les rediriger ; l'auto-hébergement de la collaboration nécessiterait un build source plus un serveur `excalidraw-room`.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent la
  racine `/`, à laquelle nginx répond
  immédiatement avec `200`. Vérifiez depuis l'intérieur du cluster ou via l'adresse IP de l'équilibreur de charge :
  ```bash
  kubectl port-forward -n "$NAMESPACE" deploy/<service-name> 8080:80
  curl -sI http://localhost:8080/ | head -1        # expect: HTTP/1.1 200 OK
  ```
- **Les mises à niveau de version sont une reconstruction + un
  redéploiement.** L'augmentation de `application_version` reconstruit
  l'image à partir d'une nouvelle balise `excalidraw/excalidraw` et déploie de nouveaux pods ; comme il n'y a pas d'état, les mises à niveau et les retours arrière sont triviaux et non destructifs.
- **Variables d'environnement vestigiales.** `HOMESERVER_URL` / `HOMESERVER_NAME` sont injectées (reportées d'Element) mais ignorées par l'application SPA statique. Confirmez/inspectez les variables d'environnement avec :
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep HOMESERVER
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Excalidraw sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut
standards.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `excalidraw` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Balise d'image Excalidraw. Contrairement à DokuWiki/EspoCRM, `latest` ne résout **pas** une balise connue et épinglée — le `Excalidraw_Common` local de `pinned_excalidraw_version` est lui-même `"latest"`, donc le build suit toujours la balise `excalidraw/excalidraw:latest` roulante de Docker Hub. Définissez une balise explicite (par exemple `v1.11.86`) pour épingler réellement une version de production. |
| `homeserver_url` / `homeserver_name` | `""` | Report d'Element hérité, masqué du formulaire — ignoré par l'application SPA Excalidraw. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | Gardez `custom` — le build léger met en miroir l'image statique dans Artifact Registry. Avec `custom`, `container_image` est ignoré ; il n'est lu qu'avec `prebuilt`. |
| `container_port` | `80` | Port d'écoute nginx ; intégré à l'image — ne pas modifier. |
| `container_resources` | `cpu_limit=500m`, `memory_limit=512Mi` | Un serveur de fichiers statiques a besoin de peu ; la requête pilote la facturation d'Autopilot. |
| `min_instance_count` | `1` | Forcé à `1` par le wrapper — GKE n'a pas de mise à l'échelle à zéro ; maintient le tableau blanc accessible. |
| `max_instance_count` | `3` | Nombre maximal de réplicas ; sûr à augmenter puisque les pods sont sans état. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Excalidraw dans Artifact Registry. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Variables d'environnement supplémentaires en texte brut. L'application SPA statique n'en lit aucune à l'exécution ; les remplacements sont rarement utiles. |
| `secret_environment_variables` | `{}` | Inutilisé — Excalidraw n'a pas besoin de secrets. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 6 — Backend et cluster GKE {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Expose une adresse IP externe pour que le tableau blanc soit accessible par navigateur. |
| `workload_type` | `null` (résout en `Deployment`) | Sans état — les pods sont interchangeables. Laissé `null`, App_GKE le résout en `Deployment` car `stateful_pvc_enabled` est également par défaut à `null`/`false` pour Excalidraw ; définir explicitement `stateful_pvc_enabled = true` résoudrait automatiquement cela en `StatefulSet` à la place (inutile pour Excalidraw). |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 7 — StatefulSet / Groupes 13-16 — NFS, Stockage, Redis, Base de données {#group-7--statefulset--groups-1316--nfs-storage-redis-database}

Ces groupes sont **inertes** pour Excalidraw : il n'y a pas de PVC par pod à
modéliser (`stateful_pvc_enabled` doit rester `false`), pas de NFS, pas de bucket GCS, pas de Redis et pas de
base de données (`database_type = NONE`). Les laisser à leurs valeurs par défaut ne provisionne aucune
infrastructure inutilisée. Toutes les autres entrées suivent le comportement
standard d'App_GKE.

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Placez la connexion Google devant Excalidraw pour restreindre l'accès au tableau blanc. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder lorsque l'IAP est activé. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le
moyen le plus rapide de localiser et d'explorer les ressources en cours
d'exécution. Les sorties de stockage/base de données/secrets sont présentes
pour la parité d'interface avec d'autres modules, mais se résolvent en
valeurs vides ici.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Carte des ClusterIPs pour les services spécifiques à l'étape. |
| `service_external_ip` | IP de l'équilibreur de charge externe (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Excalidraw. |
| `storage_buckets` | Buckets Cloud Storage créés — vides pour Excalidraw. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` | Noms des jobs de configuration — vides pour Excalidraw. |
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

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration via le moteur de fondation [App_GKE](App_GKE.md), qui valide
> les valeurs *et les combinaisons* au moment de la planification — un port
> hors plage, un StatefulSet sans PVC, IAP sans identités autorisées, des
> valeurs de quota de mémoire sans suffixes d'unité binaire. Une
> configuration invalide fait échouer le **plan** avec une erreur claire et
> nommée avant la création de toute ressource.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `container_port` | `80` | Élevé | Le nginx de l'image n'écoute que sur le port 80 ; un port non concordant signifie que la sonde de démarrage ne passe jamais et que le pod ne devient jamais prêt. |
| `container_image_source` | `custom` | Élevé | Passer à `prebuilt` sans image mise en miroir déclenche `build_and_push_application_image` sans Dockerfile / pointe vers un chemin non construit. |
| `min_instance_count` | N/A — codé en dur à `1` | Faible | `excalidraw.tf` remplace toujours la configuration par `min_instance_count = 1` quelle que soit la valeur de cette variable (il n'y a pas de garde au moment de la planification rejetant `0` — App_GKE lui-même autorise `0` pour les applications capables de se mettre à l'échelle à zéro). Définir cette variable sur `0` n'a aucun effet et ne réduira pas les coûts ; un pod résident maintient le tableau blanc accessible à tout moment. |
| `service_type` | `LoadBalancer` | Moyen | `ClusterIP` rend Excalidraw inaccessible depuis l'extérieur du cluster. |
| `application_version` | épingler en production | Moyen | `latest` flotte — une nouvelle balise amont peut modifier l'interface utilisateur/le comportement lors de la prochaine reconstruction. Épinglez une version. |
| `stateful_pvc_enabled` / `enable_redis` / entrées de base de données | laisser par défaut (désactivé) | Faible | Les activer provisionne des PVC/Redis/Cloud SQL qu'Excalidraw n'utilise jamais — coût gaspillé, aucun avantage. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Moyen | Les entiers bruts sont traités comme des octets et bloquent toute planification de pod dans l'espace de noms (pertinent uniquement si vous activez les quotas de ressources). |
| `homeserver_url` / `homeserver_name` | laisser vide | Faible | Entrées Element vestigiales ; les définir n'a aucun effet sur l'application SPA Excalidraw. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud CDN, Cloud
Armor, IAP, Binary Authorization, VPC-SC et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à
Excalidraw partagée avec la variante Cloud Run est décrite dans
**[Excalidraw_Common](Excalidraw_Common.md)**.

## Guides associés {#related-guides}

- [Labo pratique : Excalidraw sur GKE Autopilot](../labs/Excalidraw_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Excalidraw sur Google Cloud Run](Excalidraw_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Excalidraw Common — Configuration d'application partagée](Excalidraw_Common.md) — la configuration partagée par les deux cibles de déploiement.
