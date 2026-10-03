---
title: "InvenTree sur Cloud Run — Guide de lab"
description: "Lab pratique : déployer InvenTree sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, opérations, observabilité et suppression."
---

<!-- translated-from: docs/labs/InvenTree_CloudRun.md @ 2829548 sha256:ddc7abaa8532 -->

# InvenTree sur Cloud Run — Guide de lab {#inventree-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/InvenTree_CloudRun)**

## Vue d'ensemble {#overview}

**Temps estimé :** 45 à 90 minutes

InvenTree est un système de gestion des stocks open source — pièces, lieux de
stockage, fournisseurs, nomenclatures, et commandes d'achat et de vente. Ce lab
vous guide à travers le cycle de vie opérationnel complet du module
**InvenTree sur Cloud Run** sur Google Cloud : le déployer, y accéder et le
vérifier, l'exécuter au quotidien, l'observer, diagnostiquer les problèmes
courants et le supprimer.

Le lab se concentre sur l'exploitation du **module Cloud Run et de la
plateforme Google Cloud**, et non sur les fonctionnalités du produit InvenTree.
Pour la liste complète des services provisionnés et de chaque entrée de
configuration (organisée par groupe), consultez le [Guide de
configuration](https://docs.radmodules.dev/docs/modules/InvenTree_CloudRun) — ce
lab ne duplique délibérément pas ce détail afin qu'il reste précis au fil du
temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez capable de :

- Déployer le module depuis la plateforme RAD et localiser les ressources qu'il
  provisionne.
- Atteindre le service sur l'URL qu'InvenTree accepte, et vérifier qu'il est
  sain.
- Confirmer la révision à deux conteneurs (web + `qcluster` worker) et la chaîne de
  jobs `db-init` → `migrate`.
- Effectuer les opérations du deuxième jour — inspecter, mettre à l'échelle,
  mettre à jour et gérer le répertoire de données et les sauvegardes.
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
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
- Rôle IAM de **Propriétaire du projet** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement, la
  boîte de dialogue de confirmation du déploiement vous demande de prouver que
  vous le contrôlez (**Obtenir le code de vérification**, exécuter les
  commandes qu'elle affiche en tant que Propriétaire du projet, puis
  **Vérifier**) et de donner le rôle **Propriétaire** au compte de service de
  déploiement RAD. Un projet créé par RAD pour vous n'a besoin de rien de tout
  cela.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création
  ne demande que la première page d'entrées (et, dans un projet que RAD crée
  pour vous, guère plus que le nom du locataire et la région). Toutes les
  autres entrées du Guide de configuration — y compris les entrées de mise à
  l'échelle, de stockage et de version dans les tâches du deuxième jour — sont
  modifiées par la suite avec **Mettre à jour** sur la page du déploiement
  après avoir coché **Activer le mode avancé**, ce qui nécessite un solde de
  crédits couvrant le coût de build estimé de la mise à jour (les mises à jour
  n'entraînent jamais de frais de module). Dans un environnement de lab, seul
  un administrateur peut utiliser le mode avancé.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules
  dans le projet.

Définissez ces variables shell une fois ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Catalogue de solutions → Modules
   RAD**, puis ouvrez **InvenTree (Cloud Run)** depuis la liste **Modules de
   plateforme**, choisissez **Formulaire de configuration** sous *Comment
   souhaitez-vous configurer ce déploiement ?* (le formulaire s'ouvre sur
   l'**Assistant conversationnel** si vous détenez des crédits achetés ou si
   vous êtes un partenaire ou un administrateur), définissez `project_id`, et
   examinez les entrées. Ne configurez que ce dont vous avez besoin — le [Guide
   de configuration](https://docs.radmodules.dev/docs/modules/InvenTree_CloudRun)
   documente chaque entrée par groupe, avec les valeurs par défaut. Cliquez sur
   **Déployer le module**, examinez le coût estimé dans la boîte de dialogue
   **Confirmation du déploiement** lorsqu'elle apparaît et cliquez sur
   **Soumettre** (si la boîte de dialogue ajoute ensuite une étape de
   confirmation, comme la vérification d'un projet que vous apportez,
   complétez-la et cliquez sur **Confirmer**), ce qui ouvre la page d'état du
   déploiement avec les logs en temps réel.

2. La plateforme provisionne le service Cloud Run (un conteneur web plus un
   sidecar worker `qcluster`), une base de données Cloud SQL (MySQL 8.0) avec
   son mot de passe dans Secret Manager, deux buckets Cloud Storage, construit
   l'image de conteneur personnalisée (en encapsulant `inventree/inventree`), et exécute
   la chaîne d'initialisation : `db-init` (base de données, utilisateur,
   autorisations) suivie de `migrate` (migrations Django). Les premiers
   déploiements prennent environ **20 à 35 minutes** (la création de Cloud
   SQL, la construction de l'image et les migrations dominent).

3. Une fois terminé, découvrez les ressources avec des filtres agnostiques au
   nom (afin que les commandes continuent de fonctionner quel que soit le
   suffixe de déploiement). Construisez l'URL **numéro-de-projet** — InvenTree
   rejette l'URL sous forme de hachage que `status.url` rapporte (voir Tâche 2) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~inventree" --format="value(metadata.name)" --limit=1)
   PROJECT_NUMBER=$(gcloud projects describe "$PROJECT" --format="value(projectNumber)")
   SERVICE_URL="https://${SERVICE}-${PROJECT_NUMBER}.${REGION}.run.app"
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

   La même URL est la sortie `service_url` du déploiement.

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Confirmez que le service est sain. Le chemin racine redirige vers l'interface
   utilisateur web — attendez-vous à un **HTTP 302** :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"   # expect 302
   ```

2. Voyez pourquoi l'URL est importante. L'URL sous forme de hachage que Cloud
   Run annonce également ne correspond pas à `INVENTREE_SITE_URL`, et InvenTree y répond
   par une erreur (`INVE-E7`) :

   ```bash
   HASH_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   curl -s -o /dev/null -w "%{http_code}\n" "$HASH_URL/"      # expect 500
   ```

   Distribuez `$SERVICE_URL` (ou un domaine personnalisé) — jamais la forme de
   hachage.

3. Confirmez que la révision exécute deux conteneurs — le conteneur web et le
   sidecar `qcluster` :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
     --format="value(spec.template.spec.containers[].name)"
   ```

4. Confirmez que la chaîne d'initialisation a été exécutée et que le schéma
   existe. Le job `migrate` logue le nombre de tables qu'il a trouvées
   (`[migrate] tables present: N`) et échoue s'il y en a moins de 10 :

   ```bash
   gcloud run jobs list --project="$PROJECT" --region="$REGION" --filter="metadata.name~inventree"
   gcloud logging read "resource.type=\"cloud_run_job\" AND textPayload:\"[migrate]\"" \
     --project="$PROJECT" --limit=10 --format="value(textPayload)"
   ```

5. Ouvrez `$SERVICE_URL` dans un navigateur. Le module ne crée **aucun** compte
   InvenTree (l'entrée `admin_email` n'est pas utilisée). Pour vous connecter,
   créez vous-même le premier superutilisateur — par exemple avec les propres
   paramètres `INVENTREE_ADMIN_USER` / `INVENTREE_ADMIN_EMAIL` / `INVENTREE_ADMIN_PASSWORD`
   d'InvenTree (voir la documentation InvenTree), ajoutés via `environment_variables` et
   appliqués avec **Mettre à jour**. Une clé nommée de manière
   crédentielle, telle que `INVENTREE_ADMIN_PASSWORD`, est automatiquement déplacée dans Secret
   Manager.

---

## Tâche 3 — Opérer et maintenir en fonctionnement (Jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une
   révision immuable ; le trafic bascule vers la plus récente et saine) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Rendez le répertoire de données persistant.** Par défaut, le répertoire de
   données d'InvenTree (`/home/inventree/data` : médias, plugins, `config.yaml`, la clé
   secrète générée) se trouve sur le système de fichiers du conteneur et est
   perdu à chaque démarrage à froid. Pour tout déploiement que vous avez
   l'intention de conserver, définissez `enable_nfs = true` et `nfs_mount_path = "/home/inventree/data"` et
   cliquez sur **Mettre à jour**. Les deux sont nécessaires — NFS au chemin par
   défaut monte un répertoire qu'InvenTree n'utilise jamais.

