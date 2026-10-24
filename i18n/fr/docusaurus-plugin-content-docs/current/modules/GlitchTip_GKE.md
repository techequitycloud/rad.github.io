---
title: "GlitchTip sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de GlitchTip sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/GlitchTip_GKE.md @ e69407af sha256:de497a677d51 -->

# GlitchTip sur GKE Autopilot {#glitchtip-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/GlitchTip_GKE.png" alt="GlitchTip sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

GlitchTip est une plateforme open source de suivi des erreurs et de surveillance des
performances (Django/Python), compatible avec Sentry. Vos applications envoient les
exceptions et les traces au point d'ingestion du protocole Sentry de GlitchTip, et
GlitchTip les stocke, les déduplique et les signale. Ce module déploie GlitchTip sur
**GKE Autopilot** en s'appuyant sur la fondation [App_GKE](App_GKE.md), qui provisionne
et gère l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par GlitchTip et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande.
Pour les mécanismes communs à toutes les applications GKE — Workload Identity, ingress,
autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## Ce que coûte GlitchTip sur RAD et comparaison {#what-glitchtip-costs-on-rad-and-how-that-compares}

**L'exécution de GlitchTip dans votre propre projet Google Cloud coûte environ 149,81 $ US/mois en frais Google Cloud, en plus d'un frais de module RAD unique de 175 crédits** (157,5 crédits — 10 % de moins — dans un projet géré par RAD). GlitchTip est une plateforme open source de suivi des erreurs et de surveillance des performances des applications, compatible avec Sentry. Si vous déployez dans un projet géré par RAD, vous pouvez tout mettre en pause gratuitement et le reprendre plus tard — voir "Mettre en pause gratuitement" ci-dessous.

*GlitchTip est également disponible sur Cloud Run — voir le [guide Cloud Run](GlitchTip_CloudRun.md) pour l'option à moindre coût ; ce guide couvre la variante GKE.*

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module | **175 crédits** (une fois) | **157,5 crédits** (une fois, 10 % de moins) |
| Temps de build | ~3–6 crédits (une fois, par build) | ~3–6 crédits (une fois, par build) |
| Coût d'exécution Google Cloud | ~149,81 $ US/mois, facturé à votre propre compte de facturation Google au prix catalogue | ~111 crédits/jour (~11,10 $ US/jour), mesuré à l'heure au prix catalogue plus la marge de RAD |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | $ US/mois (prix catalogue Google, us-central1) |
|---|---|
| Pod GKE Autopilot, 2 vCPU / 4 GiB | 79,35 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 |
| **Total** | **149,81 $ US** |

### Comparaison {#how-it-compares}

- Le plan payant le moins cher de **GlitchTip hébergé**, Small, coûte 15 $ US/mois (jusqu'à 100 000 événements/mois) — vérifié sur [https://glitchtip.com/pricing](https://glitchtip.com/pricing). Cela réduit le coût de la facture Google Cloud de RAD d'environ 149,81 $ US/mois pour la variante GKE, mais cela plafonne l'utilisation ; l'instance de RAD est illimitée, auto-hébergée, et les données ne quittent jamais votre propre projet.
- Le véritable compromis ici est entre le plafond et le contrôle, pas le prix : un plan SaaS géré est moins cher à cette échelle, et le coût d'exécution de RAD est ce que coûtent réellement Cloud SQL, le calcul et le réseau au prix catalogue de Google, sans rien de caché dans un prix de siège groupé.
- RAD ne prétend pas être moins cher qu'un VPS nu en termes monétaires — ce n'est généralement pas le cas. L'intérêt de RAD est ce qui est géré pour vous.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si GlitchTip est exécuté dans un **projet géré par RAD**, vous pouvez arrêter de le payer entièrement sans le détruire. La suppression de ce projet délie d'abord sa facturation, puis demande à Google de supprimer purement et simplement le projet — la suppression logique récupérable de 30 jours de Google. Contrairement à la suppression du module GlitchTip seul, cela ne supprime pas Cloud SQL, aucune VM ou la ressource de calcul une par une : l'ensemble du projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de restaurer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter la mise à jour sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais à nouveau les frais de module. Cela ne coûte qu'une poignée de crédits de temps de build au total — environ 5 à 10 crédits, moins de 1 $ US, pour une chaîne typique de 2 à 3 déploiements. Les frais de module de 157,5 crédits ne sont pas facturés à nouveau.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD gère uniquement la facturation), vous devez le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est admise comme la création d'un nouveau projet, donc votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude/démo conviennent). Google indique que la plupart des services fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a la suppression logique de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé GlitchTip et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive ou un bucket en dehors du projet) avant de la supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Si GlitchTip se trouve dans votre propre projet (ou si plus de 30 jours se sont écoulés sur un projet géré par RAD), la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer plus tard lorsque vous en aurez à nouveau besoin.

