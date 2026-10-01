---
title: "Excalidraw sur Google Cloud Run"
description: "Référence de configuration pour déployer Excalidraw sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Excalidraw_CloudRun.md @ 3055034 sha256:ad83dbec1628 -->

# Excalidraw sur Google Cloud Run {#excalidraw-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Excalidraw_CloudRun.png" alt="Excalidraw sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Excalidraw est un tableau blanc virtuel open source (MIT) permettant d'esquisser des
diagrammes au style dessiné à la main, des maquettes filaires et des dessins
collaboratifs rapides. La distribution auto-hébergée est une **application monopage
statique servie par nginx** — il n'y a ni backend, ni base de données, ni comptes
utilisateurs, et les dessins sont stockés dans le navigateur même du visiteur. Ce
module déploie ce frontend statique sur **Cloud Run v2** au-dessus du socle
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google
Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise Excalidraw et sur la manière
de les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toute application Cloud Run — identité du
service, entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls et cycle de vie du
déploiement — reportez-vous au [guide du socle App_CloudRun](App_CloudRun.md) plutôt
que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Excalidraw s'exécute comme un unique conteneur nginx sans état sur Cloud Run v2.
L'application n'ayant pas de backend, le déploiement n'assemble qu'un ensemble minimal
de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Conteneur nginx statique sur le **port 80**, 1 vCPU / 512 MiB par défaut, autoscaling serverless ; mise à zéro activée |
| Image de conteneur | Artifact Registry | Fine surcouche personnalisée `FROM excalidraw/excalidraw`, mise en miroir dans le registre du projet |
| Base de données | _Aucune_ | Excalidraw n'a pas de backend — aucune instance Cloud SQL n'est créée |
| Stockage objet | _Aucun_ | Aucun bucket GCS n'est provisionné ; les dessins résident dans le navigateur |
| Cache et file d'attente | _Aucun_ | Pas de Redis, pas de file de messages |
| Secrets | _Aucun_ | Pas de clés de chiffrement, de secrets JWT ni de mots de passe de base de données — Secret Manager n'est pas utilisé |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe et domaine personnalisé facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Entièrement sans état — aucune donnée n'est stockée côté serveur.** Les dessins
  persistent dans le stockage local de chaque navigateur et sont exportés/importés
  sous forme de fichiers `.excalidraw`. Les redéploiements, la mise à zéro et les
  changements de révision ne font perdre **aucune** donnée serveur, puisqu'il n'y en a
  pas.
- **La mise à zéro est forcée.** Le wrapper épingle `min_instance_count = 0` ; aucun
  travail en arrière-plan ne justifie de garder une instance active, si bien que les
  déploiements inactifs ne coûtent rien. Les démarrages à froid sont rapides (nginx
  servant un bundle statique) — généralement moins d'une seconde.
- **Facturation à la requête par défaut.** `cpu_always_allocated = false` : le CPU
  n'est facturé que pendant le traitement d'une requête, ce qui convient à un serveur
  de fichiers statiques sans travail en arrière-plan dans le processus.
- **Port 80 fixe.** L'écouteur nginx est intégré à l'image ; `container_port` vaut 80
  par défaut et ne doit pas être modifié.
- **Pas de Cloud SQL, de Secret Manager, de Redis ni de GCS.** Les fonctionnalités
  correspondantes du socle sont inertes pour cette application — les activer
  provisionne une infrastructure inutilisée.
- **Entrée publique par défaut.** `ingress_settings = "all"` afin que le tableau blanc
  soit joignable depuis un navigateur. Placez IAP ou Cloud Armor devant si vous devez
  restreindre l'accès.
- **Entrées résiduelles `homeserver_url` / `homeserver_name`.** Héritées du modèle
  Element et injectées sous la forme `HOMESERVER_URL` / `HOMESERVER_NAME` ; la SPA
  statique Excalidraw les ignore. Laissez-les à leurs valeurs par défaut.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des
