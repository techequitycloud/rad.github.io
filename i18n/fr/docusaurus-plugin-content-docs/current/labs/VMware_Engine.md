---
title: "Google Cloud VMware Engine — Guide de Lab"
description: "Lab pratique : provisionner Google Cloud VMware Engine dans votre propre projet — configuration, vérification, opérations et suppression du cloud privé."
---

<!-- translated-from: docs/labs/VMware_Engine.md @ 7d02aa0b sha256:8837f3cd1009 -->

# Google Cloud VMware Engine — Guide de Lab {#google-cloud-vmware-engine--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/VMware_Engine)**

## Vue d'ensemble {#overview}

**Temps estimé :** 150–180 minutes (la majeure partie est de l'attente — la création d'un cloud privé peut prendre à elle seule **~2 heures** pour les types plus grands ; un cloud `TIME_LIMITED` à nœud unique est généralement prêt en 30–90 minutes).

Google Cloud VMware Engine (GCVE) exécute un centre de données VMware Software-Defined complet — vSphere, vSAN, NSX-T et HCX — sur du matériel bare-metal géré par Google, de sorte que vos outils et compétences VMware existants sont transférés sans changement. Ce lab vous guide à travers le cycle de vie opérationnel complet du module **VMware Engine** : déployez-le, confirmez que le cloud privé se met en place et accédez à vCenter via l'hôte de rebond, exploitez l'environnement au quotidien, observez-le, diagnostiquez les problèmes courants et supprimez-le.

Le lab se concentre sur l'exploitation du **module et de la plateforme Google Cloud**, et non sur les détails internes des produits VMware. Pour la liste complète des services provisionnés et de chaque entrée de configuration (organisée par groupe), consultez le [Guide de configuration](https://docs.radmodules.dev/docs/modules/VMware_Engine) — ce lab ne duplique délibérément pas ces détails afin qu'ils restent précis au fil du temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez capable de :

- Déployer le module depuis la plateforme RAD et localiser les ressources qu'il provisionne.
- Confirmer que le cloud privé atteint `ACTIVE` et récupérer les identifiants vCenter.
- Accéder aux consoles vCenter, NSX-T et HCX via l'hôte de rebond Windows.
- Effectuer des opérations de jour 2 — explorer vCenter, gérer le cloud privé et sa mise en réseau.
- Observer l'environnement avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Supprimer proprement le déploiement.

## Prérequis {#prerequisites}

- Un projet Google Cloud avec la **facturation activée** et le **quota de nœuds VMware Engine** dans la zone cible (au moins 1 nœud pour `TIME_LIMITED`).
- **gcloud CLI** installé ; `gcloud auth login` et `gcloud auth application-default login` complétés.
- Un **client RDP** (intégré sur Windows ; **Windows App** sur macOS ; Remmina/FreeRDP sur Linux) et un navigateur web pour les consoles de gestion.
- Rôle **Propriétaire du projet** (ou administrateur VMware Engine + Compute équivalent) IAM sur le projet.
- **Votre propre projet uniquement.** Ce module masque l'option **Projet GCP sur RAD** (`enable_rad_gcpproject = false`) car il active `vmwareengine` et `vmmigration`, ce que les politiques de niveau géré par RAD ne permettent pas, il se déploie donc toujours dans un projet que vous apportez. Avant le premier déploiement, la boîte de dialogue de confirmation de déploiement vous demande de prouver que vous le contrôlez (**Obtenir le code de vérification**, exécutez les commandes qu'il affiche en tant que Propriétaire du projet, puis **Vérifier**) et de donner le rôle **Propriétaire** au compte de service de déploiement RAD.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page d'entrées. Toutes les autres entrées du Guide de configuration — y compris les entrées de mise à l'échelle et de version dans les tâches de jour 2 — sont modifiées par la suite avec **Mettre à jour** sur la page du déploiement après avoir coché **Activer le mode avancé**, ce qui nécessite un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

