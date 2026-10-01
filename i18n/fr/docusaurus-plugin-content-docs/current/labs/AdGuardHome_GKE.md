---
title: "AdGuardHome sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployer AdGuardHome sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/AdGuardHome_GKE.md @ 3055034 sha256:80e6bc0b1ea6 -->

# AdGuardHome sur GKE Autopilot — Guide de lab {#adguardhome-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/AdGuardHome_GKE)**

> ⚠️ **ESSENTIEL — ce module ne sert pas de DNS.** La valeur principale d'AdGuard Home
> (le blocage DNS des publicités et des traceurs à l'échelle du réseau) exige que les clients l'interrogent sur le port
> 53 (TCP+UDP), ce que le modèle de passerelle HTTP(S) standard de ce module ne peut pas
> exposer. Ce lab déploie et vérifie **uniquement la console d'administration web** d'AdGuard Home
> — ne vous attendez pas à ce qu'il fonctionne comme un résolveur DNS opérationnel pour de vrais clients.

## Vue d'ensemble {#overview}

**Durée estimée :** 45–60 minutes

AdGuard Home est un serveur DNS open source de blocage des publicités et des traceurs à l'échelle du réseau,
doté d'une console d'administration web permettant de gérer les listes de filtres, les règles personnalisées et
les paramètres propres à chaque client. Ce lab vous fait parcourir l'intégralité du cycle de vie
opérationnel du module **AdGuard Home on GKE Autopilot** — déployer sa console
d'administration web, la vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les
problèmes courants et la démanteler.

Le lab se concentre sur l'exploitation du **module GKE et de la plateforme Google Cloud**,
et non sur les fonctionnalités de filtrage DNS d'AdGuard Home (qui ne sont pas joignables dans cette
forme de déploiement). Pour la liste complète des services provisionnés et de chaque
paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/AdGuardHome_GKE) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans le
temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez en mesure de :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE et accéder à la console d'administration en cours d'exécution (et comprendre ce qu'elle ne peut pas faire — servir un vrai DNS).
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour et gérer le stockage.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Artifact Registry
  et les comptes de service partagés dont dépend ce module). Vous n'avez pas besoin de le déployer
  vous-même au préalable — la plateforme détecte automatiquement s'il existe déjà
  dans le projet cible et, sinon, le provisionne avant ce module (voir
  la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` exécutés.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l'un ni l'autre.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez ces variables shell une seule fois ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **AdGuard Home
   (GKE)** depuis la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez
   `project_id` et passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/AdGuardHome_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état
   du déploiement avec les journaux en temps réel.

2. La plateforme déploie la charge de travail dans le cluster GKE Autopilot,
   provisionne deux buckets Cloud Storage (`conf` et `work`, montés via GCS
   Fuse CSI) et construit l'image de conteneur personnalisée. Il n'y a ni base de données ni
   tâche d'initialisation ; ce déploiement est donc plus rapide que la plupart des modules de ce
   catalogue — généralement **5–10 minutes**.

3. Connectez-vous au cluster et repérez l'espace de noms avec des filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep adguardhome | head -1 | cut -d/ -f2)
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
   echo "External IP: $EXTERNAL_IP   (web admin console ONLY — not a DNS resolver)"
   ```

2. Vérifiez que le service répond :

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' "http://${EXTERNAL_IP}/"   # expect 200
   ```

3. Ouvrez `http://${EXTERNAL_IP}` dans un navigateur. Lors de la première visite, AdGuard Home
   affiche son propre **assistant de configuration** (et non une connexion gérée par RAD) sur le port 3000 :
   choisissez le port de l'interface web d'administration (**conservez 3000** — voir la note sur les pièges
   ci-dessous), définissez le nom d'utilisateur et le mot de passe administrateur, puis sélectionnez les serveurs DNS
   en amont. Terminez l'assistant pour accéder au tableau de bord.

4. Vérifiez que la configuration a été conservée en actualisant la page — vous devriez arriver sur
   la page de connexion (et non de nouveau sur l'assistant de configuration), ce qui prouve que la configuration a été
   écrite sur le volume GCS persistant `conf` plutôt que perdue lors d'un redémarrage
   du pod.

5. **N'oubliez pas :** la fonction de serveur DNS de ce déploiement n'est pas joignable —
   seule la console d'administration web que vous venez de configurer l'est. Ne configurez pas de vrais
   appareils pour qu'ils utilisent l'IP de ce service comme serveur DNS.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail :**

   ```bash
   kubectl get deploy,pods -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances puis en cliquant sur **Update**
   sur la page de détails du déploiement — le module possède la spécification de la charge de travail, la
   mise à l'échelle est donc une modification de configuration, et non un `kubectl scale` manuel (une modification
   manuelle serait annulée lors de la prochaine application).

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la
   plateforme RAD et en l'appliquant via **Update** ; une nouvelle image est construite et une
   mise à jour progressive remplace le pod.

4. **Inspectez le stockage :**

   ```bash
   gcloud storage buckets list --project="$PROJECT" --filter="name~adguardhome"
   kubectl describe pod -n "$NS" -l app=adguardhome | grep -A5 Mounts
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Repérez la bannière de rappel sur la portée DNS affichée par le point d'entrée au début des
   journaux d'un nouveau pod. Filtre de l'explorateur de journaux :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation du CPU
   et de la mémoire des pods ainsi que le nombre de redémarrages. Le module peut provisionner un
   **test de disponibilité** (uptime check) (lorsqu'il est activé) ; consultez Monitoring → Uptime checks.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement.

- **Pod non Ready / CrashLoopBackOff :** inspectez les événements et les journaux.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Le pod ne devient plus Ready après que vous avez modifié le port de l'interface web dans l'assistant
  de configuration :** c'est le piège connu n° 1 de ce module — la sonde de santé de la plateforme
  et l'URL publique sont fixées sur `container_port` (3000). Si vous avez remplacé
  le port de l'interface web d'AdGuard Home par une valeur autre que 3000 pendant la configuration, rétablissez-le (modifiez
  `AdGuardHome.yaml` dans le bucket `conf`, ou relancez la configuration) ou définissez
  `container_port` sur la même valeur.
- **La configuration n'est pas conservée entre les redémarrages du pod :** vérifiez que les buckets GCS `conf`
  et `work` existent et sont montés (`kubectl describe pod` →
  section Mounts) — vérifiez que `gcs_volumes` n'a pas été remplacé par une valeur qui
  les omet.
- **« Est-ce que cela bloque réellement les publicités sur mon réseau ? »** Non — le serveur
  DNS de ce déploiement n'est pas joignable depuis l'extérieur du Service du cluster (qui ne
  transfère que le port HTTP de la console d'administration). C'est le comportement attendu ; voir la note ESSENTIEL
  en haut de ce guide.
- **Pod en attente / pas d'IP externe :** consultez les événements de `kubectl describe pod` pour repérer
  des problèmes de ressources ou de quotas, et vérifiez que le Service LoadBalancer dispose d'une
  IP attribuée.
- **Erreurs de récupération d'image :** vérifiez que l'image existe dans Artifact Registry et que
  le compte de service des nœuds peut la récupérer.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash**
(**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement
du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la
plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en
conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime le
déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD
oublie simplement le déploiement). Delete supprime tout ce que le module a créé —
la charge de travail Kubernetes et son espace de noms, les buckets GCS (`conf`, `work`) et les
images Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC, le cluster
GKE, le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie la charge de travail GKE, deux buckets GCS (`conf`, `work`) et construit l'image du conteneur |
| 2 — Accès et vérification | Manuel | Se connecter au cluster ; la vérification d'état réussit ; terminer l'assistant de configuration propre à AdGuard Home ; vérifier que la configuration est conservée |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, mettre à l'échelle, mettre à jour la version, inspecter le stockage |
| 4 — Observer | Manuel | Interroger Cloud Logging ; consulter les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de non-concordance de port, de stockage et de planification |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
