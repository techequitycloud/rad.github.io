---
title: "Migration Center — Guide de lab"
description: "Lab pratique : exécutez la découverte et l'évaluation Google Cloud Migration Center dans votre propre projet — configuration, collecte des données, rapports et démantèlement."
---

<!-- translated-from: docs/labs/Migration_Center.md @ 3055034 sha256:52c377e503a1 -->

# Migration Center — Guide de lab {#migration-center--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Migration_Center)**

## Vue d'ensemble {#overview}

**Durée estimée :** 60 à 120 minutes

Google Cloud Migration Center est la plateforme gratuite de Google Cloud dédiée à la *phase d'évaluation* d'une
migration — découvrir les charges de travail existantes, constituer un inventaire, estimer leur coût sur
Google Cloud et planifier les vagues de migration. Ce lab vous fait parcourir tout le cycle de vie
opérationnel du module **Migration Center** : le déployer, accéder aux charges de travail sources d'exemple
et les vérifier, exécuter la découverte et produire un rapport TCO (opérations du jour 2), l'observer, diagnostiquer les
problèmes courants et le démanteler.

Le lab porte sur **l'exploitation du module et du service Migration Center**, et non sur chacune
des fonctionnalités du produit. Pour la liste complète des services provisionnés et de chaque paramètre de configuration
(organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Migration_Center) — ce lab
ne duplique volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez capable de :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vérifier que le service Migration Center et les VM sources d'exemple (hôte Windows MCDCv6 + cibles
  Linux) existent et que les données de découverte arrivent.
- Exécuter et examiner la découverte et l'évaluation — analyser les cibles Linux, examiner les données AWS importées,
  et générer un rapport TCO à partir de groupes d'actifs et de préférences de migration.
- Observer la progression de la découverte et l'état des ressources avec la console et l'API REST.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** installé ; `gcloud auth login` et `gcloud auth application-default login`
  exécutés.
- Un **client RDP** (Microsoft Remote Desktop sous Windows/macOS, ou Remmina/FreeRDP sous Linux).
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet. Le compte Google que vous utilisez pour la
  connexion à MCDCv6 a besoin du rôle **Migration Center Admin** sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes qu'elle affiche en tant que Owner du projet, puis **Verify**) et d'accorder le rôle **Owner** au compte de service de déploiement RAD.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres. Tous les autres paramètres du Guide de configuration se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.
- **(Facultatif) AWS** — uniquement si vous souhaitez importer automatiquement un inventaire EC2 réel : un jeu
  d'**identifiants AWS d'amorçage disposant de droits d'écriture IAM** (le module crée à partir d'eux un utilisateur IAM
  en lecture seule et à portée restreinte) et le **CLI `aws`** disponible dans l'environnement de déploiement.
  Laissez les paramètres AWS vides pour ignorer entièrement AWS et importer à la place un fichier CSV d'exemple préparé à l'avance.

Définissez ces variables shell une fois ; chacune des tâches ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into — permanent for Migration Center
export ZONE="us-central1-a"
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Migration Center** dans la
   liste **Platform Modules** pour commencer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue les paramètres.
   Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Migration_Center) documente
   chaque paramètre par groupe, avec ses valeurs par défaut. Pour importer un inventaire AWS EC2 réel, renseignez
   `aws_access_key_id`, `aws_secret_access_key` et `aws_region` ; sinon, laissez-les vides.
   Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la
   page d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne un VPC dédié et des règles de pare-feu, un hôte MCDCv6 Windows Server 2022,
   les cibles d'analyse Linux Debian, un bucket Cloud Storage contenant la clé SSH, puis
   initialise le service Migration Center pour `REGION` et enregistre une source de découverte.
   Si des identifiants AWS ont été fournis, elle crée également un utilisateur IAM à portée restreinte et importe l'inventaire
   EC2. Terraform se termine en **5 à 8 minutes** environ ; le script de démarrage Windows
   (installation de Chrome + MCDCv6) s'exécute en arrière-plan pendant encore **3 à 5 minutes**.

