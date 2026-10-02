---
title: "Migration Center — Guide de lab"
description: "Lab pratique : exécutez la découverte et l'évaluation de Google Cloud Migration Center dans votre propre projet — configuration, collecte de données, rapports et suppression."
---

<!-- translated-from: docs/labs/Migration_Center.md @ 7d02aa0b sha256:86126173daba -->

# Migration Center — Guide de lab {#migration-center--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Migration_Center)**

## Vue d'ensemble {#overview}

**Temps estimé :** 60 à 120 minutes

Google Cloud Migration Center est la plateforme gratuite de Google Cloud pour la *phase d'évaluation* d'une migration — découvrir les charges de travail existantes, créer un inventaire, estimer leur coût sur Google Cloud et planifier les vagues de migration. Ce lab vous guide à travers le cycle de vie opérationnel complet du module **Migration Center** : déployez-le, accédez et vérifiez les exemples de charges de travail source, exécutez la découverte et créez un rapport TCO (opérations de jour 2), observez-le, diagnostiquez les problèmes courants et supprimez-le.

Le lab se concentre sur **l'exploitation du module et du service Migration Center**, et non sur toutes les fonctionnalités du produit. Pour la liste complète des services provisionnés et de chaque entrée de configuration (organisée par groupe), consultez le [Guide de configuration](https://docs.radmodules.dev/docs/modules/Migration_Center) — ce lab ne duplique délibérément pas ce détail afin qu'il reste précis au fil du temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez capable de :

- Déployer le module depuis la plateforme RAD et localiser les ressources qu'il provisionne.
- Confirmer que le service Migration Center et les exemples de VM source (hôte Windows MCDCv6 + cibles Linux) existent et que les données de découverte arrivent.
- Exécuter et inspecter la découverte et l'évaluation — scanner les cibles Linux, examiner les données AWS importées et générer un rapport TCO à partir de groupes d'actifs et de préférences de migration.
- Observer la progression de la découverte et la santé des ressources avec la Console et l'API REST.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Supprimer le déploiement proprement.

## Prérequis {#prerequisites}

- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** installé ; `gcloud auth login` et `gcloud auth application-default login`
  terminés.
- Un **client RDP** (Microsoft Remote Desktop sur Windows/macOS, ou Remmina/FreeRDP sur Linux).
- **Project Owner** (ou équivalent) IAM sur le projet. Le compte Google que vous utilisez pour la connexion MCDCv6 nécessite **Migration Center Admin** sur le projet.
- **Votre propre projet uniquement.** Ce module masque l'option **GCP Project on RAD** (`enable_rad_gcpproject = false`) car il active `migrationcenter`, ce que les politiques du niveau géré par RAD ne permettent pas, il se déploie donc toujours dans un projet que vous apportez. Avant le premier déploiement, la boîte de dialogue de confirmation de déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes qu'elle affiche en tant que Project Owner, puis **Verify**) et de donner le rôle **Owner** au compte de service de déploiement RAD.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page d'entrées. Toutes les autres entrées du Guide de configuration sont modifiées par la suite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui nécessite un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Accès à la plateforme RAD** avec la permission de déployer des modules dans le projet.
- **(Facultatif) AWS** — uniquement si vous souhaitez importer automatiquement un inventaire EC2 en direct : un ensemble de **bootstrap AWS credentials avec des permissions d'écriture IAM** (le module crée un utilisateur IAM à portée limitée et en lecture seule à partir de ceux-ci) et la **`aws` CLI** disponible dans l'environnement de déploiement. Laissez les entrées AWS vides pour ignorer AWS entièrement et importer un exemple de CSV pré-établi à la place.

