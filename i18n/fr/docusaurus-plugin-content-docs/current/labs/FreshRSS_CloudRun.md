---
title: "FreshRSS sur Cloud Run — Guide de lab"
description: "Lab pratique : déployer FreshRSS sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, opérations, observabilité et suppression."
---

<!-- translated-from: docs/labs/FreshRSS_CloudRun.md @ 15fd4c7 sha256:bd82b2beb94a -->

# FreshRSS sur Cloud Run — Guide de lab {#freshrss-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/FreshRSS_CloudRun)**

## Vue d'ensemble {#overview}

**Temps estimé :** 45 à 90 minutes

FreshRSS est un agrégateur de flux RSS et Atom gratuit et auto-hébergé — un
« lecteur de nouvelles » léger et multi-utilisateur écrit en PHP qui expose les
API Google Reader et Fever pour les clients mobiles. Ce lab vous guide à travers
le cycle de vie opérationnel complet du module **FreshRSS sur Cloud Run** sur
Google Cloud : le déployer, y accéder et le vérifier, l'exécuter au quotidien,
l'observer, diagnostiquer les problèmes courants et le supprimer.

Le lab se concentre sur l'exploitation du **module Cloud Run et de la
plateforme Google Cloud**, et non sur les fonctionnalités du produit FreshRSS.
Pour la liste complète des services provisionnés et de chaque entrée de
configuration (organisée par groupe), consultez le [Guide de
configuration](https://docs.radmodules.dev/docs/modules/FreshRSS_CloudRun) — ce
lab ne duplique délibérément pas ce détail afin qu'il reste précis dans le
temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez capable de :

- Déployer le module depuis la plateforme RAD et localiser les ressources qu'il
  provisionne.
- Accéder et vérifier le service en cours d'exécution, y compris l'installation
  au premier démarrage et la connexion administrateur.
- Effectuer les opérations du deuxième jour — inspecter, mettre à l'échelle,
  mettre à jour et gérer les secrets et la base de données.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les
  plus courants.
- Supprimer proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Cloud SQL, le serveur NFS, Artifact
  Registry et les comptes de service partagés dont ce module dépend). Vous n'avez
  pas besoin de le déployer vous-même au préalable — la plateforme détecte
  automatiquement s'il existe déjà dans le projet cible et le provisionne avant
  ce module si ce n'est pas le cas (voir Tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
- Rôle IAM de **Propriétaire du projet** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement, la
  boîte de dialogue de confirmation du déploiement vous demande de prouver que
  vous le contrôlez (**Obtenir le code de vérification**, exécutez les
  commandes qu'elle affiche en tant que Propriétaire du projet, puis
  **Vérifier**) et de donner le rôle de **Propriétaire** au compte de service
  de déploiement RAD. Un projet créé par RAD pour vous n'a besoin ni de l'un ni
  de l'autre.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création
  ne demande que la première page d'entrées (et, dans un projet créé par RAD
  pour vous, guère plus que le nom du locataire et la région). Toutes les
  autres entrées du Guide de configuration — y compris les entrées de mise à
  l'échelle et de version dans les tâches du deuxième jour — sont modifiées
  ensuite avec **Mettre à jour** sur la page du déploiement après avoir coché
  **Activer le mode avancé**, ce qui nécessite un solde de crédits couvrant le
  coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais
  de frais de module). Dans un environnement de lab, seul un administrateur
  peut utiliser le mode avancé.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules
  dans le projet.

