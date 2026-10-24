---
title: "Rallly sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Rallly sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Rallly_GKE.md @ e69407af sha256:e3f73080fdab -->

# Rallly sur GKE Autopilot {#rallly-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Rallly_GKE.png" alt="Rallly sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Rallly est une application open-source, auto-hébergée, de planification de réunions et de sondages de groupe — une alternative respectueuse de la vie privée à Doodle — construite avec Next.js et Prisma. Ce module déploie Rallly sur **GKE Autopilot** au-dessus de la fondation [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Rallly et sur la manière de les explorer et de les opérer depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à chaque application GKE — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## Ce que coûte Rallly sur RAD, et comment cela se compare {#what-rallly-costs-on-rad-and-how-that-compares}

**L'exécution de Rallly dans votre propre projet GCP coûte environ 129,18 $/mois en frais Google Cloud ; les frais de module de RAD sont de 75 crédits uniques (ou 67,5 crédits dans un projet géré par RAD), couvrant la configuration et le support — pas la facture cloud continue, que Google vous facture directement dans votre propre projet ou que RAD mesure à l'heure en crédits dans un projet géré par RAD.**
Si un coût d'exécution inférieur est plus important que la cible de déploiement, consultez le guide Cloud Run pour l'option à moindre coût ; sinon, si vous déployez dans un projet géré par RAD, vous pouvez tout mettre en pause gratuitement lorsque vous ne l'utilisez pas — voir [Mettre en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module | 75 crédits, une fois | 67,5 crédits, une fois (10 % de moins) |
| Temps de build | mesuré en crédits pendant l'exécution du build (quelques crédits, généralement) | idem |
| Coût d'exécution Google Cloud | ~129,18 $/mois, facturé à votre propre compte de facturation au prix catalogue de Google | ~101 crédits/jour, mesuré à l'heure par RAD au prix catalogue plus marge |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Pod GKE Autopilot, 2x vCPU / 2 Gio | 72,16 $ |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Gio, zonal, 10 Gio SSD | 51,02 $ |
| Cloud NAT et réseau | 5,00 $ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 $ |
| **Total** | **129,18 $** |

### Comment cela se compare {#how-it-compares}

- Le plan Pro hébergé de Rallly coûte **6 $/utilisateur/mois, facturé annuellement** (source : https://rallly.co/pricing) — un prix SaaS par utilisateur plutôt que des frais d'hébergement fixes, donc il ne se compare directement qu'une fois que vous connaissez votre propre nombre d'utilisateurs.
- L'exécuter vous-même sur un VPS nu reste l'option la moins chère en espèces — Hetzner CPX22 (2 vCPU/4 Go) coûte environ **24 $/mois**, un Droplet DigitalOcean 2 vCPU/4 Go coûte également **24 $/mois**, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) coûte environ **49 $/mois** — plus le temps de l'administrateur pour les sauvegardes, les correctifs de sécurité et les mises à niveau, que le Cloud SQL géré par RAD, Secret Manager et la surveillance couvrent pour vous — mais le prix de RAD n'est jamais destiné à battre un VPS, seulement à remplacer le temps d'administration qu'un VPS nécessite encore.
- Un outil de planification et de sondage de groupe est utilisé par intermittence autour de la planification d'une réunion, pas en continu, donc ce coût d'exécution est ce qui génère la facture bien plus que les frais de module.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

