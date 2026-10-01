---
title: "Loki sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez Loki sur Cloud Run dans votre propre projet Google Cloud — mise en place guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/Loki_CloudRun.md @ 3055034 sha256:66f93756d4cd -->

# Loki sur Cloud Run — Guide de lab {#loki-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Loki_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 30–45 minutes

Grafana Loki est un système d'agrégation de journaux évolutif horizontalement (« Prometheus pour
les journaux ») qui n'indexe qu'un petit ensemble de libellés par flux de journaux plutôt que le texte
complet des journaux, ce qui maintient des coûts de stockage faibles. Ce lab vous fait parcourir le cycle de vie
opérationnel complet du module **Loki on Cloud Run** sur Google Cloud : le déployer, y accéder et
le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et le
supprimer.

Loki n'a ni base de données ni interface web intégrée, ce lab est donc plus court et plus simple que
la plupart de ceux de ce catalogue — il n'y a pas de compte administrateur à créer au premier démarrage, ni de migration
de schéma à attendre. Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme
Google Cloud**, et non sur le langage de requête de Loki ni sur son intégration avec Grafana.
Pour la liste complète des services provisionnés et de chaque paramètre de configuration
(organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Loki_CloudRun) — ce
lab ne reprend volontairement pas ce détail afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder au service en cours d'exécution, le vérifier et exécuter une première requête LogQL.
- Effectuer les opérations du jour 2 — inspecter, comprendre la contrainte de mise à l'échelle, mettre à jour et
  inspecter l'utilisation du stockage GCS.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Artifact Registry et les comptes de service
  partagés dont dépend ce module). Vous n'avez pas besoin de le déployer vous-même
  au préalable — la plateforme détecte automatiquement s'il existe déjà dans le
  projet cible et, sinon, le provisionne avant ce module (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et
  `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous n'exige ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tout autre paramètre du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifie ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Sur un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.
- Facultatif mais utile : **`logcli`** (la CLI officielle de Grafana pour Loki) installé localement
  pour la tâche 2.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Loki (Cloud Run)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id` et passez en revue les
   paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Loki_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement
   avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run, un bucket Cloud Storage dédié
   (`storage`) que Loki utilise comme backend pour ses chunks et son index, construit l'image
   de conteneur personnalisée (un wrapper basé sur distroless autour de `grafana/loki` — voir la
   section Pitfalls du Guide de configuration) et accorde à l'identité d'exécution Cloud Run
   le rôle `roles/storage.objectAdmin` sur le bucket. Il n'y a **ni base de données ni
   job d'initialisation**, c'est donc l'un des premiers déploiements les plus rapides du catalogue — comptez
   environ **5 à 10 minutes**, principalement consacrées à la construction du conteneur.

3. Une fois l'opération terminée, repérez les ressources avec des filtres indépendants des noms (afin que
   les commandes continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~loki" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Confirmez que le service est sain. Loki expose un point de terminaison de disponibilité non authentifié
   qui renvoie HTTP 200 dès que le serveur écoute — généralement quelques
   secondes après le démarrage, puisqu'il n'y a pas d'étape de migration :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/ready"   # expect 200
   ```

2. **Loki n'a pas d'interface web propre.** Il est normalement utilisé comme source de données derrière
   **Grafana**, ou interrogé directement avec **`logcli`** ou en HTTP simple via son
   API de requête. Exécutez une première requête (un résultat vide est attendu si rien n'a encore
   envoyé de journaux — l'essentiel est que l'API réponde au lieu de
   renvoyer une erreur) :

   ```bash
   # Direct HTTP:
   curl -s "$SERVICE_URL/loki/api/v1/labels" | jq .

   # Or with logcli:
   export LOKI_ADDR="$SERVICE_URL"
   logcli labels
   ```

3. Envoyez une petite ligne de journal de test pour confirmer l'ingestion de bout en bout (ajustez
   l'horodatage à l'epoch Unix actuel en nanosecondes) :

   ```bash
   NOW_NS=$(date +%s%N)
   curl -s -X POST "$SERVICE_URL/loki/api/v1/push" \
     -H "Content-Type: application/json" \
     -d '{"streams":[{"stream":{"job":"lab-test"},"values":[["'"$NOW_NS"'","hello from the lab"]]}]}'
   # Then query it back (may take a few seconds to become queryable):
   curl -s "$SERVICE_URL/loki/api/v1/query?query=%7Bjob%3D%22lab-test%22%7D" | jq .
   ```

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions :**

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mise en garde sur la mise à l'échelle — ne dépassez pas 1 instance.** Contrairement à la plupart des modules de ce
   catalogue, `max_instance_count` est **forcé à `1`** par le module, quelle que soit
   la valeur définie sur le déploiement — la configuration intégrée de Loki utilise un anneau en mémoire
   (`replication_factor: 1`) et un compacteur singleton qui ne peut pas coordonner la
   rétention et la suppression entre des instances concurrentes. Si vous avez besoin de plus de débit,
   augmentez `cpu_limit`/`memory_limit` sur l'instance unique plutôt que de compter sur une mise à l'échelle
   horizontale.

3. **Mettez à jour l'étiquette de version de l'application** en modifiant le paramètre de version dans la plateforme
   RAD et en l'appliquant via **Update** ; une nouvelle image est construite (en régénérant la
   même configuration à partir du modèle) et une nouvelle révision est déployée.

4. **Inspectez l'utilisation du stockage GCS** — le principal élément à surveiller au jour 2, puisque tout
   l'état durable de Loki réside ici :

   ```bash
   gcloud storage buckets list --project="$PROJECT" --filter="name~storage"
   gcloud storage du -s gs://<storage-bucket>/
   gcloud storage ls gs://<storage-bucket>/index_*/     # TSDB index shards
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — les journaux du processus Loki lui-même (et non les journaux qu'il ingère, qui sont des
   données applicatives dans Loki, et non des entrées Cloud Logging) :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre du Logs Explorer :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le nombre
   de requêtes, la latence des requêtes, le nombre d'instances et l'utilisation du CPU et de la mémoire. Le module
   peut provisionner un **test de disponibilité** (lorsque `uptime_check_config.enabled = true` — la valeur
   par défaut est `false`) ; s'il est activé, confirmez qu'il est au vert sous Monitoring → Uptime
   checks.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement.

- **Service non sain / ne répond pas :** inspectez la dernière révision et ses journaux pour détecter
  des erreurs de démarrage. La sonde de démarrage cible `/ready` — un échec à ce niveau signifie presque toujours
  que l'étape de génération de la configuration dans le point d'entrée a échoué (vérifiez que
  `LOKI_GCS_BUCKET` s'est résolu en un véritable nom de bucket) plutôt qu'une lente migration au premier
  démarrage (il n'y en a pas).
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Erreurs d'autorisation GCS** (`403` / `storage: object doesn't exist` lors des écritures) :
  confirmez que le compte de service d'exécution Cloud Run dispose de `roles/storage.objectAdmin` sur
  le bucket `storage` :
  ```bash
  gcloud storage buckets get-iam-policy gs://<storage-bucket>
  ```
- **Échec du build de l'image :** consultez l'historique Cloud Build pour le journal du build en échec. Si
  vous (ou un futur mainteneur) avez modifié le Dockerfile et obtenu `exec: /bin/sh: no
  such file or directory` ou `exec /bin/busybox: no such file or directory`, il s'agit du
  problème d'image de base distroless documenté dans la section Pitfalls du Guide de configuration
  — l'image officielle `grafana/loki` n'a ni shell ni éditeur de liens dynamique.
- **La requête renvoie un résultat vide alors que l'envoi a réussi :** confirmez que le sélecteur de libellés de la requête
  correspond à ce que vous avez envoyé, et laissez quelques secondes au chemin d'écriture pour se vider.
- **Erreurs 403 / d'autorisation sur le service lui-même :** vérifiez les rôles IAM du compte de service
  d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre (y compris l'histoire complète de l'image distroless et la raison pour laquelle `max_instance_count` est
figé).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash**
(**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement
est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut
plus le gérer (par exemple après des modifications manuelles en conflit avec l'état
Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des
enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le
déploiement). Cela supprime tout ce que le module a créé — le service Cloud Run, le
bucket GCS `storage` (et toutes les données de journaux ingérées qu'il contient), les entrées Secret Manager (si
certaines ont été ajoutées) et les images Artifact Registry. Les ressources appartenant à **Services_GCP**
(le VPC, le Cloud SQL partagé, le registre) sont gérées séparément et ne sont pas supprimées
ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne le service Cloud Run, le bucket GCS `storage`, et construit l'image personnalisée basée sur distroless (ni base de données, ni job d'initialisation) |
| 2 — Accéder et vérifier | Manuel | `/ready` renvoie 200 ; une ligne de journal de test envoyée puis relue avec succès |
| 3 — Exploiter | Manuel | Inspecter les révisions, comprendre la contrainte de mise à l'échelle à instance unique, mettre à jour la version, surveiller l'utilisation de GCS |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de santé du service, d'IAM GCS, de build de l'image et de requêtes |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime le service, le bucket de stockage (et ses données de journaux) et les images |
