---
title: "Hoppscotch sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Hoppscotch sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Hoppscotch_CloudRun.md @ e69407af sha256:152086d3c523 -->

# Hoppscotch sur Google Cloud Run {#hoppscotch-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Hoppscotch_CloudRun.png" alt="Hoppscotch sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Hoppscotch est une plateforme open source de développement d'API de type Postman
pour concevoir, envoyer et inspecter des requêtes HTTP, GraphQL et WebSocket
depuis le navigateur. Ce module déploie le **frontend Hoppscotch auto-hébergé**
en tant qu'application monopage sans état sur **Cloud Run v2** par-dessus la
fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère
l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Hoppscotch et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à chaque application Cloud Run —
identité de service, ingress et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## Ce que coûte Hoppscotch sur RAD et comment cela se compare {#what-hoppscotch-costs-on-rad-and-how-that-compares}

**Hoppscotch sur le module Cloud Run de RAD coûte environ 17 US$ par mois dans votre propre projet, plus des frais de module de 40 crédits (4 US$) une fois par déploiement, sans licence par utilisateur.** Si vous n'en avez besoin qu'occasionnellement, consultez la section "Mettez-le en pause gratuitement" ci-dessous pour arrêter de payer sans perdre votre configuration. Hoppscotch est également disponible en tant que module GKE ; GKE coûte plus cher ici (environ 24 US$/mois) car il ajoute un cluster partagé, donc Cloud Run est le choix le moins cher, à moins que vous n'exécutiez déjà un cluster Autopilot pour d'autres applications.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 40 crédits (4,00 US$) | 36 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût de fonctionnement Google Cloud | Facturé par Google à votre propre compte de facturation, environ **16,78 US$ par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **3 crédits par jour** |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 US$ pour une recharge unique, moins sur un plan. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas de deuxième base de données.

**Coût de fonctionnement par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Cloud Run, 1x vCPU / 0,5 GiB (scaleToZero) | 10,78 US$ |
| Cloud NAT et réseau | 5,00 US$ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 US$ |
| **Total** | **environ 16,78 US$** |

### Comment cela se compare {#how-it-compares}

- Il n'existe pas de SaaS hébergé officiel pour le frontend Hoppscotch auto-hébergé à comparer — les plans cloud de Postman sont un produit différent, à code source fermé — donc la comparaison honnête est un serveur nu.
- Le frontend de Hoppscotch est léger (1 vCPU, 0,5 GiB), donc même un VPS moins cher/plus petit que ceux ci-dessous le ferait fonctionner ; à titre de référence, un Hetzner CPX22 ou un DigitalOcean 2 vCPU/4 Go coûte environ 24 US$/mois et un GCP Compute Engine e2-standard-2 environ 49 US$/mois.
- Ce que RAD ajoute par rapport à un VPS nu, c'est le TLS géré, l'accès IAM, Secret Manager et la surveillance — ce module n'a pas de base de données à patcher, donc l'écart concerne principalement l'identité et l'observabilité plutôt que l'administration de la base de données.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Hoppscotch fonctionne dans un projet géré par RAD pour vous et que vous prévoyez d'y revenir — une pause entre les cours, un creux saisonnier, ou simplement ne pas savoir si vous en aurez besoin le mois prochain — c'est la meilleure option, et elle ne coûte presque rien.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer purement et simplement le projet : la suppression logicielle récupérable de 30 jours de Google. Contrairement à la suppression de Hoppscotch en tant que module unique, cela ne démantèle pas le service Cloud Run, le réseau et le stockage un par un — l'ensemble du projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà déliée.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de restaurer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter la mise à jour sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits (moins de 1 US$) en temps de build pour une chaîne de déploiements typique.

Ce qu'il faut : vous devez posséder le projet (pas un projet dont RAD gère uniquement la facturation), vous devez le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est admise comme la création d'un nouveau projet, donc votre solde de crédits achetés doit toujours atteindre le seuil du palier (100 crédits pour le palier sandbox que la plupart utilisent). Google indique que la plupart des services sont de nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.

Un véritable écart : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous supprimez le projet, même si le projet lui-même est récupérable pendant 30 jours. Hoppscotch conserve peu de son propre état côté serveur (les collections et les environnements sont principalement dans le navigateur), donc pour une installation par défaut, il y a peu à perdre.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que la fenêtre de 30 jours ci-dessus est passée, la solution de repli consiste à supprimer Hoppscotch purement et simplement et à le redéployer plus tard.

