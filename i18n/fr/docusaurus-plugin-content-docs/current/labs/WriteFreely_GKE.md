---
title: "WriteFreely sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez WriteFreely sur GKE Autopilot dans votre propre projet Google Cloud — mise en place guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/WriteFreely_GKE.md @ 3055034 sha256:a80dae0291e9 -->

# WriteFreely sur GKE Autopilot — Guide de lab {#writefreely-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/WriteFreely_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

WriteFreely est une plateforme de blog open source, minimaliste et fédérée, écrite en
Go — une alternative légère à Medium pour publier des textes épurés, sans
distraction. Ce lab vous fait parcourir le cycle de vie opérationnel complet du module
**WriteFreely on GKE Autopilot** sur Google Cloud : le déployer, y accéder et
le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et le
supprimer.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**,
et non sur les fonctionnalités du produit WriteFreely. Pour la liste complète des services
provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/WriteFreely_GKE) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE et accéder au blog en cours d'exécution.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et la base de données.
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

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **WriteFreely
   (GKE)** dans la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez
   `project_id` et passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/WriteFreely_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état
   du déploiement avec les journaux en temps réel.

2. La plateforme déploie la charge de travail dans le cluster GKE Autopilot,
   provisionne une base de données Cloud SQL (MySQL 8.0) avec ses secrets Secret Manager
   (trois clés AES-256 — `cookies-auth`, `cookies-enc`, `email-key` — plus le
   mot de passe de la base de données), un bucket Cloud Storage dédié `writefreely-uploads`,
   construit l'image de conteneur personnalisée config-gen, un système de fichiers NFS (activé par
   défaut), et exécute un job ponctuel d'initialisation de la base de données. Le premier déploiement
   prend environ **15 à 25 minutes** (la création de Cloud SQL en représente l'essentiel).

3. Connectez-vous au cluster et repérez l'espace de noms avec des filtres indépendants
   des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep writefreely | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Confirmez que la charge de travail est en cours d'exécution et trouvez son adresse externe :

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Confirmez que le service fonctionne. WriteFreely n'a pas de point de terminaison `/health` dédié —
   la sonde de vivacité est un `GET /` HTTP qui attend un `200` de la page d'accueil :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/"   # expect 200
   ```

3. Ouvrez `http://${EXTERNAL_IP}` dans un navigateur pour confirmer que la page d'accueil du blog
   s'affiche. Les inscriptions sont **fermées par défaut** (`open_registration = false`)
   et aucun compte administrateur n'est créé d'office ; créez donc le premier compte maintenant, au choix :

   - Définissez temporairement `WF_OPEN_REGISTRATION = "true"` dans `environment_variables`
     et appliquez via **Update**, inscrivez-vous depuis l'interface, puis remettez la valeur à
     `"false"` et appliquez de nouveau ; **ou**
   - Exécutez avec `exec` la commande intégrée de création d'administrateur de WriteFreely dans un pod en cours d'exécution :

     ```bash
     SERVICE=$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')
     kubectl exec -n "$NS" deploy/"$SERVICE" -- \
       /usr/local/bin/writefreely --create-admin <user>:<password>
     ```

4. **Ne faites pas de rotation des clés AES-256** (`cookies-auth`, `cookies-enc`,
   `email-key`) après ce premier démarrage — cela déconnecte tous les utilisateurs et rend
   indéchiffrables les adresses e-mail précédemment chiffrées.

5. Une fois l'IP du LoadBalancer attribuée, définissez `WF_PUBLIC_URL` (via
   `environment_variables`) sur `http://<external-ip>` ou sur un domaine personnalisé, afin que
   les liens générés et la fédération utilisent l'hôte joignable.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — le déploiement, les pods et l'autoscaler horizontal :

   ```bash
   kubectl get deploy,pods,hpa -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances puis en cliquant sur **Update** sur
   la page de détails du déploiement — le module gère la spécification de la charge de travail, si bien que la mise à l'échelle
   est une modification de configuration, et non un `kubectl scale` manuel (une modification manuelle serait
   annulée au prochain apply). WriteFreely utilise par défaut `min_instance_count
   = 1` et `max_instance_count = 1` (GKE ne prend pas en charge la mise à l'échelle jusqu'à zéro).
   L'affinité de session (`ClientIP`) est définie par défaut afin que les requêtes d'un
   même client restent attachées au même pod.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme
   RAD et en l'appliquant via **Update** ; une nouvelle image est construite et une mise à jour
   progressive remplace les pods. En production, épinglez une version précise plutôt que de laisser
   `application_version = "latest"`, afin que les reconstructions restent
   reproductibles.

4. **Gérez les secrets et le stockage :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" \
     --filter="name~cookies-auth OR name~cookies-enc OR name~email-key"
   kubectl get jobs -n "$NS"          # db-init job
   ```

