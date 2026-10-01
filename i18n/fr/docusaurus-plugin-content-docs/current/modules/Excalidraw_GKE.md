---
title: "Excalidraw sur GKE Autopilot"
description: "Référence de configuration pour déployer Excalidraw sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Excalidraw_GKE.md @ 3055034 sha256:a651b2edb6ea -->

# Excalidraw sur GKE Autopilot {#excalidraw-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Excalidraw_GKE.png" alt="Excalidraw sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Excalidraw est un tableau blanc virtuel open source (MIT) permettant d'esquisser des
diagrammes au style dessiné à la main, des maquettes filaires et des dessins
collaboratifs rapides. La distribution auto-hébergée est une **application monopage
statique servie par nginx** — il n'y a ni backend, ni base de données, ni comptes
utilisateurs, et les dessins sont stockés dans le navigateur même du visiteur. Ce
module déploie ce frontend statique sur **GKE Autopilot** au-dessus du socle
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google Cloud et
Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise Excalidraw et sur la manière
de les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toute application GKE — Workload Identity,
entrée, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Excalidraw s'exécute comme une unique charge de travail web nginx sans état.
L'application n'ayant pas de backend, le déploiement n'assemble qu'un ensemble minimal
de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods nginx statiques sur le **port 80**, autoscaling horizontal ; facturation selon le CPU et la mémoire demandés |
| Image de conteneur | Artifact Registry | Fine surcouche personnalisée `FROM excalidraw/excalidraw`, mise en miroir dans le registre du projet |
| Base de données | _Aucune_ | Excalidraw n'a pas de backend — aucune instance Cloud SQL n'est créée |
| Stockage objet | _Aucun_ | Aucun bucket GCS n'est provisionné ; les dessins résident dans le navigateur |
| Cache et file d'attente | _Aucun_ | Pas de Redis, pas de file de messages |
| Secrets | _Aucun_ | Pas de clés de chiffrement, de secrets JWT ni de mots de passe de base de données — Secret Manager n'est pas utilisé |
| Entrée | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé et certificat géré facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Entièrement sans état — aucune donnée n'est stockée côté serveur.** Les dessins
  persistent dans le stockage local de chaque navigateur et sont exportés/importés
  sous forme de fichiers `.excalidraw`. La replanification des pods, les
  redéploiements et la mise à l'échelle ne font perdre **aucune** donnée serveur,
  puisqu'il n'y en a pas.
- **Un minimum d'un réplica est maintenu** (GKE ne prend pas en charge la mise à zéro)
  afin que le tableau blanc reste toujours joignable. Le wrapper épingle
  `min_instance_count = 1`.
- **Charge de travail Deployment, et non StatefulSet.** Il n'y a pas de volume
  persistant par pod — chaque pod sert le même bundle statique ; un `Deployment`
  simple est donc utilisé et les pods sont entièrement interchangeables.
- **Port 80 fixe.** L'écouteur nginx est intégré à l'image ; `container_port` vaut 80
  par défaut et ne doit pas être modifié.
- **Pas de Cloud SQL, de Secret Manager, de Redis, de NFS ni de GCS.** Les
  fonctionnalités correspondantes du socle sont inertes pour cette application — les
  activer provisionne une infrastructure inutilisée.
- **LoadBalancer externe par défaut**, afin que le tableau blanc soit joignable depuis
  un navigateur ; une IP statique réservée maintient l'adresse stable d'un
  redéploiement à l'autre.
