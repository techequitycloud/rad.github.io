---
title: "Excalidraw sur Google Cloud Run"
description: "Référence de configuration pour le déploiement d'Excalidraw sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Excalidraw_CloudRun.md @ 15fd4c7 sha256:2d68b8ba5980 -->

# Excalidraw sur Google Cloud Run {#excalidraw-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Excalidraw_CloudRun.png" alt="Excalidraw sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Excalidraw est un tableau blanc virtuel open-source (MIT) pour esquisser des
diagrammes, des wireframes et des dessins collaboratifs rapides de style
dessiné à la main. La distribution auto-hébergée est une **application
statique à page unique servie par nginx** — il n'y a pas de backend, de base
de données ou de comptes utilisateurs, et les dessins sont stockés dans le
navigateur du visiteur. Ce module déploie ce frontend statique sur **Cloud Run
v2** au-dessus de la fondation [App_CloudRun](App_CloudRun.md), qui provisionne
et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'Excalidraw utilise et sur la
façon de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à chaque application Cloud Run
— identité de service, ingress et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls et le cycle de vie du déploiement — reportez-vous au [guide de la
fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Excalidraw s'exécute comme un conteneur nginx unique et sans état sur Cloud
Run v2. Comme l'application n'a pas de backend, le déploiement ne connecte
qu'un ensemble minimal de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Conteneur nginx statique sur le **port 80**, 1 vCPU / 512 Mio par défaut, autoscaling sans serveur ; mise à l'échelle à zéro activée |
| Image de conteneur | Artifact Registry | Build personnalisé léger `FROM excalidraw/excalidraw`, mis en miroir dans le registre du projet |
| Base de données | _Aucune_ | Excalidraw n'a pas de backend — aucune instance Cloud SQL n'est créée |
| Stockage d'objets | _Aucun_ | Aucun bucket GCS n'est provisionné ; les dessins vivent dans le navigateur |
| Cache et file d'attente | _Aucun_ | Pas de Redis, pas de file d'attente de messages |
| Secrets | _Aucun_ | Pas de clés de chiffrement, de secrets JWT ou de mots de passe de base de données — Secret Manager n'est pas utilisé |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL par défaut `run.app` ; équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Entièrement sans état — aucune donnée n'est stockée côté serveur.** Les
  dessins persistent dans le stockage local de chaque navigateur et sont
  exportés/importés sous forme de fichiers `.excalidraw`. Les redéploiements, la mise
  à l'échelle à zéro et les changements de révision ne perdent **aucune**
  donnée serveur car il n'y en a pas.
- **La mise à l'échelle à zéro est forcée.** L'enveloppe fixe `min_instance_count = 0` ; il n'y
  a pas de travail en arrière-plan pour maintenir une instance chaude, donc les
  déploiements inactifs ne coûtent rien. Les démarrages à froid sont rapides
  (nginx servant un bundle statique) — généralement en moins d'une seconde.
- **Facturation basée sur les requêtes par défaut.** `cpu_always_allocated = false` : le CPU n'est
  facturé que lorsqu'une requête est servie, ce qui est approprié pour un
  serveur de fichiers statiques sans travail en arrière-plan.
- **Port fixe 80.** Le listener nginx est intégré à l'image ; `container_port` est par
  défaut 80 et ne doit pas être modifié.
- **Pas de Cloud SQL, Secret Manager, Redis ou GCS.** Les fonctionnalités de
  fondation correspondantes sont inertes pour cette application — les activer
  provisionne une infrastructure inutilisée.
- **Ingress public par défaut.** `ingress_settings = "all"` pour que le tableau blanc soit
  accessible depuis un navigateur. Protégez-le avec IAP ou Cloud Armor si vous
  devez restreindre l'accès.
- **Entrées héritées `homeserver_url` / `homeserver_name`.** Reprises du modèle Element et
  toujours injectées comme `HOMESERVER_URL` / `HOMESERVER_NAME`, que le SPA statique ignore. Elles
  sont masquées du formulaire de déploiement.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de
services et de ressources sont indiqués dans les [Sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service Excalidraw {#a-cloud-run--the-excalidraw-service}

Excalidraw s'exécute comme un service Cloud Run v2 qui s'adapte
automatiquement à la charge des requêtes entre le nombre minimum (`0`) et
maximum d'instances. Chaque déploiement crée une révision immuable ; le
trafic peut être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le
  trafic, les logs et les métriques.
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

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la
concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Artifact Registry — l'image de conteneur {#b-artifact-registry--the-container-image}

L'image Excalidraw est un build personnalisé léger `FROM excalidraw/excalidraw` que Cloud Build
produit et pousse dans l'Artifact Registry du projet (`enable_image_mirroring
= true`). Aucun pull
Docker Hub n'est nécessaire à l'exécution.

- **Console :** Artifact Registry → Dépôts.
- **CLI :**
  ```bash
  gcloud artifacts repositories list --project "$PROJECT" --location "$REGION"
  gcloud artifacts docker images list <repo-path> --include-tags
  # Cloud Build history for the image build:
  gcloud builds list --project "$PROJECT" --region "$REGION" --limit 5
  ```

### C. Base de données, Secret Manager, Cloud Storage, Redis — non utilisés {#c-database-secret-manager-cloud-storage-redis--not-used}

Excalidraw ne provisionne **aucun** de ces éléments. Il n'y a pas d'instance
Cloud SQL, pas de secret Secret Manager, pas de bucket GCS et pas de Redis
pour ce déploiement. Les éléments suivants renverront des résultats vides pour
l'application — c'est normal :

```bash
gcloud sql instances list --project "$PROJECT" --filter="name~excalidraw"   # (none)
gcloud secrets list --project "$PROJECT" --filter="name~excalidraw"          # (none)
gcloud storage buckets list --project "$PROJECT" --filter="name~excalidraw"  # (none)
```

La collaboration en direct fonctionne, mais via le propre serveur de salle
hébergé d'Excalidraw (`oss-collab.excalidraw.com`, chiffré de bout en bout), et non un service
dans votre projet — voir les valeurs par défaut ci-dessus. L'hébergement de la
collaboration vous-même nécessiterait un build source du frontend et un
serveur `excalidraw-room` séparé, que ce module ne déploie **pas**.

### D. Réseau et ingress {#d-networking--ingress}

Le service est accessible à son URL `run.app` par défaut. Un équilibreur de
charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor
peut être superposé ; les paramètres d'ingress et le contrôle d'egress VPC
contrôlent la connectivité. Comme la charge utile est constituée d'actifs
statiques, Cloud CDN est particulièrement adapté pour réduire la latence et
les coûts.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les logs de conteneur (accès/erreur nginx) sont envoyés à Cloud Logging ; les
métriques Cloud Run sont envoyées à Cloud Monitoring, avec des tests de
disponibilité et des politiques d'alerte optionnels. Un test de disponibilité
public sur le chemin racine est un signal de santé naturel pour le frontend
statique.

- **Console :** Logging → Explorateur de logs ; Monitoring → Tableaux de bord
  / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Excalidraw {#3-excalidraw-application-behaviour}

- **Pas de configuration au premier déploiement.** Il n'y a pas de base de
  données, pas de job d'initialisation et pas de migrations. Le service est
  prêt dès que nginx commence à servir le bundle statique — généralement en une
  ou deux secondes après l'activation de la révision.
- **Pas de comptes, pas de connexion, pas de persistance côté serveur.** Le
  frontend auto-hébergé n'a pas d'authentification et ne stocke rien côté
  serveur. Les dessins de chaque utilisateur vivent dans le **stockage local de
  leur propre navigateur** ; l'effacement des données du navigateur entraîne la
  perte des dessins locaux. Utilisez **Exporter** (`.excalidraw`, PNG ou SVG) pour
  enregistrer ou partager le travail.
- **Certaines fonctionnalités optionnelles utilisent les propres services
  hébergés d'Excalidraw.** Le bundle amont connecte la collaboration en direct
  (`oss-collab.excalidraw.com` et Firebase), "Exporter vers un lien" (`json.excalidraw.com`), les
  fonctionnalités AI texte-vers-diagramme et diagramme-vers-code (`oss-ai.excalidraw.com`)
  et le navigateur de bibliothèques de formes (`libraries.excalidraw.com`) aux serveurs
  d'Excalidraw, et non à quoi que ce soit dans votre projet. Rien n'est
  contacté lors d'un simple chargement de page — seulement lorsqu'un
  utilisateur invoque la fonctionnalité — et la collaboration est chiffrée de
  bout en bout, mais ce contenu quitte le projet. Les URL sont compilées dans
  le frontend au moment du build, donc ce module ne peut pas les rediriger ;
  l'auto-hébergement de la collaboration nécessiterait un build source plus un
  serveur `excalidraw-room`.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent la
  racine `/`, à laquelle nginx répond immédiatement avec `200`. Vérifiez
  depuis un navigateur ou :
  ```bash
  SERVICE_URL=$(gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" --format='value(status.url)')
  curl -sI "$SERVICE_URL/" | head -1          # expect: HTTP/2 200
  ```
- **Les mises à niveau de version sont un rebuild + un redéploiement.** La
  mise à jour de `application_version` reconstruit l'image à partir d'une nouvelle balise
  `excalidraw/excalidraw` et déploie une nouvelle révision ; comme il n'y a pas d'état, les
  mises à niveau et les retours arrière sont triviaux et non destructifs.
- **Variables d'environnement vestigiales.** `HOMESERVER_URL` / `HOMESERVER_NAME` sont injectées
  (reprises d'Element) mais ignorées par le SPA statique. Les définir n'a
  aucun effet.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Excalidraw sont listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `excalidraw` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Balise d'image Excalidraw. Contrairement à certains modules frères, `latest` ne se résout **pas** en une balise connue et épinglée — le `Excalidraw_Common` local de `pinned_excalidraw_version` est lui-même `"latest"`, donc le build suit la balise `excalidraw/excalidraw:latest` roulante de Docker Hub. Épinglez une version spécifique (par exemple `v1.11.86`) en production. |
| `homeserver_url` / `homeserver_name` | `""` | Reprise héritée d'Element, masquée du formulaire — ignorée par le SPA Excalidraw. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | Conservez `custom` — le build léger met en miroir l'image statique dans Artifact Registry. Avec `custom`, `container_image` est ignoré ; il n'est lu qu'avec `prebuilt`. |
| `cpu_limit` | `1000m` | CPU par instance ; un serveur de fichiers statiques en a peu besoin. |
| `memory_limit` | `512Mi` | Mémoire par instance. Gen2 impose un plancher de 512 Mio ; le bundle statique utilise beaucoup moins. |
| `cpu_always_allocated` | `false` | Facturation basée sur les requêtes — correcte pour un serveur statique sans travail en arrière-plan. |
| `container_port` | `80` | Port d'écoute nginx ; intégré à l'image — ne pas modifier. |
| `min_instance_count` | `0` | Forcé à `0` par l'enveloppe — mise à l'échelle à zéro, aucune instance chaude n'est nécessaire. |
| `max_instance_count` | `3` | Coût/plafond de concurrence. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Excalidraw dans Artifact Registry. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Variables d'environnement supplémentaires en texte clair. Le SPA statique n'en lit aucune à l'exécution ; les remplacements sont rarement utiles. |
| `secret_environment_variables` | `{}` | Inutilisé — Excalidraw n'a pas besoin de secrets. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 5 — Contrôle d'accès et d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Accès public pour que le tableau blanc soit accessible par navigateur. |
| `enable_iap` | `false` | Placez la connexion Google devant Excalidraw pour restreindre l'accès. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupes 10-21 — Stockage, base de données, Redis {#groups-1021--storage-database-redis}

Ces groupes sont **inertes** pour Excalidraw : il n'y a pas de base de
données (`database_type = NONE`), pas de bucket GCS et pas de Redis. Laisser `enable_nfs`, `enable_redis`,
`create_cloud_storage` et les entrées de la base de données à leurs valeurs par défaut ne
provisionne aucune infrastructure inutilisée. Toutes les autres entrées suivent
le comportement standard d'App_CloudRun.

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser
et d'explorer les ressources en cours d'exécution. Les sorties de
stockage/base de données/secrets sont présentes pour la parité d'interface avec
d'autres modules mais se résolvent en valeurs vides ici.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | Détails du service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `storage_buckets` | Buckets Cloud Storage créés — vides pour Excalidraw. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration — vides pour Excalidraw. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration au moteur de fondation [App_CloudRun](App_CloudRun.md), qui
> valide les valeurs *et les combinaisons* au moment de la planification — un
> port hors plage, un runtime `gen1` avec des montages NFS/GCS, IAP sans
> identités autorisées. Une configuration invalide fait échouer le **plan**
> avec une erreur claire et nommée avant la création de toute ressource.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `container_port` | `80` | Élevé | Le nginx de l'image n'écoute que sur le port 80 ; un port non concordant signifie que la sonde de démarrage ne passe jamais et que la révision ne sert jamais. |
| `container_image_source` | `custom` | Élevé | Passer à `prebuilt` sans image miroir pointe le service vers un chemin Artifact Registry non construit (`Image not found`). |
| `memory_limit` | `512Mi` | Moyen | Gen2 rejette `< 512Mi` à l'apply ; le bundle statique n'a pas besoin de plus. |
| `ingress_settings` | `all` | Moyen | `internal` rend le tableau blanc inaccessible depuis un navigateur en dehors du VPC. |
| `application_version` | épingler en production | Moyen | `latest` flotte — une nouvelle balise amont peut modifier l'interface utilisateur/le comportement lors du prochain rebuild. Épinglez une version. |
| `enable_redis` / entrées de base de données | laisser par défaut | Faible | Les activer provisionne Redis/Cloud SQL qu'Excalidraw n'utilise jamais — coût gaspillé, aucun avantage. |
| `homeserver_url` / `homeserver_name` | laisser vide | Faible | Entrées Element vestigiales ; les définir n'a aucun effet sur le SPA Excalidraw. |
| `min_instance_count` | `0` | Faible | La mise à l'échelle à zéro est idéale ici ; forcer `> 0` n'ajoute que des coûts d'inactivité sans état à maintenir chaud. |

---

Pour le comportement de la fondation référencé tout au long — identité de
service, mise à l'échelle et concurrence, ingress et équilibrage de charge,
CI/CD, Cloud CDN, Cloud Armor, IAP, Binary Authorization, VPC-SC et mise en
miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration
d'application spécifique à Excalidraw partagée avec la variante GKE est
décrite dans **[Excalidraw_Common](Excalidraw_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Excalidraw sur Cloud Run](../labs/Excalidraw_CloudRun.md)
  — déployez-le étape par étape, avec les écrans de la console et les
  commandes à chaque étape.
- [Excalidraw sur GKE Autopilot](Excalidraw_GKE.md) — la même application sur
  Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Excalidraw Common — Configuration d'application partagée](Excalidraw_Common.md)
  — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Penpot sur Google Cloud Run](Penpot_CloudRun.md),
  [AFFiNE sur Google Cloud Run](Affine_CloudRun.md) dans la solution
  **Conception et collaboration visuelle**.