Définissez ces variables shell une fois ; chaque tâche ci-dessous les réutilise
:

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Catalogue de solutions → Modules
   RAD**, puis ouvrez **FreshRSS (Cloud Run)** depuis la liste **Modules de la
   plateforme**, choisissez **Formulaire de configuration** sous *Comment
   souhaitez-vous configurer ce déploiement ?* (le formulaire s'ouvre sur
   l'**Assistant conversationnel** si vous détenez des crédits achetés ou si
   vous êtes un partenaire ou un administrateur), définissez `project_id`, et
   examinez les entrées. Ne configurez que ce dont vous avez besoin — le [Guide
   de configuration](https://docs.radmodules.dev/docs/modules/FreshRSS_CloudRun)
   documente chaque entrée par groupe, avec les valeurs par défaut. Cliquez sur
   **Déployer le module**, examinez le coût estimé dans la boîte de dialogue
   **Confirmation de déploiement** lorsqu'elle apparaît et cliquez sur
   **Soumettre** (si la boîte de dialogue ajoute ensuite une étape de
   confirmation, comme la vérification d'un projet que vous apportez,
   complétez-la et cliquez sur **Confirmer**), ce qui ouvre la page d'état du
   déploiement avec les logs en temps réel.

2. La plateforme provisionne le service Cloud Run (PHP/Apache sur le port 80),
   une base de données Cloud SQL (PostgreSQL 15) et un utilisateur avec les
   secrets `FRESHRSS_ADMIN_PASSWORD` et le mot de passe de la base de données dans Secret
   Manager, un volume NFS monté à `/var/www/FreshRSS/data` (aucun bucket GCS n'est
   créé), construit l'image de conteneur personnalisée et exécute un job
   ponctuel `db-init`. Les premiers déploiements prennent environ **15 à 25
   minutes** (la création de Cloud SQL domine).

3. Une fois terminé, découvrez les ressources avec des filtres agnostiques au
   nom (afin que les commandes continuent de fonctionner quel que soit le
   suffixe de déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~freshrss" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Confirmez que le service est sain. FreshRSS sert un endpoint JSON non
   authentifié `/status` qui répond une fois le serveur démarré :

   ```bash
   curl -s "$SERVICE_URL/status"   # expect a JSON status response
   ```

2. Récupérez le mot de passe administrateur auto-généré de Secret Manager :

   ```bash
   ADMIN_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~freshrss AND name~ADMIN_PASSWORD" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$ADMIN_SECRET" --project="$PROJECT"
   ```

3. Ouvrez `$SERVICE_URL` dans un navigateur et connectez-vous avec le nom
   d'utilisateur `admin` et le mot de passe de l'étape 2. Lors de la
   première requête, le point d'entrée du conteneur exécute l'installateur de
   FreshRSS (`do-install.php` + `create-user.php`), alors prévoyez une fenêtre de
   premier démarrage généreuse avant que la page de connexion ne se stabilise —
   c'est idempotent et ne s'exécute qu'une seule fois. Après vous être
   connecté, **changez le mot de passe administrateur dans l'interface
   utilisateur de FreshRSS** — la rotation de la valeur de Secret Manager seule
   ne réinitialise pas un compte déjà installé.

---

## Tâche 3 — Opérer et maintenir en fonctionnement (Jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une
   révision immuable ; le trafic bascule vers la plus récente et saine) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** en modifiant les entrées d'instances min/max et en
   cliquant sur **Mettre à jour** sur la page des détails du déploiement — le
   module possède la spécification du service, donc la mise à l'échelle est un
   changement de configuration, pas une modification manuelle `gcloud` (une
   modification manuelle serait annulée lors du prochain apply). Par défaut
   `min_instance_count = 1` et `max_instance_count = 1`. Maintenez le minimum à `1` : le cron
   de rafraîchissement des flux dans le conteneur (`CRON_MIN = */15`) ne se déclenche
   que lorsqu'une instance est active, donc à `0` les flux cessent de
   se rafraîchir une fois que le service inactif est mis à l'échelle à zéro.
   Maintenez `max_instance_count` à `1` — une seule instance possède le cron de
   rafraîchissement et l'état de session/cache basé sur les fichiers sur le
   volume NFS.

3. **Mettez à jour la version de l'application** en modifiant l'entrée de
   version dans la plateforme RAD et en l'appliquant via **Mettre à jour** ;
   une nouvelle image est construite et une nouvelle révision est déployée.
   `application_version = "latest"` est épinglé à une balise connue et fonctionnelle au moment de la
   construction — épinglez-la explicitement pour la production.

4. **Gérez les secrets et la base de données :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~freshrss"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init (and import job, if enabled)
   gcloud sql backups list --instance=<instance-name> --project="$PROJECT"
   ```

5. **Ouvrez une session de base de données** pour l'inspection ou la
   maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. freshrssdemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^freshrss" --limit=1)
   DB_NAME=$(gcloud sql databases list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^freshrss" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --database="$DB_NAME" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : Journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Logs** — depuis la CLI ou l'Explorateur de logs :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre de l'Explorateur de logs : `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run pour le service et
   examinez le nombre de requêtes, la latence des requêtes (P50/P95/P99), le
   nombre d'instances (comportement de mise à l'échelle) et l'utilisation du
   CPU / de la mémoire. `uptime_check_config` est désactivé par défaut — activez-le et
   examinez Surveillance → Tests de disponibilité et Alertes → Règles si vous
   souhaitez des alertes de disponibilité automatisées.

