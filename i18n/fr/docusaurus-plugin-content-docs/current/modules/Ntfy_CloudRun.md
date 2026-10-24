---
title: "Ntfy sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Ntfy sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Ntfy_CloudRun.md @ 1665a43e sha256:886fe18c08d1 -->

# Ntfy sur Google Cloud Run {#ntfy-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Ntfy_CloudRun.png" alt="Ntfy sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

ntfy est un serveur de notifications push pub/sub open source, sous licence Apache 2.0,
écrit en Go. Les applications publient des messages via une API REST/HTTP simple et les clients les
reçoivent instantanément via des flux WebSocket ou Server-Sent-Events (SSE) — aucune base de données
externe n'est requise. Ce module déploie ntfy sur **Cloud Run v2** au-dessus de la
fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
partagée de Google Cloud.

Ce guide se concentre sur les services cloud utilisés par ntfy et sur la manière de les explorer et de les
exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à
toutes les applications Cloud Run — identité de service, ingress et équilibrage de charge,
mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## Ce que coûte Ntfy sur RAD, et comment cela se compare {#what-ntfy-costs-on-rad-and-how-that-compares}

**Ntfy sur le module Cloud Run de RAD coûte environ 51 $ US par mois, avec les frais de module facturés une seule fois en crédits RAD.** Si vous avez besoin que Ntfy reste actif en permanence, qu'il s'adapte à plusieurs pods ou qu'il fonctionne aux côtés d'autres charges de travail Kubernetes, consultez le [guide GKE](Ntfy_GKE.md) pour cette option. Si vous n'en avez besoin qu'occasionnellement — une démo, un projet saisonnier, quelque chose que vous évaluez — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits (moins de 1 $ US) au lieu de payer pour qu'il reste inactif. Voir **Mettez-le en pause gratuitement**, ci-dessous. Les chiffres sont ceux du 8 octobre 2026 ; les sources sont listées à la fin de cette section.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

RAD déploie **Ntfy**, qui est open source, il n'y a donc pas de frais de licence par utilisateur. Vous payez pour
trois choses :

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 40 crédits (4 $ US au prix de la recharge) | 36 crédits (10 % de moins) |
| Temps de build | Environ 3-6 crédits par build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **51 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **25 crédits par jour**, soit environ 750 par mois (environ 75 $ US au prix de la recharge, 60 $ US au tarif du plan Scale) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge ponctuelle, et moins pour un plan mensuel. Dans un projet géré par RAD, le réseau et le stockage sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas un deuxième ensemble de ceux-ci.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Cloud Run, 1x vCPU / 0,5 GiB (alwaysOn) | 44,72 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| **Total** | **environ 51 $ US** |

### Comment cela se compare {#how-it-compares}

| Option | Prix | Qui l'exécute |
|---|---|---|
| ntfy.sh, Supporter | 6 $/mois (5 $ facturés annuellement) | L'instance hébergée par le mainteneur de ntfy. 2 500 messages/jour, 3 sujets réservés |
| ntfy.sh, Pro | 12 $/mois (10 $ facturés annuellement) | 20 000 messages/jour, 10 sujets réservés |
| ntfy.sh, Business | 25 $/mois (20 $ facturés annuellement) | 50 000 messages/jour, 50 sujets réservés, appels téléphoniques |
| **RAD, Cloud Run, votre propre projet** | **Environ 51 $ US**, plus 4 $ US une fois par déploiement | L'automatisation de RAD, dans votre projet |
| **RAD, Cloud Run, un projet géré par RAD** | **Environ 750 crédits (60-75 $ US)** | RAD |
| RAD, GKE Autopilot | Voir le [guide GKE](Ntfy_GKE.md) | RAD |