- **Ce que coûte un redéploiement :** les frais de module à nouveau, plus les builds — environ les frais de module indiqués ci-dessus plus 3 à 6 crédits de temps de build.
- **Quand cela en vaut la peine :** la suppression ne permet d'économiser de l'argent que si Hoppscotch devait autrement rester inutilisé pendant environ 8 jours ou plus dans votre propre projet (environ 14 jours ou plus dans un projet géré par RAD). Hoppscotch n'a pas de base de données ou de VM partagée, donc sa suppression supprime à elle seule son coût de fonctionnement total.
- **Conservez les données en premier.** Les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du déploiement, et ce bucket est supprimé avec lui — copiez la dernière sauvegarde (vers Google Drive, ou un bucket que vous conservez) avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant dispose de l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais RAD et estimation des crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Google Cloud : supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour le mécanisme de pause/restauration. Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

---

## 1. Vue d'ensemble {#1-overview}

Hoppscotch fonctionne comme une application web monopage statique (servie par Caddy) dans un conteneur sur Cloud Run v2. Elle est délibérément **sans état** — pas de base de données, pas de cache, pas de stockage persistant — de sorte que le déploiement relie un petit ensemble de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Conteneur SPA statique sur le port 3000 ; 1 vCPU / 512 Mio par défaut ; mise à l'échelle à zéro |
| Image de conteneur | Artifact Registry + Cloud Build | Build personnalisé léger `FROM hoppscotch/hoppscotch-frontend`, tag mis en miroir dans Artifact Registry |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL par défaut `run.app` ; équilibreur de charge HTTPS externe optionnel + domaine personnalisé |
| Secrets | Secret Manager | **Aucun spécifique à l'application** — Hoppscotch ne nécessite aucun secret |
| Observabilité | Cloud Logging & Monitoring | Journaux de conteneurs, métriques, vérification de disponibilité et alertes optionnelles |

