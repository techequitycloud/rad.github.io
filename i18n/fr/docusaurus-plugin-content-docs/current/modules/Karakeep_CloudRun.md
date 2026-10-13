---
title: "Karakeep sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Karakeep sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Karakeep_CloudRun.md @ e69407af sha256:d92f59955d45 -->

# Karakeep sur Google Cloud Run {#karakeep-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Karakeep_CloudRun.png" alt="Karakeep sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Karakeep est une application open-source et auto-hébergeable pour tout
marquer (liens, notes et images) avec un étiquetage automatique basé sur l'IA
et une recherche sémantique/en texte intégral. Ce module déploie Karakeep sur
**Cloud Run v2** au-dessus de la fondation
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
partagée de Google Cloud.

Ce guide se concentre sur les services cloud utilisés par Karakeep et sur la
manière de les explorer et de les opérer depuis la Google Cloud Console et la
ligne de commande. Pour les mécanismes communs à chaque application Cloud Run
— identité de service, ingress et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## Ce que coûte Karakeep sur RAD, et comment cela se compare {#what-karakeep-costs-on-rad-and-how-that-compares}

**Le module Karakeep sur Cloud Run de RAD coûte environ 30 US$ par mois dans votre propre projet, plus des frais de module de 40 crédits (4 US$) une fois par déploiement.** Si vous n'en avez besoin que pour un projet limité — recherche pour une tâche spécifique, une liste de lecture qui se termine — consultez "Mettez-le en pause gratuitement" ci-dessous pour arrêter de payer sans perdre vos marque-pages. Karakeep est également livré en tant que module GKE, qui coûte plus cher ici (environ 54 US$/mois) — Cloud Run est le choix le moins cher, sauf si vous utilisez déjà GKE Autopilot pour d'autres applications.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 40 crédits (4,00 US$) | 36 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Le même |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **30,21 US$ par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **9 crédits par jour** |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 US$ pour une recharge unique, moins sur un plan. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Cloud Run, 1x vCPU / 0,5 GiB (scaleToZero) | 10,78 US$ |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 US$ |
| Cloud NAT et réseau | 5,00 US$ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 US$ |
| **Total** | **environ 30,21 US$** |

### Comment cela se compare {#how-it-compares}

- Karakeep (anciennement Hoarder) n'a pas de plan SaaS hébergé officiel à
  comparer — il est distribué purement comme une application auto-hébergée avec
  une base de données SQLite intégrée — donc la comparaison honnête est un
  serveur nu.
- Son empreinte est légère (1 vCPU, 0,5 GiB), donc même un niveau de VPS moins
  cher/plus petit que ceux ci-dessous le ferait fonctionner confortablement ;
  pour référence, un Hetzner CPX22 ou un droplet DigitalOcean de 2 vCPU/4 Go
  coûte environ 24 US$/mois.
- Ce que RAD ajoute par rapport à un VPS nu : le partage NFS pour les images et
  les pièces jointes téléchargées, la gestion du réseau et la surveillance — la
  propre base de données SQLite de Karakeep n'a pas besoin de service de base
  de données séparé à administrer, donc l'écart ici est principalement le
  stockage et la commodité opérationnelle plutôt que l'entretien de la base de
  données.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Karakeep fonctionne dans un projet géré par RAD pour vous et que vous
prévoyez d'y revenir — une pause entre les cours, un creux saisonnier, ou
simplement ne pas savoir si vous en aurez besoin le mois prochain — c'est la
meilleure option, et cela ne coûte presque rien.

La suppression d'un projet géré par RAD délie d'abord sa facturation, puis
demande à Google de supprimer purement et simplement le projet : la propre
suppression logicielle récupérable de Google de 30 jours. Contrairement à la
suppression de Karakeep en tant que module unique, cela ne supprime pas le
service Cloud Run/GKE, le serveur de fichiers NFS et le réseau un par un —
l'ensemble du projet s'arrête simplement, et rien n'est facturé pendant qu'il
attend, car la facturation est déjà déliée.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet,
demande à Google de restaurer le projet et de rattacher son compte de
facturation, puis vous demande d'exécuter la mise à jour sur chaque déploiement
pour confirmer que tout est revenu. Parce que rien n'a été détruit
individuellement, cette mise à jour trouve les mêmes ressources déjà présentes
— c'est une vérification, pas une reconstruction, et une mise à jour ne facture
jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits
(moins de 1 US$) en temps de build pour une chaîne de déploiements typique.

