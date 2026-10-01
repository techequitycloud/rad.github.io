---
title: "TechnitiumDNS sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez TechnitiumDNS sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/TechnitiumDNS_CloudRun.md @ 3055034 sha256:20ad3575de1f -->

# TechnitiumDNS sur Cloud Run — Guide de lab {#technitiumdns-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/TechnitiumDNS_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–75 minutes

> ⚠️ **Avant de commencer :** ce module déploie **uniquement la console d'administration web et l'API REST** de Technitium
> (port 5380/HTTP). La fonction principale de résolveur DNS de Technitium (port 53/udp+tcp) **ne peut pas** être exposée
> via l'entrée de Cloud Run, limitée au HTTP(S). Ce lab couvre la gestion des zones et enregistrements DNS via la console —
> il ne rend PAS ce déploiement utilisable comme véritable résolveur DNS depuis un client quelconque.

Technitium DNS Server est un serveur DNS faisant autorité/récursif, open source et auto-hébergé, doté
d'une console web complète pour gérer les zones, les enregistrements, le blocage basé sur le DNS et les redirecteurs — sans
base de données externe. Ce lab vous fait parcourir tout le cycle de vie opérationnel du module **TechnitiumDNS on
Cloud Run** sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer,
diagnostiquer les problèmes courants et le supprimer.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google Cloud**, et non sur
les fonctionnalités de serveur DNS de TechnitiumDNS. Pour la liste complète des services provisionnés et de chaque
paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/TechnitiumDNS_CloudRun) — ce lab
ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder à la console en cours d'exécution et la vérifier, y compris une première connexion et un test rapide de création de zone.
- Effectuer les opérations du jour 2 — inspecter, mettre à jour et gérer les secrets.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Artifact Registry et les comptes de service
  partagés dont dépend ce module). Vous n'avez pas besoin de le déployer vous-même
  au préalable — la plateforme détecte automatiquement s'il existe déjà dans le
  projet cible et, sinon, le provisionne avant ce module (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans ce projet, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne requiert ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Sur un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **TechnitiumDNS (Cloud Run)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou êtes partenaire ou administrateur), définissez `project_id` et passez en revue les paramètres.
   Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/TechnitiumDNS_CloudRun) documente
   chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne un unique service Cloud Run v2 exécutant l'image officielle préconstruite
   `technitium/dns-server`, ainsi qu'un bucket Cloud Storage (monté sur `/etc/dns`) et un
   secret de mot de passe administrateur généré automatiquement. Aucune base de données n'est provisionnée. Comme l'image est préconstruite (aucune
   étape Cloud Build) et qu'il n'y a aucun job d'initialisation de base de données à attendre, un premier déploiement est
   généralement rapide (environ **3–7 minutes**).

3. Une fois l'opération terminée, identifiez le service avec un filtre indépendant des noms (pour que la commande continue de fonctionner
   quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~technitiumdns" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est opérationnel — la page racine de la console répond dès que le serveur s'attache à son
   port, sans dépendance de base de données à attendre :

   ```bash
   curl -s -o /dev/null -w '%{http_code} %{size_download}\n' "$SERVICE_URL/"
   # expect 200 and a large body (the console's rendered HTML, not an empty response)
   ```

2. Récupérez le mot de passe administrateur généré automatiquement :

   ```bash
   SECRET=$(gcloud secrets list --project="$PROJECT" --filter="name~admin-password" \
     --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$SECRET" --project="$PROJECT"
   ```

3. Ouvrez `$SERVICE_URL` dans un navigateur et connectez-vous en tant que `admin` avec ce mot de passe. **Changez immédiatement le
   mot de passe depuis la page de gestion des utilisateurs de la console elle-même** — Technitium ne lit
   `DNS_SERVER_ADMIN_PASSWORD` qu'au tout premier démarrage ; modifier ultérieurement la valeur dans Secret Manager n'a donc aucun
   effet sur la console en service ; le parcours de changement de mot de passe de la console est le seul moyen d'en effectuer la rotation
   par la suite.

4. Effectuez un test rapide de création de zone pour confirmer que le volume persistant `/etc/dns` fonctionne réellement : dans
   **Zones → Add Zone**, créez une zone primaire simple (par ex. `example.test`), ajoutez un enregistrement `A`, enregistrez,
   puis **redéployez ou redémarrez la révision** et vérifiez que la zone et l'enregistrement sont toujours présents —
   ce qui prouve que le volume de configuration monté depuis GCS conserve réellement l'état entre les redémarrages.

5. Rappel : **aucun client, où qu'il soit, ne peut résoudre de requêtes DNS auprès de ce déploiement.** La console vous permet
   de gérer entièrement les données de zone, mais seuls la console web et l'API sont joignables — pas le port 53.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision immuable ; le trafic bascule
   vers la plus récente qui est opérationnelle) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme RAD et en l'appliquant
   via **Update** ; une nouvelle révision est déployée en récupérant l'image préconstruite portant le nouveau tag. Fixez une
   version explicite en production plutôt que de vous fier à `latest`.

