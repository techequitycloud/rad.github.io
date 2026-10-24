---
title: "Cal.com sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Cal.com sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/CalCom_CloudRun.md @ e69407af sha256:b576c6254760 -->

# Cal.com sur Google Cloud Run {#calcom-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/CalCom_CloudRun.png" alt="Cal.com sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Cal.com est une plateforme de planification open source sous licence AGPL —
l'alternative auto-hébergée à Calendly — construite avec **Next.js** et **Prisma**
sur PostgreSQL. Ce module déploie Cal.com sur **Cloud Run v2** au-dessus de la
fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère
l'infrastructure partagée de Google Cloud.

Ce guide se concentre sur les services cloud utilisés par Cal.com et sur la façon de
les explorer et de les opérer depuis la Google Cloud Console et la ligne de commande.
Pour les mécanismes communs à toutes les applications Cloud Run — identité de service,
entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — reportez-vous au [guide de la fondation App_CloudRun](App_CloudRun.md)
plutôt que de les répéter ici.

---

## Ce que coûte Cal.com sur RAD, et comment cela se compare {#what-calcom-costs-on-rad-and-how-that-compares}

**Cal.com sur le module Cloud Run de RAD coûte environ 84 US$ par mois dans votre propre projet Google Cloud, sans frais de licence supplémentaires** — Cal.com est open source. Dans un projet géré par RAD pour vous, le même déploiement est facturé à **32 crédits par jour** (environ 960 par mois, soit environ 96 US$ au prix de la recharge). Ou consultez le [guide GKE](CalCom_GKE.md) pour une capacité toujours active sur les pods. Si vous n'avez besoin de Cal.com qu'occasionnellement — pour des études, une démo, un projet de courte durée — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour quelques crédits, de sorte que ce chiffre mensuel devient quelques dollars à la place. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

Cal.com est open source, il n'y a donc pas de frais de licence. Vous payez pour trois choses :

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 75 crédits (7,50 US$ au prix de la recharge) | 67,5 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build (environ 3 à 6 crédits) | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **84 US$ par mois** pour la configuration par défaut (tableau ci-dessous) | Facturé à l'heure en crédits ; RAD publie **32 crédits par jour**, environ 960 par mois (environ 96 US$ au prix de la recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde acheté minimum est conservé en réserve |

10 crédits coûtent 1 US$ pour une recharge unique, et moins sur un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Cloud Run, 1x vCPU / 2 Gio (scaleToZero) | 13,16 US$ |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 US$ |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 US$ |
| Cloud NAT et réseau | 5 US$ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 US$ |
| **Total** | **environ 84 US$** |

Les prix de Cloud SQL et des pods Cloud Run/GKE sont les mêmes en africa-south1 (Johannesburg) ; la petite VM coûte environ 10 % de plus là-bas.

- **La mise à l'échelle à zéro est la valeur par défaut sur Cloud Run.** Le chiffre ci-dessus suppose une utilisation quotidienne modeste ; définissez `min_instance_count ≥ 1` pour le maintenir toujours actif (et éviter les démarrages à froid), ce qui augmente la ligne Cloud Run mais pas le reste du tableau.

### Comment cela se compare, pour une équipe de dix {#how-it-compares-for-a-team-of-ten}

Cal.com, le projet que ce module déploie, vend ses propres plans hébergés par utilisateur :

| Option | Par mois (10 utilisateurs) | Notes |
|---|---|---|
| Cal.com Teams | 120 US$ (12 US$/utilisateur) | Hébergé par Cal.com |
| Cal.com Organizations | 280 US$ (28 US$/utilisateur) | Hébergé par Cal.com, ajoute l'administration à l'échelle de l'organisation |
| **RAD, Cloud Run, votre propre projet** | **Environ 84 US$**, plus 7,50 US$ une fois par déploiement | L'automatisation de RAD, dans votre projet |
| **RAD, Cloud Run, un projet géré par RAD** | **Environ 960 crédits (96 US$)** | RAD |

