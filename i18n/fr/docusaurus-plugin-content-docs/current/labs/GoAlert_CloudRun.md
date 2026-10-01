---
title: "GoAlert sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez GoAlert sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/GoAlert_CloudRun.md @ 3055034 sha256:c589f65928de -->

# GoAlert sur Cloud Run — Guide de lab {#goalert-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/GoAlert_CloudRun)**

## Vue d’ensemble {#overview}

**Durée estimée :** 45 à 75 minutes

GoAlert est une plateforme open source de planification des astreintes et d’escalade des alertes
d’incident, conçue à l’origine par Target, avec des politiques d’escalade, des rotations/plannings
d’astreinte et l’envoi de notifications sortantes (e-mail, webhook et, en
option, SMS/appels vocaux Twilio). Ce lab vous fait parcourir le cycle de vie opérationnel
complet du module **GoAlert sur Cloud Run** sur Google Cloud : le déployer,
y accéder et le vérifier, l’exploiter au quotidien, l’observer, diagnostiquer les problèmes courants, puis
le supprimer.

Le lab porte sur l’exploitation du **module Cloud Run et de la plateforme Google
Cloud**, et non sur les fonctionnalités du produit GoAlert. Pour la liste complète des services
provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/GoAlert_CloudRun) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans la
durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu’il provisionne.
- Accéder au service en cours d’exécution et le vérifier, notamment en récupérant les identifiants
  administrateur créés à l’amorçage.
- Effectuer les opérations du jour 2 — inspecter, mettre à l’échelle, mettre à jour et gérer les secrets.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d’exécution les plus courants, y compris
  l’ordre des jobs d’initialisation, dont tout dépend.
- Supprimer proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Cloud SQL, Artifact Registry et les comptes
  de service partagés dont dépend ce module). Vous n’avez pas besoin de le déployer
  vous-même au préalable — la plateforme détecte automatiquement s’il existe déjà
  dans le projet cible et, sinon, le provisionne avant ce module (voir la tâche
  1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez en tant que Owner du projet les commandes qu’elle affiche, puis **Verify**) et d’attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l’un ni l’autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l’échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement, après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n’entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l’autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **GoAlert (Cloud Run)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s’ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou êtes partenaire ou administrateur), renseignez `project_id` et passez en revue
   les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/GoAlert_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Si vous déployez à côté d’une
   instance `GoAlert_GKE` dans le même projet, définissez `tenant_id = "cr"`
   (et `"gke"` sur le déploiement GKE) afin que les deux variantes n’entrent pas en collision sur les noms
   de ressources partagées. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu’elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d’un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d’état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run, une base de données Cloud SQL (PostgreSQL 17)
   avec ses secrets Secret Manager (mot de passe administrateur, clé de chiffrement des données
   et mot de passe de la base), construit l’image de conteneur personnalisée (Cloud Build
   compile le Dockerfile de `GoAlert_Common` autour de l’image officielle `goalert/goalert`),
   et exécute dans l’ordre la chaîne de jobs d’initialisation de la base en 3 étapes
   (`db-init` → `db-migrate` → `admin-bootstrap`). Un premier déploiement prend généralement
   environ **15 à 25 minutes** — la création de l’instance Cloud SQL représente l’essentiel du temps, et chaque
   exécution de job Cloud Run de la chaîne ajoute sa propre latence de planification (constatée
   en pratique à environ 2 minutes par job, rien que pour que Cloud Run le prenne en charge et
   l’exécute, en plus du travail propre du job).

