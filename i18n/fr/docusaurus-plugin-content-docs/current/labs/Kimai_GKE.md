---
title: "Kimai sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployer Kimai sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Kimai_GKE.md @ 3055034 sha256:03a157551541 -->

# Kimai sur GKE Autopilot — Guide de lab {#kimai-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Kimai_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–60 minutes

Kimai est une application de suivi du temps libre et open source, utilisée par les indépendants
et les agences pour le suivi des heures facturables, les feuilles de temps et les rapports qui
alimentent la facturation. Ce lab vous fait parcourir l'intégralité du cycle de vie
opérationnel du module **Kimai on GKE Autopilot** sur Google Cloud : le déployer,
y accéder et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les
problèmes courants et le démanteler.

Le lab se concentre sur l'exploitation du **module GKE et de la plateforme Google
Cloud**, et non sur les fonctionnalités du produit Kimai. Pour la liste complète des
services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez
le [Guide de configuration](https://docs.radmodules.dev/docs/modules/Kimai_GKE) —
ce lab ne reprend volontairement pas ce détail afin de rester exact
dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez en mesure de :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il
  provisionne.
- Vous connecter au cluster GKE, accéder à la charge de travail en cours d'exécution et vous connecter
  avec le compte administrateur initialisé.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et
  le stockage.
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
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le
  projet.

Définissez ces variables shell une seule fois ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Kimai (GKE)**
   depuis la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez
   `project_id` et passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Kimai_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Si votre projet cible
   ne dispose d'aucune IP statique réservée ni d'aucun domaine personnalisé, laissez
   `enable_custom_domain` et `reserve_static_ip` à leurs valeurs par défaut ou définissez-les
   explicitement à `false` — c'est exactement ce qu'a fait le déploiement de ce module
   vérifié en conditions réelles. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux
   en temps réel.

2. La plateforme déploie la charge de travail dans le cluster GKE Autopilot,
   provisionne une base de données Cloud SQL (MySQL 8.0) avec ses secrets Secret Manager
   (`APP_SECRET`, `ADMINPASS` et le mot de passe de la base de données), le
   bucket Cloud Storage `storage`, construit l'image wrapper personnalisée qui compose
   `DATABASE_URL`, et exécute la tâche d'initialisation `db-init` (création de la
   base de données, de l'utilisateur et des droits). Les premiers déploiements prennent environ **15–25 minutes**
   (la création de Cloud SQL et le build de l'image en représentent l'essentiel).

3. Connectez-vous au cluster et repérez l'espace de noms avec des filtres
   indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep kimai | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accès et vérification [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que la charge de travail s'exécute et trouvez son adresse externe :

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Vérifiez que le service est en bonne santé — la page de connexion de Kimai renvoie **HTTP 200** :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/en/login"   # expect 200
   ```

3. Récupérez les identifiants de l'administrateur initialisé depuis Secret Manager —
   le nom d'utilisateur est toujours `admin` (codé en dur par l'image de l'éditeur), et le
   mot de passe est le secret `ADMINPASS` généré automatiquement :

   ```bash
   ADMINPASS_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~admin-password" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$ADMINPASS_SECRET" --project="$PROJECT"
   ```

4. Ouvrez `http://${EXTERNAL_IP}` dans un navigateur (ou votre domaine personnalisé, s'il est
   configuré) et connectez-vous avec `admin` et le mot de passe récupéré ci-dessus.

5. Créez un projet, une activité et une entrée de feuille de temps de test pour confirmer
   l'écriture et la lecture de bout en bout dans la vraie base de données : **Administration →
   Projects** (créez-en un), **Administration → Activities** (créez-en une),
   puis saisissez une entrée de feuille de temps rattachée à ceux-ci. C'est le signe le plus sûr que le pod
   écrit réellement dans Cloud SQL via le conteneur annexe (sidecar) Auth Proxy.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — le Deployment, les pods et les événements :

   ```bash
   kubectl get deploy,pods -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances puis en cliquant sur **Update**
   sur la page de détails du déploiement — le module possède la spécification de la charge de travail, la
   mise à l'échelle est donc une modification de configuration, et non un `kubectl scale` manuel (une
   modification manuelle serait annulée lors de la prochaine application). Conservez `max_instance_count = 1`
   sauf si vous avez vérifié le comportement des sessions de Kimai avec plusieurs pods.

3. **Mettez à jour la version de l'application** en modifiant `application_version` dans
   la plateforme RAD et en l'appliquant via **Update** ; une nouvelle image est construite
   `FROM kimai/kimai2:<version>-apache` et le pod est recréé.
   `kimai:install` s'exécute à nouveau sans risque sur le schéma existant au premier démarrage du nouveau
   conteneur — aucune étape de migration manuelle n'est nécessaire.

4. **Gérez les secrets et le stockage :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~kimai"
   gcloud storage buckets list --project="$PROJECT" --filter="name~kimai"
   kubectl get jobs -n "$NS"          # db-init job
   ```

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. kimaidemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^kimai" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

6. **Configurez un jeton d'API ou des utilisateurs supplémentaires.** Connecté avec le compte
   administrateur, allez dans **Profile → API access** pour générer un jeton d'API destiné aux
   intégrations de suivi du temps, ou dans **Administration → Users** pour inviter
   des collègues (l'inscription en libre-service est désactivée par défaut).

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre de l'explorateur de journaux :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation du CPU
   et de la mémoire des pods, le nombre de redémarrages et les métriques de requêtes, ainsi que le
   tableau de bord de l'instance Cloud SQL. Le module peut provisionner un **test de disponibilité**
   (uptime check) ; s'il est activé, consultez Monitoring → Uptime checks et Alerting →
   Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit
de diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Kimai.

- **Pod non Ready / CrashLoopBackOff :** inspectez les événements et les journaux. La sonde de
  démarrage cible `GET /en/login` avec un seuil généreux de 20 tentatives pour couvrir
  l'exécution de `kimai:install` au premier démarrage — c'est un échec de connexion à Cloud SQL via
  le sidecar Auth Proxy (`127.0.0.1`) qui empêche réellement le pod de
  devenir Ready.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous -c <service-name>
  kubectl exec -n "$NS" deploy/<service-name> -c <service-name> -- env | grep -E 'DB_IP|DATABASE_URL'
  ```
- **`enable_cloudsql_volume` a été désactivé par erreur.** Le point d'entrée du
  wrapper de ce module repose sur la présence du sidecar Cloud SQL Auth Proxy
  (`DB_IP` se résout vers son adresse de bouclage `127.0.0.1`). Si
  `enable_cloudsql_volume` est défini à `false` sur GKE, le pod n'a plus aucun accès à
  Cloud SQL. Vérifiez que le conteneur sidecar existe :
  ```bash
  kubectl get pod -n "$NS" <pod> -o jsonpath='{.spec.containers[*].name}'
  ```
- **Hypothèse de port erronée.** Si vous comparez ce déploiement à une
  documentation ou à une autre installation de Kimai qui suppose le port 80, notez que la
  variante d'image `:apache` de ce module écoute sur le port **8001** — confirmé par des tests
  locaux et par le déploiement en conditions réelles.
- **Échec de la tâche d'initialisation :** inspectez la tâche et les journaux de son pod :
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<db-init-job-name>
  ```
- **Déploiement progressif bloqué lors d'une mise à jour :** si le nouveau pod n'atteint pas rapidement l'état Ready,
  recherchez une connexion à la base bloquée ou un problème de passage de relais du sidecar Auth Proxy
  depuis l'ancien pod.
- **Pod en attente / pas d'IP externe :** consultez les événements de `kubectl describe pod` pour repérer des problèmes
  de ressources ou de quotas, et vérifiez que le Service LoadBalancer dispose d'une
  IP attribuée.
- **Erreurs de récupération d'image :** vérifiez que l'image existe dans Artifact Registry et que
  le compte de service des nœuds peut la récupérer.
- **Mot de passe administrateur oublié :** il n'est pas perdu — `ADMINPASS` est un
  secret Secret Manager persistant, réinjecté et réappliqué au compte
  `admin` à chaque démarrage du pod (de manière idempotente) :
  ```bash
  gcloud secrets versions access latest --secret="$ADMINPASS_SECRET" --project="$PROJECT"
  ```

Consultez la section *Configuration Pitfalls & Sensible Defaults* du Guide de configuration
pour les pièges propres à chaque paramètre.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash**
(**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement du
déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la
plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en
conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime le
déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD
oublie simplement le déploiement). Cela supprime tout ce que le module a créé —
la charge de travail Kubernetes et son espace de noms, la base de données Cloud SQL, les secrets Secret Manager,
les buckets GCS et les images Artifact Registry. Les ressources appartenant à
**Services_GCP** (le VPC, le cluster GKE, le Cloud SQL partagé, le registre) sont
gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie la charge de travail GKE, Cloud SQL (MySQL 8.0), les secrets, le bucket de stockage, et exécute la tâche `db-init` |
| 2 — Accès et vérification | Manuel | Se connecter au cluster ; la vérification d'état renvoie 200 sur `/en/login` ; se connecter en tant que `admin` avec le secret `ADMINPASS` généré ; créer une entrée de feuille de temps de test |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, mettre à l'échelle, mettre à jour la version, gérer les secrets/le stockage, accéder à la base, configurer l'API et les utilisateurs |
| 4 — Observer | Manuel | Interroger Cloud Logging ; consulter les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de sidecar, de port et de base de données |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