3. **Mettre à l'échelle** en modifiant les entrées d'instances min/max et en
   cliquant sur **Mettre à jour** sur la page des détails du déploiement — le
   module possède la spécification du service, donc la mise à l'échelle est un
   changement de configuration, pas une modification manuelle de `gcloud` (une
   modification manuelle serait annulée lors du prochain apply). Définissez
   `min_instance_count = 1` si le travail planifié est important : tant que le service est
   mis à l'échelle à zéro, le worker `qcluster` ne fonctionne pas non plus.

4. **Mettre à jour la version de l'application** en changeant `application_version` pour
   une balise exacte dans la plateforme RAD et en l'appliquant via **Mettre à
   jour** ; une nouvelle image construit `FROM inventree/inventree:<version>` et le job `migrate`
   applique toutes les nouvelles migrations avant que la nouvelle révision ne
   soit déployée.

5. **Gérer les secrets et les sauvegardes :**

   ```bash
   gcloud secrets list --project="$PROJECT"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # init + scheduled backup jobs
   ```

6. **Ouvrir une session de base de données** pour inspection ou maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # User and database are tenant-prefixed — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^inventree" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : Journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Logs** — depuis la CLI ou l'Explorateur de logs. Les deux conteneurs
   loguent dans le même service ; la ligne de démarrage du conteneur web lit
   `[startup] InvenTree site=… db=…` :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre de l'Explorateur de logs : `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run pour le service et
   examinez le nombre de requêtes, la latence des requêtes, le nombre
   d'instances (comportement de mise à l'échelle) et l'utilisation du CPU / de
   la mémoire. Le **test de disponibilité** du module est désactivé par défaut
   (`uptime_check_config.enabled = false`) ; activez-le avec **Mettre à jour** si vous en voulez un,
   puis confirmez qu'il est vert sous Surveillance → Tests de disponibilité et
   examinez Alertes → Règles.

