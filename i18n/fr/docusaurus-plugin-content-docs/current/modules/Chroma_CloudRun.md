---
title: "Chroma sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Chroma sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Chroma_CloudRun.md @ 1665a43e sha256:d6c8fbc56d00 -->

# Chroma sur Google Cloud Run {#chroma-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Chroma_CloudRun.png" alt="Chroma sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Chroma est une base de données vectorielle open source native de l'IA, conçue
spécifiquement pour les embeddings et la recherche de similarité. Elle alimente les
pipelines RAG, la recherche sémantique et les workflows LangChain/LlamaIndex. Ce
module déploie Chroma sur **Cloud Run v2** au-dessus du socle
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google
Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Chroma et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à chaque application Cloud Run — identité de
service, ingress et équilibrage de charge, mise à l'échelle et concurrence, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de
vie du déploiement — veuillez vous référer au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## Ce que coûte Chroma sur RAD, et comment cela se compare {#what-chroma-costs-on-rad-and-how-that-compares}

**Le module Cloud Run de Chroma sur RAD coûte environ 19,14 $ US par mois dans un projet Google Cloud que vous possédez, plus des frais de module uniques de 40 crédits (4 $ US).** Chroma est une base de données vectorielle native de l'IA pour les embeddings et la recherche de similarité, utilisée pour soutenir les pipelines RAG et la recherche sémantique. GKE Autopilot convient à Chroma qui doit rester actif, s'adapter à plusieurs pods ou s'exécuter à côté d'autres charges de travail Kubernetes ; pour le coût le plus bas, ce module Cloud Run est généralement le bon choix — consultez le [guide GKE](Chroma_GKE.md) si vous avez besoin de l'autre.

Si Chroma n'est nécessaire qu'occasionnellement — une démo, un essai, une charge de travail saisonnière ou d'étude — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits, de sorte que 19,14 $ US deviennent quelques dollars par mois. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 40 crédits (4 $ US au prix de la recharge) | 36 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build (environ 3–6) | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **19,14 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **9 crédits par jour**, environ 270 par mois (environ 27 $ US au prix de la recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US lors d'une recharge ponctuelle, moins sur un plan. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par chaque application du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Cloud Run, 1x vCPU / 1 Gio (chaud) | 13,14 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| **Total** | **environ 19,14 $ US** |

### Comment cela se compare {#how-it-compares}