> **Note de coût :** un nœud VMware Engine est facturé à un taux horaire élevé. Préférez un cloud privé `TIME_LIMITED` à nœud unique pour ce lab et supprimez-le rapidement une fois terminé.

Définissez ces variables shell une fois ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-west2"        # the region you deploy into
export ZONE="us-west2-a"        # the zone you deploy into (must be within REGION)
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Catalogue de solutions → Modules RAD** dans la navigation supérieure de la plateforme RAD, ouvrez **VMware Engine** depuis la liste **Modules de plateforme** pour commencer la configuration, choisissez **Formulaire de configuration** sous *Comment souhaitez-vous configurer ce déploiement ?* (le formulaire s'ouvre sur l'**Assistant conversationnel** si vous détenez des crédits achetés ou si vous êtes un partenaire ou un administrateur), définissez `project_id` et examinez les entrées. Ne configurez que ce dont vous avez besoin — le [Guide de configuration](https://docs.radmodules.dev/docs/modules/VMware_Engine) documente chaque entrée par groupe, avec les valeurs par défaut. Pour un lab, conservez `private_cloud_type = TIME_LIMITED` et `node_count = 1`. Cliquez sur **Déployer le module**, examinez le coût estimé dans la boîte de dialogue **Confirmation de déploiement** lorsqu'elle apparaît et cliquez sur **Soumettre** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, complétez-la et cliquez sur **Confirmer**), ce qui ouvre la page d'état du déploiement avec des journaux en temps réel.

2. La plateforme provisionne le réseau VMware Engine, le cloud privé (vCenter, vSAN, NSX-T, HCX), le peering VPC dans un VPC pair Google Cloud, la politique réseau, les règles de pare-feu et un hôte de rebond Windows Server 2022, puis réinitialise et imprime les identifiants vCenter. **La création du cloud privé domine le temps** — attendez-vous à 30–90 minutes pour un cloud `TIME_LIMITED` à nœud unique, et jusqu'à **~2 heures** pour les types plus grands. Le déploiement semblera rester immobile pendant cette période ; c'est normal — ne l'interrompez pas.

3. Pendant qu'il s'exécute, vous pouvez observer le cloud privé se mettre en place :

   ```bash
   PC=$(gcloud vmware private-clouds list --location="$ZONE" --project="$PROJECT" \
     --format="value(name)" --limit=1)
   gcloud vmware private-clouds describe "$PC" --location="$ZONE" --project="$PROJECT" \
     --format="value(state)"    # CREATING → ACTIVE
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. **Confirmez que le cloud privé est `ACTIVE`** et capturez les FQDN de la console :

   ```bash
   gcloud vmware private-clouds describe "$PC" --location="$ZONE" --project="$PROJECT" \
     --format="yaml(state, vcenter.fqdn, nsx.fqdn, hcx.fqdn)"
   ```

2. **Récupérez les identifiants vCenter.** Les journaux de déploiement les impriment après la réinitialisation ; vous pouvez également les récupérer à la demande :

   ```bash
   gcloud vmware private-clouds vcenter credentials describe \
     --private-cloud="$PC" --username="solution-user-01@gve.local" \
     --location="$ZONE" --project="$PROJECT"
   ```

3. **Générez un mot de passe Windows et trouvez l'adresse IP externe de l'hôte de rebond :**

   ```bash
   JUMP=$(gcloud compute instances list --filter="name~^altostrat-[0-9]+-jump-host$" --project="$PROJECT" \
     --format="value(name)")
   gcloud compute instances list --filter="name~^altostrat-[0-9]+-jump-host$" --project="$PROJECT" \
     --format="table(name, status, networkInterfaces[0].accessConfigs[0].natIP)"
   gcloud compute reset-windows-password "$JUMP" --zone="$ZONE" --project="$PROJECT"
   ```

4. **Connectez-vous en RDP à l'hôte de rebond** à `<external-ip>:3389` avec le nom d'utilisateur/mot de passe généré, puis ouvrez un navigateur dans la session et naviguez vers `https://<vcenter-fqdn>`. Acceptez le certificat auto-signé et connectez-vous avec les identifiants vCenter. (Sur macOS, utilisez **Windows App** : `brew install --cask windows-app`. Sur Linux : `xfreerdp /u:<user> /p:<pass> /v:<ip>:3389`.) Les consoles ne sont accessibles que depuis l'hôte de rebond, pas depuis votre poste de travail.

---

## Tâche 3 — Opérer et maintenir en fonctionnement (Jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Explorez vCenter** depuis le navigateur de l'hôte de rebond — Hôtes et clusters (le cluster de gestion et ses nœuds), Stockage (le datastore vSAN) et Réseau. Connectez-vous à NSX-T Manager à `https://<nsx-fqdn>` pour afficher les segments, le DHCP et le routage.

2. **Gérez le cloud privé** depuis la CLI — inspectez ses clusters et sous-réseaux, et (sur les clouds `STANDARD`) ajoutez des clusters de charge de travail :

   ```bash
   gcloud vmware private-clouds clusters list --private-cloud="$PC" \
     --location="$ZONE" --project="$PROJECT"
   gcloud vmware private-clouds subnets list --private-cloud="$PC" \
     --location="$ZONE" --project="$PROJECT"
   ```

3. **Examinez la mise en réseau** — le peering VPC et la politique réseau qui contrôle l'accès à Internet / IP externe :

   ```bash
   gcloud vmware network-peerings list --location=global --project="$PROJECT" \
     --format="table(name, state)"
   gcloud vmware network-policies list --location="$REGION" --project="$PROJECT" \
     --format="table(name, internetAccess.enabled, externalIp.enabled, edgeServicesCidr)"
   ```

4. **Modifiez la configuration via la plateforme.** Pour ajuster la politique réseau, le nombre de nœuds (`STANDARD`), les règles de pare-feu ou la taille de l'hôte de rebond, modifiez les entrées et cliquez sur **Mettre à jour** sur la page des détails du déploiement — le module possède ces ressources, donc les modifications de configuration doivent passer par la plateforme plutôt que par des modifications ad-hoc de la console. Notez que `management_cidr`, `private_cloud_type` et `deployment_id` ne peuvent pas être modifiés sur place.

5. **Actualisez les identifiants vCenter** s'ils expirent (réexécutez la réinitialisation) :

   ```bash
   gcloud vmware private-clouds vcenter credentials reset \
     --private-cloud="$PC" --username="solution-user-01@gve.local" \
     --location="$ZONE" --project="$PROJECT" --no-async
   ```

---

## Tâche 4 — Observer : Journaux et Surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux d'audit VMware Engine** — chaque opération de cloud privé, de peering et de politique :

   ```bash
   gcloud logging read 'protoPayload.serviceName="vmwareengine.googleapis.com"' \
     --project="$PROJECT" --limit=20 \
     --format='value(timestamp, protoPayload.methodName, protoPayload.authenticationInfo.principalEmail)'
   ```

2. **Métriques et journaux de l'hôte de rebond** — ouvrez Monitoring → Tableaux de bord pour l'instance Compute Engine (CPU, mémoire, disque), et Logging → Explorateur de journaux filtré sur `resource.type="gce_instance"` pour les journaux système.

3. **Vues de la console** — VMware Engine → Ressources affiche la santé du cloud privé, et les consoles vCenter/NSX-T (via l'hôte de rebond) exposent la santé vSAN et l'état du cluster.

---

## Tâche 5 — Dépannage et débogage [Manuel] {#task-5--troubleshoot--debug-manual}

Techniques durables pour les modes de défaillance que vous êtes le plus susceptible de rencontrer. Ce sont des diagnostics au niveau de la plateforme et ils ne changent pas avec les versions de GCVE.

- **Déploiement "bloqué" pendant une heure ou plus :** c'est presque toujours normal — le provisionnement du cloud privé est lent (la ressource a un délai d'attente de 180 minutes). Confirmez la progression avec `gcloud vmware private-clouds describe ... --format="value(state)"` (`CREATING` → `ACTIVE`). N'interrompez pas le déploiement.
- **`Resource for the given network already exists` (politique réseau) :** GCVE n'autorise qu'une seule politique réseau par réseau VMware Engine. Une politique restante d'une exécution précédente ayant échoué bloque la recréation — listez-la avec `gcloud vmware network-policies list --location="$REGION"` et supprimez-la, puis redéployez.
- **Impossible d'atteindre vCenter/NSX-T depuis votre ordinateur portable :** les FQDN se résolvent en IPs privées accessibles uniquement depuis le VPC pair. Ouvrez-les toujours depuis l'intérieur de la session RDP de l'hôte de rebond.
- **Connexion vCenter rejetée :** le mot de passe de l'utilisateur de la solution a peut-être expiré ou la réinitialisation a été ignorée (pas de `gcloud` dans le runner). Réexécutez la commande de réinitialisation de la Tâche 3, puis décrivez pour lire le nouveau mot de passe.
- **Le peering affiche `CREATING`/`INACTIVE` :** le peering ne passe à `ACTIVE` qu'après la fin du provisionnement du cloud privé — attendez que le cloud atteigne `ACTIVE` d'abord.
- **Erreurs de type de nœud ou de quota à la création :** les types de nœuds dépendent de la zone et nécessitent un quota. Vérifiez la disponibilité avec `gcloud vmware node-types list --location="$ZONE"` et demandez un quota sous IAM et administration → Quotas.

Consultez la section *Pièges de configuration* du Guide de configuration pour les pièges spécifiques aux paramètres.

---

## Tâche 6 — Suppression [Automatisé] {#task-6--tear-down-automated}

Sur la page **Déploiements**, ouvrez le déploiement et cliquez sur l'icône **Corbeille** (**Supprimer**). La suppression exécute `terraform destroy` et est irréversible — elle supprime le cloud privé (et **chaque VM et toutes les données qu'il contient**), le réseau VMware Engine et le peering, la politique réseau, le VPC pair et les règles de pare-feu, ainsi que l'hôte de rebond. La suppression est ordonnée correctement (politique et peering avant le réseau) et est **lente** — le déprovisionnement du bare metal peut prendre beaucoup de temps, alors laissez-le s'exécuter jusqu'à la fin.

Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles de la console qui entrent en conflit avec l'état Terraform), utilisez plutôt **Purger** (depuis la même boîte de dialogue **Supprimer**) — cela supprime le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement, mais le cloud privé GCVE et tout le reste continuent de fonctionner et de facturer). Après une purge, nettoyez les ressources manuellement.

> **Sauvegardez d'abord.** La suppression du cloud privé détruit définitivement toutes les VM et données du SDDC. Migrez ou sauvegardez toutes les charges de travail avant de supprimer.

---

## Résumé {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne le réseau VMware Engine, le cloud privé, le peering, la politique, le pare-feu et l'hôte de rebond |
| 2 — Accéder et vérifier | Manuel | Le cloud privé est `ACTIVE` ; les identifiants vCenter sont récupérés ; les consoles sont accessibles via l'hôte de rebond |
| 3 — Opérer | Manuel | Explorer vCenter/NSX-T ; gérer le cloud privé et la mise en réseau ; actualiser les identifiants |
| 4 — Observer | Manuel | Interroger les journaux d'audit VMware Engine ; examiner les métriques de l'hôte de rebond et la santé de la console |
| 5 — Dépannage | Manuel | Diagnostiquer le provisionnement lent, les politiques orphelines, l'accès à la console et les problèmes de quota |
| 6 — Suppression | Automatisé | Supprimer (Corbeille) détruit toutes les ressources ; Purger supprime de RAD sans détruire |