Ce dont cela a besoin : vous devez posséder le projet (pas un que RAD gère
uniquement pour la facturation), vous devez le restaurer vous-même dans les 30
jours — après cela, Google le supprime définitivement — et la restauration est
admise comme la création d'un nouveau projet, donc votre solde de crédits
achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau
sandbox que la plupart utilisent convient). Google dit que la plupart des
services fonctionnent à nouveau pleinement dans les 36 heures suivant une
restauration.

Un véritable écart : les sauvegardes nocturnes sont écrites dans un bucket à
l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud
Storage explicitement désactivée, il est donc très probable qu'il disparaisse
dès que vous supprimez le projet, même si le projet lui-même est récupérable
pendant 30 jours. La propre exportation nocturne de Karakeep de sa base de
données SQLite et de ses actifs téléchargés est conservée dans ce bucket ; pour
une installation par défaut, c'est la seule copie de vos marque-pages qui vaille
la peine d'être conservée.

### Ne payez que pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que la fenêtre de 30 jours ci-dessus est
passée, la solution de repli est de supprimer Karakeep purement et simplement
et de le redéployer plus tard.

- **Ce que coûte un redéploiement :** les frais de module à nouveau, plus les
  builds — environ les frais de module indiqués ci-dessus plus 3 à 6 crédits de
  temps de build.
- **Quand cela en vaut la peine :** la suppression ne permet d'économiser de
  l'argent que si Karakeep resterait inutilisé pendant environ 4 jours ou plus
  dans votre propre projet (environ 4 jours ou plus dans un projet géré par
  RAD). Le serveur de fichiers NFS représente la majeure partie du coût
  d'exécution ici, donc la suppression de Karakeep seul permet d'économiser
  toute la facture ci-dessus, sauf si autre chose dans le projet le partage.
- **Conservez d'abord les données.** Les sauvegardes nocturnes sont écrites
  dans un bucket à l'intérieur du déploiement, et ce bucket est supprimé avec
  lui — copiez la dernière sauvegarde (vers Google Drive, ou un bucket que vous
  conservez) avant de supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour
  une classe. Chaque participant obtient l'application dans son propre projet
  Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation
  définie par le formateur. Soit le formateur finance toutes les places, soit
  chaque participant paie la sienne. Tout est supprimé à la fin de la session
  et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute
  l'application pour un client à partir d'un portefeuille cloisonné qu'il
  finance, et règle directement avec le client. Si le portefeuille est faible,
  la facturation est suspendue et les données sont conservées, de sorte que
  personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le
  projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF,
  NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais RAD et estimation des crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Google Cloud : supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour le mécanisme de pause/restauration. Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

---

## 1. Vue d'ensemble {#1-overview}

Karakeep s'exécute en tant que conteneur Next.js sur Cloud Run v2, associé à un
sidecar Meilisearch obligatoire pour la recherche. Contrairement à la plupart
des applications de ce catalogue, il n'utilise **aucune base de données
relationnelle externe** — tout l'état réside dans une base de données SQLite
intégrée plus les actifs téléchargés sur le volume NFS partagé de la
plateforme :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Next.js, 1 vCPU / 512 MiB par défaut, scale-to-zero, épinglé à une seule instance |
| Recherche | Cloud Run v2 (service interne) | Un sidecar Meilisearch requis, déployé automatiquement — non optionnel |
| Base de données | aucune | L'état réside dans une base de données SQLite intégrée, pas Cloud SQL |
| Stockage d'objets | aucun (NFS à la place) | Les actifs téléchargés persistent sur le volume NFS partagé de la plateforme, pas GCS |
| Secrets | Secret Manager | `NEXTAUTH_SECRET` et `MEILI_MASTER_KEY` auto-générés |
| Ingress | URL Cloud Run | URL `run.app` par défaut ; équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de Cloud SQL.** `database_type = "NONE"` — la base de données SQLite intégrée de Karakeep
  et les actifs téléchargés résident tous deux sur le volume NFS partagé de la
  plateforme (`enable_nfs = true` par défaut).
- **Une seule instance.** `max_instance_count = 1` — plusieurs instances Cloud Run écrivant le
  même fichier SQLite sur NFS risquent la corruption même avec le mode WAL
  désactivé (que ce module maintient désactivé par défaut).
- **Meilisearch est obligatoire, pas optionnel.** Déployé automatiquement en
  tant que service Cloud Run supplémentaire interne uniquement. Sans lui,
  `MEILI_ADDR` de Karakeep n'est pas défini et la recherche est
  silencieusement désactivée (la mise en signet elle-même fonctionne toujours).
