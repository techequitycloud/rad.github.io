---
title: "AdGuard Home sur GKE Autopilot"
description: "Référence de configuration pour le déploiement d'AdGuard Home sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/AdGuardHome_GKE.md @ e69407af sha256:30509729266d -->

# AdGuard Home sur GKE Autopilot {#adguard-home-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/AdGuardHome_GKE.png" alt="AdGuard Home sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

> ⚠️ **CRITIQUE — à lire avant le déploiement.** La valeur principale d'AdGuard
> Home est le blocage des publicités et des traqueurs DNS à l'échelle du
> réseau, ce qui nécessite que les clients l'interrogent via DNS sur le port
> 53 (TCP+UDP). **Ce module utilise le modèle de passerelle HTTP(S) standard de
> GKE, qui ne peut pas exposer le port 53 brut.** (Un `Service
> type=LoadBalancer` L4 brut secondaire pour le port 53 est en principe possible sur GKE —
> contrairement à Cloud Run, qui ne peut pas le faire quelle que soit la
> configuration — mais est explicitement **hors de portée** pour la première
> version de ce module.) Ce module déploie **uniquement la console
> d'administration web** d'AdGuard Home (port 3000) pour la gestion des listes
> de filtres, des règles personnalisées et des paramètres client. **L'instance
> déployée n'est PAS accessible en tant que résolveur DNS public.** Voir
> [§6 Pièges de configuration](#6-configuration-pitfalls--sensible-defaults)
> pour l'explication complète.

AdGuard Home est un serveur DNS open source, sous licence GPL-3.0, à l'échelle
du réseau, qui bloque les publicités et les traqueurs au niveau DNS et inclut
des contrôles parentaux. Il s'agit d'un binaire statique Go sans base de
données externe — toute la configuration réside dans un fichier YAML plat
écrit par son propre assistant de configuration initial. Ce module déploie la
console d'administration web d'AdGuard Home sur **GKE Autopilot** au-dessus de
la fondation [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure partagée Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud qu'AdGuard Home utilise et sur la
façon de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls et le cycle de vie du déploiement —
reportez-vous au [guide de la fondation App_GKE](App_GKE.md) plutôt que de les
répéter ici.

---

## Ce que coûte AdGuard Home sur RAD, et comment cela se compare {#what-adguard-home-costs-on-rad-and-how-that-compares}

**AdGuard Home sur le module GKE Autopilot de RAD coûte environ 40 US$ par mois dans un projet que vous possédez, sans frais de licence pour le logiciel lui-même.** RAD facture des frais de module uniques de 40 crédits (4 US$ au prix de la recharge) dans un projet que vous possédez, et 36 crédits (10 % de moins) dans un projet géré par RAD. GKE convient à AdGuard Home qui doit rester actif en permanence ou s'adapter à plusieurs pods ; pour le coût le plus bas, le [module Cloud Run](AdGuardHome_CloudRun.md) exécute le même AdGuard Home pour environ 17 US$ par mois. Les chiffres sont ceux du 8 octobre 2026 ; les sources sont listées à la fin de cette section.

Si vous n'en avez besoin qu'occasionnellement — pour préparer une certification, une démo, un besoin saisonnier — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits, de sorte que les quelque 40 US$ par mois deviennent presque rien. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

Vous payez pour trois choses :

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 40 crédits (4 US$ au prix de la recharge) | 36 crédits (10 % de moins) |
| Temps de build | Quelques crédits, facturés à la minute de build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ 40 US$ par mois pour la configuration par défaut (tableau ci-dessous) | Facturé à l'heure en crédits ; RAD publie **63 crédits par jour**, environ 1 890 par mois (environ 189 US$ au prix de la recharge, 151 US$ au tarif du plan Scale) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 US$ pour une recharge unique, et moins pour un plan mensuel.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Pod GKE Autopilot, 1x vCPU / 0,5 GiB | 34,29 US$ |
| Cloud NAT et réseau | 5 US$ |
| Cloud Storage (add-ons, sauvegardes) | 1 US$ |
| Frais de gestion de cluster GKE | 0 US$ si c'est votre seul cluster Autopilot/zonal sur le compte de facturation, sinon environ 73 US$ (partagés entre toutes les applications GKE du projet) |
| **Total** | **environ 40 US$** |

### Comment cela se compare {#how-it-compares}

- Le plan Pro de NextDNS — requêtes et appareils illimités, résolvant réellement le DNS pour votre réseau, ce que le déploiement de la console web uniquement de ce module ne fait pas — coûte **1,79 £/mois** (environ 2,30 $). Cela achète un service de résolution clé en main ; cela n'achète pas la console de gestion des listes de filtres et des paramètres client auto-hébergée que ce module exécute.
- **RAD exécute le projet open source lui-même, pas une location hébergée par un fournisseur.** Vous obtenez le même logiciel, sur votre propre infrastructure (ou celle de RAD), au lieu d'un abonnement par siège ou par utilisation qui augmente indépendamment de ce que vous utilisez réellement.
- **Par rapport à un serveur auto-géré nu :** C'est une charge de travail plus petite qu'un VPS standard de 2 vCPU, donc l'exécuter vous-même sur une classe moins chère et plus petite qu'un Hetzner CPX22 ou DigitalOcean 2 vCPU/4 Go Droplet (tous deux environ 24 $/mois) ferait l'affaire, pour nettement moins que cela. RAD n'est pas moins cher en termes d'argent — la différence est la base de données gérée, Secret Manager et la surveillance qui viennent avec le module au lieu d'être votre propre travail.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si AdGuard Home s'exécute dans **un projet géré par RAD pour vous**, vous avez une option qui va bien au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour presque rien.** Cela convient bien mieux à une utilisation occasionnelle — préparation d'une certification, démo, besoin saisonnier — que l'exécution continue d'AdGuard Home.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le projet purement et simplement. Google ne le supprime pas immédiatement : il conserve le projet, récupérable, pendant 30 jours, et comme la facturation est déjà déliée, rien n'est facturé pendant qu'il attend. Contrairement à la suppression d'un seul module, cela ne détruit pas la base de données, aucune VM ou la ressource de calcul une par une — l'ensemble du projet s'arrête simplement, et rien n'est facturé entre-temps.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours, seul le propriétaire du projet peut le restaurer. RAD demande à Google de récupérer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter **Mettre à jour** sur chaque déploiement pour confirmer que tout est revenu. Parce que rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits au total (moins de 1 US$), contre le paiement des frais de module et une reconstruction complète à nouveau.
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet dont RAD ne gère que la facturation), vous devez le restaurer vous-même dans les 30 jours — après quoi Google le supprime définitivement — et la restauration est admise comme la création d'un nouveau projet, donc votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude et de démo conviennent). Google indique que la plupart des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.
- **Un véritable manque : les sauvegardes ne survivent pas.** Tout ce qu'AdGuard Home écrit dans un bucket de sauvegarde à l'intérieur du projet est très probablement perdu dès que vous supprimez le projet, même si le projet lui-même est récupérable pendant 30 jours — la suppression logicielle de Cloud Storage est explicitement désactivée pour ce bucket. Quiconque a personnalisé le déploiement et souhaite conserver ce travail doit copier une sauvegarde (vers Google Drive, ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

C'est la solution de repli pour un projet que vous possédez, ou une fois que la fenêtre de restauration de 30 jours ci-dessus est passée : **supprimez le déploiement et redéployez-le lorsque vous en aurez à nouveau besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau, plus les builds : environ 45 crédits (environ 4,50 US$) dans votre propre projet, ou 41 crédits dans un projet géré par RAD, car RAD reconstruit les ressources à partir de zéro. La suppression permet d'économiser de l'argent une fois qu'AdGuard Home resterait inutilisé assez longtemps pour compenser ce coût de redéploiement par rapport à son propre coût d'exécution — environ 3 jours ou plus dans votre propre projet (1,34 US$/jour) ou 1 jour ou plus dans un projet géré par RAD (63 crédits/jour).
- **Le cluster GKE lui-même est une infrastructure partagée.** Si une autre application utilise le même cluster Autopilot, la suppression d'AdGuard Home seule ne sauve que son propre pod ; les frais de gestion du cluster ne diminuent que lorsque rien d'autre dans le projet n'en a besoin.
- **Conservez d'abord vos données.** Tout ce qu'AdGuard Home écrit dans un bucket de sauvegarde à l'intérieur du déploiement est supprimé avec lui — copiez la dernière sauvegarde (vers Google Drive, ou un bucket que vous conservez) avant de la supprimer si vous voulez la conserver.
- **RAD ne recrée pas un déploiement supprimé pour vous.** Vous saisissez à nouveau les paramètres lorsque vous redéployez.

### Sessions de laboratoire et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de laboratoire, pour la formation.** Un formateur anime une session pour une classe. Chaque participant dispose d'AdGuard Home dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire exécute AdGuard Home pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais RAD et estimation des crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les mécanismes de pause/restauration ; [Tarification NextDNS](https://nextdns.io/pricing). Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

AdGuard Home s'exécute en tant que pod binaire statique Go unique sur GKE
Autopilot. Le déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pod binaire Go unique, 1 vCPU / 512 MiB par défaut, type de charge de travail `Deployment` |
| Base de données | Aucune | AdGuard Home n'a pas de base de données externe — la configuration est un fichier YAML plat |
| Stockage d'objets | Cloud Storage (×2, GCS Fuse CSI) | Bucket `conf` (config) et bucket `work` (journal de requêtes/statistiques), tous deux montés comme volumes de système de fichiers |
| Secrets | Secret Manager | Aucun généré — l'identifiant administrateur est défini via l'assistant web de première exécution d'AdGuard Home |
| Ingress | Cloud Load Balancing | Service External LoadBalancer par défaut ; domaine personnalisé optionnel + certificat géré (pour la console web — voir la note CRITIQUE ci-dessus) |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Ce déploiement est une console de gestion de configuration, pas un
  résolveur DNS.** Le modèle de passerelle HTTP(S) standard de GKE utilisé
  ici ne peut pas exposer le DNS brut (port 53 TCP/UDP). Ne dirigez pas de
  clients DNS réels vers l'adresse IP ou le nom d'hôte de ce déploiement.
- **Pas de base de données externe.** `database_type = "NONE"` et ne doit pas être modifié.
- **Deux volumes GCS Fuse sont pré-câblés et provisionnés
  automatiquement** — `conf` à `/opt/adguardhome/conf` et `work` à `/opt/adguardhome/work` —
  afin que la configuration et le journal de requêtes/statistiques persistent
  lors des redémarrages de pod. Vous n'avez pas besoin de définir `gcs_volumes`
  vous-même, et aucun StatefulSet/PVC de bloc n'est requis (`workload_type = "Deployment"`).
- **`container_port = 3000`** — L'assistant de configuration d'AdGuard Home est
  codé en dur pour écouter sur le port 3000 jusqu'à ce que `AdGuardHome.yaml` existe.
  Si vous modifiez le port de l'interface web pendant l'assistant de
  configuration, maintenez-le à 3000 ou la sonde de santé de la plateforme et
  l'URL publique ne correspondront plus à ce que le pod écoute réellement.
- **`service_type = "LoadBalancer"` par défaut.** La console d'administration est une interface
  utilisateur, elle est donc accessible au public comme toute autre
  application web de ce catalogue — contrairement à un outil
  d'administration de base de données interne uniquement.
- **Pas d'identifiant administrateur pré-rempli.** L'assistant de
  configuration de première exécution d'AdGuard Home, servi à l'URL de
  déploiement, est l'endroit où vous définissez le nom d'utilisateur/mot de
  passe de l'administrateur — rien n'est injecté par la plateforme.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté `gcloud container clusters get-credentials <cluster> --region <region> --project <project>` et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la console d'administration web d'AdGuard Home {#a-gke-autopilot--the-adguard-home-web-admin-console}

AdGuard Home s'exécute en tant que `Deployment` à réplica unique sur Autopilot.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail AdGuard Home pour voir les pods, les révisions et les événements. Kubernetes Engine → Services et Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de charge de travail (Déploiement vs StatefulSet).

### B. Cloud Storage (GCS Fuse) — configuration et journal de requêtes/statistiques {#b-cloud-storage-gcs-fuse--config-and-query-logstats}

AdGuard Home stocke l'intégralité de sa configuration dans un fichier YAML plat (`AdGuardHome.yaml`) et sa base de données de journal de requêtes/statistiques dans un répertoire séparé. Les deux sont sauvegardés par des buckets Cloud Storage dédiés montés via le pilote CSI GCS Fuse — `conf` et `work` — provisionnés automatiquement.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~adguardhome"
  gcloud storage ls gs://<conf-bucket>/           # bucket names are in the Outputs
  gcloud storage cat gs://<conf-bucket>/AdGuardHome.yaml   # inspect the live config
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et les détails de montage CSI GCS Fuse.

### C. Réseau et ingress {#c-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe de Cloud Load Balancing. **Ceci est l'URL de la console d'administration web uniquement — ce n'est pas une adresse de serveur DNS.** Un domaine personnalisé avec un certificat géré par Google peut être activé, et une adresse IP statique peut être réservée afin que l'adresse survive aux redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails de l'adresse IP statique.

### D. Cloud Logging et Monitoring {#d-cloud-logging--monitoring}

Le stdout/stderr des pods est acheminé vers Cloud Logging ; les métriques GKE sont acheminées vers Cloud Monitoring. Des vérifications de disponibilité et des politiques d'alerte optionnelles sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

Le point d'entrée enregistre une bannière de rappel de portée DNS à chaque démarrage — visible dans les premières lignes du journal d'un nouveau pod.

---

## 3. Comportement de l'application AdGuard Home {#3-adguard-home-application-behaviour}

- **Pas de bootstrap de base de données.** AdGuard Home n'a pas de base de
  données externe, il n'y a donc pas de valeur par défaut `initialization_jobs` — la liste
  est disponible uniquement pour les jobs personnalisés fournis par
  l'opérateur.
- **Assistant de configuration de première exécution.** Lors de la première
  visite à l'adresse IP externe (avant que `AdGuardHome.yaml` n'existe), AdGuard Home
  sert son propre assistant de configuration sur le port 3000 : choisissez le
  port de l'interface web d'administration (gardez-le à 3000), définissez le
  nom d'utilisateur/mot de passe de l'administrateur et sélectionnez les
  serveurs DNS en amont. Rien n'est pré-rempli par la plateforme ici.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/`
  — il n'y a pas de point de terminaison de santé dédié ; la racine renvoie
  `200` avant et après la configuration initiale.
- **La résolution DNS n'est pas accessible.** L'écouteur DNS interne du pod
  peut démarrer, mais rien en dehors du pod/Service ne peut atteindre le port
  53 via la passerelle HTTP(S) standard de GKE. Seule la console
  d'administration web est accessible.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
AdGuard Home sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut
standards.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `adguardhome` | Nom de base pour les ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag de suivi du déploiement. Correspond à l'ARG de build `ADGUARDHOME_VERSION` spécifique à l'application dans le Dockerfile (pas au `APP_VERSION` générique). |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `min_instance_count` | `1` | Réplicas minimum. |
| `max_instance_count` | `1` | Réplicas maximum. |
| `container_port` | `3000` | Le port fixe de l'assistant de configuration. **Pas le port DNS 53.** |
| `container_resources` | `{cpu_limit="1000m", memory_limit="512Mi"}` | Limites de ressources du pod. |
| `enable_cloudsql_volume` | `false` | Non utilisé — pas de base de données. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Accessible au public par défaut — une interface utilisateur, pas un outil de base de données interne uniquement. |
| `workload_type` | `Deployment` | Aucun StatefulSet n'est nécessaire ; la persistance est GCS Fuse. |

### Groupe 10 — IAP et VPC-SC {#group-10--iap--vpc-sc}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Recommandé d'activer — place l'authentification d'identité Google devant la console de politique de filtrage DNS. |

### Groupe 11 — Domaine personnalisé et réseau {#group-11--custom-domain--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |
| `enable_custom_domain` | (valeur par défaut de la fondation) | Provisionne Ingress pour les noms d'hôte personnalisés + certificat géré. |

### Groupe 14 — Cloud Storage {#group-14--cloud-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée les buckets `conf`/`work` toujours provisionnés plus ceux de `storage_buckets`. |
| `gcs_volumes` | `[]` | Laisser vide pour utiliser les montages `conf`/`work` du module. |

### Groupe 16 — Configuration de la base de données {#group-16--database-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixe — ne doit pas être modifié. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` / `health_check_config` | HTTP `/` | Pas de point de terminaison de santé dédié ; la racine renvoie 200 avant et après la configuration. |
| `uptime_check_config` | désactivé | Vérification de disponibilité Cloud Monitoring optionnelle. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Pas de job par défaut — AdGuard Home n'a pas besoin de bootstrap de base de données. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |

### Groupe 7 — StatefulSet {#group-7--statefulset}

Non utilisé par défaut — la persistance se fait via des volumes GCS Fuse, pas un PVC de bloc. `stateful_pvc_enabled` par défaut `null` (désactivé).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le
moyen le plus rapide de localiser et d'explorer les ressources en cours
d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre la console d'administration d'AdGuard Home (**pas** une adresse de résolveur DNS). |
| `storage_buckets` | Buckets Cloud Storage créés (`conf`, `work`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | Statut et canaux de surveillance. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | Statut VPC-SC. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration au moteur de fondation [App_GKE](App_GKE.md), qui valide les
> valeurs et les combinaisons au moment de la planification. Une configuration
> invalide échoue la **planification** avec une erreur claire et nommée avant
> la création de toute ressource.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| Attendre une résolution DNS réelle de ce déploiement | Ne pas s'y fier | **Critique** | Le modèle de passerelle HTTP(S) standard de GKE utilisé par ce module ne peut pas exposer le port 53 TCP/UDP brut — les clients dirigés vers l'IP/nom d'hôte de ce déploiement pour le DNS n'obtiendront aucune réponse. Un `Service type=LoadBalancer` L4 brut secondaire pour le port 53 est en principe possible sur GKE (contrairement à Cloud Run) mais est explicitement hors de portée pour la première version de ce module. |
| `container_port` modifié sans modifier également le port de l'interface web de l'assistant de configuration | Garder les deux à `3000` | Critique | Le port de l'interface web d'exécution d'AdGuard Home provient de `AdGuardHome.yaml` (défini lors de la configuration) — s'il diverge de `container_port`, la sonde de santé de la plateforme et l'URL publique ne correspondent plus à ce que le pod écoute réellement, et le pod ne devient jamais Prêt après le premier redémarrage. |
| `database_type` | `NONE` (ne pas modifier) | Critique | AdGuard Home n'a pas d'intégration de base de données ; définir un moteur réel ici n'a aucun effet mais signale une incompréhension du module. |
| `gcs_volumes` | Laisser vide (valeur par défaut du module) | Critique | Le remplacer sans monter également `conf`/`work` entraîne la perte de la configuration et de l'historique des requêtes d'AdGuard Home à chaque redémarrage du pod. |
| Console d'administration laissée sans IAP | Activer `enable_iap` | Élevé | La console d'administration contrôle la politique de filtrage DNS ; une console ouverte et non authentifiée permet à quiconque ayant l'IP du LoadBalancer de reconfigurer le filtrage ou de lire les journaux de requêtes. |
| `workload_type` modifié en `StatefulSet` | Garder `Deployment` (valeur par défaut du module) | Moyen | Non nécessaire — la persistance est GCS Fuse, pas un PVC de bloc ; un StatefulSet ajoute de la complexité sans avantage ici. |
| `memory_limit` en dessous de `512Mi` | Garder à `512Mi` | Moyen | Une mémoire sous-dimensionnée risque des arrêts OOM sous le bin-packing d'Autopilot. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à AdGuard
Home partagée avec la variante Cloud Run est décrite dans
**[AdGuardHome_Common](AdGuardHome_Common.md)**.

## Guides associés {#related-guides}

- [Labo pratique : AdGuardHome sur GKE Autopilot](../labs/AdGuardHome_GKE.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [AdGuard Home sur Google Cloud Run](AdGuardHome_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [AdGuardHome Common — Configuration d'application partagée](AdGuardHome_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Headscale sur GKE Autopilot](Headscale_GKE.md), [TechnitiumDNS sur GKE Autopilot](TechnitiumDNS_GKE.md), [Gatus sur GKE Autopilot](Gatus_GKE.md) dans la solution **Réseau Zero-trust et DNS**.
