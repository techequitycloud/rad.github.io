---
title: "SimpleRisk sur Cloud Run — Guide de Lab"
description: "Lab pratique : déployez SimpleRisk sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, opérations, observabilité et suppression."
---

<!-- translated-from: docs/labs/SimpleRisk_CloudRun.md @ 2829548 sha256:85d4cafcd12b -->

# SimpleRisk sur Cloud Run — Guide de Lab {#simplerisk-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/SimpleRisk_CloudRun)**

## Vue d'ensemble {#overview}

**Temps estimé :** 45 à 60 minutes

SimpleRisk est une plateforme open source de gouvernance, de gestion des risques
et de conformité (GRC) — un registre des risques avec notation, planification
d'atténuation, revues de gestion et historique d'audit. Ce lab vous guide à
travers le cycle de vie opérationnel complet du module **SimpleRisk sur Cloud
Run** sur Google Cloud : déployez-le, accédez-y et vérifiez-le, exécutez-le au
quotidien, observez-le, diagnostiquez les problèmes courants et supprimez-le.

Le lab se concentre sur l'exploitation du **module Cloud Run et de la plateforme
Google Cloud**, et non sur les fonctionnalités du produit SimpleRisk. Pour la
liste complète des services provisionnés et de chaque entrée de configuration
(organisée par groupe), consultez le [Guide de
configuration](https://docs.radmodules.dev/docs/modules/SimpleRisk_CloudRun) —
ce lab ne duplique délibérément pas ces détails afin qu'ils restent précis au
fil du temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez capable de :

- Déployer le module depuis la plateforme RAD et localiser les ressources qu'il
  provisionne.
- Accéder au service en cours d'exécution et créer le compte administrateur
  SimpleRisk.
- Effectuer les opérations Day-2 — inspecter, mettre à l'échelle, mettre à jour
  et gérer les secrets, le stockage et les sauvegardes.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus
  courants.
- Supprimer proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Cloud SQL pour MySQL, Artifact Registry et
  les comptes de service partagés dont dépend ce module). Vous n'avez pas besoin
  de le déployer vous-même au préalable — la plateforme détecte
  automatiquement s'il existe déjà dans le projet cible et le provisionne avant
  ce module si ce n'est pas le cas (voir Tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
- Rôle IAM de **Propriétaire de projet** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement, la
  boîte de dialogue de confirmation de déploiement vous demande de prouver que
  vous le contrôlez (**Obtenir le code de vérification**, exécutez les
  commandes qu'il affiche en tant que Propriétaire de projet, puis **Vérifier**)
  et de donner au compte de service de déploiement RAD le rôle de
  **Propriétaire**. Un projet créé par RAD pour vous n'a besoin ni de l'un ni
  de l'autre.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création
  ne demande que la première page d'entrées (et, dans un projet créé par RAD
  pour vous, guère plus que le nom du locataire et la région). Toutes les
  autres entrées du Guide de configuration — y compris les entrées de mise à
  l'échelle et de version dans les tâches Day-2 — sont modifiées par la suite
  avec **Update** sur la page du déploiement après avoir coché **Enable
  advanced mode**, ce qui nécessite un solde de crédits couvrant le coût de
  build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais
  de module). Dans un environnement de lab, seul un administrateur peut utiliser
  le mode avancé.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules
  dans le projet.

Définissez ces variables shell une fois ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Catalogue de solutions → Modules
   RAD**, puis ouvrez **SimpleRisk (Cloud Run)** depuis la liste **Modules de
   plateforme**, choisissez **Formulaire de configuration** sous *Comment
   souhaitez-vous configurer ce déploiement ?* (le formulaire s'ouvre sur
   l'**Assistant conversationnel** si vous avez acheté des crédits ou si vous
   êtes partenaire ou administrateur), définissez `project_id`, et
   examinez les entrées. Ne configurez que ce dont vous avez besoin — le [Guide
   de configuration](https://docs.radmodules.dev/docs/modules/SimpleRisk_CloudRun)
   documente chaque entrée par groupe, avec les valeurs par défaut. Cliquez sur
   **Déployer le module**, examinez le coût estimé dans la boîte de dialogue
   **Confirmation de déploiement** lorsqu'elle apparaît et cliquez sur
   **Soumettre** (si la boîte de dialogue ajoute ensuite une étape de
   confirmation, comme la vérification d'un projet que vous apportez,
   complétez-la et cliquez sur **Confirmer**), ce qui ouvre la page d'état du
   déploiement avec les logs en temps réel.

2. La plateforme provisionne le service Cloud Run, une base de données Cloud SQL
   (MySQL 8.0) et son secret de mot de passe, un bucket `storage` monté avec GCS
   FUSE à `/var/www/simplerisk/files`, construit l'image conteneur wrapper, et exécute la chaîne
   d'initialisation en deux étapes : `db-init` (crée la base de données,
   l'utilisateur et les autorisations) suivie de `schema-load` (charge le schéma de
   SimpleRisk dans la base de données vide). Les premiers déploiements prennent
   environ **15 à 25 minutes** (la création de Cloud SQL et le build de l'image
   dominent).

