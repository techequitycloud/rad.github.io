---
title: "Firefly III sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Firefly III sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/FireflyIII_GKE.md @ e69407af sha256:053529e873c5 -->

# Firefly III sur GKE Autopilot {#firefly-iii-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/FireflyIII_GKE.png" alt="Firefly III sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Firefly III est un gestionnaire de finances personnelles auto-hébergé, gratuit,
open-source et sous licence AGPL. Il suit les comptes, les transactions, les
budgets, les factures, les catégories et les transactions récurrentes, et
expose une API REST complète. Ce module déploie Firefly III sur **GKE
Autopilot** sur la base de la fondation [App_GKE](App_GKE.md), qui provisionne et
gère l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Firefly III et sur la
manière de les explorer et de les exploiter depuis la Google Cloud Console et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## Ce que coûte Firefly III sur RAD, et comment cela se compare {#what-firefly-iii-costs-on-rad-and-how-that-compares}

**Dans un projet Google Cloud que vous possédez, le module GKE Autopilot de Firefly III sur RAD coûte environ 110 $ US par mois, plus 11 $ US une fois par déploiement et aucune licence par utilisateur.** Pour le coût le plus bas, le [module Cloud Run](FireflyIII_CloudRun.md) exécute le même Firefly III pour environ 84 $ US par mois. Firefly III est un gestionnaire de finances personnelles gratuit et open-source avec une comptabilité en partie double, des budgets et une classification des transactions basée sur des règles. Les chiffres sont à jour au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

Si cela s'exécute dans un projet géré par RAD pour vous, il peut être supprimé et restauré dans les 30 jours pour quelques crédits au lieu de rester en fonctionnement — ainsi, un déploiement à usage occasionnel coûte quelques dollars par mois, et non 110 $ US. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 110 crédits (11 $ US au prix de la recharge) | 99 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût de fonctionnement Google Cloud | Facturé par Google à votre propre compte de facturation, environ **110 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **99 crédits par jour**, soit environ 2 970 par mois (environ 297 $ US au prix de la recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge ponctuelle, et moins avec un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût de fonctionnement par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Pod GKE Autopilot, 1 vCPU / 2 Gio, fonctionnant en permanence | 40 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51 $ US |
| Serveur de fichiers NFS/cache : une petite VM | 13 $ US |
| Passerelle et adresse IP Cloud NAT | 5 $ US |
| Cloud Storage pour les sauvegardes | 1 $ US |
| **Total** | **environ 110 $ US** |

Le niveau gratuit de GKE couvre les frais de gestion d'un cluster Autopilot ou zonal par compte de facturation, donc le total ci-dessus suppose qu'il s'agit de ce cluster ; sinon, ajoutez environ 73 $ US par mois.

### Comment cela se compare {#how-it-compares}

Nous n'avons pas trouvé de plan commercial géré/SaaS spécifiquement pour Firefly III au 8 octobre 2026, donc la comparaison honnête est avec l'exécution par vous-même :

| Option | Par mois | Qui l'exécute |
|---|---|---|
| Hetzner CPX22 (2 vCPU/4 Go) | ~24 $ US | Vous : OS, mises à jour, sauvegardes, correctifs de sécurité |
| DigitalOcean 2 vCPU/4 Go Droplet | 24 $ US | Vous : OS, mises à jour, sauvegardes, correctifs de sécurité |
| GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) | ~49 $ US | Vous : OS, mises à jour, sauvegardes, correctifs de sécurité |
| **RAD, GKE Autopilot, votre propre projet** | **110 $ US**, plus 11 $ US une fois | L'automatisation de RAD, dans votre projet |
| RAD, Cloud Run | environ 84 $ US ; voir le [guide Cloud Run](FireflyIII_CloudRun.md) | RAD |

L'empreinte propre de Firefly III ici (1 vCPU / 2 Gio) est plus légère que celle de la boîte de référence, donc un niveau plus petit et moins cher des mêmes fournisseurs pourrait également l'exécuter confortablement.

