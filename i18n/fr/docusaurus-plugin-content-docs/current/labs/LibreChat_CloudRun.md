---
title: "LibreChat sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez LibreChat sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/LibreChat_CloudRun.md @ 3055034 sha256:ee65b497634a -->

# LibreChat sur Cloud Run — Guide de lab {#librechat-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/LibreChat_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

LibreChat est une interface de chat IA open source qui offre une expérience unifiée sur plus de 20
fournisseurs de LLM, dont OpenAI, Anthropic, Google Gemini et Ollama. Ce lab vous fait parcourir
tout le cycle de vie opérationnel du module **LibreChat on Cloud Run** sur Google
Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les
problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google Cloud**, et non sur
les fonctionnalités de LibreChat. Pour la liste complète des services provisionnés et de chaque
paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/LibreChat_CloudRun) —
ce lab ne duplique volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder au service en cours d'exécution et le vérifier.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et le stockage.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Artifact Registry et les comptes de service
  partagés dont dépend ce module). Vous n'avez pas besoin de le déployer vous-même
  au préalable — la plateforme détecte automatiquement s'il existe déjà dans le
  projet cible et, sinon, le provisionne avant ce module (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes qu'elle affiche en tant que Owner du projet, puis **Verify**) et d'accorder le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne requiert ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **LibreChat (Cloud Run)** dans la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue les
   paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/LibreChat_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run, copie l'image de conteneur LibreChat vers
   Artifact Registry, ajoute l'image officielle `mongo:7` en tant que **sidecar dans le pod** (le backend
   MongoDB par défaut — son URI `mongodb://127.0.0.1:27017/LibreChat` est la valeur par défaut
   de `mongodb_uri`), génère des secrets cryptographiques dans Secret Manager et provisionne un bucket GCS
   pour les téléversements. Les premiers déploiements prennent environ **10 à 20 minutes** (la copie de l'image et
   le provisionnement NFS du répertoire de données du sidecar représentent l'essentiel du temps). Aucune base de données Firestore n'est créée
   dans cette configuration par défaut — la compatibilité MongoDB de Firestore est une alternative optionnelle
   (définissez `mongodb_uri` sur `""` pour l'activer ; consultez le Guide de configuration).

3. Une fois l'opération terminée, repérez les ressources avec des filtres indépendants des noms (afin que les
   commandes continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~librechat" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est sain et connecté à sa base de données MongoDB :

   ```bash
   curl -s -o /dev/null -w "%{http_code}" "$SERVICE_URL/"
   # expect 200
   ```

   Le chemin racine de LibreChat (`/`) renvoie HTTP 200 une fois l'application entièrement initialisée
   et connectée à MongoDB. Si vous recevez une erreur 502 ou 503, le service est peut-être encore en cours
   de démarrage — attendez 30 secondes et réessayez.

2. Ouvrez `$SERVICE_URL` dans un navigateur. La page de connexion et d'inscription de LibreChat s'affiche.
   Inscrivez le compte administrateur initial. Après l'inscription, revenez sur la plateforme RAD,
   définissez `allow_registration = false`, puis appliquez la modification via **Update** pour empêcher les inscriptions non autorisées en libre-service sur
   les déploiements publics.

3. Vérifiez que les secrets applicatifs générés automatiquement sont en place :

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~librechat"
   ```

   Vous devriez voir des secrets pour `creds-key`, `creds-iv`, `jwt-secret`, `jwt-refresh-secret`
   et `mongo-uri`. Ils sont injectés à l'exécution sous forme de références Secret Manager — ils n'apparaissent jamais
   en clair dans la spécification de la révision Cloud Run.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision immuable ;
   le trafic bascule vers la plus récente qui soit saine) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres d'instances min/max et en cliquant sur **Update** sur la page de détails du déploiement — le
   module possède la spécification du service, donc la mise à l'échelle est une modification de configuration, et non une modification manuelle via `gcloud`
   (une modification manuelle serait annulée lors du prochain apply Terraform). Remarque : si vous utilisez le
   sidecar `mongo:7` par défaut dans le pod, conservez `max_instance_count = 1` ; ne l'augmentez qu'après avoir
   fait pointer `mongodb_uri` vers un MongoDB externe (Atlas, auto-hébergé ou Firestore) avec la
   gestion des sessions Redis activée.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version via **Update** sur la page de détails du déploiement ; une nouvelle image est copiée et une nouvelle révision est déployée.

4. **Gérez les secrets et le stockage :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~librechat"

   # Inspect the default MongoDB backend — the in-pod mongo:7 sidecar container
   # (additional_containers) in the same Cloud Run service, not Firestore:
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
     --format=json | jq '.spec.template.spec.containers'

   # If mongodb_uri was cleared to "" to opt into Firestore MongoDB compatibility instead:
   gcloud firestore databases list --project="$PROJECT"

   # View the uploads GCS bucket
   UPLOADS_BUCKET=$(gcloud storage buckets list --project="$PROJECT" \
     --filter="name~librechat" --format="value(name)" --limit=1)
   gcloud storage ls "gs://${UPLOADS_BUCKET}/"
   ```

5. **Injectez les clés d'API des fournisseurs d'IA** à l'aide de `secret_environment_variables` (et non de
   `environment_variables` en clair) afin qu'elles ne soient jamais exposées dans les métadonnées des révisions Cloud Run ni dans les
   journaux d'audit. Créez d'abord les secrets dans Secret Manager, puis référencez-les par leur nom dans
   la plateforme RAD et appliquez la modification via **Update**.

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre du Logs Explorer :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le nombre de requêtes,
   la latence des requêtes (P50/P95/P99), le nombre d'instances (comportement de mise à l'échelle) et l'utilisation
   CPU / mémoire. Le module provisionne également un **test de disponibilité** (uptime check) ; vérifiez qu'il est au vert sous
   Monitoring → Uptime checks, et consultez Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit
de diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de LibreChat.

- **Révision non saine / le service ne répond pas :** examinez la dernière révision et ses journaux
  pour repérer les erreurs de démarrage, et vérifiez que les variables d'environnement et les secrets ont été correctement résolus.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Erreurs de connexion à MongoDB :** par défaut, il n'y a aucune base de données Firestore à vérifier — vérifiez
  que le conteneur sidecar `mongo:7` est présent dans le pod et en cours d'exécution, et que le secret `mongo-uri`
  possède une version valide (il contient l'URI `mongodb://127.0.0.1:27017/LibreChat` du sidecar,
  sauf si `mongodb_uri` a été remplacé).
  ```bash
  gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
    --format=json | jq '.spec.template.spec.containers'
  MONGO_SECRET=$(gcloud secrets list --project="$PROJECT" \
    --filter="name~librechat AND name~mongo-uri" --format="value(name)" --limit=1)
  gcloud secrets versions list "$MONGO_SECRET" --project="$PROJECT"
  ```
  Ce n'est que si `mongodb_uri` a été explicitement défini sur `""` pour activer la compatibilité MongoDB de Firestore
  que vous devez plutôt vérifier que la base de données Firestore existe :
  ```bash
  gcloud firestore databases list --project="$PROJECT"
  ```
- **Échec de la copie de l'image :** consultez l'historique de Cloud Build dans la console pour le journal du build
  en échec. Le module copie l'image LibreChat de GHCR vers Artifact Registry à chaque
  déploiement.
- **Erreur 503 au démarrage :** les démarrages à froid de LibreChat peuvent prendre 15 à 30 secondes, le temps que la connexion
  MongoDB s'établisse et que les ressources se chargent. La sonde de démarrage dispose d'un seuil d'échec
  généreux — attendez qu'elle réussisse avant de poursuivre le diagnostic.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution et assurez-vous
  qu'il peut accéder aux secrets Secret Manager.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). La suppression retire tout ce que le module a créé — le service Cloud Run (et son sidecar `mongo:7` dans le pod), les secrets
Secret Manager, le bucket GCS des téléversements, le volume NFS et les images d'Artifact Registry. Si vous aviez
plutôt activé la compatibilité MongoDB de Firestore (en définissant `mongodb_uri` sur `""`), cette
**base de données Firestore est volontairement conservée** (politique ABANDON) afin d'éviter toute perte de données ; supprimez-la
manuellement via la console GCP si vous n'en avez plus besoin — cela ne s'applique pas à un déploiement
par défaut, puisqu'aucune base de données Firestore n'a été créée. Les ressources appartenant à **Services_GCP**
(le VPC, le registre partagé) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run (avec un sidecar `mongo:7` dans le pod), les secrets et le bucket GCS des téléversements |
| 2 — Accéder et vérifier | Manuel | Le contrôle d'état réussit ; inscrire le compte administrateur initial ; vérifier les secrets |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l'échelle, mettre à jour la version, gérer les secrets/le stockage |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de sidecar MongoDB, de copie d'image, de démarrage et d'IAM |
| 6 — Démanteler | Automatisé | La suppression (Trash) retire toutes les ressources du module ; la base de données Firestore (si activée) est conservée |