3. **Gérez les secrets :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~technitiumdns"
   ```

   Seul le `DNS_SERVER_ADMIN_PASSWORD` généré automatiquement apparaît par défaut ; cette liste n'est sinon
   alimentée que si vous avez fourni des entrées via `secret_environment_variables`.

4. **Activez Identity-Aware Proxy** pour un déploiement de production — définissez `enable_iap = true` avec les utilisateurs/groupes
   autorisés et appliquez via **Update**. Sans IAP, la console n'est protégée que par son propre mot de passe
   administrateur sur l'Internet public.

5. Il n'y a aucune base de données sur laquelle ouvrir une session — tout l'état réside dans le volume persistant `/etc/dns`,
   que vous pouvez inspecter via `gcloud storage ls` :

   ```bash
   BUCKET=$(gcloud storage buckets list --project="$PROJECT" --filter="name~-config" \
     --format="value(name)" --limit=1)
   gcloud storage ls "gs://$BUCKET/"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre du Logs Explorer : `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le nombre de requêtes, la latence
   des requêtes, le nombre d'instances et l'utilisation CPU/mémoire. Comme `cpu_always_allocated = false` par
   défaut, attendez-vous à ce que le nombre d'instances retombe à zéro entre les sessions d'administration — il s'agit du comportement attendu
   de mise à l'échelle à zéro, et non d'une erreur de configuration. Si un **test de disponibilité** (uptime check) Cloud Monitoring est activé,
   vérifiez qu'il est au vert sous Monitoring → Uptime checks.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Ce sont des diagnostics
au niveau de la plateforme, qui ne changent pas avec les versions de TechnitiumDNS.

- **Révision non opérationnelle / la console ne se charge pas :** inspectez la dernière révision et ses journaux à la recherche
  d'erreurs de démarrage. Les sondes de démarrage et de vivacité ciblent toutes deux `/`, qui doit renvoyer `200` quelques secondes après
  le démarrage — TechnitiumDNS n'a aucune base de données à attendre ; une sonde lente ou en échec signale donc généralement un problème
  de conteneur ou de montage du stockage plutôt qu'une dépendance en aval.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **« Je ne peux pas résoudre de DNS auprès de ce déploiement » :** c'est attendu — voir l'avertissement en haut de
  ce guide. Ce module n'expose volontairement que la console web et l'API, jamais le port 53.
- **Les zones/enregistrements disparaissent après un redémarrage :** vérifiez que le bucket Cloud Storage de configuration existe et est
  monté (`gcloud storage buckets list --filter="name~-config"`) ; un volume GCS manquant ou mal configuré
  signifie que `/etc/dns` revient à un système de fichiers éphémère vide à chaque redémarrage.
- **Impossible de se connecter avec le mot de passe de Secret Manager :** rappelez-vous qu'il ne s'applique qu'au tout premier démarrage. Si
  la console a déjà été démarrée auparavant (même brièvement, lors d'une précédente tentative de déploiement échouée avec un
  volume persistant), le mot de passe déjà présent sur le disque l'emporte — utilisez le parcours de réinitialisation du mot de passe de la console ou
  videz le volume pour repartir réellement de zéro.
- **Échec de la récupération / du build de l'image :** consultez l'historique de Cloud Build — `container_image_source = "prebuilt"`
  signifie qu'aucune étape de build ne s'exécute ; un échec à ce niveau signale donc généralement un problème de mise en miroir
  dans Artifact Registry plutôt qu'un problème de Dockerfile.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls & Sensible Defaults* du Guide de configuration pour les pièges propres
à chaque paramètre (dont le choix de périmètre sans résolveur DNS et la recommandation d'IAP).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute
`terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement
est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit
avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — elle retire le déploiement des enregistrements de RAD
**sans** détruire les ressources cloud (RAD oublie simplement le déploiement). La suppression retire tout ce que le
module a créé — le service Cloud Run, le bucket Cloud Storage de configuration, le secret du mot de passe administrateur et
les images Artifact Registry. Il n'y a aucune base de données Cloud SQL à nettoyer (TechnitiumDNS n'en provisionne aucune).
Les ressources appartenant à **Services_GCP** (le VPC, le registre partagé) sont gérées séparément et ne sont pas supprimées
ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne un unique service Cloud Run exécutant l'image TechnitiumDNS préconstruite, un bucket de configuration et un secret |
| 2 — Accéder et vérifier | Manuel | Le contrôle de santé réussit ; la première connexion aboutit ; une zone/un enregistrement survit à un redémarrage |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à jour la version, gérer les secrets, activer IAP |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de persistance du stockage et d'accès ; confirmer le périmètre sans résolveur DNS |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
