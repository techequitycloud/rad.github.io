---
title: "Audiobookshelf sur GKE Autopilot"
description: "Référence de configuration pour le déploiement d'Audiobookshelf sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Audiobookshelf_GKE.md @ 1665a43e sha256:e11b655b9b06 -->

# Audiobookshelf sur GKE Autopilot {#audiobookshelf-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Audiobookshelf_GKE.png" alt="Audiobookshelf sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Audiobookshelf est un serveur de livres audio et de podcasts auto-hébergé — il organise votre bibliothèque audio, diffuse vers l'interface utilisateur web et les applications mobiles officielles, et synchronise la progression d'écoute par utilisateur. Ce module déploie Audiobookshelf sur **GKE Autopilot** en s'appuyant sur la fondation [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud qu'Audiobookshelf utilise et sur la manière de les explorer et de les opérer depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à toutes les applications GKE — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — veuillez vous référer au [guide de la fondation App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## Ce que coûte Audiobookshelf sur RAD, et comparaison {#what-audiobookshelf-costs-on-rad-and-how-that-compares}

**Le module Audiobookshelf sur GKE Autopilot de RAD coûte environ 42 $ US par mois dans un projet que vous possédez, sans frais de licence pour le logiciel lui-même.** RAD facture des frais de module uniques de 75 crédits (7,50 $ US au prix de la recharge) dans un projet que vous possédez, et 67,5 crédits (10 % de moins) dans un projet géré par RAD. GKE convient à Audiobookshelf qui doit rester en ligne en continu ou s'adapter à travers plusieurs pods ; pour le coût le plus bas, le [module Cloud Run](Audiobookshelf_CloudRun.md) exécute le même Audiobookshelf pour environ 19 $ US par mois. Les chiffres sont valables au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

Si vous n'en avez besoin qu'occasionnellement — pour préparer une certification, une démo, un besoin saisonnier — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits, de sorte que les quelque 42 $ US par mois deviennent presque rien. Voir **Mettre en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

Vous payez pour trois choses :

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 75 crédits (7,50 $ US au prix de la recharge) | 67,5 crédits (10 % de moins) |
| Temps de build | Quelques crédits, facturés à la minute de temps de build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ 42 $ US par mois pour la configuration par défaut (tableau ci-dessous) | Facturé à l'heure en crédits ; RAD publie **67 crédits par jour**, soit environ 2 010 par mois (environ 201 $ US au prix de la recharge, 161 $ US au tarif du plan Scale) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US en recharge unique, et moins avec un plan mensuel.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Pod GKE Autopilot, 1x vCPU / 1 GiB | 36,08 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| Frais de gestion de cluster GKE | 0 $ US si c'est votre seul cluster Autopilot/zonal sur le compte de facturation, sinon environ 73 $ US (partagé entre toutes les applications GKE du projet) |
| **Total** | **environ 42 $ US** |

### Comparaison {#how-it-compares}

