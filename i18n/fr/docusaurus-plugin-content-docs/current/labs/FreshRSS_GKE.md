---
title: "FreshRSS sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez FreshRSS sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démontage."
---

<!-- translated-from: docs/labs/FreshRSS_GKE.md @ 3055034 sha256:3387bbd524cf -->

# FreshRSS sur GKE Autopilot — Guide de lab {#freshrss-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/FreshRSS_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

FreshRSS est un agrégateur de flux RSS et Atom gratuit et auto-hébergé — un
« lecteur d'actualités » léger et multi-utilisateur écrit en PHP, qui expose
les API Google Reader et Fever pour les clients mobiles. Ce lab vous fait
parcourir l'ensemble du cycle de vie opérationnel du module
**FreshRSS on GKE Autopilot** sur Google Cloud : le déployer, y accéder et le
vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes
courants, puis le démonter.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**,
et non sur les fonctionnalités du produit FreshRSS. Pour la liste complète des
services provisionnés et de chaque paramètre de configuration (organisés par
groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/FreshRSS_GKE) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez en mesure de :

- Déployer le module depuis la plateforme RAD et localiser les ressources qu'il provisionne.
- Vous connecter au cluster GKE et accéder à la charge de travail en cours
  d'exécution, y compris l'installation au premier démarrage et la connexion administrateur.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et la base de données.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démonter proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Cloud SQL, le
  serveur NFS, Artifact Registry et les comptes de service partagés dont dépend
  ce module). Vous n'avez pas besoin de le déployer vous-même au préalable — la
  plateforme détecte automatiquement s'il existe déjà dans le projet cible et,
  sinon, le provisionne avant ce module (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` exécutés.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans ce projet, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement, après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; toutes les tâches ci-dessous les réutilisent :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la barre de navigation supérieure de la plateforme RAD, ouvrez **FreshRSS (GKE)**
   dans la liste **Platform Modules** pour lancer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et
   passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/FreshRSS_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement
   avec les journaux en temps réel.

2. La plateforme déploie la charge de travail (PHP/Apache sur le port 80) dans
   le cluster GKE Autopilot, provisionne une base de données et un utilisateur
   Cloud SQL (PostgreSQL 15) avec les secrets `FRESHRSS_ADMIN_PASSWORD` et du
   mot de passe de la base de données dans Secret Manager, un volume NFS monté
   sur `/var/www/FreshRSS/data` (aucun bucket GCS n'est créé), construit l'image
   de conteneur personnalisée et exécute une tâche ponctuelle `db-init`. Les
   premiers déploiements prennent environ **15–25 minutes** (la création de
   Cloud SQL représente l'essentiel de ce temps).

3. Connectez-vous au cluster et découvrez l'espace de noms à l'aide de filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep freshrss | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Confirmez que la charge de travail s'exécute et trouvez son adresse externe :

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Confirmez que le service est en bonne santé. FreshRSS expose un point de
   terminaison JSON `/status` non authentifié qui répond dès que le serveur est
   opérationnel :

   ```bash
   curl -s "http://${EXTERNAL_IP}/status"   # expect a JSON status response
   ```

3. Récupérez le mot de passe administrateur généré automatiquement dans Secret Manager :

   ```bash
   ADMIN_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~freshrss AND name~ADMIN_PASSWORD" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$ADMIN_SECRET" --project="$PROJECT"
   ```

4. Ouvrez `http://${EXTERNAL_IP}` (ou le nom d'hôte configuré dans `application_domains`)
   dans un navigateur et connectez-vous avec le nom d'utilisateur `admin` et le
   mot de passe obtenu à l'étape 3. À la première requête, le point d'entrée du
   conteneur exécute le programme d'installation propre à FreshRSS
   (`do-install.php` + `create-user.php`) ; prévoyez donc une marge confortable
   au premier démarrage avant que la page de connexion se stabilise — cette
   opération est idempotente et ne s'exécute qu'une fois. Après vous être
   connecté, **changez le mot de passe administrateur dans l'interface de
   FreshRSS** — faire tourner la seule valeur dans Secret Manager ne
   réinitialise pas un compte déjà installé.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — le déploiement, les pods et les PVC (si
   un PVC en mode bloc est utilisé à la place de NFS) :

   ```bash
   kubectl get deploy,pods,pvc -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal
   d'instances et en cliquant sur **Update** sur la page de détails du
   déploiement — le module est propriétaire de la spécification de la charge de
   travail : la mise à l'échelle est donc une modification de configuration, et
   non un `kubectl scale` manuel (une modification manuelle serait annulée lors
   de l'application suivante). GKE exige `min_instance_count >= 1` (pas de mise
   à l'échelle jusqu'à zéro) ; la tâche cron d'actualisation des flux dans le
   conteneur (`CRON_MIN = */15`) se déclenche donc toujours. Conservez
   `max_instance_count` à `1` — un seul pod détient le cron d'actualisation et
   l'état de session et de cache stocké sous forme de fichiers sur le volume NFS
   partagé. L'affinité de session (`ClientIP`) est définie par défaut pour que
   les requêtes d'un client restent sur le même pod.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de
   version dans la plateforme RAD et en l'appliquant via **Update** ; une
   nouvelle image est construite et le Deployment est déployé. Comme le
   répertoire de données s'appuie sur NFS, le déploiement utilise la stratégie
   `Recreate` (l'ancien pod s'arrête avant que le nouveau démarre) plutôt
   qu'une mise à jour progressive, afin que deux pods n'écrivent jamais
   simultanément sur le volume partagé — attendez-vous à une brève
   indisponibilité pendant une mise à jour. `application_version = "latest"` est
   figé sur un tag réputé fiable au moment du build — fixez-le explicitement
   pour la production.

4. **Gérez les secrets et la base de données :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~freshrss"
   kubectl get jobs -n "$NS"          # db-init (and import job, if enabled)
   gcloud sql backups list --instance=<instance-name> --project="$PROJECT"
   ```

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. freshrssdemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^freshrss" --limit=1)
   DB_NAME=$(gcloud sql databases list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^freshrss" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --database="$DB_NAME" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre pour Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez
   l'utilisation du processeur et de la mémoire des pods, le nombre de
   redémarrages et les métriques de requêtes. `uptime_check_config` est
   désactivé par défaut — activez-le et examinez Monitoring → Uptime checks et
   Alerting → Policies si vous souhaitez des alertes de disponibilité
   automatisées.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous êtes le plus
susceptible de rencontrer. Il s'agit de diagnostics au niveau de la plateforme,
qui ne changent pas d'une version de FreshRSS à l'autre.

- **Pod non Ready / CrashLoopBackOff :** inspectez les événements et les
  journaux. La sonde de démarrage est un contrôle TCP sur le port 80 ; la sonde
  de vivacité est une requête HTTP GET sur `/` — une installation lente au
  premier démarrage (création du schéma) peut épuiser un seuil trop serré.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud
  SQL est `RUNNABLE`, que le secret du mot de passe de la base de données a bien
  été matérialisé dans l'espace de noms, que `enable_cloudsql_volume =
  true` (sidecar Auth Proxy lié à `127.0.0.1:5432`) et que la tâche `db-init`
  s'est terminée.
- **Échec de la tâche `db-init` :** inspectez la tâche et les journaux de son pod :
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<job-name>
  ```
- **Configuration / état réinitialisés au redémarrage du pod :** vérifiez que
  `enable_nfs = true` (ou un PVC en mode bloc via les variables StatefulSet du
  groupe 7) et que `nfs_mount_path =
  /var/www/FreshRSS/data` ; sans stockage persistant, `config.php` et l'état
  propre à chaque utilisateur sont perdus à chaque redémarrage du pod.
- **Déploiement bloqué sur « Waiting for rollout to finish » :** comportement
  attendu avec `Recreate` — l'ancien pod doit être entièrement arrêté (ce qui
  libère le montage NFS et les verrous de la base de données) avant que le
  nouveau démarre ; un arrêt bloqué signifie généralement une connexion
  persistante ou un arrêt progressif lent, et non une mauvaise image.
- **Pod en attente (Pending) / pas d'adresse IP externe :** consultez les
  événements de `kubectl describe pod` pour repérer des problèmes de ressources
  ou de quota, et vérifiez que le Service LoadBalancer dispose d'une adresse IP attribuée.
- **Erreurs de récupération d'image :** vérifiez que l'image existe dans
  Artifact Registry et que le compte de service des nœuds peut la récupérer.

Consultez la section *Configuration Pitfalls & Sensible Defaults* du Guide de
configuration pour les pièges propres à chaque paramètre (notamment les règles
essentielles concernant `enable_nfs`,
`database_type` et le caractère immuable de `application_database_name`/`application_database_user`).

---

## Tâche 6 — Démonter [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). La suppression retire tout ce que le module a créé — la charge de travail Kubernetes
et son espace de noms, la base de données et l'utilisateur Cloud SQL, les
secrets Secret Manager et le contenu du répertoire de données stocké sur NFS.
Les ressources appartenant à **Services_GCP** (le VPC, le cluster GKE,
l'instance Cloud SQL partagée, le serveur NFS partagé, le registre) sont gérées
séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie la charge de travail GKE, Cloud SQL (PostgreSQL 15), les secrets et un volume NFS, et exécute `db-init` |
| 2 — Accéder et vérifier | Manuel | Se connecter au cluster ; `/status` répond ; se connecter en tant que `admin` et changer le mot de passe |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, mettre à l'échelle, mettre à jour la version (déploiement Recreate), gérer les secrets et la base de données |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité (facultatif) |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de base de données, de `db-init`, de NFS et de stratégie de déploiement |
| 6 — Démonter | Automatisé | La suppression (Trash) retire toutes les ressources du module |
