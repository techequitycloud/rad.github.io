---
title: "Netdata sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Netdata sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Netdata_CloudRun.md @ 1665a43e sha256:21c2e27da138 -->

# Netdata sur Google Cloud Run {#netdata-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Netdata_CloudRun.png" alt="Netdata sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Netdata est un agent open source de surveillance d'infrastructure et d'applications en temps réel qui collecte des milliers de métriques par seconde et fournit des tableaux de bord à granularité seconde ainsi qu'une API REST. Ce module déploie Netdata sur **Cloud Run v2** sur la base de la fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Netdata et sur la manière de les explorer et de les opérer depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à chaque application Cloud Run — identité de service, ingress et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — veuillez vous référer au [guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## Ce que coûte Netdata sur RAD, et comment cela se compare {#what-netdata-costs-on-rad-and-how-that-compares}

**Le module Netdata sur Cloud Run de RAD coûte environ 19 US$ par mois, avec les frais de module facturés une seule fois en crédits RAD.** Si vous avez besoin que Netdata reste opérationnel en continu, qu'il s'adapte à plusieurs pods ou qu'il fonctionne avec d'autres charges de travail Kubernetes, consultez le [guide GKE](Netdata_GKE.md) pour cette option. Si vous n'en avez besoin qu'occasionnellement — une démo, un projet saisonnier, quelque chose que vous évaluez — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits (moins de 1 US$) au lieu de payer pour qu'il reste inactif. Voir **Mettre en pause gratuitement**, ci-dessous. Les chiffres sont à jour au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

RAD déploie **Netdata**, qui est open source, il n'y a donc pas de frais de licence par utilisateur. Vous payez pour trois choses :

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 40 crédits (4 US$ au prix de la recharge) | 36 crédits (10 % de moins) |
| Temps de build | Environ 3-6 crédits par build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **19 US$ par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **9 crédits par jour**, soit environ 270 par mois (environ 27 US$ au prix de la recharge, 22 US$ au tarif du plan Scale) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est maintenu en réserve |

10 crédits coûtent 1 US$ pour une recharge ponctuelle, et moins avec un plan mensuel. Dans un projet géré par RAD, le réseau et le stockage sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas un deuxième ensemble de ces éléments.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Cloud Run, 1x vCPU / 1 GiB (chaud) | 13,14 US$ |
| Cloud NAT et réseau | 5 US$ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 US$ |
| **Total** | **environ 19 US$** |

### Comment cela se compare {#how-it-compares}

| Option | Prix | Qui l'exécute |
|---|---|---|
| Netdata Cloud, plan Business | 4,50 $/nœud/mois, facturé annuellement | Netdata. Métriques, logs et rétention illimités ; RBAC, SSO et logs d'audit |
| Netdata Cloud, plan Communauté | Gratuit | Netdata. Limité à 5 nœuds connectés et 1 tableau de bord personnalisé par salle |
| **RAD, Cloud Run, votre propre projet** | **Environ 19 US$**, plus 4 US$ une fois par déploiement | L'automatisation de RAD, dans votre projet |
| **RAD, Cloud Run, un projet géré par RAD** | **Environ 270 crédits (22–27 US$)** | RAD |
| RAD, GKE Autopilot | Voir le [guide GKE](Netdata_GKE.md) | RAD |