5. **Ouvrez une session sur la base de données** pour l'inspecter ou en assurer la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. writefreelydemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^writefreely" --limit=1)
   DB_NAME=$(gcloud sql databases list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^writefreely" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --database="$DB_NAME" --project="$PROJECT"
   ```

6. **Vérifiez l'hôte de base de données injecté dans le pod en cours d'exécution** (il doit valoir
   `127.0.0.1` — le sidecar Cloud SQL Auth Proxy — et non l'IP privée) :

   ```bash
   kubectl exec -n "$NS" deploy/"$SERVICE" -- env | grep -E 'DB_HOST|WF_'
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer). Au premier démarrage, recherchez les
   lignes de progression du point d'entrée (`WriteFreely: rendered config.ini …`, `… seeded
   stable encryption keys …`, `… starting server …`) :

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation du CPU et
   de la mémoire des pods, le nombre de redémarrages et les métriques de requêtes. Le module peut
   provisionner un **test de disponibilité** (uptime check, lorsqu'il est activé) ; examinez Monitoring → Uptime
   checks et Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit
de diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de WriteFreely.

- **Pod non Ready / CrashLoopBackOff :** inspectez les événements et les journaux. La sonde
  de démarrage est TCP (Ready dès que le port 8080 est lié) ; la sonde de vivacité est un
  `GET /` HTTP. Un échec de connexion à MySQL via le sidecar Auth Proxy
  empêchera le pod de devenir Ready.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est
  `RUNNABLE`, que le secret du mot de passe de la base a bien été matérialisé dans l'espace de noms et que le
  job d'initialisation s'est terminé. Sur GKE, WriteFreely atteint MySQL via le **sidecar Cloud SQL
  Auth Proxy sur `127.0.0.1:3306`** (`enable_cloudsql_volume = true`) —
  ne confondez pas avec le chemin TCP sur IP privée de la variante Cloud Run.
- **Échec du job d'initialisation :** inspectez le job et les journaux de son pod :
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<job-name>
  ```
- **Pod en attente (Pending) / pas d'IP externe :** consultez les événements de `kubectl describe pod` pour repérer des
  problèmes de ressources ou de quota, et vérifiez que le Service LoadBalancer a bien une
  IP attribuée.
- **Erreurs de récupération d'image :** confirmez que l'image existe dans Artifact Registry et que le
  compte de service des nœuds peut la récupérer — `container_image_source` doit rester à
  `custom`, car le point d'entrée config-gen n'est présent dans aucune image amont
  préconstruite.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour
les pièges propres à chaque paramètre (y compris la règle essentielle de ne jamais faire de rotation des
clés AES-256 après le premier démarrage, et pourquoi `application_database_name`/
`application_database_user` sont immuables après le premier déploiement).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash**
(**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement
du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la
plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles
en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le
déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD
oublie le déploiement). Cela supprime tout ce que le module a créé — la
charge de travail Kubernetes et l'espace de noms, la base de données Cloud SQL, les secrets Secret Manager,
les buckets GCS et les images Artifact Registry. Les ressources appartenant à **Services_GCP**
(le VPC, le cluster GKE, le Cloud SQL partagé, le registre) sont gérées séparément et
ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie la charge de travail GKE, Cloud SQL (MySQL 8.0), 3 secrets de clés AES-256, un bucket de stockage et NFS, et exécute l'initialisation de la base |
| 2 — Accéder et vérifier | Manuel | Se connecter au cluster ; la page d'accueil renvoie 200 ; créer le compte initial |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, mettre à l'échelle, mettre à jour la version, gérer les secrets/le stockage, accéder à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de base de données, de job d'initialisation, de planification et de récupération d'image |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