3. Vérifiez que les ressources principales sont en place :

   ```bash
   gcloud compute instances list --filter="name~migcenter" --project="$PROJECT" \
     --format="table(name, status, networkInterfaces[0].accessConfigs[0].natIP, networkInterfaces[0].networkIP)"

   curl -s "https://migrationcenter.googleapis.com/v1/projects/$PROJECT/locations/$REGION/sources" \
     -H "Authorization: Bearer $(gcloud auth print-access-token)" \
     | jq '.sources[] | {id: (.name|split("/")|last), displayName, type}'
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. **Vérifiez que les VM sources d'exemple existent** et relevez leurs adresses :

   ```bash
   WINDOWS_VM=$(gcloud compute instances list --filter="name~migcenter AND name~winvm" \
     --project="$PROJECT" --format="value(name)")
   gcloud compute instances describe "$WINDOWS_VM" --zone="$ZONE" --project="$PROJECT" \
     --format="value(networkInterfaces[0].accessConfigs[0].natIP)"     # RDP target

   gcloud compute instances list --filter="name~migcenter AND name~linvm" \
     --project="$PROJECT" --format="table(name, networkInterfaces[0].networkIP)"
   ```

2. **Connectez-vous en RDP à la VM Windows** avec l'IP externe obtenue à l'étape 1 :

   ```
   Username: migrationcenter
   Password: m1grat10nc#nt#r
   ```

   Dans la VM, vérifiez que **MCDCv6** et **Google Chrome** sont installés et que
   `C:\Users\migrationcenter\Downloads\vm-aws-import-files\` existe (les fichiers CSV d'exemple préparés à l'avance).
   Si RDP refuse la connexion, le script de démarrage est probablement encore en cours d'exécution — patientez quelques
   minutes et consultez `gcloud compute instances get-serial-port-output "$WINDOWS_VM" --zone="$ZONE" --project="$PROJECT" | tail`.

3. **Vérifiez que les données de découverte pourront arriver** — confirmez que la source de découverte est enregistrée
   (tâche 1, étape 3) et, si vous avez fourni des identifiants AWS, qu'un job d'importation existe :

   ```bash
   curl -s "https://migrationcenter.googleapis.com/v1/projects/$PROJECT/locations/$REGION/importJobs" \
     -H "Authorization: Bearer $(gcloud auth print-access-token)" \
     | jq '.importJobs[] | {displayName, state}'
   ```

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

C'est le cœur du lab — exécuter la découverte et produire une évaluation.

1. **Terminez la connexion Google à MCDCv6 (la seule étape manuelle).** Sur la VM Windows, lancez
   **Migration Center Discovery Client**, cliquez sur **Sign in with Google**, authentifiez-vous avec un
   compte disposant du rôle Migration Center Admin sur le projet, sélectionnez le projet et, lorsque le nom d'un client de découverte
   vous est demandé, saisissez la valeur de la sortie `mc_discovery_client_name`
   (par défaut `mc-discovery-client`) **exactement** — cela associe MCDCv6 à la source que le module
   a préenregistrée.

2. **Chargez l'identifiant SSH.** Téléchargez `lab-ssh-key.pem` depuis le bucket de la clé SSH et ajoutez-le dans
   MCDCv6 comme identifiant nommé `Lab-key`, de type *SSH private key*, avec le nom d'utilisateur `migrationcenter` :

   ```bash
   BUCKET=$(gcloud storage buckets list --filter="name~migcenter" --project="$PROJECT" --format="value(name)")
   gcloud storage cp "gs://$BUCKET/lab-ssh-key.pem" ./lab-ssh-key.pem --project="$PROJECT"
   ```

3. **Lancez l'analyse de découverte.** Dans MCDCv6, ajoutez une source de données Linux/Windows, définissez la plage d'analyse IP
   de façon à couvrir les `linux_vm_internal_ips` (par exemple début `10.128.0.1`, fin `10.128.0.10`), sélectionnez l'identifiant
   `Lab-key` et lancez la collecte. Elle se termine en quelques minutes ; les actifs Linux
   apparaissent ensuite dans Migration Center.

4. **Examinez l'inventaire et (facultativement) les données AWS.** Dans la console (sortie
   `migration_center_url`), ouvrez **Assets → Virtual machines**. Vous devriez voir les VM Debian
   issues de l'analyse réelle et, si cela a été configuré, les instances AWS importées. Si vous n'avez pas fourni d'identifiants
   AWS, importez les fichiers CSV d'exemple préparés à l'avance depuis la VM Windows via **Data sources → Add
   source → Uploads → AWS VM export**.

   ```bash
   curl -s "https://migrationcenter.googleapis.com/v1/projects/$PROJECT/locations/$REGION/assets" \
     -H "Authorization: Bearer $(gcloud auth print-access-token)" \
     | jq '.assets[] | {name: (.name|split("/")|last), os: .machineDetails.guestOsDetails.osName}'
   ```

5. **Créez des groupes, des préférences et un rapport TCO.** Dans la console : créez des groupes d'actifs sous
   **Groups**, créez des ensembles de préférences de migration sous **Migration preferences** (série de machines
   modélisée, stratégie de dimensionnement et durée d'engagement), puis, sous **Reports**, créez une configuration
   de rapport associant les groupes aux ensembles de préférences et générez un rapport **Total Cost of Ownership**.
   La génération prend quelques minutes ; examinez les recommandations de type de machine par VM,
   la modélisation du stockage et des licences, et la fourchette de coûts selon vos scénarios de préférences.

---

## Tâche 4 — Observer [Manuel] {#task-4--observe-manual}

1. **Progression de la découverte** — observez le nombre d'actifs augmenter à mesure que les analyses et importations arrivent :

   ```bash
   curl -s "https://migrationcenter.googleapis.com/v1/projects/$PROJECT/locations/$REGION/assets" \
     -H "Authorization: Bearer $(gcloud auth print-access-token)" | jq '.assets | length'
   ```

2. **État des jobs d'importation** — vérifiez que les importations AWS/d'exemple se sont terminées :

   ```bash
   curl -s "https://migrationcenter.googleapis.com/v1/projects/$PROJECT/locations/$REGION/importJobs" \
     -H "Authorization: Bearer $(gcloud auth print-access-token)" \
     | jq '.importJobs[] | {displayName, state}'
   ```

3. **État des VM** — vérifiez que les VM sources restent `RUNNING`, et utilisez la sortie du port série
   de la VM Windows pour observer le script de démarrage. Dans la console, Compute Engine présente les métriques CPU/réseau
   de chaque VM, et Migration Center → Reports affiche l'état de génération des rapports.

---

## Tâche 5 — Dépanner [Manuel] {#task-5--troubleshoot-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement.

- **RDP n'arrive pas à se connecter :** le script de démarrage Windows installe probablement encore MCDCv6/Chrome.
  Patientez 3 à 5 minutes après le déploiement et consultez de nouveau la sortie du port série.
- **La connexion à MCDCv6 échoue :** le compte Google ne dispose pas du rôle Migration Center Admin sur le projet —
  accordez `roles/migrationcenter.admin` et réessayez.
- **Les résultats d'analyse n'apparaissent pas dans la source attendue :** le nom du client de découverte saisi dans
  MCDCv6 ne correspondait pas à `mc_discovery_client_name` (sensible à la casse). Saisissez-le de nouveau exactement.
- **L'analyse Linux affiche « Access Denied » :** l'identifiant doit utiliser le nom d'utilisateur `migrationcenter` avec
  `lab-ssh-key.pem`. Vérifiez la connexion SSH manuellement avec la clé (voir le Guide de configuration).
- **Les VM Linux ne sont pas découvertes :** la plage d'analyse IP de MCDCv6 est trop étroite — élargissez-la pour couvrir toutes
  les `linux_vm_internal_ips`.
- **L'importation AWS ne s'est pas exécutée ou a échoué :** vérifiez que les deux paramètres AWS ont été définis, que la clé d'amorçage dispose
  de droits d'écriture IAM, que le CLI `aws` est disponible dans l'environnement de déploiement, et que
  `aws_region` correspond à l'emplacement de vos instances EC2. Sans identifiants, importez plutôt manuellement
  les fichiers CSV d'exemple préparés à l'avance.
- **La génération du rapport TCO reste bloquée :** les rapports prennent quelques minutes ; interrogez l'état du rapport via
  l'API REST jusqu'à ce qu'il indique `SUCCEEDED`.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres à chaque paramètre.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**).
La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour
l'historique). Elle retire tout ce que le module a créé dans l'état : les VM Windows et Linux, le
VPC et les règles de pare-feu, le bucket Cloud Storage (et la clé SSH qu'il contient) et — lorsque AWS était
activé — l'utilisateur IAM AWS à portée restreinte, sa stratégie et sa clé d'accès.

Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications
manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le
déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie
le déploiement).

> **Les objets Migration Center ne sont pas supprimés par la destruction.** La source de découverte, les jobs d'importation
> et les groupes d'actifs, ensembles de préférences et rapports que vous avez créés ne sont pas suivis dans l'état
> Terraform et survivent au démantèlement. Supprimez-les via la console Migration Center ou l'API REST, ou
> supprimez le projet. Les API activées restent également activées afin de ne pas perturber un projet
> partagé.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne le VPC, les VM sources d'exemple et le bucket de la clé SSH, puis initialise Migration Center + une source de découverte (et l'importation AWS facultative) |
| 2 — Accéder et vérifier | Manuel | Se connecter en RDP à l'hôte Windows MCDCv6 ; vérifier que les VM d'exemple et la source enregistrée existent |
| 3 — Exploiter | Manuel | Terminer la connexion à MCDCv6, lancer l'analyse Linux, examiner les données AWS et générer un rapport TCO |
| 4 — Observer | Manuel | Suivre le nombre d'actifs, l'état des jobs d'importation et l'état des VM/rapports via la console et l'API REST |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de RDP, d'OAuth, de nom de source, de SSH, de plage d'analyse, d'importation AWS et de rapport |
| 6 — Démanteler | Automatisé | La suppression (Trash) retire toutes les ressources du module ; les objets Migration Center sont nettoyés manuellement |