Le mainteneur de ntfy vend exactement cela — une copie hébergée du même serveur open source — c'est donc la comparaison la plus juste disponible. **La version auto-hébergée gratuite n'a aucune limite de messages**, ce qui est la raison habituelle de l'auto-hébergement plutôt que de l'abonnement : une intégration très active peut dépasser même les 50 000 messages/jour du plan Business, tandis que le propre projet de RAD n'a pas de tel plafond.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Ntfy s'exécute dans **un projet géré par RAD pour vous**, vous avez une deuxième option qui va bien
au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour presque
rien.** Cela convient bien mieux à Ntfy dont vous n'avez besoin qu'occasionnellement — une démo, une évaluation, un projet
saisonnier — que de le faire fonctionner en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de
  supprimer le projet. Google ne supprime pas le projet immédiatement : il le conserve, récupérable,
  pendant 30 jours. Comme la facturation est déjà déliée, rien n'est facturé pendant qu'il attend. Contrairement
  à la suppression d'un module, cela ne détruit pas la ressource de calcul
  une par une — l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte quelques crédits, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet peut le
  restaurer. RAD demande à Google de restaurer le projet et de rattacher son compte de facturation, puis vous demande de
  exécuter **Mettre à jour** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été
  détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une
  reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela coûte environ une poignée de crédits (moins de 1 $ US) au
  total pour une chaîne typique de 2-3 déploiements.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, pas 51 $ US.** Déployez Ntfy, utilisez-le
  pendant un certain temps, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Mettre à jour, et
  supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez que les frais de module une seule fois, les builds, et le temps
  pendant lequel Ntfy était réellement actif.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un projet que vous apportez et dont RAD ne gère que la facturation),
  et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime définitivement.
  La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés doit toujours dépasser
  le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude et de démo conviennent). Google indique que la plupart
  des services sont à nouveau entièrement fonctionnels dans les 36 heures suivant une restauration.
- **Une lacune réelle : les sauvegardes nocturnes ne survivent pas.** Les sauvegardes sont écrites dans un bucket à l'intérieur du
  projet, et ce bucket n'est **pas** protégé par la suppression logicielle de Cloud Storage, il est donc très probable
  qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30
  jours. Si vous avez personnalisé Ntfy et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive,
  ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien
  d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours
passée, la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer lorsque vous
en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ 45
  crédits (4,50 $ US) dans votre propre projet, ou 41
  crédits dans un projet géré par RAD. La suppression permet d'économiser de l'argent une fois que Ntfy resterait inutilisé pendant
  environ 3 jours ou plus dans votre propre projet (environ 1,69 $ US par
  jour), ou environ 2 jours ou plus dans un projet géré par RAD (25 crédits par
  jour).
- **La majeure partie du coût d'exécution est généralement la base de données et toute VM de fichier/cache partagée.** Elles ne s'arrêtent que
  lorsque rien d'autre dans le projet ne les utilise, donc la suppression de Ntfy alors que quelque chose d'autre partage le
  projet n'économise que la partie de calcul propre à cette application.
- **Conservez d'abord vos données.** Les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées
  avec lui, donc copiez la dernière sauvegarde avant de supprimer si vous voulez la conserver.

### Sessions de labo et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de labo, pour la formation.** Un formateur anime une session pour une classe. Chaque participant reçoit
  Ntfy dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le
  formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne.
  Tout est supprimé à la fin de la session et les crédits non utilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute Ntfy pour un client à partir d'un
  portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation
  est suspendue et les données sont conservées, afin que personne ne reçoive de frais inattendus. À la fin, le partenaire remet
  le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par
  carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour la fenêtre de récupération de 30 jours et ce qu'elle dit sur les objets Cloud Storage sans suppression logicielle ; frais RAD et estimations de crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [ntfy.sh](https://ntfy.sh/). Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

ntfy s'exécute comme un conteneur Go unique sur Cloud Run v2. Le déploiement relie un
ensemble délibérément restreint de services Google Cloud — ntfy n'a pas de base de données, de cache ou
de dépendance de stockage d'objets propre :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Go unique, 1 vCPU / 512 Mio par défaut ; CPU toujours alloué pour les flux de longue durée |
| Base de données | **Aucune** | `database_type = "NONE"` ; le cache de messages est un fichier SQLite local, aucune base de données Cloud SQL n'est provisionnée |
| Persistance | Disque éphémère (par défaut) ou NFS (facultatif) | Cache SQLite à `/var/cache/ntfy/cache.db` ; activez NFS pour un historique de messages durable |
| Stockage d'objets | **Aucun** | ntfy ne stocke rien dans Cloud Storage |
| Cache / file d'attente | **Aucun** | Pas de Redis ; ntfy utilise un bus de messages intégré au processus |
| Secrets | Secret Manager | Pas de secrets auto-générés ; seulement `secret_environment_variables` fournis par l'utilisateur |
| Ingress | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut ; équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Aucune base de données n'est provisionnée.** `database_type = "NONE"` — ntfy conserve son
  cache de messages dans un fichier SQLite local. Les variables liées à la base de données existent pour
  être complètes, mais sont inertes à moins que vous n'optiez délibérément pour une base de données externe.
