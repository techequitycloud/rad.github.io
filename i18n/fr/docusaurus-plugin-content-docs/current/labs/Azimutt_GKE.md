---
title: "Azimutt sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Azimutt sur GKE Autopilot dans votre propre projet Google Cloud — mise en place guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/Azimutt_GKE.md @ 3055034 sha256:6965ad6e11e6 -->

# Azimutt sur GKE Autopilot — Guide de lab {#azimutt-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Azimutt_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45 à 90 minutes

Azimutt est un outil open source de nouvelle génération pour explorer les schémas de bases de données et
produire des ERD (diagrammes entité-association) sur des bases de données réelles, construit avec
Elixir/Phoenix. Ce lab vous fait parcourir le cycle de vie opérationnel complet du
module **Azimutt on GKE Autopilot** sur Google Cloud : le déployer, y accéder et le
vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et
le supprimer.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**,
et non sur les fonctionnalités du produit Azimutt. Pour la liste complète des services provisionnés
et de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Azimutt_GKE) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans la
durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et localiser les ressources qu'il provisionne.
- Vous connecter au cluster GKE et accéder à la charge de travail en cours d'exécution.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et le stockage.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Supprimer proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Cloud SQL, Artifact
  Registry et les comptes de service partagés dont dépend ce module). Vous n'avez pas besoin
  de le déployer vous-même au préalable — la plateforme détecte automatiquement s'il
  existe déjà dans le projet cible et, sinon, le provisionne avant ce module
  (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` effectués.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous n'exige ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tout autre paramètre du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifie ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Sur un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Azimutt (GKE)**
   dans la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id`
   et passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Azimutt_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement
   avec les journaux en temps réel.

2. La plateforme déploie la charge de travail dans le cluster GKE Autopilot, provisionne
   une base de données Cloud SQL (PostgreSQL 15) avec ses secrets Secret Manager
   (`SECRET_KEY_BASE` et le mot de passe de la base de données), un partage Cloud Filestore (NFS)
   pour le stockage des pièces jointes d'Azimutt, un bucket Cloud Storage, construit
   l'image de conteneur (une fine surcouche FROM `ghcr.io/azimuttapp/azimutt`) et exécute
   un job ponctuel d'initialisation de la base de données qui crée le rôle et la base de données
   de l'application. Les premiers déploiements prennent environ **20 à 35 minutes** (la création de Cloud SQL
   domine).

