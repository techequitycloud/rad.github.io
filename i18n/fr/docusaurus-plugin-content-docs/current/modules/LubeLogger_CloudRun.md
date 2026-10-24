---
title: "LubeLogger sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de LubeLogger sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/LubeLogger_CloudRun.md @ e69407af sha256:2115fa9f3e14 -->

# LubeLogger sur Google Cloud Run {#lubelogger-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/LubeLogger_CloudRun.png" alt="LubeLogger sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

LubeLogger est un outil de suivi de l'entretien des véhicules et de la consommation de carburant, gratuit et open-source, basé sur ASP.NET Core (.NET), livré sous forme d'une seule image conteneur avec une base de données LiteDB intégrée. Ce module déploie LubeLogger sur **Cloud Run v2** sur la base de la fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par LubeLogger et sur la manière de les explorer et de les exploiter à partir de la console Google Cloud et de la ligne de commande. Pour les mécanismes communs à toutes les applications Cloud Run — identité de service, ingress et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au [guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## Ce que coûte LubeLogger sur RAD, et comparaison {#what-lubelogger-costs-on-rad-and-how-that-compares}

**Le module Cloud Run de LubeLogger sur RAD coûte environ 33 $ US par mois dans votre propre projet, sans frais par véhicule.** RAD facture 40 crédits une fois par déploiement dans votre propre projet (36 crédits, soit 10 % de moins, dans un projet géré par RAD), plus le temps de build. LubeLogger se déploie également sur GKE Autopilot pour environ 42 $ US par mois — consultez le [guide GKE](LubeLogger_GKE.md) si vous avez besoin qu'il s'exécute là-bas à la place. Si vous n'en avez besoin qu'occasionnellement, un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour quelques crédits, de sorte que ce chiffre mensuel devient quelques dollars au lieu de cela — voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 40 crédits (4,00 $ US au prix de la recharge) | 36 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **33 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **15 crédits par jour**, soit environ 450 par mois (environ 45,00 $ US au prix de la recharge, moins sur un plan) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est maintenu en réserve |

10 crédits coûtent 1 $ US pour une recharge unique, et moins sur un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas de deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Cloud Run, 1x vCPU / 1 GiB (chaud) | 13 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| **Total** | **environ 33 $ US** |

### Comparaison {#how-it-compares}

- **AUTOsist**, un outil commercial de suivi de l'entretien de flotte, facture **6 à 7 $ US par véhicule par mois**, avec un **minimum de 59 $ US par mois pour 5 véhicules** sur son forfait de base Maintenance.
- Le module LubeLogger de RAD coûte environ 33 $ US par mois dans votre propre projet — dans la même fourchette que le minimum de 5 véhicules d'AUTOsist, mais avec **aucun frais par véhicule et aucun plafond de nombre de véhicules** : un foyer qui suit deux voitures coûte exactement le même prix qu'une petite flotte qui en suit vingt.
- Comparaison autogérée : à 1 vCPU / 1 GiB, un Hetzner CPX22 ou un droplet DigitalOcean de 2 vCPU/4 Go (~24 $ US/mois) ferait bien fonctionner LubeLogger, mais vous devriez toujours gérer le système d'exploitation, les sauvegardes et les mises à niveau vous-même.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si LubeLogger s'exécute dans **un projet géré par RAD pour vous**, vous avez une deuxième option qui va bien au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour presque rien.** Cela convient bien mieux à LubeLogger dont vous n'avez besoin qu'occasionnellement — pour l'évaluer, un environnement de démonstration, une charge de travail saisonnière ou intermittente — que de l'exécuter en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le projet. Google ne supprime pas le projet immédiatement : il le conserve, récupérable, pendant 30 jours. Comme la facturation est déjà déliée, rien n'est facturé pendant qu'il attend. Contrairement à la suppression d'un module, cela ne détruit pas la base de données, aucune VM ou la ressource de calcul une par une — l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte quelques crédits, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet peut le restaurer. RAD demande à Google de récupérer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter **Mettre à jour** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Pour LubeLogger derrière Services_GCP (une petite VM NFS/cache) et Project_GCP, cela représente environ **une poignée de crédits (moins de 1 $ US)** au total, contre environ 45 crédits (4,50 $ US) que coûte un redéploiement complet.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, pas 33 $ US.** Déployez LubeLogger, utilisez-le pendant un certain temps, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Mettre à jour, et supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez que les frais de module une fois, les builds, et le temps réel où il était actif.
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet dont RAD ne gère que la facturation), et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime définitivement. La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'évaluation conviennent). Google indique que la plupart des services fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.
- **Un véritable manque : les sauvegardes nocturnes ne survivent pas.** Les sauvegardes et autres fichiers générés sont écrits dans un bucket à l'intérieur du projet, et ce bucket n'est **pas** protégé par la suppression logicielle de Cloud Storage, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé LubeLogger et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive ou un bucket en dehors du projet) avant de la supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Ne payez que pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau, plus les builds — environ 45 crédits (4,50 $ US) au total. La suppression ne permet d'économiser de l'argent que si LubeLogger reste inutilisé assez longtemps pour compenser ce coût de redéploiement par rapport à son propre coût d'exécution — environ **5 jours ou plus**, à la fois dans votre propre projet (environ 1,09 $ US par jour) et dans un projet géré par RAD (15 crédits par jour).
- **La majeure partie du coût d'exécution est généralement partagée.** Pour LubeLogger, il s'agit de la base de données et de la VM de fichier/cache partagée. Ils ne s'arrêtent que si rien d'autre dans le projet ne les utilise, donc la suppression de cette application pendant que quelque chose d'autre partage le projet ne permet d'économiser que la partie calcul de cette application.
- **Gardez vos données en premier.** Les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui, alors copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant reçoit l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est interrompue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais RAD et estimation des crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les mécanismes de pause/restauration et ce qu'il dit sur les objets Cloud Storage sans suppression logicielle ; [AUTOsist](https://www.autosist.com/pricing). Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

