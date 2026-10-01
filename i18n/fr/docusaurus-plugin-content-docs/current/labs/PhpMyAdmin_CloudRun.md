---
title: "PhpMyAdmin sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez PhpMyAdmin sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/PhpMyAdmin_CloudRun.md @ 3055034 sha256:88ef9c7fdbd2 -->

# PhpMyAdmin sur Cloud Run — Guide de lab {#phpmyadmin-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/PhpMyAdmin_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

phpMyAdmin est l'outil web open source le plus répandu pour administrer des bases de données MySQL et
MariaDB depuis le navigateur — parcourir et modifier des tables, exécuter du SQL, gérer les utilisateurs,
et importer/exporter des données. Ce lab vous fait parcourir tout le cycle de vie opérationnel
du module **phpMyAdmin on Cloud Run** sur Google Cloud : le déployer, y accéder et le
vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et le démanteler.

Contrairement à la plupart des modules de ce dépôt, phpMyAdmin ne possède ni ne provisionne de
base de données — c'est un *client* qui se connecte à un serveur MySQL/MariaDB existant déjà
ailleurs (l'instance Cloud SQL partagée de la plateforme, une autre instance Cloud SQL
ou tout hôte joignable). « Déployer » phpMyAdmin consiste à mettre en place l'interface web
et son chemin de connectivité vers ce serveur externe, et non à créer un nouveau stockage de données.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google Cloud**,
et non sur les fonctionnalités de phpMyAdmin. Pour la liste complète des services provisionnés et de
chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/PhpMyAdmin_CloudRun) —
ce lab ne duplique volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder au service en cours d'exécution et le vérifier, et confirmer quel serveur MySQL/MariaDB il
  cible.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour la version, et fixer ou élargir la
  cible MySQL.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Cloud SQL, Artifact Registry et les comptes de
  service partagés dont dépend ce module — et, si vous souhaitez que phpMyAdmin
  l'administre, l'instance MySQL partagée de la plateforme). Vous n'avez pas besoin de le
  déployer vous-même au préalable — la plateforme détecte automatiquement s'il
  existe déjà dans le projet cible et, sinon, le provisionne avant ce module (voir
  la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes qu'elle affiche en tant que Owner du projet, puis **Verify**) et d'accorder le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne requiert ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.
- Un accès à (ou des identifiants pour) un **serveur MySQL/MariaDB** que vous comptez administrer —
  phpMyAdmin ne crée aucune base de données propre.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **PhpMyAdmin (Cloud Run)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue
   les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/PhpMyAdmin_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Décidez dès le départ si vous voulez
   `pma_arbitrary = "1"` (par défaut — les utilisateurs saisissent n'importe quel hôte MySQL à la connexion) ou un
   `pma_host` fixe avec `pma_arbitrary = "0"` (un seul serveur épinglé, par exemple l'IP privée
   Cloud SQL de la plateforme). Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme construit l'image de conteneur personnalisée minimale (`FROM phpmyadmin/phpmyadmin`),
   la met en miroir dans Artifact Registry et provisionne le service Cloud Run. Il n'y a
   **aucune instance Cloud SQL, aucun secret Secret Manager et aucun job d'initialisation
   de base de données** — phpMyAdmin ne provisionne aucun stockage de données propre. Les premiers déploiements ne prennent généralement
   que **5 à 10 minutes** (un build d'image et un déploiement Cloud Run — sans le
   temps de provisionnement de Cloud SQL que subissent les autres modules applicatifs).

3. Une fois l'opération terminée, repérez le service avec un filtre indépendant des noms (afin que la commande
   fonctionne quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~phpmyadmin" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est opérationnel. phpMyAdmin sert sa page de connexion sur `/` avec un `200`
   dès qu'Apache/PHP est prêt — il n'y a aucune dépendance de connectivité à une base de données à
   attendre, puisque phpMyAdmin ne détient aucune base de données propre :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"   # expect 200
   ```

2. Vérifiez quel serveur MySQL/MariaDB phpMyAdmin est configuré pour cibler en
   inspectant les variables d'environnement `PMA_*` injectées dans la révision en cours d'exécution :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
     --format='value(spec.template.spec.containers[0].env)'
   ```

3. Ouvrez `$SERVICE_URL` dans un navigateur.
   - Si `PMA_ARBITRARY = "1"` (par défaut), la page de connexion affiche un champ de saisie du serveur —
     tapez l'hôte MySQL/MariaDB, puis votre nom d'utilisateur et votre mot de passe pour ce serveur.
   - Si un `pma_host` fixe est défini (`PMA_ARBITRARY = "0"`), seuls le nom d'utilisateur et le mot de passe
     sont affichés, limités à ce seul serveur.
   Dans les deux cas, **authentifiez-vous avec le compte propre du serveur MySQL cible** —
   phpMyAdmin n'a pas de compte administrateur propre à créer et ne conserve rien entre les
   requêtes hormis le cookie de session.

4. Pour administrer l'instance Cloud SQL MySQL partagée de la plateforme, trouvez d'abord son
   IP privée :

   ```bash
   gcloud sql instances list --project="$PROJECT" --filter="databaseVersion~MYSQL"
   gcloud sql instances describe <instance-name> --project="$PROJECT" \
     --format='value(ipAddresses[0].ipAddress)'
   ```

   Saisissez cette IP comme serveur (mode arbitraire) ou vérifiez qu'elle correspond au
   `pma_host` configuré (mode épinglé). Atteindre un serveur MySQL sur IP privée exige que la sortie
   VPC du service achemine les plages privées (`vpc_egress_setting = "PRIVATE_RANGES_ONLY"`,
   la valeur par défaut).

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente qui est saine) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances et en cliquant sur **Update** sur la
   page de détails du déploiement — le module est propriétaire de la spécification du service, la mise à l'échelle est donc une
   modification de configuration, et non une modification manuelle via `gcloud` (une modification manuelle serait annulée lors de
   la prochaine application). phpMyAdmin se met à l'échelle jusqu'à zéro par défaut (`min_instance_count = 0`,
   imposé par le module), puisqu'il s'agit d'une console d'administration interactive et sans état, sans
   traitement en arrière-plan.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme
   RAD et en l'appliquant via **Update** ; une nouvelle image est construite et une nouvelle révision
   est déployée. Comme phpMyAdmin ne détient ni schéma ni clés cryptographiques, les redéploiements
   et les montées de version ne comportent aucun des risques de migration/rotation de clés des autres
   modules avec état.

4. **Redirigez ou élargissez la cible MySQL** en modifiant `pma_host` / `pma_arbitrary` /
   `pma_port` dans la plateforme RAD et en appliquant **Update** — aucune migration de données n'est
   nécessaire puisque phpMyAdmin ne possède aucune donnée.

5. **Gérez l'entrée (ingress) et le contrôle d'accès** — comme phpMyAdmin accorde l'administration complète
   des bases de données à quiconque l'atteint avec des identifiants MySQL valides, passez en revue
   `ingress_settings` et envisagez d'activer `enable_iap` (avec
   `iap_authorized_users`/`iap_authorized_groups`) avant de le laisser tourner :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
     --format='value(spec.template.metadata.annotations)'
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre du Logs Explorer :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le nombre
   de requêtes, la latence des requêtes (P50/P95/P99), le nombre d'instances (comportement de mise à l'échelle à zéro
   et de démarrage à froid) et l'utilisation CPU/mémoire. Le module provisionne également un **test de
   disponibilité** (uptime check) lorsque le service est accessible publiquement ; vérifiez qu'il est au vert sous
   Monitoring → Uptime checks, et consultez Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit
de diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de phpMyAdmin.

- **Révision non saine / le service ne répond pas :** inspectez la dernière révision et ses
  journaux à la recherche d'erreurs de démarrage d'Apache/PHP. La sonde de démarrage cible `/` avec un court
  délai initial (10 s) et jusqu'à ~6 nouvelles tentatives à intervalle de 10 s — phpMyAdmin démarre en
  quelques secondes, donc un échec de sonde désigne presque toujours le conteneur lui-même, et non une
  dépendance lente (il n'en a aucune).
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **La page de connexion se charge mais chaque connexion échoue :** il s'agit d'un problème d'identifiants ou
  de joignabilité côté MySQL, et non d'un problème de phpMyAdmin ou de Cloud Run — phpMyAdmin ne stocke aucun
  identifiant propre. Vérifiez que l'hôte cible est correct, que le compte existe sur
  ce serveur MySQL et que les autorisations d'hôte du compte (`user@host`) permettent une connexion
  depuis le chemin de sortie du service Cloud Run.
- **« Cannot connect » / délai dépassé à la connexion :** vérifiez que `vpc_egress_setting` achemine les plages
  privées, que l'IP privée du serveur MySQL cible est correcte et que ses règles de pare-feu
  ou ses réseaux autorisés acceptent la plage du VPC de la plateforme.
- **Hôte MySQL erroné ou inattendu proposé à la connexion :** revérifiez les variables d'environnement `PMA_*`
  injectées dans la révision en cours d'exécution — une révision obsolète peut encore servir du trafic
  après une mise à jour :
  ```bash
  gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```
- **Échec du build de l'image :** consultez l'historique Cloud Build pour lire le journal du build en échec.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution et
  (si `enable_iap = true`) que votre identité figure dans `iap_authorized_users` ou
  `iap_authorized_groups`.

Consultez la section *Configuration Pitfalls & Sensible Defaults* du Guide de configuration pour les
pièges propres à chaque paramètre (notamment pourquoi laisser `ingress_settings = "all"` sans IAP
constitue une erreur de configuration à risque **Critical** pour un outil d'administration de bases de données, et pourquoi
`PMA_ARBITRARY = "1"` élargit le rayon d'impact d'une session compromise).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash**
(**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du
déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne
peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état
Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD
**sans** détruire les ressources cloud (RAD oublie le déploiement). La
suppression retire tout ce que le module a créé — le service Cloud Run et son image
Artifact Registry. Comme phpMyAdmin ne provisionne aucune base de données, aucun secret Secret Manager
ni aucun bucket de stockage propre, ce module n'a rien d'autre à nettoyer —
le serveur MySQL/MariaDB vers lequel il pointait n'est **pas** touché (il appartient à un autre composant,
généralement Services_GCP ou un autre module applicatif). Les ressources appartenant à
**Services_GCP** (le VPC, le Cloud SQL partagé, le registre) sont gérées séparément et ne sont
pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module construit/met en miroir l'image et provisionne uniquement le service Cloud Run — aucune base de données, aucun secret ni aucun bucket de stockage n'est créé |
| 2 — Accéder et vérifier | Manuel | La page de connexion renvoie 200 ; confirmer la cible MySQL configurée ; s'authentifier avec les identifiants propres à ce serveur |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l'échelle (mise à l'échelle à zéro par défaut), mettre à jour la version, rediriger la cible MySQL, passer en revue l'ingress/IAP |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de connectivité MySQL, d'ingress/IAM et de build |
| 6 — Démanteler | Automatisé | La suppression (Trash) retire le service Cloud Run et l'image ; le serveur MySQL externe n'est pas affecté |