Services délibérément **non** utilisés : **Cloud SQL** (`database_type = "NONE"`),
**Cloud Storage** (pas de buckets), et **Redis** (désactivé par défaut ; le frontend statique n'a
pas de limitation de débit côté serveur ni de file d'attente à prendre en charge).

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de base de données, jamais.** `database_type = "NONE"` et `enable_cloudsql_volume = false`.
  Hoppscotch conserve toutes les collections, environnements et historique dans le **stockage local du navigateur**, il n'y a donc pas d'état côté serveur. La définition d'un type de base de données ne fait que gaspiller de l'argent sur une instance Cloud SQL inactive — la variante GKE le bloque même au moment de la planification.
- **L'image uniquement frontend est utilisée à dessein.** L'image tout-en-un
  `hoppscotch/hoppscotch` regroupe un backend NestJS qui `exit(1)` sans
  `DATABASE_URL`. Ce module utilise `hoppscotch/hoppscotch-frontend`, qui sert le
  SPA sur le port 3000 sans exigence de backend.
- **`HOPPSCOTCH_VERSION`, pas `APP_VERSION`, épingle l'image.** Un build personnalisé définit un
  ARG `HOPPSCOTCH_VERSION` spécifique à l'application afin que le `APP_VERSION` injecté par la Fondation
  ne surcharge pas le tag ; `application_version = "latest"` se résout en un tag épinglé et
  connu au moment du build.
- **La mise à l'échelle à zéro est activée par défaut** (`min_instance_count = 0`). La première
  requête après l'inactivité entraîne un démarrage à froid de quelques secondes. Comme l'application est une SPA statique
  sans travail de préchauffage, les démarrages à froid sont peu coûteux ; définissez `min_instance_count = 1` uniquement
  si vous souhaitez éliminer cette latence de première requête.
- **Facturation basée sur les requêtes par défaut** (`cpu_always_allocated = false`). Hoppscotch
  n'effectue aucun travail de fond en cours de processus, donc le CPU n'est facturé que lors du traitement d'une requête.
- **Ingress public par défaut.** `ingress_settings = "all"` expose l'URL `run.app`.
  Activez IAP pour exiger une connexion Google pour les déploiements internes/réservés à l'organisation.
- **Aucun secret et aucun bucket de stockage** ne sont provisionnés par ce module.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de service et de ressource sont
rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Hoppscotch {#a-cloud-run--the-hoppscotch-service}

Hoppscotch fonctionne comme un service Cloud Run v2 qui s'adapte automatiquement à la charge de requêtes entre le nombre minimal (`0`) et maximal d'instances. Chaque déploiement crée une révision immuable ; le trafic peut être réparti entre les révisions pour des déploiements sûrs. Le conteneur écoute sur le **port 3000** et répond `GET /` avec l'interface utilisateur de l'application (HTTP 200).

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~hoppscotch"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  # Confirm the injected port and env of the live revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].ports,spec.template.spec.containers[0].env)'
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Image de conteneur — Artifact Registry et Cloud Build {#b-container-image--artifact-registry--cloud-build}

Parce que `container_image_source = "custom"`, l'image est construite par Cloud Build à partir
du léger `Dockerfile` (`FROM hoppscotch/hoppscotch-frontend:${HOPPSCOTCH_VERSION}`)
et poussée vers Artifact Registry (la mise en miroir d'images est activée par défaut pour éviter les limites de débit de Docker Hub).

- **Console :** Artifact Registry → Dépôts ; Cloud Build → Historique.
- **CLI :**
  ```bash
  gcloud builds list --project "$PROJECT" --region "$REGION" --limit 5
  gcloud artifacts docker images list \
    "$REGION-docker.pkg.dev/$PROJECT/<repo>" --project "$PROJECT" \
    --include-tags --filter="package~hoppscotch"
  ```

Le nom du dépôt et l'URI de l'image se trouvent dans les [Sorties](#5-outputs)
(`artifact_registry_repository`, `container_image`).

### C. Secret Manager {#c-secret-manager}

Hoppscotch ne provisionne **aucun secret d'application** — `secret_ids` est vide. Vous pouvez
toujours mapper vos propres références de variables d'environnement vers des secrets via `secret_environment_variables`
si vous étendez le déploiement, mais rien n'est requis.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~hoppscotch"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails sur l'injection et la rotation des secrets.

### D. Réseau et ingress {#d-networking--ingress}

Le service est accessible par son URL `run.app` par défaut (`ingress_settings = "all"`).
Un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peuvent être superposés ; les paramètres d'ingress et le contrôle d'egress VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les journaux de conteneurs sont acheminés vers Cloud Logging ; les métriques Cloud Run sont acheminées vers Cloud Monitoring, avec des vérifications de disponibilité et des politiques d'alerte optionnelles. Une vérification de disponibilité par rapport à `/` confirme que le SPA est en service.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Hoppscotch {#3-hoppscotch-application-behaviour}

- **Pas de configuration de base de données au premier déploiement.** Il n'y a pas de job `db-init`, pas d'instance Cloud SQL et pas de schéma. Le conteneur sert un bundle statique immédiatement.
- **Pas de persistance côté serveur.** Les collections, les environnements, l'historique des requêtes et les paramètres résident dans le **stockage local du navigateur** sur la machine de chaque utilisateur. Le redéploiement, la mise à l'échelle à zéro ou le déploiement d'une nouvelle révision ne perdent aucune donnée utilisateur — il n'y en a pas sur le serveur à perdre.
- **Pas de clés immuables.** Sans secrets ni base de données, il n'y a pas de matériel cryptographique qui pourrait corrompre les données stockées s'il était modifié. Les rotations ne posent aucun problème.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent la racine `/`, qui renvoie l'interface utilisateur de l'application (HTTP 200) dès que Caddy lie le port 3000 — généralement en quelques secondes. Une sonde défaillante signifie presque toujours que le tag de l'image est invalide, et non qu'un backend est inaccessible.
- **Pas de compte administrateur au premier démarrage.** Le frontend auto-hébergé n'a pas de connexion ou de gestion d'utilisateurs propre ; ouvrez l'URL et commencez à créer des requêtes. (Les espaces de travail d'équipe, qui nécessitent le backend + la base de données, sont intentionnellement hors du champ d'application de ce module.)
- **La mise à l'échelle est illimitée.** Comme il n'y a pas de file d'attente ou de base de données partagée, n'importe quel nombre d'instances peut fonctionner indépendamment — augmentez `max_instance_count` librement comme un plafond de coût/débit.
- **Vérifiez la révision en cours d'exécution :**
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" --format='value(status.url)'
  curl -sS -o /dev/null -w '%{http_code}\n' "$(gcloud run services describe <service-name> \
    --region "$REGION" --format='value(status.url)')/"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour Hoppscotch sont listés ; toutes les autres entrées sont héritées de [App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `hoppscotch` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Hoppscotch` | Nom lisible par l'homme affiché dans la console. |
| `application_version` | `latest` | Tag de l'image Hoppscotch ; `latest` se résout en un tag `hoppscotch-frontend` épinglé et connu au moment du build. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure de support. |
| `container_image_source` | `custom` | Build personnalisé léger `FROM hoppscotch/hoppscotch-frontend`. Gardez `custom`. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `512Mi` | Mémoire par instance ; ≥ 256 Mio (le plancher gen2 est de 512 Mio). |
| `cpu_always_allocated` | `false` | Facturation basée sur les requêtes — Hoppscotch n'effectue aucun travail en arrière-plan. |
| `container_port` | `3000` | Le port sur lequel le SPA frontend écoute. |
| `min_instance_count` | `0` | Mise à l'échelle à zéro ; définissez `1` pour éviter les démarrages à froid. |
| `max_instance_count` | `3` | Plafond coût/débit ; sûr à augmenter (pas d'état partagé). |
| `execution_environment` | `gen2` | Recommandé pour un démarrage et un réseau plus rapides. |
| `timeout_seconds` | `60` | Durée maximale de la requête (0–3600). |
| `enable_cloudsql_volume` | `false` | Hoppscotch n'a pas de base de données — laissez `false`. |
| `enable_image_mirroring` | `true` | Mettre l'image en miroir dans Artifact Registry (évite les limites de Docker Hub). |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 5 — Accès et contrôle d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | URL `run.app` publique. Utilisez `internal` / IAP pour les déploiements privés. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via VPC. |
| `enable_iap` | `false` | Exiger une connexion Google devant Hoppscotch. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Variables d'environnement en texte clair supplémentaires facultatives (par exemple `{ PORT = "3000" }`). Aucune n'est requise. |
| `secret_environment_variables` | `{}` | Références facultatives de variables d'environnement → Secret Manager. Aucune n'est requise. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 21 — Cache et file d'attente Redis {#group-21--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Désactivé par défaut. Le frontend statique n'a pas de file d'attente côté serveur ni de limiteur de débit, il est donc préférable de le laisser désactivé. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Pertinent uniquement si vous connectez Redis à des fins personnalisées. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

---

## 5. Sorties {#5-outputs}

Renvoyées lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `storage_buckets` | Buckets Cloud Storage créés (vides — Hoppscotch est sans état). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, vérifications de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (vides — pas de démarrage de base de données). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au
> moteur de fondation [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et
> les combinaisons* au moment de la planification — IAP sans identités autorisées, un runtime `gen1`
> avec des montages NFS/GCS, des `timeout_seconds`/`redis_port` hors plage. Une configuration
> invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource,
> de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'au moment de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `container_image_source` | `custom` | Élevé | Le passage à `prebuilt` pointe le service vers un chemin Artifact Registry non construit (`Image not found`) ; Hoppscotch nécessite le build personnalisé `hoppscotch-frontend`. |
| `application_version` | `latest` ou un vrai tag `hoppscotch-frontend` | Élevé | Un tag invalide fait échouer le Cloud Build (`MANIFEST_UNKNOWN`) ; le service exécute alors une image obsolète ou manquante. |
| `enable_cloudsql_volume` | `false` | Moyen | L'activer monte un sidecar Auth Proxy pour une base de données qui n'existe pas — coût gaspillé et dépendance inutile. |
| `container_port` | `3000` | Élevé | Le frontend ne sert que sur le port 3000 ; un port non concordant fait échouer la sonde de démarrage et la révision ne devient jamais prête. |
| `memory_limit` | `512Mi` | Moyen | En dessous de 512 Mio est rejeté sous le plancher de l'environnement d'exécution gen2 ; le plan/apply échoue. |
| `enable_iap` | `false` pour un usage public | Élevé | L'activation d'IAP sans identifiants OAuth expose ou bloque silencieusement l'application ; l'activer délibérément nécessite une connexion Google pour chaque requête. |
| `min_instance_count` | `0` (ou `1` pour pas de démarrage à froid) | Faible | La mise à l'échelle à zéro ajoute un petit délai de démarrage à froid à la première requête après l'inactivité ; inoffensif pour une SPA statique. |
| `enable_redis` | `false` | Faible | Le frontend statique n'a pas de file d'attente côté serveur ; l'activation de Redis ajoute des coûts sans avantage. |

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise à l'échelle et
concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à Hoppscotch
partagée avec la variante GKE est décrite dans
**[Hoppscotch_Common](Hoppscotch_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Hoppscotch sur Cloud Run](../labs/Hoppscotch_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Hoppscotch sur GKE Autopilot](Hoppscotch_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [Hoppscotch Common — Configuration d'application partagée](Hoppscotch_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [Gitea sur Google Cloud Run](Gitea_CloudRun.md), [Woodpecker CI sur GKE Autopilot](Woodpecker_GKE.md), [GlitchTip sur Google Cloud Run](GlitchTip_CloudRun.md) dans la solution **Contrôle de source et CI/CD**.
