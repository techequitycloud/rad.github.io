---
title: "Roundcube sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez Roundcube sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, opérations, observabilité et suppression."
---

<!-- translated-from: docs/labs/Roundcube_CloudRun.md @ 2829548 sha256:8036930c4c82 -->

# Roundcube sur Cloud Run — Guide de lab {#roundcube-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Roundcube_CloudRun)**

## Vue d'ensemble {#overview}

**Temps estimé :** 45 à 60 minutes

Roundcube est un client webmail IMAP open source basé sur un navigateur : les
utilisateurs lisent, recherchent et envoient des e-mails dans le navigateur
à partir d'un serveur IMAP et SMTP existant. C'est un **client** de messagerie
— ce module ne déploie aucun serveur de messagerie. Ce lab vous guide à travers
le cycle de vie opérationnel complet du module **Roundcube sur Cloud Run** sur
Google Cloud : le déployer, y accéder et le vérifier, le connecter à un serveur
de messagerie, l'exécuter au quotidien, l'observer, diagnostiquer les problèmes
courants et le supprimer.

Le lab se concentre sur l'exploitation du **module Cloud Run et de la plateforme
Google Cloud**, et non sur les fonctionnalités du produit Roundcube. Pour la
liste complète des services provisionnés et de chaque entrée de configuration
(organisée par groupe), consultez le [Guide de configuration](https://docs.radmodules.dev/docs/modules/Roundcube_CloudRun)
— ce lab ne duplique délibérément pas ces détails afin qu'ils restent exacts
au fil du temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez capable de :

- Déployer le module depuis la plateforme RAD et localiser les ressources qu'il
  provisionne.
- Accéder et vérifier le service en cours d'exécution et son formulaire de
  connexion.
- Pointer Roundcube vers un serveur IMAP et SMTP existant et vous connecter.
- Effectuer les opérations de jour 2 — inspecter, mettre à l'échelle, mettre à
  jour et gérer les secrets et les sauvegardes.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus
  courants.
- Supprimer le déploiement proprement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Cloud SQL, Artifact Registry et les comptes
  de service partagés dont ce module dépend). Vous n'avez pas besoin de le
  déployer vous-même au préalable — la plateforme détecte automatiquement s'il
  existe déjà dans le projet cible et le provisionne avant ce module si ce n'est
  pas le cas (voir Tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
- Rôle IAM de **Propriétaire de projet** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement, la
  boîte de dialogue de confirmation de déploiement vous demande de prouver que
  vous le contrôlez (**Obtenir le code de vérification**, exécutez les commandes
  affichées en tant que Propriétaire de projet, puis **Vérifier**) et de donner
  le rôle de **Propriétaire** au compte de service de déploiement RAD. Un projet
  créé par RAD pour vous n'a besoin d'aucune de ces étapes.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création
  ne demande que la première page d'entrées (et, dans un projet créé par RAD
  pour vous, guère plus que le nom du locataire et la région). Toutes les autres
  entrées du Guide de configuration — y compris les entrées de serveur de
  messagerie, de mise à l'échelle et de version des Tâches 3 et 4 — sont
  modifiées par la suite avec **Update** sur la page du déploiement après avoir
  coché **Enable advanced mode**, ce qui nécessite un solde de crédits couvrant
  le coût de build estimé de la mise à jour (les mises à jour n'entraînent
  jamais de frais de module). Dans un environnement de lab, seul un
  administrateur peut utiliser le mode avancé.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules
  dans le projet.
- **Un compte de messagerie existant** pour la Tâche 3 : l'hôte et le port IMAP,
  l'hôte et le port de soumission SMTP (587 ou 465 — jamais 25), ainsi qu'un nom
  d'utilisateur et un mot de passe sur ce serveur.

Définissez ces variables shell une fois ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**,
   puis ouvrez **Roundcube (Cloud Run)** depuis la liste **Platform Modules**,
   choisissez **Configuration Form** sous *How would you like to configure this
   deployment?* (le formulaire s'ouvre sur l'**Assistant Conversationnel** si
   vous détenez des crédits achetés ou si vous êtes un partenaire ou un
   administrateur), définissez `project_id`, et examinez les entrées.
   Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Roundcube_CloudRun)
   documente chaque entrée par groupe, avec les valeurs par défaut. Cliquez sur
   **Deploy Module**, examinez le coût estimé dans la boîte de dialogue
   **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit**
   (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la
   vérification d'un projet que vous apportez, complétez-la et cliquez sur
   **Confirm**), ce qui ouvre la page d'état du déploiement avec les logs en
   temps réel.

