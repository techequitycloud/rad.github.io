---
title: "Xibo sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Xibo sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, opérations, observabilité et suppression."
---

<!-- translated-from: docs/labs/Xibo_GKE.md @ 2829548 sha256:3b66fd8acc08 -->

# Xibo sur GKE Autopilot — Guide de lab {#xibo-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Xibo_GKE)**

## Vue d'ensemble {#overview}

**Temps estimé :** 45 à 90 minutes

Xibo est une plateforme open-source d'affichage dynamique dont le CMS planifie et distribue
des mises en page, des listes de lecture et des médias à des réseaux de lecteurs d'affichage. Ce lab vous
guide à travers le cycle de vie opérationnel complet du module **Xibo sur GKE Autopilot** sur
Google Cloud : déployez-le, accédez-y et vérifiez-le, exécutez-le au quotidien, observez-le,
diagnostiquez les problèmes courants et supprimez-le.

Le lab se concentre sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non sur
les fonctionnalités du produit Xibo. Pour la liste complète des services provisionnés et de chaque
entrée de configuration (organisée par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Xibo_GKE) — ce
lab ne duplique délibérément pas ces détails afin qu'ils restent précis au fil du temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez capable de :

- Déployer le module depuis la plateforme RAD avec une bibliothèque de médias persistante, et localiser les ressources qu'il provisionne.
- Vous connecter au cluster GKE et accéder au CMS en cours d'exécution.
- Effectuer des opérations de jour 2 — inspecter, mettre à jour et gérer les secrets, le stockage et le job de base de données.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Supprimer proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Cloud SQL, Artifact
  Registry et les comptes de service partagés dont dépend ce module). Vous n'avez pas besoin
  de le déployer vous-même au préalable — la plateforme détecte automatiquement s'il
  existe déjà dans le projet cible et le provisionne avant ce module si
  ce n'est pas le cas (voir Tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` complétés.