---

## 1. Vue d'ensemble {#1-overview}

LubeLogger s'exécute en tant que conteneur ASP.NET Core sur Cloud Run v2. Le déploiement connecte un ensemble minimal de services Google Cloud — il n'y a pas de base de données gérée dans la configuration par défaut :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service ASP.NET Core, 1 vCPU / 1 GiB par défaut, autoscaling sans serveur ; fixé à une seule instance |
| Base de données | Aucune (par défaut) | Le mode par défaut de LubeLogger utilise un fichier de base de données LiteDB intégré interne — aucune instance Cloud SQL n'est créée |
| Stockage d'objets | Cloud Storage | Deux buckets : `storage` (fichier de base de données LiteDB + photos/reçus/documents téléchargés) et `dpkeys` (clés de protection des données ASP.NET Core) |
| Cache et file d'attente | Aucun | LubeLogger n'utilise pas Redis et n'a pas de worker/file d'attente en arrière-plan |
| Secrets | Aucun | Aucun secret n'est généré — le premier compte est créé via l'auto-enregistrement |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL par défaut `run.app` (`ingress_settings = "all"`) ; équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître à l'avance :**

- **Pas de base de données externe par défaut.** `database_type = "NONE"` — le fichier de base de données LiteDB intégré de LubeLogger est la source de vérité, persisté via un volume GCS FUSE. LubeLogger prend également en charge un backend Postgres externe facultatif via une seule variable d'environnement DSN `POSTGRES_CONNECTION`, mais ce module ne connecte pas Cloud SQL pour cela.
- **Une seule instance.** `min_instance_count = 1` et `max_instance_count = 1` — le mode par défaut de LubeLogger sert un fichier de base de données partagé à partir d'un seul volume ; l'exécution de plusieurs instances sur le même fichier le corrompt.
- **Sécurisé par défaut.** `EnableAuth = "true"` remplace le paramètre par défaut `appsettings.json` de LubeLogger, qui est un accès entièrement ouvert. Il n'y a pas de compte administrateur pré-initialisé — la première personne à remplir le formulaire d'inscription sur `/Login` obtient l'accès.
- **Clés de protection des données persistantes.** Un petit bucket `dpkeys` dédié est toujours monté à `/root/.aspnet/DataProtection-Keys` afin que les sessions de connexion survivent aux redémarrages de conteneurs ; ceci est séparé du bucket principal `storage`.
- **Image pré-construite, pas d'étape de build.** Le module déploie directement l'image officielle `ghcr.io/hargata/lubelogger` (mise en miroir dans Artifact Registry par défaut) — il n'y a pas de Dockerfile ou de Cloud Build impliqué.
- **Les sondes de santé utilisent `/Login`,** pas `/` — la racine de l'application est protégée par `[Authorize]` et échouerait à une sonde de plateforme non authentifiée même sur un conteneur sain.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de services et de ressources sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service LubeLogger {#a-cloud-run--the-lubelogger-service}

