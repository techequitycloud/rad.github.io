---
title: "Homepage sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Homepage sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Homepage_GKE.md @ e69407af sha256:e0adb6414460 -->

# Homepage sur GKE Autopilot {#homepage-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Homepage_GKE.png" alt="Homepage sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

[Homepage](https://gethomepage.dev/) (gethomepage/homepage) est un tableau de
bord d'application/lanceur de services auto-hébergé et hautement
personnalisable — une application Next.js 16 / Node 22 dont toute la
configuration (services, favoris, widgets, mise en page) réside dans une
poignée de fichiers YAML, avec des widgets optionnels de statut/statistiques
en direct pour d'autres applications auto-hébergées que vous exécutez. Ce
module déploie Homepage sur **GKE Autopilot** au-dessus de la fondation
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée
de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Homepage et sur la
manière de les explorer et de les opérer depuis la Google Cloud Console et la
ligne de commande. Pour les mécanismes communs à chaque application GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et le cycle de vie du
déploiement — veuillez vous référer au [guide de la fondation
App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## Ce que coûte Homepage sur RAD, et comment cela se compare {#what-homepage-costs-on-rad-and-how-that-compares}

**L'exécution de Homepage sur un pod GKE Autopilot dans votre propre projet Google Cloud coûte environ 40,29 $/mois en frais Google Cloud**, en plus d'un frais de module RAD unique de 40 crédits facturé une seule fois au moment du déploiement. Homepage est l'application la plus légère de ce lot, et de loin — un tableau de bord statique sans base de données propre — de sorte que son coût d'exécution dans son propre projet est proche du minimum de ce que coûte tout déploiement Cloud Run. Dans un projet géré par RAD, les frais de module tombent à 36 crédits (10 % de moins) et le coût d'exécution est mesuré à l'heure en crédits au lieu d'être facturé directement par Google — voir [Mettre en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) ci-dessous pour l'avantage unique d'un projet géré par RAD qu'un VPS auto-hébergé ne peut égaler — ou voir le [guide Cloud Run](Homepage_CloudRun.md) pour l'option à moindre coût.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module (unique) | 40 crédits | 36 crédits (10 % de moins) |
| Temps de build | ~3-6 crédits par build, dans les deux cas | ~3-6 crédits par build, dans les deux cas |
| Coût d'exécution Google Cloud | 40,29 $/mois, facturé par Google au prix catalogue | ~67 crédits/jour, mesuré au prix catalogue plus la marge de RAD |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Pod GKE Autopilot, 1x vCPU / 0,5 GiB | 34,29 $ |
| Cloud NAT et réseau | 5,00 $ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 $ |
| **Total** | **40,29 $** |

*Les frais de gestion de cluster GKE sont exclus du total ci-dessus car ils sont partagés entre toutes les applications GKE du projet — 0 $ si c'est la seule, sinon environ 73 $/mois répartis entre le nombre d'applications que vous exécutez.*

### Comment cela se compare {#how-it-compares}

- Une comparaison auto-gérée : Hetzner CPX22 (2 vCPU/4 Go) coûte environ 24 $/mois, un Droplet DigitalOcean 2 vCPU/4 Go coûte le même prix de 24 $/mois, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) coûte environ 49 $/mois — nettement plus qu'un tableau de bord de configuration sans besoins de base de données ; une micro-instance à vCPU partagé de 5-6 $/mois de l'un de ces mêmes fournisseurs l'exécuterait confortablement.
- Homepage n'a pas de SaaS commercial hébergé propre — il est distribué uniquement en tant que logiciel auto-hébergé configuré en YAML.
- Comme il n'y a pas de base de données ou de serveur de fichiers ici, l'écart entre un projet géré par RAD et un VPS nu est plus petit que pour presque tout le reste de ce lot — principalement juste le TLS géré, Secret Manager et la surveillance par rapport à le faire à la main.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

C'est l'avantage principal d'un projet géré par RAD, et il ne coûte rien lorsqu'il est en pause.
La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer
le projet purement et simplement — la suppression logique récupérable de 30 jours de Google. Contrairement à la suppression d'un module,
cela ne détruit **pas** Cloud SQL, aucune VM, ou la ressource de calcul une par une : l'ensemble
du projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà
déliée.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de restaurer le
projet et de rattacher son compte de facturation, puis vous demande d'exécuter la mise à jour sur chaque déploiement pour
confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve
les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture
jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits (moins de 1 $ US) au total pour une chaîne de déploiement typique de 2-3.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD gère uniquement la facturation), vous devez
le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est
admise comme la création d'un nouveau projet, donc votre solde de crédits achetés doit toujours dépasser
le seuil du palier (100 crédits pour le palier sandbox que la plupart des utilisations d'étude/démo conviennent). Google indique que la plupart des services sont
entièrement fonctionnels à nouveau dans les 36 heures suivant une restauration.

Un véritable écart : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a
la suppression logique de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous
supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez
personnalisé Homepage et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive, ou un bucket
en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable,
cela n'a pas d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que 30 jours se sont écoulés sur un projet géré par RAD, il n'y a pas de pause gratuite —
la suppression supprime les ressources définitivement, et ramener Homepage signifie redéployer à partir de
zéro. Cela coûte environ 43-46 crédits (les frais de module de 40 crédits plus un build).

La suppression ne permet d'économiser de l'argent que si Homepage reste inutilisé assez longtemps pour compenser ce
coût de redéploiement par rapport à son propre coût d'exécution — pour Homepage, cela représente environ 4 jours ou
plus. La majeure partie de ce coût d'exécution est généralement la base de données (et, lorsque ce module en utilise une, la VM de serveur de fichiers partagé ou le cluster GKE) — ceux-ci ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc la suppression de cette application alors que quelque chose d'autre partage le projet n'économise que sa propre part de calcul.

Conservez d'abord les données : les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui,
donc copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de labo et environnements gérés {#lab-sessions-and-managed-environments}

Sessions de labo, pour la formation : un formateur anime une session pour une classe. Chaque participant obtient
l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une
allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne.
Tout est supprimé à la fin de la session et les crédits non utilisés sont restitués au formateur.

Environnements gérés, pour les sociétés de conseil : un partenaire exécute l'application pour un client à partir d'un
portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible,
la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le
partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR,
par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les propres frais de RAD et les estimations de crédits quotidiens ; [documentation de Google sur la suppression/restauration de projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les affirmations de pause/restauration.

## 1. Vue d'ensemble {#1-overview}

Homepage s'exécute en tant que pod Node.js/Next.js unique sur GKE Autopilot.
Comme la variante Cloud Run, il n'a **pas de base de données et pas de cache**
— son état entier est un répertoire de fichiers YAML. Ce qui est différent
sur GKE, c'est la couche de stockage elle-même : Cloud Run n'a pas de concept
de PVC, donc `Homepage_CloudRun` utilise toujours un volume GCS FUSE ;
`Homepage_GKE` utilise par défaut la même approche GCS FUSE mais
offre en plus un véritable PVC de stockage en bloc comme option explicite.

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pod Node.js unique, `1000m` CPU / `1Gi` mémoire par défaut |
| Base de données | aucune | Homepage n'a aucune base de données ; `database_type = "NONE"` |
| Stockage d'objets | Cloud Storage (par défaut) **ou** un PVC de bloc | Par défaut : un bucket `storage` monté à `/app/config` via le pilote CSI GCS FUSE. Avec `stateful_pvc_enabled = true` : un PVC `standard-rwo` par pod (`5Gi` par défaut) au même chemin à la place, et la charge de travail devient un `StatefulSet` |
| Cache et file d'attente | aucun | `enable_redis = false` est codé en dur dans `main.tf`, remplaçant la valeur par défaut de la fondation `true` |
| Secrets | aucun | Aucun secret n'est généré — Homepage n'a pas besoin de ses propres identifiants |
| Ingress | Cloud Load Balancing | Service `LoadBalancer` par défaut, avec un domaine personnalisé optionnel + certificat géré ; `ClusterIP` est disponible pour les déploiements internes uniquement ou soumis à des quotas |

**Valeurs par défaut judicieuses à connaître à l'avance :**

- **Véritablement pré-construit — pas d'image personnalisée, pas de Cloud Build pour l'application.**
  `Homepage_Common` définit `image_source = "prebuilt"` et
  `container_build_config.enabled = false` ; `ghcr.io/gethomepage/homepage` est
  déployé directement. `enable_image_mirroring = true` le copie toujours dans
  Artifact Registry (évite les limites de débit de GHCR), mais c'est un miroir, pas un
  build.
- **Port 3000, chemin de santé `/api/healthcheck`.** Confirmé via un
  déploiement en direct : `GET /api/healthcheck` renvoie un `200 "up"`
  non authentifié une fois l'application prête (soutenu par la directive
  `HEALTHCHECK` de l'image).
  `GET /` renvoie le véritable HTML du tableau de bord (confirmé : `<title>Homepage</title>`).
- **Deux configurations de stockage, choisies par `stateful_pvc_enabled`.** La valeur par défaut
  (`false`) exécute un `Deployment` sans état avec le bucket GCS
  `storage` monté à `/app/config` — identique en forme à
  `Homepage_CloudRun`.
  Le paramétrage `true` bascule vers un `StatefulSet` avec un véritable
  PVC de stockage en bloc au même chemin (le volume GCS est alors
  automatiquement désactivé pour éviter un double montage). C'est une
  différence authentique et délibérée, dictée par la plateforme — GKE a des
  PVC, Cloud Run non — et non une incohérence entre les deux variantes.
  **Le mode PVC de bloc est ce qui a été vérifié en direct pour ce module**
  (voir §3).
- **Pas de base de données, pas de Redis — architecturalement inhabituel pour ce catalogue.**
  Presque tous les autres modules d'application connectent une instance Cloud SQL et/ou
  Redis via la fondation ; Homepage n'a besoin ni de l'un ni de l'autre. Cela signifie également qu'il
  n'a aucune des classes de bugs habituelles de câblage DSN, socket-vs-TCP ou encodage d'URL de mot de passe
  documentées ailleurs dans ce référentiel — il n'y a tout simplement pas de connexion à la base de données à
  mal configurer.
- **La sécurité multi-instance dépend du mode de stockage.** En mode GCS FUSE par défaut,
  `max_instance_count > 1` est réellement sûr — chaque pod lit
  le même bucket partagé en direct depuis le disque, sans cache en cours de traitement. Avec
  `stateful_pvc_enabled = true`, chaque ordinal de pod `StatefulSet` obtient son
  **propre PVC séparé** (sémantique Kubernetes standard `volumeClaimTemplates`) —
  l'exécution de plus d'un réplica dans ce mode donne à chaque pod une
  configuration divergente indépendamment, et non un tableau de bord partagé. Gardez
  `max_instance_count = 1` chaque fois que le PVC de bloc est activé.
- **Pas d'authentification propre.** `HOMEPAGE_ALLOWED_HOSTS` par défaut à
  `"*"` — cela ne filtre que la vérification de l'en-tête `Host` sur les appels de données de widget `/api/*` de Homepage,
  pas un véritable contrôle d'accès. Placez-le derrière IAP, un VPN ou un
  proxy inverse si vous devez restreindre qui peut y accéder.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et
les autres identifiants sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Homepage {#a-gke-autopilot--the-homepage-workload}

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail Homepage pour les pods, les révisions et les événements. Kubernetes Engine → Services et Ingress affiche l'adresse IP externe (si `service_type = LoadBalancer`).
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  # If stateful_pvc_enabled = true, the workload is a StatefulSet:
  kubectl get statefulset -n "$NAMESPACE"
  # Otherwise it is a Deployment:
  kubectl get deploy -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" <pod-name> --tail=100
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de charge de travail (Déploiement vs StatefulSet).

### B. Stockage — `/app/config` {#b-storage--appconfig}

Le mécanisme de stockage dépend de `stateful_pvc_enabled` :

- **Par défaut (`false`) — GCS FUSE.** Le bucket `storage` est monté à
  `/app/config` via le pilote CSI GCS FUSE. Il contient tous les fichiers de configuration YAML
  lus par Homepage (`settings.yaml`, `services.yaml`, `bookmarks.yaml`,
  `widgets.yaml`, `docker.yaml`) ainsi que les journaux de Homepage.
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~homepage"
  gcloud storage ls "gs://<bucket-name>/"
  gcloud storage cat "gs://<bucket-name>/settings.yaml"
  ```
- **Optionnel (`true`) — PVC de bloc.** Un PVC `standard-rwo` par pod (`5Gi`
  par défaut) est monté à `/app/config` à la place. Inspectez-le directement :
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl exec -n "$NAMESPACE" <pod-name> -- ls -la /app/config
  kubectl exec -n "$NAMESPACE" <pod-name> -- cat /app/config/settings.yaml
  ```
  Il n'y a pas de bucket GCS à inspecter dans ce mode — la sortie `storage_buckets`
  n'est remplie que lorsque le module s'exécute dans sa configuration par défaut (sans PVC).

### C. Secret Manager {#c-secret-manager}

Rien à voir ici — Homepage ne génère aucun secret. Confirmer cela est
en soi une vérification de bon sens utile sur un nouveau déploiement :

```bash
gcloud secrets list --project "$PROJECT" --filter="name~homepage"
# expect: no results
```

### D. Réseau et ingress {#d-networking--ingress}

```bash
kubectl get svc -n "$NAMESPACE"
gcloud compute addresses list --project "$PROJECT" --filter="name~homepage"
```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails de l'IP statique.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

```bash
kubectl logs -n "$NAMESPACE" <pod-name> --tail=100
gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
  --project "$PROJECT" --limit 50
```

---

## 3. Comportement de l'application Homepage {#3-homepage-application-behaviour}

- **Pas de job de schéma de base de données au premier déploiement.** Homepage n'a pas de base de données, donc
  `initialization_jobs` est vide par défaut et aucun job n'est nécessaire.
- **Pas d'assistant de configuration au premier démarrage.** Il n'y a pas de compte administrateur à créer et pas de
  flux d'intégration — Homepage affiche son tableau de bord à partir de la configuration
  existante dans `/app/config` (les valeurs par défaut intégrées de l'image en amont sur un
  nouveau déploiement, puisque le point d'entrée auto-initialise tout fichier manquant).
  Personnalisez le tableau de bord en modifiant directement les fichiers YAML (via le bucket GCS ou
  `kubectl exec`, selon le mode de stockage — voir §2B) ou en
  configurant `docker.yaml`/la découverte basée sur les étiquettes si vous le connectez à une
  API Docker/Kubernetes.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent toutes deux
  `GET /api/healthcheck` — un `200 "up"` non authentifié, confirmé en direct.

### Vérifié en direct : StatefulSet + PVC de bloc {#verified-live-statefulset--block-pvc}

Le premier déploiement de ce module a utilisé `stateful_pvc_enabled = true` (défini dans
`config/deploy.tfvars`), exerçant le chemin de stockage PVC de bloc de bout en bout :

- Le pod `<service>-0` a signalé `1/1 Running` avec **0 redémarrages**.
- Le PVC `data-<service>-0` a signalé `Bound`.
- Les journaux de démarrage ont montré une séquence propre : une correction de propriété de répertoire de configuration, le
  serveur Next.js devenant prêt, puis `settings.yaml`/`kubernetes.yaml`
  s'auto-amorçant sur le PVC vide sans erreurs.
- `GET /api/healthcheck` a renvoyé `200 "up"`.
- `GET /` a renvoyé le véritable HTML du tableau de bord (`<title>Homepage</title>`), pas
  un espace réservé ou une page d'erreur.
- Les fichiers PVC étaient correctement possédés (`node:node`) — l'étape chown du point d'entrée
  au démarrage a géré cela ; le GCS FUSE `uid=1000`/`gid=1000`
  `mount_options` documenté pour `Homepage_CloudRun` et la disposition GKE par défaut
  ne sont tout simplement pas en jeu dans ce mode, car aucun volume GCS n'est
  monté lorsque `stateful_pvc_enabled = true`.

Le déploiement a également confirmé que la contrainte de quota d'IP externe du projet a conduit à
`service_type = "ClusterIP"` et `reserve_static_ip = false` pour ce
déploiement spécifique (voir `config/deploy.tfvars`) plutôt que les valeurs par défaut
`LoadBalancer`/`reserve_static_ip = true` du module — un choix au niveau du projet,
pas une exigence du module. L'accès a été vérifié via
`kubectl port-forward` plutôt qu'une IP externe.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement.
Seuls les paramètres spécifiques ou notables pour Homepage sont listés ; toute autre
entrée est héritée de [App_GKE](App_GKE.md) avec son comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `homepage` | Nom de base pour les ressources. |
| `application_display_name` | `Homepage` | Nom lisible par l'homme affiché dans l'interface utilisateur de la plateforme. |
| `application_version` | `latest` | Transmis directement comme balise d'image `ghcr.io/gethomepage/homepage` — pas d'étape de build. |
| `homepage_allowed_hosts` | `*` | `HOMEPAGE_ALLOWED_HOSTS` — liste blanche d'en-têtes `Host` séparés par des virgules pour les propres appels `/api/*` de Homepage. Pas une véritable limite de contrôle d'accès. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_port` | `3000` | Port du serveur autonome Next.js de Homepage. Fixé par `Homepage_Common` ; non transféré à `App_GKE`. |
| `container_image_source` | `prebuilt` | Déploie `ghcr.io/gethomepage/homepage` directement — pas de Cloud Build pour l'application. |
| `cpu_limit` / `memory_limit` | `1000m` / `1Gi` | Léger — Homepage est un serveur autonome Next.js unique. |
| `min_instance_count` / `max_instance_count` | `1` / `3` | Plusieurs réplicas ne sont sûrs qu'en mode de stockage GCS FUSE par défaut — voir §1 et §3. Gardez `max_instance_count = 1` lorsque `stateful_pvc_enabled = true`. |
| `enable_image_mirroring` | `true` | Met en miroir l'image pré-construite dans Artifact Registry (évite les limites de débit de GHCR) — pas un build. |
| `enable_cloudsql_volume` | `false` | Homepage n'a pas de Cloud SQL — gardez `false`. |

### Groupe 6 — Configuration du backend GKE {#group-6--gke-backend-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `workload_type` | `null` (résout en `Deployment`) | Résout automatiquement en `StatefulSet` lorsque `stateful_pvc_enabled = true`. |
| `service_type` | `LoadBalancer` | Homepage est un tableau de bord accessible par navigateur ; utilisez `ClusterIP` pour un accès interne uniquement ou des projets soumis à des quotas (la vérification en direct de ce module a utilisé `ClusterIP`). |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `false` | `true` bascule Homepage vers un `StatefulSet` avec un véritable PVC de bloc à `/app/config` au lieu du volume GCS FUSE par défaut — le mode vérifié en direct pour ce module. |
| `stateful_pvc_size` | `5Gi` | La configuration YAML de Homepage et les journaux sont minuscules ; dimensionnés au minimum de la plateforme. |
| `stateful_pvc_mount_path` | `/app/config` | Même chemin que le montage GCS FUSE par défaut — les deux sont mutuellement exclusifs, jamais doublement montés. |
| `stateful_fs_group` | `3000` | `fsGroup` au niveau du pod pour le PVC de bloc (valeur par défaut du graphique Helm en amont). |

### Groupe 11 — Automatisation de la charge de travail {#group-11--workload-automation}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Reste vide par défaut — rien à amorcer. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `gcs_volumes` | `[]` | Le montage du bucket `storage` à `/app/config` est ajouté automatiquement **uniquement** lorsque `stateful_pvc_enabled = false` ; utilisez ceci pour des volumes *supplémentaires* uniquement. |

### Groupe 16 — Base de données {#group-16--database}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixé par `Homepage_Common` — Homepage n'a pas de base de données SQL, point final. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `/api/healthcheck` | `200 "up"` non authentifié — une valeur par défaut précise correspondant à la directive `HEALTHCHECK` de l'image, transmise inchangée depuis `Homepage_Common`. |

---

## 5. Sorties {#5-outputs}

| Sortie | Description |
|---|---|
| `service_name` / `service_url` | Nom du service Kubernetes et URL du tableau de bord (port 3000). |
| `namespace` | Espace de noms Kubernetes dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` / `service_external_ip` | ClusterIP interne au cluster / IP externe du LoadBalancer (lorsqu'elle est réservée). |
| `storage_buckets` | Le bucket `storage` supportant `/app/config` — rempli uniquement en mode de stockage par défaut, sans PVC. |
| `statefulset_name` | Nom du StatefulSet — rempli uniquement lorsque `stateful_pvc_enabled = true`. |
| `container_image` / `container_registry` | La référence de l'image déployée et le dépôt Artifact Registry. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `initialization_jobs` | Noms des jobs d'initialisation créés (vide pour Homepage). |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `max_instance_count` avec `stateful_pvc_enabled = true` | Garder à `1` | Élevé | Chaque ordinal de pod StatefulSet obtient son propre PVC séparé (pas de stockage partagé) — la mise à l'échelle au-delà d'un réplica en mode PVC de bloc donne à chaque pod une configuration de tableau de bord divergente indépendamment, et non une configuration partagée cohérente. |
| `stateful_pvc_mount_path` / `gcs_volumes` à `/app/config` | Laisser le montage automatique en place, quel que soit le mode utilisé | **Critique** | La suppression ou la mauvaise configuration de ce volume entraîne la perte de tous les fichiers de configuration YAML lors du prochain démarrage à froid ou de la replanification du pod — Homepage n'a pas d'autre source de vérité. |
| `HOMEPAGE_ALLOWED_HOSTS` | Laisser `*` à moins de connaître le nom d'hôte final, puis le restreindre | Moyen | Une valeur trop étroite renvoie des 400 pour chaque widget basé sur l'API (le shell de la page se charge toujours) si le nom d'hôte de la requête réelle ne correspond pas ; le traiter comme une véritable limite d'authentification est un faux sentiment de sécurité de toute façon. |
| Chemin de la sonde | Laisser à `/api/healthcheck` | Élevé | Un chemin de sonde authentifié ou inexistant laisserait le pod en permanence `Ready=False` même si l'application a démarré correctement. |
| `enable_redis` | Laisser le `false` codé en dur tel quel (ne pas tenter de le forcer via `environment_variables`) | Faible | Homepage n'a rien à mettre en cache ; l'activation de Redis gaspille une dépendance Memorystore/NFS-Redis sans aucun avantage. |
| `workload_type = "Deployment"` avec `stateful_pvc_enabled = true` | Laisser `workload_type` non défini (`null`) | Faible | Une garde de validation au moment de la planification rejette purement et simplement cette combinaison — un modèle de PVC nécessite un StatefulSet. |
| `service_type` | `LoadBalancer` sauf si soumis à des quotas | Moyen | `ClusterIP` nécessite `kubectl port-forward` pour l'accès — bien pour une utilisation interne ou des projets à quota limité (comme utilisé dans la propre vérification en direct de ce module), mais non accessible depuis un navigateur sans cela. |

---

Pour le comportement de la fondation référencé tout au long — Workload Identity,
autoscaling, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Homepage
partagée avec la variante Cloud Run est décrite dans
**[Homepage_Common](Homepage_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Labo pratique : Homepage sur GKE Autopilot](../labs/Homepage_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Homepage sur Google Cloud Run](Homepage_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Homepage Common — Configuration d'application partagée](Homepage_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Jellyfin sur GKE Autopilot](Jellyfin_GKE.md), [Prowlarr sur GKE Autopilot](Prowlarr_GKE.md), [Seerr sur GKE Autopilot](Seerr_GKE.md), [Jellystat sur GKE Autopilot](Jellystat_GKE.md) dans la solution **Media Server**.
