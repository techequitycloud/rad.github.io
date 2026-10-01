---
title: "Ghost sur Cloud Run — Guide de Lab"
description: "Lab pratique : déployer Ghost sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, opérations, observabilité et suppression."
---

<!-- translated-from: docs/labs/Ghost_CloudRun.md @ 700aff6 sha256:cb5fa6327b5e -->

# Ghost sur Cloud Run — Guide de Lab {#ghost-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Ghost_CloudRun)**

## Vue d'ensemble {#overview}

**Temps estimé :** 45 à 90 minutes

Ghost est une plateforme de publication open source moderne pour les blogs, les newsletters et les sites d'adhésion. Ce lab vous guide à travers le cycle de vie opérationnel complet du module **Ghost sur Cloud Run** sur Google Cloud : le déployer, y accéder et le vérifier, l'exécuter au quotidien, l'observer, diagnostiquer les problèmes courants et le supprimer.

Le lab se concentre sur l'exploitation du **module Cloud Run et de la plateforme Google Cloud**, et non sur les fonctionnalités du produit Ghost. Pour la liste complète des services provisionnés et de chaque entrée de configuration (organisée par groupe), consultez le [Guide de configuration](https://docs.radmodules.dev/docs/modules/Ghost_CloudRun) — ce lab ne duplique délibérément pas ces détails afin qu'ils restent précis au fil du temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez capable de :

