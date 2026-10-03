---
title: "Synapse sur GKE Autopilot — Guide de Lab"
description: "Lab pratique : déployer Synapse sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, opérations, observabilité et suppression."
---

<!-- translated-from: docs/labs/Synapse_GKE.md @ 15fd4c7 sha256:d820fc994acd -->

# Synapse sur GKE Autopilot — Guide de Lab {#synapse-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Synapse_GKE)**

## Vue d'ensemble {#overview}

**Temps estimé :** 45 à 90 minutes

Synapse est le homeserver [Matrix](https://matrix.org/) de référence — le serveur
open source pour Matrix, une norme ouverte pour la communication décentralisée,
fédérée et en temps réel. Ce lab vous guide à travers le cycle de vie
opérationnel complet du module **Synapse sur GKE Autopilot** sur Google Cloud :
déployez-le, accédez-y et vérifiez-le, enregistrez un administrateur et
connectez-vous via l'API Matrix, exécutez-le au quotidien, observez-le,
diagnostiquez les problèmes courants et supprimez-le.

Le lab se concentre sur l'exploitation du **module GKE et de la plateforme
Google Cloud**, et non sur les fonctionnalités du produit Matrix. Pour la liste
complète des services provisionnés et de chaque entrée de configuration
(organisée par groupe), consultez le [Guide de
configuration](https://docs.radmodules.dev/docs/modules/Synapse_GKE) — ce lab
ne duplique délibérément pas ces détails afin qu'ils restent précis au fil du
temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez capable de :

- Déployer le module depuis la plateforme RAD et localiser les ressources qu'il
  provisionne.
- Vous connecter au cluster GKE et accéder à la charge de travail en cours
  d'exécution.
- Enregistrer un utilisateur administrateur et vous connecter via l'API client
  Matrix ; connecter Element.
- Effectuer des opérations de jour 2 — inspecter, mettre à l'échelle, mettre à
  jour et gérer les secrets et le stockage.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les
  plus courants.
- Supprimer proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Cloud SQL,
  Artifact Registry et les comptes de service partagés dont dépend ce module).
  Vous n'avez pas besoin de le déployer vous-même au préalable — la plateforme
  détecte automatiquement s'il existe déjà dans le projet cible et le
  provisionne avant ce module si ce n'est pas le cas (voir Tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et `gcloud auth application-default login`
  terminés.
- Rôle IAM de **Propriétaire de projet** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement, la
  boîte de dialogue de confirmation du déploiement vous demande de prouver que
  vous le contrôlez (**Obtenir le code de vérification**, exécutez les
  commandes qu'elle affiche en tant que Propriétaire du projet, puis
  **Vérifier**) et de donner au compte de service de déploiement RAD le rôle
  de **Propriétaire**. Un projet créé par RAD pour vous n'a besoin de rien de
  tout cela.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création
  ne demande que la première page d'entrées (et, dans un projet créé par RAD
  pour vous, guère plus que le nom du locataire et la région). Toutes les
  autres entrées du Guide de configuration — y compris les entrées de mise à
  l'échelle et de version dans les tâches de jour 2 — sont modifiées
  ultérieurement avec **Update** sur la page du déploiement après avoir coché
  **Enable advanced mode**, ce qui nécessite un solde de crédits couvrant le
  coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais
  de frais de module). Dans un environnement de lab, seul un administrateur
  peut utiliser le mode avancé.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules
  dans le projet.
- Un **domaine que vous contrôlez** pour `server_name` si vous avez l'intention de
  fédérer (définissez-le avant le premier déploiement — il est immuable).

