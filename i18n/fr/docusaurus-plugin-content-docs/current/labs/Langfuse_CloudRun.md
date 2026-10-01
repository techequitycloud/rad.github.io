---
title: "Langfuse sur Cloud Run — Guide de lab"
description: "Lab pratique : déployer Langfuse sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Langfuse_CloudRun.md @ 3055034 sha256:f66cea11304a -->

# Langfuse sur Cloud Run — Guide de lab {#langfuse-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Langfuse_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Langfuse est une plateforme open source d'ingénierie et d'observabilité des LLM — traçage, gestion
des prompts, évaluations et métriques pour les applications construites sur de grands modèles de langage. Ce
lab vous fait parcourir l'intégralité du cycle de vie opérationnel du module **Langfuse on Cloud Run**
sur Google Cloud : le déployer, inscrire le premier utilisateur, générer une clé d'API, envoyer une trace, l'exploiter
au quotidien, l'observer, diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google Cloud**, et non sur
les fonctionnalités du produit Langfuse. Pour la liste complète des services provisionnés et de chaque
paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Langfuse_CloudRun) — ce lab
ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder au service en cours d'exécution, le vérifier et effectuer l'inscription du premier utilisateur.
- Créer une organisation et un projet, générer une clé d'API et envoyer votre première trace.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et les sauvegardes.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Cloud SQL, Artifact Registry et les comptes de
  service partagés dont dépend ce module). Vous n'avez pas besoin de le déployer
  vous-même au préalable — la plateforme détecte automatiquement s'il existe déjà
  dans le projet cible et, sinon, le provisionne avant ce module (voir la
  tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l'un ni l'autre.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Langfuse (Cloud Run)** depuis la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue les
   paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Langfuse_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run, une base de données Cloud SQL (PostgreSQL 15) avec
   ses secrets Secret Manager (`NEXTAUTH_SECRET`, `SALT` et le mot de passe de la base de données), un bucket
   Cloud Storage, construit l'image du conteneur (une fine surcouche de `langfuse/langfuse:2`) et
   exécute un job ponctuel d'initialisation de la base de données qui crée le rôle et la base. Langfuse
   applique ensuite son schéma via `prisma migrate deploy` au premier démarrage. Les premiers déploiements prennent
   environ **20–35 minutes** (la création de Cloud SQL en représente l'essentiel).

3. Une fois l'opération terminée, repérez les ressources avec des filtres indépendants des noms (afin que les commandes
   continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~langfuse" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est en bonne santé et connecté à sa base de données. Langfuse expose un
   point de terminaison de santé non authentifié qui ne renvoie 200 que lorsque le serveur est entièrement initialisé
   et que PostgreSQL est joignable :

   ```bash
   curl -s "$SERVICE_URL/api/public/health"   # expect an HTTP 200 with a small JSON body
   ```

2. Ouvrez `$SERVICE_URL` dans un navigateur. Lors de la première visite, Langfuse affiche une page **Sign up** —
   il n'existe aucun identifiant administrateur prédéfini. Saisissez votre nom, votre e-mail et un mot de passe, puis validez ;
   **le premier utilisateur qui s'inscrit devient le propriétaire de l'instance.** Connectez-vous.

3. Une fois le compte propriétaire créé, envisagez de désactiver l'inscription ouverte en définissant
   `AUTH_DISABLE_SIGNUP = "true"` dans `environment_variables` et en l'appliquant via **Update**.

---

## Tâche 3 — Créer un projet et envoyer une trace [Manuel] {#task-3--create-a-project--send-a-trace-manual}

1. Dans l'interface de Langfuse, créez une **Organization** (organisation), puis un **Project** (projet) à l'intérieur. Langfuse
   rattache les traces, les prompts et les clés d'API à un projet.

2. Ouvrez **Project → Settings → API Keys** et cliquez sur **Create new API key**. Copiez la **Public
   Key** (`pk-lf-...`) et la **Secret Key** (`sk-lf-...`) — la clé secrète n'est affichée qu'une seule fois.

3. Envoyez votre première trace directement à l'API publique d'ingestion avec `curl` (authentification Basic =
   `public:secret`). Il s'agit du même point de terminaison que celui utilisé par les SDK Langfuse :

   ```bash
   PUBLIC_KEY="pk-lf-..."
   SECRET_KEY="sk-lf-..."
   TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)

   curl -s -u "$PUBLIC_KEY:$SECRET_KEY" \
     -X POST "$SERVICE_URL/api/public/ingestion" \
     -H "Content-Type: application/json" \
     -d '{
       "batch": [{
         "id": "'"$(uuidgen)"'",
         "type": "trace-create",
         "timestamp": "'"$TS"'",
         "body": { "id": "'"$(uuidgen)"'", "name": "lab-hello-trace", "input": "ping" }
       }]
     }'
   ```

   Une réponse `207`/`200` contenant un tableau `successes` confirme l'ingestion. Actualisez **Tracing** dans
   l'interface — l'entrée `lab-hello-trace` devrait apparaître en quelques secondes.

---

## Tâche 4 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-4--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision immuable ;
   le trafic bascule vers la plus récente en bonne santé) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances puis en cliquant sur **Update** sur la page
   de détails du déploiement — le module possède la spécification du service, la mise à l'échelle est donc une modification de configuration, et non une
   modification manuelle via `gcloud` (une modification manuelle serait annulée lors de la prochaine application). Conservez
   `min_instance_count = 1` et `cpu_always_allocated = true` afin que le traitement en arrière-plan continue de
   s'exécuter entre les requêtes.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme RAD et
   en l'appliquant via **Update** ; une nouvelle image est construite et une nouvelle révision est déployée. Langfuse exécute
   `prisma migrate deploy` au démarrage, si bien qu'un changement de version applique automatiquement les modifications de schéma —
   prévoyez un temps de démarrage supplémentaire lors du premier démarrage après une mise à niveau.

4. **Gérez les secrets et les sauvegardes :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~langfuse"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # init + scheduled backup jobs
   ```

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. langfusedemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^langfuse" --limit=1)
   DB_NAME=$(gcloud sql databases list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^langfuse" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --database="$DB_NAME" --project="$PROJECT"
   ```

---

## Tâche 5 — Observer : journalisation et surveillance [Manuel] {#task-5--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre du Logs Explorer :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le nombre de requêtes,
   la latence des requêtes (P50/P95/P99), le nombre d'instances (comportement de mise à l'échelle) et l'utilisation du CPU et de la
   mémoire. Si vous avez activé un **test de disponibilité** (uptime check), vérifiez qu'il est au vert dans Monitoring →
   Uptime checks, et consultez Alerting → Policies.