2. La plateforme provisionne le service Cloud Run, une base de données Cloud SQL
   (MySQL 8.0) avec ses secrets Secret Manager (le `des_key` et le mot de passe de
   la base de données), un bucket Cloud Storage générique, construit l'image de
   conteneur personnalisée (en encapsulant `roundcube/roundcubemail:1.6.19-apache`), et exécute le job unique
   `db-init` qui crée la base de données et l'utilisateur. Roundcube crée son propre
   schéma lorsque le conteneur démarre pour la première fois. La création de
   Cloud SQL et la construction de l'image dominent le premier déploiement.

3. Une fois terminé, découvrez les ressources avec des filtres agnostiques au
   nom (afin que les commandes continuent de fonctionner quel que soit le suffixe
   de déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~roundcube" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Confirmez que le service est sain. Roundcube sert son formulaire de connexion
   à la racine :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"   # expect 200
   ```

2. Ouvrez `$SERVICE_URL` dans un navigateur. Le formulaire de connexion Roundcube
   apparaît. **Vous ne pouvez pas vous connecter pour le moment** — Roundcube
   n'a pas de comptes locaux ou d'administrateur et authentifie chaque
   utilisateur contre un serveur IMAP, et le module est déployé sans serveur IMAP
   configuré. La Tâche 3 en connecte un.

3. Confirmez que le schéma a été créé dans Cloud SQL en lisant le log du
   conteneur pour la séquence de démarrage, y compris la ligne de mémoire PHP
   que l'entrée du wrapper imprime :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100 \
     | grep -i -E "memory_limit|error"
   ```

   Attendez-vous à `[startup] PHP memory_limit set to 512M via /usr/local/etc/php/conf.d/zz-rad-overrides.ini`.

---

## Tâche 3 — Connecter un serveur de messagerie et se connecter [Manuel] {#task-3--connect-a-mail-server-and-sign-in-manual}

1. Sur la page du déploiement, cochez **Enable advanced mode**, cliquez sur
   **Update**, et ajoutez ces clés à `environment_variables` (Groupe 6), en utilisant vos propres
   serveurs :

   | Clé | Exemple de valeur |
   |---|---|
   | `ROUNDCUBEMAIL_DEFAULT_HOST` | `ssl://imap.example.com` (TLS implicite) ou `tls://imap.example.com` (STARTTLS) |
   | `ROUNDCUBEMAIL_DEFAULT_PORT` | `993` (TLS implicite) ou `143` (STARTTLS) |
   | `ROUNDCUBEMAIL_SMTP_SERVER` | `smtp.example.com` |
   | `ROUNDCUBEMAIL_SMTP_PORT` | `587` ou `465` — **jamais `25`**, que Google Cloud bloque |

   Celles-ci remplacent les valeurs par défaut vides du module. Ce wrapper n'a
   pas d'entrées IMAP/SMTP dédiées, donc `environment_variables` est l'endroit où les définir.

2. Appliquez la mise à jour et attendez la nouvelle révision. Confirmez que les
   valeurs ont été prises en compte :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
     --format=yaml | grep -A1 -E "ROUNDCUBEMAIL_(DEFAULT_HOST|DEFAULT_PORT|SMTP_SERVER|SMTP_PORT)"
   ```

3. Rechargez `$SERVICE_URL`, connectez-vous avec le nom d'utilisateur et le mot de
   passe de votre compte de messagerie existant, ouvrez la boîte de réception et
   envoyez un message test à vous-même.

---

## Tâche 4 — Opérer et maintenir en fonctionnement (Jour 2) [Manuel] {#task-4--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une
   révision immuable ; le trafic bascule vers la plus récente et saine) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** en modifiant les entrées min/max d'instances et en
   cliquant sur **Update** sur la page des détails du déploiement — le module
   possède la spécification du service, donc la mise à l'échelle est un
   changement de configuration, pas une modification manuelle de `gcloud` (une
   modification manuelle serait annulée lors du prochain apply). Chaque instance
   lit le même `des_key` de Secret Manager, de sorte que la session d'un
   utilisateur reste valide quelle que soit l'instance qui la sert.

3. **Mettez à jour la version de l'application** en changeant `application_version` pour une
   autre balise `-apache` exacte et en l'appliquant via **Update** ; une nouvelle
   image est construite `FROM roundcube/roundcubemail:<version>` et une nouvelle révision est déployée. Le
   script `bin/installto.sh -y` de l'image met à jour le schéma au démarrage — aucune étape de
   migration manuelle n'est nécessaire. N'utilisez pas `latest` ou une balise
   glissante : une reconstruction sous une balise inchangée ne produit pas de
   nouvelle révision.

4. **Gérez les secrets et les sauvegardes :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~roundcube"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init + scheduled backup jobs
   ```

5. **Ouvrez une session de base de données** pour inspection ou maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^roundcube" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

---

## Tâche 5 — Observer : Journalisation et surveillance [Manuel] {#task-5--observe-logging--monitoring-manual}

1. **Logs** — depuis la CLI ou l'Explorateur de logs :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre de l'Explorateur de logs : `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run pour le service et
   examinez le nombre de requêtes, la latence des requêtes, le nombre
   d'instances (comportement de mise à l'échelle) et l'utilisation du CPU / de
   la mémoire. Le test de disponibilité est **désactivé** par défaut ; activez-le
   avec `uptime_check_config` si vous en voulez un, puis confirmez qu'il est vert sous
   Monitoring → Uptime checks, et examinez Alerting → Policies.

---

## Tâche 6 — Dépannage et débogage [Manuel] {#task-6--troubleshoot--debug-manual}

Techniques durables pour les modes de défaillance que vous êtes le plus
susceptible de rencontrer. Ce sont des diagnostics au niveau de la plateforme et
ils ne changent pas avec les versions de Roundcube.

- **Révision non saine / le service ne répond pas :** inspectez la dernière
  révision et ses logs pour les erreurs de démarrage, et confirmez que les
  variables d'environnement et les secrets ont été résolus. Les deux sondes sont
  HTTP `GET /` ; la sonde de démarrage permet un délai de 30 s plus 20 × 15 s
  tentatives, car l'image exécute `installto.sh` et attend la base de données avant que
  Apache ne démarre.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Le formulaire de connexion se charge mais personne ne peut se connecter :**
  le serveur IMAP n'est pas configuré ou n'est pas joignable. Vérifiez `ROUNDCUBEMAIL_DEFAULT_HOST` et
  `ROUNDCUBEMAIL_DEFAULT_PORT` sur le service (Tâche 3), que le schéma (`ssl://` / `tls://`)
  correspond au port, et que le serveur IMAP accepte les connexions depuis
  Internet (ou depuis le VPC, si vous avez défini `vpc_egress_setting = ALL_TRAFFIC`).
- **Le courrier ne peut pas être envoyé :** vérifiez `ROUNDCUBEMAIL_SMTP_SERVER` et `ROUNDCUBEMAIL_SMTP_PORT`. Le port
  25 ne fonctionne jamais sur Google Cloud ; utilisez 587 ou 465 sur un relais
  qui accepte le courrier authentifié.
- **Les utilisateurs sont déconnectés au hasard :** le conteneur a démarré sans
  `ROUNDCUBEMAIL_DES_KEY`. L'entrée du wrapper imprime `WARNING: ROUNDCUBEMAIL_DES_KEY is not set` dans ce cas — confirmez que le
  secret `des-key` existe et est attaché au service.
- **Erreurs de connexion à la base de données :** confirmez que l'instance
  Cloud SQL est `RUNNABLE`, que le secret du mot de passe de la base de données
  existe et que le job `db-init` s'est terminé avec succès.
- **Le job d'initialisation a échoué :** listez les exécutions et lisez les logs
  de celle qui a échoué :
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **La construction de l'image a échoué :** examinez l'historique de Cloud Build
  pour le log de la construction échouée.
- **403 / erreurs de permission :** vérifiez les rôles IAM du compte de service
  d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les
pièges spécifiques aux paramètres.

---

## Tâche 7 — Supprimer [Automatisé] {#task-7--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône
**Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement
du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la
plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles
qui entrent en conflit avec l'état Terraform), utilisez **Purge** à la place (depuis
la même boîte de dialogue **Delete**) — cela supprime le déploiement des enregistrements
de RAD **sans** détruire les ressources cloud. Cela supprime tout ce que le module a
créé — le service Cloud Run, la base de données Cloud SQL, les secrets Secret Manager,
les buckets GCS et les images Artifact Registry. Les ressources appartenant à
**Services_GCP** (le VPC, Cloud SQL partagé, le registre) sont gérées séparément et
ne sont pas supprimées ici. Le courrier sur votre serveur IMAP n'est pas touché —
Roundcube ne l'a jamais détenu.

---

## Résumé {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, Cloud SQL (MySQL 8.0), les secrets `des_key` et de base de données, un bucket de stockage, et exécute `db-init` |
| 2 — Accéder et vérifier | Manuel | Le contrôle de santé renvoie 200 avec le formulaire de connexion ; la ligne de mémoire PHP est confirmée dans le log |
| 3 — Connecter un serveur de messagerie | Manuel | IMAP/SMTP définis via `environment_variables` ; connexion et envoi d'un message test |
| 4 — Opérer | Manuel | Inspecter les révisions, mettre à l'échelle, mettre à jour la version, gérer les secrets/sauvegardes, accès à la base de données |
| 5 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring |
| 6 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de serveur de messagerie, de session, de base de données, de job d'initialisation et de build |
| 7 — Supprimer | Automatisé | La suppression (Corbeille) supprime toutes les ressources du module |