**C'est le titre pour un projet géré par RAD.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le projet purement et simplement — la suppression logique récupérable de 30 jours de Google. Contrairement à la suppression d'un module, cela ne démantèle pas Cloud SQL, aucune VM ou la ressource de calcul une par une : l'ensemble du projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de restaurer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter une mise à jour sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits (moins de 1 $ US) au total pour une chaîne de déploiement typique de 2-3.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD gère uniquement la facturation), vous devez le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est admise comme la création d'un nouveau projet, donc votre solde de crédits achetés doit toujours dépasser le seuil du palier (100 crédits pour le palier sandbox que la plupart des utilisations d'étude/démo conviennent). Google indique que la plupart des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.

**Un véritable manque :** les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a la suppression logique de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé l'application et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive, ou un bucket en dehors du projet) avant de la supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payer uniquement pendant que vous l'utilisez, l'autre façon : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet (ou une fois que vous avez dépassé la fenêtre de restauration de 30 jours ci-dessus), l'alternative est de supprimer Rallly purement et simplement et de le redéployer plus tard. Un redéploiement coûte à nouveau les frais de module, plus les builds — environ 75 + 3-6 crédits de temps de build.

La suppression ne permet d'économiser de l'argent que si Rallly resterait inutilisé assez longtemps pour compenser ce coût de redéploiement par rapport à son propre coût d'exécution quotidien — par rapport au total du projet ci-dessus, cela représente environ 2 jours ou plus. La majeure partie du coût d'exécution ici est généralement la base de données ; elle ne s'arrête que lorsque rien d'autre dans le projet ne l'utilise, donc la suppression de cette application pendant que quelque chose d'autre partage le projet n'économise que la partie calcul de cette application.

**Conserver les données en premier :** les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui, donc copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour une classe. Chaque participant obtient l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil :** un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; radmodules.dev/pricing pour les propres frais de RAD et les estimations de crédits quotidiens ; https://cloud.google.com/resource-manager/docs/delete-restore-projects pour les mécanismes de pause/restauration ; https://rallly.co/pricing pour le prix du concurrent nommé.

## 1. Vue d'ensemble {#1-overview}

Rallly s'exécute comme une seule charge de travail web Next.js. Le déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods Next.js, 1 vCPU / 2 Gio par défaut, autoscalés horizontalement |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — Rallly ne prend pas en charge MySQL ou d'autres moteurs |
| E-mail | Relais SMTP (externe) | Connexion par e-mail sans mot de passe ; fournissez votre propre hôte/informations d'identification SMTP |
| Secrets | Secret Manager | `SECRET_PASSWORD` et `NEXTAUTH_SECRET` auto-générés ; `SMTP_PWD` facultatif ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing | Service External LoadBalancer, domaine personnalisé facultatif + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la couche d'application partagée ; la sélection de tout autre moteur interrompt le démarrage. Tout l'état de Rallly (sondages, votes, commentaires, utilisateurs) réside dans cette base de données.
- **`SECRET_PASSWORD` et `NEXTAUTH_SECRET` sont générés automatiquement** et stockés dans Secret Manager. Ces clés ne doivent pas être renouvelées après le premier démarrage sans fenêtre de maintenance — le renouvellement de `SECRET_PASSWORD` invalide les données précédemment chiffrées, et le renouvellement de `NEXTAUTH_SECRET` invalide toutes les sessions actives et les liens de connexion en cours.
- **La connexion Rallly est sans mot de passe et basée sur l'e-mail.** Les utilisateurs s'inscrivent et se connectent en recevant un lien/code de vérification, de sorte qu'une configuration SMTP fonctionnelle est effectivement requise avant que quiconque puisse se connecter. Sur cette variante, `smtp_host` est vide par défaut ; définissez `smtp_host`, `smtp_user` et `smtp_password` pour activer l'e-mail.
- **L'URL de base publique doit être définie pour l'accès externe.** `NEXT_PUBLIC_BASE_URL` / `NEXTAUTH_URL` proviennent de `base_url`. Définissez-la sur l'URL du LoadBalancer externe ou du domaine personnalisé une fois connue, afin que les liens d'invitation et de connexion se résolvent à l'adresse visitée par les utilisateurs.
- **Charge de travail `Deployment`, sans état sur disque.** `workload_type = Deployment` sans PVC — Rallly conserve tout l'état dans PostgreSQL, de sorte que les pods sont librement remplaçables.
- **NFS et Redis sont désactivés.** Rallly n'a pas besoin de système de fichiers partagé ni de cache ; les deux sont désactivés par défaut (Redis est désactivé en dur).
- **Les migrations s'exécutent au démarrage.** Le propre `./docker-start.sh` du conteneur exécute `prisma migrate deploy` à chaque démarrage, de sorte que les mises à niveau de version appliquent les modifications de schéma sans étape de migration séparée. Le job `db-init` ne provisionne que la base de données et le rôle vides.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Rallly {#a-gke-autopilot--the-rallly-workload}

Les pods Rallly sont planifiés sur Autopilot, qui facture le CPU/la mémoire que les pods demandent réellement. L'autoscaling horizontal des pods dimensionne le déploiement entre les nombres de réplicas minimum et maximum.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail Rallly pour voir les pods, les révisions et les événements. Kubernetes Engine → Services et Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour savoir comment Autopilot, la mise à l'échelle et le type de charge de travail (Deployment vs StatefulSet) sont gérés.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Rallly stocke toutes les données d'application (sondages, options, participants, votes, commentaires et comptes d'utilisateurs) dans une instance Cloud SQL gérée pour PostgreSQL 15. Les pods y accèdent en privé via le sidecar **Cloud SQL Auth Proxy** via le bouclage (`enable_cloudsql_volume = true`) ; aucune IP publique n'est exposée. Lors du premier déploiement, le job `db-init` crée la base de données et le rôle de l'application ; Rallly applique ensuite son propre schéma Prisma au démarrage.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données (`rallly`), l'utilisateur (`rallly`) et le secret Secret Manager contenant le mot de passe sont tous affichés dans les [Sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes automatisées et la rotation des mots de passe, voir [App_GKE](App_GKE.md).

