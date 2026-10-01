---
title: "Medusa sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez Medusa sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Medusa_CloudRun.md @ 3055034 sha256:98a38b7402a7 -->

# Medusa sur Cloud Run — Guide de lab {#medusa-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Medusa_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 60–90 minutes — c'est l'un des labs les plus longs de ce
catalogue. Contrairement à presque tous les autres modules applicatifs, `Medusa_CloudRun`
construit son image de conteneur **à partir du code source** (il n'existe pas d'image Docker
officielle de Medusa), et il exécute une chaîne d'initialisation **en quatre étapes** au lieu des
un ou deux jobs habituels. Ces deux éléments ajoutent un temps réel et observable à un premier déploiement, en plus
du provisionnement Cloud SQL habituel.

Medusa est une plateforme de commerce électronique headless et open source — orientée API, avec un contrôle
programmatique complet sur les produits, les paniers, les commandes, les clients et les paiements,
ainsi qu'une interface d'administration intégrée servie par le même processus. Ce lab vous fait
parcourir tout le cycle de vie opérationnel du module **Medusa on Cloud Run**
sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer,
diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google
Cloud**, et non sur les fonctionnalités de commerce électronique de Medusa. Pour la liste complète
des services provisionnés et de chaque paramètre de configuration (organisés par groupe),
consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Medusa_CloudRun) —
ce lab ne duplique volontairement pas ce détail afin de rester exact dans
le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et comprendre pourquoi il prend plus de temps
  que la plupart des modules de ce catalogue.
