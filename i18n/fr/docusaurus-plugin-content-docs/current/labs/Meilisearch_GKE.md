---
title: "Meilisearch sur GKE Autopilot — Guide de Lab"
description: "Lab pratique : déployer Meilisearch sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, opérations, observabilité et suppression."
---

<!-- translated-from: docs/labs/Meilisearch_GKE.md @ 15fd4c7 sha256:033ee23226e4 -->

# Meilisearch sur GKE Autopilot — Guide de Lab {#meilisearch-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Meilisearch_GKE)**

## Vue d'ensemble {#overview}

**Temps estimé :** 30 à 60 minutes

Meilisearch est un moteur de recherche rapide et open source — un binaire Rust
unique qui offre une recherche instantanée, tolérante aux fautes de frappe et
à facettes via une API REST simple, largement utilisé comme alternative auto-hébergeable
à Algolia. Ce lab vous guide à travers le cycle de vie opérationnel complet du
module **Meilisearch sur GKE Autopilot** sur Google Cloud : déployez-le avec un
PVC StatefulSet, accédez-y et vérifiez-le, créez un véritable index de recherche
et interrogez-le, exécutez-le au quotidien, observez-le, diagnostiquez les problèmes
courants et supprimez-le.

Le lab se concentre sur l'exploitation du **module GKE et de la plateforme Google Cloud**,
et non sur toutes les fonctionnalités de Meilisearch. Pour la liste complète des
services provisionnés et de chaque entrée de configuration (organisée par groupe),
consultez le [Guide de configuration](https://docs.radmodules.dev/docs/modules/Meilisearch_GKE)
— ce lab ne duplique délibérément pas ces détails afin qu'ils restent exacts au fil du temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez capable de :

- Déployer le module (PVC StatefulSet) depuis la plateforme RAD et localiser les ressources qu'il provisionne.
- Accéder à la charge de travail en cours d'exécution, la vérifier et récupérer la clé principale.
- Créer un index, ajouter des documents et exécuter une recherche tolérante aux fautes de frappe via l'API REST.
- Effectuer des opérations de jour 2 — inspecter les pods/PVC, mettre à jour, créer des clés à portée limitée et gérer les sauvegardes.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Supprimer le déploiement proprement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Artifact Registry
  et les comptes de service partagés dont dépend ce module). Vous n'avez pas
  besoin de le déployer vous-même au préalable — la plateforme détecte
  automatiquement s'il existe déjà dans le projet cible et le provisionne
  avant ce module si ce n'est pas le cas (voir Tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
- **kubectl** installé.
- Rôle **Propriétaire du projet** (ou équivalent) IAM sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement, la boîte
  de dialogue de confirmation du déploiement vous demande de prouver que vous
  le contrôlez (**Obtenir le code de vérification**, exécutez les commandes
  affichées en tant que Propriétaire du projet, puis **Vérifier**) et de donner
  le rôle **Propriétaire** au compte de service de déploiement RAD. Un projet
  créé par RAD pour vous n'a besoin ni de l'un ni de l'autre.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création
  ne demande que la première page d'entrées (et, dans un projet créé par RAD
  pour vous, guère plus que le nom du locataire et la région). Toute autre
  entrée du Guide de configuration — y compris les entrées de mise à l'échelle
  et de version dans les tâches de jour 2 — est modifiée par la suite avec
  **Update** sur la page du déploiement après avoir coché **Enable advanced
  mode**, ce qui nécessite un solde de crédits couvrant le coût de build
  estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de
  module). Dans un environnement de lab, seul un administrateur peut utiliser
  le mode avancé.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules
  dans le projet.

