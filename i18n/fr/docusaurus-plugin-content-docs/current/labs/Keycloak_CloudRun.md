---
title: "Keycloak sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez Keycloak sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/Keycloak_CloudRun.md @ 3055034 sha256:e00e4ef57148 -->

# Keycloak sur Cloud Run — Guide de lab {#keycloak-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Keycloak_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Keycloak est une plateforme open source de gestion des identités et des accès qui fournit l'authentification unique (SSO), OIDC et SAML à vos applications. Ce lab vous fait parcourir tout le cycle de vie opérationnel du module **Keycloak on Cloud Run** sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et le supprimer.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google Cloud**, et non sur les fonctionnalités du produit Keycloak. Pour la liste complète des services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le [Guide de configuration](https://docs.radmodules.dev/docs/modules/Keycloak_CloudRun) — ce lab ne reprend volontairement pas ce détail afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder à la console d'administration de Keycloak avec l'identifiant d'amorçage stocké dans Secret Manager et vérifier le service.
- Effectuer les opérations du jour 2 : inspecter, mettre à l'échelle, mettre à jour, gérer les secrets et les sauvegardes.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Supprimer proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Cloud SQL, Artifact Registry et les comptes de
  service partagés dont dépend ce module). Vous n'avez pas besoin de le déployer
  vous-même au préalable : la plateforme détecte automatiquement s'il existe déjà dans
  le projet cible et, sinon, le provisionne avant ce module (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans ce projet, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez en tant que propriétaire (Owner) du projet les commandes affichées, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous n'exige ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement, après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Un accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; toutes les tâches ci-dessous les réutilisent :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la barre de navigation supérieure de la plateforme RAD, ouvrez **Keycloak (Cloud Run)** dans la liste **Platform Modules** pour commencer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id` et passez en revue les
   paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Keycloak_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, examinez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run, une base de données Cloud SQL
   (PostgreSQL 15) avec ses secrets Secret Manager (mot de passe de la base de
   données + mot de passe de l'administrateur d'amorçage), construit avec Cloud Build l'image de
   conteneur Keycloak optimisée pour la production (`kc.sh build` → `start --optimized`)
   et exécute une tâche ponctuelle `db-init` qui crée la base de données et le rôle
   Keycloak. Keycloak se connecte en **TCP à l'adresse IP privée de la base de
   données** (le pilote JDBC ne peut pas utiliser le socket Cloud SQL). Un premier
   déploiement prend environ **20–35 minutes** (la création de Cloud SQL en représente
   l'essentiel).

3. Une fois l'opération terminée, repérez les ressources à l'aide de filtres
   indépendants des noms (pour que les commandes fonctionnent quel que soit le suffixe
   du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~keycloak" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est sain. Le document de découverte OIDC du realm intégré
   `master` est public et prouve que Keycloak est opérationnel **et** qu'il communique
   avec sa base de données (comptez 60–120 secondes pour un démarrage à froid de la JVM
   si le service était descendu à zéro) :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" \
     "$SERVICE_URL/realms/master/.well-known/openid-configuration"   # expect 200
   curl -s "$SERVICE_URL/realms/master/.well-known/openid-configuration" | head -c 300
   ```

   Remarque : le point de terminaison `/health` de Keycloak se trouve sur le port de
   gestion 9000, que Cloud Run n'expose pas — le document de découverte est la bonne
   vérification externe.

2. Ouvrez `${SERVICE_URL}/admin` dans un navigateur pour accéder à la console
   d'administration. Connectez-vous avec l'**administrateur d'amorçage** — nom
   d'utilisateur `admin`, mot de passe issu de Secret Manager :

   ```bash
   ADMIN_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~keycloak-admin-password" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$ADMIN_SECRET" --project="$PROJECT"
   ```

3. **Durcissement immédiat :** l'administrateur d'amorçage est temporaire par
   conception. Dans la console d'administration, créez un administrateur permanent
   (Users → Add user, attribuez le rôle `admin`), connectez-vous avec cet utilisateur,
   puis supprimez ou désactivez l'utilisateur d'amorçage `admin`.

---

## Tâche 3 — Exploiter et maintenir en fonctionnement (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente qui est saine) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres d'instances min/max et en cliquant sur **Update** sur la page de détails du déploiement —
   le module gère la spécification du service ; la mise à l'échelle est donc une
   modification de configuration, et non une modification manuelle via `gcloud` (une
   modification manuelle serait annulée lors de l'application suivante). Pour un
   fournisseur d'identité (IdP) de production, définissez `min_instance_count = 1` :
   avec `0`, la première redirection SSO après une période d'inactivité subit un
   démarrage à froid de la JVM de 60–120 s.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version via **Update** sur la page de détails du déploiement ; une nouvelle image est construite et une nouvelle révision est déployée. **Ne revenez
   jamais à une version antérieure** — les migrations de schéma de Keycloak sont à sens unique.

4. **Gérez les secrets, les tâches et les sauvegardes :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~keycloak"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init + backup jobs
   ```

5. **Ouvrez une session sur la base de données** pour l'inspection ou la maintenance
   (Keycloak conserve tous les realms, clients et utilisateurs dans PostgreSQL) :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~keycloak" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l'explorateur de journaux (Logs Explorer). Le point
   d'entrée affiche un résumé de la configuration (`KC_DB_URL`, `KC_HOSTNAME`,
   paramètres du proxy) à chaque démarrage :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre pour l'explorateur de journaux :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le
   nombre de requêtes, leur latence (P50/P95/P99), le nombre d'instances (comportement
   de mise à l'échelle) ainsi que l'utilisation du CPU et de la mémoire (surveillez la
   mémoire — Keycloak est une JVM). Le test de disponibilité (uptime check) est
   désactivé par défaut ; activez `uptime_check_config` (chemin `/`) via **Update** et
   vérifiez qu'il est au vert sous Monitoring → Uptime checks.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus
probablement. Il s'agit de diagnostics au niveau de la plateforme, qui ne changent pas
d'une version de Keycloak à l'autre.

- **Révision en mauvaise santé / le service ne répond pas :** la sonde de démarrage
  (startup probe) est une sonde **TCP sur le port 8080**, avec une marge d'environ
  330 secondes pour le démarrage de la JVM et les migrations de schéma du premier
  lancement. Inspectez la dernière révision et ses journaux avant de conclure que le
  service a échoué :
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL
  (PostgreSQL 15) est `RUNNABLE`, que la tâche `db-init` s'est terminée et que le
  journal du point d'entrée affiche un `KC_DB_URL` pointant vers l'adresse IP privée.
  Keycloak se connecte en TCP — `enable_cloudsql_volume` doit rester à `false` (le
  pilote JDBC ne peut pas utiliser le socket Unix de Cloud SQL), et `vpc_egress_setting`
  doit autoriser le trafic sortant vers les plages privées.
- **Échec de la tâche d'initialisation :** listez les exécutions et lisez les journaux de celle qui a échoué :
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Échec du build de l'image :** consultez l'historique Cloud Build pour lire le
  journal du build en échec. `container_image_source` doit valoir `custom` — l'image
  amont ne dispose pas du point d'entrée qui associe les identifiants de la base de
  données et détecte le nom d'hôte.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.
- **Spécifique à l'application — les redirections OIDC pointent vers le mauvais hôte :**
  le point d'entrée détecte automatiquement l'URL `run.app` comme `KC_HOSTNAME`. Si vous
  placez Keycloak derrière un équilibreur de charge ou un domaine personnalisé,
  définissez explicitement `KC_HOSTNAME` dans `environment_variables` afin que les URL
  d'émetteur (issuer) et les redirections de connexion correspondent au nom d'hôte
  réellement visité par les utilisateurs. (Une erreur 404 sur `${SERVICE_URL}/health`
  n'est **pas** une défaillance — la santé est exposée sur le port de gestion 9000, non
  publié.)

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre.

---

## Tâche 6 — Supprimer [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). La suppression retire tout ce que le module a créé — le service Cloud Run,
la base de données Cloud SQL, les secrets Secret Manager (administrateur d'amorçage +
mot de passe de la base de données) et les images Artifact Registry. Les ressources
appartenant à **Services_GCP** (le VPC, le Cloud SQL partagé, le registre) sont gérées
séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, Cloud SQL (PostgreSQL 15), les secrets, construit l'image optimisée et exécute l'initialisation de la base |
| 2 — Accéder et vérifier | Manuel | La découverte OIDC renvoie 200 ; connexion avec l'administrateur d'amorçage ; création d'un administrateur permanent |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l'échelle, mettre à jour la version, gérer les secrets/sauvegardes, accéder à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de base de données, de tâche d'initialisation, de build, d'IAM et de nom d'hôte |
| 6 — Supprimer | Automatisé | Delete (Trash) supprime toutes les ressources du module |