- Rôle IAM de **Propriétaire de projet** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Obtenir le code de vérification**, exécutez les commandes qu'elle affiche en tant que Propriétaire de projet, puis **Vérifier**) et de donner le rôle de **Propriétaire** au compte de service de déploiement RAD. Un projet créé par RAD pour vous n'a besoin de rien de tout cela.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page d'entrées (et, dans un projet créé par RAD pour vous, guère plus que le nom du locataire et la région). Chaque autre entrée du Guide de configuration — y compris les entrées de mise à l'échelle et de version dans les tâches de jour 2 — est modifiée par la suite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui nécessite un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez ces variables shell une seule fois ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Catalogue de solutions → Modules RAD** dans la navigation supérieure de la plateforme RAD, ouvrez **Xibo (GKE)** depuis la liste **Modules de plateforme** pour commencer la configuration, choisissez **Formulaire de configuration** sous *Comment souhaitez-vous configurer ce déploiement ?* (le formulaire s'ouvre sur l'**Assistant conversationnel** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id`, et examinez les entrées.
   Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Xibo_GKE)
   documente chaque entrée par groupe, avec des valeurs par défaut. **Décidez de la persistance des médias
   maintenant :** avec les valeurs par défaut du module, la bibliothèque de médias de Xibo n'est pas sur un
   volume persistant, et les paramètres de volume d'un StatefulSet ne peuvent pas être modifiés sur place
   ultérieurement. Pour un déploiement que vous avez l'intention de conserver, définissez `stateful_pvc_enabled = true`,
   `stateful_pvc_mount_path = "/var/www/cms/library"`, un `stateful_pvc_size` qui
   correspond à vos médias, et `max_instance_count = 1` (ceux-ci peuvent n'être accessibles qu'en
   mode avancé ; voir Prérequis). Cliquez sur **Déployer le module**, examinez le coût estimé dans la
   boîte de dialogue **Confirmation de déploiement** lorsqu'elle apparaît et cliquez sur **Soumettre** (si la
   boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous
   apportez, complétez-la et cliquez sur **Confirmer**), ce qui ouvre la page d'état du déploiement avec
   des logs en temps réel.

2. La plateforme construit l'image Xibo (un wrapper léger sur
   `ghcr.io/xibosignage/xibo-cms`) avec Cloud Build, provisionne une base de données Cloud SQL
   (MySQL 8.0) avec ses secrets Secret Manager, exécute le job unique `db-init`,
   et déploie le CMS dans le cluster GKE Autopilot derrière une Gateway. Au premier
   démarrage, Xibo installe son propre schéma. Les premiers déploiements prennent environ **20 à 35 minutes**
   (la création de Cloud SQL domine).

3. Connectez-vous au cluster et découvrez l'espace de noms avec des filtres agnostiques au nom :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep xibo | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Confirmez que la charge de travail est en cours d'exécution et que le job de base de données est terminé :

   ```bash
   kubectl get deploy,statefulset,pods,pvc,jobs -n "$NS"
   POD=$(kubectl get pods -n "$NS" -o name | grep -v db-init | head -1 | cut -d/ -f2)
   kubectl logs -n "$NS" "$POD" | grep "\[startup\]"
   ```

   La ligne `[startup]` affiche l'hôte et le port de la base de données (l'IP privée de Cloud SQL
   sur `3306`) et le `server_name` dérivé pour les lecteurs.

2. Vérifiez si la bibliothèque de médias se trouve sur un volume persistant :

   ```bash
   kubectl exec -n "$NS" "$POD" -- df -h /var/www/cms/library
   ```

   Si cela affiche le système de fichiers overlay du conteneur plutôt qu'un volume monté,
   les téléchargements seront perdus lorsque le pod sera remplacé — voir Tâche 5.

3. Trouvez l'URL. Sur la page du déploiement dans la plateforme RAD, lisez la
   sortie `service_url` ; c'est l'URL `nip.io` de la Gateway, sauf si vous avez défini un domaine personnalisé.
   Vérifiez la page de connexion :

   ```bash
   SERVICE_URL="<service_url from the deployment outputs>"
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/login"   # expect 200
   ```

4. Ouvrez le CMS via **HTTPS** dans un navigateur (les cookies de session sont marqués `Secure`,
   donc une connexion via HTTP simple ne persiste pas). L'image amorce un compte `xibo_admin`
   fixe ; le module ne définit pas son mot de passe. Connectez-vous avec les identifiants initiaux
   documentés par Xibo pour son image Docker et **changez le mot de passe
   immédiatement**. Le mot de passe de la base de données utilisé par le CMS se trouve dans Secret Manager :

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~xibo" --format="value(name)"
   ```

---

## Tâche 3 — Opérer et maintenir en fonctionnement (Jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — la charge de travail du CMS, son pod et (si activé) son
   volume persistant :

   ```bash
   kubectl get deploy,statefulset,pods,pvc -n "$NS"
   kubectl describe pod -n "$NS" "$POD"
   ```

2. **Gardez un seul réplica.** Chaque réplica aurait sa propre bibliothèque, donc laissez
   `min_instance_count`/`max_instance_count` à `1`. Les modifications passent par **Update** sur
   la page des détails du déploiement — le module possède la spécification de la charge de travail, donc un
   `kubectl scale` manuel serait annulé lors du prochain apply.

3. **Mettez à jour la version de Xibo** en changeant `application_version` via **Update** pour
   une autre balise exacte publiée sur `ghcr.io/xibosignage/xibo-cms`. Une nouvelle image est construite,
   le pod est remplacé, et le point d'entrée de Xibo migre le schéma au démarrage.

4. **Gérez les secrets, le stockage et les jobs :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~xibo"
   kubectl get jobs -n "$NS"          # db-init and any scheduled jobs
   ```

5. **Ouvrez une session de base de données** pour inspection ou maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^xibo" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

6. **Domaine personnalisé.** Si vous servez le CMS sur votre propre domaine, définissez également
   `CMS_SERVER_NAME` sur cet hôte dans `environment_variables` — Xibo l'écrit dans
   la configuration que les lecteurs reçoivent.

---

## Tâche 4 — Observer : Journalisation et Surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Logs** — depuis `kubectl` ou l'Explorateur de logs :

   ```bash
   kubectl logs -n "$NS" "$POD" --tail=50
   ```

   Filtre de l'Explorateur de logs :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation du CPU et de la mémoire des pods, le nombre de redémarrages et les métriques de requêtes. Le module provisionne également un **test de disponibilité** (lorsqu'il est activé) ; examinez Surveillance → Tests de disponibilité et Alertes → Règles.

---

## Tâche 5 — Dépannage et débogage [Manuel] {#task-5--troubleshoot--debug-manual}

Techniques durables pour les modes de défaillance que vous êtes le plus susceptible de rencontrer. Ce sont
des diagnostics au niveau de la plateforme et ils ne changent pas avec les versions de Xibo.

- **Pod non prêt / CrashLoopBackOff :** inspectez les événements et les logs. Les sondes ciblent
  `/login` ; un chemin de sonde de `/healthz` renvoie 404 et redémarre un pod sain.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Erreurs de connexion à la base de données :** confirmez que l'instance Cloud SQL est `RUNNABLE`, que le
  job `db-init` est terminé, et que la ligne `[startup]` affiche l'IP privée sur `3306`.
  Si `MYSQL_ATTR_SSL_VERIFY_SERVER_CERT` a été remplacé par `true`, PDO refuse la
  connexion Cloud SQL.
- **Le job d'initialisation a échoué :** inspectez le job et ses logs de pod :
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<job-name>
  ```
- **Les médias téléchargés ont disparu après un redémarrage :** la bibliothèque n'était pas sur un
  volume persistant (Tâche 2, étape 2). La solution est `stateful_pvc_enabled = true` avec
  `stateful_pvc_mount_path = "/var/www/cms/library"` ; l'activer sur un déploiement existant
  remplace la charge de travail par un StatefulSet dont la bibliothèque démarre vide, donc
  re-téléchargez les médias après.
- **La connexion ne persiste pas :** utilisez l'URL HTTPS ; les cookies sont `Secure`.
- **Les lecteurs pointent vers la mauvaise adresse :** vérifiez `server_name` dans la ligne `[startup]`
  et définissez `CMS_SERVER_NAME` pour un domaine personnalisé.
- **La construction de l'image a échoué :** examinez **Cloud Build → Historique** ; confirmez que la
  balise `application_version` existe sur `ghcr.io/xibosignage/xibo-cms` (pas Docker
  Hub).

Consultez la section *Pièges de configuration* du Guide de configuration pour les problèmes spécifiques aux paramètres.

---

## Tâche 6 — Suppression [Automatisé] {#task-6--tear-down-automated}

Sur la page **Déploiements**, ouvrez le déploiement et cliquez sur l'icône **Corbeille** (**Supprimer**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles qui entrent en conflit avec l'état Terraform), utilisez plutôt **Purger** (depuis la même boîte de dialogue **Supprimer**) — cela supprime le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (cela fait oublier le déploiement à RAD). La suppression supprime tout ce que le module a créé — la charge de travail et l'espace de noms Kubernetes (y compris tout volume de bibliothèque), la base de données Cloud SQL, les secrets Secret Manager, les buckets GCS et les images Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC, le cluster GKE, Cloud SQL partagé, le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Résumé {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module construit l'image Xibo, provisionne Cloud SQL (MySQL 8.0) et les secrets, exécute `db-init`, et déploie le CMS |
| 2 — Accéder et vérifier | Manuel | Connexion au cluster ; persistance de la bibliothèque vérifiée ; `/login` renvoie 200 ; mot de passe administrateur modifié |
| 3 — Opérer | Manuel | Inspecter la charge de travail, conserver un réplica, mettre à jour la version, gérer les secrets/stockage/jobs, accès à la base de données |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépannage | Manuel | Diagnostiquer les problèmes de pod, de base de données, de job d'initialisation, de médias perdus, de connexion, d'adresse de lecteur et de build |
| 6 — Suppression | Automatisé | La suppression (Corbeille) supprime toutes les ressources du module |
