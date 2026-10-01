---
title: "PhpMyAdmin sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployer PhpMyAdmin sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/PhpMyAdmin_GKE.md @ 3055034 sha256:011967c0028c -->

# PhpMyAdmin sur GKE Autopilot — Guide de lab {#phpmyadmin-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/PhpMyAdmin_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

phpMyAdmin est l'outil web open source le plus populaire pour administrer des bases de données
MySQL et MariaDB depuis le navigateur — parcourir et modifier des tables, exécuter du SQL, gérer les utilisateurs,
et importer/exporter des données. Ce lab vous fait parcourir l'intégralité du cycle de vie opérationnel du
module **phpMyAdmin on GKE Autopilot** sur Google Cloud : le déployer, y accéder et le
vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et le démanteler.

Contrairement à la plupart des modules de ce dépôt, phpMyAdmin ne possède ni ne provisionne de
base de données — c'est un *client* qui se connecte à un serveur MySQL/MariaDB existant déjà ailleurs
(l'instance Cloud SQL partagée de la plateforme, une autre instance Cloud SQL
ou tout hôte joignable). « Déployer » phpMyAdmin signifie mettre en place l'interface web
et son chemin de connectivité vers ce serveur externe, et non créer un nouveau stockage de données.

Le lab se concentre sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non sur
les fonctionnalités du produit phpMyAdmin. Pour la liste complète des services provisionnés et de chaque
paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/PhpMyAdmin_GKE) — ce
lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez en mesure de :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE et accéder à la charge de travail phpMyAdmin en cours d'exécution.
- Confirmer le serveur MySQL/MariaDB que phpMyAdmin est configuré pour cibler.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour la version, et figer ou élargir la
  cible MySQL.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Cloud SQL, Artifact
  Registry et les comptes de service partagés dont dépend ce module — et, si vous
  souhaitez que phpMyAdmin l'administre, l'instance MySQL partagée de la plateforme). Vous
  n'avez pas besoin de le déployer vous-même au préalable — la plateforme détecte automatiquement
  s'il existe déjà dans le projet cible et, sinon, le provisionne avant ce
  module (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` exécutés.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l'un ni l'autre.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.
- Un accès à (ou des identifiants pour) un **serveur MySQL/MariaDB** que vous comptez administrer —
  phpMyAdmin ne crée aucune base de données qui lui soit propre.

Définissez ces variables shell une seule fois ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **PhpMyAdmin (GKE)** depuis
   la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue
   les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/PhpMyAdmin_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Décidez dès le départ si vous voulez
   `pma_arbitrary = "1"` (par défaut — les utilisateurs saisissent n'importe quel hôte MySQL à la connexion) ou un
   `pma_host` fixe avec `pma_arbitrary = "0"` (un seul serveur figé, par ex. l'IP privée Cloud SQL
   de la plateforme). Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme construit l'image de conteneur personnalisée minimale (`FROM phpmyadmin/phpmyadmin`),
   la réplique dans Artifact Registry et déploie la charge de travail dans le cluster GKE Autopilot
   sous la forme d'un `Deployment` sans état (pas de StatefulSet — phpMyAdmin ne conserve aucun état
   par pod) derrière un Service `LoadBalancer` externe. Il n'y a **ni instance Cloud SQL,
   ni secret Secret Manager, ni tâche d'initialisation de base de données** — phpMyAdmin
   ne provisionne aucun stockage de données qui lui soit propre. Les premiers déploiements ne prennent généralement que
   **5–10 minutes** (build de l'image, plus la planification et le provisionnement du LoadBalancer — sans
   le temps de provisionnement Cloud SQL que subissent les autres modules applicatifs).

3. Connectez-vous au cluster et repérez l'espace de noms avec un filtre indépendant des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep phpmyadmin | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accès et vérification [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que la charge de travail s'exécute et trouvez son adresse externe :

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Vérifiez que la charge de travail est opérationnelle. phpMyAdmin sert sa page de connexion sur `/` avec un `200`
   dès qu'Apache/PHP est prêt — il n'y a aucune dépendance de connectivité à une base de données à
   attendre, puisque phpMyAdmin ne détient aucune base de données qui lui soit propre :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/"   # expect 200
   ```

3. Confirmez le serveur MySQL/MariaDB que phpMyAdmin est configuré pour cibler en
   inspectant les variables d'environnement `PMA_*` injectées dans le pod en cours d'exécution :

   ```bash
   kubectl exec -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" \
     -- env | grep PMA_
   ```

4. Ouvrez `http://${EXTERNAL_IP}` dans un navigateur.
   - Si `PMA_ARBITRARY = "1"` (par défaut), la page de connexion affiche un champ de saisie du serveur —
     tapez l'hôte MySQL/MariaDB, puis votre nom d'utilisateur et votre mot de passe pour ce serveur.
   - Si un `pma_host` fixe est défini (`PMA_ARBITRARY = "0"`), seuls le nom d'utilisateur et le mot de passe
     sont affichés, limités à ce seul serveur.
   Dans les deux cas, **authentifiez-vous avec le compte propre du serveur MySQL cible** —
   phpMyAdmin n'a aucun compte administrateur propre à créer, et ne stocke rien entre les
   requêtes au-delà du cookie de session.

5. Pour administrer l'instance MySQL Cloud SQL partagée de la plateforme, trouvez d'abord son
   IP privée :

   ```bash
   gcloud sql instances list --project="$PROJECT" --filter="databaseVersion~MYSQL"
   gcloud sql instances describe <instance-name> --project="$PROJECT" \
     --format='value(ipAddresses[0].ipAddress)'
   ```

   Saisissez cette IP comme serveur (mode arbitraire) ou vérifiez qu'elle correspond au
   `pma_host` configuré (mode figé). Les pods atteignent un serveur MySQL à IP privée directement via le
   réseau VPC du cluster — aucun sidecar Auth Proxy n'est utilisé
   (`enable_cloudsql_volume = false`, puisque phpMyAdmin n'utilise pas l'intégration Cloud SQL
   propre à la plateforme).

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — le déploiement, les pods et l'autoscaler horizontal :

   ```bash
   kubectl get deploy,pods,hpa -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances puis en cliquant sur **Update** sur la
   page de détails du déploiement — le module possède la spécification de la charge de travail, la mise à l'échelle est donc une
   modification de configuration, et non un `kubectl scale` manuel (une modification manuelle serait annulée
   lors de la prochaine application). Contrairement à la variante Cloud Run, GKE ne permet pas la mise à l'échelle à zéro ;
   `min_instance_count` vaut donc `1` par défaut — gardez-le à au moins 1 pour que la console reste
   joignable.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme RAD
   et en l'appliquant via **Update** ; une nouvelle image est construite et une mise à jour progressive
   remplace les pods. Comme phpMyAdmin ne détient ni schéma ni clés cryptographiques,
   les mises à jour progressives et les changements de version ne comportent aucun des risques de migration/rotation de clés
   des autres modules avec état, et comme le Deployment est sans état (pas de
   `stateful_pvc_enabled`), les pods ne partagent aucun volume ni verrou sur lequel se bloquer.

4. **Redirigez ou élargissez la cible MySQL** en modifiant `pma_host` / `pma_arbitrary` /
   `pma_port` dans la plateforme RAD et en appliquant **Update** — aucune migration de données n'est
   nécessaire puisque phpMyAdmin ne possède aucune donnée.

5. **Gérez l'entrée et le contrôle d'accès** — comme phpMyAdmin accorde l'administration complète
   de la base de données à quiconque l'atteint avec des identifiants MySQL valides, examinez
   `service_type` (`LoadBalancer` externe par défaut) et envisagez `ClusterIP` derrière
   un Ingress protégé par IAP avant de le laisser en service :

   ```bash
   kubectl get svc,ingress -n "$NS"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre de l'explorateur de journaux :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation du CPU et de la
   mémoire des pods ainsi que le nombre de redémarrages. Le module peut provisionner un **test de disponibilité** (uptime check)
   (lorsqu'il est activé) ; consultez Monitoring → Uptime checks et Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de phpMyAdmin.

- **Pod non Ready / CrashLoopBackOff :** inspectez les événements et les journaux. La sonde de démarrage
  cible `/` avec un court délai initial (10s) et jusqu'à ~6 nouvelles tentatives à une période de 10s —
  phpMyAdmin démarre en quelques secondes ; un échec de sonde désigne donc presque toujours le
  conteneur lui-même, et non une dépendance lente (il n'en a aucune).
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **La page de connexion s'affiche mais chaque connexion échoue :** il s'agit d'un problème d'identifiants ou
  de joignabilité côté MySQL, et non d'un problème phpMyAdmin ou GKE — phpMyAdmin ne stocke aucun
  identifiant qui lui soit propre. Vérifiez que l'hôte cible est correct, que le compte existe sur
  ce serveur MySQL et que les autorisations d'hôte du compte (`user@host`) permettent une connexion
  depuis la plage d'IP des nœuds/pods du cluster.
- **« Cannot connect » / délai dépassé à la connexion :** vérifiez que l'IP privée du serveur MySQL cible
  est correcte et joignable depuis le VPC du cluster, et que ses règles de pare-feu ou ses
  réseaux autorisés admettent la plage du cluster. Comme `enable_cloudsql_volume =
  false`, il n'y a aucun sidecar Auth Proxy dans le pod à vérifier — la connectivité est directe.
- **Hôte MySQL erroné ou inattendu proposé à la connexion :** revérifiez les variables d'environnement `PMA_*`
  injectées dans le pod en cours d'exécution — un pod obsolète issu d'un déploiement précédent peut encore servir
  du trafic :
  ```bash
  kubectl exec -n "$NS" deploy/<service-name> -- env | grep PMA_
  ```
- **Pod en attente / pas d'IP externe :** consultez les événements de `kubectl describe pod` pour repérer des problèmes
  de ressources ou de quotas, et vérifiez que le Service LoadBalancer dispose d'une IP attribuée.
- **Erreurs de récupération d'image :** vérifiez que l'image existe dans Artifact Registry et que le
  compte de service des nœuds peut la récupérer.

Consultez la section *Configuration Pitfalls & Sensible Defaults* du Guide de configuration pour
les pièges propres à chaque paramètre (notamment pourquoi un `LoadBalancer` externe non authentifié
sans IAP constitue une erreur de configuration à risque **Critical** pour un outil d'administration de base de données, pourquoi
un `database_type` autre que `NONE` est bloqué par une garde de validation au moment du plan, et pourquoi
`PMA_ARBITRARY = "1"` élargit le rayon d'impact d'une session compromise).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash**
(**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement
est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut
plus le gérer (par exemple après des modifications manuelles en conflit avec l'état
Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime le déploiement des enregistrements de RAD
**sans** détruire les ressources cloud (RAD oublie simplement le déploiement). Delete
supprime tout ce que le module a créé — la charge de travail Kubernetes et son espace de noms, le
Service LoadBalancer et l'image Artifact Registry. Comme phpMyAdmin ne provisionne
ni base de données, ni secrets Secret Manager, ni bucket de stockage qui lui soient propres, il n'y a
rien d'autre à nettoyer pour ce module — le serveur MySQL/MariaDB vers lequel il pointait
n'est **pas** touché (il appartient à un autre composant, généralement Services_GCP ou un autre
module applicatif). Les ressources appartenant à **Services_GCP** (le VPC, le cluster GKE,
le Cloud SQL partagé, le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module construit/réplique l'image et déploie uniquement la charge de travail GKE + le LoadBalancer — aucune base de données, aucun secret ni bucket de stockage n'est créé |
| 2 — Accès et vérification | Manuel | Se connecter au cluster ; la page de connexion renvoie 200 ; confirmer la cible MySQL configurée ; s'authentifier avec les identifiants propres à ce serveur |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, mettre à l'échelle (min 1, pas de mise à l'échelle à zéro sur GKE), mettre à jour la version, rediriger la cible MySQL, examiner l'entrée/IAP |
| 4 — Observer | Manuel | Interroger Cloud Logging ; consulter les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de connectivité MySQL, de planification/LB et de récupération d'image |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime la charge de travail, l'espace de noms et l'image ; le serveur MySQL externe n'est pas affecté |