- Accéder au service en cours d'exécution et le vérifier, y compris l'interface d'administration intégrée.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour et gérer les secrets.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants,
  y compris les échecs de **build** de l'image — une catégorie de défaillance à laquelle ce module est
  particulièrement exposé.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Cloud SQL, Artifact Registry et les comptes de
  service partagés dont dépend ce module). Vous n'avez pas besoin de le déployer
  vous-même au préalable — la plateforme détecte automatiquement s'il existe déjà
  dans le projet cible et, sinon, le provisionne avant ce module (voir la tâche
  1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth
  application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes qu'elle affiche en tant que Owner du projet, puis **Verify**) et d'accorder le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne requiert ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Medusa (Cloud Run)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et
   passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Medusa_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état
   du déploiement avec les journaux en temps réel.

2. **Ce déploiement prend nettement plus de temps que la plupart des modules de ce
   catalogue.** Trois phases s'exécutent pour l'essentiel en séquence :
   - **Build de l'image (~10 minutes) :** Cloud Build clone `medusajs/dtc-starter`,
     exécute `pnpm install` et `medusa build`, puis empaquette une image d'exécution —
     un véritable `git clone` + installation des dépendances + build de l'application, et pas seulement
     un `docker pull`.
   - **Provisionnement de Cloud SQL (~20 à 35 minutes lors d'un premier déploiement) :** habituel
     pour tout module adossé à PostgreSQL dans ce catalogue, mais il domine
     la durée totale.
   - **La chaîne d'initialisation en quatre étapes :** `db-init` → `medusa-migrate` →
     `medusa-verify` → `medusa-admin-create`, chacune attendant la précédente et
     chacune présentant en pratique une latence réelle de plusieurs minutes (`medusa-migrate`
     dispose à lui seul de 30 minutes au maximum).

   Au total, prévoyez **30 à 45 minutes ou plus** pour un premier déploiement — c'est
   normal, et non le signe d'un déploiement bloqué. Suivez le flux de journaux en direct pour
   voir la progression à travers chaque phase plutôt que de supposer un blocage.

3. Une fois l'opération terminée, identifiez les ressources avec des filtres indépendants des noms (afin
   que les commandes continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~medusa" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est sain :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/health"   # expect 200
   ```

2. Récupérez les identifiants administrateur créés automatiquement dans Secret Manager — contrairement à
   de nombreuses applications de ce catalogue, le premier utilisateur administrateur de Medusa est initialisé
   automatiquement par le job d'initialisation `medusa-admin-create`, et non créé
   de manière interactive lors de la première visite :

   ```bash
   ADMIN_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~medusa-admin-password" --format="value(name)")
   ADMIN_PASSWORD=$(gcloud secrets versions access latest \
     --secret="$ADMIN_SECRET" --project="$PROJECT")
   echo "Admin password: $ADMIN_PASSWORD"
   # Admin email is whatever admin_email was set to at deploy time
   # (default: admin@techequity.cloud)
   ```

3. Ouvrez `$SERVICE_URL/app` dans un navigateur — Medusa sert son interface d'administration intégrée
   depuis le même processus et le même port que l'API. Connectez-vous avec l'e-mail et le
   mot de passe récupérés.

4. Parcourez les données de démonstration préchargées. Sur une nouvelle installation, `medusa-migrate` précharge
   des données d'exemple (boutique, région, produits, inventaire) dans le cadre du propre
   processus de migration de Medusa — vous devriez voir un catalogue de produits de démonstration déjà
   rempli dans l'interface d'administration (Products, Regions) sans aucune configuration manuelle.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions :**

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres d'instances min/max et en cliquant sur **Update**
   sur la page de détails du déploiement. Notez l'implication propre à ce module en matière de mise à l'échelle :
   `MEDUSA_WORKER_MODE = "shared"` signifie que **chaque** instance en cours d'exécution
   traite à la fois les requêtes API et les jobs, abonnés et workflows en arrière-plan
   de Medusa — il n'existe pas de niveau worker distinct à mettre à l'échelle
   indépendamment. Augmenter le nombre d'instances ajoute une capacité redondante à la fois pour le traitement des requêtes
   et pour le travail en arrière-plan, et non pour l'un ou l'autre.

3. **Mettez à jour la version de l'application.** Modifier le paramètre de version et
   l'appliquer via **Update** ne se contente **pas** de remplacer un tag d'image — comme il
   n'existe pas d'image amont, cela déclenche une reconstruction complète par Cloud Build
   (~10 minutes pour l'étape de build) à partir du code source. `application_version` lui-même
   ne sélectionne même pas ce qui est reconstruit (le Dockerfile n'a aucun `ARG`
   qui le consomme) ; seul `MEDUSA_STARTER_REF` (fixé sur la branche `main` de
   `dtc-starter`) détermine le code récupéré.

4. **Gérez les secrets :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~medusa"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # the four init jobs
   ```

5. **Ouvrez une session de base de données** pour inspection ou maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. medusademo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^medusa" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Recherchez `"Server is ready on port: 9000"`, qui confirme un démarrage sain.
   Filtre du Logs Explorer :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez
   le nombre de requêtes, la latence des requêtes, le nombre d'instances et l'utilisation
   CPU/mémoire. Si `cpu_always_allocated = false` (la valeur par défaut), n'oubliez pas
   que le CPU est limité entre les requêtes entrantes — si les workflows en arrière-plan de Medusa
   vous semblent lents à faible volume de requêtes, c'en est
   la cause probable (voir le tableau *Configuration Pitfalls* du Guide
   de configuration).

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit
de diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Medusa.

- **Révision non saine / le service ne répond pas :** examinez la dernière révision
  et ses journaux à la recherche d'erreurs de démarrage.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Erreurs de connexion à la base de données ou à Redis :** vérifiez que l'instance Cloud SQL est
  `RUNNABLE`, que le secret du mot de passe de la base existe et que Redis est réellement
  joignable — n'oubliez pas que Medusa journalise le message faussement rassurant `"redisUrl not found.
  A fake redis instance will be used."` et démarre malgré tout au lieu d'échouer
  franchement, si bien qu'une connexion Redis manquante peut ressembler à un déploiement sain qui
  se comporte mal sous charge.
- **Échecs de migration ou de vérification :** listez les exécutions des jobs et lisez les journaux.
  `medusa-verify` est conçu pour faire échouer l'application bruyamment (plutôt que de livrer
  silencieusement un service d'apparence saine face à une base de données vide) — s'il
  a échoué, le message d'erreur indique le nombre de tables trouvées :
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-medusa-migrate" \
    --project="$PROJECT" --region="$REGION"
  gcloud run jobs executions list --job="${SERVICE}-medusa-verify" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Échecs de build de l'image — le mode de défaillance le plus caractéristique de ce
  module.** Comme l'image est construite à partir du code source à chaque déploiement, ce
  module est celui du lot le plus susceptible de rencontrer un véritable échec de Cloud Build
  — par exemple, une modification amont du dépôt `dtc-starter` qui casse
  l'étape de clonage, `pnpm install` ou `medusa build`. Consultez l'historique
  de Cloud Build pour obtenir le journal complet du build en échec :
  ```bash
  gcloud builds list --project="$PROJECT" --limit=5
  gcloud builds log <build-id> --project="$PROJECT"
  ```
  Un build qui échoue avec `"medusa: not found"` au démarrage du conteneur (plutôt
  qu'au moment du build) correspond au bogue d'isolation de l'espace de travail pnpm documenté dans la
  section *Configuration Pitfalls* du Guide de configuration — le correctif figure déjà dans
  le Dockerfile livré, mais il vaut la peine de le reconnaître si vous le modifiez un jour.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service
  d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les
pièges propres à chaque paramètre.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash**
(**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du
déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la
plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en
conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le
déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD
oublie le déploiement). La suppression retire tout ce que le module a créé —
le service Cloud Run, la base de données Cloud SQL, les secrets Secret Manager et
les images d'Artifact Registry (ainsi que tout bucket GCS, si `enable_gcs_storage` était
activé). Les ressources appartenant à **Services_GCP** (le VPC, le Cloud SQL partagé,
le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module construit l'image Medusa à partir du code source (~10 min), provisionne Cloud Run + Cloud SQL (PostgreSQL 15) et les secrets, puis exécute la chaîne d'initialisation en quatre étapes (~30 à 45 min ou plus au total) |
| 2 — Accéder et vérifier | Manuel | Le contrôle de santé réussit ; récupérer les identifiants administrateur créés automatiquement dans Secret Manager ; se connecter à l'interface d'administration intégrée sur `/app` ; parcourir les produits de démonstration préchargés |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l'échelle (mode worker partagé — chaque instance traite à la fois l'API et le travail en arrière-plan), mettre à jour la version (déclenche une reconstruction complète depuis le code source), gérer les secrets, accéder à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de base de données/Redis, de job de migration/vérification et de **build de l'image** |
| 6 — Démanteler | Automatisé | La suppression (Trash) retire toutes les ressources du module |
