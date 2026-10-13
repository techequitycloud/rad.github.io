---
title: "Mautic sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Mautic sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Mautic_GKE.md @ e69407af sha256:f5ee7372c342 -->

# Mautic sur GKE Autopilot {#mautic-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Mautic_GKE.png" alt="Mautic sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Mautic est une plateforme open source d'automatisation du marketing pour les
campagnes e-mail, la gestion des contacts, les pages de destination et la
notation des prospects. Ce module déploie Mautic sur **GKE Autopilot** en
s'appuyant sur le socle [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Mautic et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement
— reportez-vous au [guide du socle App_GKE](App_GKE.md) plutôt que de les
répéter ici.

---

## Ce que coûte Mautic sur RAD, et comment cela se compare {#what-mautic-costs-on-rad-and-how-that-compares}

**Le module Mautic sur GKE Autopilot de RAD coûte environ 150 $ US par mois dans votre propre projet, sans licence par contact.** RAD facture 175 crédits une fois par déploiement dans votre propre projet (157,5 crédits, soit 10 % de moins, dans un projet géré par RAD), plus le temps de build. La même application se déploie également sur Cloud Run pour environ 102 $ US par mois — voir le [guide Cloud Run](Mautic_CloudRun.md) pour l'option la moins chère. Si vous n'en avez besoin qu'occasionnellement, un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour quelques crédits, de sorte que ce chiffre mensuel devient quelques dollars au lieu de 150 $ US — voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 175 crédits (17,50 $ US au prix de la recharge) | 157,5 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **150 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **115 crédits par jour**, soit environ 3 450 par mois (environ 345,00 $ US au prix de la recharge, moins avec un abonnement) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge ponctuelle, et moins avec un abonnement mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas de deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Pod GKE Autopilot, 2x vCPU / 4 Gio | 79 $ US |
| Cloud SQL pour MySQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ US si c'est votre seul cluster, sinon ~73 $ US |
| **Total** | **environ 150 $ US** |

### Comment cela se compare {#how-it-compares}

- Le **plan Marketing Hub Professional de HubSpot** commence à **800 $ US par
  mois** (incluant 3 sièges principaux ; sièges supplémentaires à partir de 45 $
  chacun) et nécessite des **frais d'intégration uniques de 3 000 $ US**. Son
  plan d'entrée Starter est beaucoup moins cher (à partir de 7 $ / siège / mois)
  mais supprime la plupart des fonctionnalités d'automatisation du marketing que
  Mautic propose par défaut.
- Le module Mautic de RAD coûte environ 150 $ US par mois dans votre propre
  projet — une petite fraction du prix de HubSpot Professional, sans niveau de
  licence par contact à dépasser et sans frais d'intégration, car il déploie le
  propre moteur d'automatisation open source de Mautic plutôt qu'une plateforme
  mesurée par un fournisseur.
- Comparaison auto-gérée : avec 2 vCPU / 4 Gio et une base de données MySQL,
  une instance GCP Compute Engine e2-standard-2 (environ 49 $ / mois) est dans
  la fourchette, mais vous gérez vous-même MySQL, la délivrabilité des e-mails,
  les sauvegardes et les mises à niveau.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Mautic s'exécute dans **un projet géré par RAD pour vous**, vous avez une
