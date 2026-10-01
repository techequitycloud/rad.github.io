---
title: "Coder sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Coder sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Coder_GKE.md @ 3055034 sha256:190bb35bd6a7 -->

# Coder sur GKE Autopilot — Guide de lab {#coder-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Coder_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Coder est une plateforme open source et auto-hébergée de provisionnement
d'environnements de développement distants (« espaces de travail ») définis en
tant que code avec Terraform. Ce lab vous guide à travers le cycle de vie
opérationnel complet du module **Coder on GKE Autopilot** sur Google Cloud :
déployer le plan de contrôle, y accéder et le vérifier, l'exploiter au quotidien,
l'observer, diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**,
et non sur les fonctionnalités du produit Coder telles que les templates et les
espaces de travail. Pour la liste complète des services provisionnés et de chaque
paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Coder_GKE) — ce
lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE et accéder à la charge de travail du plan de contrôle Coder en cours d'exécution.
- Créer le premier compte administrateur et vérifier que le déploiement est en bonne santé.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et le stockage.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Cloud SQL, Artifact
  Registry et les comptes de service partagés dont dépend ce module). Vous n'avez
  pas besoin de le déployer vous-même au préalable — la plateforme détecte
  automatiquement s'il existe déjà dans le projet cible et, sinon, le provisionne
  avant ce module (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` effectués.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans ce projet, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l'un ni l'autre.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la barre de navigation supérieure de la plateforme RAD, ouvrez **Coder (GKE)** dans
   la liste **Platform Modules** pour lancer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id` et
   passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Coder_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état
   du déploiement avec les journaux en temps réel.

2. La plateforme déploie le plan de contrôle Coder dans le cluster GKE Autopilot,
   provisionne une base de données Cloud SQL (PostgreSQL 15) avec son secret de mot
   de passe dans Secret Manager et un bucket Cloud Storage dédié, réplique l'image
   amont `ghcr.io/coder/coder` et l'encapsule avec un point d'entrée cloud via Cloud
   Build, puis exécute un job ponctuel d'initialisation de la base de données (`db-init`) qui crée
   la base de données vide et le rôle. Coder applique ses propres migrations de schéma au premier
   démarrage du serveur — il n'y a pas de job de migration distinct. Les premiers déploiements prennent environ
   **20–35 minutes** (la création de Cloud SQL domine).

3. Connectez-vous au cluster et repérez l'espace de noms avec des filtres indépendants du nom :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep coder | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que la charge de travail s'exécute et trouvez son adresse externe :

   ```bash
   kubectl get pods,svc,ingress -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

   Le module provisionne par défaut un Ingress Kubernetes adossé à une adresse IP
   statique globale réservée (`enable_custom_domain = true`, `reserve_static_ip = true`) ;
   l'adresse doit donc rester stable d'un redéploiement à l'autre.

2. Vérifiez que le service est en bonne santé. Coder expose un point de terminaison de santé non authentifié
   sur `/healthz` (HTTP 200 dès que le serveur est opérationnel — prévoyez une ou deux minutes sur un
   nouveau déploiement, le temps que les migrations de schéma du premier démarrage s'exécutent ; la sonde de démarrage tolère
   jusqu'à 30 échecs à intervalle de 15 secondes pour absorber ce délai) :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/healthz"
   curl -s "http://${EXTERNAL_IP}/api/v2/buildinfo"    # returns the deployed Coder version
   ```

3. Ouvrez `http://${EXTERNAL_IP}` (ou votre domaine personnalisé, s'il est configuré) dans un
   navigateur. Au premier démarrage, Coder affiche la **page de configuration** — créez le compte
   administrateur (propriétaire) initial avec votre nom, votre e-mail et votre mot de passe. **Faites-le
   rapidement** : la page de configuration est joignable publiquement tant que le premier compte
   n'existe pas, et il n'existe aucun identifiant administrateur généré automatiquement dans Secret Manager (Coder
   génère lui-même ses clés de signature et les stocke dans PostgreSQL au premier démarrage,
   et non dans Secret Manager). La seule information d'identification que contient Secret Manager est le
   mot de passe de la base de données, qui peut être récupéré si nécessaire :

   ```bash
   DB_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~coder" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$DB_SECRET" --project="$PROJECT"
   ```

4. **Étapes suivantes après le déploiement :** l'exécution de véritables espaces de travail nécessite une étape du jour 2 —
   créer un template Coder (Terraform) pointant vers une cible de calcul telle qu'un
   cluster Kubernetes ou des templates de VM cloud, et fournir au provisionneur les identifiants
   correspondants. Ce module ne déploie que le plan de contrôle ; il n'exécute aucun espace de travail
   par lui-même.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — Deployment, pods et autoscaler horizontal
   de pods. Le plan de contrôle est sans état ; il s'exécute donc comme un
   `Deployment` standard avec une stratégie `RollingUpdate` (sans la contrainte
   `Recreate` liée à NFS) :

   ```bash
   kubectl get deploy,pods,hpa,pvc -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres d'instances min/max et en cliquant sur **Update** sur
   la page de détails du déploiement — le module gère la spécification de la charge de travail ; la mise à l'échelle est donc
   une modification de configuration, et non un `kubectl scale` manuel (une modification manuelle serait
   annulée lors du prochain apply). Coder utilise par défaut `min_instance_count = 1`,
   `max_instance_count = 5` : le plan de contrôle sans état peut être mis à l'échelle horizontalement en toute sécurité
   face à la base de données Cloud SQL partagée. `session_affinity =
   ClientIP` est défini par défaut afin que la session terminal/IDE d'un navigateur, fortement basée sur WebSocket,
   reste attachée au même pod — une session en cours ne migre pas
   d'un pod à l'autre si l'un est vidé en cours de session. Surveillez le `max_connections` de Cloud SQL
   si vous augmentez sensiblement `max_instance_count`, puisque chaque réplica ouvre son
   propre pool de connexions.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme
   RAD et en l'appliquant via **Update** ; une nouvelle image est construite et une mise à jour
   progressive remplace les pods. Les tags de Coder sont préfixés selon semver (par ex. `v2.24.1`) ;
   le module associe `latest` à un tag fixé plutôt qu'au tag inexistant
   `ghcr.io/coder/coder:latest`. Les migrations de schéma s'exécutent automatiquement au premier
   démarrage des nouveaux pods.

4. **Gérez les secrets, le stockage et les jobs :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~coder"
   kubectl get jobs -n "$NS"          # db-init and any scheduled jobs
   gcloud storage buckets list --project="$PROJECT" --filter="name~coder"
   ```

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. coderdemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^coder" --limit=1)
   DB_NAME=$(gcloud sql databases list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^coder" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --database="$DB_NAME" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer). Le point d'entrée personnalisé journalise
   la connexion PostgreSQL résolue et l'URL d'accès à chaque démarrage :

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation du CPU et de la
   mémoire des pods, le nombre de redémarrages et les métriques de requêtes. Le module peut
   provisionner un **test de disponibilité** (lorsqu'il est activé) ; consultez Monitoring → Uptime
   checks et Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus
probablement. Ce sont des diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Coder.

- **Pod non Ready / CrashLoopBackOff :** inspectez les événements et les journaux. Les sondes de démarrage et
  de vivacité ciblent toutes deux `/health` avec un délai initial de 60 secondes ; la
  sonde de démarrage tolère jusqu'à 30 échecs à intervalle de 15 secondes pour couvrir la
  migration de schéma du premier démarrage de Coder ; ne concluez donc pas trop tôt à un échec.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL (PostgreSQL 15)
  est `RUNNABLE`, que le secret du mot de passe de la base de données a bien été matérialisé dans l'espace de noms via le
  pilote Secret Store CSI, et que le job `db-init` s'est terminé. GKE atteint Cloud SQL
  par le sidecar Auth Proxy sur `127.0.0.1` ; le point d'entrée assemble
  `CODER_PG_CONNECTION_URL` avec `sslmode=disable` (le proxy assure déjà la
  terminaison TLS de la connexion) et encode le mot de passe en pourcentage.
- **Échec du job d'initialisation :** inspectez le job et les journaux de son pod :
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<db-init-job-name>
  ```
- **Pod en attente / aucune adresse IP externe :** consultez les événements de `kubectl describe pod` à la recherche
  de problèmes de ressources ou de quota, et vérifiez que le Service LoadBalancer / l'Ingress a une
  adresse IP attribuée.
- **Erreurs de récupération / de build d'image :** vérifiez que l'image existe dans Artifact Registry
  et que le compte de service des nœuds peut la récupérer. `container_image_source` doit valoir
  `custom` — l'image amont `ghcr.io/coder/coder` ne peut pas assembler
  `CODER_PG_CONNECTION_URL`/`CODER_ACCESS_URL` par elle-même et échoue au démarrage si elle est
  déployée telle quelle. Un `MANIFEST_UNKNOWN` sur l'image de base signifie un tag de
  version inexistant — les tags de Coder sont préfixés selon semver (`vX.Y.Z`), et non `latest`.
- **Builds d'espaces de travail en file d'attente mais jamais lancés :** vérifiez que `CODER_ACCESS_URL` correspond à
  l'URL réellement utilisée par les développeurs — une incohérence rompt les connexions des agents
  d'espaces de travail. Rappelez-vous que ce module ne déploie que le plan de contrôle ; les espaces de travail
  nécessitent en outre un provisionneur et une cible de calcul configurés
  après le déploiement via le système de templates de Coder.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les
pièges propres à chaque paramètre (notamment les règles essentielles de ne jamais renommer
`application_database_name`/`application_database_user` après le premier déploiement, et
de ne jamais monter le `nfs_mount_path` de `enable_nfs` sur `/opt/coder`, ce qui masque le
binaire `coder`).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). Cette opération supprime tout ce que le module a créé — la charge de travail Kubernetes
et l'espace de noms, la base de données Cloud SQL, les secrets Secret Manager, le bucket GCS et les
images Artifact Registry. Les ressources détenues par **Services_GCP** (le VPC, le cluster
GKE, Cloud SQL partagé, le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie la charge de travail GKE, Cloud SQL (PostgreSQL 15), les secrets, le bucket de stockage et exécute `db-init` |
| 2 — Accéder et vérifier | Manuel | Se connecter au cluster ; `/healthz` renvoie 200 ; créer le compte administrateur (propriétaire) initial dans l'interface |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, mettre à l'échelle (via HPA, min=1/max=5), mettre à jour la version, gérer les secrets/le stockage, accès à la base de données |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de base de données, de job d'initialisation, de planification, de récupération/build d'image et d'espaces de travail bloqués |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