Le niveau Cloud de Netdata facture par nœud connecté, ce qui convient à une flotte de serveurs ; ce module déploie une seule instance Netdata qui se surveille elle-même (et tout ce vers quoi elle est dirigée), de sorte que la comparaison est un nœud par rapport au prix Business de Netdata de 4,50 $/nœud/mois. **Un nœud auto-hébergé est gratuit de la propre licence de Netdata de toute façon** (l'agent est open source) ; ce que les frais de RAD paient, c'est le déploiement, la mise à jour et la surface opérationnelle de niveau Cloud SQL que le plan Business devrait autrement acheter séparément sur votre propre serveur.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Netdata s'exécute dans **un projet géré par RAD pour vous**, vous avez une deuxième option qui va bien au-delà de la mise à l'échelle à zéro : **supprimer l'ensemble du projet et le restaurer dans les 30 jours pour presque rien.** Cela convient bien mieux à Netdata dont vous n'avez besoin qu'occasionnellement — une démo, une évaluation, un projet saisonnier — que de le faire fonctionner en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le projet. Google ne supprime pas le projet immédiatement : il le conserve, récupérable, pendant 30 jours. Comme la facturation est déjà déliée, rien n'est facturé pendant cette période d'attente. Contrairement à la suppression d'un module, cela ne détruit pas la ressource de calcul une par une — l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte quelques crédits, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet peut le restaurer. RAD demande à Google de récupérer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter **Mettre à jour** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela coûte environ une poignée de crédits (moins de 1 US$) au total pour une chaîne de déploiement typique de 2-3.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, pas 19 US$.** Déployez Netdata, utilisez-le un certain temps, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Mettre à jour, et supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez que les frais de module une seule fois, les builds, et le temps pendant lequel Netdata a été réellement actif.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un projet que vous apportez et dont RAD ne gère que la facturation), et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime définitivement. La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude et de démonstration conviennent). Google indique que la plupart des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.
- **Une lacune réelle : les sauvegardes nocturnes ne survivent pas.** Les sauvegardes sont écrites dans un bucket à l'intérieur du projet, et ce bucket n'est **pas** protégé par la suppression logicielle de Cloud Storage, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé Netdata et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ 45 crédits (4,50 US$) dans votre propre projet, ou 41 crédits dans un projet géré par RAD. La suppression permet d'économiser de l'argent une fois que Netdata resterait inutilisé pendant environ 7 jours ou plus dans votre propre projet (environ 0,64 US$ par jour), ou environ 5 jours ou plus dans un projet géré par RAD (9 crédits par jour).
- **La majeure partie du coût d'exécution est généralement la base de données et toute VM de fichier/cache partagée.** Elles ne s'arrêtent que si rien d'autre dans le projet ne les utilise, donc la suppression de Netdata alors que quelque chose d'autre partage le projet n'économise que la partie calcul de cette application.
- **Conservez d'abord vos données.** Les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui, alors copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de laboratoire et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de laboratoire, pour la formation.** Un formateur anime une session pour une classe. Chaque participant dispose de Netdata dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits non utilisés sont restitués au formateur.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire exécute Netdata pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour la fenêtre de récupération de 30 jours et ce qu'elle dit sur les objets Cloud Storage sans suppression logicielle ; frais RAD et estimations de crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Tarification Netdata Cloud](https://www.netdata.cloud/pricing/). Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Netdata s'exécute comme un conteneur unique sur Cloud Run v2, écoutant sur le port **19999**. Le déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Conteneur unique, 1 vCPU / 1 GiB par défaut ; écoute sur le port 19999 |
| Base de données | _Aucune_ | Netdata n'a pas de base de données SQL — les métriques sont stockées sur disque sous `/var/lib/netdata` |
| Stockage d'objets | Cloud Storage | Un bucket de données, monté comme un volume **GCS FUSE** à `/var/lib/netdata` |
| Cache et file d'attente | _Aucun_ | Netdata n'utilise pas Redis (`enable_redis` est forcé `false`) |
| Secrets | Secret Manager | 32 caractères `NETDATA_ADMIN_PASSWORD`, généré par défaut (`enable_admin_password = true`) |
| Ingress | URL Cloud Run / Équilibrage de charge Cloud | **Par défaut `all`** — public ; un garde-fou au moment du plan exige `enable_admin_password = true` pour s'y associer |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de base de données.** Netdata est un agent autonome ; il n'y a pas d'instance Cloud SQL, pas de job `db-init` et pas de migration de schéma. `database_type = NONE`.
- **L'Ingress est par défaut `all` (public), associé à un identifiant de mot de passe administrateur généré.** Le tableau de bord de Netdata n'a pas d'authentification intégrée, donc un garde-fou au moment du plan **rejette `ingress_settings = "all"` à moins que `enable_admin_password =
  true`** — les deux sont par défaut ainsi pour qu'un nouveau déploiement passe le plan dès le départ.
- **Le tableau de bord n'est pas authentifié, quelle que soit la valeur de `enable_admin_password`.** Ce drapeau (activé par défaut) ne génère qu'un `NETDATA_ADMIN_PASSWORD` adossé à Secret Manager pour une couche d'authentification côté opérateur (proxy inverse / revendication Netdata Cloud) — il n'ajoute pas, à lui seul, une page de connexion au tableau de bord brut. Restreignez `ingress_settings` à `internal` ou placez le service derrière `enable_iap` si le tableau de bord exposé et non authentifié est une préoccupation.
- **Instance unique par défaut.** `min_instance_count = 1`, `max_instance_count = 1`. Chaque instance Netdata contient sa propre base de données de métriques locale, elle ne s'adapte donc pas horizontalement à un stockage partagé — maintenez-la à une seule instance.
- **Les métriques persistent dans un bucket GCS FUSE.** `/var/lib/netdata` est sauvegardé par un bucket Cloud Storage (`enable_gcs_storage_volume = true`) afin que la base de données de métriques survive aux redémarrages et aux événements de mise à l'échelle. Cela nécessite l'environnement d'exécution **gen2**.
- **Pas de Redis.** `enable_redis` est explicitement désactivé ; Netdata n'a pas besoin de cache/file d'attente.
- **Le chemin de santé est `/api/v1/info`.** Les sondes de démarrage et de vivacité atteignent ce point de terminaison, qui renvoie un corps JSON `200` une fois l'agent initialisé.
- **L'image est épinglée par version via `NETDATA_VERSION`.** `application_version = "latest"` se résout en `v2.2.6` au moment de la construction plutôt qu'en un wrapper `latest` inexistant.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de services et de ressources sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Netdata {#a-cloud-run--the-netdata-service}

Netdata s'exécute en tant que service Cloud Run v2 écoutant sur le port 19999. Chaque déploiement crée une révision immuable ; comme Netdata conserve ses métriques sur une seule base de données locale/GCS, il est normalement exécuté en tant qu'instance unique plutôt que d'être mis à l'échelle automatiquement.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les logs et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~netdata"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  # Confirm the injected listener port / admin password env:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud Storage — persistance des métriques {#b-cloud-storage--metrics-persistence}

Un bucket **Cloud Storage** dédié est provisionné et monté en tant que volume **GCS FUSE** à `/var/lib/netdata`, où Netdata conserve sa base de données de métriques, son journal d'alarmes et son état de santé. Cela permet de conserver l'historique de surveillance lors des redémarrages de révision et des redéploiements. GCS FUSE nécessite l'environnement d'exécution gen2.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~netdata"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### C. Secret Manager {#c-secret-manager}

Par défaut (`enable_admin_password = true`), un secret unique de 32 caractères (`secret-<prefix>-netdata-admin-password`) est généré et injecté en tant que `NETDATA_ADMIN_PASSWORD`. Aucun autre secret d'application n'est créé (il n'y a pas de mot de passe de base de données car il n'y a pas de base de données).

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~netdata-admin-password"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### D. Réseau et ingress {#d-networking--ingress}

Par défaut, le service utilise `ingress_settings = "all"` (public) associé à `enable_admin_password = true` — le garde-fou de validation du module exige le drapeau de mot de passe chaque fois que l'ingress est `all`, et les deux sont par défaut ainsi. Le tableau de bord lui-même n'a pas de connexion intégrée, donc pour un déploiement véritablement verrouillé, définissez `ingress_settings = "internal"` (VPC-only) ou placez le service public derrière `enable_iap` / un équilibreur de charge HTTPS externe + authentification de base. La sortie `netdata_url` indique l'URL du service (port 19999).

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les logs des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run sont envoyées à Cloud Monitoring, avec une vérification de disponibilité optionnelle (ciblant `/api/v1/info`) et des politiques d'alerte.

- **Console :** Logging → Explorateur de logs ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Netdata {#3-netdata-application-behaviour}

- **Pas de bootstrap de base de données.** Il n'y a pas de job `db-init` et pas de migration de schéma. L'agent écrit sa base de données de métriques round-robin directement dans `/var/lib/netdata` (le volume GCS FUSE) au premier démarrage.
- **Persistance des métriques.** L'historique de surveillance ne survit aux redémarrages que parce que `/var/lib/netdata` est sauvegardé par le bucket Cloud Storage. Si vous désactivez `enable_gcs_storage_volume` (ou si le bucket est vide), chaque nouvelle révision démarre avec une base de données de métriques vierge.
- **Tableau de bord non authentifié.** Le tableau de bord local et l'API REST de Netdata sur le port 19999 n'ont pas de connexion intégrée, même si `ingress_settings = "all"` et `enable_admin_password = true` sont tous deux les valeurs par défaut du module. Définissez `ingress_settings = "internal"` ou placez un proxy d'authentification devant si le tableau de bord exposé publiquement et non authentifié est une préoccupation. `enable_admin_password` fournit un identifiant stable pour ce proxy / pour le flux de revendication Netdata Cloud — il ne verrouille pas le tableau de bord brut par lui-même.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent **`/api/v1/info`**, qui renvoie un corps JSON `200` une fois l'agent initialisé. Vérifiez-le :
  ```bash
  # from within the VPC (or after port-forwarding / LB):
  curl -s "$NETDATA_URL/api/v1/info" | head
  ```
- **Fonctionnement en instance unique.** Étant donné que chaque instance possède sa base de données de métriques locale, maintenez `min_instance_count = max_instance_count = 1`. La mise à l'échelle produit des agents indépendants et non fédérés, et non un tableau de bord partagé.
- **Netdata Cloud (facultatif).** Pour centraliser plusieurs agents, revendiquez cette instance auprès de Netdata Cloud après le déploiement (via un jeton de revendication / un environnement de salles) — une étape opérateur, non provisionnée par le module.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour Netdata sont listés ; toutes les autres entrées sont héritées de [App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `netdata` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image Netdata ; `latest` se résout en `v2.2.6` au moment du build. Épinglez un tag spécifique en production. |
| `enable_admin_password` | `true` | Génère un `NETDATA_ADMIN_PASSWORD` de 32 caractères dans Secret Manager. **Requis pour être `true` chaque fois que `ingress_settings = "all"`** (le couplage par défaut du module). |

Toutes les autres entrées suivent le comportement standard de App_CloudRun.

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `1Gi` | Mémoire par instance ; augmenter si de nombreuses collections sont surveillées. |
| `min_instance_count` | `1` | Maintenir à 1 — Netdata contient une base de données de métriques locale par instance. |
| `max_instance_count` | `1` | Maintenir à 1 ; la mise à l'échelle produit des agents indépendants et non fédérés. |
| `container_port` | `19999` | Port sur lequel Netdata écoute (tableau de bord + API REST). |
| `enable_cloudsql_volume` | `false` | Pas de Cloud SQL — Netdata n'a pas de base de données. |

Toutes les autres entrées suivent le comportement standard de App_CloudRun.

### Groupe 5 — Accès et contrôle d'Ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Public par défaut, associé à `enable_admin_password = true` (un garde-fou au moment du plan exige le couplage). Définissez `internal` pour un accès uniquement VPC puisque le tableau de bord lui-même n'a pas de connexion intégrée, quel que soit le drapeau du mot de passe. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via le VPC. |
| `enable_iap` | `false` | Connexion Google devant un équilibreur de charge externe — la méthode recommandée pour exposer Netdata publiquement. |

Toutes les autres entrées suivent le comportement standard de App_CloudRun.

### Groupe 10 — Stockage et système de fichiers {#group-10--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée le bucket de données GCS (le montage FUSE `/var/lib/netdata`). |
| `storage_buckets` | `[]` | Buckets supplémentaires au-delà du bucket de données auto-provisionné. |
| `gcs_volumes` | `[]` | Montages GCS Fuse supplémentaires (nécessite gen2). Le montage `/var/lib/netdata` est ajouté automatiquement. |
| `enable_nfs` | `false` | Désactivé par défaut ; Netdata ne nécessite pas NFS. |

Toutes les autres entrées suivent le comportement standard de App_CloudRun.

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixé à `NONE` par Netdata_Common — Netdata n'a pas de base de données SQL. Non référencé. |

Toutes les autres entrées suivent le comportement standard de App_CloudRun.

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/v1/info`, 15s de délai, 10 tentatives | Sonde de démarrage ; `/api/v1/info` renvoie 200 JSON lorsque prêt. |
| `liveness_probe` | HTTP `/api/v1/info`, 30s de délai | Sonde de vivacité. |
| `uptime_check_config` | désactivé, chemin `/api/v1/info` | Vérification de disponibilité Cloud Monitoring optionnelle (ne se déclenche que lorsque le point de terminaison est publiquement accessible). |

Toutes les autres entrées suivent le comportement standard de App_CloudRun.

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `netdata_url` | URL du service pour le tableau de bord/API Netdata (port 19999) — accessible publiquement par défaut (`ingress_settings = "all"`) ; restreint au VPC si `ingress_settings = "internal"`. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | Détails du service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `storage_buckets` | Buckets Cloud Storage créés (inclut le bucket de données `/var/lib/netdata`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, vérifications de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (vide par défaut — Netdata n'en a pas). |
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

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur de fondation [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et les combinaisons* au moment du plan. De plus, `Netdata_CloudRun` ajoute ses propres garde-fous : `min_instance_count ≤ max_instance_count`, et `ingress_settings = "all"` est rejeté à moins que `enable_admin_password = true`. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant qu'aucune ressource ne soit créée.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `ingress_settings` + `enable_admin_password` | Par défaut `all` + `enable_admin_password = true` ; utilisez `internal` pour un déploiement véritablement verrouillé | Critique | Le tableau de bord/API REST n'a pas de connexion intégrée, quel que soit `enable_admin_password` — l'ingress `all` par défaut expose publiquement toutes les métriques de l'hôte, sauf s'il est précédé de `enable_iap` ou d'une autre couche d'authentification. Le garde-fou du plan ne bloque que `all` *sans* identifiant de mot de passe ; il ne sécurise pas le tableau de bord par lui-même. |
| `enable_gcs_storage_volume` (Commun) / bucket de données | Maintenez le montage GCS FUSE activé | Élevé | Sans le bucket `/var/lib/netdata`, chaque révision démarre avec une base de données de métriques vide — tout l'historique est perdu au redémarrage. |
| `max_instance_count` | `1` | Élevé | La mise à l'échelle au-delà de 1 crée des agents indépendants avec des bases de données de métriques locales distinctes, et non un tableau de bord partagé — données confuses et non fédérées. |
| `application_name` | Définir une fois | Élevé | Immuable après le premier déploiement ; le renommage recrée le service, le secret et le bucket. |
| `container_port` | `19999` | Élevé | Netdata n'écoute que sur 19999 ; changer le port sans changer `NETDATA_LISTENER_PORT` rompt la sonde de démarrage. |
| `execution_environment` | `gen2` | Élevé | GCS FUSE pour `/var/lib/netdata` nécessite gen2 ; gen1 ne peut pas le monter. |
| `enable_iap` | Activer lors de l'exposition externe | Élevé | Un équilibreur de charge externe sans IAP (ou une autre couche d'authentification) laisse le tableau de bord non authentifié accessible. |
| `memory_limit` | `1Gi` (augmenter pour de nombreuses collections) | Moyen | Une mémoire sous-dimensionnée peut provoquer un OOM de l'agent lors de la surveillance d'un grand nombre de graphiques. |
| `application_version` | Épinglez un tag en production | Moyen | `latest` flotte vers `v2.2.6` au moment du build ; épinglez pour contrôler les mises à niveau. |

---

Pour le comportement de base référencé tout au long — identité de service, mise à l'échelle et concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à Netdata partagée avec la variante GKE est décrite dans **[Netdata_Common](Netdata_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Labo pratique : Netdata sur Cloud Run](../labs/Netdata_CloudRun.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [Netdata sur GKE Autopilot](Netdata_GKE.md) — la même application sur Kubernetes, pour lorsque vous avez besoin de l'autre cible de déploiement.
- [Netdata Common — Configuration d'application partagée](Netdata_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Uptime Kuma sur Google Cloud Run](UptimeKuma_CloudRun.md), [Gatus sur Google Cloud Run](Gatus_CloudRun.md), [Healthchecks sur Google Cloud Run](Healthchecks_CloudRun.md), [Beszel sur Google Cloud Run](Beszel_CloudRun.md) dans la solution **Monitoring & NOC**.