Définissez ces variables shell une fois ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**,
   puis ouvrez **Meilisearch (GKE)** depuis la liste **Platform Modules**,
   choisissez **Configuration Form** sous *How would you like to configure this
   deployment?* (le formulaire s'ouvre sur l'**Assistant Conversationnel** si
   vous détenez des crédits achetés ou si vous êtes un partenaire ou un
   administrateur), définissez `project_id`, et conservez les
   valeurs par défaut `stateful_pvc_enabled = true` (stockage Persistent Disk) et
   `stateful_pvc_mount_path = "/meili_data"`, qui correspond au `MEILI_DB_PATH` fixe
   — monter le PVC ailleurs laisse l'index sur un stockage éphémère.
   Passez en revue les entrées restantes — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Meilisearch_GKE)
   documente chaque entrée par groupe, avec les valeurs par défaut. Cliquez sur
   **Deploy Module**, examinez le coût estimé dans la boîte de dialogue
   **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit**
   (si la boîte de dialogue ajoute ensuite une étape de confirmation, telle que
   la vérification d'un projet que vous apportez, complétez-la et cliquez sur
   **Confirm**), ce qui ouvre la page d'état du déploiement avec des logs en
   temps réel.

2. La plateforme génère le `MEILI_MASTER_KEY` et le stocke dans Secret Manager
   (en l'injectant comme un Secret Kubernetes natif), construit et met en
   miroir l'image `getmeili/meilisearch:v1.11`, crée un StatefulSet avec un PVC monté au
   chemin que vous avez défini dans `stateful_pvc_mount_path` (`/meili_data`,
   selon l'étape 1 ci-dessus), et expose un service **LoadBalancer** par défaut
   (`service_type =
   "LoadBalancer"`). Il n'y a **pas** de base de données Cloud SQL et **pas** de
   job d'initialisation — Meilisearch gère son propre stockage. Les premiers
   déploiements prennent environ **8 à 15 minutes** (build d'image +
   planification de pod Autopilot).

3. Une fois terminé, obtenez les identifiants du cluster et découvrez les
   ressources avec des filtres agnostiques au nom :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NAMESPACE=$(kubectl get ns -o name | grep -i meilisearch | head -1 | cut -d/ -f2)
   SERVICE=$(kubectl get svc -n "$NAMESPACE" -o name | grep -iv headless | head -1 | cut -d/ -f2)
   SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~api-key" --format="value(name)" --limit=1)
   MEILI_MASTER_KEY=$(gcloud secrets versions access latest --secret="$SECRET" --project="$PROJECT")
   echo "Namespace: $NAMESPACE"
   echo "Service:   $SERVICE"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Confirmez que le pod est en cours d'exécution et que le PVC est lié :

   ```bash
   kubectl get pods,pvc -n "$NAMESPACE"
   ```

2. Transférez le port du Service et vérifiez le point de terminaison
   non authentifié `/health`, qui renvoie `{"status":"available"}` une
   fois le moteur prêt :

   ```bash
   kubectl port-forward -n "$NAMESPACE" "svc/$SERVICE" 7700:7700 &
   curl -s "http://localhost:7700/health"          # expect {"status":"available"}
   ```

3. Confirmez que la clé principale fonctionne et liste l'ensemble des index
   (initialement vide) :

   ```bash
   curl -s "http://localhost:7700/indexes" -H "Authorization: Bearer $MEILI_MASTER_KEY"
   # expect {"results":[],"offset":0,"limit":20,"total":0}
   ```

---

## Tâche 3 — Construire un index et le rechercher (exemple fonctionnel) [Manuel] {#task-3--build-an-index-and-search-it-worked-example-manual}

Avec le transfert de port de la Tâche 2 toujours ouvert, créez un index, ajoutez
des documents et exécutez une recherche tolérante aux fautes de frappe — le
tout via l'API REST avec la clé principale comme jeton Bearer.

1. **Ajouter des documents.** Meilisearch crée l'index automatiquement lors de
   la première écriture ; le champ `id` est la clé primaire :

   ```bash
   curl -s -X POST "http://localhost:7700/indexes/movies/documents" \
     -H "Authorization: Bearer $MEILI_MASTER_KEY" \
     -H 'Content-Type: application/json' \
     --data '[
       {"id":1,"title":"Interstellar","genre":"Sci-Fi","year":2014},
       {"id":2,"title":"Inception","genre":"Sci-Fi","year":2010},
       {"id":3,"title":"The Grand Budapest Hotel","genre":"Comedy","year":2014}
     ]'
   # returns a task: {"taskUid":0,"status":"enqueued",...}
   ```

2. **Attendre l'indexation** (les écritures sont traitées de manière
   asynchrone comme des tâches) :

   ```bash
   curl -s "http://localhost:7700/indexes/movies/tasks" \
     -H "Authorization: Bearer $MEILI_MASTER_KEY" | head
   # look for "status":"succeeded"
   ```

3. **Rechercher — avec une faute de frappe délibérée** pour démontrer la
   tolérance aux fautes de frappe intégrée (`interstellr` trouve toujours
   *Interstellar*) :

   ```bash
   curl -s "http://localhost:7700/indexes/movies/search" \
     -H "Authorization: Bearer $MEILI_MASTER_KEY" \
     -H 'Content-Type: application/json' \
     --data '{"q":"interstellr"}'
   # returns the Interstellar hit in a few milliseconds
   ```

4. **Filtrer et facetter.** Rendez `genre` et `year`
   filtrables, puis interrogez-les :

   ```bash
   curl -s -X PATCH "http://localhost:7700/indexes/movies/settings/filterable-attributes" \
     -H "Authorization: Bearer $MEILI_MASTER_KEY" \
     -H 'Content-Type: application/json' \
     --data '["genre","year"]'

   curl -s "http://localhost:7700/indexes/movies/search" \
     -H "Authorization: Bearer $MEILI_MASTER_KEY" \
     -H 'Content-Type: application/json' \
     --data '{"q":"","filter":"year = 2014 AND genre = Sci-Fi"}'
   # returns only Interstellar
   ```

5. **Vérification de la persistance.** Tout cela réside sur le PVC à
   `/meili_data` — cela n'est valable que tant que `stateful_pvc_mount_path`
   reste à sa valeur par défaut `/meili_data` (tout autre chemin ne
   sauvegarde pas le répertoire de données, donc l'index serait perdu lors de la
   recréation du pod). Supprimez le pod et observez le StatefulSet le recréer
   avec les mêmes données attachées :

   ```bash
   kubectl delete pod -n "$NAMESPACE" -l app=meilisearch      # StatefulSet recreates it
   kubectl get pods -n "$NAMESPACE" -w                         # wait for Running/Ready
   # re-run the search from step 3 — the index is still there
   ```

---

## Tâche 4 — Opérer et maintenir en fonctionnement (Jour 2) [Manuel] {#task-4--operate--keep-it-running-day-2-manual}

1. **Inspecter la charge de travail, le PVC et les événements :**

   ```bash
   kubectl get statefulset,pods,pvc,svc -n "$NAMESPACE"
   kubectl describe pvc -n "$NAMESPACE"
   kubectl logs -n "$NAMESPACE" "statefulset/$SERVICE" --tail=100
   ```

2. **Ne pas mettre à l'échelle horizontalement.** Meilisearch est à écriture
   unique ; le module épingle `max_instance_count = 1`. Pour gérer plus de charge,
   augmentez `cpu_limit`/`memory_limit` via **Update**,
   pas le nombre de réplicas — le module possède la spécification de la charge
   de travail, donc un `kubectl scale` manuel serait annulé lors du
   prochain apply.

3. **Créez une clé API à portée limitée et réservée à la recherche** pour votre
   application au lieu de partager la clé principale :

   ```bash
   curl -s -X POST "http://localhost:7700/keys" \
     -H "Authorization: Bearer $MEILI_MASTER_KEY" \
     -H 'Content-Type: application/json' \
     --data '{"description":"web search-only","actions":["search"],"indexes":["movies"],"expiresAt":null}'
   # returns a scoped "key" — distribute THIS, never the master key
   ```

4. **Mettez à jour la version de l'application** en modifiant l'entrée de
   version dans la plateforme RAD et en l'appliquant via **Update** ; une
   nouvelle image est construite et le StatefulSet déploie le pod.

5. **Gérez les secrets et les sauvegardes :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~meilisearch"
   kubectl get cronjob -n "$NAMESPACE"          # scheduled backup jobs, if enabled
   ```

---

## Tâche 5 — Observer : Journalisation et Surveillance [Manuel] {#task-5--observe-logging--monitoring-manual}

1. **Logs** — depuis la CLI ou l'Explorateur de logs :

   ```bash
   gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
     --project="$PROJECT" --limit=50
   ```

2. **Surveillance** — ouvrez le tableau de bord des charges de travail GKE et
   examinez l'utilisation du CPU/mémoire du pod (surveillez la mémoire à mesure
   que votre index grandit), le nombre de redémarrages et l'utilisation du PVC.
   Si vous avez activé le **test de disponibilité** contre `/health`,
   confirmez qu'il est vert sous Surveillance → Tests de disponibilité, et
   examinez Alertes → Politiques.

---

## Tâche 6 — Dépannage et débogage [Manuel] {#task-6--troubleshoot--debug-manual}

Techniques durables pour les modes de défaillance que vous êtes le plus
susceptible de rencontrer. Ce sont des diagnostics au niveau de la plateforme
et ils ne changent pas avec les versions de Meilisearch.

- **Pod CrashLoopBackOff / ne démarre pas :** une cause courante est une
  **clé principale manquante** — en mode production, Meilisearch se ferme
  immédiatement si `MEILI_MASTER_KEY` n'est pas défini ou est plus court que
  16 octets. Confirmez `enable_api_key = true` et que le Secret K8s est présent :
  ```bash
  kubectl describe pod -n "$NAMESPACE" -l app=meilisearch
  kubectl get secret -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" "statefulset/$SERVICE" --previous --tail=100
  ```
- **`401`/`403` sur les appels API :** la clé que vous
  avez envoyée ne correspond pas au `MEILI_MASTER_KEY` déployé. Relisez-la
  depuis Secret Manager et réessayez.
- **Pod en attente :** Autopilot planifie la capacité ou le PVC n'est pas lié
  — vérifiez `kubectl describe pod` et `kubectl get pvc`.
- **L'index semble vide après un redémarrage du pod :** confirmez que le chemin
  de montage du PVC est `/meili_data` (il doit correspondre à
  `MEILI_DB_PATH`) et que le PVC a été rattaché.
- **`Image not found` / build échoué :** examinez l'historique de Cloud Build
  pour le log du build échoué.
- **403 / erreurs de permission :** vérifiez que le compte de service Google
  de la charge de travail (Workload Identity) a les rôles d'accès à Secret
  Manager et de stockage.

Consultez la section *Pièges de configuration* du Guide de configuration pour
les astuces spécifiques aux paramètres (y compris la correspondance du chemin
du PVC avec `MEILI_DB_PATH` et le fait de ne jamais exécuter plus d'un
réplica sur le même volume).

---

## Tâche 7 — Suppression [Automatisé] {#task-7--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône
**Corbeille** (**Delete**). La suppression exécute `terraform destroy` et est
irréversible (l'enregistrement du déploiement est conservé pour l'historique).
Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer
(par exemple après des modifications manuelles qui entrent en conflit avec
l'état Terraform), utilisez **Purge** à la place (depuis la même boîte de
dialogue **Delete**) — cela supprime le déploiement des enregistrements de RAD
**sans** détruire les ressources cloud (cela fait oublier le déploiement à
RAD). Cela supprime tout ce que le module a créé — le StatefulSet, le Service
Kubernetes, le PVC (et toutes les données indexées), le secret
`MEILI_MASTER_KEY` et les images Artifact Registry. Les ressources
appartenant à **Services_GCP** (le VPC, le cluster GKE, le registre) sont
gérées séparément et ne sont pas supprimées ici.

---

## Résumé {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne un StatefulSet + PVC, le secret de la clé principale et construit l'image (pas de DB) |
| 2 — Accéder et vérifier | Manuel | Pod en cours d'exécution, PVC lié ; `/health` renvoie disponible ; la clé principale liste les index |
| 3 — Indexer et rechercher | Manuel | Créer un index, ajouter des documents, exécuter une recherche tolérante aux fautes de frappe + filtrée ; survit à la suppression d'un pod |
| 4 — Opérer | Manuel | Inspecter les pods/PVC, dimensionner verticalement, créer des clés à portée limitée, mettre à jour la version, gérer les sauvegardes |
| 5 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 6 — Dépannage | Manuel | Diagnostiquer les problèmes de clé principale, d'authentification, de planification, de PVC, de build et d'IAM |
| 7 — Suppression | Automatisé | La suppression (Corbeille) supprime toutes les ressources du module, y compris le PVC et les données indexées |