- **RAD n'est généralement pas moins cher en espèces qu'un VPS nu — la différence réside dans ce qui est géré pour vous.** Le prix d'un VPS n'inclut pas le temps de l'administrateur pour les sauvegardes, les correctifs de sécurité et les mises à niveau du système d'exploitation ; le Cloud SQL géré par RAD (où cette application utilise une base de données), Secret Manager et la surveillance couvrent cela à la place.
- **Firefly III est un gestionnaire de finances personnelles gratuit et open-source avec une comptabilité en partie double, des budgets et une classification des transactions basée sur des règles.** Cela détermine la colonne qui compte : un fonctionnement prévisible et sans intervention est plus précieux pour la plupart des équipes utilisant ce type d'outil que de réduire de quelques dollars la facture mensuelle.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Firefly III s'exécute dans **un projet géré par RAD pour vous**, vous avez une option au-delà de la réduction d'échelle : **supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour presque rien.** Cela convient bien mieux à un déploiement dont vous n'avez besoin qu'occasionnellement — pour préparer une certification, une démo, un besoin saisonnier — que de le faire fonctionner en continu.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le projet. Google ne le supprime pas immédiatement : il le conserve, récupérable, pendant 30 jours, et comme la facturation est déjà déliée, rien n'est facturé pendant cette attente. Contrairement à la suppression d'un seul module, cela ne détruit pas Cloud SQL, la VM ou GKE Autopilot un par un — l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet peut le restaurer. RAD demande à Google de récupérer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter **Mettre à jour** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela coûte une poignée de crédits de temps de build au total (moins de 1 $ US) pour une chaîne typique de 2 à 3 déploiements.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, et non 110 $ US.** Déployez Firefly III, utilisez-le pour une session, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Mettre à jour, et supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez que les frais de module une fois, les builds, et les heures où il était réellement en ligne.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un projet que vous apportez et que RAD ne gère que pour la facturation), et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime définitivement. La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude/démo conviennent). Google indique que la plupart des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.
- **Un véritable manque : les sauvegardes nocturnes ne survivent pas.** Les sauvegardes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé ce déploiement et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive, ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

GKE maintient au moins un pod en fonctionnement, donc Firefly III ne se met jamais à l'échelle zéro de lui-même. L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ 115 crédits (11,50 $ US). La suppression permet d'économiser de l'argent si Firefly III resterait inutilisé pendant environ 4 jours ou plus dans votre propre projet (environ 3,67 $ US par jour), ou environ 2 jours ou plus dans un projet géré par RAD (99 crédits par jour).
- **Supprimez tout ce que Firefly III utilise.** La majeure partie du coût de fonctionnement est généralement la base de données et toute VM de fichier/cache partagée. Elles ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc la suppression de cette application pendant que quelque chose d'autre partage le projet n'économise que la partie calcul propre à cette application.
- **Conservez d'abord les données.** Les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui, alors copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.
- **Notez vos paramètres.** RAD ne recrée pas un déploiement supprimé pour vous ; vous saisissez à nouveau les paramètres lorsque vous déployez.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant reçoit Firefly III dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais propres à RAD et estimation des crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour le mécanisme de pause/restauration. Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Firefly III fonctionne comme une charge de travail web Laravel/PHP (Apache). Le déploiement relie
un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods PHP/Apache, 1 vCPU / 2 Gio par défaut |
| Base de données | Cloud SQL pour PostgreSQL 15 | Moteur fixe — `DB_CONNECTION = pgsql` ; MySQL n'est pas utilisé |
| Stockage d'objets | Cloud Storage | Un bucket `fireflyiii-uploads` dédié provisionné automatiquement |
| Fichiers persistants | Filestore (NFS, facultatif) | Pièces jointes et données d'exécution montées à `/var/lib/fireflyiii` |
| Secrets | Secret Manager | `APP_KEY` et `STATIC_CRON_TOKEN` Laravel auto-générés ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé facultatif + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur est fixé par la couche d'application partagée.
  Sur GKE, le pod atteint Cloud SQL via le **sidecar Cloud SQL Auth Proxy** sur
  `127.0.0.1:5432` (`DB_HOST = 127.0.0.1`), qui termine TLS vers Cloud SQL — donc le
  saut de bouclage est en texte clair et `PGSQL_SSL_MODE = prefer` (ne forcez pas `require`).
- **`APP_KEY` est généré automatiquement** et stocké dans Secret Manager, matérialisé
  dans l'espace de noms via le pilote CSI Secret Store. Cette clé Laravel chiffre
  les champs sensibles et **ne doit jamais être renouvelée après le premier démarrage**.
- **`STATIC_CRON_TOKEN` est généré automatiquement.** Firefly ne fait pas de planification en arrière-plan
  de lui-même ; quelque chose doit atteindre `GET /api/v1/cron/<STATIC_CRON_TOKEN>` pour exécuter
  les transactions récurrentes, les factures et les budgets automatiques. Le module fournit un
  CronJob Kubernetes `firefly-cron` intégré qui le fait quotidiennement à 03:00 UTC.