- Déployer le module depuis la plateforme RAD et localiser les ressources qu'il provisionne.
- Accéder au service en cours d'exécution et le vérifier.
- Effectuer les opérations du deuxième jour — inspecter, mettre à l'échelle, mettre à jour et gérer les secrets et les sauvegardes.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Supprimer proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Cloud SQL, Artifact Registry et les comptes de service partagés dont ce module dépend). Vous n'avez pas besoin de le déployer vous-même au préalable — la plateforme détecte automatiquement s'il existe déjà dans le projet cible et le provisionne avant ce module si ce n'est pas le cas (voir Tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
- Rôle IAM de **Propriétaire de projet** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement, la boîte de dialogue de confirmation de déploiement vous demande de prouver que vous le contrôlez (**Obtenir le code de vérification**, exécuter les commandes qu'il affiche en tant que Propriétaire de projet, puis **Vérifier**) et de donner au compte de service de déploiement RAD le rôle de **Propriétaire**. Un projet créé par RAD pour vous n'a besoin ni de l'un ni de l'autre.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page d'entrées (et, dans un projet créé par RAD pour vous, guère plus que le nom du locataire et la région). Toutes les autres entrées du Guide de configuration — y compris les entrées de mise à l'échelle et de version dans les tâches du deuxième jour — sont modifiées par la suite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui nécessite un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez ces variables shell une fois ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Catalogue de solutions → Modules RAD** dans la navigation supérieure de la plateforme RAD, ouvrez **Ghost (Cloud Run)** depuis la liste **Modules de plateforme** pour commencer la configuration, choisissez **Formulaire de configuration** sous *Comment souhaitez-vous configurer ce déploiement ?* (le formulaire s'ouvre sur l'**Assistant conversationnel** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id`, et examinez les entrées. Ne configurez que ce dont vous avez besoin — le [Guide de configuration](https://docs.radmodules.dev/docs/modules/Ghost_CloudRun) documente chaque entrée par groupe, avec les valeurs par défaut. Cliquez sur **Déployer le module**, examinez le coût estimé dans la boîte de dialogue **Confirmation de déploiement** lorsqu'elle apparaît et cliquez sur **Soumettre** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, complétez-la et cliquez sur **Confirmer**), ce qui ouvre la page d'état du déploiement avec des journaux en temps réel.

2. La plateforme provisionne le service Cloud Run, une base de données Cloud SQL (MySQL 8.0) avec ses secrets Secret Manager, un partage NFS Filestore pour le contenu partagé, un bucket GCS `ghost-content` dédié, construit l'image conteneur et exécute une tâche d'initialisation de base de données unique. Les premiers déploiements prennent environ **20 à 35 minutes** (la création de Cloud SQL domine).

3. Une fois terminé, découvrez les ressources avec des filtres agnostiques au nom (afin que les commandes continuent de fonctionner quel que soit le suffixe de déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~ghost" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Confirmez que le service est sain. Le chemin de santé de Ghost est `/`, qui renvoie HTTP 200 une fois que Ghost a terminé d'exécuter les migrations de base de données et de compiler les thèmes au premier démarrage (prévoyez jusqu'à 90 secondes pour un nouveau déploiement) :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"
   ```

2. Ouvrez `${SERVICE_URL}/ghost` dans un navigateur pour accéder au panneau d'administration de Ghost. Au premier démarrage, Ghost présente un assistant de configuration interactif — entrez le titre de votre site, le nom de l'administrateur, l'e-mail et le mot de passe pour terminer la configuration. Le mot de passe de la base de données (la seule information d'identification stockée dans Secret Manager) peut être récupéré si nécessaire :

   ```bash
   DB_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~ghost" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$DB_SECRET" --project="$PROJECT"
   ```

---

## Tâche 3 — Opérer et maintenir en fonctionnement (Jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspecter le service et ses révisions** (chaque déploiement crée une révision immuable ; le trafic bascule vers la plus récente et saine) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mise à l'échelle** — normalement, il s'agit d'un changement de configuration (le module possède la spécification du service, donc une modification manuelle `gcloud` serait annulée lors de la prochaine application) via les entrées d'instances min/max et **Update** sur la page des détails du déploiement. **Bug connu :** `Ghost_CloudRun/main.tf` code actuellement en dur `min_instance_count = 0` et `max_instance_count = 5` dans le local `ghost_module`, ignorant silencieusement tout `min_instance_count`/`max_instance_count` que vous définissez (il y a un `TODO` dans `main.tf` décrivant ce bug exact) — la modification de ces entrées et le clic sur Update n'ont actuellement **aucun effet** sur les limites de mise à l'échelle du service déployé tant que cette surcharge codée en dur n'est pas supprimée de la source du module.

3. **Mettre à jour la version de l'application** en modifiant l'entrée de version via **Update** sur la page des détails du déploiement ; une nouvelle image est construite et une nouvelle révision est déployée.

4. **Gérer les secrets, le stockage et les tâches :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~ghost"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init + backup jobs
   gcloud storage buckets list --project="$PROJECT" --filter="name~ghost"
   ```

5. **Ouvrir une session de base de données** pour inspection ou maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. ghostdemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^ghost" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : Journalisation et Surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l'Explorateur de journaux :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

Filtre de l'Explorateur de journaux :
`resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run pour le service et examinez le nombre de requêtes, la latence des requêtes (P50/P95/P99), le nombre d'instances (comportement de mise à l'échelle) et l'utilisation du CPU/de la mémoire. Le module provisionne également une **vérification de disponibilité** ; confirmez qu'elle est verte sous Surveillance → Vérifications de disponibilité, et examinez Alertes → Politiques.

---

## Tâche 5 — Dépannage et débogage [Manuel] {#task-5--troubleshoot--debug-manual}

Techniques durables pour les modes de défaillance que vous êtes le plus susceptible de rencontrer. Il s'agit de diagnostics au niveau de la plateforme qui ne changent pas avec les versions de Ghost.

- **Révision non saine / le service ne fonctionne pas :** Ghost a un délai initial de sonde de démarrage de 90 secondes pour permettre les migrations de base de données et la compilation de thèmes au premier démarrage. Inspectez la dernière révision et ses journaux avant de conclure que le service a échoué :
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Erreurs de connexion à la base de données :** confirmez que l'instance Cloud SQL (MySQL 8.0) est `RUNNABLE`, que le secret du mot de passe de la base de données existe et que la tâche `db-init` s'est terminée avec succès.
- **La tâche d'initialisation a échoué :** listez les exécutions et lisez les journaux de celle qui a échoué :
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Montage NFS / contenu non partagé :** vérifiez `enable_nfs = true` et que l'environnement d'exécution est `gen2` (requis pour les montages Filestore dans Cloud Run).
- **La construction de l'image a échoué :** examinez l'historique de Cloud Build pour le journal de la construction échouée. Le `container_image_source` doit être `custom` — l'image Ghost en amont manque le point d'entrée qui mappe les informations d'identification de la base de données et détecte l'URL du service.
- **403 / erreurs d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Pièges de configuration* du Guide de configuration pour les particularités spécifiques aux paramètres.

---

## Tâche 6 — Supprimer [Automatisé] {#task-6--tear-down-automated}

Sur la page **Déploiements**, ouvrez le déploiement et cliquez sur l'icône **Corbeille** (**Supprimer**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles qui entrent en conflit avec l'état Terraform), utilisez plutôt **Purger** (depuis la même boîte de dialogue **Supprimer**) — cela supprime le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (cela fait oublier le déploiement à RAD). Cela supprime tout ce que le module a créé — le service Cloud Run, la base de données Cloud SQL, les secrets Secret Manager, les buckets GCS (y compris le bucket `ghost-content`), le partage NFS Filestore et les images Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC, Cloud SQL partagé, le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Résumé {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, Cloud SQL (MySQL 8.0), NFS, un bucket GCS, des secrets, et exécute l'initialisation de la base de données |
| 2 — Accéder et vérifier | Manuel | La vérification de santé réussit ; terminer l'assistant de configuration de l'administrateur Ghost |
| 3 — Opérer | Manuel | Inspecter les révisions, mettre à l'échelle, mettre à jour la version, gérer les secrets/sauvegardes/stockage, accès à la base de données |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et la vérification de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de base de données, de tâche d'initialisation, de NFS, de build et d'IAM |
| 6 — Supprimer | Automatisé | Supprimer (Corbeille) supprime toutes les ressources du module |
