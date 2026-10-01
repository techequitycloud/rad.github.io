---
title: "PostHog sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez PostHog sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/PostHog_GKE.md @ 3055034 sha256:7ccfa8b880d1 -->

# PostHog sur GKE Autopilot — Guide de lab {#posthog-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/PostHog_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 60–90 minutes

PostHog est une plateforme open source d'analyse produit — analyse d'événements, relecture de sessions,
feature flags, tests A/B et entonnoirs. Contrairement à la plupart des applications adossées à une base de données
de ce catalogue, le pipeline de données central de PostHog s'appuie sur **quatre** services avec état
indépendants (PostgreSQL, ClickHouse, Kafka et Redis), ce qui fait de ce lab une bonne
occasion de s'entraîner à diagnostiquer des défaillances de disponibilité impliquant plusieurs dépendances, et pas seulement une unique
connexion à une base de données. Ce lab vous fait parcourir tout le cycle de vie opérationnel du module
**PostHog on GKE Autopilot** : le déployer, y accéder et le vérifier, l'exploiter au quotidien,
l'observer, diagnostiquer les problèmes courants et le supprimer.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non sur les
fonctionnalités de PostHog. Pour la liste complète des services provisionnés et de chaque
paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/PostHog_GKE) — ce lab
ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE et accéder à la charge de travail en cours d'exécution.
- Distinguer les quatre dépendances obligatoires de PostHog (Postgres, ClickHouse, Kafka, Redis)
  et vérifier que chacune est joignable.