- **Exposé via un LoadBalancer externe** avec `session_affinity = ClientIP` afin qu'une
  session utilisateur reste sur un seul pod.
- **Définissez `APP_URL` sur l'hôte externe.** L'URL n'est pas connue au moment de la planification ; définissez
  `application_domains` (ou `APP_URL` via `environment_variables`) une fois que l'adresse IP du
  LoadBalancer est attribuée afin que Firefly construise des liens absolus corrects.
- **La première exécution est `/register`.** Aucun administrateur n'est pré-initialisé — le premier compte créé
  devient le propriétaire/administrateur. Désactivez l'enregistrement ouvert par la suite.
- **NFS est activé par défaut** pour persister les pièces jointes et les données d'exécution à
  `/var/lib/fireflyiii`.
- **Minimum 1 réplica est maintenu** (GKE ne prend pas en charge la mise à l'échelle à zéro).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Firefly III {#a-gke-autopilot--the-firefly-iii-workload}

Les pods Firefly III sont planifiés sur Autopilot, qui facture le CPU/la mémoire que les pods
demandent réellement.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail Firefly III pour voir
  les pods et les événements. Kubernetes Engine → Services et Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  ```

Voir [App_GKE](App_GKE.md) pour savoir comment Autopilot, la mise à l'échelle et le type de charge de travail
(Déploiement vs StatefulSet) sont gérés.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Firefly III stocke toutes les données d'application dans une instance Cloud SQL pour PostgreSQL 15
gérée. Les pods l'atteignent en privé via le **sidecar Cloud SQL Auth Proxy** sur
`127.0.0.1:5432` ; aucune adresse IP publique n'est exposée. Lors du premier déploiement, un Job d'initialisation
crée le rôle et la base de données de l'application et accorde les privilèges.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret Secret Manager contenant le mot de passe
sont affichés dans les [Sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes et
la rotation des mots de passe, voir [App_GKE](App_GKE.md).

### C. Cloud Storage et NFS {#c-cloud-storage--nfs}

Un bucket de téléchargement **Cloud Storage** dédié est provisionné automatiquement. Lorsque NFS est
activé (par défaut), les pièces jointes et le répertoire d'exécution de Firefly III sont montés à partir
d'un volume Filestore/NFS à `/var/lib/fireflyiii`.

- **Console :** Cloud Storage → Buckets ; Filestore → Instances.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### D. Secret Manager {#d-secret-manager}

Deux secrets cryptographiques sont générés automatiquement : la `APP_KEY` Laravel et le
`STATIC_CRON_TOKEN`. Ils sont matérialisés dans l'espace de noms via le pilote CSI Secret Store.
Le mot de passe de la base de données est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~app-key OR name~cron-token"
  POD=$(kubectl get pods -n "$NAMESPACE" -o jsonpath='{.items[0].metadata.name}')
  kubectl exec -n "$NAMESPACE" "$POD" -- env | grep -E 'APP_KEY|STATIC_CRON_TOKEN'
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store CSI.

### E. Cron (transactions récurrentes) {#e-cron-recurring-transactions}

Firefly III exécute les transactions récurrentes, les rappels de factures et les budgets automatiques uniquement lorsqu'un
appelant atteint son point de terminaison cron. Il n'y a pas de planificateur intégré.

- Un CronJob Kubernetes `firefly-cron` intégré (`curlimages/curl`, `0 3 * * *`) appelle
  le point de terminaison cron quotidiennement. Toutes les entrées `cron_jobs` que vous définissez y sont ajoutées
  plutôt que de le remplacer.

### F. Réseau et ingress {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe de Cloud Load Balancing. Un
domaine personnalisé avec un certificat géré par Google peut être activé, et une adresse IP statique peut être
réservée afin que l'adresse survive aux redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails de l'adresse IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les flux stdout/stderr des pods vers Cloud Logging ; les métriques GKE et Cloud SQL vers Cloud
Monitoring. Des vérifications de disponibilité et des politiques d'alerte facultatives sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Firefly III {#3-firefly-iii-application-behaviour}

- **Configuration de la base de données lors du premier déploiement.** Un Job d'initialisation exécute `db-init.sh` en utilisant
  `postgres:15-alpine`. Il crée de manière idempotente le rôle et la base de données de l'application et
  accorde les privilèges sur la base de données et le schéma `public`. Le job peut être réexécuté en toute sécurité.
- **Schéma créé au démarrage du conteneur.** Il n'y a **pas de job de migration séparé**. L'image
  `fireflyiii/core` exécute `php artisan migrate --force` et
  `firefly-iii:upgrade-database` à chaque démarrage, donc la mise à niveau de `application_version`
  applique les modifications de schéma automatiquement une fois que `db-init` a provisionné la base de données.
- **`APP_KEY` est immuable après le premier démarrage.** La rotation rend tous les champs précédemment
  chiffrés illisibles.
- **Définissez `APP_URL` sur l'hôte externe** après l'attribution de l'adresse IP du LoadBalancer :
  ```bash
  kubectl patch deploy <service-name> -n "$NAMESPACE" \
    -p '{"spec":{"template":{"spec":{"containers":[{"name":"fireflyiii","env":[
      {"name":"APP_URL","value":"https://firefly.example.com"}
    ]}]}}}}'
  ```
  Ou définissez `application_domains` / `environment_variables` avant le déploiement.
- **La première exécution est `/register`.** Créez le compte propriétaire, puis désactivez les enregistrements ultérieurs
  dans **Administration → Paramètres**.
- **Le point de terminaison Cron gère les éléments récurrents.** Le CronJob `firefly-cron` intégré appelle
  `GET <host>/api/v1/cron/<STATIC_CRON_TOKEN>` quotidiennement ; vérifiez-le avec
  `kubectl get cronjobs -n "$NAMESPACE"`.
- **Chemin de santé.** La sonde de démarrage est TCP sur le port 8080. La sonde de vivacité est HTTP
  sur le point de terminaison JSON `/status` non authentifié de Firefly III (HTTP 200, pas de connexion).

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres
spécifiques ou notables pour Firefly III sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec son comportement standard et ses valeurs par défaut.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails autorisés à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `fireflyiii` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag d'image `fireflyiii/core` ; épingler à une version (par exemple `version-6.1.21`) en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `prebuilt` | Déploie directement l'image officielle `fireflyiii/core`. |
| `min_instance_count` | `1` | Réplicas minimum (GKE nécessite ≥ 1). |
| `max_instance_count` | `1` | Réplicas maximum. |
| `container_port` | `8080` | Firefly III (Apache) écoute sur le port 8080. |
| `enable_cloudsql_volume` | `true` | Sidecar Auth Proxy ; requis pour la connectivité de bouclage à Cloud SQL. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image dans Artifact Registry avant le déploiement. |
| `timeout_seconds` | `300` | Durée maximale de la requête. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires. Les valeurs principales (`DB_CONNECTION`, `PGSQL_SSL_MODE`, `TRUSTED_PROXIES`, `APP_ENV`, `DB_HOST=127.0.0.1`) sont définies automatiquement ; ajoutez `APP_URL`. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. `APP_KEY` et `STATIC_CRON_TOKEN` sont injectés automatiquement. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 6 — Backend et cluster GKE {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service Kubernetes est exposé. |
| `workload_type` | `null` | Se résout en `Deployment` si non défini ; définissez `StatefulSet` explicitement si nécessaire. |
| `session_affinity` | `ClientIP` | Le routage persistant maintient la session d'un utilisateur sur un seul pod. |
| `network_tags` | `["nfsserver"]` | `nfsserver` est requis lorsque `enable_nfs = true`. |
| `termination_grace_period_seconds` | `30` | Secondes à attendre après SIGTERM avant SIGKILL. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Non requis — Firefly III stocke tout l'état dans PostgreSQL. |
| `stateful_pvc_size` / `stateful_pvc_mount_path` / `stateful_pvc_storage_class` | `10Gi` / `/data` / `standard-rwo` | Paramètres PVC par pod. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `false` | Désactivé par défaut car `max_instance_count = 1` (un PDB égal au nombre de réplicas bloque les vidanges de nœuds). |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles pendant les perturbations volontaires. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | Port TCP 8080 | Sonde de démarrage. |
| `liveness_probe` | HTTP `/status`, délai de 300 s | Point de terminaison de santé JSON non authentifié de Firefly III. |
| `health_check_config` / `startup_probe_config` | Sondes de niveau App_GKE | Sondes d'infrastructure. |
| `uptime_check_config` | désactivé | Vérification de disponibilité Cloud Monitoring facultative. |
| `alert_policies` | `[]` | Politiques d'alerte métriques facultatives. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | CronJobs supplémentaires. L'appel quotidien `firefly-cron` à `/api/v1/cron/<STATIC_CRON_TOKEN>` est intégré et toujours ajouté à côté de ceux-ci. |
| `additional_services` | `[]` | Services sidecar ou auxiliaires déployés avec Firefly III. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Persister les pièces jointes et les données d'exécution à `/var/lib/fireflyiii`. |
| `nfs_mount_path` | `/var/www/html/storage/upload` | Chemin de montage à l'intérieur du conteneur. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer des buckets GCS supplémentaires au-delà du bucket de téléchargement. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets supplémentaires à provisionner. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse via le pilote CSI. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Politique de nettoyage d'Artifact Registry. |

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Backend de cache/session facultatif ; Firefly III utilise la base de données par défaut. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Point de terminaison et authentification Redis. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `"POSTGRES_15"` | Définir explicitement, correspondant au moteur `FireflyIII_Common` fixe pour cette application. |
| `application_database_name` | `fireflyiii` | Nom de la base de données, injecté comme `DB_DATABASE`. Immuable après le premier déploiement. |
| `application_database_user` | `fireflyiii` | Utilisateur de l'application, injecté comme `DB_USERNAME`. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter à 30–90 pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner Ingress pour les noms d'hôte personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir ; définit également `APP_URL`. |
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

> **Recommandé pour les données financières personnelles.** Firefly III contient des données financières
> sensibles — placer IAP devant restreint l'accès aux identités Google authentifiées et autorisées.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google devant Firefly III. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque IAP est activé (sensible). |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attacher une politique Cloud Armor (WAF) au backend Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à un accès privilégié. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend Ingress GKE. |

### Groupe 8 / 22 — Quota de ressources, VPC-SC et journalisation d'audit {#group-8--22--resource-quota-vpc-sc--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Quota de ressources d'espace de noms. Les valeurs de mémoire nécessitent des suffixes binaires (`4Gi`). |
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode de simulation. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de
localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `service_external_ip` | IP du LoadBalancer externe (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Firefly III. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom de la base de données / utilisateur de l'application. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (`127.0.0.1` via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'importation (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur de fondation [App_GKE](App_GKE.md), qui valide les valeurs *et les combinaisons* au moment de la planification — un réplica en lecture sans son primaire, IAP sans identités autorisées, un environnement d'exécution `gen1` avec des montages NFS/GCS, un `redis_port`/`backup_retention_days` hors plage. Une configuration invalide échoue la **planification** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'au moment de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `APP_KEY` (auto-généré) | Ne jamais faire pivoter après le premier démarrage | Critique | Le faire pivoter rend tous les champs précédemment chiffrés illisibles — les données sont effectivement perdues. |
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activation sans un `backup_file` valide fait échouer le job d'importation. |
| `PGSQL_SSL_MODE` (auto `prefer`) | Laisser tel quel | Élevé | Forcer `require` contre le bouclage en texte clair de l'Auth Proxy échoue ("SSL n'est pas activé sur le serveur"). |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy est requis pour la connectivité de bouclage à Cloud SQL. |
| `APP_URL` | URL du LoadBalancer externe / du domaine | Élevé | Une URL non définie ou incorrecte rompt les liens absolus, les redirections et les rappels OAuth. |
| `STATIC_CRON_TOKEN` / job cron | Laisser le job `firefly-cron` intégré en place | Élevé | Sans appel cron planifié, les transactions récurrentes, les factures et les budgets automatiques ne se déclenchent jamais. |
| `enable_nfs` | `true` | Élevé | Le désactiver place les pièces jointes sur un stockage de pod éphémère — les fichiers disparaissent au redémarrage du pod. |
| `session_affinity` | `ClientIP` | Élevé | Sans persistance, l'état de la session peut être acheminé vers différents pods et perturber l'interface utilisateur. |
| `enable_iap` | activer pour les données privées | Élevé | Firefly III contient des données financières ; le laisser publiquement accessible l'expose. |
| Enregistrement lors de la première exécution | Désactiver après le premier administrateur | Élevé | Laisser l'enregistrement ouvert permet à quiconque ayant l'URL de créer un compte. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers nus sont des octets et bloquent toute planification de pod dans l'espace de noms. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**. La configuration
d'application spécifique à Firefly III partagée avec la variante Cloud Run est décrite dans
**[FireflyIII_Common](FireflyIII_Common.md)**.

<!-- related-guides -->

## Guides associées {#related-guides}

- [Lab pratique : Firefly III sur GKE Autopilot](../labs/FireflyIII_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Firefly III sur Google Cloud Run](FireflyIII_CloudRun.md) — la même application sur Cloud Run, pour quand vous avez besoin de l'autre cible de déploiement.
- [Firefly III Common — Configuration d'application partagée](FireflyIII_Common.md) — la configuration partagée par les deux cibles de déploiement.
