---
title: "Coder sur GKE Autopilot — Guide de Lab"
description: "Lab pratique : déployer Coder sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, opérations, observabilité et suppression."
---

<!-- translated-from: docs/labs/Coder_GKE.md @ 15fd4c7 sha256:9b6a3bfa73ea -->

# Coder sur GKE Autopilot — Guide de Lab {#coder-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Coder_GKE)**

## Vue d'ensemble {#overview}

**Temps estimé :** 45 à 90 minutes

Coder est une plateforme open-source auto-hébergée pour le provisionnement
d'environnements de développement à distance ("espaces de travail") définis
comme du code avec Terraform. Ce lab vous guide à travers le cycle de vie
opérationnel complet du module **Coder sur GKE Autopilot** sur Google Cloud :
déployer le plan de contrôle, y accéder et le vérifier, l'exécuter au quotidien,
l'observer, diagnostiquer les problèmes courants et le supprimer.

Le lab se concentre sur l'exploitation du **module GKE et de la plateforme
Google Cloud**, et non sur les fonctionnalités du produit Coder telles que les
modèles et les espaces de travail. Pour la liste complète des services
provisionnés et de chaque entrée de configuration (organisée par groupe),
consultez le [Guide de configuration](https://docs.radmodules.dev/docs/modules/Coder_GKE)
— ce lab ne duplique délibérément pas ce détail afin qu'il reste précis au fil
du temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez capable de :

- Déployer le module depuis la plateforme RAD et localiser les ressources qu'il
  provisionne.
- Vous connecter au cluster GKE et accéder à la charge de travail du plan de
  contrôle Coder en cours d'exécution.
- Créer le premier compte administrateur et vérifier que le déploiement est
  sain.
- Effectuer les opérations de jour 2 — inspecter, mettre à l'échelle, mettre à
  jour et gérer les secrets et le stockage.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus
  courants.
- Supprimer proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Cloud SQL, Artifact
  Registry et les comptes de service partagés dont dépend ce module). Vous n'avez
  pas besoin de le déployer vous-même au préalable — la plateforme détecte
  automatiquement s'il existe déjà dans le projet cible et le provisionne avant
  ce module si ce n'est pas le cas (voir Tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` complétés.
- Rôle IAM de **Propriétaire du projet** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement, la
  boîte de dialogue de confirmation du déploiement vous demande de prouver que
  vous le contrôlez (**Obtenir le code de vérification**, exécutez les
  commandes affichées en tant que Propriétaire du projet, puis **Vérifier**) et
  de donner le rôle de **Propriétaire** au compte de service de déploiement RAD.
  Un projet créé par RAD pour vous n'a besoin de rien de tout cela.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création
  ne demande que la première page d'entrées (et, dans un projet créé par RAD
  pour vous, guère plus que le nom du locataire et la région). Toute autre
  entrée du Guide de configuration — y compris les entrées de mise à l'échelle
  et de version dans les tâches de Jour 2 — est modifiée ultérieurement avec
  **Mettre à jour** sur la page du déploiement après avoir coché **Activer le
  mode avancé**, ce qui nécessite un solde de crédits couvrant le coût de build
  estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de
  module). Dans un environnement de lab, seul un administrateur peut utiliser
  le mode avancé.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules
  dans le projet.

Définissez ces variables shell une fois ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Catalogue de solutions → Modules RAD** dans la
   navigation supérieure de la plateforme RAD, ouvrez **Coder (GKE)** depuis la
   liste **Modules de plateforme** pour commencer la configuration, choisissez
   **Formulaire de configuration** sous *Comment souhaitez-vous configurer ce
   déploiement ?* (le formulaire s'ouvre sur l'**Assistant conversationnel** si
   vous détenez des crédits achetés ou si vous êtes un partenaire ou un
   administrateur), définissez `project_id`, et
   examinez les entrées. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Coder_GKE)
   documente chaque entrée par groupe, avec les valeurs par défaut. Cliquez sur
   **Déployer le module**, examinez le coût estimé dans la boîte de dialogue
   **Confirmation de déploiement** lorsqu'elle apparaît et cliquez sur
   **Soumettre** (si la boîte de dialogue ajoute ensuite une étape de
   confirmation, comme la vérification d'un projet que vous apportez,
   complétez-la et cliquez sur **Confirmer**), ce qui ouvre la page d'état du
   déploiement avec des journaux en temps réel.

2. La plateforme déploie le plan de contrôle Coder dans le cluster GKE Autopilot,
   provisionne une base de données Cloud SQL (PostgreSQL 15) avec son secret de
   mot de passe Secret Manager, un bucket Cloud Storage dédié, met en miroir
   l'image amont `ghcr.io/coder/coder` et l'encapsule avec un point d'entrée cloud via Cloud
   Build, et exécute un job d'initialisation de base de données unique
   (`db-init`) qui crée la base de données et le rôle vides. Coder applique ses
   propres migrations de schéma au premier démarrage du serveur — il n'y a pas
   de job de migration séparé. Les premiers déploiements prennent environ
   **20 à 35 minutes** (la création de Cloud SQL domine).

