---
title: "TechnitiumDNS sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez TechnitiumDNS sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/TechnitiumDNS_GKE.md @ 3055034 sha256:eba602edf49e -->

# TechnitiumDNS sur GKE Autopilot — Guide de lab {#technitiumdns-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/TechnitiumDNS_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

> ⚠️ **Avant de commencer :** ce module déploie **uniquement la console d'administration web et l'API REST** de Technitium
> (port 5380/HTTP). La fonction principale de résolveur DNS de Technitium (port 53/udp+tcp) **ne peut pas** être exposée
> via le modèle de passerelle (Gateway) HTTP(S) standard de ce module. Ce lab couvre la gestion des zones et enregistrements DNS via
> la console — il ne rend PAS ce déploiement utilisable comme véritable résolveur DNS depuis un client quelconque.

Technitium DNS Server est un serveur DNS faisant autorité/récursif, open source et auto-hébergé, doté
d'une console web complète pour gérer les zones, les enregistrements, le blocage basé sur le DNS et les redirecteurs — sans
base de données externe. Ce lab vous fait parcourir tout le cycle de vie opérationnel du module **TechnitiumDNS on
GKE Autopilot** sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer,
diagnostiquer les problèmes courants et le supprimer.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non sur les fonctionnalités
de serveur DNS de TechnitiumDNS. Pour la liste complète des services provisionnés et de chaque paramètre de configuration
(organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/TechnitiumDNS_GKE) — ce lab
ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE et accéder à la charge de travail en cours d'exécution, y compris une première connexion et un
  test rapide de création de zone.
