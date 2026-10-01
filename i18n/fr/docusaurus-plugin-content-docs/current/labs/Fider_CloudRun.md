---
title: "Fider sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez Fider sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Fider_CloudRun.md @ 3055034 sha256:462682d89196 -->

# Fider sur Cloud Run — Guide de lab {#fider-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Fider_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Fider est un tableau open source et auto-hébergé de retours et de vote sur les fonctionnalités — les clients
publient des idées, votent et commentent, et vous priorisez votre feuille de route selon la demande. Ce lab
vous fait parcourir l'intégralité du cycle de vie opérationnel du module **Fider on Cloud Run**
sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer,
diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google
Cloud**, et non sur les fonctionnalités du produit Fider. Pour la liste complète des services
provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Fider_CloudRun) —
ce lab ne reprend volontairement pas ce détail, afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder au service et effectuer la configuration initiale du site et de l'administrateur de Fider.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et la
  base de données.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Cloud SQL, le NFS Filestore, Artifact
  Registry et les comptes de service partagés dont dépend ce module). Vous n'avez pas besoin
  de le déployer vous-même au préalable — la plateforme détecte automatiquement s'il
  existe déjà dans le projet cible et, sinon, le provisionne avant ce module
  (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que Owner du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Un accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Fider (Cloud Run)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue
   les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Fider_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état
   du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run, une base de données Cloud SQL (PostgreSQL 15)
   avec ses secrets Secret Manager (`JWT_SECRET` et le mot de passe de la base
   de données), un bucket de données Cloud Storage, un montage NFS Cloud Filestore pour
   les pièces jointes (activé par défaut), construit l'image de conteneur et exécute un
   job ponctuel d'initialisation de la base de données qui crée le rôle et la base de données
   `fider`. Les premiers déploiements prennent environ **20 à 35 minutes** (la création de Cloud SQL
   domine).

3. Une fois l'opération terminée, découvrez les ressources à l'aide de filtres indépendants des noms (pour que les
   commandes continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~fider" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est en bonne santé. Fider expose un point de terminaison `/_health` non authentifié
   qui renvoie `200` une fois que le serveur a démarré et exécuté ses migrations
   de schéma :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/_health"   # expect 200
   ```

   Prévoyez jusqu'à **~7 minutes** au premier démarrage — la sonde de démarrage accorde un délai initial
   de 30 secondes plus une fenêtre de 30 échecs à intervalles de 15 secondes pendant que
   `./fider migrate` s'exécute et que le serveur démarre.

2. Ouvrez `$SERVICE_URL` dans un navigateur. Il n'y a pas d'identifiants par défaut — la première
   visite vous guide dans la création du **site** et de son compte **propriétaire administrateur**.
   Effectuez cette étape immédiatement après le déploiement.

3. L'e-mail est désactivé pour la démonstration (`EMAIL_NOEMAIL = true`) ; les liens d'inscription et d'invitation
   sont donc écrits dans le journal du conteneur au lieu d'être envoyés. Consultez les journaux si vous
   invitez d'autres utilisateurs avant de raccorder un véritable serveur SMTP :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50 \
     | grep -i "sign-in\|invite"
   ```

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente en bonne santé) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances et en cliquant sur **Update** sur
   la page de détails du déploiement — le module est propriétaire de la spécification du service, la mise à l'échelle est donc
   une modification de configuration, et non une modification manuelle avec `gcloud` (une modification manuelle serait
   annulée lors du prochain apply). Fider n'a pas de processus d'arrière-plan ;
   `min_instance_count = 0` (mise à l'échelle jusqu'à zéro) est donc sans risque pour les données si vous préférez accepter
   un démarrage à froid en échange d'un coût plus faible ; la valeur par défaut `min=1` avec `cpu_always_allocated=true`
   le maintient au contraire constamment actif.

3. **Mettez à jour la version de l'application** en modifiant le paramètre `application_version`
   dans la plateforme RAD et en l'appliquant via **Update** ; une nouvelle image est construite et une
   nouvelle révision est déployée. Les migrations propres à Fider s'exécutent de nouveau au démarrage (idempotentes) ;
   aucune étape de migration distincte n'est donc nécessaire. Notez que `getfider/fider` n'a pas
   d'étiquette `:latest` — le module associe `latest` à `stable` ; fixez une étiquette SHA explicite
   pour des mises à niveau reproductibles.

4. **Gérez les secrets :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~fider"
   ```

   `JWT_SECRET` signe tous les jetons d'authentification et de session (y compris les liens
   de connexion magiques envoyés par e-mail) — **ne le renouvelez jamais après le premier démarrage** ; cela
   invaliderait chaque session active et chaque lien de connexion en attente.

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. fiderdemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^fider" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

6. **Vérifiez le job d'initialisation et le montage NFS :**

   ```bash
   gcloud run jobs list --project="$PROJECT" --region="$REGION"
   gcloud filestore instances list --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre du Logs Explorer :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.
   Lorsque l'e-mail est désactivé, les liens d'inscription et d'invitation apparaissent ici — c'est le comportement attendu,
   et non une erreur.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le
   nombre de requêtes, la latence des requêtes (P50/P95/P99), le nombre d'instances (comportement
   de mise à l'échelle) et l'utilisation du processeur et de la mémoire. Si un **test de disponibilité** est activé,
   vérifiez qu'il est au vert sous Monitoring → Uptime checks, et examinez
   Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas d'une version de Fider à l'autre.

- **Révision en mauvaise santé / le service ne répond pas :** inspectez la dernière révision et
  ses journaux à la recherche d'erreurs de démarrage, et vérifiez que les variables d'environnement et les secrets ont été résolus. Les
  sondes de démarrage et de vivacité ciblent `/_health` ; prévoyez jusqu'à ~7 minutes au premier
  démarrage pour `./fider migrate` plus le démarrage du serveur.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est `RUNNABLE`,
  que le secret du mot de passe de la base de données existe et que le job `db-init` s'est terminé avec succès
  (il crée de manière idempotente le rôle et la base de données `fider`, et peut être réexécuté sans risque).
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Page blanche / erreurs de type CSP ou « invalid origin » :** il s'agit d'un comportement connu de
  Cloud Run commun à toute la Foundation, et non d'un bogue de Fider — Cloud Run sert un
  service sous deux alias d'URL (la forme `predicted_service_url` avec le numéro de projet,
  injectée comme `BASE_URL`, et la forme `status.url` avec un suffixe aléatoire). Si vous
  naviguez vers l'alias qui ne correspond pas au `BASE_URL` avec lequel l'application a démarré,
  les contrôles stricts d'origine/CSP peuvent produire une page blanche. Vérifiez quelle URL la
  révision en cours a réellement injectée et utilisez-la systématiquement, ou définissez un
  `BASE_URL` personnalisé (par exemple derrière un équilibreur de charge / un domaine personnalisé) pour que les deux correspondent :
  ```bash
  gcloud run revisions describe "$(gcloud run revisions list --service="$SERVICE" \
    --project="$PROJECT" --region="$REGION" --format='value(name)' --limit=1)" \
    --project="$PROJECT" --region="$REGION" --format='value(spec.template.spec.containers[0].env)'
  ```
