---
title: "GoToSocial sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez GoToSocial sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/GoToSocial_GKE.md @ 3055034 sha256:9864610d950c -->

# GoToSocial sur GKE Autopilot — Guide de lab {#gotosocial-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/GoToSocial_GKE)**

## Vue d’ensemble {#overview}

**Durée estimée :** 45–90 minutes

GoToSocial est un serveur ActivityPub/Fediverse léger et auto-hébergé — une
petite alternative à Mastodon, écrite sous la forme d’un unique binaire Go statique. Ce lab
vous fait parcourir le cycle de vie opérationnel complet du module **GoToSocial sur GKE
Autopilot** sur Google Cloud : le déployer, y accéder et le vérifier (y compris
confirmer — ou, si nécessaire, terminer manuellement — la création de son premier compte
administrateur), l’exploiter au quotidien, l’observer, diagnostiquer les problèmes courants, puis le
supprimer.

Le lab porte sur l’exploitation du **module GKE et de la plateforme Google Cloud**, et non
sur les fonctionnalités du produit GoToSocial. Pour la liste complète des services provisionnés et
de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/GoToSocial_GKE) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu’il provisionne.
- Vous connecter au cluster GKE, accéder à la charge de travail en cours d’exécution, et confirmer (ou
  terminer manuellement) la création du premier compte administrateur de GoToSocial.