3. Connectez-vous au cluster et découvrez l'espace de noms avec des filtres
   agnostiques au nom :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep coder | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accès et vérification [Manuel] {#task-2--access--verify-manual}

1. Confirmez que la charge de travail est en cours d'exécution et trouvez son
   adresse externe :

   ```bash
   kubectl get pods,svc,ingress -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

   Le module provisionne une Ingress Kubernetes adossée à une IP statique
   globale réservée par défaut (`enable_custom_domain = true`, `reserve_static_ip = true`), de sorte que
   l'adresse devrait rester stable lors des redéploiements.

2. Confirmez que le service est sain. Coder sert un endpoint de santé non
   authentifié à `/healthz` (HTTP 200 une fois le serveur démarré —
   laissez une minute ou deux sur un nouveau déploiement pendant que les
   migrations de schéma au premier démarrage s'exécutent ; la sonde de démarrage
   permet jusqu'à 30 échecs à une période de 15 secondes pour absorber cela) :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/healthz"
   curl -s "http://${EXTERNAL_IP}/api/v2/buildinfo"    # returns the deployed Coder version
   ```

3. Ouvrez `http://${EXTERNAL_IP}` (ou votre domaine personnalisé, si configuré) dans un
   navigateur. Au premier démarrage, Coder présente la **page de
   configuration** — créez le compte administrateur initial (propriétaire) avec
   votre nom, votre e-mail et votre mot de passe. **Faites-le rapidement** : la
   page de configuration est accessible publiquement jusqu'à ce que le premier
   compte existe, et il n'y a pas de credential admin auto-généré dans Secret
   Manager (Coder auto-génère ses clés de signature et les stocke dans
   PostgreSQL au premier démarrage, pas dans Secret Manager). Le seul
   credential que Secret Manager détient est le mot de passe de la base de
   données, qui peut être récupéré si nécessaire :

   ```bash
   DB_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~coder" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$DB_SECRET" --project="$PROJECT"
   ```

4. **Étapes suivantes après le déploiement :** l'exécution d'espaces de travail
   réels nécessite une étape de jour 2 — créer un modèle Coder (Terraform)
   pointant vers une cible de calcul telle qu'un cluster Kubernetes ou des
   modèles de VM cloud, et donner les credentials du provisionneur pour cela. Ce
   module déploie uniquement le plan de contrôle ; il n'exécute aucun espace de
   travail par lui-même.

---

## Tâche 3 — Opérer et maintenir en fonctionnement (Jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspecter la charge de travail** — déploiement, pods et l'autoscaler
   horizontal de pods. Le plan de contrôle est stateless, il s'exécute donc
   comme un `Deployment` standard avec une stratégie `RollingUpdate` (pas de
   contrainte `Recreate` adossée à NFS) :

   ```bash
   kubectl get deploy,pods,hpa,pvc -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Mettre à l'échelle** en modifiant les entrées min/max d'instances et en
   cliquant sur **Mettre à jour** sur la page des détails du déploiement — le
   module possède la spécification de la charge de travail, donc la mise à
   l'échelle est un changement de configuration, pas un `kubectl scale` manuel (une
   édition manuelle serait annulée lors du prochain apply). Coder utilise par
   défaut `min_instance_count = 1` et `max_instance_count = 1`, et le maximum doit rester à 1 :
   l'exécution de plus d'un réplica est le mode haute disponibilité de Coder,
   une fonctionnalité de licence premium que ce déploiement n'a pas. Mettez à
   l'échelle verticalement (`cpu_limit` / `memory_limit`) à la place.
   `session_affinity =
   ClientIP` est défini par défaut afin qu'une session de terminal/IDE
   WebSocket-heavy d'un navigateur reste épinglée au même pod — une session en
   cours ne migre pas entre les pods si l'un est drainé en cours de session.

3. **Mettre à jour la version de l'application** en modifiant l'entrée de
   version dans la plateforme RAD et en l'appliquant via **Mettre à jour** ;
   une nouvelle image est construite et une mise à jour progressive remplace
   les pods. Les tags de Coder sont préfixés semver (par exemple `v2.24.1`) ;
   le module mappe `latest` à un tag épinglé plutôt qu'au non-existant
   `ghcr.io/coder/coder:latest`. Les migrations de schéma s'exécutent automatiquement au
   premier démarrage des nouveaux pods.

4. **Gérer les secrets, le stockage et les jobs :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~coder"
   kubectl get jobs -n "$NS"          # db-init and any scheduled jobs
   gcloud storage buckets list --project="$PROJECT" --filter="name~coder"
   ```

5. **Ouvrir une session de base de données** pour inspection ou maintenance :

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

## Tâche 4 — Observer : Journalisation et Surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'Explorateur de journaux. Le point
   d'entrée personnalisé enregistre la connexion PostgreSQL résolue et l'URL
   d'accès à chaque démarrage :

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre de l'Explorateur de journaux :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez
   l'utilisation du CPU et de la mémoire des pods, les nombres de redémarrages
   et les métriques de requêtes. Le module peut provisionner un **test de
   disponibilité** (lorsqu'il est activé) ; examinez Surveillance → Tests de
   disponibilité et Alertes → Règles.

---

## Tâche 5 — Dépannage et débogage [Manuel] {#task-5--troubleshoot--debug-manual}

Techniques durables pour les modes de défaillance que vous êtes le plus
susceptible de rencontrer. Ce sont des diagnostics au niveau de la plateforme et
ils ne changent pas avec les versions de Coder.

- **Pod non prêt / CrashLoopBackOff :** inspectez les événements et les
  journaux. Les sondes de démarrage et de vivacité ciblent toutes deux
  `/health` avec un délai initial de 60 secondes ; la sonde de démarrage
  permet jusqu'à 30 échecs à une période de 15 secondes pour couvrir la
  migration de schéma au premier démarrage de Coder, ne concluez donc pas à un
  échec trop tôt.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Erreurs de connexion à la base de données :** confirmez que l'instance
  Cloud SQL (PostgreSQL 15) est `RUNNABLE`, le mot de passe de la base de
  données matérialisé dans l'espace de noms via le pilote CSI du Secret Store,
  et le job `db-init` terminé. GKE atteint Cloud SQL via le sidecar Auth
  Proxy sur `127.0.0.1` ; le point d'entrée assemble `CODER_PG_CONNECTION_URL` avec
  `sslmode=disable` (le proxy termine déjà la connexion TLS) et encode le mot de
  passe en pourcentage.
- **Job d'initialisation échoué :** inspectez le job et ses journaux de pod :
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<db-init-job-name>
  ```
- **Pod en attente / pas d'IP externe :** vérifiez les événements `kubectl describe pod`
  pour les problèmes de ressources ou de quota, et confirmez que le service
  LoadBalancer / Ingress a une IP attribuée.
- **Erreurs de pull / build d'image :** confirmez que l'image existe dans
  Artifact Registry et que le compte de service du nœud peut la pull.
  `container_image_source` doit être `custom` — l'image amont `ghcr.io/coder/coder` ne peut
  pas assembler `CODER_PG_CONNECTION_URL`/`CODER_ACCESS_URL` par elle-même et échoue au
  démarrage si elle est déployée pré-construite. Un `MANIFEST_UNKNOWN` sur l'image
  de base signifie un tag de version inexistant — les tags Coder sont préfixés
  semver (`vX.Y.Z`), pas `latest`.
- **Les builds d'espace de travail sont en file d'attente mais ne démarrent
  jamais :** vérifiez que `CODER_ACCESS_URL` correspond à l'URL que les
  développeurs utilisent réellement — une non-concordance rompt les connexions
  de l'agent d'espace de travail. N'oubliez pas que ce module déploie
  uniquement le plan de contrôle ; les espaces de travail nécessitent en outre
  un provisionneur configuré et une cible de calcul configurée après le
  déploiement via le système de modèles de Coder.

Consultez la section *Pièges de configuration* du Guide de configuration pour
les problèmes spécifiques aux paramètres (y compris les règles critiques de ne
jamais renommer `application_database_name`/`application_database_user` après le premier déploiement, et
de ne jamais monter `enable_nfs`'s `nfs_mount_path` sur `/opt/coder`, ce qui
masque le binaire `coder`).

---

## Tâche 6 — Suppression [Automatisé] {#task-6--tear-down-automated}

Sur la page **Déploiements**, ouvrez le déploiement et cliquez sur l'icône
**Corbeille** (**Supprimer**). La suppression exécute `terraform destroy` et est
irréversible (l'enregistrement du déploiement est conservé pour l'historique).
Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer
(par exemple après des modifications manuelles qui entrent en conflit avec
l'état Terraform), utilisez **Purger** à la place (depuis la même boîte de
dialogue **Supprimer**) — cela supprime le déploiement des enregistrements de
RAD **sans** détruire les ressources cloud (cela fait oublier le déploiement à
RAD). Cela supprime tout ce que le module a créé — la charge de travail et
l'espace de noms Kubernetes, la base de données Cloud SQL, les secrets Secret
Manager, le bucket GCS et les images Artifact Registry. Les ressources
appartenant à **Services_GCP** (le VPC, le cluster GKE, Cloud SQL partagé, le
registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Résumé {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie la charge de travail GKE, Cloud SQL (PostgreSQL 15), les secrets, le bucket de stockage et exécute `db-init` |
| 2 — Accès et vérification | Manuel | Se connecter au cluster ; `/healthz` renvoie 200 ; créer le compte administrateur initial (propriétaire) dans l'interface utilisateur |
| 3 — Opérer | Manuel | Inspecter la charge de travail, mettre à l'échelle (adossé à HPA, min=1/max=5), mettre à jour la version, gérer les secrets/stockage, accès à la base de données |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de base de données, de job d'initialisation, de planification, de pull/build d'image et d'espace de travail bloqué |
| 6 — Supprimer | Automatisé | La suppression (Corbeille) supprime toutes les ressources du module |