Définissez ces variables shell une fois ; chaque tâche ci-dessous les réutilise
:

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Catalogue de solutions → Modules RAD** dans la
   navigation supérieure de la plateforme RAD, ouvrez **Synapse (GKE)** depuis
   la liste **Modules de plateforme**, choisissez **Formulaire de
   configuration** sous *Comment souhaitez-vous configurer ce déploiement ?*
   (le formulaire s'ouvre sur l'**Assistant conversationnel** si vous détenez
   des crédits achetés ou si vous êtes un partenaire ou un administrateur),
   définissez `project_id`, et — surtout — définissez **`server_name`** sur votre
   domaine réel (il est intégré à chaque ID utilisateur et est immuable après
   le premier démarrage). Passez en revue le reste des entrées ; le [Guide de
   configuration](https://docs.radmodules.dev/docs/modules/Synapse_GKE)
   documente chaque entrée par groupe, avec les valeurs par défaut. Cliquez sur
   **Déployer le module**, examinez le coût estimé dans la boîte de dialogue
   **Confirmation de déploiement** lorsqu'elle apparaît et cliquez sur
   **Soumettre** (si la boîte de dialogue ajoute ensuite une étape de
   confirmation, comme la vérification d'un projet que vous apportez,
   complétez-la et cliquez sur **Confirmer**), ce qui ouvre la page d'état du
   déploiement avec des logs en temps réel.

2. La plateforme déploie la charge de travail dans le cluster GKE Autopilot,
   provisionne une base de données Cloud SQL (PostgreSQL 15) avec ses secrets
   Secret Manager (le secret partagé d'enregistrement et le mot de passe de la
   base de données), un bucket de données Cloud Storage et un volume NFS pour
   la clé de signature et les médias, construit l'image du conteneur et
   exécute un job unique `db-init` qui crée la base de données **avec la
   collation obligatoire `C`**. Il n'y a pas de job de migration séparé —
   Synapse construit son propre schéma au premier démarrage. Les premiers
   déploiements prennent environ **20 à 35 minutes** (la création de Cloud SQL
   domine).

3. Connectez-vous au cluster et découvrez l'espace de noms avec des filtres
   agnostiques au nom :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep synapse | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier ; enregistrer un administrateur [Manuel] {#task-2--access--verify-register-an-admin-manual}

1. Confirmez que la charge de travail est en cours d'exécution et trouvez son
   adresse externe :

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Confirmez que le homeserver est sain. Synapse sert un `200 OK` non
   authentifié à `/health` sur le port 8008, et l'API client Matrix annonce
   ses versions de spécification prises en charge :

   ```bash
   curl -s "http://${EXTERNAL_IP}/health"                    # expect: OK
   curl -s "http://${EXTERNAL_IP}/_matrix/client/versions"   # expect JSON with a "versions" array
   ```

3. **Le premier utilisateur administrateur est déjà enregistré.** Le job
   d'initialisation `create-admin` du module exécute `register_new_matrix_user -u admin -a` pour vous, en
   utilisant le mot de passe superutilisateur généré et conservé dans Secret
   Manager. Lisez ce mot de passe :

   ```bash
   PW_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~synapse AND name~superuser-password" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$PW_SECRET" --project="$PROJECT"
   ```

   L'enregistrement en libre-service est désactivé par défaut, alors créez
   tout utilisateur *supplémentaire* hors bande avec `register_new_matrix_user`, exécuté
   depuis l'intérieur du pod où `homeserver.yaml` (avec son secret partagé) est
   présent :

   ```bash
   POD=$(kubectl get pods -n "$NS" -o jsonpath='{.items[0].metadata.name}')
   kubectl exec -n "$NS" "$POD" -- \
     register_new_matrix_user -c /data/homeserver.yaml -u <new-user> -p '<strong-password>' \
     http://localhost:8008
   ```

4. **Connectez-vous via l'API Matrix** pour confirmer que le compte fonctionne
   de bout en bout :

   ```bash
   curl -s -XPOST "http://${EXTERNAL_IP}/_matrix/client/v3/login" \
     -H 'Content-Type: application/json' \
     -d '{"type":"m.login.password","identifier":{"type":"m.id.user","user":"admin"},"password":"<the-password>"}'
   # A successful response returns an access_token, device_id, and user_id (@admin:<server_name>).
   ```

5. **Connectez un client.** Ouvrez l'application web [Element](https://app.element.io/),
   choisissez *Sign in* → *Edit* le homeserver, et entrez l'URL de votre
   homeserver (l'IP externe ou, de préférence, un domaine personnalisé
   correspondant à `server_name`). Connectez-vous en tant que `admin`.

---

## Tâche 3 — Opérer et maintenir en fonctionnement (Jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — déploiement, pods et l'autoscaler
   horizontal :

   ```bash
   kubectl get deploy,pods,hpa,pdb,pvc -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Gardez au moins un réplica.** GKE ne met pas à l'échelle à zéro, ce qui
   convient à un homeserver fédérateur qui doit rester accessible ; `min_instance_count = 1`
   et un PodDisruptionBudget le maintiennent disponible lors des mises à jour
   de nœuds. La mise à l'échelle est une modification de configuration via
   **Update**, et non un `kubectl scale` manuel (une modification manuelle est
   annulée lors du prochain apply). L'affinité de session (`ClientIP`)
   maintient les requêtes d'un client sur le même pod.

3. **Mettez à jour la version de l'application** en modifiant l'entrée de
   version dans la plateforme RAD et en l'appliquant via **Update** ; une
   nouvelle image est construite et une mise à jour progressive remplace les
   pods (les charges de travail basées sur NFS utilisent une stratégie
   `Recreate` pour éviter que deux pods ne se disputent le même répertoire de
   données). Synapse applique lui-même les mises à niveau de schéma au
   démarrage.

4. **Gérez les secrets, le stockage et les jobs :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~synapse"
   kubectl get jobs -n "$NS"          # db-init and any scheduled jobs
   ```

5. **Ouvrez une session de base de données** pour l'inspection ou la
   maintenance — et confirmez la collation :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. synapsedemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^synapse" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   #   SELECT datname, datcollate, datctype FROM pg_database WHERE datname = 'synapse';
   ```

---

## Tâche 4 — Observer : Logging et Monitoring [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Logs** — depuis `kubectl` ou l'Explorateur de logs :

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre de l'Explorateur de logs : `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — ouvrez les tableaux de bord GKE / Kubernetes et examinez
   l'utilisation du CPU et de la mémoire des pods, les nombres de redémarrages
   et les métriques de requêtes. Le module peut provisionner un **test de
   disponibilité** (lorsqu'il est activé — `uptime_check_config` par défaut à
   `enabled = false`) contre `/`, et non `/health` ; examinez Monitoring →
   Tests de disponibilité et Alerting → Stratégies.

---

## Tâche 5 — Dépannage et débogage [Manuel] {#task-5--troubleshoot--debug-manual}

Techniques durables pour les modes de défaillance que vous êtes le plus
susceptible de rencontrer. Il s'agit de diagnostics au niveau de la plateforme
et ils ne changent pas avec les versions de Synapse.

- **Pod non prêt / CrashLoopBackOff :** inspectez les événements et les logs.
  Les `startup_probe` et `liveness_probe` par défaut au chemin `/` (cette
  variante GKE remplace le propre défaut `Synapse_Common` de `/health`) et la
  sonde de disponibilité cible `/health`, le tout sur le port **8008** — une
  inadéquation du port du conteneur ou du port de la sonde fait que la sonde
  atteint un port mort et le pod ne devient jamais prêt même si Synapse est
  sain.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events show scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **`Database has incorrect values for … collation` :** la base de données n'a pas été créée avec la collation
  `C`. Confirmez que le job `db-init` a été exécuté ; réexécutez-le
  ou recréez la base de données (vide) avec `LC_COLLATE='C' LC_CTYPE='C'`.
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<db-init-job>
  ```
- **Fédération rompue / sessions d'appareil perdues après un redéploiement :**
  la clé de signature a été régénérée car le répertoire de données n'était pas
  persistant. Soit utilisez un PVC StatefulSet (`stateful_pvc_mount_path` par défaut à
  `/data`), soit conservez `enable_nfs = true` et `nfs_mount_path = "/data"` (les deux
  valeurs par défaut) — tout autre chemin de montage ne correspond pas au
  répertoire de données du point d'entrée (`SYNAPSE_DATA_DIR = "/data"`), de sorte que la
  clé de signature n'atterrirait pas sur le montage persistant et ne
  survivrait pas aux redémarrages des pods.
- **Erreurs de connexion à la base de données :** confirmez que l'instance
  Cloud SQL est `RUNNABLE`, que le secret du mot de passe de la base de
  données est matérialisé dans l'espace de noms et que le job d'initialisation
  est terminé.
- **Pod en attente / pas d'IP externe :** vérifiez les événements `kubectl describe pod`
  pour les problèmes de ressources ou de quotas, et confirmez que le service
  LoadBalancer a une IP attribuée.
- **Erreurs de pull d'image :** confirmez que l'image existe dans Artifact
  Registry et que le compte de service du nœud peut la pull.

Consultez la section *Pièges de configuration* du Guide de configuration pour
les pièges spécifiques aux paramètres (y compris les règles critiques selon
lesquelles `server_name` et la clé de signature sont immuables après le premier
démarrage, et que le port du conteneur et les sondes doivent être 8008).

---

## Tâche 6 — Suppression [Automatisé] {#task-6--tear-down-automated}

Sur la page **Déploiements**, ouvrez le déploiement et cliquez sur l'icône
**Corbeille** (**Supprimer**). La suppression exécute `terraform destroy` et est
irréversible (l'enregistrement du déploiement est conservé pour l'historique).
Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer
(par exemple après des modifications manuelles qui entrent en conflit avec
l'état Terraform), utilisez plutôt **Purger** (depuis la même boîte de
dialogue **Supprimer**) — cela supprime le déploiement des enregistrements de
RAD **sans** détruire les ressources cloud (cela fait oublier le déploiement à
RAD). Cela supprime tout ce que le module a créé — la charge de travail
Kubernetes et l'espace de noms, la base de données Cloud SQL, les secrets
Secret Manager, les buckets GCS, le volume NFS et les images Artifact Registry.
Les ressources appartenant à **Services_GCP** (le VPC, le cluster GKE, Cloud
SQL partagé, le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Résumé {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie la charge de travail GKE, Cloud SQL (PostgreSQL 15, collation C), les secrets, le stockage et exécute l'initialisation de la base de données |
| 2 — Accéder et vérifier | Manuel | Se connecter au cluster ; le contrôle de santé réussit ; enregistrer un administrateur ; se connecter via l'API Matrix ; connecter Element |
| 3 — Opérer | Manuel | Inspecter la charge de travail, mettre à l'échelle, mettre à jour la version, gérer les secrets/le stockage, l'accès à la base de données |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépannage | Manuel | Diagnostiquer les problèmes de pod, de collation, de clé de signature, de base de données, de job d'initialisation, de planification et de pull d'image |
| 6 — Suppression | Automatisé | La suppression (Corbeille) supprime toutes les ressources du module |
