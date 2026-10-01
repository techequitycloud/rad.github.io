---
title: "Wallabag sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployer Wallabag sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Wallabag_GKE.md @ 3055034 sha256:2ec714ed414d -->

# Wallabag sur GKE Autopilot — Guide de lab {#wallabag-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Wallabag_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–60 minutes

Wallabag est une application open source et auto-hébergée d'archivage d'articles « à lire plus tard » —
enregistrez des articles depuis une extension de navigateur, un bookmarklet, une application mobile ou l'API
REST, et lisez-les plus tard dans une vue épurée, sans distraction, avec recherche plein texte
et étiquetage. Ce lab vous fait parcourir l'intégralité du cycle de vie opérationnel du module
**Wallabag on GKE Autopilot** sur Google Cloud : le déployer, y accéder et le
vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et le
démanteler.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**,
et non sur les fonctionnalités du produit Wallabag. Pour la liste complète des services provisionnés
et de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Wallabag_GKE) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE, accéder à la charge de travail en cours d'exécution et vous connecter avec le compte administrateur par défaut.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et le stockage.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Cloud SQL, Artifact
  Registry et les comptes de service partagés dont dépend ce module). Vous n'avez pas besoin
  de le déployer vous-même au préalable — la plateforme détecte automatiquement s'il
  existe déjà dans le projet cible et, sinon, le provisionne avant ce module
  (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` exécutés.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l'un ni l'autre.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Wallabag (GKE)**
   depuis la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id`
   et passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Wallabag_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme déploie la charge de travail dans le cluster GKE Autopilot, provisionne
   une base de données Cloud SQL (MySQL 8.0) avec ses secrets Secret Manager (`APP_SECRET`
   et le mot de passe de la base de données), un bucket Cloud Storage générique, construit l'image
   de conteneur personnalisée et exécute la chaîne d'initialisation en deux étapes : `db-init`
   (crée la base de données, l'utilisateur et les droits) suivie de `wallabag-install` (l'installateur
   propre à Wallabag, qui crée le schéma et initialise le compte administrateur par défaut
   en une seule étape). Les premiers déploiements prennent environ **15–25 minutes** (la création de Cloud SQL
   et la construction de l'image en représentent l'essentiel).

3. Connectez-vous au cluster et repérez l'espace de noms avec des filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep wallabag | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que la charge de travail s'exécute et trouvez son adresse externe :

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Vérifiez que le service est en bonne santé. Wallabag redirige une requête non authentifiée
   sur le chemin racine vers sa page de connexion — attendez-vous à un **HTTP 302**, et non 200 :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/"   # expect 302
   ```

3. Ouvrez `http://${EXTERNAL_IP}` dans un navigateur. Connectez-vous avec les identifiants
   administrateur par défaut documentés de Wallabag — **nom d'utilisateur `wallabag`, mot de passe
   `wallabag`** — créés par le job d'initialisation `wallabag-install`. **Changez ce
   mot de passe immédiatement** (menu en haut à droite → votre compte → changer le mot de passe).
   L'inscription en libre-service est désactivée par défaut ; c'est donc le seul compte
   tant que vous n'en créez pas d'autres depuis l'interface d'administration.

4. Enregistrez un article de test pour confirmer l'écriture et la lecture de bout en bout sur la vraie
   base de données : collez l'URL d'un article quelconque dans la zone « Save a new entry » et vérifiez
   qu'il apparaît dans votre liste avec son titre et son contenu récupérés. C'est le
   signe le plus sûr que l'application écrit réellement dans Cloud SQL et non dans un fichier
   local jetable (voir la section Dépannage pour comprendre pourquoi cette distinction est importante).

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — le déploiement Kubernetes, les pods et les événements :

   ```bash
   kubectl get deploy,pods -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances puis en cliquant sur **Update** sur
   la page de détails du déploiement — le module possède la spécification de la charge de travail, la mise à l'échelle
   est donc une modification de configuration, et non un `kubectl scale` manuel (une modification manuelle serait
   annulée lors de la prochaine application). Conservez `max_instance_count = 1` sauf si vous
   avez vérifié le comportement des sessions partagées de Wallabag avec plusieurs pods.

3. **Mettez à jour la version de l'application** en modifiant `application_version` dans la
   plateforme RAD et en l'appliquant via **Update** ; une nouvelle image est construite `FROM
   wallabag/wallabag:<version>` et le pod est recréé. `wallabag-install`
   se réexécute sans risque sur le schéma existant (il est idempotent) — aucune étape de migration
   manuelle n'est nécessaire.

4. **Gérez les secrets et le stockage :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~wallabag"
   gcloud storage buckets list --project="$PROJECT" --filter="name~wallabag"
   kubectl get jobs -n "$NS"          # db-init and wallabag-install jobs
   ```

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. wallabagdemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^wallabag" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

6. **Configurez l'extension de navigateur, l'application mobile ou l'accès à l'API.** Une fois connecté avec le
   compte administrateur, allez dans les paramètres de votre compte pour afficher les identifiants de votre client
   API, ou générez un nouveau client API sous Developer → My applications.
   Utilisez `http://${EXTERNAL_IP}` (ou votre domaine personnalisé, s'il est configuré) comme
   adresse du serveur lors de la configuration de l'extension officielle Firefox/Chrome ou d'un
   client mobile.

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation du CPU et de la
   mémoire des pods, le nombre de redémarrages et les métriques de requêtes, ainsi que le tableau de bord de l'instance
   Cloud SQL. Le module peut provisionner un **test de disponibilité** (uptime check) ; s'il est
   activé, consultez Monitoring → Uptime checks et Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Wallabag.

- **Pod non Ready / CrashLoopBackOff :** inspectez les événements et les journaux. La sonde de
  démarrage est une sonde TCP sur le port 80 (elle n'exige que la liaison de nginx) ; une réponse 302 au
  `GET /` de la sonde de vivacité est attendue et saine — c'est un échec de connexion à Cloud SQL
  (via le sidecar Auth Proxy sur `127.0.0.1:3306`) qui empêche réellement le
  pod de devenir Ready.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  kubectl exec -n "$NS" deploy/<service-name> -- env | grep SYMFONY__ENV__DATABASE
  ```
- **Les articles disparaissent après un redémarrage du pod — le point n° 1 à vérifier sur ce
  module.** C'est le symptôme caractéristique d'un Wallabag qui s'installe silencieusement
  sur un fichier SQLite local au lieu de MySQL : le pod démarre, les vérifications
  d'état réussissent, les articles s'enregistrent et semblent fonctionner, mais tout disparaît au
  prochain redémarrage ou replanification du pod. Cela se produit si
  `SYMFONY__ENV__DATABASE_DRIVER` est un jour supprimé ou remplacé — il doit
  valoir explicitement `pdo_mysql` (le `entrypoint.sh` fourni le définit ; n'ajoutez pas
  de `SYMFONY__ENV__DATABASE_DRIVER` contradictoire via `environment_variables`).
  Utilisez `kubectl exec` pour rechercher dans le journal de démarrage `"Configuring the SQLite
  database..."` plutôt qu'une ligne de connexion MySQL — c'est exactement le genre de
  distinction qui n'est visible qu'avec un accès shell au pod, et non depuis
  l'extérieur. Consultez la section *Configuration Pitfalls* du Guide de configuration pour
  l'explication complète.
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est
  `RUNNABLE`, que le secret du mot de passe de la base a bien été matérialisé dans l'espace de noms, et que le
  job `db-init` s'est terminé avant l'exécution de `wallabag-install` (il peut être réexécuté sans risque ;
  `max_retries = 3`).
- **Échec du job d'initialisation :** inspectez le job et les journaux de son pod :
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<db-init-or-wallabag-install-job-name>
  ```
- **Déploiement progressif bloqué lors d'une mise à jour :** si le nouveau pod n'atteint pas rapidement l'état Ready, recherchez une connexion à la base bloquée ou un passage de relais
  du sidecar Auth Proxy depuis l'ancien pod.
- **Pod en attente / pas d'IP externe :** consultez les événements de `kubectl describe pod` pour repérer des problèmes de
  ressources ou de quotas, et vérifiez que le Service LoadBalancer dispose d'une
  IP attribuée.
- **Erreurs de récupération d'image :** vérifiez que l'image existe dans Artifact Registry et que le
  compte de service des nœuds peut la récupérer.
- **Impossible de se connecter avec `wallabag` / `wallabag` :** si le mot de passe a déjà été
  modifié par un opérateur précédent, utilisez `gcloud sql connect` (tâche 3) ou les
  journaux du job d'installation pour confirmer que `wallabag-install` s'est bien exécuté ; un
  nouveau déploiement crée toujours les identifiants par défaut lors de la première installation réussie.

Consultez la section *Configuration Pitfalls & Sensible Defaults* du Guide de configuration
pour les pièges propres à chaque paramètre — en particulier la règle essentielle sur
`SYMFONY__ENV__DATABASE_DRIVER` ci-dessus.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le déploiement). Delete supprime tout ce que le module a créé — la charge de travail Kubernetes
et son espace de noms, la base de données Cloud SQL, les secrets Secret Manager, les buckets GCS et les
images Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC, le cluster
GKE, le Cloud SQL partagé, le registre) sont gérées séparément et ne sont pas supprimées
ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie la charge de travail GKE, Cloud SQL (MySQL 8.0), les secrets, le bucket de stockage, et exécute la chaîne d'initialisation `db-init` → `wallabag-install` |
| 2 — Accéder et vérifier | Manuel | Se connecter au cluster ; la vérification d'état renvoie 302 vers `/login` ; se connecter avec les identifiants par défaut `wallabag`/`wallabag` ; enregistrer un article de test |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, mettre à l'échelle, mettre à jour la version, gérer les secrets/le stockage, accéder à la base, configurer l'extension/l'API |
| 4 — Observer | Manuel | Interroger Cloud Logging ; consulter les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de base de données et de job d'initialisation — y compris le symptôme du basculement silencieux vers SQLite |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
