---
title: "Authentik sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez Authentik sur Cloud Run dans votre propre projet Google Cloud — mise en place guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/Authentik_CloudRun.md @ 3055034 sha256:f0ca89445e71 -->

# Authentik sur Cloud Run — Guide de lab {#authentik-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Authentik_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 60 à 90 minutes

authentik est un fournisseur d'identité open source — authentification unique via OIDC et SAML,
LDAP, SCIM, MFA et authentification par proxy ; une alternative auto-hébergée à Okta,
Auth0 et Keycloak. Ce lab vous fait parcourir le cycle de vie opérationnel complet du
module **Authentik on Cloud Run** sur Google Cloud : le déployer, y accéder et le
vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et le
supprimer.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google
Cloud**, et non sur les fonctionnalités du produit authentik. Pour la liste complète des
services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Authentik_CloudRun) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et localiser les ressources qu'il provisionne.
- Accéder au service en cours d'exécution, le vérifier et vous connecter avec l'utilisateur `akadmin` initialisé.
- Créer une première application OIDC et son fournisseur dans l'interface authentik.
- Effectuer les opérations du jour 2 — inspecter, mettre à jour la version, surveiller le
  worker colocalisé et ouvrir une session de base de données.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Supprimer proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Cloud SQL, Artifact Registry et les comptes de service
  partagés dont dépend ce module). Vous n'avez pas besoin de le déployer
  vous-même au préalable — la plateforme détecte automatiquement s'il existe déjà
  dans le projet cible et, sinon, le provisionne avant ce module (voir la tâche
  1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous n'exige ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tout autre paramètre du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifie ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Sur un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Authentik (Cloud Run)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id` et passez en revue
   les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Authentik_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement
   avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run, une base de données Cloud SQL (PostgreSQL 15)
   avec ses secrets Secret Manager (`AUTHENTIK_SECRET_KEY`, le mot de passe d'initialisation
   d'`akadmin` et le mot de passe de la base de données), un bucket Cloud Storage pour les médias
   monté sur `/media`, construit l'image personnalisée minimale (`FROM
   ghcr.io/goauthentik/server`) et exécute un job ponctuel d'initialisation de la base de données.
   Aucun Redis n'est provisionné — authentik ≥ 2025.10 conserve le cache, les sessions et sa
   file de tâches dans PostgreSQL. Les premiers déploiements prennent environ **20 à 35 minutes** (la
   création de Cloud SQL domine) ; authentik exécute ensuite l'ensemble de ses migrations au premier
   démarrage, prévoyez donc quelques minutes supplémentaires avant que le service ne devienne sain.

3. Une fois l'opération terminée, repérez les ressources avec des filtres indépendants des noms (afin que les
   commandes continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~authentik" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Confirmez que le service est sain. authentik expose un point de terminaison de disponibilité
   **non authentifié** qui ne renvoie 200 qu'une fois les migrations terminées et la
   base de données joignable :

   ```bash
   curl -s "$SERVICE_URL/-/health/ready/" -o /dev/null -w '%{http_code}\n'   # expect 200
   curl -s "$SERVICE_URL/-/health/live/"  -o /dev/null -w '%{http_code}\n'   # expect 200
   ```

   Un statut 200 seul ne prouve pas que c'est le *serveur* qui a répondu — confirmez aussi que le
   corps de la réponse n'est pas vide (un 200 avec un corps de zéro octet signifie que le mauvais
   processus a répondu sur `:9000` ; voir la tâche 5) :

   ```bash
   curl -s "$SERVICE_URL/" | wc -c   # expect non-zero — the login page HTML
   ```

2. Récupérez l'identifiant administrateur initialisé dans Secret Manager. Le module
   crée l'utilisateur intégré **`akadmin`** au premier démarrage avec l'adresse
   `bootstrap_email` configurée (par défaut `admin@techequity.cloud`) et ce mot de passe :

   ```bash
   BP_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~authentik AND name~bootstrap-password" \
     --format="value(name.basename())" --limit=1)
   gcloud secrets versions access latest --secret="$BP_SECRET" --project="$PROJECT"; echo
   ```

3. Ouvrez `$SERVICE_URL` dans un navigateur et connectez-vous avec le nom d'utilisateur **`akadmin`** et
   le mot de passe de l'étape 2. (Si les variables d'initialisation étaient absentes lors du tout
   premier démarrage, authentik propose à la place le flux de configuration initiale sur
   `$SERVICE_URL/if/flow/initial-setup/` — définissez-y le mot de passe administrateur.)

4. **Créez une première application OIDC et son fournisseur** dans l'interface :
   1. Ouvrez l'**Admin interface** (avatar en haut à droite → *Admin interface*, ou
      `$SERVICE_URL/if/admin/`).
   2. Allez dans **Applications → Applications** et cliquez sur **Create with Provider**
      (l'assistant crée l'application et son fournisseur en même temps).
   3. Nommez-la (par exemple `demo-app`), choisissez **OAuth2/OIDC Provider**, acceptez le
      flux d'autorisation par défaut (`default-provider-authorization-implicit-consent`
      ou la variante à consentement explicite) et définissez la **Redirect URI** du client sur
      l'URL de rappel de votre application de test.
   4. Terminez l'assistant, puis ouvrez le fournisseur pour copier le **Client ID**,
      le **Client Secret** et les points de terminaison OIDC (également découvrables sur
      `$SERVICE_URL/application/o/<slug>/.well-known/openid-configuration`).

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente qui est saine) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à jour la version de l'application** en modifiant le paramètre `application_version`
   dans la plateforme RAD et en l'appliquant via **Update** ; une nouvelle image est construite et une
   nouvelle révision est déployée. authentik migre son propre schéma au démarrage
   (protégé par un verrou consultatif), aucune étape de migration distincte n'est donc nécessaire — la sonde
   de démarrage retient le déploiement jusqu'à la fin des migrations. Notez que
   `application_version = "latest"` est figé sur une version réputée fiable au moment du
   build (authentik ne publie pas d'étiquette `latest`).

3. **Inspectez le worker colocalisé.** `ak worker` s'exécute dans le même conteneur que
   le serveur (lancé en arrière-plan par le point d'entrée cloud), sa sortie
   est donc entremêlée dans les journaux du service :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=200 \
     | grep -iE 'worker|task'
   ```

   Vous devriez voir des lignes de démarrage du worker et d'exécution périodique de tâches. C'est pourquoi
   le module utilise par défaut `cpu_always_allocated = true` et `min_instance_count = 1` —
   le worker travaille entre les requêtes.

4. **Gérez les secrets** (ne faites jamais de rotation de la clé secrète — cela invalide toutes les sessions
   et rend illisibles les champs chiffrés) :

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~authentik"
   ```

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance. Les noms de la base de données et
   de l'utilisateur sont préfixés par le tenant — prenez-les dans les sorties du déploiement
   (`database_name`, `database_user`) :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. authentikdemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^authentik" --limit=1)
   DB_NAME=$(gcloud sql databases list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^authentik" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --database="$DB_NAME" --project="$PROJECT"
   # e.g. inspect authentik's tables:  \dt authentik_*
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou le Logs Explorer :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre du Logs Explorer :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.
   Les lignes du serveur et du worker partagent le même flux ; authentik journalise en JSON structuré
   avec un champ `event`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez
   le nombre de requêtes, la latence des requêtes (P50/P95/P99), le nombre d'instances et l'utilisation
   du CPU et de la mémoire. Avec un CPU toujours alloué et `min=1`, vous devriez voir une ligne de base stable
   d'une instance. Examinez Alerting → Policies et, si vous avez activé le test de disponibilité,
   confirmez qu'il est au vert sous Monitoring → Uptime checks.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions d'authentik.

- **Le service reste indisponible au premier démarrage — généralement de simples migrations.** Le premier
  démarrage exécute l'ensemble des migrations Django d'authentik ; `/-/health/ready/` renvoie
  503 jusqu'à ce qu'elles soient terminées. Le budget de la sonde de démarrage est d'environ 11 minutes (délai de 60 s +
  40 × 15 s). Suivez la progression plutôt que de conclure à un échec :
  ```bash
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  # look for "Applying migration ..." lines, then the server/worker start banner
  ```
- **Erreurs de connexion à la base de données :** confirmez que l'instance Cloud SQL est `RUNNABLE`,
  que le secret du mot de passe de la base existe et que le job `db-init` s'est terminé. Le point d'entrée
  journalise au démarrage les paramètres de connexion résolus
  (`AUTHENTIK_POSTGRESQL__HOST/NAME/USER/SSLMODE`) — vérifiez qu'ils pointent vers le socket de l'Auth
  Proxy, et non vers `127.0.0.1` :
  ```bash
  gcloud sql instances list --project="$PROJECT"
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Page blanche alors que les points de terminaison de santé renvoient 200 — vérifiez quel processus détient
  `:9000`.** Le `ak worker` colocalisé démarre aussi un écouteur HTTP ; s'il se lie à
  `0.0.0.0:9000` avant le serveur, il répond à **toutes** les routes — points de terminaison de santé
  compris — par des 200 *vides* (interface blanche, sondes faussement saines). Le point d'entrée
  fixe désormais le worker sur des ports de bouclage (`127.0.0.1:9001`/`9444`/`9301`) afin que le
  serveur détienne `:9000`. Vérifiez par un contrôle du corps de la réponse :
  ```bash
  curl -s "$SERVICE_URL/" | wc -c   # non-zero = server answered; 0 = the worker won the bind
  ```
- **Échec du build de l'image :** consultez l'historique Cloud Build pour le journal du build en échec.
  Un `MANIFEST_UNKNOWN` / 404 lors de la récupération de `ghcr.io/goauthentik/server:<tag>` signifie que
  l'étiquette `application_version` demandée n'existe pas en amont — utilisez une véritable
  étiquette de version (ou `latest`, que le module fige sur une version réputée fiable).
- **Révision non saine après une modification de configuration :** inspectez la dernière révision et
  ses journaux à la recherche d'erreurs de démarrage, et confirmez que les variables d'environnement et les secrets ont été résolus :
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  ```
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour
les pièges propres à chaque paramètre (y compris la règle essentielle de ne jamais faire de rotation de
`AUTHENTIK_SECRET_KEY`).

---

## Tâche 6 — Supprimer [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). Cela supprime tout ce que le module a créé — le service Cloud Run,
la base de données Cloud SQL, les secrets Secret Manager, le bucket de médias et les images
Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC, le Cloud SQL partagé,
le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, Cloud SQL (PostgreSQL 15), les secrets, le bucket de médias GCS, construit l'image et exécute l'initialisation de la base |
| 2 — Accéder et vérifier | Manuel | `/-/health/ready/` renvoie 200 et le corps de l'interface n'est pas vide ; connexion en tant qu'`akadmin` avec le mot de passe d'initialisation ; création d'une première application OIDC et de son fournisseur |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à jour la version (migration automatique), surveiller le worker colocalisé, gérer les secrets, accéder à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring |
| 5 — Dépanner | Manuel | Diagnostiquer les attentes de migration au premier démarrage et les problèmes de base de données, de job d'initialisation, de build et d'IAM |
| 6 — Supprimer | Automatisé | Delete (Trash) supprime toutes les ressources du module |
