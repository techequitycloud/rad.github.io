---
title: "Linkwarden sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez Linkwarden sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Linkwarden_CloudRun.md @ 3055034 sha256:c9524e85f85c -->

# Linkwarden sur Cloud Run — Guide de lab {#linkwarden-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Linkwarden_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45 à 90 minutes

Linkwarden est un gestionnaire de favoris open source et auto-hébergé, doté de l'archivage de pages
complètes (captures d'écran, PDF et instantanés « monolith » en fichier unique via un Chrome headless
intégré). Ce lab vous fait parcourir tout le cycle de vie opérationnel du
module **Linkwarden on Cloud Run** sur Google Cloud : le déployer, y accéder et
le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et le
démanteler.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google
Cloud**, et non sur les fonctionnalités de Linkwarden. Pour la liste complète des
services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez
le [Guide de configuration](https://docs.radmodules.dev/docs/modules/Linkwarden_CloudRun) —
ce lab ne duplique volontairement pas ce détail afin de rester exact dans le
temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez capable de :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il
  provisionne.
- Accéder au service en cours d'exécution et le vérifier.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour et gérer les secrets.
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
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes qu'elle affiche en tant que Owner du projet, puis **Verify**) et d'accorder le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne requiert ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez ces variables shell une fois ; chacune des tâches ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Linkwarden (Cloud Run)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et
   passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Linkwarden_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page
   d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run, une base de données Cloud SQL (PostgreSQL 15)
   avec ses secrets Secret Manager (`NEXTAUTH_SECRET` et le
   mot de passe de la base), un bucket Cloud Storage monté sur `/data/data` pour
   le contenu archivé, construit l'image de conteneur personnalisée (une fine enveloppe autour de
   `ghcr.io/linkwarden/linkwarden`) et exécute un job ponctuel
   d'initialisation de la base de données. Les premiers déploiements prennent environ **20 à 35 minutes** (la création de Cloud SQL
   représente l'essentiel du temps).

3. Une fois l'opération terminée, repérez les ressources avec des filtres indépendants des noms (afin
   que les commandes continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~linkwarden" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est joignable (Linkwarden ne dispose d'aucun point de terminaison de santé
   dédié confirmé ; la page racine est donc le meilleur indicateur) :

   ```bash
   curl -s -o /dev/null -w '%{http_code} %{size_download}\n' "$SERVICE_URL"
   # expect 200 and a non-trivial byte size (a rendered page, not an empty body)
   ```

2. Ouvrez `$SERVICE_URL` dans un navigateur. Lors de la première visite, Linkwarden affiche la
   page d'inscription — aucun identifiant administrateur pré-provisionné n'existe dans Secret
   Manager. Inscrivez le premier compte ; il devient automatiquement le
   propriétaire de l'instance.

3. **Vérifiez l'archivage de bout en bout (le véritable test avec état).** Connectez-vous, ajoutez un
   favori (n'importe quelle URL publique) et attendez 10 à 30 secondes que le worker d'archivage
   en arrière-plan le traite. Actualisez la vue détaillée du lien et vérifiez
   qu'une capture d'écran/un aperçu a été généré — cela prouve que l'écriture en base, le
   worker en arrière-plan, le Chrome headless et le montage de stockage adossé à GCS sont
   tous correctement raccordés. Si l'archivage ne se termine jamais, consultez la tâche 5.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une
   révision immuable ; le trafic bascule vers la plus récente qui soit saine) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres d'instances min/max et en cliquant sur **Update**
   sur la page de détails du déploiement — le module possède la spécification du service, donc
   la mise à l'échelle est une modification de configuration, et non une modification manuelle via `gcloud` (une modification
   manuelle serait annulée lors de la prochaine application). Conservez `min_instance_count >= 1`
   — le worker d'archivage en arrière-plan intégré au conteneur doit continuer à s'exécuter
   entre les requêtes.