3. Une fois terminé, découvrez les ressources avec des filtres agnostiques au
   nom (afin que les commandes continuent de fonctionner quel que soit le suffixe
   de déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~simplerisk" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Confirmez que le service répond sur son URL :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"
   ```

2. **Créez le compte administrateur immédiatement.** Ouvrez `$SERVICE_URL` dans un
   navigateur. SimpleRisk n'est livré avec aucune information d'identification
   par défaut — lors du premier accès, il affiche un formulaire de **Création de
   compte administrateur par défaut**, et quiconque le soumet devient
   l'administrateur. Le service est public par défaut, alors faites-le dès que
   le déploiement est terminé. (Pour garder l'URL privée pendant que vous
   travaillez, définissez `ingress_settings = "internal-and-cloud-load-balancing"` ou `enable_iap = true` — voir le Guide de
   configuration.)

3. Connectez-vous avec le compte que vous avez créé et ajoutez un risque de test.
   Confirmez ensuite que le schéma est bien dans Cloud SQL — `schema-load`
   indique le nombre de tables trouvées ou chargées :

   ```bash
   gcloud run jobs list --project="$PROJECT" --region="$REGION" --filter="metadata.name~simplerisk"
   gcloud logging read \
     'resource.type="cloud_run_job" AND textPayload:"tables"' \
     --project="$PROJECT" --limit=5 --format="value(textPayload)"
   ```

   Attendez-vous à une ligne telle que `Schema loaded: 154 tables in ...` lors du premier déploiement,
   ou `Schema already present ... -- nothing to do` lors des applys ultérieurs.

---

## Tâche 3 — Opérer et maintenir en fonctionnement (Day-2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une
   révision immuable ; le trafic bascule vers la plus récente et saine) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** en modifiant les entrées d'instances min/max et en
   cliquant sur **Update** sur la page des détails du déploiement — le module
   possède la spécification du service, donc la mise à l'échelle est un
   changement de configuration, pas une modification manuelle de `gcloud` (une
   modification manuelle serait annulée lors du prochain apply). Les sessions
   sont stockées dans la base de données, donc plus d'une instance est sûre.

3. **Mettez à jour la version de l'application** en changeant `application_version` pour une
   autre balise SimpleRisk datée et en l'appliquant via **Update** ; une
   nouvelle image se construit `FROM simplerisk/simplerisk:<version>` et une nouvelle révision est déployée.
   Changez toujours la balise — reconstruire sous la même balise ne produit
   aucune nouvelle révision.

4. **Gérez les secrets, le stockage et les sauvegardes :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~simplerisk"
   gcloud storage buckets list --project="$PROJECT" --format="value(name)" | grep -i simplerisk
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # init + scheduled backup jobs
   ```

5. **Ouvrez une session de base de données** pour l'inspection ou la
   maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. simpleriskdemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^simplerisk" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : Logging et Monitoring [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Logs** — depuis la CLI ou l'Explorateur de logs. Chaque démarrage de
   conteneur logue la base de données qu'il a rendue dans `config.php` (`config.php rendered against Cloud SQL
   at ...`) :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre de l'Explorateur de logs : `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Monitoring** — ouvrez le tableau de bord Cloud Run pour le service et
   examinez le nombre de requêtes, la latence des requêtes, le nombre
   d'instances (comportement de mise à l'échelle) et l'utilisation du CPU / de
   la mémoire. Un test de disponibilité n'est créé que s'il est activé et si
   `min_instance_count` est au moins `1` ; si c'est le cas, confirmez qu'il est vert
   sous Monitoring → Tests de disponibilité, et examinez Alerting → Politiques.

---

## Tâche 5 — Dépannage et débogage [Manuel] {#task-5--troubleshoot--debug-manual}

