---
title: "Tolgee sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Tolgee sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/Tolgee_GKE.md @ 3055034 sha256:d563a79bc70b -->

# Tolgee sur GKE Autopilot — Guide de lab {#tolgee-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Tolgee_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Tolgee est une plateforme open source de localisation (i18n) et de gestion des
traductions, pensée pour les développeurs et construite sur Spring Boot. Ce lab
vous fait parcourir tout le cycle de vie opérationnel du module **Tolgee on GKE
Autopilot** sur Google Cloud : le déployer, y accéder et le vérifier,
l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et
le supprimer.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**,
et non sur les fonctionnalités de Tolgee. Pour la liste complète des services
provisionnés et de chaque paramètre de configuration (organisés par groupe),
consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Tolgee_GKE) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE et accéder à la charge de travail en cours d'exécution.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour et gérer les secrets.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Supprimer proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Cloud SQL, Artifact
  Registry et les comptes de service partagés dont dépend ce module). Vous n'avez
  pas besoin de le déployer vous-même au préalable — la plateforme détecte
  automatiquement s'il existe déjà dans le projet cible et, sinon, le
  provisionne avant ce module (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` exécutés.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans ce projet, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne requiert ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Sur un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez ces variables shell une seule fois ; toutes les tâches ci-dessous les réutilisent :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Tolgee (GKE)**
   dans la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou êtes partenaire ou administrateur), définissez `project_id`
   et passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Tolgee_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état
   du déploiement avec les journaux en temps réel.

2. La plateforme déploie la charge de travail dans le cluster GKE Autopilot,
   provisionne une base de données Cloud SQL (PostgreSQL 15) avec ses secrets
   Secret Manager (le mot de passe administrateur initial généré automatiquement,
   le secret de signature JWT et le mot de passe de la base de données), ainsi
   qu'un bucket Cloud Storage pour le stockage de fichiers facultatif. Il n'y a
   aucun job de migration distinct à attendre — l'étape `create-db-and-user.sh`
   de la fondation crée le rôle et la base de données, et Tolgee crée et migre
   l'intégralité de son schéma avec Liquibase au premier démarrage. Les premiers
   déploiements prennent environ **15–30 minutes** (la création de Cloud SQL en
   représente l'essentiel).

3. Connectez-vous au cluster et identifiez le namespace avec des filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep tolgee | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que la charge de travail s'exécute et repérez son adresse externe :

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Vérifiez que le service est opérationnel. Le point de terminaison de santé
   Spring Boot Actuator de Tolgee ne répond qu'une fois l'application entièrement
   démarrée et PostgreSQL (via le sidecar Cloud SQL Auth Proxy) joignable :

   ```bash
   curl -s "http://${EXTERNAL_IP}/actuator/health"   # expect {"status":"UP",...}
   ```

   Prévoyez plusieurs minutes au premier démarrage — Spring Boot et les migrations
   Liquibase initiales démarrent plus lentement qu'une application Node classique.

3. Récupérez le mot de passe administrateur initial généré et connectez-vous :

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~tolgee AND name~admin-password"
   gcloud secrets versions access latest \
     --secret="<admin-password-secret-name>" --project="$PROJECT"
   ```

   Ouvrez `http://${EXTERNAL_IP}` dans un navigateur et connectez-vous en tant que
   propriétaire initial — `admin@techequity.cloud` par défaut
   (`TOLGEE_AUTHENTICATION_INITIAL_USERNAME`) — avec le mot de passe récupéré
   ci-dessus. Changez immédiatement le mot de passe et configurez les éventuels
   fournisseurs d'authentification supplémentaires (Google/OAuth2/SSO) depuis
   l'interface de Tolgee avant la mise en service.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — le déploiement et les pods :

   ```bash
   kubectl get deploy,pods -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal
   d'instances puis en cliquant sur **Update** sur la page de détails du
   déploiement — le module possède la spécification de la charge de travail, la
   mise à l'échelle est donc une modification de configuration et non un
   `kubectl scale` manuel (une modification manuelle serait annulée lors de la
   prochaine application). GKE exige `min_instance_count >= 1` (pas de mise à
   l'échelle à zéro). Tolgee n'a pas de couche de file d'attente ni de
   coordination ; conservez donc `max_instance_count = 1` tant que vous n'avez
   pas validé la sûreté des écritures concurrentes — plusieurs pods
   fonctionneraient comme des rédacteurs concurrents sur la même base de données
   et le même volume NFS de pièces jointes. L'affinité de session (`ClientIP`)
   est définie par défaut pour maintenir les sessions de l'interface sur le même
   pod.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de
   version dans la plateforme RAD et en l'appliquant via **Update**. Comme
   `enable_nfs = true` par défaut, le Deployment utilise la stratégie `Recreate`
   plutôt qu'une mise à jour progressive — le pod en cours d'exécution est
   arrêté avant le démarrage de son remplaçant, afin d'éviter que deux pods ne
   se disputent le même volume NFS — attendez-vous donc à une courte
   interruption de disponibilité pendant une mise à jour, et non à un
   déploiement sans interruption. Tolgee applique ses changesets Liquibase à
   chaque démarrage ; fixez donc `application_version` sur une version éprouvée
   en production plutôt que de suivre `latest`.

4. **Gérez les secrets et les jobs :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~tolgee"
   kubectl get jobs -n "$NS"          # the DB role/database setup job
   ```

   Le secret de signature JWT (`TOLGEE_AUTHENTICATION_JWT_SECRET`) est immuable
   en pratique — n'effectuez sa rotation que lors d'une fenêtre de maintenance
   planifiée, car sa rotation invalide immédiatement toutes les sessions
   utilisateur actives.

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. tolgeedemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^tolgee" --limit=1)
   DB_NAME=$(gcloud sql databases list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^tolgee" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --database="$DB_NAME" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez
   l'utilisation CPU et mémoire des pods ainsi que le nombre de redémarrages. Le
   module peut provisionner un **contrôle de disponibilité** (uptime check) sur
   `/actuator/health` (lorsqu'il est activé) ; consultez Monitoring → Uptime
   checks et Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le
plus probablement. Ce sont des diagnostics au niveau de la plateforme, qui ne
changent pas avec les versions de Tolgee.

- **Pod non prêt / CrashLoopBackOff :** inspectez les événements et les
  journaux. La sonde de vivacité cible `/actuator/health` avec une large fenêtre
  au premier démarrage (les migrations Liquibase s'exécutent sur une base de
  données vierge au premier démarrage). Un échec de connexion du conteneur
  Spring Boot au sidecar Cloud SQL Auth Proxy empêchera le pod de devenir prêt.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  kubectl logs -n "$NS" <pod> -c cloud-sql-proxy   # sidecar logs, if present
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud
  SQL est `RUNNABLE` et que le conteneur sidecar Cloud SQL Auth Proxy s'exécute
  dans le pod. Le pilote JDBC de Tolgee ne peut pas utiliser de socket Unix ; il
  se connecte donc au proxy sur `127.0.0.1` en TCP simple — vérifiez que
  `enable_cloudsql_volume` est toujours à `true` (la valeur par défaut du module
  ici) ; le désactiver supprime le sidecar et le point de terminaison
  `127.0.0.1` attendu par l'application.
- **Rôle/schéma de base de données non créé :** il n'existe pas de job de
  migration dédié à relancer — l'étape `create-db-and-user.sh` de la fondation
  crée le rôle et la base de données, puis les migrations Liquibase de Tolgee
  construisent le schéma au démarrage. Inspectez le job de configuration et les
  journaux de son pod si la base de données semble vide :
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<job-name>
  ```
- **Utilisateurs déconnectés de façon inattendue / renvoyés d'une session à
  l'autre :** vérifiez que `session_affinity = ClientIP` est toujours défini, et
  si `TOLGEE_AUTHENTICATION_JWT_SECRET` a fait l'objet d'une rotation — sa
  rotation après le premier démarrage invalide toutes les sessions actives.
- **Le déploiement de la mise à jour semble bloqué :** rappelez-vous que le
  Deployment utilise `Recreate` (valeur par défaut adossée à NFS) — attendez-vous
  à ce que l'ancien pod s'arrête complètement avant que le nouveau ne démarre ;
  il s'agit d'une brève fenêtre d'interruption, et non d'un déploiement bloqué,
  sauf si le nouveau pod échoue lui aussi à sa sonde de démarrage.
- **Pod en attente / aucune IP externe :** consultez les événements de
  `kubectl describe pod` à la recherche de problèmes de ressources ou de quota,
  et vérifiez que le Service LoadBalancer a reçu une IP.
- **Erreurs de récupération d'image :** vérifiez que l'image existe dans
  Artifact Registry et que le compte de service des nœuds peut la récupérer.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les
pièges propres à chaque paramètre (dont le plancher de mémoire nécessaire aux
migrations Liquibase et la raison pour laquelle `enable_cloudsql_volume` doit
rester à `true` sur GKE).

---

## Tâche 6 — Supprimer [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — elle retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le déploiement). La suppression retire tout ce que le module a créé — la charge de travail Kubernetes
et son namespace, la base de données Cloud SQL, les secrets Secret Manager et le bucket
Cloud Storage. Les ressources appartenant à **Services_GCP** (le VPC, le cluster GKE, le Cloud
SQL partagé, le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Résumé {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie la charge de travail GKE, Cloud SQL (PostgreSQL 15), les secrets et un bucket de stockage ; Tolgee se migre lui-même via Liquibase |
| 2 — Accéder et vérifier | Manuel | Se connecter au cluster ; le contrôle de santé réussit ; se connecter avec l'identifiant administrateur initial généré et changer le mot de passe |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, mettre à l'échelle, mettre à jour la version (stratégie Recreate), gérer les secrets, accéder à la base de données |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le contrôle de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de connectivité à la base de données, de job de configuration, de planification et de récupération d'image |
| 6 — Supprimer | Automatisé | Delete (Trash) supprime toutes les ressources du module |