deuxième option qui va bien au-delà de la mise à l'échelle à zéro : **supprimez
l'ensemble du projet et restaurez-le dans les 30 jours pour presque rien.**
Ceci convient bien mieux à Mautic dont vous n'avez besoin qu'occasionnellement
— évaluation, environnement de démonstration, charge de travail saisonnière ou
intermittente — que de le faire fonctionner en continu.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord
  sa facturation, puis demande à Google de supprimer le projet. Google ne
  supprime pas le projet immédiatement : il le conserve, récupérable, pendant
  30 jours. Comme la facturation est déjà déliée, rien n'est facturé pendant
  cette attente. Contrairement à la suppression d'un seul module, cela ne
  détruit pas la base de données, les VM ou les ressources de calcul une par
  une — l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte quelques crédits, pas une reconstruction.** Dans les
  30 jours, le propriétaire du projet peut le restaurer. RAD demande à Google
  de récupérer le projet et de rattacher son compte de facturation, puis vous
  demande d'exécuter **Update** sur chaque déploiement pour confirmer que tout
  est revenu. Comme rien n'a été détruit individuellement, cette mise à jour
  trouve les mêmes ressources déjà présentes — c'est une vérification, pas une
  reconstruction, et une mise à jour ne facture jamais à nouveau les frais de
  module. Pour Mautic derrière Services_GCP (un cluster GKE, une petite VM
  NFS/cache, une base de données MySQL) et Project_GCP, cela représente
  environ **une poignée de crédits (moins de 1 $ US)** au total, contre les
  environ 180 crédits (18,00 $ US) que coûte un redéploiement complet.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars,
  pas 150 $ US.** Déployez Mautic, utilisez-le un certain temps, supprimez le
  projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez
  avec Update, et supprimez-le à nouveau lorsque vous avez terminé. Vous ne
  payez les frais de module qu'une seule fois, les builds, et le temps réel
  d'exécution.
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet dont
  RAD gère uniquement la facturation), et vous le restaurez vous-même dans les
  30 jours — après cela, Google le supprime définitivement. La restauration
  est admise comme la création d'un nouveau projet : votre solde de crédits
  achetés doit toujours dépasser le seuil du niveau (100 crédits pour le
  niveau sandbox que la plupart des évaluations utilisent). Google indique que
  la plupart des services sont à nouveau pleinement fonctionnels dans les 36
  heures suivant une restauration.
- **Un véritable manque : les sauvegardes nocturnes ne survivent pas.** Les
  sauvegardes et autres fichiers générés sont écrits dans un bucket à
  l'intérieur du projet, et ce bucket n'est **pas** protégé par la suppression
  logicielle de Cloud Storage, il est donc très probable qu'il disparaisse dès
  que vous supprimez le projet — même si le projet lui-même est récupérable
  pendant 30 jours. Si vous avez personnalisé Mautic et que vous souhaitez
  conserver ce travail, copiez une sauvegarde (vers Google Drive ou un bucket
  extérieur au projet) avant de supprimer. Pour une installation par défaut
  sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre
propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de
payer est de supprimer le déploiement et de le redéployer lorsque vous en avez
besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau, plus les
  builds — environ 180 crédits (18,00 $ US) au total. La suppression ne permet
  d'économiser de l'argent que si Mautic devait rester inutilisé assez
  longtemps pour compenser ce coût de redéploiement par rapport à son propre
  coût d'exécution — environ **4 jours ou plus**, à la fois dans votre propre
  projet (environ 4,99 $ US par jour) et dans un projet géré par RAD (115
  crédits par jour).
- **La majeure partie du coût d'exécution est généralement partagée.** Pour
  Mautic, il s'agit de la base de données et de la VM partagée de fichiers/cache.
  Elles ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise,
  donc la suppression de cette application alors que quelque chose d'autre
  partage le projet n'économise que la partie calcul de cette application.
- **Conservez d'abord vos données.** Les sauvegardes nocturnes vont dans un
  bucket à l'intérieur du déploiement et sont supprimées avec lui, alors
  copiez la dernière sauvegarde avant de supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour
  une classe. Chaque participant obtient l'application dans son propre projet
  Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation
  définie par le formateur. Soit le formateur finance toutes les places, soit
  chaque participant paie la sienne. Tout est supprimé à la fin de la session
  et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute
  l'application pour un client à partir d'un portefeuille cloisonné qu'il
  finance, et règle directement avec le client. Si le portefeuille est faible,
  la facturation est suspendue et les données sont conservées, de sorte que
  personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le
  projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF,
NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud
Billing Catalog ; frais RAD et estimation des crédits quotidiens de
[radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et
restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour les mécanismes de pause/restauration et ce qu'il dit sur les objets Cloud
Storage sans suppression logicielle ; [HubSpot](https://www.hubspot.com/pricing/marketing).
Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Mautic s'exécute comme une charge de travail web PHP/Apache. Le déploiement
connecte un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods PHP/Apache, 2 vCPU / 4 Gio par défaut, autoscalés horizontalement |
| Base de données | Cloud SQL pour MySQL 8.0 | Requis — Mautic ne prend pas en charge PostgreSQL |
| Fichiers partagés | Filestore (NFS) | Médias et ressources téléchargés partagés entre toutes les répliques |
| Stockage d'objets | Cloud Storage | Un bucket média dédié |
| Cache et sessions | Redis | Activé par défaut ; revient à l'adresse IP de l'hôte NFS si aucun hôte Redis n'est spécifié |
| Secrets | Secret Manager | Mot de passe administrateur et mot de passe de base de données générés automatiquement |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé facultatif + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** Le moteur de base de données est fixe ;
  sélectionner PostgreSQL ou `NONE` interrompt le démarrage.
- **Redis est activé par défaut.** Avec plus d'une réplique, un cache partagé
  est nécessaire pour maintenir la cohérence de l'état des sessions et des
  campagnes.
- **L'affinité de session est `ClientIP`.** Mautic s'appuie sur les sessions PHP,
  donc les requêtes d'un navigateur sont épinglées à un pod.
- **Les migrations de base de données s'exécutent à chaque démarrage de pod**
  (idempotent), de sorte que les mises à niveau de version s'appliquent
  automatiquement. La sonde de démarrage alloue environ 90 secondes pour la
  configuration initiale.
- Le **mot de passe administrateur** de Mautic est généré automatiquement et
  stocké dans Secret Manager ; vous ne le définissez jamais en texte clair.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté `gcloud container clusters get-credentials <cluster> --region <region> --project <project>` et que `PROJECT`,
`REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Mautic {#a-gke-autopilot--the-mautic-workload}

Les pods Mautic sont planifiés sur Autopilot, qui facture le CPU/la mémoire
réellement demandés par les pods. L'autoscaling horizontal des pods dimensionne
le déploiement entre le nombre minimum et maximum de répliques.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge
  de travail Mautic pour voir les pods, les révisions et les événements.
  Kubernetes Engine → Services et Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de l'autoscaling et du
type de charge de travail (Deployment vs StatefulSet).

### B. Cloud SQL pour MySQL 8.0 {#b-cloud-sql-for-mysql-80}

Mautic stocke toutes les données d'application (contacts, campagnes, segments)
dans une instance Cloud SQL pour MySQL 8.0 gérée. Les pods y accèdent
privatement via le sidecar **Cloud SQL Auth Proxy** sur un socket Unix, de sorte
qu'aucune IP publique n'est exposée. Lors du premier déploiement, un job
d'initialisation crée la base de données et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les indicateurs et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret
Secret Manager contenant le mot de passe sont tous affichés dans les
[Sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes
automatisées et la rotation des mots de passe, voir [App_GKE](App_GKE.md).

### C. Filestore (NFS) et Cloud Storage {#c-filestore-nfs-and-cloud-storage}

Les médias téléchargés sont écrits sur un partage **Filestore (NFS)** monté dans
chaque pod afin que toutes les répliques voient les mêmes fichiers. Un bucket
**Cloud Storage** `media` est également provisionné, mais rien ne le monte ou
n'y écrit — il est conservé uniquement parce que sa suppression d'un
déploiement existant déclenche un cycle de dépendance Terraform.

- **Console :** Filestore → Instances pour le partage NFS ; Cloud Storage →
  Buckets pour le bucket média.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<media-bucket>/          # bucket name is in the Outputs
  # Confirm the share is mounted inside a pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h | grep -i nfs
  ```

Voir [App_GKE](App_GKE.md) pour le provisionnement NFS, GCS Fuse et les options
CMEK.

### D. Cache Redis {#d-redis-cache}

Redis prend en charge la mise en cache de Mautic et, dans les déploiements
multi-répliques, maintient la cohérence de l'état du cache et des verrous.
Lorsqu'aucun hôte Redis externe n'est configuré et que NFS est activé, l'adresse
IP de l'hôte NFS est utilisée comme point de terminaison Redis.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping        # from a host with network access
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager {#e-secret-manager}

Le mot de passe administrateur de Mautic et le mot de passe de la base de
données sont stockés en tant que secrets Secret Manager et injectés dans les
pods au moment de l'exécution ; le texte en clair n'apparaît jamais dans la
configuration.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données se trouve dans les
[Sorties](#5-outputs). Voir [App_GKE](App_GKE.md) pour l'intégration et la
rotation de Secret Store CSI.

### F. Réseau et ingress {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe de Cloud Load
Balancing. Un domaine personnalisé avec un certificat géré par Google peut être
activé, et une IP statique peut être réservée afin que l'adresse survive aux
redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses
  IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails des IP statiques.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les flux stdout/stderr des pods vers Cloud Logging ; les métriques GKE et Cloud
SQL vers Cloud Monitoring. Des vérifications de disponibilité et des politiques
d'alerte facultatives sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Mautic {#3-mautic-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation crée la base de données et l'utilisateur Mautic et accorde
  les privilèges avant le démarrage de l'application. Il est idempotent et peut
  être réexécuté en toute sécurité.
- **Migrations au démarrage.** Chaque pod exécute les migrations de base de
  données de Mautic pendant le démarrage, de sorte que la mise à niveau de la
  version de l'application applique automatiquement les modifications de
  schéma.
- **Commandes planifiées (essentielles).** Les campagnes, la file d'attente
  d'e-mails et les mises à jour de segments de Mautic sont pilotées par des
  commandes planifiées. Sans elles, les campagnes ne se déclenchent jamais et
  aucun e-mail n'est envoyé. Mautic n'a pas de planificateur intégré, elles
  s'exécutent donc en tant que CronJobs Kubernetes :

  | Commande | Objectif | Cadence |
  |---|---|---|
  | `mautic:segments:update` | Actualiser l'appartenance aux segments | toutes les 15 min (`:00`, `:15`, …) |
  | `mautic:campaigns:update` | Reconstruire l'appartenance aux campagnes | toutes les 15 min (`:05`, `:20`, …) |
  | `mautic:campaigns:trigger` | Déclencher les événements de campagne planifiés | toutes les 15 min (`:10`, `:25`, …) |

  Ces trois commandes sont planifiées par le module lui-même, décalées pour ne
  jamais se chevaucher, et exécutées via `mautic-cron.sh` (qui mappe les paramètres de la
  base de données comme le fait le conteneur web et attend le proxy Cloud SQL).
  Tout ce que Mautic propose d'autre — par exemple `mautic:queue:process` si vous mettez les
  e-mails en file d'attente, ou `mautic:maintenance:cleanup` — est ajouté via `cron_jobs`, qui est
  ajouté aux trois commandes intégrées.

  Inspecter les tâches planifiées et leurs exécutions :
  ```bash
  kubectl get cronjobs -n "$NAMESPACE"
  kubectl get jobs -n "$NAMESPACE" --sort-by=.metadata.creationTimestamp
  ```
- **Chemin de santé.** La disponibilité/vivacité utilise la page de connexion de
  Mautic, qui renvoie HTTP 200 uniquement lorsque l'application est
  entièrement initialisée.
- **Connexion administrateur.** Le nom d'utilisateur et l'e-mail
  administrateur initiaux sont configurables ; le mot de passe est récupéré de
  Secret Manager (voir §2.E).

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Mautic sont listés ; toutes les autres entrées sont héritées de
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
| `support_users` | `[]` | E-mails auxquels sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts/de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `mautic` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Mautic` | Nom convivial affiché dans la console. |
| `application_description` | `Mautic Marketing Automation on GKE Autopilot` | Annotation de description de la charge de travail. |
| `application_version` | `5` | Tag de version de l'image Mautic ; incrémenter pour déployer une nouvelle version. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `2000m` | CPU par pod ; 2 vCPU recommandés pour Mautic. |
| `memory_limit` | `4Gi` | Mémoire par pod ; 4 Gio recommandés (évite les OOM PHP lors des importations). |
| `min_instance_count` | `1` | Répliques minimales. Maintenir ≥ 1 pour que les tâches planifiées aient une cible. |
| `max_instance_count` | `5` | Répliques maximales (plafond de l'autoscaler). |
| `container_port` | `80` | Mautic/Apache écoute sur le port 80. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions socket. |
| `enable_vertical_pod_autoscaling` | `false` | Laisser Autopilot ajuster automatiquement les demandes de ressources. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Les valeurs de base `MAUTIC_*` sont définies automatiquement. |
| `secret_environment_variables` | `{}` | Mappage variable d'environnement → nom du secret Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service est exposé. |
| `session_affinity` | `ClientIP` | Routage persistant requis pour les sessions PHP Mautic. |
| `workload_type` | `null` | Se résout automatiquement en StatefulSet lorsque le stockage par pod est activé. |
| `network_tags` | `['nfsserver']` | Tags de nœud/pod ; `nfsserver` est requis pour la connectivité NFS. |

### Groupe 7 — Quota de ressources {#group-7--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Plafonner les comptes CPU/mémoire/objets de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doit utiliser des unités binaires (`4Gi`, `8192Mi`)** — les entiers nus sont lus comme des octets et bloquent la planification. |

### Groupe 8 — Politiques de fiabilité {#group-8--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protéger la disponibilité pendant les mises à niveau de nœuds. |
| `pdb_min_available` | `1` | Augmenter `min_instance_count` au-dessus de 1 si vous avez besoin d'une marge d'éviction. |
| `enable_topology_spread` | `false` | Répartir les pods sur plusieurs zones. |

### Groupe 9 — Observabilité et santé {#group-9--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | Remplacé par HTTP `/healthz` | Le module remplace les deux sondes de la page de connexion de Mautic : `/index.php/s/login` renvoie HTTP 500 (redirection de l'installateur) tant que la base de données n'est pas configurée, donc les sondes kube atteignent plutôt le fichier statique `/healthz`, qui renvoie 200 quelle que soit l'état de l'application. |
| `uptime_check_config` | désactivé | Vérification de disponibilité Cloud Monitoring facultative. |
| `alert_policies` | `[]` | Politiques d'alerte métrique facultatives. |

### Groupe 10 — Jobs et tâches planifiées {#group-10--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job de configuration de base de données intégré. |
| `cron_jobs` | `[]` | Jobs planifiés supplémentaires, ajoutés aux trois commandes Mautic que le module planifie lui-même (§3). |

### Groupe 11 — Intégration CI/CD et GitHub {#group-11--cicd--github-integration}

Intégration standard App_GKE Cloud Build / Cloud Deploy — voir
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`, `github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume Filestore partagé pour les médias Mautic (garder activé pour multi-réplique). |
| `nfs_mount_path` | `/var/www/html/docroot/media/files` | Chemin de montage à l'intérieur du conteneur. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner le bucket média. |
| `storage_buckets` / `gcs_volumes` | _(défini)_ | Buckets supplémentaires / montages GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Utiliser Redis pour la mise en cache/les sessions. |
| `redis_host` | `""` | Laisser vide pour utiliser l'adresse IP de l'hôte NFS ; définir explicitement lorsque NFS est désactivé. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Fixe — ne pas modifier. |
| `application_database_name` | `mautic` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `mautic` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16-64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter à 30-90 pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`, `custom_sql_scripts_use_root` — exécuter du SQL à partir d'un bucket GCS après le provisionnement. Voir [App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner Ingress pour les noms d'hôtes personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôtes à servir. |
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google devant Mautic. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque IAP est activé (sensible). |
| `iap_support_email` | `""` | Affiché sur l'écran de consentement OAuth. |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attacher une politique Cloud Armor (WAF) au backend Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à un accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la politique. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode dry-run. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

### Groupe 23 — Paramètres de l'application Mautic {#group-23--mautic-application-settings}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `mautic_admin_username` | `admin` | Connexion de l'administrateur initial. |
| `mautic_admin_email` | `admin@example.com` | E-mail de l'administrateur — **définir une adresse réelle** (les notifications système y sont envoyées). |
| `mailer_from_name` | `Mautic` | Nom d'affichage sur les e-mails de campagne sortants. |
| `mailer_from_email` | `mautic@example.com` | Adresse d'expéditeur — **utiliser un domaine avec SPF/DKIM valide** ou le courrier est rejeté/classé comme spam. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen
le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Mautic. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via le proxy d'authentification) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'importation (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD (dépôt, déclencheur, registre). |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `MYSQL_8_0` | Critique | Mautic nécessite MySQL ; PostgreSQL/`NONE` interrompt le démarrage. |
| Commandes planifiées intégrées (§3) | laisser en place | Critique | Aucune campagne ne se déclenche sans elles ; ajouter le traitement de la file d'attente d'e-mails via `cron_jobs` si vous mettez les e-mails en file d'attente. |
| `enable_nfs` | `true` | Critique | Sans stockage partagé, les téléchargements sont perdus au redémarrage et non partagés entre les répliques. |
| `application_database_name` / `_user` | définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit les données. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans `backup_uri` valide échoue au job d'importation. |
| `quota_memory_requests` / `_limits` | unités binaires | Critique | Les entiers nus sont des octets et bloquent toute planification. |
| `enable_redis` | `true` | Élevé | Avec >1 réplique, les caches isolés par pod entraînent une incohérence. |
| `redis_host` | `""` (NFS) ou explicite | Élevé | Pas de point de terminaison valide si Redis est activé mais NFS est désactivé et aucun hôte n'est défini. |
| `memory_limit` | `4Gi` | Élevé | Trop peu de mémoire provoque des OOM PHP lors des importations/envois. |
| `session_affinity` | `ClientIP` | Élevé | Sans persistance, les connexions multi-répliques perdent l'état de session. |
| `mautic_admin_email` / `mailer_from_email` | adresses réelles | Élevé | Les espaces réservés n'envoient nulle part et sont rejetés/classés comme spam. |
| `min_instance_count` | `1` | Élevé | `0` laisse les tâches planifiées sans pod pour s'exécuter. |
| `enable_iap` / `enable_cloud_armor` | activer pour l'administration | Moyen | L'interface utilisateur d'administration est sinon publiquement accessible. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |
| `pdb_min_available` vs `min_instance_count` | laisser de la marge | Moyen | `1`/`1` peut bloquer les mises à niveau de nœuds (un seul pod ne peut pas être évincé). |

---

Pour le comportement du socle référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Mautic
partagée avec la variante Cloud Run est décrite dans
**[Mautic_Common](Mautic_Common.md)**.

<!-- related-guides -->

## Guides connexes {#related-guides}

- [Lab pratique : Mautic sur GKE Autopilot](../labs/Mautic_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Mautic sur Google Cloud Run](Mautic_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Mautic Common — Configuration d'application partagée](Mautic_Common.md) — la configuration partagée par les deux cibles de déploiement.