LubeLogger s'exécute en tant que service Cloud Run v2 unique (fixé à une instance). Chaque déploiement crée une révision immuable ; le trafic peut être réparti entre les révisions pour des déploiements sécurisés.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud Storage {#b-cloud-storage}

Deux buckets **Cloud Storage** dédiés sont provisionnés automatiquement :

- **`storage`** — monté à `/App/data` via GCS FUSE ; contient le fichier de base de données LiteDB intégré et les photos/reçus/documents téléchargés.
- **`dpkeys`** — monté à `/root/.aspnet/DataProtection-Keys` ; contient les clés de signature de cookie/session d'ASP.NET Core.

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~lubelogger"
gcloud storage ls gs://<storage-bucket>/        # bucket names are in the Outputs
```

Voir [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### C. Réseau et ingress {#c-networking--ingress}

Le service est accessible par son URL `run.app` par défaut (`ingress_settings = "all"`). Un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peuvent être ajoutés.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### D. Cloud Logging et Monitoring {#d-cloud-logging--monitoring}

Les journaux de conteneur sont acheminés vers Cloud Logging ; les métriques Cloud Run sont acheminées vers Cloud Monitoring, avec des tests de disponibilité et des politiques d'alerte facultatifs.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application LubeLogger {#3-lubelogger-application-behaviour}

- **Pas de configuration de base de données au premier déploiement.** Il n'y a pas de job `db-init` — LubeLogger initialise son propre fichier de base de données LiteDB et sa structure de répertoires (`config/`, `documents/`, `images/`, `temp/`, `themes/`, `translations/` sous `/App/data`) au premier démarrage.
- **Pas de credential admin fixe.** Ouvrez le service, allez à `/Login`, et soumettez le formulaire **Register** — cela deviendra le compte utilisable. Complétez cela immédiatement après le premier déploiement : `EnableAuth = "true"` restreint le reste de l'application, mais l'enregistrement lui-même est ouvert à toute personne pouvant atteindre l'URL jusqu'à ce qu'un premier compte existe.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/Login` — la page publique et non authentifiée de LubeLogger. La racine de l'application `/` est protégée par `[Authorize]` et renverrait un 401/redirigerait une sonde non authentifiée même sur un conteneur sain.
- **Postgres externe facultatif.** LubeLogger prend en charge une seule variable d'environnement DSN `POSTGRES_CONNECTION` (`Host=<host>;Port=5432;Username=<user>;Password=<pass>;Database=<db>;`) pour utiliser une base de données Postgres externe au lieu du fichier LiteDB intégré. Ce module ne provisionne pas Cloud SQL pour ce chemin — un opérateur fournissant sa propre instance Postgres peut définir la variable via `secret_environment_variables`.
- **Instance unique, toujours.** `max_instance_count` est fixé à `1` — le mode par défaut de LubeLogger n'a pas de support de verrouillage distribué ou de multi-écriture pour sa base de données intégrée.
- **Inspecter la révision en cours d'exécution :**
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" \
    --format='value(status.url)'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour LubeLogger sont listés ; toutes les autres entrées sont héritées de [App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails autorisés à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `lubelogger` | Nom de base pour les ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `LubeLogger` | Nom lisible par l'homme affiché dans la console. |