- **Le cache de messages est éphémère par défaut.** Il se trouve à
  `/var/cache/ntfy/cache.db`. Le système de fichiers racine de Cloud Run est en lecture seule, donc le
  point d'entrée revient à `/tmp/ntfy` lorsque le répertoire configuré n'est pas
  inscriptible. L'historique des messages est donc perdu à chaque redémarrage/redéploiement à moins que vous
  n'activiez NFS (`enable_nfs = true`) et que vous ne pointiez le répertoire de cache vers le point de montage.
- **Le CPU est toujours alloué (`cpu_always_allocated = true`).** ntfy maintient des
  flux WebSocket/SSE de longue durée ouverts pour pousser les messages aux abonnés connectés en temps réel,
  donc le CPU ne doit pas être limité entre les requêtes. Passer à `false` permet d'économiser des coûts
  sur une instance à faible trafic, mais interrompt la livraison en temps réel pendant l'inactivité.
- **Instance unique par défaut** (`min_instance_count = 1`, `max_instance_count = 1`).
  Étant donné que le flux d'un abonné est ancré à l'instance qui le contient et qu'il n'y a pas de
  bus de messages partagé, la mise à l'échelle n'est pas la valeur par défaut. Gardez le maximum à 1 à moins que vous
  ne placiez un cache/broker partagé derrière ntfy.
- **L'ingress public est la valeur par défaut** (`ingress_settings = "all"`) afin que les éditeurs et
  les abonnés puissent atteindre le service. L'activation d'IAP nécessite une connexion Google et bloque
  les appels de publication/abonnement non authentifiés.
- **Le point de terminaison de santé est `/v1/health`**, qui renvoie `{"healthy":true}` avec HTTP
  200 dès que le serveur lie son port.
- **Le contrôle d'accès est une étape post-déploiement.** ntfy est livré avec un accès ouvert ; configurez
  les utilisateurs et les ACL de sujets par la suite via son CLI ou les variables d'environnement `NTFY_AUTH_*`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de services et de ressources sont
rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service ntfy {#a-cloud-run--the-ntfy-service}

ntfy s'exécute en tant que service Cloud Run v2. Chaque déploiement crée une révision immuable ;
le trafic peut être réparti entre les révisions pour des déploiements sûrs. Comme le CPU est toujours
alloué, une instance active maintient ses flux d'abonnés actifs entre les requêtes.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les journaux et
  les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement
d'exécution et la répartition du trafic.

### B. Persistance — le cache de messages SQLite {#b-persistence--the-sqlite-message-cache}

ntfy n'a **pas d'instance Cloud SQL**. Son cache de messages est un fichier SQLite local à
`NTFY_CACHE_FILE` (`/var/cache/ntfy/cache.db`), créé par le point d'entrée au démarrage.
Sur le système de fichiers racine en lecture seule de Cloud Run, le point d'entrée revient à `/tmp/ntfy`
lorsque ce chemin n'est pas inscriptible — donc avec la configuration par défaut, le cache est
**éphémère** et l'historique des messages ne survit pas à un redémarrage.

Pour un historique durable, activez NFS et montez-le là où se trouve le cache :

- **Console :** Filestore → Instances (lorsque `enable_nfs = true`).
- **CLI :**
  ```bash
  # Confirm the cache path injected into the running revision:
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

Voir [App_CloudRun](App_CloudRun.md) pour le modèle de montage NFS (Filestore).

### C. Secret Manager {#c-secret-manager}

ntfy ne génère **aucun** secret au moment du déploiement — il n'y a pas de mot de passe de base de données ou
de clé de chiffrement à gérer. Secret Manager n'est utilisé que si vous fournissez le vôtre via
`secret_environment_variables` (par exemple une valeur `NTFY_AUTH_*` ou une
crential push en amont).

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### D. Réseau et ingress {#d-networking--ingress}

Le service est accessible à son URL `run.app` par défaut, ce qui permet l'accès public
dont ntfy a besoin pour le trafic de publication/abonnement. Un équilibreur de charge HTTPS externe
avec un domaine personnalisé, Cloud CDN et Cloud Armor peuvent être superposés ; les paramètres d'ingress
et le contrôle d'égression VPC contrôlent la connectivité. Si les clients utilisent le streaming HTTP/2, définissez
`container_protocol = "h2c"`.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les journaux de conteneurs sont acheminés vers Cloud Logging ; les métriques Cloud Run sont acheminées vers Cloud Monitoring,
avec des vérifications de disponibilité et des politiques d'alerte facultatives. ntfy enregistre son adresse d'écoute et
le chemin de cache résolu au démarrage.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Ntfy {#3-ntfy-application-behaviour}

- **Pas de configuration de base de données au premier déploiement.** ntfy n'a pas de base de données externe et pas d'étape de migration.
  Le point d'entrée prépare le répertoire de cache SQLite et exécute immédiatement
  `ntfy serve`. Il n'y a pas de job `db-init` par défaut.
- **Cache éphémère avec repli automatique.** Le point d'entrée crée le répertoire de `NTFY_CACHE_FILE` ;
  sur le système de fichiers racine en lecture seule de Cloud Run, il revient à `/tmp/ntfy` et enregistre un avertissement.
  Cela maintient un déploiement de base (sans NFS) sain.
  Activez NFS pour un historique de messages durable.
- **La livraison en temps réel nécessite une allocation de CPU.** Les abonnés maintiennent des flux WebSocket/SSE ouverts ;
  `cpu_always_allocated = true` garantit que le bus de messages intégré au processus continue de
  livrer entre les requêtes entrantes.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/v1/health`, qui renvoie
  `{"healthy":true}` et HTTP 200 dès que le serveur lie le port 80. Vérifier :
  ```bash
  SERVICE_URL=$(gcloud run services describe <service-name> \
    --project "$PROJECT" --region "$REGION" --format='value(status.url)')
  curl -s "$SERVICE_URL/v1/health"      # -> {"healthy":true}
  ```
- **Test de fumée de publication / abonnement.**
  ```bash
  curl -d "hello from ntfy" "$SERVICE_URL/mytopic"     # publish
  curl -s "$SERVICE_URL/mytopic/json"                   # subscribe (streaming JSON)
  ```
- **L'accès est ouvert jusqu'à ce que vous le verrouilliez.** Par défaut, tout client peut publier et
  s'abonner à n'importe quel sujet. Configurez les utilisateurs et les ACL par sujet après le déploiement via le CLI de ntfy
  (`ntfy user add`, `ntfy access`) ou les variables d'environnement `NTFY_AUTH_*`.
- **URL de base publique pour les pièces jointes / push web.** Si vous utilisez des pièces jointes ou le
  push web du navigateur, définissez `NTFY_BASE_URL` (via `environment_variables`) sur l'URL publique du service
  afin que les liens générés se résolvent correctement.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls
les paramètres spécifiques ou notables pour ntfy sont listés ; toutes les autres entrées sont héritées
de [App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 / 3 — Environnement de déploiement et identité de l'application {#group-2--3--deployment-environment--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `application_name` | `ntfy` | Nom de base pour le service, le dépôt de registre et les secrets. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Ntfy` | Nom lisible par l'homme affiché dans la console. |
| `application_version` | `latest` | Tag de version d'image ; `latest` correspond à une base `v2.11.0` épinglée. Épinglez un `v2.x.y` explicite en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure de support. |
| `container_image_source` | `custom` | `custom` construit l'image du wrapper via Cloud Build ; `prebuilt` déploie une image directement. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `512Mi` | Mémoire par instance (le plancher gen2 est de 512 Mio). |
| `min_instance_count` | `1` | Instances minimales. |
| `max_instance_count` | `1` | **Gardez à 1** — les flux sont locaux à l'instance sans broker partagé. |
| `container_port` | `80` | ntfy écoute sur le port 80. |
| `container_protocol` | `http1` | Définissez `h2c` pour le streaming HTTP/2 de bout en bout. |
| `cpu_always_allocated` | `true` | Requis pour la livraison de flux en temps réel ; passez à `false` uniquement pour des économies de coûts à faible trafic. |
| `enable_cloudsql_volume` | `false` | Désactivé — ntfy n'a pas de base de données. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image ntfy dans Artifact Registry. |

### Groupe 5 — Accès et réseau {#group-5--access--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` est requis pour le trafic public de publication/abonnement. |
| `enable_iap` | `false` | Exiger la connexion Google. **Bloque la publication/abonnement non authentifiée.** |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres `NTFY_*` supplémentaires (par exemple `NTFY_BASE_URL`, `NTFY_AUTH_DEFAULT_ACCESS`). |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager (facultatif ; aucun n'est requis). |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Activer pour sauvegarder le cache SQLite avec NFS pour un **historique de messages durable**. |
| `nfs_mount_path` | `/var/cache/ntfy` | Chemin de montage NFS ; pointez `NTFY_CACHE_FILE` vers celui-ci pour la persistance. |
| `storage_buckets` | `[]` | Non requis — ntfy n'utilise pas de stockage d'objets. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | ntfy n'a pas de base de données externe ; laissez `NONE`. |
| `application_database_name` / `application_database_user` | `ntfy` | Inerte à moins qu'une base de données externe ne soit délibérément activée. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | ntfy n'a pas besoin de job d'initialisation ; laissez vide. |
| `cron_jobs` | `[]` | Jobs Cloud Run planifiés facultatifs. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/v1/health` 30s de délai | Sonde de démarrage. ntfy devient sain en quelques secondes. |
| `liveness_probe` | HTTP `/v1/health` 30s de délai | Sonde de vivacité. |
| `uptime_check_config` | `{ enabled=false, path="/v1/health" }` | Vérification de disponibilité Cloud Monitoring facultative. |

### Groupe 16 — Cache Redis {#group-16--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Non requis — ntfy n'a pas de dépendance Redis. |

Toutes les autres entrées suivent le comportement standard de [App_CloudRun](App_CloudRun.md).

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
| `database_instance_name` / `database_name` / `database_user` | Identifiants de base de données — vides pour le moteur `NONE` par défaut. |
| `database_password_secret` / `database_host` / `database_port` | Champs de point de terminaison de base de données — inutilisés pour `NONE`. |
| `storage_buckets` | Buckets Cloud Storage créés (aucun par défaut). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, vérifications de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (aucun par défaut). |
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

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration via le moteur de fondation [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et les combinaisons* au moment de la planification — IAP sans identités autorisées, un environnement d'exécution `gen1` avec des montages NFS/GCS, un `container_port`/`timeout_seconds` hors de portée, une valeur de mémoire inférieure au plancher gen2. Une configuration invalide échoue le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `enable_nfs` (pour l'historique durable) | `true` lorsque l'historique est important | Élevé | Avec le cache éphémère par défaut, tout l'historique des messages est perdu à chaque redémarrage/redéploiement — acceptable pour un relais pur, surprenant si vous vous attendiez à une persistance. |
| `max_instance_count` | `1` | Élevé | La mise à l'échelle au-delà de 1 divise les abonnés entre les instances sans bus partagé, de sorte qu'un message publié sur une instance n'est pas livré aux abonnés épinglés à une autre. |
| `cpu_always_allocated` | `true` | Élevé | Définir `false` permet à Cloud Run de limiter le CPU entre les requêtes, interrompant la livraison WebSocket/SSE en temps réel pendant que l'instance est inactive. |
| `ingress_settings` | `all` | Élevé | `internal` empêche les éditeurs et abonnés externes d'atteindre le service. |
| `enable_iap` | uniquement lorsque l'authentification est activée | Élevé | IAP nécessite une connexion Google pour chaque requête, bloquant la publication/abonnement non authentifiée — ce qui n'est généralement pas ce qu'un point de terminaison de notification souhaite. |
| `NTFY_BASE_URL` | URL réelle du service | Moyen | Non défini, les liens de pièces jointes et de push web se résolvent vers le mauvais hôte. |
| Contrôle d'accès ntfy | Configurer après le déploiement | Moyen | Par défaut, tout client peut publier et s'abonner à n'importe quel sujet sur une URL publique. |
| `container_protocol` | `http1` (ou `h2c`) | Moyen | Une incompatibilité avec les clients qui nécessitent le streaming HTTP/2 dégrade ou interrompt les flux de longue durée. |
| `memory_limit` | `512Mi` | Faible | L'environnement d'exécution gen2 rejette les valeurs inférieures à 512 Mio au moment de l'application. |
| `application_version` | Épingler `v2.x.y` en production | Faible | `latest` correspond à une base épinglée (`v2.11.0`) ; épinglez explicitement pour contrôler les mises à niveau. |

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise à l'échelle et
concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à ntfy partagée
avec la variante GKE est décrite dans **[Ntfy_Common](Ntfy_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Labo pratique : Ntfy sur Cloud Run](../labs/Ntfy_CloudRun.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [Ntfy sur GKE Autopilot](Ntfy_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Ntfy Common — Configuration d'application partagée](Ntfy_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [EvolutionAPI sur Google Cloud Run](EvolutionAPI_CloudRun.md), [Chatwoot sur Google Cloud Run](Chatwoot_CloudRun.md), [n8n sur Google Cloud Run](N8N_CloudRun.md), [Listmonk sur Google Cloud Run](Listmonk_CloudRun.md) dans la solution **Conversational Outreach**.