---

## Tâche 6 — Dépanner et déboguer [Manuel] {#task-6--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de diagnostics
au niveau de la plateforme, qui ne changent pas avec les versions de Langfuse.

- **Révision en mauvaise santé / `Invalid environment variables` :** la validation zod de Langfuse refuse
  de démarrer si `NEXTAUTH_SECRET` ou `SALT` est absent. Vérifiez que les deux secrets existent et sont injectés :
  ```bash
  gcloud secrets list --project="$PROJECT" --filter="name~secret-key OR name~superuser-password"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
  La sonde de démarrage cible par défaut le chemin `/` (et non le point de terminaison dédié `/api/public/health` — ce
  chemin n'est pas configuré par défaut ; consultez le
  [Guide de configuration](https://docs.radmodules.dev/docs/modules/Langfuse_CloudRun) pour le
  remplacer) et prévoit une fenêtre généreuse au premier démarrage (délai initial de 60 s, seuil de 30 échecs) pour les
  migrations Prisma.
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est `RUNNABLE`, que le secret du mot
  de passe de la base existe et que le job `db-init` s'est terminé avec succès.
- **Échec du job d'initialisation :** listez les exécutions et lisez les journaux de celle qui a échoué :
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Les migrations ne se sont pas exécutées :** Langfuse exécute `prisma migrate deploy` au démarrage (et non dans un job
  distinct). Si le schéma semble vide, recherchez la sortie de la migration au démarrage dans les journaux du service.
- **Échec du build de l'image :** consultez l'historique de Cloud Build pour lire le journal du build en échec. Notez que l'image
  est épinglée sur la branche **v2** via l'ARG de build `LANGFUSE_VERSION` — un tag v3 la casserait.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres à chaque paramètre
(notamment la règle essentielle de ne jamais renouveler `NEXTAUTH_SECRET` ni `SALT` après le premier démarrage).

---

## Tâche 7 — Démanteler [Automatisé] {#task-7--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**).
Delete exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour
l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple
après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime
le déploiement des enregistrements de RAD **sans** détruire les ressources cloud. Delete supprime
tout ce que le module a créé — le service Cloud Run, la base de données Cloud SQL, les secrets Secret Manager,
le bucket GCS et les images Artifact Registry. Les ressources appartenant à **Services_GCP** (le
VPC, le Cloud SQL partagé, le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, Cloud SQL (PostgreSQL 15), les secrets, le bucket de stockage, et exécute l'initialisation de la base |
| 2 — Accéder et vérifier | Manuel | La vérification d'état réussit ; inscrire le premier utilisateur (qui devient propriétaire) et se connecter |
| 3 — Projet et trace | Manuel | Créer une organisation/un projet, générer une clé d'API, envoyer une trace via curl |
| 4 — Exploiter | Manuel | Inspecter les révisions, mettre à l'échelle, mettre à jour la version, gérer les secrets/sauvegardes, accéder à la base |
| 5 — Observer | Manuel | Interroger Cloud Logging ; consulter les métriques Cloud Monitoring et le test de disponibilité |
| 6 — Dépanner | Manuel | Diagnostiquer les problèmes de secrets/variables d'environnement, de base de données, de job d'initialisation, de migration, de build et d'IAM |
| 7 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