Un redéploiement coûte à nouveau les frais de module, plus les builds : environ **175 + ~3–6 crédits** (~17,95 $ US) dans votre propre projet, ou **157,5 + ~3–6 crédits** sur un projet géré par RAD.

La suppression ne permet d'économiser de l'argent que si GlitchTip resterait inutilisé assez longtemps pour compenser ce coût de redéploiement par rapport à son propre coût d'exécution : environ **4 jours ou plus** d'inactivité dans votre propre projet (par rapport à sa facture Google Cloud d'environ 149,81 $ US/mois), ou **environ 2 jours ou plus** d'inactivité dans un projet géré par RAD (par rapport à ses ~111 crédits/jour).

La majeure partie du coût d'exécution de GlitchTip est la base de données et la VM de fichier/cache partagée. Elles ne s'arrêtent que si rien d'autre dans le projet ne les utilise, donc la suppression de cette application alors que quelque chose d'autre partage le projet n'économise que la part de calcul de cette application sur le total ci-dessus.

Priorité aux données : les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec celui-ci, alors copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour une classe. Chaque participant obtient l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite fixée par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits non utilisés sont restitués au formateur.
- **Environnements gérés, pour les cabinets de conseil :** un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; radmodules.dev/pricing pour les propres frais de RAD et les estimations de crédits quotidiens ; [documentation de Google sur la suppression/restauration de projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les mécanismes de pause/restauration ; [tarification de GlitchTip hébergé](https://glitchtip.com/pricing) pour les chiffres de GlitchTip hébergé.

## 1. Vue d'ensemble {#1-overview}

GlitchTip s'exécute comme une charge de travail web Python servie par **Granian** sur le
port 8080. Le rôle de serveur `all_in_one` exécute le serveur web, le worker Celery et
Celery beat à l'intérieur du conteneur de pod unique. Le déploiement relie un ensemble
ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods Django/Granian, 2 vCPU / 4 GiB par défaut ; minimum 1 réplica maintient le worker/beat en vie |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — GlitchTip ne prend pas en charge MySQL ou d'autres moteurs |
| File d'attente de tâches et cache | Cloud SQL (PostgreSQL) | `VALKEY_URL = ""` achemine la file d'attente Celery, le cache et les sessions via Postgres ; Redis est facultatif |
| Stockage d'objets / de fichiers | Cloud Storage + NFS | Un bucket de données `storage` ; NFS monté à `/opt/glitchtip/storage` pour les pièces jointes téléchargées |
| Secrets | Secret Manager | `SECRET_KEY` Django auto-généré et le mot de passe initial du superutilisateur ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé facultatif + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la couche
  d'application partagée ; la sélection de tout autre moteur interrompt le démarrage.
- **L'image est une build personnalisée légère.** GlitchTip est construit `FROM glitchtip/glitchtip:6.2.0`
  avec un point d'entrée cloud qui compose `DATABASE_URL` à partir des variables `DB_*`
  injectées et désactive Valkey/Redis avant de passer la main à `./bin/start.sh`. Sur GKE,
  le point d'entrée voit `DB_HOST = 127.0.0.1` (le sidecar Cloud SQL Auth Proxy) et se connecte
  via TCP en boucle locale.
- **Pas de Redis par défaut.** `VALKEY_URL = ""` signifie que la file d'attente Celery, le
  cache et les sessions utilisent tous PostgreSQL. N'activez Redis que lorsque vous
  séparez le parc de workers à des volumes plus élevés.
- **Un minimum de 1 réplica est maintenu.** GKE ne prend pas en charge la mise à l'échelle
  à zéro, et le worker/beat Celery intégré doit continuer à fonctionner pour l'ingestion
  d'événements et la purge quotidienne de rétention.
- **L'affinité de session est `ClientIP` par défaut.** Maintient une session de
  navigateur épinglée à un pod pour le tableau de bord.
- **NFS est activé par défaut** (`enable_nfs = true`) à `/opt/glitchtip/storage` pour les pièces
  jointes téléchargées, de sorte que la charge de travail est déployée avec la stratégie
  `Recreate` pour éviter que deux pods ne se disputent le volume partagé lors d'une
  mise à jour.
- **`SECRET_KEY` et le mot de passe du superutilisateur sont générés
  automatiquement** et stockés dans Secret Manager, matérialisés dans l'espace de noms
  via le pilote CSI du Secret Store.
- **Le propriétaire initial est amorcé, non auto-enregistré.** `glitchtip-migrate` crée
  `admin@techequity.cloud` ; `ENABLE_OPEN_USER_REGISTRATION` par défaut à `false`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les
autres identifiants sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail GlitchTip {#a-gke-autopilot--the-glitchtip-workload}

Les pods GlitchTip sont planifiés sur Autopilot, qui facture le CPU/la mémoire que les
pods demandent réellement. L'autoscaling horizontal des pods dimensionne le déploiement
entre le nombre minimum et maximum de réplicas ; un PodDisruptionBudget protège la
disponibilité pendant les mises à niveau des nœuds.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail
  GlitchTip pour voir les pods, les révisions et les événements. Kubernetes Engine →
  Services et Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa,pdb -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de l'autoscaling et du type de
charge de travail.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

GlitchTip stocke toutes les données d'application (projets, problèmes, événements,
utilisateurs et file d'attente Celery) dans une instance gérée de Cloud SQL pour
PostgreSQL 15. Les pods l'atteignent en privé via le sidecar **Cloud SQL Auth Proxy**
en boucle locale (`127.0.0.1`) ; aucune IP publique n'est exposée. Lors du premier
déploiement, les jobs `db-init` et `glitchtip-migrate` créent la base de données et
l'utilisateur, exécutent les migrations et créent le superutilisateur.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les
  flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe sont
affichés dans les [Sorties](#5-outputs). Voir [App_GKE](App_GKE.md) pour le modèle de
connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage et NFS {#c-cloud-storage--nfs}

Un bucket de données **Cloud Storage** dédié (suffixe `storage`) est
provisionné automatiquement, et le compte de service de la charge de travail se voit
accorder l'accès. Les pièces jointes téléchargées de GlitchTip sont stockées sur **NFS**
monté à `/opt/glitchtip/storage` (`enable_nfs = true`). Le tag réseau `nfsserver` (défini par
défaut) est requis pour l'accès des pods à la VM du serveur NFS.

- **Console :** Cloud Storage → Buckets ; Compute Engine pour la VM du serveur NFS.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  kubectl describe pod -n "$NAMESPACE" <pod> | grep -A3 nfs
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### D. Redis / Valkey (facultatif) {#d-redis--valkey-optional}

Redis est **désactivé par défaut** (`VALKEY_URL = ""` → file d'attente et cache basés sur
PostgreSQL). La définition de `enable_redis = true` pointe le broker Celery et le cache de
GlitchTip vers Redis/Valkey ; laisser `redis_host` vide avec `enable_nfs = true` utilise
l'adresse IP de la VM du serveur NFS.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -i valkey
  ```

### E. Secret Manager {#e-secret-manager}

Deux secrets sont générés automatiquement : le `SECRET_KEY` Django et le mot de passe
initial du superutilisateur (consommé par le job de migration). Le mot de passe de la
base de données est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation du Secret Store CSI.

### F. Réseau et ingress {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe de Cloud Load
Balancing (`service_type = LoadBalancer`). Un domaine personnalisé avec un certificat géré par Google
peut être activé (`enable_custom_domain = true`), et une adresse IP statique est réservée par défaut
afin que l'adresse survive aux redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails de
l'adresse IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les flux stdout/stderr des pods vers Cloud Logging ; les métriques GKE et Cloud SQL
vers Cloud Monitoring. Des vérifications de disponibilité et des politiques d'alerte
facultatives sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord /
  Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application GlitchTip {#3-glitchtip-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job `db-init`
  (`postgres:15-alpine`) se connecte via le Cloud SQL Auth Proxy et crée de manière
  idempotente la base de données et l'utilisateur de l'application, accorde les
  privilèges et réattribue le schéma `public`. Il peut être réexécuté en toute
  sécurité et signale le sidecar proxy (`/quitquitquit`) afin que le pod du job se
  termine.
- **Migrations + amorçage du superutilisateur.** Le job `glitchtip-migrate` s'exécute sur
  l'image GlitchTip construite (`depends_on = ["db-init"]`). Il compose `DATABASE_URL`, exécute
  `./manage.py migrate --noinput`, puis `createsuperuser --noinput` en utilisant `SUPERUSER_EMAIL`
  (`admin@techequity.cloud`) et le mot de passe du superutilisateur de Secret Manager. Le mot de
  passe initial de l'administrateur se trouve dans Secret Manager (`secret-<prefix>-<app>-superuser-password`).
- **Rôle de serveur `all_in_one`.** `SERVER_ROLE = all_in_one` exécute le serveur web, le worker
  Celery et le beat dans un seul pod. GKE maintient au moins 1 réplica afin que
  l'ingestion en arrière-plan et la purge quotidienne de rétention des événements
  continuent de fonctionner.
- **Les mises à jour basées sur NFS utilisent `Recreate`.** Avec NFS activé, App_GKE
  définit la stratégie de déploiement sur `Recreate` afin qu'une mise à jour ne
  fasse jamais fonctionner deux pods simultanément sur le volume de pièces jointes
  partagé.
- **`SECRET_KEY` ne doit pas être modifié à la légère** — il signe les sessions/cookies ;
  le modifier déconnecte tout le monde.
- **L'ingestion d'événements nécessite l'adresse IP externe.** Les SDK
  d'application POSTent les événements au point d'ingestion sur l'URL du
  LoadBalancer/domaine personnalisé. Définissez un domaine personnalisé et un certificat
  géré pour un hôte d'ingestion stable.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/` par
  défaut. Prévoyez plusieurs minutes au premier démarrage pendant l'exécution des
  migrations.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres spécifiques ou notables pour GlitchTip sont listés ;
toute autre entrée est héritée de [App_GKE](App_GKE.md) avec son comportement standard
et ses valeurs par défaut.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement (utilisez `gke` pour exécuter en parallèle la variante Cloud Run). |
| `support_users` | `[]` | Adresses e-mail autorisées à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `glitchtip` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `GlitchTip Error Tracking` | Nom lisible par l'homme affiché dans la console. |
| `application_description` | `GlitchTip Open-source Error Tracking on GKE Autopilot` | Brève description de l'application. |
| `application_version` | `6.2.0` | Tag d'image GlitchTip ; pilote la build `FROM glitchtip/glitchtip:<tag>`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | GlitchTip est une build personnalisée légère ; conservez `custom`. |
| `min_instance_count` | `1` | Réplicas minimum ; conservez ≥ 1 pour maintenir le worker/beat en vie. |
| `max_instance_count` | `5` | Réplicas maximum (limite supérieure HPA). |
| `container_port` | `8080` | GlitchTip/Granian écoute sur le port 8080. |
| `container_resources` | 2 vCPU / 4 GiB | Requêtes et limites CPU/mémoire. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy (requis sur GKE). |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image de base dans Artifact Registry. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires. Ne pas définir `SECRET_KEY`, `DATABASE_URL` ou `VALKEY_URL` ici. |
| `secret_environment_variables` | `{}` | Mappage de var d'environnement → nom de secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes d'attente après la création du secret. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service Kubernetes est exposé. |
| `workload_type` | `null` | `Deployment` (par défaut) ou `StatefulSet`. |
| `session_affinity` | `ClientIP` | Routage persistant pour les sessions du tableau de bord. |
| `network_tags` | `["nfsserver"]` | Requis lorsque `enable_nfs = true`. |
| `termination_grace_period_seconds` | `60` | Secondes après SIGTERM avant SIGKILL. |
| `enable_network_segmentation` | `false` | Créer des ressources Kubernetes NetworkPolicy. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Activer les PVC par pod. Non nécessaire — l'état de GlitchTip réside dans PostgreSQL/NFS. |
| `stateful_pvc_size` / `stateful_pvc_mount_path` / `stateful_pvc_storage_class` | `10Gi` / `/data` / `standard-rwo` | Paramètres du modèle PVC. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Créer un ResourceQuota d'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doit utiliser des unités binaires** (`"4Gi"`) — les entiers bruts sont des octets et bloquent la planification. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protéger la disponibilité pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Nombre minimum de pods disponibles pendant les perturbations volontaires. |
| `enable_topology_spread` / `topology_spread_strict` | `false` | Répartir les pods sur les zones/nœuds. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/` 60s de délai, 30 × 15s de fenêtre d'échec | Sonde de démarrage. Prévoir plusieurs minutes au premier démarrage. |
| `liveness_probe` | HTTP `/` 60s de délai | Sonde de vivacité. |
| `startup_probe_config` / `health_check_config` | HTTP `/`, mêmes délais | Sondes d'infrastructure au niveau App_GKE. |
| `uptime_check_config` | désactivé (`enabled=false`, chemin `/`) | Vérification de disponibilité Cloud Monitoring. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser les jobs intégrés `db-init` + `glitchtip-migrate`. |
| `cron_jobs` | `[]` | CronJobs Kubernetes planifiés. |
| `additional_services` | `[]` | Services sidecar ou auxiliaires. |

### Groupe 12 — CI/CD et autorisation binaire {#group-12--cicd--binary-authorization}

Intégration standard App_GKE Cloud Build / Cloud Deploy — voir [App_GKE](App_GKE.md).
Entrées clés : `enable_cicd_trigger`, `github_repository_url`, `github_token`,
`enable_cloud_deploy`, `enable_binary_authorization`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Stockage des pièces jointes NFS. |
| `nfs_mount_path` | `/opt/glitchtip/storage` | Chemin de montage à l'intérieur du conteneur. |
| `nfs_volume_name` | `nfs-data-volume` | Nom du volume Kubernetes. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer des buckets GCS supplémentaires au-delà du bucket de données provisionné automatiquement. |
| `storage_buckets` | (bucket de données) | Un bucket de données `storage` est déclaré par `GlitchTip_Common`. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse via le pilote CSI. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Politique de nettoyage d'Artifact Registry. |

### Groupe 15 — Cache et file d'attente Redis {#group-15--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Utiliser Redis/Valkey pour la file d'attente et le cache au lieu de PostgreSQL. |
| `redis_host` | `""` | Point de terminaison Redis. Laisser vide pour utiliser l'IP du serveur NFS (nécessite `enable_nfs = true`). |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — GlitchTip nécessite PostgreSQL 15. |
| `application_database_name` | `glitchtip` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `application_database_user` | `glitchtip` | Utilisateur de la base de données de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter à 30–90 pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécuter du SQL à partir d'un bucket GCS après le provisionnement.

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner Ingress pour les noms d'hôte personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |

### Groupe 20 — Proxy conscient de l'identité (IAP) {#group-20--identity-aware-proxy-iap}

> **Attention :** L'activation d'IAP nécessite une authentification d'identité Google pour
> **toutes** les requêtes entrantes, y compris l'ingestion d'événements SDK. N'activez
> IAP que pour un déploiement de tableau de bord uniquement où les SDK utilisent un chemin
> d'ingestion séparé.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger une connexion Google devant GlitchTip. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque IAP est activé (sensible). |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attacher une politique Cloud Armor (WAF) au backend Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à un accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la politique. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend Ingress GKE. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode dry-run. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus
rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Mappage des ClusterIPs pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre GlitchTip. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom de la base de données de l'application / utilisateur. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration (`db-init`, `glitchtip-migrate`) et d'importation (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé)
> — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration au moteur de fondation [App_GKE](App_GKE.md), qui valide les valeurs
> *et les combinaisons* au moment de la planification — un réplica en lecture sans son
> primaire, IAP sans identités autorisées, un runtime `gen1` avec des montages
> NFS/GCS, un `database_type` qui ne correspond pas à une extension activée, un
> `redis_port`/`backup_retention_days` hors de portée. Une configuration invalide fait échouer
> le **plan** avec une erreur claire et nommée avant qu'aucune ressource ne soit créée,
> de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'au
> moment de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit tous les événements et projets stockés. |
| `SECRET_KEY` (auto-généré) | Ne jamais faire pivoter à la légère | Élevé | Le faire pivoter invalide toutes les sessions, déconnectant tous les utilisateurs. |
| `min_instance_count` | `1` | Élevé | GKE nécessite min ≥ 1 ; maintenir 1 maintient le worker/beat intégré en vie afin que l'ingestion et la purge de rétention s'exécutent. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy est requis pour la connectivité PostgreSQL ; sa désactivation est bloquée par une protection de validation au moment de la planification. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont des octets et bloquent toute planification de pod dans l'espace de noms. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans un `backup_uri` valide fait échouer le job d'importation. |
| `enable_iap` | déploiements de tableau de bord uniquement | Élevé | IAP bloque toutes les requêtes non authentifiées, y compris l'ingestion d'événements SDK. |
| `ENABLE_OPEN_USER_REGISTRATION` (fixé `false`) | n/a | Élevé | Non exposé comme variable sur cette variante — `GlitchTip_Common` le définit toujours `false`, donc l'inscription reste uniquement sur invitation d'administrateur. |
| `network_tags` inclut `nfsserver` | conserver la valeur par défaut | Élevé | Le supprimer pendant que `enable_nfs = true` bloque l'accès des pods à la VM du serveur NFS → pods bloqués lors du montage. |
| `session_affinity` | `ClientIP` | Moyen | Sans persistance, les sessions du tableau de bord rebondissent entre les pods. |
| `container_resources` mémoire | `4Gi` | Moyen | En dessous de ~1 GiB, les processus Django + worker + beat risquent un OOM lors de pics d'événements. |
| `enable_pod_disruption_budget` | `true` | Moyen | La désactivation permet à GKE d'expulser tous les pods simultanément pendant la maintenance. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**. La
configuration d'application spécifique à GlitchTip partagée avec la variante Cloud Run
est décrite dans **[GlitchTip_Common](GlitchTip_Common.md)**.

<!-- related-guides -->

## Guides associées {#related-guides}

- [Lab pratique : GlitchTip sur GKE Autopilot](../labs/GlitchTip_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [GlitchTip sur Google Cloud Run](GlitchTip_CloudRun.md) — la même application sur Cloud Run, pour quand vous avez besoin de l'autre cible de déploiement.
- [GlitchTip Common — Configuration d'application partagée](GlitchTip_Common.md) — la configuration partagée par les deux cibles de déploiement.