- **Pas de build de conteneur personnalisé.** Le mode journal SQLite de Karakeep
  est déjà par défaut le mode `DELETE` sûr pour NFS — l'image pré-construite
  officielle est déployée telle quelle.
- **Pas de credential d'amorçage administrateur.** Le premier compte créé via
  le formulaire d'inscription de l'interface web devient l'administrateur.
- **`NEXTAUTH_SECRET` est immuable après le premier démarrage.** Le faire pivoter
  invalide chaque session active.
- **Facturation basée sur les requêtes par défaut.** `cpu_always_allocated = false`, `min_instance_count = 0` — le chemin
  principal de sauvegarde/recherche de Karakeep n'a pas besoin de CPU en
  arrière-plan ; l'exploration de liens/l'étiquetage AI asynchrone peut se
  mettre en pause lorsqu'il est mis à l'échelle à zéro.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de
services et de ressources sont signalés dans les [Sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service Karakeep {#a-cloud-run--the-karakeep-service}

Karakeep s'exécute en tant que service Cloud Run v2. Chaque déploiement crée
une révision immuable.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le
  trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Meilisearch (sidecar requis) {#b-meilisearch-required-sidecar}

La recherche en texte intégral et sémantique de Karakeep est entièrement
alimentée par une instance Meilisearch, déployée automatiquement en tant que
service Cloud Run distinct, interne uniquement. Son URL est injectée
automatiquement dans la variable d'environnement `MEILI_ADDR` de l'application
principale. Son index réside sur le stockage éphémère du sidecar — les services
supplémentaires ne partagent pas le volume NFS de l'application principale — et
se reconstruit à partir de zéro à chaque redémarrage. Cela n'affecte que la
disponibilité de la recherche, pas la sécurité des données ; les marque-pages
persistent sur le `/data` monté sur NFS de l'application principale.

- **Console :** Cloud Run → le service `<service>-meilisearch` (ingress interne
  uniquement — non accessible directement depuis un navigateur).
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" --filter="metadata.name~meilisearch"
  gcloud run services logs read <service>-meilisearch --project "$PROJECT" --region "$REGION" --limit=50
  ```

### C. NFS (Cloud Filestore ou la VM NFS+Redis auto-gérée) {#c-nfs-cloud-filestore-or-the-self-managed-nfsredis-vm}

La base de données SQLite intégrée de Karakeep et ses actifs téléchargés (les
captures d'écran des pages mises en signet iraient également ici, bien que ce
module n'active pas la capture d'écran Chrome sans tête) résident sur le volume
NFS partagé de la plateforme, monté à `/data`.

- **Console :** Filestore → instances (si `Services_GCP` a créé une instance
  Filestore gérée) — ou Compute Engine → la VM NFS auto-gérée.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT" 2>/dev/null
  gcloud compute instances list --project "$PROJECT" --filter="name~nfs"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour le modèle de découverte et de montage
NFS.

### D. Secret Manager {#d-secret-manager}

Deux secrets sont générés automatiquement : `NEXTAUTH_SECRET` (signature JWT de session)
et `MEILI_MASTER_KEY` (partagé entre l'application et son sidecar Meilisearch).

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~karakeep"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

### E. Réseau et ingress {#e-networking--ingress}

Le service est accessible à son URL `run.app` par défaut. Un équilibreur de charge
HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peuvent
être superposés.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  ```

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux de conteneurs sont envoyés à Cloud Logging ; les métriques Cloud
Run sont envoyées à Cloud Monitoring, avec des vérifications de disponibilité
et des politiques d'alerte optionnelles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Karakeep {#3-karakeep-application-behaviour}

- **Pas de job de configuration de base de données au premier déploiement.**
  Karakeep gère son propre schéma SQLite et ses migrations en interne au
  démarrage — il n'y a pas de job `db-init` séparé à inspecter.
- **Pas de credential d'amorçage administrateur à récupérer.** Le premier
  compte créé via le formulaire d'inscription de l'interface web devient
  l'administrateur. Il n'y a rien dans Secret Manager à récupérer avant la
  première connexion.
- **La recherche dépend de l'accessibilité du sidecar.** Si le service
  Meilisearch ne démarre pas, la recherche cesse silencieusement de fonctionner
  — la mise en signet, l'étiquetage et la navigation continuent de fonctionner,
  mais rien n'est trouvable via la recherche.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent
  `/` — la page de connexion/d'atterrissage publique de Karakeep.
- **Le travail asynchrone (exploration de liens, étiquetage AI) s'exécute en
  processus.** Avec `cpu_always_allocated = false` (par défaut), ce travail peut se mettre en pause
  pendant que l'instance est mise à l'échelle à zéro entre les requêtes et
  reprendre à la requête suivante.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Karakeep sont listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `karakeep` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag de suivi du déploiement. `Karakeep_Common` mappe `"latest"` au tag `"release"` de Karakeep. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `prebuilt` | Aucun build personnalisé n'est nécessaire — le mode journal SQLite par défaut de Karakeep est déjà sûr pour NFS. |
| `min_instance_count` | `0` | Mise à l'échelle à zéro. |
| `max_instance_count` | `1` | **Épinglé** — sécurité multi-écrivains SQLite-sur-NFS. Ne pas augmenter. |
| `container_port` | `3000` | Port natif par défaut de Karakeep. |
| `cpu_always_allocated` | `true` | Facturation basée sur les requêtes. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Requis — la base de données SQLite et les actifs de Karakeep y résident. |
| `nfs_mount_path` | `/data` | Valeur par défaut `DATA_DIR` de Karakeep. |
| `storage_buckets` | `[]` | Aucun bucket GCS provisionné — Karakeep utilise NFS, pas le stockage d'objets. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixe — aucune instance Cloud SQL n'est provisionnée. |

### Groupe 13 — Jobs et sidecars {#group-13--jobs--sidecars}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Non utilisé — Karakeep migre son propre schéma au démarrage. |
| `additional_services` | `[]` | Services *supplémentaires* configurables par l'utilisateur au-delà de ceux de Karakeep — le sidecar Meilisearch requis est déployé automatiquement et n'est pas représenté ici. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `/` 30s de délai | Les sondes ciblent la page de connexion publique. |

---

## 5. Sorties {#5-outputs}

Retournées lors d'un déploiement réussi — le moyen le plus rapide de localiser
et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `database_instance_name` / `database_name` / `database_user` / `database_host` / `database_port` | Vide — non applicable (`database_type = "NONE"`). |
| `storage_buckets` | Vide — Karakeep persiste via NFS, pas GCS. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `max_instance_count` | `1` (par défaut épinglé) | Critique | L'augmentation de cette valeur risque la corruption de SQLite par des écrivains NFS concurrents — Karakeep n'a pas d'autre backend de base de données de secours. |
| Premier compte créé via l'inscription | Créez-le immédiatement après le déploiement | Critique | Le premier compte à s'inscrire devient administrateur — s'il est laissé ouvert, tout visiteur qui atteint l'URL en premier revendique ce rôle. |
| `enable_nfs` | `true` (par défaut) | Critique | Le désactiver supprime tout stockage durable — la base de données SQLite et les actifs résideraient sur le système de fichiers éphémère de Cloud Run et disparaîtraient à chaque redémarrage de révision. |
| `container_image_source` | `prebuilt` (par défaut) | Élevé | `"custom"` déclenche un Cloud Build inutile sans Dockerfile configuré dans ce module — le build échouera. |
| Accessibilité du sidecar Meilisearch | Vérifiez que `MEILI_ADDR` est résolu après le déploiement | Moyen | Si le sidecar ne démarre pas, la recherche cesse silencieusement de fonctionner tandis que le reste de l'application continue de fonctionner normalement — un état dégradé facile à manquer. |
| `NEXTAUTH_SECRET` (auto-généré) | Ne jamais faire pivoter après le premier démarrage | Critique | Le faire pivoter invalide chaque session utilisateur active. |
| Variable d'environnement `DATA_DIR` | Définie explicitement (ce module la définit toujours à `nfs_mount_path`) | Critique | La valeur par défaut de Karakeep est une **chaîne vide**, pas `/data` (cette valeur par défaut n'existe que dans le modèle docker-compose en amont). Si elle n'est pas définie, les migrations et le fichier SQLite se résolvent silencieusement en stockage éphémère au lieu du montage NFS — confirmé en direct : l'inscription renvoie des 500 avec `SqliteError: no such table: user` jusqu'à ce que ce soit corrigé. |

---

Pour le comportement de la fondation référencé tout au long — identité de
service, mise à l'échelle et concurrence, ingress et équilibrage de charge,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en
miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration
d'application spécifique à Karakeep partagée avec la variante GKE est décrite
dans **[Karakeep_Common](Karakeep_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Karakeep sur Cloud Run](../labs/Karakeep_CloudRun.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [Karakeep sur GKE Autopilot](Karakeep_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [Karakeep Common — Configuration d'application partagée](Karakeep_Common.md) — la configuration partagée par les deux cibles de déploiement.