### C. E-mail (SMTP) {#c-email-smtp}

Rallly envoie des e-mails de connexion/vérification et d'invitation via un relais SMTP externe. Lorsque `smtp_host` est défini, le pod reçoit `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_SECURE` et le secret `SMTP_PWD`. Il n'y a pas de service de messagerie Google géré — fournissez le vôtre (SendGrid, Mailgun, Gmail SMTP, etc.).

- **CLI (vérifier les paramètres injectés dans le pod en cours d'exécution) :**
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E 'SMTP_|NEXT_PUBLIC_BASE_URL'
  ```

### D. Secret Manager {#d-secret-manager}

Deux secrets cryptographiques sont générés automatiquement et stockés dans Secret Manager : `SECRET_PASSWORD` (secret de chiffrement de données / de session de Rallly) et `NEXTAUTH_SECRET` (signe les jetons de session NextAuth et les liens de connexion par e-mail). Un troisième, `SMTP_PWD`, n'est créé que lorsque le SMTP est configuré. Le mot de passe de la base de données est géré séparément par la fondation. Les secrets sont projetés dans le pod via le pilote CSI du Secret Store.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~rallly"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données se trouve dans les [Sorties](#5-outputs). Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation du Secret Store CSI.

### E. Réseau et ingress {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe de Cloud Load Balancing (`service_type = LoadBalancer`). Un domaine personnalisé avec un certificat géré par Google peut être activé, et une adresse IP statique réservée afin que l'adresse survive aux redéploiements. Définissez `base_url` sur l'URL externe afin que les liens d'invitation et de connexion de Rallly correspondent à l'adresse visitée par les utilisateurs.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés, Cloud CDN et les adresses IP statiques.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les flux stdout/stderr des pods vers Cloud Logging ; les métriques GKE et Cloud SQL vers Cloud Monitoring. Des vérifications de disponibilité et des politiques d'alerte facultatives sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Rallly {#3-rallly-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job d'initialisation exécute `db-init.sh` en utilisant `postgres:15-alpine`. Il se connecte via le Cloud SQL Auth Proxy et crée de manière idempotente la base de données et le rôle de l'application, accorde les privilèges, puis signale au proxy de s'arrêter. Il est configuré avec `max_retries = 3` et peut être réexécuté en toute sécurité.
- **Migrations de schéma au démarrage.** Le propre `./docker-start.sh` de Rallly exécute `prisma migrate deploy` à chaque démarrage, de sorte que le schéma est créé au premier démarrage après `db-init` et la mise à niveau de la version de l'application applique les modifications de schéma sans étape de migration séparée.
- **`SECRET_PASSWORD` et `NEXTAUTH_SECRET` sont immuables après le premier démarrage.** Ils sont générés une fois et écrits dans Secret Manager. La modification de `SECRET_PASSWORD` invalide les données précédemment chiffrées ; la modification de `NEXTAUTH_SECRET` invalide toutes les sessions actives et les liens de connexion par e-mail en cours. Ne les faites pivoter que pendant une fenêtre de maintenance planifiée.
- **Connexion par e-mail sans mot de passe.** Rallly authentifie les utilisateurs via des liens/codes de vérification envoyés par e-mail. Sans un relais SMTP fonctionnel, les utilisateurs ne peuvent pas recevoir d'e-mails de connexion et ne peuvent pas se connecter. Confirmez les paramètres SMTP dans le pod en cours d'exécution après le déploiement.
- **L'URL de base publique nécessite l'adresse IP externe.** Définissez `base_url` (ou `environment_variables` `NEXT_PUBLIC_BASE_URL`) sur l'URL du LoadBalancer externe ou du domaine personnalisé une fois l'adresse IP attribuée, afin que les liens d'invitation et de connexion se résolvent correctement :
  ```bash
  kubectl get svc <service-name> -n "$NAMESPACE" \
    -o jsonpath='{.status.loadBalancer.ingress[0].ip}'
  ```
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/api/status` — le point de terminaison d'état public et non authentifié de Rallly. Laissez le temps au premier démarrage pour l'étape de migration Prisma (la sonde de démarrage par défaut fournit un délai initial de 30 secondes plus une fenêtre de 20 tentatives, avec un intervalle de 15 secondes).
- **Inspecter l'exécution du job :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour Rallly sont listés ; toutes les autres entrées sont héritées de [App_GKE](App_GKE.md) avec son comportement standard et ses valeurs par défaut.

### Groupe 2 — Identité de l'application {#group-2--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `rallly` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image Rallly (`lukevella/rallly`) ; épingler à une version spécifique en production. |

### Groupe 3 — Exécution et mise à l'échelle {#group-3--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `2000m` | CPU par pod ; les opérations d'API Rallly et la transformation d'actifs bénéficient d'au moins 1 vCPU. |
| `memory_limit` | `2Gi` | Mémoire par pod. |
| `min_instance_count` | `0` | Réplicas minimum. |
| `max_instance_count` | `3` | Réplicas maximum ; Rallly est sans état dans Postgres et peut évoluer horizontalement. |
| `container_port` | `3000` | Rallly écoute sur le port 3000. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy (bouclage) pour PostgreSQL. |
| `base_url` | `""` | URL publique pour `NEXT_PUBLIC_BASE_URL` / liens NextAuth. Définir sur l'URL du LoadBalancer externe ou du domaine personnalisé. |

### Groupe 5 — Accès, Ingress et e-mail {#group-5--access-ingress--email}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `smtp_host` | `""` | Nom d'hôte du relais SMTP. Une valeur non vide provisionne `SMTP_PWD` et injecte les variables d'environnement `SMTP_*`. Requis pour la connexion par e-mail. |
| `smtp_port` | `587` | Port SMTP (587 STARTTLS, 465 SSL). |
| `smtp_user` | `""` | Nom d'utilisateur SMTP — définissez-le (avec `smtp_password`) pour activer la connexion par e-mail. |
| `smtp_password` | `""` (sensible) | Mot de passe SMTP. Vide → un secret auto-généré est stocké. |
| `smtp_secure_enabled` | `false` | Activer TLS/SSL implicite (true pour le port 465). |
| `mail_from` | `""` | Adresse de l'expéditeur pour `NOREPLY_EMAIL` / `SUPPORT_EMAIL`. Vide → `noreply@rallly.local`. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service Kubernetes est exposé. |
| `workload_type` | `Deployment` | Déploiement (sans état) — Rallly stocke tout l'état dans PostgreSQL. |

### Groupe 11 — Backend de base de données {#group-11--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `db_name` | `rallly` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `rallly` | Utilisateur de la base de données de l'application. Mot de passe auto-généré dans Secret Manager. |
| `database_type` | `POSTGRES_15` | Fixe — Rallly nécessite PostgreSQL 15. |

### Groupe 13 — Système de fichiers et observabilité {#group-13--filesystem--observability}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS est désactivé — Rallly n'a pas besoin de système de fichiers partagé. |
| `startup_probe` | HTTP `/api/status`, délai initial de 0s, 10 échecs | Sonde de démarrage ; prévoir la migration Prisma au premier démarrage. |
| `liveness_probe` | HTTP `/api/status` 60s de délai | Sonde de vivacité. |

### Groupe 20 — Cache Redis {#group-20--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Rallly n'utilise pas Redis ; laisser désactivé. |

Toutes les autres entrées suivent le comportement standard de [App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Carte des ClusterIPs pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Rallly. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via le Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (aucun par défaut pour Rallly). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration (`db-init`) et d'importation (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur de fondation [App_GKE](App_GKE.md), qui valide les valeurs *et les combinaisons* au moment de la planification — `min_instance_count > max_instance_count`, IAP sans ID/secret client OAuth, `enable_redis` sans `redis_host` ou NFS, `enable_cloudsql_volume = true` avec `database_type = NONE`. Une configuration invalide échoue la **planification** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `SECRET_PASSWORD` (auto-généré) | Ne jamais faire pivoter après le premier démarrage | Critique | Le faire pivoter invalide les données précédemment chiffrées et les sessions actives. |
| `NEXTAUTH_SECRET` (auto-généré) | Ne faire pivoter que pendant une fenêtre de maintenance | Critique | Le faire pivoter invalide toutes les sessions actives et les liens de connexion par e-mail en cours. |
| `db_name` / `db_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/le rôle et détruit toutes les données. |
| `database_type` | `POSTGRES_15` | Critique | Rallly ne prend en charge que PostgreSQL 15 ; tout autre moteur interrompt le démarrage. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activation sans `backup_uri` valide échoue le job d'importation. |
| `smtp_host` / `smtp_user` / `smtp_password` | Définir pour activer l'e-mail | Élevé | Sans un relais SMTP fonctionnel, les e-mails de connexion ne sont jamais envoyés et les utilisateurs ne peuvent pas se connecter. |
| `base_url` | URL du LoadBalancer externe / du domaine personnalisé | Élevé | Si laissé vide, les liens d'invitation et de connexion ne se résolvent pas à l'adresse visitée par les utilisateurs. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy est requis pour la connectivité PostgreSQL ; une protection au moment de la planification le bloque avec `database_type = NONE`. |
| `min_instance_count` / `max_instance_count` | `min ≤ max` | Élevé | Une plage inversée crée une configuration HPA conflictuelle ; la protection de validation la rejette. |
| `enable_redis` | `false` | Moyen | Rallly n'utilise pas Redis ; son activation sans `redis_host` ou NFS est rejetée par la protection de validation. |
| Temporisation `startup_probe` | Conserver la valeur par défaut généreuse | Moyen | Une fenêtre trop courte peut faire échouer la sonde pendant la migration Prisma au premier démarrage. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Rallly partagée avec la variante Cloud Run est décrite dans **[Rallly_Common](Rallly_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Rallly sur GKE Autopilot](../labs/Rallly_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Rallly sur Google Cloud Run](Rallly_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Rallly Common — Configuration d'application partagée](Rallly_Common.md) — la configuration partagée par les deux cibles de déploiement.