- Effectuer les opérations du jour 2 — inspecter, mettre à jour, et gérer les secrets et le stockage.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Artifact Registry
  et les comptes de service partagés dont dépend ce module). Vous n'avez pas
  besoin de le déployer vous-même au préalable — la plateforme détecte
  automatiquement s'il existe déjà dans le projet cible et, sinon, le
  provisionne avant ce module (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` exécutés.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans ce projet, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne requiert ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Sur un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **TechnitiumDNS (GKE)** dans la
   liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou êtes partenaire ou administrateur), définissez `project_id` et passez en revue les paramètres. Ne configurez
   que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/TechnitiumDNS_GKE) documente chaque
   paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel. Si vous déployez à côté de
   `TechnitiumDNS_CloudRun` sur le même tenant, définissez un `tenant_id` distinct (par ex. `"gke"`) pour
   éviter une collision de noms.

2. La plateforme déploie une unique charge de travail Deployment dans le cluster GKE Autopilot, exécutant l'image officielle
   préconstruite `technitium/dns-server`, ainsi qu'un bucket Cloud Storage (monté sur `/etc/dns`) et un
   secret de mot de passe administrateur généré automatiquement. Aucune base de données n'est provisionnée. Comme l'image est préconstruite (aucune
   étape Cloud Build) et qu'il n'y a aucun job d'initialisation de base de données à attendre, un premier déploiement est
   généralement rapide (environ **8–15 minutes**, essentiellement consacrées à la planification de la charge de travail).

3. Connectez-vous au cluster et identifiez l'espace de noms avec un filtre indépendant des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep technitiumdns | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que la charge de travail s'exécute et repérez son adresse externe :

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Vérifiez que le service est opérationnel — la page racine de la console répond dès que le serveur s'attache à son
   port, sans dépendance de base de données à attendre :

   ```bash
   curl -s -o /dev/null -w '%{http_code} %{size_download}\n' "http://${EXTERNAL_IP}/"
   # expect 200 and a large body
   ```

3. Récupérez le mot de passe administrateur généré automatiquement :

   ```bash
   SECRET=$(gcloud secrets list --project="$PROJECT" --filter="name~admin-password" \
     --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$SECRET" --project="$PROJECT"
   ```

4. Ouvrez `http://${EXTERNAL_IP}/` dans un navigateur et connectez-vous en tant que `admin` avec ce mot de passe. **Changez
   immédiatement le mot de passe depuis la page de gestion des utilisateurs de la console elle-même** — Technitium ne lit
   `DNS_SERVER_ADMIN_PASSWORD` qu'au tout premier démarrage.

5. Effectuez un test rapide de création de zone : dans **Zones → Add Zone**, créez une zone primaire simple
   (par ex. `example.test`), ajoutez un enregistrement `A`, enregistrez, puis supprimez le pod (`kubectl delete pod <pod> -n
   "$NS"`) pour forcer une nouvelle planification, et vérifiez que la zone et l'enregistrement sont toujours présents une fois le nouveau pod
   prêt — ce qui prouve que le volume persistant `/etc/dns` survit réellement au redémarrage d'un pod.

6. Rappel : **aucun client, où qu'il soit, ne peut résoudre de requêtes DNS auprès de ce déploiement.** La console vous permet
   de gérer entièrement les données de zone, mais seuls la console web et l'API sont joignables — pas le port 53.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — le déploiement et les pods :

   ```bash
   kubectl get deploy,pods -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme RAD et en l'appliquant
   via **Update** ; une mise à jour progressive remplace le pod par l'image préconstruite portant le nouveau tag. Fixez une
   version explicite en production plutôt que de vous fier à `latest`.

3. **Gérez les secrets et le stockage :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~technitiumdns"
   kubectl get pvc -n "$NS"          # only present when stateful_pvc_enabled = true
   ```

   Seul le `DNS_SERVER_ADMIN_PASSWORD` généré automatiquement apparaît par défaut dans Secret Manager.

4. **Passez à un PVC en mode bloc** pour des garanties de verrouillage en écriture plus fortes, si vous le souhaitez : définissez
   `stateful_pvc_enabled = true` (avec `stateful_pvc_mount_path = "/etc/dns"`, ou laissez `workload_type`
   non défini pour sélectionner automatiquement `StatefulSet`) et appliquez via **Update**. Le module désactive alors automatiquement le
   volume GCS FUSE pour éviter un double montage.

5. **Activez Identity-Aware Proxy** pour un déploiement de production — définissez `enable_iap = true` avec les utilisateurs/groupes
   autorisés (ainsi que l'ID et le secret client OAuth requis) et appliquez via **Update**.

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre du Logs Explorer : `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation CPU et mémoire des pods,
   le nombre de redémarrages et les métriques de requêtes. Si un **test de disponibilité** (uptime check) Cloud Monitoring est activé, consultez
   Monitoring → Uptime checks et Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Ce sont des diagnostics
au niveau de la plateforme, qui ne changent pas avec les versions de TechnitiumDNS.

- **Pod non prêt / CrashLoopBackOff :** inspectez les événements et les journaux. Les sondes de démarrage et de vivacité
  ciblent toutes deux `/`, qui doit renvoyer `200` quelques secondes après le démarrage — TechnitiumDNS n'a aucune base de données à
  attendre ; une sonde lente ou en échec signale donc généralement un problème de conteneur ou de montage du stockage plutôt qu'une
  dépendance en aval.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **« Je ne peux pas résoudre de DNS auprès de ce déploiement » :** c'est attendu — voir l'avertissement en haut de
  ce guide. Ce module n'expose volontairement que la console web et l'API, jamais le port 53.
- **Les zones/enregistrements disparaissent après le redémarrage d'un pod :** vérifiez que le bucket Cloud Storage de configuration ou le PVC est
  réellement monté :
  ```bash
  kubectl exec -n "$NS" <pod> -- ls -l /etc/dns
  kubectl get pvc -n "$NS"    # if stateful_pvc_enabled = true
  ```
- **Impossible de se connecter avec le mot de passe de Secret Manager :** rappelez-vous qu'il ne s'applique qu'au tout premier démarrage. Si
  la console a déjà été démarrée auparavant avec le même volume persistant, le mot de passe déjà présent sur le disque
  l'emporte — utilisez le parcours de réinitialisation du mot de passe de la console.
- **Pod en attente / aucune IP externe :** consultez les événements de `kubectl describe pod` à la recherche de problèmes de ressources ou de quota, et
  vérifiez que le Service LoadBalancer a reçu une IP :
  ```bash
  kubectl get svc -n "$NS"
  ```
- **Un basculement de stateful_pvc_enabled a laissé à la fois un volume GCS ET un PVC :** vérifiez qu'un seul est monté sur
  `/etc/dns` — le module doit désactiver automatiquement le volume GCS lorsque le PVC est activé ; si les deux
  apparaissent malgré tout, redéployez après avoir nettoyé l'état.
- **Erreurs de récupération d'image :** vérifiez que l'image existe dans Artifact Registry (si elle est mise en miroir) et que le compte de service
  des nœuds peut la récupérer.

Consultez la section *Configuration Pitfalls & Sensible Defaults* du Guide de configuration pour les pièges propres
à chaque paramètre (dont le choix de périmètre sans résolveur DNS et l'exigence relative au chemin de montage du PVC).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute
`terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement
est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit
avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — elle retire le déploiement des enregistrements de RAD
**sans** détruire les ressources cloud (RAD oublie simplement le déploiement). La suppression retire tout ce que le
module a créé — la charge de travail Kubernetes et son espace de noms, l'éventuel PVC, le bucket Cloud Storage de configuration, le
secret du mot de passe administrateur et les images Artifact Registry. Il n'y a aucune base de données Cloud SQL à nettoyer
(TechnitiumDNS n'en provisionne aucune). Les ressources appartenant à **Services_GCP** (le VPC, le cluster GKE, le registre
partagé) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie une unique charge de travail GKE exécutant l'image TechnitiumDNS préconstruite, un bucket de configuration et un secret |
| 2 — Accéder et vérifier | Manuel | Se connecter au cluster ; le contrôle de santé réussit ; la première connexion aboutit ; une zone/un enregistrement survit au redémarrage d'un pod |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, mettre à jour la version, gérer les secrets/le stockage, passer éventuellement à un PVC en mode bloc, activer IAP |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de persistance du stockage, de planification et de récupération d'image ; confirmer le périmètre sans résolveur DNS |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