- **Le prix hébergé de Cal.com augmente avec chaque siège ; le coût de RAD est l'infrastructure**, qu'une équipe en croissance n'atteint le seuil que lorsqu'elle a besoin de plus de capacité. À dix utilisateurs, le coût d'exécution de RAD dans son propre projet est déjà inférieur à un seul mois du plan Teams.
- **Un serveur bon marché est bon marché jusqu'à ce que quelque chose tombe en panne.** Sur RAD, la base de données est Cloud SQL avec des sauvegardes automatisées, et les secrets vivent dans Secret Manager. Sur votre propre serveur, c'est un travail que quelqu'un doit faire.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Cal.com s'exécute dans **un projet géré par RAD pour vous**, la suppression de l'ensemble du projet — plutôt que la suppression de ce seul module — délie d'abord sa facturation, puis demande à Google de supprimer complètement le projet. Google le conserve, récupérable, pendant 30 jours, et comme la facturation est déjà déliée, rien n'est facturé pendant qu'il attend. Contrairement à la suppression d'un module, cela ne détruit pas Cloud SQL, aucune VM ou la ressource de calcul une par une : l'ensemble du projet s'arrête simplement.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **La restauration est une vérification, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet peut demander à Google de restaurer le projet et de rattacher son compte de facturation, puis d'exécuter **Update** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes, et une mise à jour ne facture jamais les frais de module à nouveau. Pour une chaîne de déploiement typique de 2 à 3, cela ne coûte qu'une poignée de crédits au total (environ 5 à 10 crédits, moins de 1 US$).
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet dont RAD ne gère que la facturation), le restaurer vous-même dans les 30 jours — après quoi Google le supprime définitivement — et effacer à nouveau le seuil d'admission du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude/démo conviennent). Google indique que la plupart des services fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.
- **Un véritable manque : les sauvegardes nocturnes ne survivent pas.** Les sauvegardes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud Storage désactivée, il est donc très probable qu'il disparaisse dès que le projet est supprimé — même si le projet lui-même est récupérable pendant 30 jours. Copiez une sauvegarde (vers Google Drive, ou un bucket en dehors du projet) avant de la supprimer s'il y a quelque chose à conserver ; pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

Source : [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects).

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que la fenêtre de restauration de 30 jours ci-dessus est passée, la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer lorsque vous en avez besoin.

- **Ce que coûte un redéploiement.** Les frais de module à nouveau, plus les builds : environ 79 crédits (environ 7,90 US$) au prix de la recharge, et environ 15 à 20 minutes de temps de build (moyenne de la propre plateforme de RAD). La suppression permet d'économiser de l'argent seulement si Cal.com resterait inutilisé pendant environ **3 jours ou plus** — dans votre propre projet, cela représente environ 2,79 US$ par jour, et dans un projet géré par RAD, c'est 32 crédits par jour.
- La majeure partie du coût d'exécution ici est généralement la base de données et/ou la VM ou le cluster de fichiers/cache partagé. Ils ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc la suppression de Cal.com alors qu'une autre application partage le projet n'économise que la partie calcul de Cal.com.
- **Conservez d'abord les données.** Les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui, alors copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant reçoit l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite fixée par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés retournent au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais RAD et estimation des crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour la fenêtre de pause/restauration et la mise en garde sur le bucket de sauvegarde ;
[Tarification Cal.com](https://cal.com/pricing) ; les prix changent, vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Cal.com s'exécute comme un conteneur Next.js sur Cloud Run v2. Le déploiement relie un
ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Next.js, 1 vCPU / 2 Gio par défaut, autoscaling sans serveur ; mise à l'échelle à zéro prise en charge |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — Cal.com (Prisma/`pg`) cible uniquement PostgreSQL |
| Stockage d'objets | Cloud Storage (aucun par défaut) | Cal.com stocke tout l'état dans PostgreSQL ; aucun bucket de téléchargement n'est créé |
| Cache | Redis (optionnel) | Désactivé par défaut ; utilisé pour la mise en cache / la limitation de débit |
| Secrets | Secret Manager | `NEXTAUTH_SECRET` et `CALENDSO_ENCRYPTION_KEY` auto-générés ; mot de passe de la base de données |
| Entrée | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut ; équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître à l'avance :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la couche
  d'application partagée ; le schéma Prisma de Cal.com cible uniquement PostgreSQL.
- **`NEXTAUTH_SECRET` et `CALENDSO_ENCRYPTION_KEY` sont générés automatiquement** et
  stockés dans Secret Manager. Ne les faites jamais pivoter après le premier démarrage
  sans fenêtre de maintenance — la rotation de `CALENDSO_ENCRYPTION_KEY` rend toutes les
  informations d'identification de calendrier/OAuth stockées indéchiffrables, et la
  rotation de `NEXTAUTH_SECRET` invalide toutes les sessions.
- **L'URL publique est validée au démarrage.** `NEXT_PUBLIC_WEBAPP_URL` / `NEXTAUTH_URL`
  par défaut à l'URL `run.app` déterministe de ce service ; les laisser à la
  valeur par défaut `localhost:3000` de l'image fait que le serveur refuse de démarrer.
  Définissez `webapp_url` sur un domaine personnalisé avant de partager les liens de
  réservation.
- **Le schéma est créé au démarrage, pas par un job de migration.** Le job `db-init`
  provisionne uniquement la base de données et le rôle vides ; Cal.com exécute `prisma migrate deploy`
  à chaque démarrage. Prévoyez plusieurs minutes pour le premier démarrage.
- **La mémoire minimale est de 2 Gio.** Cal.com (Next.js 16) plante par manque de
  mémoire au démarrage en dessous de 2 Gio.
- **La mise à l'échelle à zéro est activée par défaut** (`min_instance_count = 0`, `max = 1`,
  facturation basée sur les requêtes). Les démarrages à froid ajoutent de la latence à la
  première requête après l'inactivité ; définissez `min_instance_count = 1` pour les éviter.