services et des ressources figurent dans les [sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Excalidraw {#a-cloud-run--the-excalidraw-service}

Excalidraw s'exécute comme un service Cloud Run v2 qui s'adapte automatiquement à la
charge des requêtes entre le nombre minimal (`0`) et le nombre maximal d'instances.
Chaque déploiement crée une révision immuable ; le trafic peut être réparti entre les
révisions pour des déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour consulter les révisions, le
  trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~excalidraw"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  # Confirm the listening port and image on the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].ports[0].containerPort, spec.template.spec.containers[0].image)'
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Artifact Registry — l'image de conteneur {#b-artifact-registry--the-container-image}

L'image Excalidraw est une fine surcouche personnalisée `FROM excalidraw/excalidraw`
que Cloud Build produit et pousse dans l'Artifact Registry du projet (`enable_image_mirroring
= true`). Aucun pull depuis Docker Hub n'est nécessaire à l'exécution.

- **Console :** Artifact Registry → Repositories.
- **CLI :**
  ```bash
  gcloud artifacts repositories list --project "$PROJECT" --location "$REGION"
  gcloud artifacts docker images list <repo-path> --include-tags
  # Cloud Build history for the image build:
  gcloud builds list --project "$PROJECT" --region "$REGION" --limit 5
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

Si vous avez besoin d'une collaboration multi-utilisateur en temps réel (un canevas
partagé en direct), Excalidraw requiert un serveur WebSocket `excalidraw-room` distinct,
que ce module ne déploie **pas**.

### D. Réseau et entrée {#d-networking--ingress}

Le service est joignable par défaut à son URL `run.app`. Un équilibreur de charge
HTTPS externe avec domaine personnalisé, Cloud CDN et Cloud Armor peut être ajouté
par-dessus ; les paramètres d'entrée et la sortie VPC contrôlent la connectivité. La
charge utile étant constituée d'éléments statiques, Cloud CDN est particulièrement
adapté pour réduire la latence et les coûts.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les journaux des conteneurs (accès et erreurs nginx) sont envoyés à Cloud Logging ;
les métriques Cloud Run sont envoyées à Cloud Monitoring, avec des tests de
disponibilité et des règles d'alerte facultatifs. Un test de disponibilité public sur
le chemin racine constitue un signal de santé naturel pour le frontend statique.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards /
  Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Excalidraw {#3-excalidraw-application-behaviour}

- **Aucune configuration au premier déploiement.** Il n'y a ni base de données, ni job
  d'initialisation, ni migrations. Le service est prêt dès que nginx commence à servir
  le bundle statique — généralement en une ou deux secondes après l'activation de la
  révision.
- **Pas de comptes, pas de connexion, pas de persistance serveur.** Le frontend
  auto-hébergé n'a pas d'authentification et ne stocke rien côté serveur. Les dessins
  de chaque utilisateur résident dans **le stockage local de son propre navigateur** ;
  effacer les données du navigateur fait perdre les dessins locaux. Utilisez
  **Export** (`.excalidraw`, PNG ou SVG) pour enregistrer ou partager votre travail.
- **La collaboration en temps réel n'est pas incluse.** La fonctionnalité de
  collaboration en direct par « lien partageable » dépend d'un service WebSocket
  `excalidraw-room` distinct que ce module ne déploie pas. L'édition mono-utilisateur
  fonctionne immédiatement.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent la racine `/`, à
  laquelle nginx répond immédiatement par `200`. Vérifiez depuis un navigateur ou :
  ```bash
  SERVICE_URL=$(gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" --format='value(status.url)')
  curl -sI "$SERVICE_URL/" | head -1          # expect: HTTP/2 200
  ```
- **Les mises à niveau de version sont un rebuild suivi d'un redéploiement.** Augmenter
  `application_version` reconstruit l'image à partir d'un nouveau tag
  `excalidraw/excalidraw` et déploie une nouvelle révision ; en l'absence d'état, les
  mises à niveau et les retours arrière sont triviaux et non destructifs.
- **Variables d'environnement résiduelles.** `HOMESERVER_URL` / `HOMESERVER_NAME` sont
  injectées (héritage d'Element) mais ignorées par la SPA statique. Les définir n'a
  aucun effet.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à Excalidraw ou notables pour elle sont
listés ; toutes les autres entrées sont héritées de [App_CloudRun](App_CloudRun.md)
avec leur comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `excalidraw` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image Excalidraw. Contrairement à certains modules voisins, `latest` ne se résout **pas** en un tag épinglé éprouvé — la variable locale `pinned_excalidraw_version` d'`Excalidraw_Common` vaut elle-même `"latest"`, si bien que le build suit le tag glissant `excalidraw/excalidraw:latest` de Docker Hub. Épinglez une version précise (p. ex. `v1.11.86`) en production. |
| `homeserver_url` / `homeserver_name` | `""` | Héritage **résiduel** d'Element — ignoré par la SPA Excalidraw. Laissez vide. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `container_image_source` | `custom` | Conservez `custom` — la fine surcouche met en miroir l'image statique dans Artifact Registry. |
| `cpu_limit` | `1000m` | CPU par instance ; un serveur de fichiers statiques en a peu besoin. |
| `memory_limit` | `512Mi` | Mémoire par instance. Gen2 impose un plancher de 512 MiB ; le bundle statique en utilise bien moins. |
| `cpu_always_allocated` | `false` | Facturation à la requête — adaptée à un serveur statique sans travail en arrière-plan. |
| `container_port` | `80` | Port d'écoute nginx ; intégré à l'image — ne le modifiez pas. |
| `min_instance_count` | `0` | Forcé à `0` par le wrapper — mise à zéro, aucune instance active n'est nécessaire. |
| `max_instance_count` | `3` | Plafond de coût et de concurrence. |
| `enable_image_mirroring` | `true` | Met en miroir l'image Excalidraw dans Artifact Registry. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Variables d'environnement supplémentaires en texte clair. La SPA statique n'en lit aucune à l'exécution ; les surcharges sont rarement utiles. |
| `secret_environment_variables` | `{}` | Inutilisé — Excalidraw n'a besoin d'aucun secret. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Accès public afin que le tableau blanc soit joignable depuis un navigateur. |
| `enable_iap` | `false` | Place une connexion Google devant Excalidraw pour restreindre l'accès. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupes 10 à 21 — Stockage, base de données, Redis {#groups-1021--storage-database-redis}

Ces groupes sont **inertes** pour Excalidraw : il n'y a pas de base de données
(`database_type = NONE`), pas de bucket GCS et pas de Redis. Laisser `enable_nfs`,
`enable_redis`, `create_cloud_storage` et les entrées de base de données à leurs
valeurs par défaut ne provisionne aucune infrastructure inutilisée. Toutes les autres
entrées suivent le comportement standard d'App_CloudRun.

---

## 5. Sorties {#5-outputs}

Renvoyées lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution. Les sorties de stockage, de base de
données et de secrets sont présentes par souci de cohérence d'interface avec les
autres modules, mais se résolvent ici en valeurs vides.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle s'exécute le service. |
| `stage_services` | Détails des services par étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `storage_buckets` | Buckets Cloud Storage créés — vide pour Excalidraw. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration — vide pour Excalidraw. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails de la CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service
> dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module fait passer sa configuration par
> le moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs
> combinaisons* au moment du plan — un port hors plage, un environnement d'exécution
> `gen1` avec des montages NFS/GCS, IAP sans identité autorisée. Une configuration
> invalide fait échouer le **plan** avec une erreur claire et nommée avant la création
> de toute ressource.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `container_port` | `80` | Élevé | Le nginx de l'image n'écoute que sur 80 ; un port différent empêche la sonde de démarrage de réussir et la révision ne sert jamais de trafic. |
| `container_image_source` | `custom` | Élevé | Passer à `prebuilt` sans image mise en miroir fait pointer le service vers un chemin Artifact Registry jamais construit (`Image not found`). |
| `memory_limit` | `512Mi` | Moyen | Gen2 refuse `< 512Mi` à l'application ; le bundle statique n'a pas besoin de plus. |
| `ingress_settings` | `all` | Moyen | `internal` rend le tableau blanc injoignable depuis un navigateur situé hors du VPC. |
| `application_version` | épingler en production | Moyen | `latest` est glissant — un nouveau tag amont peut modifier l'interface ou le comportement au prochain rebuild. Épinglez une version. |
| `enable_redis` / entrées de base de données | laisser par défaut | Faible | Les activer provisionne Redis/Cloud SQL qu'Excalidraw n'utilise jamais — un coût inutile, sans bénéfice. |
| `homeserver_url` / `homeserver_name` | laisser vide | Faible | Entrées résiduelles d'Element ; les définir n'a aucun effet sur la SPA Excalidraw. |
| `min_instance_count` | `0` | Faible | La mise à zéro est idéale ici ; forcer `> 0` n'ajoute qu'un coût d'inactivité, sans aucun état à garder actif. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité du service,
mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD, Cloud CDN,
Cloud Armor, IAP, Binary Authorization, VPC-SC et mise en miroir d'images — consultez
**[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à Excalidraw,
partagée avec la variante GKE, est décrite dans
**[Excalidraw_Common](Excalidraw_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Excalidraw sur Cloud Run](../labs/Excalidraw_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Excalidraw sur GKE Autopilot](Excalidraw_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Excalidraw Common — Configuration applicative partagée](Excalidraw_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Penpot sur Google Cloud Run](Penpot_CloudRun.md), [AFFiNE sur Google Cloud Run](Affine_CloudRun.md) dans la solution **Design & Visual Collaboration**.