---

## Tâche 5 — Dépannage et débogage [Manuel] {#task-5--troubleshoot--debug-manual}

Techniques durables pour les modes de défaillance que vous êtes le plus
susceptible de rencontrer. Ce sont des diagnostics au niveau de la plateforme et
ils ne changent pas avec les versions d'InvenTree.

- **HTTP 500 avec `INVE-E7` dans les logs :** la requête a utilisé un hôte
  autre que `INVENTREE_SITE_URL` — presque toujours l'URL `*.a.run.app` sous forme de
  hachage. Utilisez l'URL numéro-de-projet (sortie `service_url`) ou un domaine
  personnalisé.
- **Révision non saine / le service ne répond pas :** inspectez la dernière
  révision et ses logs pour les erreurs de démarrage. Le point d'entrée refuse
  de démarrer si `INVENTREE_SITE_URL`/`CLOUDRUN_SERVICE_URL` ou l'une des variables
  `DB_IP`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` est
  manquante, et nomme la variable manquante. Une défaillance dans le sidecar
  `qcluster` fait également échouer toute la révision.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Tout le monde est déconnecté / les téléchargements disparaissent après
  l'inactivité :** le répertoire de données n'est pas persistant — voir Tâche
  3, étape 2.
- **`Database Migrations required` ou tables manquantes :** le job `migrate` n'a pas
  été terminé. Lisez ses logs d'exécution :
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  gcloud run jobs executions list --job="${SERVICE}-migrate" \
    --project="$PROJECT" --region="$REGION"
  ```
  Si le schéma a été laissé à moitié appliqué, la réexécution de `migrate`
  échoue avec `Duplicate column name` ; la base de données doit être supprimée et
  recréée.
- **L'interface utilisateur s'affiche sans style :** recherchez `WARNING: collectstatic failed`
  dans les logs de démarrage du conteneur web.
- **Les tâches en arrière-plan ne s'exécutent jamais :** vérifiez que
  `enable_background_worker` et `cpu_always_allocated` sont tous deux `true`, et qu'une
  instance existe (`min_instance_count = 1`).
- **La construction de l'image a échoué :** examinez l'historique de Cloud
  Build pour le log de la construction échouée.
- **403 / erreurs d'autorisation :** vérifiez les rôles IAM du compte de
  service d'exécution.

Consultez la section *Pièges de configuration* du Guide de configuration pour
les astuces spécifiques aux paramètres.

---

## Tâche 6 — Suppression [Automatisé] {#task-6--tear-down-automated}

Sur la page **Déploiements**, ouvrez le déploiement et cliquez sur l'icône
**Corbeille** (**Supprimer**). La suppression exécute `terraform destroy` et est
irréversible (l'enregistrement du déploiement est conservé pour l'historique).
Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer
(par exemple après des modifications manuelles qui entrent en conflit avec
l'état Terraform), utilisez plutôt **Purger** (depuis la même boîte de dialogue
**Supprimer**) — cela supprime le déploiement des enregistrements de RAD
**sans** détruire les ressources cloud. Cela supprime tout ce que le module a
créé — le service Cloud Run, les jobs d'initialisation, la base de données
Cloud SQL, les secrets Secret Manager, les buckets Cloud Storage et les images
Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC,
l'instance Cloud SQL partagée, le serveur NFS, le registre) sont gérées
séparément et ne sont pas supprimées ici.

---

## Résumé {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run (web + `qcluster`), Cloud SQL (MySQL 8.0), des buckets, et exécute `db-init` → `migrate` |
| 2 — Accéder et vérifier | Manuel | 302 sur l'URL numéro-de-projet, 500 sur l'URL de hachage ; deux conteneurs ; schéma présent |
| 3 — Opérer | Manuel | Persister le répertoire de données sur NFS, mettre à l'échelle, mettre à jour la version, gérer les secrets/sauvegardes, accès à la base de données |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring ; test de disponibilité facultatif |
| 5 — Dépannage | Manuel | Diagnostiquer les problèmes de non-concordance d'hôte, de démarrage, de perte de données, de migration et de worker |
| 6 — Suppression | Automatisé | La suppression (Corbeille) supprime toutes les ressources du module |