3. Connectez-vous au cluster et repérez le namespace avec des filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NAMESPACE=$(kubectl get ns -o name | grep azimutt | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NAMESPACE"
   kubectl get all -n "$NAMESPACE"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Confirmez que la charge de travail s'exécute et trouvez son adresse externe :

   ```bash
   kubectl get pods,svc -n "$NAMESPACE"
   EXTERNAL_IP=$(kubectl get svc -n "$NAMESPACE" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Confirmez que le service est sain. Azimutt n'a pas de point de terminaison JSON de santé
   dédié — les sondes de démarrage et de vivacité ciblent la racine Phoenix `/`,
   qui ne renvoie `200` qu'une fois le serveur démarré, ses migrations appliquées
   et la connexion à Postgres établie :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/"   # expect 200
   ```

3. Ouvrez `http://${EXTERNAL_IP}` dans un navigateur. Lors de la première visite, Azimutt affiche sa
   page d'inscription — aucun identifiant administrateur pré-créé n'existe dans Secret Manager.
   Créez votre premier compte avec une adresse e-mail et un mot de passe. L'inscription est **ouverte par
   défaut** ; après avoir créé votre compte, restreignez donc les accès ultérieurs (domaine
   personnalisé + IAP, ou les paramètres d'authentification propres à Azimutt via `environment_variables`).

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — le Deployment, les pods et l'autoscaler horizontal :

   ```bash
   kubectl get deploy,pods,hpa,pvc -n "$NAMESPACE"
   kubectl describe deploy -n "$NAMESPACE"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances et en cliquant sur **Update** sur
   la page de détails du déploiement — le module possède la spécification de la charge de travail ; la mise à l'échelle
   est donc une modification de configuration, et non un `kubectl scale` manuel (une modification manuelle serait
   annulée lors du prochain apply). Contrairement aux applications dotées d'une file de tâches en mémoire,
   Azimutt utilise PostgreSQL (Oban) pour le travail en arrière-plan ; passer à plus d'une
   réplique ne nécessite donc pas de Redis. GKE ne prend pas en charge la réduction à zéro ;
   `min_instance_count` reste donc à sa valeur par défaut de `1`. `session_affinity =
   ClientIP` est défini par défaut pour maintenir un client sur un même pod.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme RAD
   et en l'appliquant via **Update** ; une nouvelle image est construite et une mise à jour
   progressive remplace les pods. Les migrations s'exécutent automatiquement à chaque démarrage
   (`/app/bin/migrate && /app/bin/server`) ; une mise à niveau applique donc ses modifications de schéma
   au démarrage — prévoyez du temps supplémentaire lors du premier démarrage après un changement de version.
   Azimutt ne publie pas d'étiquette `:latest` (`application_version = "latest"` correspond à
   son étiquette `main`) ; figez une version précise en production.

4. **Gérez les secrets, le stockage et les jobs :**

   ```bash
   kubectl get secrets -n "$NAMESPACE"
   gcloud secrets list --project="$PROJECT" --filter="name~azimutt"
   kubectl get jobs -n "$NAMESPACE"           # db-init job
   gcloud filestore instances list --project="$PROJECT"
   ```

   Ne faites jamais de rotation de `SECRET_KEY_BASE` en dehors d'une fenêtre de maintenance — sa rotation
   invalide tous les cookies de session actifs et déconnecte tous les utilisateurs.

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. azimuttdemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^azimutt" --limit=1)
   DB_NAME=$(gcloud sql databases list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^azimutt" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --database="$DB_NAME" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou le Logs Explorer. Les lignes `cloud-entrypoint`
   indiquent le chemin `DATABASE_URL` résolu, `PHX_HOST` et `PORT` :

   ```bash
   kubectl logs -n "$NAMESPACE" deploy/"$(kubectl get deploy -n "$NAMESPACE" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation du CPU et
   de la mémoire des pods, le nombre de redémarrages et les métriques de requêtes. Le module peut
   provisionner un **test de disponibilité** (lorsqu'il est activé) ; examinez Monitoring → Uptime
   checks et Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions d'Azimutt.

- **Pod non Ready / CrashLoopBackOff :** inspectez les événements et les journaux. Les sondes de démarrage
  et de vivacité ciblent `/` avec un délai initial de 60 secondes — prévoyez environ 1 à 2
  minutes au premier démarrage pour que les migrations se terminent avant que le point de terminaison ne soit disponible.
  `container_port` et les ports du Service et des sondes doivent tous valoir **4000** (GKE n'injecte
  pas automatiquement `PORT` ; le point d'entrée lui donne une valeur par défaut) — une incohérence laisse le
  pod bloqué à l'état `Running` sans jamais devenir `Ready`.
  ```bash
  kubectl describe pod -n "$NAMESPACE" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NAMESPACE" <pod> --previous       # logs from the crashed container
  ```
- **Erreurs de connexion à la base de données :** confirmez que l'instance Cloud SQL est `RUNNABLE`
  et que `enable_cloudsql_volume = true`. Azimutt se connecte via le **sidecar Cloud SQL
  Auth Proxy** sur `127.0.0.1` (TLS terminé par le proxy, d'où
  `DATABASE_ENABLE_SSL=false`) — désactiver le sidecar laisse Azimutt sans
  base de données.
- **Échec du job d'initialisation :** inspectez le job et les journaux de son pod. Le job
  signale au sidecar du proxy de s'arrêter (`/quitquitquit`) une fois terminé :
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```
- **Pod en attente / pas d'adresse IP externe :** consultez les événements de `kubectl describe pod` pour
  détecter des problèmes de ressources ou de quotas, et confirmez que le Service LoadBalancer dispose d'une
  adresse IP attribuée.
- **Erreurs de récupération d'image :** confirmez que l'image existe dans Artifact Registry et que le
  compte de service des nœuds peut la récupérer. Comme l'image d'Azimutt est une surcouche
  reconstruite/mise en miroir, `imagePullPolicy = Always` est défini afin que les nœuds ne
  servent jamais une couche en cache obsolète.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour
les pièges propres à chaque paramètre (y compris la règle essentielle de ne jamais faire de rotation de
`SECRET_KEY_BASE` après le premier démarrage, et la raison pour laquelle `application_database_name`/
`application_database_user` sont immuables après le premier déploiement).

---

## Tâche 6 — Supprimer [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). Cela supprime tout ce que le module a créé — la charge de travail Kubernetes
et le namespace, la base de données Cloud SQL, les secrets Secret Manager, le partage Cloud Filestore,
le bucket GCS et les images Artifact Registry. Les ressources appartenant à
**Services_GCP** (le VPC, le cluster GKE, le Cloud SQL partagé, le registre) sont gérées
séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie la charge de travail GKE, Cloud SQL (PostgreSQL 15), le partage NFS, les secrets, le bucket de stockage et exécute l'initialisation de la base |
| 2 — Accéder et vérifier | Manuel | Connexion au cluster ; le contrôle de santé (`/`) réussit ; création du premier compte Azimutt dans l'interface |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, mettre à l'échelle, mettre à jour la version, gérer les secrets et le stockage, accéder à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de base de données, de job d'initialisation, de planification et de récupération d'image |
| 6 — Supprimer | Automatisé | Delete (Trash) supprime toutes les ressources du module |