---

## Tâche 5 — Dépannage et débogage [Manuel] {#task-5--troubleshoot--debug-manual}

Techniques durables pour les modes de défaillance que vous êtes le plus
susceptible de rencontrer. Ce sont des diagnostics au niveau de la plateforme
et ils ne changent pas avec les versions de FreshRSS.

- **Révision non saine / le service ne répond pas :** inspectez la dernière
  révision et ses logs pour les erreurs de démarrage. La sonde de démarrage est
  une vérification TCP sur le port 80 ; la sonde de vivacité est un HTTP GET
  sur `/` — une installation lente au premier démarrage (création de
  schéma) peut épuiser un seuil trop serré.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Erreurs de connexion à la base de données :** confirmez que l'instance
  Cloud SQL est `RUNNABLE`, que le secret du mot de passe de la base de
  données existe, `enable_cloudsql_volume = true` (socket Auth Proxy), et que le job
  `db-init` s'est terminé avec succès.
- **Le job `db-init` a échoué :** listez les exécutions et lisez les logs de
  celle qui a échoué :
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **La configuration/l'état se réinitialise à chaque démarrage à froid :**
  confirmez `enable_nfs = true` et `nfs_mount_path = /var/www/FreshRSS/data` ; sans le volume NFS,
  `config.php` et l'état par utilisateur vivent sur un disque éphémère et sont
  perdus à chaque démarrage à froid.
- **Les flux ne se rafraîchissent pas :** le cron dans le conteneur ne
  s'exécute que lorsqu'une instance est active — si `min_instance_count` a été abaissé à
  `0`, les rafraîchissements sont mis en pause jusqu'à ce que la
  prochaine requête réveille le service. Restaurez la valeur par défaut
  `min_instance_count = 1`.
- **La construction de l'image a échoué :** examinez l'historique de Cloud
  Build pour le log de la construction échouée.
- **Erreurs 403 / de permission :** vérifiez les rôles IAM du compte de
  service d'exécution.

Consultez la section *Pièges de configuration et valeurs par défaut judicieuses*
du Guide de configuration pour les pièges spécifiques aux paramètres (y compris
les règles critiques concernant `enable_nfs`, `database_type` et les
`db_name`/`db_user` immuables).

---

## Tâche 6 — Suppression [Automatisé] {#task-6--tear-down-automated}

Sur la page **Déploiements**, ouvrez le déploiement et cliquez sur l'icône
**Corbeille** (**Supprimer**). La suppression exécute `terraform destroy` et est
irréversible (l'enregistrement du déploiement est conservé pour l'historique).
Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par
exemple après des modifications manuelles qui entrent en conflit avec l'état
Terraform), utilisez plutôt **Purger** (depuis la même boîte de dialogue
**Supprimer**) — cela supprime le déploiement des enregistrements de RAD
**sans** détruire les ressources cloud (cela fait que RAD oublie le
déploiement). Cela supprime tout ce que le module a créé — le service Cloud Run,
la base de données et l'utilisateur Cloud SQL, les secrets Secret Manager et le
contenu du répertoire de données sauvegardé par NFS. Les ressources
appartenant à **Services_GCP** (le VPC, l'instance Cloud SQL partagée, le
serveur NFS partagé, le registre) sont gérées séparément et ne sont pas
supprimées ici.

---

## Résumé {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, Cloud SQL (PostgreSQL 15), les secrets, le volume NFS et exécute `db-init` |
| 2 — Accéder et vérifier | Manuel | `/status` répond ; connectez-vous en tant que `admin` avec le mot de passe généré et changez-le |
| 3 — Opérer | Manuel | Inspecter les révisions, mettre à l'échelle, mettre à jour la version, gérer les secrets/DB, ajuster le cron de rafraîchissement |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et (facultatif) le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de base de données, de `db-init`, de NFS et de cron de rafraîchissement |
| 6 — Supprimer | Automatisé | Supprimer (Corbeille) supprime toutes les ressources du module |