- **Aucun concurrent SaaS de marque n'est une correspondance exacte pour Audiobookshelf, donc la comparaison honnête est un simple serveur auto-géré.** C'est une charge de travail plus petite qu'un VPS standard de 2 vCPU, donc l'exécuter vous-même sur une classe moins chère et plus petite qu'un Hetzner CPX22 ou DigitalOcean 2 vCPU/4 Go Droplet (tous deux environ 24 $/mois) ferait l'affaire, pour nettement moins que cela.
- **RAD n'est pas moins cher qu'un VPS nu en termes monétaires, et n'essaie pas de l'être.** Ce que RAD ajoute pour un prix similaire, c'est une base de données gérée, Secret Manager pour les identifiants, et une surveillance qui serait autrement votre travail à configurer, patcher et sauvegarder.
- **Le temps de l'administrateur est le coût réel qu'un VPS ne montre pas.** Les correctifs de sécurité, les sauvegardes et les mises à jour de version sur un serveur nu sont un travail que quelqu'un doit continuer à faire ; les services gérés de RAD absorbent cela.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Audiobookshelf s'exécute dans **un projet géré par RAD pour vous**, vous avez une option qui va bien au-delà de la mise à l'échelle à zéro : **supprimer l'ensemble du projet, et le restaurer dans les 30 jours pour presque rien.** Cela convient bien mieux à une utilisation occasionnelle — étudier pour une certification, une démo, un besoin saisonnier — que d'exécuter Audiobookshelf en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le projet purement et simplement. Google ne le supprime pas immédiatement : il conserve le projet, récupérable, pendant 30 jours, et comme la facturation est déjà déliée, rien n'est facturé pendant qu'il attend. Contrairement à la suppression d'un module, cela ne détruit pas la base de données, aucune VM ou la ressource de calcul une par une — l'ensemble du projet s'arrête simplement, et rien n'est facturé entre-temps.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours, seul le propriétaire du projet peut le restaurer. RAD demande à Google de restaurer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter **Update** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture plus jamais les frais de module. Cela ne coûte qu'une poignée de crédits au total (moins de 1 $ US), contre le paiement des frais de module et une reconstruction complète.
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet que RAD gère uniquement pour la facturation), vous devez le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est admise comme la création d'un nouveau projet, donc votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude et de démo conviennent). Google indique que la plupart des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.
- **Un véritable manque : les sauvegardes ne survivent pas.** Tout ce qu'Audiobookshelf écrit dans un bucket de sauvegarde à l'intérieur du projet est très probablement perdu dès que vous supprimez le projet, même si le projet lui-même est récupérable pendant 30 jours — ce bucket a la suppression logicielle de Cloud Storage explicitement désactivée. Quiconque a personnalisé le déploiement et souhaite conserver ce travail doit copier une sauvegarde (vers Google Drive, ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

C'est la solution de repli pour un projet que vous possédez, ou une fois que la fenêtre de restauration de 30 jours ci-dessus est passée : **supprimez le déploiement, et redéployez-le lorsque vous en aurez à nouveau besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau, plus les builds : environ 80 crédits (environ 8 $ US) dans votre propre projet, ou 72,5 crédits dans un projet géré par RAD, car RAD reconstruit les ressources à partir de zéro. La suppression permet d'économiser de l'argent une fois qu'Audiobookshelf resterait inutilisé assez longtemps pour compenser ce coût de redéploiement par rapport à son propre coût d'exécution — environ 6 jours ou plus dans votre propre projet (1,40 $ US/jour) ou 1 jour ou plus dans un projet géré par RAD (67 crédits/jour).
- **Le cluster GKE lui-même est une infrastructure partagée.** Si une autre application utilise le même cluster Autopilot, la suppression d'Audiobookshelf seul ne sauve que son propre pod ; les frais de gestion du cluster ne diminuent que lorsque rien d'autre dans le projet n'en a besoin.
- **Conservez vos données en premier.** Tout ce qu'Audiobookshelf écrit dans un bucket de sauvegarde à l'intérieur du déploiement est supprimé avec lui — copiez la dernière sauvegarde (vers Google Drive, ou un bucket que vous conservez) avant de supprimer si vous voulez la conserver.
- **RAD ne recrée pas un déploiement supprimé pour vous.** Vous saisissez à nouveau les paramètres lors du redéploiement.

### Sessions de labo et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de labo, pour la formation.** Un formateur anime une session pour une classe. Chaque participant dispose d'Audiobookshelf dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute Audiobookshelf pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, afin que personne ne reçoive de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais de RAD et estimation des crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les mécanismes de pause/restauration. Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Audiobookshelf s'exécute comme une charge de travail Node.js unique sur GKE Autopilot. Exceptionnellement pour ce catalogue, il ne nécessite **aucune base de données externe, aucun Redis et aucun secret d'application** — l'empreinte du déploiement est délibérément petite :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pod Node.js, 1 vCPU / 1 GiB par défaut, réplica unique |
| Base de données | Aucune | Audiobookshelf intègre sa propre base de données SQLite sous `CONFIG_PATH` — pas de Cloud SQL |
| État persistant | Persistent Volume Claim (stockage par blocs) | Un PVC StatefulSet monté à `/data`, sauvegardant à la fois `CONFIG_PATH` et `METADATA_PATH` |
| Image conteneur | Cloud Build + Artifact Registry | Wrapper léger construit `FROM ghcr.io/advplyr/audiobookshelf` et mis en miroir dans votre registre |
| Secrets | Secret Manager | Pas de secrets d'application — l'utilisateur admin est créé dans l'interface utilisateur web lors de la première exécution |
| Ingress | Cloud Load Balancing | LoadBalancer externe avec une IP statique réservée ; domaine personnalisé optionnel |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de base de données externe.** `database_type = "NONE"` et `enable_cloudsql_volume = false` sont fixés par `Audiobookshelf_Common` ; Audiobookshelf crée et migre sa base de données SQLite interne au premier démarrage. Aucun job `db-init` ne s'exécute.
- **Un vrai PVC de bloc, pas GCS FUSE, sauvegarde `/data`.** `stateful_pvc_enabled = true` par défaut — gcsfuse corrompt SQLite et l'index des fichiers multimédias, donc Audiobookshelf nécessite un véritable périphérique de bloc. Lorsque le PVC est activé, la variante désactive automatiquement le volume de stockage GCS-FUSE au même chemin (`enable_gcs_storage_volume = !stateful_pvc_enabled`) pour éviter un conflit de double montage à `/data`. C'est la différence clé avec `Audiobookshelf_CloudRun`, qui n'a pas d'option PVC et utilise GCS FUSE à la place.
- **`stateful_pvc_enabled = true` sans `workload_type` explicite se résout en `StatefulSet`.** Un PVC par pod, provisionné par défaut à partir de la StorageClass `standard-rwo` (SSD, PD équilibré) — voir §6 pour l'implication du quota SSD.
- **Un seul montage persistant couvre tout.** `CONFIG_PATH = /data/config` (base de données SQLite + configuration de l'application) et `METADATA_PATH = /data/metadata` (illustrations de couverture, métadonnées mises en cache) sont tous deux redirigés sous le seul `stateful_pvc_mount_path` (`/data`). La perte de ce PVC entraîne la perte de tout l'état d'Audiobookshelf.
- **Réplica unique.** `min_instance_count = 1` et `max_instance_count = 1` — une bibliothèque SQLite partagée doit être servie par exactement un rédacteur. N'augmentez pas le maximum sans vérifier la sécurité multi-rédacteurs (il n'y en a pas).
- **Image personnalisée (wrapper léger).** Cloud Build enveloppe l'image amont `ghcr.io/advplyr/audiobookshelf` afin qu'elle soit mise en miroir dans Artifact Registry. Le Dockerfile lit l'ARG de build `AUDIOBOOKSHELF_VERSION` spécifique à l'application (pas le générique `APP_VERSION` que la fondation injecte) ; `application_version = "latest"` se résout en `2.17.0` épinglé.
- **Pas de secrets générés.** L'utilisateur **root** initial est créé de manière interactive dans l'interface utilisateur web lors de la première exécution, et les jetons API sont créés dans l'interface utilisateur par la suite — `Audiobookshelf_Common` expose des `secret_ids`/`secret_values` vides.
- **Les sondes de santé ciblent `/healthcheck`**, le point de terminaison non authentifié 200 d'Audiobookshelf (démarrage : délai initial de 15 s, période de 10 secondes, 10 échecs autorisés ; vivacité : délai de 30 s, période de 30 secondes, 3 échecs).
- **Pas de Redis.** Le `main.tf` de la variante remplace le `enable_redis` par défaut de la fondation par `false` pour ce module.
- **Domaine personnalisé activé par défaut.** `enable_custom_domain = true` (contrairement à la plupart des autres modules GKE, qui le désactivent par défaut) — fournissez `application_domains` pour attacher un nom d'hôte, sinon il revient à l'IP du LoadBalancer.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — le StatefulSet Audiobookshelf {#a-gke-autopilot--the-audiobookshelf-statefulset}

Audiobookshelf s'exécute en tant que **StatefulSet** à pod unique (le type de charge de travail résolu par défaut lorsque `stateful_pvc_enabled = true`), ce qui lui confère une identité de pod stable et un redémarrage ordonné — approprié pour une charge de travail SQLite à rédacteur unique.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail Audiobookshelf pour les pods, les révisions et les événements. Kubernetes Engine → Services et Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de charge de travail (Déploiement vs StatefulSet).

### B. Persistent Volume Claim — le stockage par blocs `/data` {#b-persistent-volume-claim--the-data-block-storage}

Tout l'état d'Audiobookshelf — la base de données SQLite, la configuration de l'application, les illustrations de couverture et les métadonnées mises en cache — réside sous `/data`, sauvegardé par un **Persistent Volume Claim de bloc** provisionné par pod par le StatefulSet. gcsfuse est explicitement évité ici car il corrompt SQLite et l'index des fichiers multimédias. Des bibliothèques multimédias supplémentaires (par exemple un bucket de livres audio en lecture seule) peuvent toujours être attachées via `gcs_volumes` à un chemin de montage différent.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail → l'onglet Volumes/Stockage. Compute Engine → Disques liste également le Persistent Disk sous-jacent.
- **CLI :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE" -l app=<service-name>
  gcloud compute disks list --project "$PROJECT" --filter="name~<service-name>"
  ```

Voir [App_GKE](App_GKE.md) §7 (StatefulSet / PVC) pour les options de StorageClass, et §6 ci-dessous pour le piège du quota SSD.

### C. Cloud Build et Artifact Registry — l'image conteneur {#c-cloud-build--artifact-registry--the-container-image}

Le module construit une image wrapper légère `FROM ghcr.io/advplyr/audiobookshelf:${AUDIOBOOKSHELF_VERSION}` via Cloud Build et la stocke dans l'Artifact Registry du locataire, isolant les déploiements des limites de débit du registre amont et épinglant la version.

- **Console :** Cloud Build → Historique ; Artifact Registry → Dépôts.
- **CLI :**
  ```bash
  gcloud builds list --project "$PROJECT" --limit 5
  gcloud artifacts docker images list \
    "$REGION-docker.pkg.dev/$PROJECT/<repo>/audiobookshelf" --project "$PROJECT"
  ```

### D. Secret Manager {#d-secret-manager}

Audiobookshelf lui-même n'a pas besoin de secrets injectés — il n'y a pas de mot de passe de base de données, de clé maîtresse ou de secret JWT. Secret Manager reste disponible pour tout `secret_environment_variables` personnalisé que vous ajoutez. Sur GKE, les secrets sont projetés dans les pods via le pilote CSI Secret Store.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~audiobookshelf"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store CSI.

### E. Réseau et ingress {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe Cloud Load Balancing (`service_type = ClusterIP` par défaut au niveau de la fondation, mais l'ingress d'Audiobookshelf est normalement accessible via `enable_custom_domain = true` et une IP statique réservée ; définissez `service_type = LoadBalancer` pour une IP externe directe sans domaine personnalisé). Un domaine personnalisé avec un certificat géré par Google est activé par défaut pour ce module.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés, Cloud CDN et les IP statiques.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les métriques GKE sont acheminées vers Cloud Monitoring. Des vérifications de disponibilité et des politiques d'alerte optionnelles sont disponibles (les vérifications de disponibilité sont désactivées par défaut et ne fonctionnent que sur un point de terminaison accessible publiquement).

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Audiobookshelf {#3-audiobookshelf-application-behaviour}

- **Premier démarrage autonome, pas de job d'initialisation.** Au premier démarrage, Audiobookshelf crée sa base de données SQLite et sa structure de répertoires sous `CONFIG_PATH`/`METADATA_PATH` — aucun job d'initialisation, job de migration ou provisionnement de base de données n'est impliqué. Étant donné que les deux chemins se trouvent sous le montage PVC persistant, la base de données survit aux redémarrages de pod et aux mises à niveau de version d'application. `Audiobookshelf_Common` n'injecte aucun `initialization_jobs` par défaut ; des jobs personnalisés peuvent toujours être fournis pour des chargements de données ponctuels.
- **Assistant de configuration de première exécution.** Ouvrez l'URL du service (`/`) — Audiobookshelf vous invite à créer l'utilisateur **root** initial de manière interactive. Il n'y a pas de bootstrap admin basé sur l'environnement ; les jetons API sont créés dans l'interface utilisateur web par la suite (Paramètres → Utilisateurs).
- **Rédacteur unique, réplica unique.** SQLite sur un PVC de bloc tolère exactement un rédacteur. Le module épingle `min_instance_count = 1` / `max_instance_count = 1` ; un StatefulSet avec `stateful_pod_management_policy = OrderedReady` garantit en outre que les pods ne sont pas démarrés simultanément pendant les événements de mise à l'échelle.
- **Point de terminaison de santé.** `/healthcheck` renvoie HTTP 200 non authentifié une fois le serveur prêt ; il prend en charge la sonde de démarrage **HTTP** (délai initial de 15 s, période de 10 secondes, jusqu'à 10 échecs ≈ 115 s de grâce au premier démarrage) et la sonde de vivacité **HTTP** (délai initial de 30 s, période de 30 secondes, 3 échecs). L'interface utilisateur web est à `/`.
- **Contraintes de mise à l'échelle.** En tant que StatefulSet avec un backend SQLite à rédacteur unique, ne pas dépasser 1 réplica. Les `stateful_update_strategy` et `stateful_pod_management_policy` par défaut (tous deux `null` → valeurs par défaut de la fondation `RollingUpdate`/`OrderedReady`) sont adéquats pour un nombre de réplicas de 1 ; ils n'ont d'importance que si vous expérimentez avec plus d'un pod, ce qui n'est pas pris en charge par l'application.
- **CLI de vérification :**
  ```bash
  kubectl get pods,pvc -n "$NAMESPACE"
  SERVICE=$(kubectl get svc -n "$NAMESPACE" -o jsonpath='{.items[?(@.metadata.labels.application=="audiobookshelf")].metadata.name}')
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- wget -qO- http://localhost:80/healthcheck
  kubectl port-forward -n "$NAMESPACE" svc/<service-name> 8080:80
  curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/healthcheck   # expect 200
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour Audiobookshelf sont listés ; toutes les autres entrées sont héritées de [App_GKE](App_GKE.md) avec son comportement et ses valeurs par défaut standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `audiobookshelf` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag d'image `ghcr.io/advplyr/audiobookshelf` utilisé comme base de build personnalisé ; `latest` se résout en `2.17.0` épinglé via l'ARG de build `AUDIOBOOKSHELF_VERSION` spécifique à l'application. |
| `application_display_name` | `Audiobookshelf Media Server` | Nom d'affichage lisible par l'homme. |
| `description` | `Audiobookshelf — self-hosted audiobook and podcast server with progress sync across clients` | Description de la charge de travail. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` | `1000m` | CPU par pod. Les analyses de bibliothèque sont liées au CPU — augmentez la taille pour les importations importantes. |
| `memory_limit` | `1Gi` | Mémoire par pod ; augmentez la taille pour les grandes bibliothèques. |
| `min_instance_count` | `1` | Maintenez à 1 pour éviter les démarrages à froid pendant le chargement de la bibliothèque/de l'index. |
| `max_instance_count` | `1` | **Maintenez à 1** — une bibliothèque SQLite, un rédacteur. |
| `container_port` | `80` | Port HTTP d'Audiobookshelf (fixé par `Audiobookshelf_Common` ; cette variable n'est pas elle-même transmise à App_GKE). |
| `enable_cloudsql_volume` | `false` | Pas de Cloud SQL — maintenez `false` ; Audiobookshelf ne l'utilise pas. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image amont dans Artifact Registry. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Type de service Kubernetes ; définissez `LoadBalancer` pour une IP externe directe. |
| `workload_type` | `null` → `StatefulSet` (via `stateful_pvc_enabled = true`) | Recommandé pour l'identité de pod stable d'Audiobookshelf et les redémarrages ordonnés. |
| `session_affinity` | `None` | Déploiement à réplica unique, donc les sessions persistantes ne sont pas requises. |
| `network_tags` | `["nfsserver"]` | Valeur par défaut héritée de la fondation ; Audiobookshelf n'utilise pas NFS, donc cette balise n'a aucun effet pratique à moins que `enable_nfs` ne soit également activé. |

### Groupe 7 — StatefulSet / PVC {#group-7--statefulset--pvc}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | Requis — gcsfuse corrompt la base de données SQLite et l'index des fichiers multimédias d'Audiobookshelf, donc un vrai PVC de bloc sauvegarde `/data`. |
| `stateful_pvc_size` | `20Gi` | Taille pour contenir l'index complet de la bibliothèque audio plus les frais généraux (le PVC contient la configuration/les métadonnées, pas nécessairement les fichiers audio bruts s'ils sont montés séparément via `gcs_volumes`). |
| `stateful_pvc_mount_path` | `/data` | Les deux `CONFIG_PATH` (`/data/config`) et `METADATA_PATH` (`/data/metadata`) résident sous ce montage. |
| `stateful_pvc_storage_class` | `standard-rwo` (SSD, PD équilibré) | Voir §6 — considérez `standard` (HDD) pour éviter d'épuiser le quota `SSD_TOTAL_GB` ; la charge de travail SQLite/média d'Audiobookshelf n'a pas besoin d'IOPS SSD. |
| `stateful_pod_management_policy` | `null` → `OrderedReady` | Requis pour des redémarrages sûrs d'une charge de travail à rédacteur unique. |
| `stateful_update_strategy` | `null` → `RollingUpdate` | N'a d'importance que si le nombre de réplicas est (non pris en charge) supérieur à 1. |
| `stateful_fs_group` | `3000` | Correspond à la convention fsGroup du graphique Helm d'Audiobookshelf (l'application s'exécute en tant que UID 1000/GID 2000) afin que le PVC soit inscriptible par le groupe. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Non utilisé par défaut — l'état d'Audiobookshelf réside sur le PVC de bloc, pas sur NFS. |

### Groupe 14 — Cloud Storage {#group-14--cloud-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne le bucket `storage` du module Common ; inutilisé pour le montage primaire `/data` lorsque `stateful_pvc_enabled = true` (le PVC remplace GCS FUSE à ce chemin), mais toujours créé et disponible pour les remplacements `gcs_volumes`. |
| `gcs_volumes` | `[]` | Montages GCS FUSE supplémentaires, par exemple un bucket de bibliothèque multimédia en lecture seule à un chemin séparé. |

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` (valeur par défaut de la fondation) → forcé à `false` par `main.tf` | Audiobookshelf n'utilise pas Redis ; la variante code en dur `enable_redis = false` dans son appel `App_GKE` quelle que soit la valeur de cette variable. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixe — Audiobookshelf n'a pas de base de données SQL ; toutes les autres entrées de base de données sont transmises pour la compatibilité de la fondation uniquement et n'ont aucun effet. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Activé par défaut pour ce module (contrairement à la plupart des modules GKE, qui le désactivent par défaut). |
| `application_domains` | `[]` | Noms d'hôte personnalisés + certificat géré ; fournissez-en un pour utiliser le domaine personnalisé. |
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite des autorisations au niveau de l'organisation). |
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
| `stage_service_cluster_ips` | Carte des ClusterIP pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Audiobookshelf. |
| `statefulset_name` | Nom du StatefulSet. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` | Noms des jobs de configuration personnalisés (aucun par défaut). |
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

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur de fondation [App_GKE](App_GKE.md), qui valide les valeurs *et les combinaisons* au moment de la planification — un `StatefulSet` forcé à côté d'un paramètre sans état, IAP sans identités autorisées, `quota_memory_*` donné comme des entiers bruts, un `container_port`/`backup_retention_days` hors de portée. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'au moment de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `max_instance_count` | `1` | Critique | Plusieurs pods écrivent la même base de données SQLite sur le PVC partagé — corruption de la base de données. |
| `stateful_pvc_enabled` | `true` | Critique | Le désactiver revient à un montage de type GCS-FUSE pour `/data` ; gcsfuse corrompt la base de données SQLite et l'index des fichiers multimédias d'Audiobookshelf. |
| `CONFIG_PATH` / `METADATA_PATH` (via `environment_variables`) | laisser les valeurs par défaut | Critique | Les modifier après le premier démarrage orpheline la base de données SQLite existante et les métadonnées mises en cache. |
| `stateful_pvc_mount_path` | `/data` | Critique | Doit rester synchronisé avec `CONFIG_PATH`/`METADATA_PATH` ; une non-concordance signifie que la base de données SQLite n'est jamais réellement persistée sur le PVC. |
| `stateful_pvc_storage_class` | `standard` (HDD) recommandé par rapport à la valeur par défaut `standard-rwo` (SSD) | Élevé | Ce module utilise actuellement par défaut `standard-rwo`, ce qui consomme le quota régional strict `SSD_TOTAL_GB` (par exemple, seulement 500 Go sur Qwiklabs) ; la charge de travail SQLite/média d'Audiobookshelf n'a pas besoin d'IOPS SSD. Une campagne de plusieurs applications stateful basées sur SSD peut épuiser le quota — passez `-var stateful_pvc_storage_class=standard` pour utiliser un HDD (`pd-standard`) à la place. Mettre la charge de travail à zéro ne libère **pas** le PVC ; seule sa suppression le fait. |
| `container_port` | `80` | Critique | Audiobookshelf écoute sur 80 (`PORT=80` injecté par `Audiobookshelf_Common`) ; une non-concordance fait échouer chaque sonde de santé. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont traités comme des octets et bloquent toute planification de pod dans l'espace de noms (pertinent uniquement si `enable_resource_quota = true`). |
| `enable_redis` | forcé `false` quelle que soit l'entrée | Faible | Audiobookshelf n'a aucune utilité pour Redis ; la variante ignore cette variable et passe toujours `false` à la fondation. |
| `application_version` | tag épinglé | Moyen | `latest` se résout silencieusement en `2.17.0` épinglé ; épinglez explicitement pour contrôler les mises à niveau. |
| `enable_custom_domain` / `application_domains` | `true` / définir un nom d'hôte | Moyen | Laissé `true` sans `application_domains`, le module revient à l'URL interne du cluster ou à l'IP du LoadBalancer plutôt qu'à un nom d'hôte stable. |
| `enable_cloudsql_volume` | `false` | Faible | Aucune instance Cloud SQL n'existe ; l'activation gaspille un sidecar. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**.
La configuration d'application spécifique à Audiobookshelf partagée avec la variante Cloud Run est
décrite dans **[Audiobookshelf_Common](Audiobookshelf_Common.md)**.

<!-- related-guides -->

## Guides connexes {#related-guides}

- [Lab pratique : Audiobookshelf sur GKE Autopilot](../labs/Audiobookshelf_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Audiobookshelf sur Google Cloud Run](Audiobookshelf_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Audiobookshelf Common — Configuration d'application partagée](Audiobookshelf_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Calibre-Web sur GKE Autopilot](CalibreWeb_GKE.md), [Komga sur GKE Autopilot](Komga_GKE.md), [Kavita sur GKE Autopilot](Kavita_GKE.md), [Navidrome sur GKE Autopilot](Navidrome_GKE.md) dans la solution **Bibliothèque numérique**.