- L'offre gérée du projet, **Chroma Cloud**, commence à 0 $ par mois plus l'utilisation (10 bases de données, 5 $ de crédits inclus — environ 2,50 $/Gio écrit, 0,33 $/Gio stocké par mois, et une petite charge par requête et par Gio retourné), passant à 250 $ par mois plus l'utilisation sur le plan Team.
- Si vous l'exécutez vous-même, un petit VPS exécutant le propre processus serveur de Chroma coûte moins cher en espèces : une boîte Hetzner CPX22 ou DigitalOcean 2 vCPU/4 Go coûte environ 24 $ par mois, ou un GCP `e2-standard-2` environ 49 $ par mois — plus votre propre temps pour les sauvegardes, les correctifs de sécurité et les mises à niveau, que Cloud SQL géré, Secret Manager et la surveillance de RAD couvrent pour vous.
- RAD ne prétend jamais être moins cher que l'infrastructure nue en termes monétaires — ce n'est généralement pas le cas. La différence est ce que RAD gère pour vous : les correctifs, les sauvegardes, les secrets et la surveillance, ainsi que la possibilité de mettre Chroma en pause gratuitement plutôt que de payer pour une capacité inactive (voir ci-dessous).

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Chroma s'exécute dans **un projet géré par RAD pour vous**, vous avez une deuxième option qui va bien au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour presque rien.** Cela convient bien mieux à Chroma dont vous n'avez besoin qu'occasionnellement que de le faire fonctionner en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le projet. Google ne supprime pas le projet immédiatement : il le conserve, récupérable, pendant 30 jours. Comme la facturation est déjà déliée, rien n'est facturé pendant qu'il attend. Contrairement à la suppression d'un module, cela ne supprime pas les ressources Cloud Run une par une — l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet peut le restaurer. RAD demande à Google de récupérer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter **Mettre à jour** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela représente une poignée de crédits (moins de 1 $ US) au total pour une chaîne Chroma typique, contre les 45 crédits que coûte un redéploiement complet.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, pas 19,14 $ US.** Déployez Chroma, utilisez-le, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Mettre à jour, et supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez les frais de module qu'une seule fois, les builds, et les heures pendant lesquelles il était réellement actif.
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet que vous apportez et dont RAD ne gère que la facturation), et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime définitivement. La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés doit toujours dépasser le seuil du palier (100 crédits pour le palier sandbox que la plupart des utilisations d'étude et de démonstration conviennent). Google indique que la plupart des services sont de nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.
- **Un véritable manque : le bucket de sauvegarde ne survit pas.** Les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket n'est **pas** protégé par la suppression logicielle de Cloud Storage, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé Chroma et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Cloud Run conserve une instance chaude, il ne se met donc pas complètement à l'échelle zéro par lui-même. L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ 45 crédits (4,50 $ US) dans votre propre projet. La suppression ne permet d'économiser de l'argent que si Chroma devait rester inutilisé pendant environ 8 jours ou plus dans votre propre projet (0,64 $ US par jour), ou environ 5 jours ou plus dans un projet géré par RAD (9 crédits par jour).
- **Conservez d'abord vos données.** Les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du déploiement et sont supprimées avec celui-ci, alors copiez la dernière sauvegarde avant de la supprimer si vous souhaitez la conserver.
- **Notez vos paramètres.** RAD ne recrée pas un déploiement supprimé pour vous ; vous saisissez à nouveau les paramètres lorsque vous déployez.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant obtient l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés retournent au formateur.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, afin que personne ne reçoive de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais propres à RAD et estimations de crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour la fenêtre de récupération de 30 jours et ce qu'elle dit sur les objets Cloud Storage sans suppression logicielle ; [Chroma Cloud](https://www.trychroma.com/pricing). Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Chroma s'exécute en tant que service de base de données vectorielle conteneurisée sur
Cloud Run v2. Le déploiement connecte un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 (Gen2) | 1 vCPU / 1 Gio par défaut ; `min_instance_count = 1` pour éviter les démarrages à froid de rechargement d'index |
| Persistance des données | Cloud Storage (GCS FUSE) | Bucket `<prefix>-data` auto-provisionné monté à `/data` ; backend de stockage principal |
| Jeton d'authentification | Secret Manager | Jeton d'API optionnel — `CHROMA_SERVER_AUTHN_CREDENTIALS` injecté à l'exécution |
| Ingress | URL interne Cloud Run | `ingress_settings = "internal"` par défaut ; équilibreur de charge HTTPS optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de base de données SQL et pas de Redis.** Chroma gère son propre stockage
  embarqué. Aucune instance Cloud SQL n'est créée et aucune connexion Redis n'est
  configurée.
- **`ingress_settings = "internal"` par défaut.** La sortie `chroma_api_url` n'est pas
  accessible depuis l'internet public avec ce paramètre. Le passage à `"all"`
  nécessite `enable_auth_token = true` (appliqué au moment de la planification).
- **Instance unique requise.** `max_instance_count = 1` est la valeur par défaut. Plusieurs
  instances Cloud Run sur le même montage GCS FUSE ne peuvent pas coordonner les
  écritures et corrompront les collections.
- **GCS FUSE est le backend de persistance.** Un bucket `<prefix>-data` est
  automatiquement provisionné et monté à `/data`. L'environnement
  d'exécution Gen2 est requis.
- **Le jeton d'authentification est optionnel mais recommandé** pour tout déploiement
  accessible en dehors du VPC. Lorsqu'il est activé, le jeton est stocké dans Secret
  Manager et doit être passé comme `Authorization: Bearer <token>` dans chaque appel d'API.
- **Les sondes de santé sont fixées à `/api/v2/heartbeat`.** C'est le seul point de
  terminaison de santé que Chroma expose ; le chemin de la sonde ne peut pas être
  modifié.
- **La télémétrie anonymisée est toujours désactivée.** `ANONYMIZED_TELEMETRY=false` est
  injecté automatiquement.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis.
Les noms de services et de ressources sont indiqués dans les [Sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service Chroma {#a-cloud-run--the-chroma-service}

Chroma s'exécute en tant que service Cloud Run v2. Chaque déploiement crée une
révision immuable ; le trafic peut être réparti entre les révisions pour des
déploiements sûrs. `cpu_always_allocated` est par défaut `false` (facturation
basée sur les requêtes) ; définissez-le sur `true` (avec `min_instance_count
>= 1`)
pour maintenir le CPU alloué entre les requêtes afin que les opérations d'indexation
en arrière-plan et les vérifications de santé ne soient jamais limitées.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic,
  les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud Storage (GCS FUSE) — persistance des données Chroma {#b-cloud-storage-gcs-fuse--chroma-data-persistence}

Chroma stocke sa base de données SQLite embarquée, ses fichiers d'index HNSW et ses
métadonnées de collection au chemin `/data`. Un bucket Cloud Storage dédié
(`<prefix>-data`) est automatiquement provisionné et monté à `/data`
via le pilote CSI GCS FUSE. Le compte de service Cloud Run se voit accorder un accès
en lecture/écriture automatiquement.

- **Console :** Cloud Storage → Buckets — recherchez le bucket dont le nom se
  termine par `-data`.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/chroma/    # inspect Chroma's on-disk layout
  # Confirm the GCS FUSE mount inside a running instance:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.volumes)'
  ```

Voir [App_CloudRun](App_CloudRun.md) pour GCS Fuse, les options CMEK et la gestion
des buckets.

### C. Secret Manager {#c-secret-manager}

Lorsque `enable_auth_token = true`, le jeton d'authentification de l'API de Chroma est généré
et stocké en tant que secret Secret Manager. Il est injecté dans le service au moment
de l'exécution en tant que `CHROMA_SERVER_AUTHN_CREDENTIALS` ; le texte en clair n'apparaît jamais dans la
configuration.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  # Retrieve the token to configure API clients:
  gcloud secrets versions access latest --secret=<prefix>-auth-token --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### D. Réseau et ingress {#d-networking--ingress}

Par défaut, le service n'est accessible qu'au sein du VPC (`ingress_settings = "internal"`). Un
équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud
Armor peuvent être superposés ; les paramètres d'egress contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  # Test the Chroma heartbeat from inside the VPC:
  curl <internal-service-url>/api/v2/heartbeat
  ```

Voir [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les journaux de conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run sont
envoyées à Cloud Monitoring, avec une vérification de disponibilité optionnelle
contre `/api/v2/heartbeat` et des stratégies d'alerte.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord /
  Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Chroma {#3-chroma-application-behaviour}

- **Pas de bootstrap de base de données.** Chroma gère son propre stockage embarqué
  et ne nécessite aucun job d'initialisation de base de données. Aucun job `db-init`
  n'est injecté. Si vous fournissez des `initialization_jobs` personnalisés, ils s'exécutent
  en tant que jobs Cloud Run avant la mise à jour du service.
- **Chargement d'index au démarrage à froid.** Lorsqu'une nouvelle instance démarre
  (après une mise à l'échelle à zéro ou une nouvelle révision), elle charge les index
  HNSW depuis le bucket GCS. Pour les grandes collections, cela peut prendre des
  dizaines de secondes ; la sonde de démarrage à `/api/v2/heartbeat` attend que Chroma
  signale sa disponibilité. Gardez `min_instance_count = 1` pour éviter cela à chaque requête.
- **Contrainte d'instance unique.** Chroma est un stockage à écrivain unique.
  Plusieurs instances Cloud Run sur le même montage GCS FUSE corrompront les
  collections car il n'y a pas de verrou d'écriture distribué. Gardez toujours
  `max_instance_count = 1`. Mettez à l'échelle verticalement (augmentez le CPU et la mémoire)
  plutôt qu'horizontalement.
- **Utilisation du jeton d'authentification.** Lorsque `enable_auth_token = true`, tous les appels
  d'API doivent inclure `Authorization: Bearer <token>`. Récupérez le jeton de Secret Manager, puis
  utilisez-le :
  ```bash
  TOKEN=$(gcloud secrets versions access latest \
    --secret=<prefix>-auth-token --project "$PROJECT")
  curl -H "Authorization: Bearer $TOKEN" <service-url>/api/v2/collections
  ```
  Client Python :
  ```python
  import chromadb
  client = chromadb.HttpClient(
      host="<service-hostname>", port=443, ssl=True,
      headers={"Authorization": f"Bearer {TOKEN}"}
  )
  ```
- **Sonde de santé.** Les sondes de démarrage et de vivacité ciblent toutes deux
  `/api/v2/heartbeat` via HTTP. Le chemin de la sonde est fixé par Chroma_Common et ne peut
  pas être modifié. La sonde de démarrage permet un délai initial de 15 secondes pour
  accommoder le montage GCS FUSE et le chargement de l'index.
- **Tâches planifiées.** Chroma n'a pas de commandes planifiées intégrées. Utilisez
  `cron_jobs` si vous avez besoin de captures instantanées de collection périodiques
  ou de tâches de maintenance, déclenchées par Cloud Scheduler.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres spécifiques ou notables pour Chroma sont listés
; toutes les autres entrées sont héritées de [App_CloudRun](App_CloudRun.md) avec
leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |
| `enable_auth_token` | `false` | Génère un jeton d'API aléatoire et le stocke dans Secret Manager. Recommandé pour tout déploiement accessible en dehors du VPC. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `chroma` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Chroma Vector Database` | Nom convivial affiché dans la console. |
| `description` | _(défini)_ | Description du service Cloud Run. |
| `application_version` | `latest` | Tag de version de l'image Chroma. Épinglez à une version spécifique pour des déploiements reproductibles. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance ; augmentez à `2000m`+ pour les charges de travail de requêtes en production. |
| `memory_limit` | `1Gi` | Mémoire par instance. Chroma charge les index HNSW en mémoire — taille basée sur le nombre de collections et les dimensions vectorielles. |
| `min_instance_count` | `1` | Instances minimales. Gardez ≥ 1 pour éviter les démarrages à froid de rechargement d'index. |
| `max_instance_count` | `1` | Instances maximales. Gardez à 1 — plusieurs instances sur le même chemin GCS FUSE corrompront les collections. |
| `container_port` | `8000` | Port de l'API REST Chroma. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages GCS FUSE. |
| `cpu_always_allocated` | `false` | Facturation basée sur les requêtes par défaut ; définissez `true` pour maintenir le CPU alloué entre les requêtes et éviter les délais d'expiration des opérations d'indexation en arrière-plan. |
| `timeout_seconds` | `300` | Durée maximale de la requête. Augmentez pour les grandes recherches de similarité par lots. |
| `enable_cloudsql_volume` | `false` | Non applicable — Chroma n'a pas de base de données SQL. |
| `enable_image_mirroring` | `true` | Mettez en miroir l'image Chroma dans Artifact Registry pour éviter les limites de débit de Docker Hub. |
| `traffic_split` | `[]` | Allocation de trafic Canary/blue-green entre les révisions. |
| `max_revisions_to_retain` | `7` | Nombre maximal de révisions Cloud Run à conserver. |

### Groupe 5 — Accès et réseau {#group-5--access--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `internal` | Gardez `internal` pour que Chroma ne soit accessible qu'au sein du VPC. Définir `all` nécessite `enable_auth_token = true` (appliqué au moment de la planification). |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Mode d'egress VPC. |
| `enable_iap` | `false` | Exiger l'authentification Google Identity via IAP. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. `ANONYMIZED_TELEMETRY=false` et `CHROMA_SERVER_HTTP_PORT=8000` sont toujours injectés. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Période de rappel de rotation des secrets (30 jours). |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). Laissez vide pour désactiver. |
| `backup_retention_days` | `7` | Rétention en jours. Augmentez pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`, `binauthz_evaluation_mode`,
`additional_cloudrun_sa_roles`.

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — non applicable à Chroma (pas de base de données SQL). Ces
variables sont acceptées pour la compatibilité du socle mais n'ont aucun effet. Voir
[App_CloudRun](App_CloudRun.md).

### Groupe 10 — Équilibreur de charge, CDN et Artifact Registry {#group-10--load-balancer-cdn--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionne un équilibreur de charge HTTPS global avec Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | CIDR exemptés des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Active Cloud CDN sur l'équilibreur de charge HTTPS. Nécessite `enable_cloud_armor = true`. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne des buckets GCS. Le bucket `<prefix>-data` est provisionné automatiquement par Chroma_Common. |
| `storage_buckets` / `gcs_volumes` | _(défini)_ | Buckets supplémentaires / montages GCS FUSE. |
| `enable_nfs` | `false` | Monte Cloud Filestore NFS (nécessite gen2). Chroma utilise GCS pour le stockage principal ; activez uniquement pour les jobs d'initialisation personnalisés. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage du conteneur NFS. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

Non applicable — Chroma n'a pas de base de données SQL. Les variables suivantes sont
acceptées uniquement pour la compatibilité du socle et sont fixes ou ignorées :
`database_type` (fixé à `NONE`), `database_password_length`, `enable_auto_password_rotation`,
`rotation_propagation_delay_sec`, `db_host_env_var_name`, `db_user_env_var_name`,
`db_name_env_var_name`, `db_port_env_var_name`, `service_url_env_var_name`.

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Chroma ne nécessite pas de job d'initialisation par défaut. Fournissez des jobs uniquement pour le chargement de données personnalisé. |
| `cron_jobs` | `[]` | Jobs récurrents déclenchés par Cloud Scheduler (par exemple, instantanés de collection). |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `startup_probe_config` | `/api/v2/heartbeat` | Sonde de démarrage HTTP — Chroma renvoie 200 une fois entièrement initialisé. Le chemin de la sonde est fixe. |
| `liveness_probe` / `health_check_config` | `/api/v2/heartbeat` | Sonde de vivacité. |
| `uptime_check_config` | `enabled=false, path=/api/v2/heartbeat` | Vérification de disponibilité Cloud Monitoring ; désactivée par défaut. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 23 — VPC Service Controls et journalisation d'audit {#group-23--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `chroma_api_url` | URL VPC interne pour l'API Chroma v2 (ajoutez `/collections`, `/heartbeat`, etc.). Accessible uniquement au sein du VPC lorsque `ingress_settings` est `internal`. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | Détails du service spécifiques à l'étape (Cloud Deploy). |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Statut de surveillance, canaux, vérifications de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration personnalisés. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | Statut et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | Statut VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et statut CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service
> dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `enable_auth_token` | `true` pour tout déploiement accessible de l'extérieur | Critique | Sans jeton, tout appelant pouvant atteindre l'API Chroma peut lire, écrire ou supprimer chaque collection. |
| `ingress_settings` | `internal` (par défaut) | Élevé | Changer pour `"all"` sans `enable_auth_token = true` expose une base de données vectorielle non authentifiée à l'internet public (bloqué au moment de la planification). |
| `max_instance_count` | `1` | Élevé | Plusieurs instances sur le même chemin GCS FUSE corrompront les collections — Chroma n'a pas de verrou d'écriture distribué. |
| `execution_environment` | `gen2` | Élevé | GCS FUSE nécessite Gen2. Le déploiement avec `gen1` alors que les volumes GCS sont configurés échoue le déploiement. |
| `memory_limit` | `4Gi`+ pour la production | Élevé | Chroma charge les index HNSW en mémoire. Le `1Gi` par défaut ne prend en charge que de très petites collections ; les arrêts OOM interrompent les requêtes en cours. |
| `cpu_always_allocated` | `true` | Moyen | Définir `false` provoque une limitation du CPU entre les requêtes, ralentissant les opérations d'indexation et pouvant entraîner des délais d'expiration des vérifications de santé. |
| `application_version` | épingler à un tag spécifique | Moyen | L'utilisation de `latest` rend les déploiements non reproductibles. Les formats de données Chroma peuvent changer entre les versions majeures. |
| `timeout_seconds` | augmenter pour les grandes collections | Moyen | Les grandes recherches de similarité sur des millions de vecteurs peuvent prendre plusieurs secondes ; des 504 sont renvoyées aux clients si le délai d'expiration est trop faible. |
| `min_instance_count` | `1` | Moyen | La mise à l'échelle à zéro provoque des démarrages à froid pendant lesquels les index HNSW doivent être rechargés depuis GCS, ajoutant de la latence pour la première requête après l'inactivité. |
| `enable_iap` / `enable_cloud_armor` | activer pour les services accessibles de l'extérieur | Élevé | Sans authentification, un point de terminaison Chroma exposé de l'extérieur est entièrement ouvert. |
| `backup_retention_days` | augmenter pour la production | Moyen | Les instantanés réguliers des buckets GCS sont le chemin de récupération principal ; une rétention trop courte limite les options de récupération. |
| `enable_cloudsql_volume` | `false` | Faible | Chroma n'a pas de base de données SQL ; l'activation de ceci injecte un sidecar Cloud SQL Auth Proxy qui consomme des ressources inutilement. |

---

Pour le comportement du socle référencé tout au long — identité de service, mise à
l'échelle et concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à
Chroma partagée avec la variante GKE est décrite dans
**[Chroma_Common](Chroma_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Chroma sur Cloud Run](../labs/Chroma_CloudRun.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [Chroma sur GKE Autopilot](Chroma_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [Chroma Common — Configuration d'application partagée](Chroma_Common.md) — la configuration partagée par les deux cibles de déploiement.
