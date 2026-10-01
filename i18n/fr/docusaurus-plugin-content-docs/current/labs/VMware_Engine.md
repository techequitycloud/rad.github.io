---
title: "Google Cloud VMware Engine — Guide de lab"
description: "Lab pratique : provisionnez Google Cloud VMware Engine dans votre propre projet — mise en place du cloud privé, vérification, exploitation et suppression."
---

<!-- translated-from: docs/labs/VMware_Engine.md @ 3055034 sha256:09ac528388a9 -->

# Google Cloud VMware Engine — Guide de lab {#google-cloud-vmware-engine--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/VMware_Engine)**

## Vue d'ensemble {#overview}

**Durée estimée :** 150–180 minutes (en grande partie de l'attente — la création du cloud privé peut à elle seule prendre **~2 heures** pour les types plus importants ; un cloud `TIME_LIMITED` à un seul nœud est généralement prêt en 30 à 90 minutes).

Google Cloud VMware Engine (GCVE) exécute un Software-Defined Data Center VMware complet — vSphere, vSAN, NSX-T et HCX — sur du matériel bare metal géré par Google, de sorte que vos outils et compétences VMware existants restent utilisables sans changement. Ce lab vous fait parcourir le cycle de vie opérationnel complet du module **VMware Engine** : le déployer, confirmer que le cloud privé démarre et atteindre vCenter via l'hôte de rebond (jump host), exploiter l'environnement au quotidien, l'observer, diagnostiquer les problèmes courants et le supprimer.

Le lab porte sur l'exploitation du **module et de la plateforme Google Cloud**, et non sur le fonctionnement interne des produits VMware. Pour la liste complète des services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le [Guide de configuration](https://docs.radmodules.dev/docs/modules/VMware_Engine) — ce lab ne reprend volontairement pas ce détail afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Confirmer que le cloud privé atteint l'état `ACTIVE` et récupérer les identifiants vCenter.
- Atteindre les consoles vCenter, NSX-T et HCX via l'hôte de rebond Windows.
- Effectuer les opérations du jour 2 — explorer vCenter, gérer le cloud privé et sa mise en réseau.
- Observer l'environnement avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- Un projet Google Cloud avec la **facturation activée** et un **quota de nœuds VMware Engine** dans la zone cible (au moins 1 nœud pour `TIME_LIMITED`).
- **gcloud CLI** installé ; `gcloud auth login` et `gcloud auth application-default login` effectués.
- Un **client RDP** (intégré sous Windows ; **Windows App** sous macOS ; Remmina/FreeRDP sous Linux) et un navigateur web pour les consoles d'administration.
- Le rôle IAM **Project Owner** (ou un équivalent administrateur VMware Engine + Compute) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres. Tout autre paramètre du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifie ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Sur un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

> **Remarque sur les coûts :** un nœud VMware Engine est facturé à un tarif horaire élevé. Privilégiez un cloud privé `TIME_LIMITED` à un seul nœud pour ce lab et supprimez-le rapidement une fois terminé.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-west2"        # the region you deploy into
export ZONE="us-west2-a"        # the zone you deploy into (must be within REGION)
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **VMware Engine** dans la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id` et passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le [Guide de configuration](https://docs.radmodules.dev/docs/modules/VMware_Engine) documente chaque paramètre par groupe, avec ses valeurs par défaut. Pour un lab, conservez `private_cloud_type = TIME_LIMITED` et `node_count = 1`. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le réseau VMware Engine, le cloud privé (vCenter, vSAN, NSX-T, HCX), l'appairage VPC avec un VPC pair Google Cloud, la stratégie réseau, les règles de pare-feu et un hôte de rebond Windows Server 2022, puis réinitialise et affiche les identifiants vCenter. **La création du cloud privé représente l'essentiel de la durée** — comptez 30 à 90 minutes pour un cloud `TIME_LIMITED` à un seul nœud, et jusqu'à **~2 heures** pour les types plus importants. Le déploiement semblera immobile pendant cette période ; c'est normal — ne l'interrompez pas.

3. Pendant l'exécution, vous pouvez suivre le démarrage du cloud privé :

   ```bash
   PC=$(gcloud vmware private-clouds list --location="$ZONE" --project="$PROJECT" \
     --format="value(name)" --limit=1)
   gcloud vmware private-clouds describe "$PC" --location="$ZONE" --project="$PROJECT" \
     --format="value(state)"    # CREATING → ACTIVE
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. **Confirmez que le cloud privé est `ACTIVE`** et relevez les FQDN des consoles :

   ```bash
   gcloud vmware private-clouds describe "$PC" --location="$ZONE" --project="$PROJECT" \
     --format="yaml(state, vcenter.fqdn, nsx.fqdn, hcx.fqdn)"
   ```

2. **Récupérez les identifiants vCenter.** Les journaux du déploiement les affichent après la réinitialisation ; vous pouvez aussi les obtenir à la demande :

   ```bash
   gcloud vmware private-clouds vcenter credentials describe \
     --private-cloud="$PC" --username="solution-user-01@gve.local" \
     --location="$ZONE" --project="$PROJECT"
   ```

3. **Générez un mot de passe Windows et trouvez l'IP externe de l'hôte de rebond :**

   ```bash
   JUMP=$(gcloud compute instances list --filter="name~^altostrat-[0-9]+-jump-host$" --project="$PROJECT" \
     --format="value(name)")
   gcloud compute instances list --filter="name~^altostrat-[0-9]+-jump-host$" --project="$PROJECT" \
     --format="table(name, status, networkInterfaces[0].accessConfigs[0].natIP)"
   gcloud compute reset-windows-password "$JUMP" --zone="$ZONE" --project="$PROJECT"
   ```

4. **Connectez-vous en RDP à l'hôte de rebond** à l'adresse `<external-ip>:3389` avec le nom d'utilisateur et le mot de passe générés, puis ouvrez un navigateur dans la session et accédez à `https://<vcenter-fqdn>`. Acceptez le certificat autosigné et connectez-vous avec les identifiants vCenter. (Sous macOS, utilisez **Windows App** : `brew install --cask windows-app`. Sous Linux : `xfreerdp /u:<user> /p:<pass> /v:<ip>:3389`.) Les consoles ne sont joignables que depuis l'hôte de rebond, et non depuis votre poste de travail.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Explorez vCenter** depuis le navigateur de l'hôte de rebond — Hosts and Clusters (le cluster de gestion et ses nœuds), Storage (le datastore vSAN) et Networking. Connectez-vous à NSX-T Manager à l'adresse `https://<nsx-fqdn>` pour consulter les segments, le DHCP et le routage.

2. **Gérez le cloud privé** depuis la CLI — inspectez ses clusters et ses sous-réseaux et (sur les clouds `STANDARD`) ajoutez des clusters de charges de travail :

   ```bash
   gcloud vmware private-clouds clusters list --private-cloud="$PC" \
     --location="$ZONE" --project="$PROJECT"
   gcloud vmware private-clouds subnets list --private-cloud="$PC" \
     --location="$ZONE" --project="$PROJECT"
   ```

3. **Examinez la mise en réseau** — l'appairage VPC et la stratégie réseau qui contrôle l'accès à Internet / aux IP externes :

   ```bash
   gcloud vmware network-peerings list --location=global --project="$PROJECT" \
     --format="table(name, state)"
   gcloud vmware network-policies list --location="$REGION" --project="$PROJECT" \
     --format="table(name, internetAccess.enabled, externalIp.enabled, edgeServicesCidr)"
   ```

4. **Modifiez la configuration via la plateforme.** Pour ajuster la stratégie réseau, le nombre de nœuds (`STANDARD`), les règles de pare-feu ou le dimensionnement de l'hôte de rebond, modifiez les paramètres et cliquez sur **Update** sur la page de détails du déploiement — le module gère ces ressources, les modifications de configuration doivent donc passer par la plateforme plutôt que par des modifications ponctuelles dans la console. Notez que `management_cidr`, `private_cloud_type` et `deployment_id` ne peuvent pas être modifiés sur place.

5. **Renouvelez les identifiants vCenter** s'ils expirent (relancez la réinitialisation) :

   ```bash
   gcloud vmware private-clouds vcenter credentials reset \
     --private-cloud="$PC" --username="solution-user-01@gve.local" \
     --location="$ZONE" --project="$PROJECT" --no-async
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux d'audit VMware Engine** — chaque opération sur le cloud privé, l'appairage et la stratégie :

   ```bash
   gcloud logging read 'protoPayload.serviceName="vmwareengine.googleapis.com"' \
     --project="$PROJECT" --limit=20 \
     --format='value(timestamp, protoPayload.methodName, protoPayload.authenticationInfo.principalEmail)'
   ```

2. **Métriques et journaux de l'hôte de rebond** — ouvrez Monitoring → Dashboards pour l'instance Compute Engine (CPU, mémoire, disque), et Logging → Logs Explorer filtré sur `resource.type="gce_instance"` pour les journaux système.

3. **Vues des consoles** — VMware Engine → Resources affiche l'état de santé du cloud privé, et les consoles vCenter/NSX-T (via l'hôte de rebond) exposent l'état de santé de vSAN et l'état des clusters.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de GCVE.

- **Déploiement « bloqué » pendant une heure ou plus :** c'est presque toujours normal — le provisionnement d'un cloud privé est lent (la ressource dispose d'un délai d'expiration de 180 minutes). Confirmez la progression avec `gcloud vmware private-clouds describe ... --format="value(state)"` (`CREATING` → `ACTIVE`). N'interrompez pas le déploiement.
- **`Resource for the given network already exists` (stratégie réseau) :** GCVE n'autorise qu'une seule stratégie réseau par réseau VMware Engine. Une stratégie restante d'une exécution précédente en échec bloque la recréation — listez-la avec `gcloud vmware network-policies list --location="$REGION"` et supprimez-la, puis redéployez.
- **Impossible d'atteindre vCenter/NSX-T depuis votre ordinateur portable :** les FQDN se résolvent en IP privées joignables uniquement depuis le VPC pair. Ouvrez-les toujours depuis la session RDP de l'hôte de rebond.
- **Connexion à vCenter refusée :** le mot de passe de solution-user a peut-être expiré, ou la réinitialisation a été ignorée (pas de `gcloud` dans l'exécuteur). Relancez la commande de réinitialisation de la tâche 3, puis exécutez describe pour lire le nouveau mot de passe.
- **L'appairage affiche `CREATING`/`INACTIVE` :** l'appairage ne passe à `ACTIVE` qu'une fois le provisionnement du cloud privé terminé — attendez d'abord que le cloud atteigne `ACTIVE`.
- **Erreurs de type de nœud ou de quota à la création :** les types de nœuds dépendent de la zone et nécessitent un quota. Vérifiez leur disponibilité avec `gcloud vmware node-types list --location="$ZONE"` et demandez un quota sous IAM & Admin → Quotas.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres à chaque paramètre.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible — elle supprime le cloud privé (et **chaque VM et toutes les données qu'il contient**), le réseau VMware Engine et l'appairage, la stratégie réseau, le VPC pair et les règles de pare-feu, ainsi que l'hôte de rebond. La suppression est correctement ordonnée (la stratégie et l'appairage avant le réseau) et elle est **lente** — le déprovisionnement du bare metal peut prendre beaucoup de temps, laissez-la donc aller jusqu'au bout.

Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles dans la console en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement, mais le cloud privé GCVE et tout le reste continuent de s'exécuter et d'être facturés). Après une purge, nettoyez les ressources manuellement.

> **Sauvegardez d'abord.** La suppression du cloud privé détruit définitivement toutes les VM et les données du SDDC. Migrez ou sauvegardez vos charges de travail avant la suppression.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne le réseau VMware Engine, le cloud privé, l'appairage, la stratégie, le pare-feu et l'hôte de rebond |
| 2 — Accéder et vérifier | Manuel | Le cloud privé est `ACTIVE` ; identifiants vCenter récupérés ; consoles atteintes via l'hôte de rebond |
| 3 — Exploiter | Manuel | Explorer vCenter/NSX-T ; gérer le cloud privé et la mise en réseau ; renouveler les identifiants |
| 4 — Observer | Manuel | Interroger les journaux d'audit VMware Engine ; examiner les métriques de l'hôte de rebond et l'état de santé dans les consoles |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de provisionnement lent, de stratégies orphelines, d'accès aux consoles et de quota |
| 6 — Démanteler | Automatisé | Delete (Trash) détruit toutes les ressources ; Purge retire le déploiement de RAD sans rien détruire |
