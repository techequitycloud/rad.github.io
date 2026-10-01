---
title: "ClickHouse sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez ClickHouse sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/ClickHouse_GKE.md @ 3055034 sha256:1d0eae915ee3 -->

# ClickHouse sur GKE Autopilot — Guide de lab {#clickhouse-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/ClickHouse_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 30–60 minutes

ClickHouse est une base de données OLAP open source (Apache-2.0) orientée colonnes, destinée à l'analytique
en temps réel. Ce module la déploie sous la forme d'un **StatefulSet à nœud unique sur GKE Autopilot** —
c'est le magasin d'événements obligatoire du module Plausible Analytics (`Plausible_GKE`) :
la base PostgreSQL de Plausible ne contient que les comptes et la configuration, tandis que chaque événement
analytique réside dans cette instance ClickHouse.

Ce lab vous guide dans le déploiement du module, la connexion et l'interrogation avec
`clickhouse-client` et `curl` à l'aide du mot de passe stocké dans Secret Manager, les opérations du jour 2
qui comptent pour une base de données avec état (journaux, redémarrage, vérification de la persistance, épinglage
de version), puis la suppression. Pour la liste complète des services provisionnés et de chaque
paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/ClickHouse_GKE) — ce
lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Récupérer dans Secret Manager le mot de passe ClickHouse généré automatiquement et interroger le
  serveur en HTTP (`curl`) et avec le client natif `clickhouse-client`.