3. **Mettez à jour le tag de version de l'application** en modifiant le paramètre de version dans
   la plateforme RAD et en l'appliquant via **Update** ; une nouvelle image est construite et une
   nouvelle révision est déployée. Linkwarden publie un véritable tag `latest` en
   amont, si bien que `latest` suit la version amont réelle (contrairement à certains autres
   modules à build personnalisé de ce catalogue qui épinglent une version obsolète).

4. **Gérez les secrets :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~linkwarden"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init job
   ```

5. **Ouvrez une session de base de données** pour inspection ou maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. linkwardendemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^linkwarden" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre de l'explorateur de journaux :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez
   le nombre de requêtes, la latence des requêtes (P50/P95/P99), le nombre d'instances (comportement
   de mise à l'échelle) et l'utilisation CPU / mémoire — surveillez les pics de mémoire pendant
   les lots du worker d'archivage (instances Chrome headless simultanées). Le module
   peut provisionner un **test de disponibilité** (lorsque
   `uptime_check_config.enabled = true` — la valeur par défaut est `false`) ; s'il est activé, vérifiez qu'il est au vert sous
   Monitoring → Uptime checks, et consultez Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit
de diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Linkwarden.

- **Révision non saine / le service ne répond pas :** examinez la dernière révision
  et ses journaux pour repérer les erreurs de démarrage, et vérifiez que les variables d'environnement et les secrets ont été résolus.
  La sonde de démarrage cible `/` et accorde une fenêtre généreuse au premier démarrage
  pour le démarrage à froid de Next.js et l'initialisation du Chrome headless.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est
  `RUNNABLE`, que le secret du mot de passe de la base existe et que le job d'initialisation
  s'est terminé avec succès. Sur Cloud Run, le `DATABASE_URL` de Linkwarden se connecte directement à
  l'IP privée de Cloud SQL (`DB_IP`) avec `sslmode=require` — jamais
  via le chemin du socket Unix (l'analyse du DSN par autorité d'URL de Prisma échoue sur les
  deux-points du répertoire du socket).
- **L'archivage ne se termine jamais / les liens restent sans aperçu :** vérifiez d'abord que le
  service lui-même est sain (tâche 2, étape 1). Si c'est le cas, il s'agit très probablement
  du risque documenté lié au bac à sable gVisor de Cloud Run avec le Chrome headless
  intégré — recherchez dans les journaux du conteneur un échec de lancement de Chrome/Playwright.
  En solution de repli, définissez `disable_browser = true` (ignore tout l'archivage dépendant
  du navigateur ; les fonctionnalités de métadonnées, de tags et de collections continuent de fonctionner) et vérifiez
  si cela résout la boucle de plantages — si c'est le cas, il s'agit d'une incompatibilité
  avec le bac à sable de la plateforme, et non d'une erreur de configuration.
- **Échec du job d'initialisation :** listez les exécutions et lisez les journaux de celle qui a
  échoué :
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Échec du build de l'image :** consultez l'historique de Cloud Build pour le journal du build
  en échec.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service
  d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les
pièges propres à chaque paramètre (notamment la règle essentielle : ne jamais renouveler
`NEXTAUTH_SECRET` après le premier démarrage).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash**
(**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement
du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la
plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en
conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le
déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD
oublie le déploiement). La suppression retire tout ce que le module a créé —
le service Cloud Run, la base de données Cloud SQL, les secrets Secret Manager, les buckets
GCS et les images d'Artifact Registry. Les ressources appartenant à **Services_GCP**
(le VPC, le Cloud SQL partagé, le registre) sont gérées séparément et ne sont pas
supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, Cloud SQL (PostgreSQL 15), les secrets et le bucket de stockage GCS, puis exécute l'initialisation de la base |
| 2 — Accéder et vérifier | Manuel | Le service répond ; inscrire le premier compte (qui devient propriétaire) ; vérifier que l'archivage aboutit de bout en bout |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l'échelle, mettre à jour la version, gérer les secrets, accéder à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de base de données, d'archivage/bac à sable Chrome, de job d'initialisation, de build et d'IAM |
| 6 — Démanteler | Automatisé | La suppression (Trash) retire toutes les ressources du module |