- **Échecs de montage liés au NFS :** vérifiez que la VM NFS Filestore partagée (gérée par
  `Services_GCP`) était à l'état `RUNNING` avant le déploiement de cette application ; un serveur NFS arrêté ou absent
  au moment du déploiement est une cause fréquente d'erreurs de montage du stockage.
  ```bash
  gcloud filestore instances list --project="$PROJECT"
  ```
- **Échec du job d'initialisation :** listez les exécutions et lisez les journaux de celle qui a échoué
  (même commande que dans la rubrique sur la base de données ci-dessus).
- **Échec du build de l'image :** consultez l'historique Cloud Build pour lire le journal du build en échec.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls & Sensible Defaults* du Guide de configuration
pour les pièges propres à chaque paramètre (notamment la règle essentielle de ne jamais renouveler
`JWT_SECRET` après le premier démarrage, et pourquoi `db_name`/`db_user` sont immuables après le
premier déploiement).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). La suppression retire tout ce que le module a créé — le service Cloud Run,
la base de données Cloud SQL, les secrets Secret Manager, les buckets GCS et les images
Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC, le Cloud SQL partagé, le NFS
Filestore, le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, Cloud SQL (PostgreSQL 15), les secrets, le bucket de stockage, le montage NFS, et exécute l'initialisation de la base de données |
| 2 — Accéder et vérifier | Manuel | Le contrôle de santé réussit ; créer le site et le propriétaire administrateur lors de la première visite |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l'échelle, mettre à jour la version, gérer les secrets, accéder à la base de données |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de base de données, de double alias d'URL, de NFS, de job d'initialisation et de build |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