- **Le socket du proxy d'authentification Cloud SQL est utilisé par défaut** (`enable_cloudsql_volume = true`).
  Une connexion TCP directe par IP privée échoue à la vérification du certificat
  serveur de Prisma par rapport à l'autorité de certification non fiable de Cloud SQL —
  le socket évite cela (le proxy effectue le mTLS).
- **Redis est désactivé par défaut.** Activez-le uniquement pour le cache / la
  limitation de débit.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des services et des ressources sont
rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Cal.com {#a-cloud-run--the-calcom-service}

Cal.com s'exécute comme un service Cloud Run v2 qui s'adapte automatiquement en fonction de la charge de requêtes entre le nombre minimum et maximum d'instances. Chaque déploiement crée une révision immuable ; le trafic peut être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Cal.com stocke toutes les données d'application (utilisateurs, types d'événements, réservations, informations d'identification de calendrier connectées) dans une instance gérée de Cloud SQL pour PostgreSQL 15. Le service se connecte en privé via le **proxy d'authentification Cloud SQL** via un socket Unix ; aucune IP publique n'est exposée. Lors du premier déploiement, un job d'initialisation crée la base de données et le rôle de l'application, et Cal.com applique son schéma via Prisma au démarrage.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe se trouvent dans les [Sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage {#c-cloud-storage}

Cal.com conserve tout l'état dans PostgreSQL, donc **aucun bucket de données n'est créé par défaut** (`storage_buckets` est vide). Des buckets supplémentaires peuvent toujours être déclarés via `storage_buckets` si nécessaire pour des intégrations personnalisées.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### D. Redis (cache optionnel) {#d-redis-optional-cache}

Redis est **désactivé par défaut** (`enable_redis = false`). Lorsqu'il est activé, Cal.com l'utilise comme backend de cache / de limitation de débit. Lorsque `redis_host` est vide et `enable_nfs` est vrai, l'IP de la VM du serveur NFS est utilisée comme point de terminaison Redis.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  # Confirm env injected into the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### E. Secret Manager {#e-secret-manager}

Deux secrets cryptographiques sont générés automatiquement et stockés dans Secret Manager : `NEXTAUTH_SECRET` (signe les jetons de session NextAuth.js) et `CALENDSO_ENCRYPTION_KEY` (chiffre les informations d'identification de calendrier/OAuth stockées). Le mot de passe de la base de données est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### F. Réseau et entrée {#f-networking--ingress}

Le service est accessible à son URL `run.app` par défaut (`ingress_settings = "all"`). Un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peut être superposé ; les paramètres d'entrée et le contrôle d'égression VPC contrôlent la connectivité. Étant donné que Cal.com intègre son URL publique dans les liens de réservation et OAuth générés, définissez `webapp_url` sur le domaine final avant de passer en production.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux des conteneurs sont acheminés vers Cloud Logging ; les métriques Cloud Run et Cloud SQL sont acheminées vers Cloud Monitoring, avec des vérifications de disponibilité et des politiques d'alerte optionnelles.

- **Console :** Logging → Logs Explorer ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Cal.com {#3-calcom-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job d'initialisation exécute `db-init.sh` en utilisant `postgres:15-alpine`. Il se connecte via le proxy d'authentification Cloud SQL et crée de manière idempotente le rôle et la base de données de l'application et accorde des privilèges sur le schéma `public`. Il ne crée **pas** le schéma de l'application — c'est le travail de Cal.com.
- **Migrations de schéma au démarrage.** Le script de démarrage de l'image exécute `prisma migrate deploy` à chaque démarrage, créant le schéma au premier démarrage et appliquant de nouvelles migrations lors des mises à niveau de version — pas d'étape de migration séparée. Prévoyez plusieurs minutes pour le premier démarrage avant que le service ne devienne Prêt.
- **`NEXTAUTH_SECRET` et `CALENDSO_ENCRYPTION_KEY` sont immuables après le premier démarrage.** Changer `CALENDSO_ENCRYPTION_KEY` rend toutes les informations d'identification de calendrier/OAuth stockées indéchiffrables (chaque intégration doit être ré-autorisée) ; changer `NEXTAUTH_SECRET` déconnecte tous les utilisateurs. Ne faites pivoter que pendant une fenêtre de maintenance planifiée.
- **L'URL publique est validée au démarrage.** `NEXT_PUBLIC_WEBAPP_URL` / `NEXTAUTH_URL` par défaut à l'URL `run.app` déterministe et sont corrigés à l'exécution à partir de `CLOUDRUN_SERVICE_URL`. Vérifiez la valeur déployée :
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" --format='value(status.url)'
  ```
- **Configuration au premier démarrage.** Ouvrez l'URL du service et complétez l'intégration de Cal.com pour créer le compte administrateur/propriétaire initial, puis configurez au moins un calendrier connecté. Cal.com auto-hébergé autorise l'inscription en libre-service par défaut — restreignez-la (ou placez le service derrière IAP) si l'instance ne doit pas être publique.
- **La sonde de démarrage est TCP, pas HTTP.** Le point de terminaison `/` ne renvoie 2xx qu'une fois que Cal.com signale une disponibilité COMPLÈTE (DB + Redis + dépendances), ce qui n'a jamais passé une sonde de démarrage HTTP même si Next.js écoutait déjà sur le port — donc la sonde par défaut est une vérification TCP avec un délai de 30 s (période de 20 s, 30 tentatives d'échec ≈ 10 minutes) qui réussit dès que l'application se lie au port. **La sonde de vivacité est désactivée par défaut** pour la même raison : la vivacité de Cloud Run ne peut pas utiliser un socket TCP, et le point de terminaison HTTP `/` redémarrerait en boucle un conteneur par ailleurs sain pendant qu'il atteint encore sa pleine disponibilité.
- **Inspecter l'exécution du job :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour Cal.com sont listés ; toutes les autres entrées sont héritées de [App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `calcom` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Cal.com` | Nom lisible par l'homme affiché dans la Console. |
| `application_version` | `latest` | Tag de l'image Cal.com (définit `CALCOM_VERSION`) ; épinglez à une version spécifique en production. |
| `webapp_url` | `""` | URL publique pour `NEXT_PUBLIC_WEBAPP_URL`/`NEXTAUTH_URL`. Vide → l'URL `run.app` déterministe ; définissez sur un domaine personnalisé une fois connu. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_port` | `3000` | Port sur lequel Cal.com écoute. |
| `cpu_limit` | `1000m` | CPU par instance ; Cal.com nécessite ≥ 1 vCPU. |
| `memory_limit` | `2Gi` | **Minimum 2 Gio** — Next.js 16 plante par manque de mémoire en dessous. |
| `min_instance_count` | `0` | `0` active la mise à l'échelle à zéro ; définissez `1` pour éviter les démarrages à froid. |
| `max_instance_count` | `1` | Plafond de coût ; augmentez pour une concurrence plus élevée. |
| `cpu_always_allocated` | `false` | Facturation basée sur les requêtes. Définissez `true` uniquement si vous exécutez des workers de rappel/notification en arrière-plan. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages NFS/GCS Fuse. |
| `enable_cloudsql_volume` | `true` | Socket du proxy d'authentification. **Conservez `true`** — le TCP direct par IP échoue à la vérification du certificat Prisma. |
| `enable_image_mirroring` | `true` | Mettez en miroir l'image Cal.com dans Artifact Registry. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Accès public. Définissez `internal`/`internal-and-cloud-load-balancing` pour restreindre. |
| `enable_iap` | `false` | Exiger la connexion Google devant Cal.com. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Ne définissez pas `NEXTAUTH_SECRET`, `CALENDSO_ENCRYPTION_KEY` ou `DATABASE_URL` ici — ils sont gérés automatiquement. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager (par exemple, informations d'identification SMTP ou d'application OAuth). |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créez des buckets GCS définis dans `storage_buckets` (aucun par défaut). |
| `storage_buckets` | `[]` | Buckets GCS supplémentaires. |
| `enable_nfs` | `true` | Volume partagé optionnel ; héberge également Redis co-localisé lorsqu'il est activé. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse (nécessite gen2). |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `db_name` | `calcom` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `calcom` | Utilisateur de la base de données de l'application. Mot de passe auto-généré dans Secret Manager. |
| `database_type` | `POSTGRES_15` | Fixé à PostgreSQL 15 ; les autres moteurs ne sont pas pris en charge. |
| `database_password_length` | `32` | Longueur du mot de passe généré. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | **TCP** sur le port du conteneur, délai de 30 s, période de 20 s, 30 tentatives (~10 min) | TCP, pas HTTP — le point de terminaison `/` ne renvoie 2xx qu'une fois que Cal.com est entièrement prêt (DB + Redis + dépendances), ce qui n'a jamais passé comme une porte HTTP même si l'application écoutait déjà. |
| `liveness_probe` | HTTP `/`, **désactivé par défaut** | Désactivé — le point de terminaison HTTP `/` redémarrerait en boucle un conteneur sain qui atteint encore sa pleine disponibilité, et la vivacité de Cloud Run ne peut pas utiliser TCP. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Vérification de la disponibilité de Cloud Monitoring. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Activez Redis comme backend de cache / de limitation de débit. |
| `redis_host` | `""` | Point de terminaison Redis. Laissez vide pour utiliser l'IP du serveur NFS (nécessite `enable_nfs = true`). |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis optionnel (sensible). |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquez un périmètre VPC-SC (nécessite `organization_id`). |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les
ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés (vides par défaut). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, vérifications de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration. |
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

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur de fondation [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et les combinaisons* au moment de la planification — IAP sans identités autorisées, un runtime `gen1` avec des montages NFS/GCS, un `database_type` qui ne correspond pas à une extension activée, un `redis_port`/`backup_retention_days` hors de portée. Une configuration invalide échoue à la **planification** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `CALENDSO_ENCRYPTION_KEY` (auto-généré) | Ne jamais faire pivoter après le premier démarrage | Critique | Le faire pivoter rend toutes les informations d'identification de calendrier/OAuth stockées indéchiffrables — chaque intégration doit être ré-autorisée. |
| `NEXTAUTH_SECRET` (auto-généré) | Ne faire pivoter que pendant une fenêtre de maintenance | Critique | Le faire pivoter invalide toutes les sessions utilisateur actives, forçant une reconnexion immédiate. |
| `db_name` / `db_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `database_type` | `POSTGRES_15` | Critique | Le schéma Prisma de Cal.com cible uniquement PostgreSQL ; tout autre moteur interrompt le démarrage. |
| `webapp_url` | URL publique finale | Critique | Une URL incorrecte ou non définie est intégrée à chaque lien de réservation/OAuth, et la valeur par défaut de l'image (`localhost:3000`) fait que le serveur refuse de démarrer. |
| `enable_cloudsql_volume` | `true` | Élevé | Le TCP direct par IP privée échoue à la vérification du certificat Prisma par rapport à l'autorité de certification de Cloud SQL — chaque requête renvoie 500. Conservez le socket du proxy d'authentification. |
| `memory_limit` | `2Gi` | Élevé | En dessous de 2 Gio, Next.js 16 plante par manque de mémoire au démarrage et la révision ne devient jamais Prête. |
| `enable_iap` | uniquement pour les instances privées | Élevé | IAP bloque toutes les requêtes non authentifiées — y compris les intégrations et les pages de réservation publiques. |
| Inscription ouverte | désactiver pour les instances privées | Élevé | Cal.com auto-hébergé autorise l'inscription en libre-service ; le laisser ouvert permet à quiconque ayant l'URL de créer un compte. |
| `min_instance_count` | `1` pour une utilisation sensible à la latence | Moyen | La mise à l'échelle à zéro (`0`) ajoute un délai de démarrage à froid à la première requête après l'inactivité. |
| Type `startup_probe` | conserver `TCP` | Moyen | Le passage à HTTP contre `/` échoue jusqu'à ce que Cal.com signale une disponibilité complète (DB + Redis + dépendances), bloquant le déploiement même si l'application écoute déjà. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise à l'échelle et
concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à Cal.com partagée
avec la variante GKE est décrite dans **[CalCom_Common](CalCom_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Cal.com sur Cloud Run](../labs/CalCom_CloudRun.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [Cal.com sur GKE Autopilot](CalCom_GKE.md) — la même application sur Kubernetes, pour lorsque vous avez besoin de l'autre cible de déploiement.
- [CalCom Common — Configuration d'application partagée](CalCom_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [OpenProject sur Google Cloud Run](OpenProject_CloudRun.md), [Kimai sur Google Cloud Run](Kimai_CloudRun.md), [Documenso sur Google Cloud Run](Documenso_CloudRun.md), [Invoice Ninja sur Google Cloud Run](InvoiceNinja_CloudRun.md) dans la solution **Professional Services Automation**.