Techniques durables pour les modes de défaillance que vous êtes le plus
susceptible de rencontrer. Il s'agit de diagnostics au niveau de la plateforme
et ils ne changent pas avec les versions de SimpleRisk.

- **Révision non saine / le service ne répond pas :** inspectez la dernière
  révision et ses logs. Le point d'entrée se termine avec `DB_IP is not set` (ou `DB_NAME`,
  `DB_USER`, `DB_PASSWORD`) lorsqu'une variable de base de données est manquante —
  vérifiez que `db_host_env_var_name` est toujours `DB_IP`.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **La page se charge mais rien ne peut être enregistré, ou la connexion échoue
  avec une erreur de base de données :** les sondes de santé HTTP passent sans
  toucher la base de données, donc une connexion de base de données rompue ne
  marque pas le service comme non sain. La cause habituelle est une
  inadéquation de mot de passe après que `database_password_length` a été modifié. Relancez le
  job `db-init`, qui réinitialise le mot de passe de l'utilisateur depuis Secret
  Manager :
  ```bash
  gcloud run jobs execute "$(gcloud run jobs list --project="$PROJECT" --region="$REGION" \
    --filter="metadata.name~db-init" --format="value(metadata.name)" --limit=1)" \
    --project="$PROJECT" --region="$REGION" --wait
  ```
- **`schema-load` a échoué :** lisez ses logs d'exécution. Notez qu'il signale
  `database not reachable after 60s` pour **toute** connexion échouée, y compris une erreur
  d'authentification — vérifiez le mot de passe avant le réseau.
  ```bash
  gcloud run jobs executions list --job="$(gcloud run jobs list --project="$PROJECT" \
    --region="$REGION" --filter="metadata.name~schema-load" --format="value(metadata.name)" --limit=1)" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Le formulaire administrateur a déjà été utilisé :** quelqu'un a accédé à
  l'URL en premier. Restreignez d'abord l'accès (Tâche 2), puis supprimez le
  déploiement et redéployez-le afin que le schéma soit chargé dans une nouvelle
  base de données sans administrateur.
- **Un changement de configuration n'a pas atteint le service en cours
  d'exécution :** si vous avez reconstruit l'image sans changer `application_version`,
  aucune nouvelle révision n'a été créée. Changez la balise et appliquez à
  nouveau.
- **Le build de l'image a échoué :** examinez l'historique de Cloud Build pour
  le log du build échoué.
- **403 / erreurs de permission :** vérifiez les rôles IAM du compte de service
  d'exécution.

Consultez la section *Pièges de configuration* du Guide de configuration pour
les astuces spécifiques aux paramètres.

---

## Tâche 6 — Suppression [Automatisé] {#task-6--tear-down-automated}

Sur la page **Déploiements**, ouvrez le déploiement et cliquez sur l'icône
**Corbeille** (**Supprimer**). La suppression exécute `terraform destroy` et est
irréversible (l'enregistrement du déploiement est conservé pour l'historique).
Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par
exemple après des modifications manuelles qui entrent en conflit avec l'état
Terraform), utilisez plutôt **Purger** (depuis la même boîte de dialogue
**Supprimer**) — cela supprime le déploiement des enregistrements de RAD
**sans** détruire les ressources cloud (cela fait oublier le déploiement à
RAD). La suppression supprime tout ce que le module a créé — le service Cloud
Run, la base de données et l'utilisateur SimpleRisk, le secret du mot de passe
de la base de données, les buckets GCS (y compris les fichiers téléchargés) et
les images Artifact Registry. Les ressources appartenant à **Services_GCP** (le
VPC, l'instance Cloud SQL partagée, le registre) sont gérées séparément et ne
sont pas supprimées ici.

---

## Résumé {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, Cloud SQL (MySQL 8.0), le volume GCS FUSE `storage`, et exécute la chaîne d'initialisation `db-init` → `schema-load` |
| 2 — Accéder et vérifier | Manuel | Le service répond ; administrateur créé via le formulaire de première exécution ; schéma confirmé dans Cloud SQL |
| 3 — Opérer | Manuel | Inspecter les révisions, mettre à l'échelle, mettre à jour la balise de version datée, gérer les secrets/stockage/sauvegardes, accès à la base de données |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépannage | Manuel | Diagnostiquer les problèmes de révision, d'authentification de base de données, de chargement de schéma, de première exécution, d'image obsolète et de build |
| 6 — Suppression | Automatisé | Supprimer (Corbeille) supprime toutes les ressources du module |