| `description` | _(défini)_ | Description du service. |
| `application_version` | `latest` | Tag d'image sur `ghcr.io/hargata/lubelogger`. Puisque l'image est pré-construite (non construite sur mesure), cela sélectionne directement la version publiée. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `1Gi` | Mémoire par instance. |
| `min_instance_count` | `1` | Maintenu à `1` pour éviter les démarrages à froid. |
| `max_instance_count` | `1` | **Doit rester à `1`** — le mode par défaut de LubeLogger sert un fichier de base de données partagé. |
| `container_port` | `8080` | LubeLogger écoute sur le port 8080. |
| `execution_environment` | `gen2` | Génération 2 requise pour les montages GCS Fuse. |
| `timeout_seconds` | `300` | Durée maximale de la requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `false` | Le mode par défaut de LubeLogger n'a pas de Cloud SQL. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image LubeLogger dans Artifact Registry. |
| `traffic_split` | `[]` | Répartir le trafic entre les révisions pour les déploiements échelonnés. |
| `max_revisions_to_retain` | `7` | Déclaré pour la parité de convention ; non référencé par le déploiement de ce module. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Accès public — LubeLogger est une application web destinée aux utilisateurs. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via VPC. |
| `enable_iap` | `false` | Exiger la connexion Google. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets, fusionnés avec les paramètres par défaut du module `EnableAuth = "true"`. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. Utilisez ceci pour `POSTGRES_CONNECTION` si vous connectez le backend Postgres externe facultatif. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 10 — Stockage et système de fichiers {#group-10--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer des buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[]` | Buckets GCS supplémentaires au-delà des buckets `storage`/`dpkeys` auto-provisionnés. |
| `enable_nfs` | `true` | Non utilisé par LubeLogger par défaut. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse supplémentaires (nécessite gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixe — le mode par défaut de LubeLogger n'a pas de base de données Cloud SQL. |
| `database_password_length` | `32` | Non référencé dans la configuration par défaut. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Le mode par défaut de LubeLogger n'a pas besoin de job d'initialisation. |
| `cron_jobs` | `[]` | Pas de tâches récurrentes planifiées par la plateforme par défaut. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/Login` 15s de délai | Sonde de démarrage. |
| `liveness_probe` | HTTP `/Login` 30s de délai | Sonde de vivacité. |
| `startup_probe_config` | HTTP `/Login` | Sonde structurée alternative. |
| `health_check_config` | HTTP `/Login` | Sonde de vivacité structurée alternative. |
| `uptime_check_config` | `{ enabled=false, path="/Login" }` | Test de disponibilité Cloud Monitoring ; désactivé par défaut. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 23 — VPC Service Controls et journalisation d'audit {#group-23--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `lubelogger_url` | URL VPC interne pour l'interface utilisateur web de LubeLogger. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `storage_buckets` | Buckets Cloud Storage créés (`storage`, `dpkeys`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur de fondation [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et les combinaisons* au moment de la planification. Une configuration invalide échoue à la **planification** avec une erreur claire et nommée avant qu'aucune ressource ne soit créée, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'au moment de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `max_instance_count` | `1` | Critique | Le mode par défaut de LubeLogger sert un fichier de base de données intégré partagé à partir d'un seul volume ; plus d'une instance risque la corruption de la base de données par des écrivains concurrents. |
| Buckets `storage`/`dpkeys` | Ne jamais supprimer | Critique | La perte de `storage` entraîne la perte de tous les enregistrements de véhicules ; la perte de `dpkeys` invalide toutes les sessions de connexion existantes (récupérable — force uniquement la reconnexion). |
| `EnableAuth` | `true` (par défaut) | Critique | Le définir sur `false` revient au mode d'accès entièrement ouvert de LubeLogger — toute personne ayant l'URL peut afficher/modifier toutes les données sans aucune connexion. |
| Enregistrement initial | Terminer immédiatement après le déploiement | Élevé | Tant qu'un premier compte n'est pas enregistré, le formulaire d'enregistrement est accessible à toute personne pouvant atteindre l'URL. |
| Chemin `startup_probe`/`liveness_probe` | `/Login` | Critique | Pointer les sondes vers `/` (ou tout chemin protégé par `[Authorize]`) fait échouer la sonde sur un conteneur par ailleurs sain — la révision ne devient jamais prête. |
| `database_type` | `NONE` (par défaut) | Élevé | Le mode par défaut de LubeLogger ignore entièrement ce paramètre ; le modifier ne connecte pas LubeLogger à une instance Cloud SQL — utilisez `POSTGRES_CONNECTION` à la place pour le chemin Postgres externe facultatif. |
| `min_instance_count` | `1` | Moyen | Le définir sur `0` permet les démarrages à froid ; puisque `max_instance_count` est fixé à `1`, il n'y a pas de risque de répartition du trafic, seulement une latence supplémentaire sur la première requête après l'inactivité. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |
| `enable_cloud_armor` | activer pour la production | Moyen | L'interface utilisateur web publique et l'API REST sont autrement accessibles sans protection WAF. |

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise à l'échelle et concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à LubeLogger partagée avec la variante GKE est décrite dans **[LubeLogger_Common](LubeLogger_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : LubeLogger sur Cloud Run](../labs/LubeLogger_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [LubeLogger sur GKE Autopilot](LubeLogger_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [LubeLogger Common — Configuration d'application partagée](LubeLogger_Common.md) — la configuration partagée par les deux cibles de déploiement.