3. Une fois le déploiement terminé, repérez les ressources à l’aide de filtres indépendants du nom (afin que les
   commandes continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~goalert" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est en bonne santé. GoAlert expose un point de terminaison public
   `/health`, sans authentification :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/health"   # expect 200
   ```

2. Récupérez les identifiants administrateur créés à l’amorçage. GoAlert n’a **aucun assistant de configuration
   à la première visite** — le seul compte existant est celui créé par le
   job d’initialisation `admin-bootstrap` au moment du déploiement :

   ```bash
   ADMIN_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~goalert AND name~admin-password" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$ADMIN_SECRET" --project="$PROJECT"
   ```

   Le nom d’utilisateur administrateur vaut `admin` par défaut (le paramètre `admin_username`), sauf
   s’il a été modifié.

3. Ouvrez `$SERVICE_URL` dans un navigateur et connectez-vous avec le nom d’utilisateur et le mot de passe
   récupérés ci-dessus.

---

## Tâche 3 — Exploiter et maintenir en fonctionnement (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspecter le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente en bonne santé) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettre à l’échelle** en modifiant les paramètres de nombre minimal/maximal d’instances puis en cliquant sur **Update** sur la
   page de détails du déploiement — le module est propriétaire de la spécification du service, la mise à l’échelle est donc une
   modification de configuration, et non une modification manuelle via `gcloud` (une modification manuelle serait
   annulée à l’application suivante). Conservez `min_instance_count >= 1` et
   `cpu_always_allocated = true` : GoAlert exécute en continu, dans le même processus, un moteur d’escalade
   qui doit rester actif pour évaluer les plannings et déclencher les vraies alertes — avec
   zéro instance, ou avec une facturation à la requête où le CPU est limité, les escalades peuvent
   être retardées ou manquées sans aucun signe visible.

3. **Mettre à jour le tag de version de l’application** en modifiant le paramètre de version dans la
   plateforme RAD et en l’appliquant via **Update** ; une nouvelle image est construite et la
   chaîne de jobs d’initialisation en 3 étapes s’exécute de nouveau (les trois jobs sont idempotents et peuvent être
   relancés sans risque — `db-init` utilise des vérifications de type `CREATE ... IF NOT EXISTS`, `db-migrate`
   n’applique que les migrations en attente, et `admin-bootstrap` détecte un
   utilisateur administrateur déjà existant et se termine proprement).

4. **Gérer les secrets :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~goalert"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"
   ```

5. **Ouvrir une session de base de données** pour l’inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. goalertdemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^goalert" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

6. **Définir l’URL publique pour les liens OIDC et de notification.** Ce module calcule automatiquement une
   URL `run.app` pour `GOALERT_PUBLIC_URL` lorsque `public_url` est laissé vide, cette
   étape est donc généralement inutile sur Cloud Run (contrairement à la variante GKE) — mais si vous
   placez le service derrière un domaine personnalisé ou un équilibreur de charge, définissez `public_url` sur
   cette adresse afin que les liens des notifications sortantes et les rappels OIDC soient résolus
   correctement.

7. **Gérer les plannings d’astreinte et les politiques d’escalade** — des opérations du jour 2 propres à
   GoAlert, effectuées dans l’interface web (Escalation Policies, Schedules,
   Rotations, Services) plutôt que via Terraform ; il s’agit de données applicatives GoAlert,
   et non d’infrastructure.

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l’explorateur de journaux (Logs Explorer) :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Cherchez une véritable ligne « listening and serving HTTP » confirmant que le serveur a bien
   ouvert son port. Filtre de l’explorateur de journaux :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le
   nombre de requêtes, la latence des requêtes, le nombre d’instances et l’utilisation du processeur et de la mémoire
   (attendez-vous à une consommation CPU de base constante et non nulle, puisque `cpu_always_allocated = true`).
   Le module peut provisionner un **test de disponibilité** (uptime check, lorsque
   `uptime_check_config.enabled = true` — la valeur par défaut est `false`) ; s’il est activé,
   vérifiez qu’il est au vert dans Monitoring → Uptime checks.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous risquez le plus de rencontrer. Il s’agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de GoAlert.

- **Révision en mauvaise santé / le service ne répond pas :** examinez la dernière révision et
  ses journaux pour repérer des erreurs de démarrage, et vérifiez que les variables d’environnement et les secrets ont été résolus. La
  sonde de démarrage est une sonde TCP sur le port du conteneur, avec un délai initial de 30 secondes
  et jusqu’à 30 tentatives (pour laisser le temps aux migrations du premier démarrage).
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l’instance Cloud SQL est `RUNNABLE` et que
  le secret du mot de passe de la base existe. Comme GoAlert n’accepte qu’une seule
  `GOALERT_DB_URL`, un échec de connexion provient souvent de la branche socket/TCP du point d’entrée
  qui résout le mauvais hôte — vérifiez les valeurs `DB_HOST`/`DB_IP` injectées
  dans la révision.
- **Échecs de migration — l’étape dont tout dépend.** Si `admin-bootstrap` échoue avec
  `relation "auth_basic_users" does not exist`, c’est que `db-migrate` ne s’est pas d’abord terminé
  avec succès. Consultez précisément les journaux de son exécution :
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-migrate" \
    --project="$PROJECT" --region="$REGION"
  gcloud run jobs executions logs read <execution-name> --project="$PROJECT" --region="$REGION"
  ```
  Relancez ensuite la chaîne dans l’ordre (`db-init` → `db-migrate` → `admin-bootstrap`) —
  chaque job est idempotent et peut être réexécuté manuellement sans risque via
  `gcloud run jobs execute <job-name>` si vous devez le forcer en dehors d’une
  application Terraform complète.
- **Le build de l’image a échoué :** consultez l’historique Cloud Build pour lire le journal du build en échec.
  Une cause fréquente lorsque vous reprenez le modèle de ce module pour une application similaire : le
  shell de l’image de base amont est BusyBox, et non GNU/bash — vérifiez que toute modification de script
  shell utilise une syntaxe portable (par ex. `sed 's/[?]/.../'`, et non `sed 's/\?/.../'`).
- **Erreurs 403 / d’autorisation :** vérifiez les rôles IAM du compte de service d’exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres à chaque
paramètre (notamment pourquoi `min_instance_count`/`cpu_always_allocated` doivent conserver
leurs valeurs par défaut pour que le moteur d’escalade de GoAlert fonctionne correctement).

---

## Tâche 6 — Supprimer [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l’icône **Trash**
(**Delete**). La suppression exécute `terraform destroy` et est irréversible (l’enregistrement du
déploiement est conservé pour l’historique). Si un déploiement est bloqué et que la plateforme RAD ne peut
plus le gérer (par exemple après des modifications manuelles en conflit avec
l’état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — elle retire le déploiement des
enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le
déploiement). Cela supprime tout ce que le module a créé — le service Cloud Run,
la base de données Cloud SQL, les secrets Secret Manager et les images Artifact Registry.
Les ressources appartenant à **Services_GCP** (le VPC, le Cloud SQL partagé, le registre) sont
gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, Cloud SQL (PostgreSQL 17), des secrets, et exécute la chaîne `db-init` → `db-migrate` → `admin-bootstrap` |
| 2 — Accéder et vérifier | Manuel | Le contrôle de santé réussit sur `/health` ; récupérer dans Secret Manager les identifiants administrateur créés à l’amorçage et se connecter |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l’échelle (en gardant le CPU toujours alloué), mettre à jour la version, gérer les secrets, accès à la base, gérer plannings/politiques d’escalade |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de base de données, d’ordre des migrations et de build |
| 6 — Supprimer | Automatisé | Delete (Trash) supprime toutes les ressources du module |