- Effectuer les opérations du jour 2 — lire les journaux, redémarrer le pod, prouver la persistance du PVC et
  comprendre l'épinglage de version.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Artifact Registry
  et les comptes de service partagés dont dépend ce module). Vous n'avez pas besoin
  de le déployer vous-même au préalable — la plateforme détecte automatiquement s'il
  existe déjà dans le projet cible et, sinon, le provisionne avant ce module (voir la
  tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` exécutés.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans ce projet, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne requiert ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Sur un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **ClickHouse (GKE)** dans
   la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou êtes partenaire ou administrateur), définissez `project_id` et passez en revue
   les paramètres. Les valeurs par défaut sont adaptées à la production : un StatefulSet avec un PVC de 30 GiB sur
   `/var/lib/clickhouse` (`stateful_pvc_enabled = true` par défaut — inutile de le définir),
   une image épinglée `24.12-alpine` (`"latest"` est rejeté au moment du plan), une base de données
   `plausible_events_db` et un utilisateur `plausible` initialisés, et le mode à nœud unique
   (`max_instance_count = 1`, imposé au moment du plan). Sur les projets dont le quota d'IP statiques
   externes globales est plafonné, lorsque le seul consommateur se trouve dans le cluster (Plausible dans le même
   cluster), définissez `service_type = "ClusterIP"`, `reserve_static_ip = false` et
   `enable_custom_domain = false` afin que la base de données ne consomme aucune IP statique externe globale.
   Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre
   la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme réplique l'image `clickhouse/clickhouse-server` dans Artifact
   Registry, génère le mot de passe de l'utilisateur ClickHouse dans Secret Manager et déploie
   le StatefulSet. Il n'y a pas de job d'initialisation de base de données — l'image initialise elle-même la base
   et l'utilisateur au premier démarrage sur le répertoire de données vide. Sur un cluster Autopilot
   neuf, comptez jusqu'à **~10 minutes** avant que le pod soit Ready (provisionnement des nœuds +
   rattachement du PVC + récupération de l'image ; la sonde de démarrage est dimensionnée précisément pour cela).

3. Connectez-vous au cluster et identifiez les ressources avec des filtres indépendants des noms :

   ```bash
   gcloud container clusters list --project "$PROJECT"
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   kubectl get statefulset,pvc,svc -A | grep clickhouse
   NS=$(kubectl get ns -o name | grep clickhouse | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all,pvc -n "$NS"
   ```

   Vérifiez que le StatefulSet affiche `1/1`, que le PVC est `Bound` et que le Service
   LoadBalancer dispose d'une IP externe sur le port **8123**.

---

## Tâche 2 — Se connecter et interroger [Manuel] {#task-2--connect--query-manual}

1. Récupérez les éléments de connexion — l'IP du LoadBalancer et le mot de passe
   généré automatiquement dans Secret Manager :

   ```bash
   CH_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')

   gcloud secrets list --project "$PROJECT" --filter="name~clickhouse-password"
   CH_SECRET=$(gcloud secrets list --project "$PROJECT" \
     --filter="name~clickhouse-password" --format="value(name)" --limit=1)
   CH_PASS=$(gcloud secrets versions access latest --secret="$CH_SECRET" --project "$PROJECT")
   echo "Endpoint: http://$CH_IP:8123"
   ```

2. Vérifiez la disponibilité et l'authentification en HTTP :

   ```bash
   curl -s "http://$CH_IP:8123/ping"            # expect: Ok.
   curl -s "http://$CH_IP:8123/ping" | wc -c    # expect: non-zero (a 200 with an empty body is a failure)
   echo "SELECT version()" | curl -s "http://$CH_IP:8123/" --user "plausible:$CH_PASS" --data-binary @-
   echo "SHOW DATABASES" | curl -s "http://$CH_IP:8123/" --user "plausible:$CH_PASS" --data-binary @-
   ```

   Vérifiez le **corps** de la réponse, et pas seulement le code d'état — `/ping` doit renvoyer
   littéralement `Ok.`, et le décompte `wc -c` doit être non nul (un 200 avec `content-length: 0`
   est un véritable mode de défaillance). `SHOW DATABASES` doit lister `plausible_events_db` — la base de données que l'image
   a initialisée au premier démarrage. Un mot de passe erroné renvoie une erreur d'authentification
   (code 516) : le point de terminaison n'est jamais ouvert, car le module génère et
   injecte toujours `CLICKHOUSE_PASSWORD`.

3. Interrogez avec le client natif (fourni dans l'image — aucune installation locale nécessaire) :

   ```bash
   POD=$(kubectl get pods -n "$NS" -o name | grep clickhouse | head -1 | cut -d/ -f2)
   kubectl exec -n "$NS" -it "$POD" -- \
     clickhouse-client --user plausible --password "$CH_PASS" \
     --query "SELECT currentUser(), version()"
   ```

4. Créez une table et insérez une ligne — elle servira aussi de marqueur de persistance pour
   la tâche 3 (l'utilisateur initialisé peut gérer les bases de données et les tables car le module
   définit `CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT=1`) :

   ```bash
   cat <<'SQL' | curl -s "http://$CH_IP:8123/" --user "plausible:$CH_PASS" --data-binary @-
   CREATE TABLE IF NOT EXISTS plausible_events_db.lab_check
     (id UInt32, note String, ts DateTime DEFAULT now())
     ENGINE = MergeTree ORDER BY id
   SQL

   echo "INSERT INTO plausible_events_db.lab_check (id, note) VALUES (1, 'survives-restart')" \
     | curl -s "http://$CH_IP:8123/" --user "plausible:$CH_PASS" --data-binary @-

   echo "SELECT * FROM plausible_events_db.lab_check" \
     | curl -s "http://$CH_IP:8123/" --user "plausible:$CH_PASS" --data-binary @-
   ```

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Journaux** — le journal du serveur ClickHouse est envoyé vers stdout et Cloud Logging :

   ```bash
   kubectl logs -n "$NS" "$POD" --tail=50
   gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NS"'"' \
     --project "$PROJECT" --limit 20
   ```

2. **Redémarrage et vérification de la persistance du PVC** — supprimez le pod ; le StatefulSet le recrée
   sur le **même** PVC, la ligne de la tâche 2 doit donc survivre :

   ```bash
   kubectl delete pod -n "$NS" "$POD"
   kubectl get pods -n "$NS" -w        # wait for 1/1 Running (Ctrl-C to stop)

   echo "SELECT * FROM plausible_events_db.lab_check" \
     | curl -s "http://$CH_IP:8123/" --user "plausible:$CH_PASS" --data-binary @-
   # expect: 1  survives-restart  <timestamp>
   ```

   C'est la propriété qui justifie l'existence même du module : les événements analytiques survivent
   aux redémarrages, aux mises à jour et aux évictions de nœuds. C'est la perte du PVC — et non celle du pod — qui fait perdre
   des données. Profitez-en pour vérifier aussi la marge disque (les fusions en arrière-plan ont temporairement
   besoin d'espace supplémentaire) :

   ```bash
   kubectl exec -n "$NS" "$POD" -- df -h /var/lib/clickhouse
   ```

3. **Épinglage de version** — comparez ce qui s'exécute réellement avec ce qui a été configuré :

   ```bash
   echo "SELECT version()" | curl -s "http://$CH_IP:8123/" --user "plausible:$CH_PASS" --data-binary @-
   kubectl get statefulset -n "$NS" -o jsonpath='{.items[0].spec.template.spec.containers[0].image}'; echo
   ```

   Le tag de l'image correspond à `application_version`, qui vaut par défaut le tag éprouvé épinglé par Plausible,
   `24.12-alpine` — et `"latest"` est rejeté au moment du plan, car
   Plausible CE épingle la version de ClickHouse et des versions non testées l'ont déjà cassé en amont
   (plausible/analytics#3855). Pour changer de version, définissez un tag explicite dans la plateforme
   RAD et cliquez sur **Update** — et traitez-le comme une modification à valider avec votre
   version de Plausible, pas comme une montée de version de routine. Ne modifiez pas l'image avec `kubectl edit` ; le module
   possède la spécification de la charge de travail et l'annulerait lors de la prochaine application.

4. **Passage de relais à Plausible** — les sorties du déploiement sont exactement ce que
   `Plausible_GKE` consomme : `clickhouse_internal_endpoint` (à privilégier, même cluster)
   ou `clickhouse_endpoint` comme `clickhouse_url`, et `clickhouse_password_secret_id`
   comme `clickhouse_password_secret`. Déployez d'abord ClickHouse, puis Plausible —
   les migrations de Plausible créent le schéma des événements dans `plausible_events_db`.

5. **Nettoyage facultatif de la table du lab :**

   ```bash
   echo "DROP TABLE plausible_events_db.lab_check" \
     | curl -s "http://$CH_IP:8123/" --user "plausible:$CH_PASS" --data-binary @-
   ```

---

## Tâche 4 — Démanteler [Automatisé] {#task-4--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash**
(**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement
du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut
plus le gérer (par exemple après des modifications manuelles en conflit avec l'état
Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — elle retire le déploiement des enregistrements de RAD
**sans** détruire les ressources cloud. La suppression retire tout ce que le module a
créé — le StatefulSet, l'espace de noms, **le PVC et toutes les données d'événements**, le secret
de mot de passe Secret Manager et les images Artifact Registry répliquées. Si un déploiement Plausible
consomme cette instance, supprimez ou redirigez d'abord Plausible — son historique
d'événements réside ici. Les ressources appartenant à **Services_GCP** (le VPC, le cluster GKE,
le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | StatefulSet ClickHouse à nœud unique avec un PVC de 30 GiB, un LoadBalancer sur 8123 et un mot de passe géré par Secret Manager |
| 2 — Se connecter et interroger | Manuel | Ping, authentification et requêtes via `curl` et `clickhouse-client` avec le mot de passe de Secret Manager ; création d'une ligne marqueur |
| 3 — Exploiter | Manuel | Lire les journaux, redémarrer le pod, prouver que la ligne marqueur survit (persistance du PVC), vérifier l'épinglage de la version 24.12-alpine |
| 4 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module, y compris le PVC et ses données |