- **Entrées résiduelles `homeserver_url` / `homeserver_name`.** Héritées du modèle
  Element et injectées sous la forme `HOMESERVER_URL` / `HOMESERVER_NAME` ; la SPA
  statique Excalidraw les ignore. Laissez-les à leurs valeurs par défaut.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants figurent dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Excalidraw {#a-gke-autopilot--the-excalidraw-workload}

Les pods Excalidraw sont planifiés sur Autopilot, qui facture le CPU et la mémoire
effectivement demandés par les pods. Le Horizontal Pod Autoscaling dimensionne le
déploiement entre le nombre minimal (`1`) et le nombre maximal de réplicas. Comme
chaque pod est identique et sans état, la mise à l'échelle horizontale est sûre et ne
nécessite aucune coordination.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de
  travail Excalidraw pour voir les pods, les révisions et les événements. Kubernetes
  Engine → Services et Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100      # nginx access/error logs
  kubectl describe hpa -n "$NAMESPACE"                                # current vs target utilisation
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle
et du type de charge de travail.

### B. Artifact Registry — l'image de conteneur {#b-artifact-registry--the-container-image}

L'image Excalidraw est une fine surcouche personnalisée `FROM excalidraw/excalidraw`
que Cloud Build produit et pousse dans l'Artifact Registry du projet (`enable_image_mirroring
= true`). App_GKE définit `imagePullPolicy=Always` pour les images construites sur
mesure ou mises en miroir, de sorte qu'un tag reconstruit est toujours récupéré à
nouveau.

- **Console :** Artifact Registry → Dépôts.
- **CLI :**
  ```bash
  gcloud artifacts repositories list --project "$PROJECT" --location "$REGION"
  gcloud artifacts docker images list <repo-path> --include-tags
  gcloud builds list --project "$PROJECT" --region "$REGION" --limit 5
  # Confirm the digest running in the cluster matches the freshly built image:
  kubectl get pod -n "$NAMESPACE" -o jsonpath='{.items[0].status.containerStatuses[0].imageID}'
  ```

### C. Base de données, Secret Manager, Cloud Storage, Redis — non utilisés {#c-database-secret-manager-cloud-storage-redis--not-used}

Excalidraw ne provisionne **aucun** de ces services. Il n'y a ni instance Cloud SQL,
ni secret Secret Manager, ni bucket GCS, ni Redis pour ce déploiement. Les commandes
suivantes renverront des résultats vides pour l'application — c'est le comportement
attendu :

```bash
gcloud sql instances list --project "$PROJECT" --filter="name~excalidraw"   # (none)
gcloud secrets list --project "$PROJECT" --filter="name~excalidraw"          # (none)
gcloud storage buckets list --project "$PROJECT" --filter="name~excalidraw"  # (none)
```

La collaboration multi-utilisateur en temps réel (un canevas partagé en direct)
requiert un serveur WebSocket `excalidraw-room` distinct, que ce module ne déploie
**pas**.

### D. Réseau et entrée {#d-networking--ingress}

Par défaut, la charge de travail est exposée via une IP Cloud Load Balancing externe.
Un domaine personnalisé avec un certificat géré par Google peut être activé, et une IP
statique peut être réservée afin que l'adresse survive aux redéploiements. Cloud CDN
est bien adapté aux éléments statiques.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails sur l'IP statique.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les sorties stdout/stderr des pods (journaux nginx) sont envoyées à Cloud Logging ;
les métriques GKE sont envoyées à Cloud Monitoring. Des tests de disponibilité et des
règles d'alerte facultatifs sont disponibles ; un test de disponibilité public sur le
chemin racine constitue un signal de santé naturel pour le frontend statique.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord /
  Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Excalidraw {#3-excalidraw-application-behaviour}

- **Aucune configuration au premier déploiement.** Il n'y a ni base de données, ni job
  d'initialisation, ni migrations. Un pod est Ready dès que nginx commence à servir le
  bundle statique — généralement en une ou deux secondes.
- **Pas de comptes, pas de connexion, pas de persistance serveur.** Le frontend
  auto-hébergé n'a pas d'authentification et ne stocke rien côté serveur. Les dessins
  de chaque utilisateur résident dans **le stockage local de son propre navigateur** ;
  utilisez **Export** (`.excalidraw`, PNG ou SVG) pour enregistrer ou partager votre
  travail.
- **Les pods sont interchangeables.** Chaque réplica sert exactement le même bundle
  statique ; les requêtes n'ont donc besoin d'aucune affinité de session et la mise à
  l'échelle horizontale ne requiert aucune coordination — contrairement aux modules
  applicatifs avec état.
- **La collaboration en temps réel n'est pas incluse.** La fonctionnalité de
  collaboration en direct par « lien partageable » dépend d'un service WebSocket
  `excalidraw-room` distinct que ce module ne déploie pas. L'édition mono-utilisateur
  fonctionne immédiatement.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent la racine `/`, à
  laquelle nginx répond immédiatement par `200`. Vérifiez depuis l'intérieur du
  cluster ou via l'IP du LoadBalancer :
  ```bash
  kubectl port-forward -n "$NAMESPACE" deploy/<service-name> 8080:80
  curl -sI http://localhost:8080/ | head -1        # expect: HTTP/1.1 200 OK
  ```
- **Les mises à niveau de version sont un rebuild suivi d'un redéploiement.** Augmenter
  `application_version` reconstruit l'image à partir d'un nouveau tag
  `excalidraw/excalidraw` et déploie de nouveaux pods ; en l'absence d'état, les mises
  à niveau et les retours arrière sont triviaux et non destructifs.
- **Variables d'environnement résiduelles.** `HOMESERVER_URL` / `HOMESERVER_NAME` sont
  injectées (héritage d'Element) mais ignorées par la SPA statique. Confirmez ou
  inspectez l'environnement avec :
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep HOMESERVER
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à Excalidraw ou notables pour elle sont
listés ; toutes les autres entrées sont héritées de [App_GKE](App_GKE.md) avec leur
comportement et leurs valeurs par défaut standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `excalidraw` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image Excalidraw. Contrairement à DokuWiki/EspoCRM, `latest` ne se résout **pas** en un tag épinglé éprouvé — la variable locale `pinned_excalidraw_version` d'`Excalidraw_Common` vaut elle-même `"latest"`, si bien que le build suit toujours le tag glissant `excalidraw/excalidraw:latest` de Docker Hub. Définissez un tag explicite (p. ex. `v1.11.86`) pour réellement épingler une version de production. |
| `homeserver_url` / `homeserver_name` | `""` | Héritage **résiduel** d'Element — ignoré par la SPA Excalidraw. Laissez vide. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `container_image_source` | `custom` | Conservez `custom` — la fine surcouche met en miroir l'image statique dans Artifact Registry. |
| `container_port` | `80` | Port d'écoute nginx ; intégré à l'image — ne le modifiez pas. |
| `container_resources` | `cpu_limit=500m`, `memory_limit=512Mi` | Un serveur de fichiers statiques a peu de besoins ; la demande détermine la facturation Autopilot. |
| `min_instance_count` | `1` | Forcé à `1` par le wrapper — GKE ne permet pas la mise à zéro ; garde le tableau blanc joignable. |
| `max_instance_count` | `3` | Nombre maximal de réplicas ; peut être augmenté sans risque puisque les pods sont sans état. |
| `enable_image_mirroring` | `true` | Met en miroir l'image Excalidraw dans Artifact Registry. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Variables d'environnement supplémentaires en texte clair. La SPA statique n'en lit aucune à l'exécution ; les surcharges sont rarement utiles. |
| `secret_environment_variables` | `{}` | Inutilisé — Excalidraw n'a besoin d'aucun secret. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Expose une IP externe afin que le tableau blanc soit joignable depuis un navigateur. |
| `workload_type` | `null` (resolves to `Deployment`) | Sans état — les pods sont interchangeables. Laissé à `null`, App_GKE le résout en `Deployment`, car `stateful_pvc_enabled` vaut également `null`/`false` par défaut pour Excalidraw ; définir explicitement `stateful_pvc_enabled = true` le résoudrait automatiquement en `StatefulSet` (inutile pour Excalidraw). |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 7 — StatefulSet / Groupes 13 à 16 — NFS, stockage, Redis, base de données {#group-7--statefulset--groups-1316--nfs-storage-redis-database}

Ces groupes sont **inertes** pour Excalidraw : il n'y a pas de PVC par pod à
modéliser (`stateful_pvc_enabled` doit rester à `false`), pas de NFS, pas de bucket
GCS, pas de Redis et pas de base de données (`database_type = NONE`). Les laisser à
leurs valeurs par défaut ne provisionne aucune infrastructure inutilisée. Toutes les
autres entrées suivent le comportement standard d'App_GKE.

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Place une connexion Google devant Excalidraw pour restreindre qui peut atteindre le tableau blanc. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder lorsque IAP est activé. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le
plus rapide de localiser et d'explorer les ressources en cours d'exécution. Les
sorties de stockage, de base de données et de secrets sont présentes par souci de
cohérence d'interface avec les autres modules, mais se résolvent ici en valeurs vides.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Correspondance des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant d'atteindre Excalidraw. |
| `storage_buckets` | Buckets Cloud Storage créés — vide pour Excalidraw. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la supervision et canaux. |
| `initialization_jobs` | Noms des jobs de configuration — vide pour Excalidraw. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails de la CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub de la CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster et la charge de travail sont prêts. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service
> dégradé) — **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module fait passer sa configuration par
> le moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs
> combinaisons* au moment du plan — un port hors plage, un StatefulSet sans PVC, IAP
> sans identité autorisée, des valeurs de quota mémoire sans suffixe d'unité binaire.
> Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée
> avant la création de toute ressource.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `container_port` | `80` | High | Le nginx de l'image n'écoute que sur 80 ; un port différent empêche la sonde de démarrage de réussir et le pod ne devient jamais Ready. |
| `container_image_source` | `custom` | High | Passer à `prebuilt` sans image mise en miroir déclenche `build_and_push_application_image` sans Dockerfile / pointe vers un chemin jamais construit. |
| `min_instance_count` | Sans objet — codé en dur à `1` | Low | `excalidraw.tf` remplace toujours la configuration par `min_instance_count = 1`, quelle que soit la valeur de cette variable (aucun garde-fou au moment du plan ne rejette `0` — App_GKE lui-même autorise `0` pour les applications capables de mise à zéro). Définir cette variable à `0` n'a aucun effet et ne réduit pas les coûts ; un pod résident garde le tableau blanc joignable en permanence. |
| `service_type` | `LoadBalancer` | Medium | `ClusterIP` rend Excalidraw injoignable depuis l'extérieur du cluster. |
| `application_version` | épingler en production | Medium | `latest` est glissant — un nouveau tag amont peut modifier l'interface ou le comportement au prochain rebuild. Épinglez une version. |
| `stateful_pvc_enabled` / `enable_redis` / entrées de base de données | laisser par défaut (désactivé) | Low | Les activer provisionne des PVC/Redis/Cloud SQL qu'Excalidraw n'utilise jamais — un coût inutile, sans bénéfice. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Medium | Des entiers nus sont interprétés comme des octets et bloquent toute planification de pods dans l'espace de noms (pertinent uniquement si vous activez les quotas de ressources). |
| `homeserver_url` / `homeserver_name` | laisser vide | Low | Entrées résiduelles d'Element ; les définir n'a aucun effet sur la SPA Excalidraw. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload
Identity, autoscaling, entrée et certificats, CI/CD, Cloud CDN, Cloud Armor, IAP,
Binary Authorization, VPC-SC et mise en miroir d'images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à Excalidraw, partagée
avec la variante Cloud Run, est décrite dans
**[Excalidraw_Common](Excalidraw_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Excalidraw sur GKE Autopilot](../labs/Excalidraw_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Excalidraw sur Google Cloud Run](Excalidraw_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Excalidraw Common — Configuration applicative partagée](Excalidraw_Common.md) — la configuration partagée par les deux cibles de déploiement.