- Effectuer les opérations du jour 2 — inspecter, mettre à l’échelle, mettre à jour, et gérer les secrets et le stockage.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d’exécution les plus courants, y compris
  une création de compte administrateur bloquée ou partiellement échouée.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Cloud SQL, Artifact
  Registry et les comptes de service partagés dont dépend ce module). Vous n’avez pas besoin
  de le déployer vous-même au préalable — la plateforme détecte automatiquement s’il
  existe déjà dans le projet cible et, sinon, le provisionne avant ce module
  (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` effectués.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez en tant que Owner du projet les commandes qu’elle affiche, puis **Verify**) et d’attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l’un ni l’autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l’échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement, après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n’entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l’autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **GoToSocial
   (GKE)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s’ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou êtes partenaire ou administrateur), renseignez `project_id` et définissez
   **`host`** sur votre véritable domaine si vous en avez un (cette valeur est intégrée à
   chaque URI ActivityPub au moment de la création et devient **immuable** dès qu’il existe de vrais
   comptes/publications — la valeur provisoire `gotosocial.local` convient pour ce
   lab). Passez en revue les autres paramètres — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/GoToSocial_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu’elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d’un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d’état du
   déploiement avec les journaux en temps réel.

2. La plateforme déploie la charge de travail dans le cluster GKE Autopilot,
   provisionne une base de données Cloud SQL (PostgreSQL 15, créée avec la collation `C`
   obligatoire) avec ses secrets Secret Manager (`SUPERUSER_PASSWORD`,
   une paire de clés HMAC pour le stockage d’objets compatible S3, et le mot de passe
   de la base), un bucket Cloud Storage `storage`, une IP statique réservée avec un
   Service LoadBalancer, et exécute le job d’initialisation `db-init` (ainsi qu’une
   tentative `admin-create` au mieux — voir la tâche 2). Un premier déploiement prend
   environ **15 à 25 minutes** (la création de Cloud SQL représente l’essentiel du temps).

3. Connectez-vous au cluster et repérez l’espace de noms à l’aide de filtres indépendants du nom :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep gotosocial | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Trouvez l’adresse externe (une IP statique est réservée par défaut) :

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. **Vérifiez que le service est démarré — mais vous devez envoyer un en-tête `User-Agent`, sinon
   GoToSocial rejettera la requête.** Les points de contrôle de santé de GoToSocial
   (`/readyz`, `/livez`) sont bien réels et sans authentification, mais ils rejettent délibérément
   toute requête dépourvue de `User-Agent` avec une réponse `418 I'm a teapot`
   — c’est une mesure anti-scraping, et non un bug :

   ```bash
   curl -s "http://${EXTERNAL_IP}/readyz"                        # 418 — no User-Agent sent
   curl -A "gotosocial-lab-check/1.0" -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/readyz"   # expect 200
   ```

3. **Vérifiez si le compte administrateur a déjà été créé automatiquement.**
   Contrairement à Cloud Run, l’ordre plus souple des jobs d’initialisation sur GKE laisse à la
   boucle de nouvelles tentatives interne du job `admin-create` (20 tentatives, espacées de 15 s) une réelle
   chance de gagner sa course contre le démarrage du pod principal — il se peut donc qu’il ait
   déjà réussi pendant le déploiement :

   ```bash
   kubectl get jobs -n "$NS"
   kubectl logs -n "$NS" job/$(kubectl get jobs -n "$NS" -o name | grep admin-create | head -1 | cut -d/ -f2)
   ```

   Cherchez `[admin-create] Done.` dans la sortie. Si vous constatez au contraire qu’il
   réessaie encore ou qu’il a échoué, déclenchez une nouvelle exécution :

   ```bash
   JOB=$(kubectl get jobs -n "$NS" -o name | grep admin-create | head -1 | cut -d/ -f2)
   kubectl create job --from=job/"$JOB" "${JOB}-retry" -n "$NS"
   kubectl wait --for=condition=complete --timeout=300s job/"${JOB}-retry" -n "$NS"
   ```

4. **Récupérez le `SUPERUSER_PASSWORD` généré dans Secret Manager :**

   ```bash
   SECRET=$(gcloud secrets list --project="$PROJECT" --filter="name~superuser-password" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$SECRET" --project="$PROJECT"
   ```

5. Connectez-vous avec le nom d’utilisateur par défaut `admin` (ou la valeur donnée à `superuser_username`)
   et le mot de passe récupéré, à l’aide de n’importe quel
   client compatible ActivityPub/GoToSocial, ou vérifiez directement l’API
   client :

   ```bash
   curl -A "gotosocial-lab-check/1.0" -s "http://${EXTERNAL_IP}/api/v1/instance" | head -c 500
   ```

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspecter la charge de travail** — le déploiement, les pods et les jobs :

   ```bash
   kubectl get deploy,pods -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Mettre à l’échelle** en modifiant les paramètres de nombre minimal/maximal d’instances puis en cliquant sur **Update**
   sur la page de détails du déploiement — le module est propriétaire de la spécification de la charge de travail, la
   mise à l’échelle est donc une modification de configuration, et non un `kubectl scale` manuel (une modification
   manuelle serait annulée à l’application suivante). GoToSocial utilise par défaut
   `min_instance_count = 0` (mise à l’échelle à zéro) et `max_instance_count = 1` —
   **n’augmentez pas `max_instance_count`** : le cache interne au processus de GoToSocial n’a
   aucune synchronisation entre instances, et le projet amont ne prend pas en charge plusieurs
   instances sur la même base de données / le même stockage.

3. **Mettre à jour la version de l’application** en modifiant le paramètre de version dans la
   plateforme RAD et en l’appliquant via **Update** ; la récupération d’une nouvelle image et une mise à jour
   progressive remplacent le pod. Les migrations de schéma s’exécutent automatiquement au démarrage —
   il n’y a pas de job de migration distinct à exécuter.

4. **Gérer les secrets, le stockage et les jobs :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~gotosocial"
   kubectl get jobs -n "$NS"          # db-init, admin-create jobs
   ```

5. **Ouvrir une session de base de données** pour l’inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --filter="name~gotosocial" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. gotosocialdemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^gotosocial" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

6. **Vérifier que le stockage d’objets est bien utilisé** (les médias, avatars et pièces jointes vont
   directement dans GCS via le client S3 natif de GoToSocial, et non via un montage de système de fichiers) :

   ```bash
   BUCKET=$(gcloud storage buckets list --project="$PROJECT" --filter="name~gotosocial" --format="value(name)" --limit=1)
   gcloud storage ls "gs://$BUCKET/"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l’explorateur de journaux (Logs Explorer) :

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l’utilisation du processeur
   et de la mémoire des pods, le nombre de redémarrages et les métriques de requêtes. Le module
   peut provisionner un **test de disponibilité** (uptime check, lorsqu’il est activé) ; consultez Monitoring →
   Uptime checks et Alerting → Policies. Notez que si vous l’activez, un
   test de disponibilité sur `/` (et non `/readyz`/`/livez`) évite le
   risque de faux échecs dû au filtrage par User-Agent, sauf si le vérificateur envoie un
   `User-Agent`.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous risquez le plus de rencontrer. Il s’agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de GoToSocial.

- **Les contrôles de santé / curl renvoient `418 I'm a teapot` :** c’est attendu —
  GoToSocial rejette toute requête sans en-tête `User-Agent` par mesure
  anti-scraping, même sur ses points de terminaison « sans authentification » `/readyz`/`/livez`.
  Passez toujours `curl -A "<some-agent>" ...`. Ce n’est *pas* le signe
  que le pod est en mauvaise santé.
- **Pod non Ready / CrashLoopBackOff :** examinez les événements et les journaux. Les sondes de
  démarrage et de vivacité sont toutes deux des sondes **TCP** sur le port 8080 (et non HTTP) ; un pod
  « Ready » peut donc tout de même échouer sur les requêtes si Postgres ou GCS n’est pas joignable
  — consultez les journaux de l’application, et pas seulement l’état du pod.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **`error opening storage backend: ... Access Denied` :** lors d’un *tout premier
  déploiement*, il peut s’agir d’une course ponctuelle de propagation IAM (l’attribution de
  `roles/storage.objectAdmin` au compte de service de stockage peut mettre 1 à 2 minutes à se
  propager) — le cycle de redémarrage et de nouvelle tentative du pod résout le problème de lui-même en quelques
  minutes. S’il persiste, vérifiez l’attribution :
  ```bash
  BUCKET=$(gcloud storage buckets list --project="$PROJECT" --filter="name~gotosocial" --format="value(name)" --limit=1)
  gcloud storage buckets get-iam-policy "gs://$BUCKET"
  ```
- **Le job `admin-create` ne s’est jamais terminé (aucun `[admin-create] Done.` dans ses
  journaux) :** la boucle de nouvelles tentatives du job (20 tentatives espacées de 15 secondes) a perdu la course
  contre le premier démarrage du pod principal. Vérifiez que le pod principal est `Ready`, puis
  redéclenchez le job (tâche 2, étape 3).
- **La nouvelle tentative de `admin-create` échoue avec `sql: no rows in result set` /
  `IsUsernameAvailable` indique que le nom d’utilisateur est déjà pris, alors que vous ne l’avez jamais
  créé avec succès :** cela signifie qu’une tentative précédente a laissé une ligne
  `accounts` orpheline, sans ligne `users` correspondante (GoToSocial insère d’abord le compte,
  puis plante à l’étape de la ligne utilisateur si l’application d’instance n’était pas
  prête). Il s’agit d’un mode de défaillance réel et récurrent sur tout déploiement où la
  première tentative entre en course avec le démarrage du pod et la perd — et non d’un cas isolé. Pour rétablir la situation,
  connectez-vous directement à la base de données (un pod de débogage ponctuel est le plus simple sur
  GKE) et supprimez la ligne orpheline avant de réessayer :
  ```bash
  kubectl run pg-debug --rm -it --restart=Never --image=postgres:15-alpine -n "$NS" -- sh
  # inside the debug pod:
  #   psql "postgresql://<db-user>:<db-password>@<db-host>:5432/<db-name>"
  ```
  ```sql
  SELECT id, username, domain FROM accounts WHERE username='admin';  -- or your superuser_username
  DELETE FROM account_settings WHERE account_id='<the id above>';
  DELETE FROM account_stats WHERE account_id='<id>';
  DELETE FROM accounts WHERE id='<id>';
  ```
  Relancez ensuite proprement `admin-create` (tâche 2, étape 3). (Les identifiants de la base se trouvent dans
  Secret Manager — `gcloud secrets list --project="$PROJECT" --filter="name~gotosocial-db"`.)
- **Erreurs de connexion à la base de données :** vérifiez que l’instance Cloud SQL est
  `RUNNABLE`, que le secret du mot de passe de la base a bien été matérialisé dans l’espace de noms via le
  pilote Secret Store CSI, et que le job `db-init` s’est terminé, la base de données
  affichant la collation `C` :
  ```sql
  SELECT datname, datcollate, datctype FROM pg_database WHERE datname = 'gotosocial';
  ```
  `enable_cloudsql_volume` vaut `true` par défaut sur ce module (le
  sidecar cloud-sql-proxy) — laissez-le activé ; GoToSocial se connecte via son interface de bouclage
  `127.0.0.1` (`GTS_DB_TLS_MODE = "disable"` est correct ici, contrairement à
  Cloud Run).
- **Le job d’initialisation a échoué :** examinez le job et les journaux de son pod :
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<db-init-job-name>
  ```
- **Pod en attente / pas d’IP externe :** consultez les événements de `kubectl describe pod` pour repérer des
  problèmes de ressources ou de quotas, et vérifiez que le Service LoadBalancer a une
  IP attribuée (`reserve_static_ip = true` est le paramètre par défaut et recommandé
  — consultez le Guide de configuration au sujet de la course liée au DNS interne qu’il évite).
- **Erreurs de récupération d’image :** vérifiez que l’image existe dans Artifact Registry et que le
  compte de service des nœuds peut la récupérer.

Consultez la section *Configuration Pitfalls & Sensible Defaults* du Guide de configuration
pour les pièges propres à chaque paramètre (notamment le fait que `max_instance_count` soit un
plafond architectural strict, l’immuabilité de `host`, et la procédure de récupération
des comptes orphelins).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l’icône **Trash**
(**Delete**). La suppression exécute `terraform destroy` et est irréversible (l’enregistrement
du déploiement est conservé pour l’historique). Si un déploiement est bloqué et que la
plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en
conflit avec l’état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — elle retire le
déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD
oublie simplement le déploiement). Cela supprime tout ce que le module a créé —
la charge de travail Kubernetes et son espace de noms, la base de données Cloud SQL, les secrets
Secret Manager, le bucket GCS `storage`, l’IP statique réservée et les images
Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC, le cluster GKE,
le Cloud SQL partagé, le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie la charge de travail GKE, Cloud SQL (PostgreSQL 15, collation `C`), des secrets, le bucket `storage`, une IP statique, et exécute `db-init` (+ `admin-create` au mieux) |
| 2 — Accéder et vérifier | Manuel | Vérifier la santé avec un en-tête `User-Agent` ; vérifier ou terminer manuellement `admin-create` ; récupérer `SUPERUSER_PASSWORD` |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, mettre à l’échelle (jamais au-delà de `max_instance_count = 1`), mettre à jour la version, gérer secrets/stockage, accès à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer la particularité 418/User-Agent, la propagation IAM du stockage, les courses de admin-create, les lignes de compte orphelines, les problèmes de base de données, de planification et de récupération d’image |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