- Effectuer les opérations du jour 2 — inspecter, mettre à jour, et gérer les secrets et le stockage.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants, y compris
  les défaillances de disponibilité des dépendances propres à ce module.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Cloud SQL, Artifact
  Registry et les comptes de service partagés dont dépend ce module). Vous n'avez pas
  besoin de le déployer vous-même au préalable — la plateforme détecte
  automatiquement s'il existe déjà dans le projet cible et, sinon, le
  provisionne avant ce module (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` exécutés.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans ce projet, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne requiert ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Sur un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.
- Facultatif mais recommandé : `ClickHouse_GKE` déjà déployé si vous souhaitez exercer
  le chemin de production (ClickHouse externe) plutôt que la solution de repli intégrée de dev/test.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **PostHog (GKE)** dans la liste
   **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou êtes partenaire ou administrateur), définissez `project_id` et passez en revue les
   paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/PostHog_GKE) documente
   chaque paramètre par groupe, avec ses valeurs par défaut. Si vous disposez déjà d'une instance `ClickHouse_GKE`
   déployée, définissez `clickhouse_host` sur le DNS/l'IP de son Service interne pour un magasin
   d'événements de niveau production ; sinon, laissez `enable_inline_clickhouse = true` pour la solution de repli
   de dev/test intégrée. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme déploie la charge de travail dans le cluster GKE Autopilot, provisionne une base de données Cloud
   SQL (PostgreSQL 15) pour les métadonnées applicatives propres à Django, ses secrets
   Secret Manager (`SECRET_KEY`, la paire de clés HMAC d'interopérabilité S3 et le mot de passe de la base de données), un
   bucket Cloud Storage pour les données de relecture de sessions/d'export, construit l'image de conteneur
   personnalisée et exécute deux jobs ponctuels : `db-init` (crée le rôle et la base de données Postgres)
   et `clickhouse-migrate` (applique intégralement le schéma ClickHouse de PostHog avant le
   démarrage de l'application). Sauf si vous avez fourni un `clickhouse_host` externe, une instance ClickHouse
   à nœud unique et un broker Redpanda (Kafka) à nœud unique sont également déployés en tant que
   services compagnons. Un premier déploiement prend environ **25 à 40 minutes** — la création de Cloud SQL
   et la migration du schéma ClickHouse prennent toutes deux un temps réel.

3. Connectez-vous au cluster et identifiez l'espace de noms avec des filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep posthog | head -1 | cut -d/ -f2)
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

2. Vérifiez que le service est réellement sain. `/_readyz` effectue des contrôles approfondis des dépendances
   sur les quatre magasins de données — il ne renverra pas 200 tant que les migrations Postgres,
   ClickHouse, Kafka, le broker Celery et le cache ne sont pas tous joignables :

   ```bash
   curl -s "http://${EXTERNAL_IP}/_readyz"    # expect: {"clickhouse": true, "postgres": true, ...}
   curl -s "http://${EXTERNAL_IP}/_livez"     # expect: {"http": true}
   ```

   La sonde de démarrage accorde une fenêtre généreuse (~25 minutes) pour que ce contrôle réussisse au premier
   démarrage — l'historique complet des migrations de Django ainsi que la séquence d'import du worker+beat Celery
   colocalisés prennent un temps réel. Si `/_readyz` renvoie un `false` partiel pour une dépendance,
   voir la tâche 5.

3. Ouvrez `http://${EXTERNAL_IP}` dans un navigateur. Lors de la première visite, PostHog vous invite à
   créer le compte administrateur initial et l'organisation — aucun identifiant administrateur
   prédéfini n'existe dans Secret Manager. Remplissez le formulaire d'inscription pour atteindre le tableau de bord.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — déploiement, pods et services compagnons (ClickHouse/Kafka,
   si vous utilisez la solution de repli intégrée) :

   ```bash
   kubectl get deploy,pods -n "$NS"
   kubectl describe deploy -n "$NS"
   kubectl get pods -n "$NS" -l app --show-labels | grep -E 'clickhouse|kafka'
   ```

2. **La mise à l'échelle** est volontairement limitée : `max_instance_count` est plafonné à `1` — le
   conteneur principal colocalise le worker Celery avec son planificateur beat, si bien qu'exécuter
   plusieurs réplicas déclencherait chaque tâche périodique plusieurs fois. Il n'y a aucune modification
   de configuration de mise à l'échelle à effectuer ici ; la capacité se gère plutôt via `cpu_limit`/`memory_limit`.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme RAD
   et en l'appliquant via **Update** ; une nouvelle image est construite et une mise à jour progressive remplace le
   pod. `posthog/posthog` publie une balise `latest` réellement à jour, si bien que laisser la
   version à `latest` et relancer un build récupère la version amont la plus récente.

4. **Gérez les secrets, le stockage et les jobs :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~posthog"
   kubectl get jobs -n "$NS"          # db-init and clickhouse-migrate
   ```

5. **Ouvrez une session de base de données** pour inspecter les métadonnées applicatives propres à Django (et non les données d'analyse
   — celles-ci se trouvent dans ClickHouse) :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. posthogdemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^posthog" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

6. **Interrogez directement ClickHouse** pour inspecter le magasin d'événements réel :

   ```bash
   kubectl exec -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" -- \
     sh -c 'echo "SELECT count() FROM events" | curl -s "http://$CLICKHOUSE_HOST:8123/?database=$CLICKHOUSE_DATABASE" --data-binary @-'
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer). Les premières lignes d'un démarrage sain montrent
   la configuration résolue par le point d'entrée cloud (DSN masqués) :

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=100 | grep -A6 cloud-entrypoint
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation CPU et mémoire
   des pods (le premier démarrage de PostHog est réellement gourmand en CPU/mémoire — consultez le tableau des pièges
   du Guide de configuration pour les seuils de dimensionnement que ce module applique par défaut),
   le nombre de redémarrages et les métriques de requêtes. Le module peut provisionner un **test de disponibilité** (uptime check)
   (lorsqu'il est activé) ; consultez Monitoring → Uptime checks et Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Ce sont
des diagnostics au niveau de la plateforme et propres au module, qui ne changent pas avec les versions de PostHog.

- **Pod non prêt, `/_readyz` bloqué sur une dépendance :** le corps de la réponse indique quel
  contrôle échoue (`clickhouse`, `postgres`, `celery_broker`, `cache`) — allez directement à
  cette dépendance au lieu de deviner :
  ```bash
  curl -s "http://${EXTERNAL_IP}/_readyz" | python3 -m json.tool
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from a crashed container
  ```
- **Pod prêt mais CPU bloqué près de 100 % sans plantage apparent :** il s'agit très probablement de la
  situation connue d'absence du Node plugin server (voir le Guide de configuration) si vous
  exécutez une version du module antérieure au correctif `docker-boot.sh`, ou sinon d'un `cpu_limit`
  réellement sous-dimensionné pendant le premier démarrage — `kubectl top pod` montrera
  une saturation soutenue dans les deux cas.
  ```bash
  kubectl top pod -n "$NS"
  ```
- **Le job d'initialisation `clickhouse-migrate` a échoué ou boucle en plantage :** inspectez-le directement — c'est
  le job qui doit se terminer avant que l'application principale puisse réussir le contrôle ClickHouse de `/_readyz` :
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/clickhouse-migrate
  ```
- **Erreurs de connexion à la base de données (Postgres) :** vérifiez que l'instance Cloud SQL est
  `RUNNABLE`, que le secret du mot de passe de la base de données a été matérialisé dans l'espace de noms et que `db-init`
  s'est terminé.
- **ClickHouse injoignable :** si vous utilisez un `clickhouse_host` externe, vérifiez la connectivité
  réseau et que `clickhouse_password_secret` (s'il est défini) correspond au mot de passe réel de
  l'instance cible. Si vous utilisez la solution de repli intégrée, vérifiez que le
  pod `<service>-clickhouse` s'exécute et consultez ses propres journaux à la recherche d'erreurs de fusion de configuration.
- **Kafka injoignable :** vérifiez que le pod `<service>-kafka` (solution de repli intégrée) s'exécute ;
  une utilisation mémoire soutenue proche de la limite relevée par `kubectl top pod` peut indiquer que le broker est
  sous-dimensionné pour le volume d'ingestion.
- **Erreurs de connexion à Redis :** vérifiez que `enable_redis = true` et que soit `redis_host` est
  défini, soit `enable_nfs = true` — le garde-fou de validation au moment du plan aurait déjà dû détecter
  une combinaison manquante, mais un `redis_host` fourni manuellement et injoignable
  échouera silencieusement au moment de la connexion.
- **Pod en attente / aucune IP externe :** consultez les événements de `kubectl describe pod` à la recherche de problèmes de ressources ou de
  quota, et vérifiez que le Service LoadBalancer a reçu une IP.
- **Erreurs de récupération d'image :** vérifiez que l'image construite sur mesure existe dans Artifact Registry et que
  le compte de service des nœuds peut la récupérer.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre, notamment les règles critiques concernant `max_instance_count`, la rotation de `SECRET_KEY`
et l'épinglage de la balise d'image ClickHouse.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash**
(**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement
est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus
le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez
plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — elle retire le déploiement des enregistrements de RAD **sans** détruire
les ressources cloud (RAD oublie simplement le déploiement). La suppression retire tout ce que le module
a créé — la charge de travail Kubernetes et son espace de noms (y compris les services compagnons ClickHouse/Kafka
intégrés, s'ils sont utilisés), la base de données Cloud SQL, les secrets Secret Manager, le bucket GCS et
les images Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC, le cluster GKE,
le Cloud SQL partagé, le registre) — ainsi qu'un `ClickHouse_GKE` déployé séparément, si vous avez utilisé le
chemin externe — sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie la charge de travail GKE, Cloud SQL (PostgreSQL 15), les secrets, le bucket de stockage, et exécute `db-init` + `clickhouse-migrate` |
| 2 — Accéder et vérifier | Manuel | Se connecter au cluster ; `/_readyz` confirme que les quatre dépendances (Postgres, ClickHouse, Kafka, Redis) sont joignables ; créer le compte administrateur initial dans l'interface |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, mettre à jour la version, gérer les secrets et le stockage, interroger directement Postgres et ClickHouse |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les défaillances de disponibilité par dépendance, ainsi que les problèmes de job d'initialisation, de planification et de récupération d'image |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