Définissez ces variables shell une fois ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into — permanent for Migration Center
export ZONE="us-central1-a"
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Migration Center** depuis la liste **Platform Modules** pour commencer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur l'**Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes un partenaire ou un administrateur), définissez `project_id`, et examinez les entrées.
   Configurez uniquement ce dont vous avez besoin — le [Guide de configuration](https://docs.radmodules.dev/docs/modules/Migration_Center) documente chaque entrée par groupe, avec des valeurs par défaut. Pour importer un inventaire AWS EC2 en direct, fournissez `aws_access_key_id`, `aws_secret_access_key` et `aws_region` ; sinon, laissez-les vides.
   Cliquez sur **Deploy Module**, examinez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, complétez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec des journaux en temps réel.

2. La plateforme provisionne un VPC dédié et des règles de pare-feu, un hôte Windows Server 2022 MCDCv6, les cibles de scan Debian Linux, un bucket Cloud Storage contenant la clé SSH, puis initialise le service Migration Center pour `REGION` et enregistre une source de découverte.
   Si des identifiants AWS ont été fournis, elle crée également un utilisateur IAM à portée limitée et importe l'inventaire EC2. Terraform se termine en environ **5 à 8 minutes** ; le script de démarrage Windows (installation de Chrome + MCDCv6) s'exécute en arrière-plan pendant **3 à 5 minutes** supplémentaires.

3. Confirmez que les ressources principales ont été créées :

   ```bash
   gcloud compute instances list --filter="name~migcenter" --project="$PROJECT" \
     --format="table(name, status, networkInterfaces[0].accessConfigs[0].natIP, networkInterfaces[0].networkIP)"

   curl -s "https://migrationcenter.googleapis.com/v1/projects/$PROJECT/locations/$REGION/sources" \
     -H "Authorization: Bearer $(gcloud auth print-access-token)" \
     | jq '.sources[] | {id: (.name|split("/")|last), displayName, type}'
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. **Confirmez que les exemples de VM source existent** et capturez leurs adresses :

   ```bash
   WINDOWS_VM=$(gcloud compute instances list --filter="name~migcenter AND name~winvm" \
     --project="$PROJECT" --format="value(name)")
   gcloud compute instances describe "$WINDOWS_VM" --zone="$ZONE" --project="$PROJECT" \
     --format="value(networkInterfaces[0].accessConfigs[0].natIP)"     # RDP target

   gcloud compute instances list --filter="name~migcenter AND name~linvm" \
     --project="$PROJECT" --format="table(name, networkInterfaces[0].networkIP)"
   ```

2. **Connectez-vous en RDP à la VM Windows** en utilisant l'adresse IP externe de l'étape 1 :

   ```
   Username: migrationcenter
   Password: m1grat10nc#nt#r
   ```

   À l'intérieur de la VM, confirmez que **MCDCv6** et **Google Chrome** sont installés et que `C:\Users\migrationcenter\Downloads\vm-aws-import-files\` existe (les exemples de CSV pré-établis).
   Si le RDP refuse la connexion, le script de démarrage est probablement toujours en cours d'exécution — attendez quelques minutes et vérifiez `gcloud compute instances get-serial-port-output "$WINDOWS_VM" --zone="$ZONE" --project="$PROJECT" | tail`.

3. **Vérifiez que les données de découverte pourront arriver** — confirmez que la source de découverte est enregistrée (Tâche 1, étape 3) et que, si vous avez fourni des identifiants AWS, un job d'importation existe :

   ```bash
   curl -s "https://migrationcenter.googleapis.com/v1/projects/$PROJECT/locations/$REGION/importJobs" \
     -H "Authorization: Bearer $(gcloud auth print-access-token)" \
     | jq '.importJobs[] | {displayName, state}'
   ```

---

## Tâche 3 — Opérer et maintenir en fonctionnement (Jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

C'est le cœur du lab — exécuter la découverte et produire une évaluation.

1. **Terminez la connexion Google MCDCv6 (la seule étape manuelle).** Sur la VM Windows, lancez **Migration Center Discovery Client**, cliquez sur **Sign in with Google**, authentifiez-vous avec un compte qui a Migration Center Admin sur le projet, sélectionnez le projet, et lorsque vous êtes invité à entrer un nom de client de découverte, entrez la valeur de la sortie `mc_discovery_client_name` (par défaut `mc-discovery-client`) **exactement** — cela lie MCDCv6 à la source que le module a pré-enregistrée.

2. **Chargez l'identifiant SSH.** Téléchargez `lab-ssh-key.pem` depuis le bucket de clés SSH et ajoutez-le dans MCDCv6 comme identifiant nommé `Lab-key`, de type *SSH private key*, nom d'utilisateur `migrationcenter` :

   ```bash
   BUCKET=$(gcloud storage buckets list --filter="name~migcenter" --project="$PROJECT" --format="value(name)")
   gcloud storage cp "gs://$BUCKET/lab-ssh-key.pem" ./lab-ssh-key.pem --project="$PROJECT"
   ```

3. **Exécutez le scan de découverte.** Dans MCDCv6, ajoutez une source de données Linux/Windows, définissez la plage de scan IP pour couvrir les `linux_vm_internal_ips` (par exemple, début `10.128.0.1`, fin `10.128.0.10`), sélectionnez l'identifiant `Lab-key`, et exécutez la collecte. Elle se termine en quelques minutes ; les actifs Linux apparaissent ensuite dans Migration Center.

4. **Examinez l'inventaire et (facultativement) les données AWS.** Dans la Console (sortie `migration_center_url`), ouvrez **Assets → Virtual machines**. Vous devriez voir les VM Debian du scan en direct et, si configuré, les instances AWS importées. Si vous n'avez pas fourni d'identifiants AWS, importez les exemples de CSV pré-établis depuis la VM Windows via **Data sources → Add source → Uploads → AWS VM export**.

   ```bash
   curl -s "https://migrationcenter.googleapis.com/v1/projects/$PROJECT/locations/$REGION/assets" \
     -H "Authorization: Bearer $(gcloud auth print-access-token)" \
     | jq '.assets[] | {name: (.name|split("/")|last), os: .machineDetails.guestOsDetails.osName}'
   ```

5. **Créez des groupes, des préférences et un rapport TCO.** Dans la Console : créez des groupes d'actifs sous **Groups**, créez des ensembles de préférences de migration sous **Migration preferences** (série de machines modèles, stratégie de dimensionnement et durée d'engagement), puis sous **Reports**, créez une configuration de rapport mappant les groupes aux ensembles de préférences et générez un rapport **Total Cost of Ownership**. La génération prend quelques minutes ; examinez les recommandations de type de machine par VM, la modélisation du stockage et des licences, et la fourchette de coûts selon vos scénarios de préférence.

---

## Tâche 4 — Observer [Manuel] {#task-4--observe-manual}

1. **Progression de la découverte** — observez le nombre d'actifs augmenter à mesure que les scans/importations arrivent :

   ```bash
   curl -s "https://migrationcenter.googleapis.com/v1/projects/$PROJECT/locations/$REGION/assets" \
     -H "Authorization: Bearer $(gcloud auth print-access-token)" | jq '.assets | length'
   ```

2. **État du job d'importation** — confirmez que les importations AWS/échantillon sont terminées :

   ```bash
   curl -s "https://migrationcenter.googleapis.com/v1/projects/$PROJECT/locations/$REGION/importJobs" \
     -H "Authorization: Bearer $(gcloud auth print-access-token)" \
     | jq '.importJobs[] | {displayName, state}'
   ```

3. **Santé de la VM** — confirmez que les VM source restent `RUNNING`, et utilisez la sortie du port série de la VM Windows pour observer le script de démarrage. Dans la Console, Compute Engine affiche les métriques CPU/réseau par VM, et Migration Center → Reports affiche l'état de génération des rapports.

---

## Tâche 5 — Dépannage [Manuel] {#task-5--troubleshoot-manual}

Techniques durables pour les modes de défaillance que vous êtes le plus susceptible de rencontrer.

- **Le RDP ne peut pas se connecter :** le script de démarrage Windows est probablement toujours en train d'installer MCDCv6/Chrome. Attendez 3 à 5 minutes après le déploiement et vérifiez à nouveau la sortie du port série.
- **La connexion MCDCv6 échoue :** le compte Google n'a pas Migration Center Admin sur le projet — accordez `roles/migrationcenter.admin` et réessayez.
- **Les résultats du scan n'apparaissent pas dans la source attendue :** le nom du client de découverte entré dans MCDCv6 ne correspondait pas à `mc_discovery_client_name` (sensible à la casse). Ré-entrez-le exactement.
- **Le scan Linux affiche "Access Denied" :** l'identifiant doit utiliser le nom d'utilisateur `migrationcenter` avec `lab-ssh-key.pem`. Vérifiez SSH manuellement avec la clé (voir le Guide de configuration).
- **Les VM Linux ne sont pas découvertes :** la plage de scan IP MCDCv6 est trop étroite — élargissez-la pour couvrir tous les `linux_vm_internal_ips`.
- **L'importation AWS n'a pas été exécutée ou a échoué :** confirmez que les deux entrées AWS ont été définies, que la clé de bootstrap a les permissions d'écriture IAM, que la CLI `aws` est disponible dans l'environnement de déploiement et que `aws_region` correspond à l'emplacement de vos instances EC2. Sans identifiants, importez manuellement les exemples de CSV pré-établis à la place.
- **Le rapport TCO est bloqué en cours de génération :** les rapports prennent quelques minutes ; interrogez l'état du rapport via l'API REST jusqu'à ce qu'il indique `SUCCEEDED`.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges spécifiques aux paramètres.

---

## Tâche 6 — Suppression [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**).
La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Cela supprime tout ce que le module a créé dans l'état : les VM Windows et Linux, le VPC et les règles de pare-feu, le bucket Cloud Storage (et la clé SSH qu'il contient), et — lorsque AWS était activé — l'utilisateur IAM AWS à portée limitée, la politique et la clé d'accès.

Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles qui entrent en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (cela fait oublier le déploiement à RAD).

> **Les objets Migration Center ne sont pas supprimés par la destruction.** La source de découverte, les jobs d'importation et tous les groupes d'actifs, ensembles de préférences et rapports que vous avez créés ne sont pas suivis dans l'état Terraform et survivent à la suppression. Supprimez-les via la console Migration Center ou l'API REST, ou supprimez le projet. Les API activées sont également laissées activées afin qu'un projet partagé ne soit pas perturbé.

---

## Résumé {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déploiement | Automatisé | Le module provisionne le VPC, les exemples de VM source, le bucket de clés SSH et initialise Migration Center + une source de découverte (et une importation AWS facultative) |
| 2 — Accès et vérification | Manuel | Connexion RDP à l'hôte Windows MCDCv6 ; confirmation de l'existence des exemples de VM et de la source enregistrée |
| 3 — Opérer | Manuel | Terminer la connexion MCDCv6, exécuter le scan Linux, examiner les données AWS et générer un rapport TCO |
| 4 — Observer | Manuel | Suivre le nombre d'actifs, l'état du job d'importation et la santé des VM/rapports via la Console et l'API REST |
| 5 — Dépannage | Manuel | Diagnostiquer les problèmes RDP, OAuth, nom de source, SSH, plage de scan, importation AWS et rapports |
| 6 — Suppression | Automatisé | La suppression (Corbeille) supprime toutes les ressources du module ; les objets Migration Center sont nettoyés manuellement |
