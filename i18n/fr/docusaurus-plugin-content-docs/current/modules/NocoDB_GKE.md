---
title: "NocoDB sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de NocoDB sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/NocoDB_GKE.md @ e69407af sha256:ce939a63e5e2 -->

# NocoDB sur GKE Autopilot {#nocodb-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/NocoDB_GKE.png" alt="NocoDB sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

NocoDB est une alternative open source à Airtable qui transforme n'importe quelle
base de données en une feuille de calcul intelligente avec une interface sans code,
des API REST et GraphQL, et des automatisations intégrées. Ce module déploie
NocoDB sur **GKE Autopilot** sur la base [App_GKE](App_GKE.md), qui provisionne
et gère l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par NocoDB et sur la façon
de les explorer et de les opérer depuis la Google Cloud Console et la ligne de
commande. Pour les mécanismes communs à toutes les applications GKE — Workload
Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, sauvegardes et cycle de vie du déploiement —
référez-vous au [guide de la fondation App_GKE](App_GKE.md) plutôt que de les
répéter ici.

---

## Ce que coûte NocoDB sur RAD, et comment cela se compare {#what-nocodb-costs-on-rad-and-how-that-compares}

**Le module GKE Autopilot de NocoDB sur RAD coûte environ 93–166 $ US par mois,
avec les frais de module facturés une fois en crédits RAD.** GKE Autopilot
convient à NocoDB qui doit rester opérationnel, s'adapter à travers les pods ou
s'exécuter aux côtés d'autres charges de travail Kubernetes ; pour le coût le
plus bas, le [module Cloud Run](NocoDB_CloudRun.md) exécute le même NocoDB pour
environ 69 $ US par mois. Si vous n'en avez besoin qu'occasionnellement — une
démo, un projet saisonnier, quelque chose que vous évaluez — un projet géré par
RAD peut être supprimé et restauré dans les 30 jours pour une poignée de
crédits (moins de 1 $ US) au lieu de payer pour qu'il reste inactif. Voir
**Mettez-le en pause gratuitement**, ci-dessous. Les chiffres sont à jour au 8
octobre 2026 ; les sources sont listées à la fin de cette section.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

RAD déploie **NocoDB**, qui est open source, il n'y a donc pas de frais de
licence par utilisateur. Vous payez pour trois choses :

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 110 crédits (11 $ US au prix de la recharge) | 99 crédits (10 % de moins) |
| Temps de build | Environ 3-6 crédits par build | Idem |
| Coût de fonctionnement Google Cloud | Facturé par Google à votre propre compte de facturation, environ **93 $ US par mois** pour la configuration par défaut (tableau ci-dessous) — plus si ce n'est pas votre seul cluster Autopilot | Mesuré à l'heure en crédits ; RAD publie **85 crédits par jour**, environ 2 550 par mois (environ 255 $ US au prix de la recharge, 204 $ US au tarif du plan Scale) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est maintenu en réserve |

10 crédits coûtent 1 $ US pour une recharge unique, et moins sur un plan
mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers
et le réseau sont partagés par toutes les applications du projet, de sorte
qu'une deuxième application n'ajoute pas un deuxième ensemble de ceux-ci.

**Coût de fonctionnement par défaut dans votre propre projet** (us-central1,
prix catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Pod GKE Autopilot, 1x vCPU / 1 Gio | 36,08 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 |
| **Total** | **environ 93 $ US** (environ 166 $ US si ce n'est pas votre seul cluster Autopilot) |

### Comment cela se compare {#how-it-compares}

| Option | Prix | Qui l'exécute |
|---|---|---|
| Airtable, plan Team | 20 $/utilisateur/mois, facturé annuellement | Airtable. Par siège ; ce que NocoDB est conçu pour remplacer |
| Airtable, plan Business | 45 $/utilisateur/mois, facturé annuellement | Airtable |
| NocoDB Cloud, Plus | environ 12-15 $/mois, sièges illimités | Le propre plan hébergé de NocoDB Labs pour le même projet open source |
| NocoDB Cloud, Business | environ 24-30 $/mois, sièges illimités | NocoDB Labs |
| **RAD, Cloud Run, votre propre projet** | **Environ 69 $ US**, plus 8 $ US une fois par déploiement | L'automatisation de RAD, dans votre projet |
| **RAD, Cloud Run, un projet géré par RAD** | **Environ 780 crédits (62–78 $ US)** | RAD |
| RAD, GKE Autopilot | Voir le [guide GKE](NocoDB_GKE.md) | RAD |

**Airtable facture par siège ; le coût de RAD est l'infrastructure, qui ne
croît pas avec les effectifs.** Une équipe de cinq personnes sur le plan Team
d'Airtable paie 100 $/mois avant tout module complémentaire d'automatisation ;
la même équipe sur le propre projet de RAD paie un coût de fonctionnement fixe
quel que soit le nombre de personnes ayant des identifiants. La tarification
illimitée de NocoDB Cloud est la comparaison la plus pertinente, car il s'agit
du même projet open source hébergé par son mainteneur — le chiffre du propre
projet de RAD se situe en dessous de son plan Plus et son chiffre géré par RAD
se situe près de son plan Business, pour une infrastructure que vous pouvez
également inspecter et déplacer à tout moment.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si NocoDB s'exécute dans **un projet géré par RAD pour vous**, vous avez une
deuxième option qui va bien au-delà de la mise à l'échelle à zéro : **supprimez
l'ensemble du projet et restaurez-le dans les 30 jours pour presque rien.**
Cela convient bien mieux à NocoDB dont vous n'avez besoin qu'occasionnellement
— une démo, une évaluation, un projet saisonnier — que de le faire fonctionner
en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord
  sa facturation, puis demande à Google de supprimer le projet. Google ne
  supprime pas le projet immédiatement : il le conserve, récupérable, pendant
  30 jours. Comme la facturation est déjà déliée, rien n'est facturé pendant
  qu'il attend. Contrairement à la suppression d'un module, cela ne détruit pas
  la base de données, le cluster ou la ressource de calcul un par un —
  l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte quelques crédits, pas une reconstruction.** Dans les
  30 jours, le propriétaire du projet peut le restaurer. RAD demande à Google
  de récupérer le projet et de rattacher son compte de facturation, puis vous
  demande d'exécuter **Mettre à jour** sur chaque déploiement pour confirmer
  que tout est revenu. Comme rien n'a été détruit individuellement, cette mise
  à jour trouve les mêmes ressources déjà présentes — c'est une vérification,
  pas une reconstruction, et une mise à jour ne facture plus jamais les frais
  de module. Cela coûte environ une poignée de crédits (moins de 1 $ US) au
  total pour une chaîne typique de 2-3 déploiements.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars,
  pas 93 $ US.** Déployez NocoDB, utilisez-le pendant un certain temps,
  supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin,
  confirmez avec Mettre à jour, et supprimez-le à nouveau lorsque vous avez
  terminé. Vous ne payez les frais de module qu'une seule fois, les builds, et
  le temps pendant lequel NocoDB était réellement actif.
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet
  que vous apportez et dont RAD ne gère que la facturation), et vous le
  restaurez vous-même dans les 30 jours — après cela, Google le supprime
  définitivement. La restauration est admise comme la création d'un nouveau
  projet : votre solde de crédits achetés doit toujours dépasser le seuil du
  palier (100 crédits pour le palier sandbox que la plupart des utilisations
  d'étude et de démo conviennent). Google indique que la plupart des services
  sont de nouveau pleinement fonctionnels dans les 36 heures suivant une
  restauration.
- **Un véritable manque : les sauvegardes nocturnes ne survivent pas.** Les
  sauvegardes sont écrites dans un bucket à l'intérieur du projet, et ce bucket
  n'est **pas** protégé par la suppression logicielle de Cloud Storage, il est
  donc très probable qu'il disparaisse dès que vous supprimez le projet — même
  si le projet lui-même est récupérable pendant 30 jours. Si vous avez
  personnalisé NocoDB et que vous souhaitez conserver ce travail, copiez une
  sauvegarde (vers Google Drive ou un bucket en dehors du projet) avant de
  supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela
  n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre
propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de
payer est de supprimer le déploiement et de le redéployer lorsque vous en avez
besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les
  builds : environ 115 crédits (11,50 $ US) dans votre propre projet, ou 104
  crédits dans un projet géré par RAD. La suppression permet d'économiser de
  l'argent une fois que NocoDB resterait inutilisé pendant environ 4 jours ou
  plus dans votre propre projet (environ 3,10 $ US par jour), ou environ 1 jour
  ou plus dans un projet géré par RAD (85 crédits par jour).
- **La majeure partie du coût de fonctionnement est généralement la base de
  données et toute VM de fichier/cache partagée.** Elles ne s'arrêtent que
  lorsque rien d'autre dans le projet ne les utilise, donc la suppression de
  NocoDB alors que quelque chose d'autre partage le projet n'économise que la
  partie calcul de cette application.
- **Gardez vos données en premier.** Les sauvegardes nocturnes vont dans un
  bucket à l'intérieur du déploiement et sont supprimées avec lui, alors
  copiez la dernière sauvegarde avant de supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour
  une classe. Chaque participant dispose de NocoDB dans son propre projet Google
  Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie
  par le formateur. Soit le formateur finance toutes les places, soit chaque
  participant paie la sienne. Tout est supprimé à la fin de la session et les
  crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire
  exécute NocoDB pour un client à partir d'un portefeuille cloisonné qu'il
  finance, et règle directement avec le client. Si le portefeuille est faible,
  la facturation est interrompue et les données sont conservées, afin que
  personne ne reçoive de frais inattendus. À la fin, le partenaire transfère le
  projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF,
  NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud
Billing Catalog ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour la fenêtre de récupération de 30 jours et ce qu'elle dit sur les objets
Cloud Storage sans suppression logicielle ; frais RAD et estimations de crédits
quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ;
[tarification NocoDB](https://nocodb.com/pricing) ;
[tarification Airtable](https://airtable.com/pricing). Les prix changent ;
vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

NocoDB s'exécute comme une charge de travail Node.js. Le déploiement relie un
ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods Node.js, 1 vCPU / 1 Gio par défaut, mise à l'échelle horizontale automatique |
| Base de données | Cloud SQL pour PostgreSQL 15 | Moteur par défaut ; MySQL 8.0 également pris en charge via `database_type` |
| Stockage d'objets | Cloud Storage | Provisionné, mais non connecté au stockage de pièces jointes de NocoDB (voir ci-dessous) |
| Cache (facultatif) | Redis | Désactivé par défaut ; requis lors de l'exécution de plusieurs réplicas |
| Secrets | Secret Manager | Secret JWT auto-généré (`NC_AUTH_JWT_SECRET`) et mot de passe de la base de données |
| Ingress | Cloud Load Balancing | Équilibreur de charge externe, domaine personnalisé facultatif + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est la valeur par défaut.** MySQL 8.0 est également pris en
  charge ; définissez `database_type` avant le premier déploiement.
- **NocoDB se connecte via IP privée TCP, pas le socket Auth Proxy.** Le
  sidecar Cloud SQL Auth Proxy est activé par défaut dans la variante GKE
  (`enable_cloudsql_volume
  = true`), mais le constructeur d'URL interne de NocoDB nécessite un hôte
  TCP — l'IP privée est utilisée, pas le chemin du socket Unix.
- **NFS est désactivé par défaut.** NocoDB n'a pas de dépendance de système de
  fichiers partagé, mais il n'a pas non plus de backend de stockage de pièces
  jointes Cloud Storage fonctionnel prêt à l'emploi (voir §2C) — les pièces
  jointes utilisent un disque de pod local/éphémère sauf si elles sont
  configurées manuellement.
- **Redis est désactivé par défaut.** Un seul réplica s'exécute sans Redis ;
  activez-le avant de passer à plus d'un pod.
- **Le secret JWT est généré automatiquement** et stocké dans Secret Manager.
  Ne le faites pas pivoter après le premier déploiement — toutes les sessions
  existantes et les jetons d'API seraient immédiatement invalidés.
- **NocoDB gère ses propres migrations de base de données au premier
  démarrage.** Aucun job d'initialisation externe n'est requis, bien qu'un
  job `db-init` soit toujours fourni pour créer la base de données et
  l'utilisateur.
- **Les sondes de santé ciblent `/api/v1/health`**, le point de terminaison de santé
  dédié que NocoDB expose.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les
autres identifiants sont signalés dans les [Sorties](#5-outputs) du
déploiement.

### A. GKE Autopilot — la charge de travail NocoDB {#a-gke-autopilot--the-nocodb-workload}

Les pods NocoDB sont planifiés sur Autopilot, qui facture le CPU/la mémoire
réellement demandés par les pods. L'autoscaling horizontal des pods dimensionne
le déploiement entre les nombres minimum et maximum de réplicas.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge
  de travail NocoDB pour voir les pods, les révisions et les événements.
  Kubernetes Engine → Services et Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à
l'échelle et du type de charge de travail (Deployment vs StatefulSet).

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

NocoDB stocke toutes les données d'application (tables, vues, automatisations,
données de ligne) dans une instance Cloud SQL pour PostgreSQL 15 gérée. Les
pods l'atteignent via une connexion TCP IP privée. Lors du premier déploiement,
un job d'initialisation crée la base de données et l'utilisateur de
l'application ; NocoDB exécute ensuite ses propres migrations de schéma au
démarrage.

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
automatisées et la rotation des mots de passe, voir
[App_GKE](App_GKE.md).

### C. Cloud Storage — provisionné, non connecté aux pièces jointes {#c-cloud-storage--provisioned-not-wired-to-attachments}

La variable `storage_buckets` provisionne un bucket GCS (par défaut `name_suffix =
"data"`) et une
valeur `GCS_BUCKET_NAME` est injectée dans le conteneur en tant que variable
d'environnement. Cependant, le script d'entrée de `NocoDB_Common` ne lit jamais
`GCS_BUCKET_NAME` (ou `GCS_BASE_URL`, spécifique à GKE), et le nom du bucket injecté ne
correspond pas au nom d'un bucket réellement créé par la fondation. NocoDB ne
stocke donc **pas** automatiquement les pièces jointes dans Cloud Storage — les
fichiers téléchargés sont écrits sur le disque de pod local/éphémère et sont
perdus au redémarrage du pod. Pour persister les pièces jointes dans GCS,
configurez manuellement les propres paramètres de stockage compatible S3 de
NocoDB (via son interface d'administration ou `environment_variables`) pointant vers un
bucket auquel le compte de service de la charge de travail peut accéder.

- **Console :** Cloud Storage → Buckets → sélectionnez le bucket provisionné.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<bucket-name>/      # bucket name is in the Outputs
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et les options de
bucket supplémentaires.

### D. Cache Redis (facultatif) {#d-redis-cache-optional}

Redis prend en charge la couche de cache de NocoDB et, dans les déploiements
multi-réplicas, maintient la cohérence de l'état du cache entre les pods. Redis
est désactivé par défaut ; un `redis_host` doit être fourni lorsqu'il est activé.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager {#e-secret-manager}

Le secret JWT de NocoDB (`NC_AUTH_JWT_SECRET`) et le mot de passe de la base de données
sont stockés en tant que secrets Secret Manager et injectés dans les pods au
moment de l'exécution ; le texte en clair n'apparaît jamais dans la
configuration.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données se trouve dans les
[Sorties](#5-outputs). Voir [App_GKE](App_GKE.md) pour l'intégration et
la rotation de Secret Store CSI.

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

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et
les détails de l'IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les flux stdout/stderr des pods vers Cloud Logging ; les métriques GKE et Cloud
SQL vers Cloud Monitoring. Des tests de disponibilité facultatifs contre
`/api/v1/health` et des politiques d'alerte sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application NocoDB {#3-nocodb-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation (`db-init`) crée la base de données et l'utilisateur NocoDB
  avant le démarrage de l'application. Il est idempotent et peut être exécuté
  en toute sécurité.
- **Migrations auto-gérées.** NocoDB exécute ses propres migrations de schéma
  de base de données au premier démarrage — il n'est pas nécessaire de
  configurer des jobs de migration externes.
- **Secret JWT.** `NC_AUTH_JWT_SECRET` est généré automatiquement et stocké dans Secret
  Manager. Ne le faites pas pivoter après le premier déploiement ; toutes les
  sessions existantes et les jetons d'API sont immédiatement invalidés si le
  secret change.
- **Les téléchargements GCS ne sont pas automatiques.** Une variable
  d'environnement `GCS_BUCKET_NAME` est injectée, mais le script d'entrée ne la lit
  jamais et la valeur ne correspond à aucun bucket créé par la fondation. Les
  pièces jointes utilisent le disque de pod local/éphémère à moins que
  l'opérateur ne configure manuellement les propres paramètres de stockage
  compatible S3 de NocoDB.
- **Variables d'environnement NC_DB_*.** Le Dockerfile personnalisé dans
  `NocoDB_Common` mappe les variables de connexion standard `DB_*` (injectées par
  la fondation) aux noms `NC_DB_*` que NocoDB attend. Lorsque `container_image_source = "prebuilt"`, le
  mappage n'est pas appliqué — configurez manuellement les variables
  `NC_DB_*` via `environment_variables`.
- **Chemin de santé.** Les sondes de disponibilité (readiness) et de vivacité
  (liveness) ciblent `/api/v1/health`, qui renvoie HTTP 200 lorsque NocoDB est prêt à
  accepter les requêtes.
- **Sessions multi-réplicas.** Avec plus d'un pod et sans Redis, NocoDB ne peut
  pas partager l'état de la session ou du cache ; les utilisateurs peuvent être
  déconnectés lorsque les requêtes sont acheminées vers un pod différent.
  Activez Redis et définissez `redis_host` avant de passer à plus d'un réplica.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
NocoDB sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut
standard.

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
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources pour le suivi des coûts/de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `nocodb` | Nom de base pour les ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `NocoDB` | Nom convivial affiché dans la Console. |
| `application_description` | _(défini)_ | Annotation de description de la charge de travail. |
| `application_version` | `latest` | Balise de version de l'image NocoDB ; épingler à une version spécifique pour la production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_resources` | `{ cpu_limit = "1000m", memory_limit = "1Gi" }` | Limites de CPU et de mémoire pour le pod NocoDB ; minimum `1Gi` de mémoire. |
| `min_instance_count` | `1` | Réplicas minimum. Garder ≥ 1 pour éviter les retards de démarrage à froid. |
| `max_instance_count` | `10` | Réplicas maximum (plafond de l'autoscaler). |
| `container_port` | `8080` | NocoDB écoute sur le port 8080. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy (se connecte via IP privée, pas socket). |
| `enable_vertical_pod_autoscaling` | `false` | Laisser Autopilot ajuster automatiquement les demandes de ressources. |
| `container_image_source` | `custom` | `custom` builds via Cloud Build avec mappage NC_DB_* ; `prebuilt` déploie une image existante. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets injectés dans le conteneur. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager pour les secrets supplémentaires. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service est exposé. |
| `session_affinity` | `ClientIP` | Routage persistant ; recommandé pour un comportement de session NocoDB cohérent. |
| `workload_type` | `null` | Se résout automatiquement en `Deployment` ; définissez `StatefulSet` uniquement si un stockage par pod est nécessaire. |
| `network_tags` | `["nfsserver"]` | Balises de nœud/pod ; `nfsserver` est requis si NFS est activé. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

Options StatefulSet (modèles de PVC, service sans tête, gestion des pods,
stratégie de mise à jour, fsGroup) — voir [App_GKE](App_GKE.md). Normalement
non nécessaires pour NocoDB, qui stocke l'état dans PostgreSQL et GCS.

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Plafonner les comptes de CPU/mémoire/objets de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doit utiliser des unités binaires (`4Gi`, `8192Mi`)** — les entiers bruts sont lus comme des octets et bloquent toute planification. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protéger la disponibilité pendant les mises à niveau de nœuds. |
| `pdb_min_available` | `1` | Nombre minimum de pods disponibles pendant les interruptions volontaires. |
| `enable_topology_spread` | `false` | Répartir les pods sur plusieurs zones. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` / `startup_probe` | `/api/v1/health` | Sonde HTTP, délai initial de 30 s, 30 échecs autorisés. |
| `health_check_config` / `liveness_probe` | `/api/v1/health` | Sonde de vivacité HTTP. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring facultatif contre `/api/v1/health`. |
| `alert_policies` | `[]` | Politiques d'alerte métrique facultatives. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | CronJobs Kubernetes récurrents (par exemple, tâches de synchronisation de données personnalisées). |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard App_GKE Cloud Build / Cloud Deploy — voir
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS n'est pas requis pour NocoDB. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage si NFS est activé. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner les buckets GCS définis dans `storage_buckets`. Non connecté aux pièces jointes NocoDB — voir §2C. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets GCS à provisionner. |
| `gcs_volumes` | `[]` | Montages GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Activer Redis. Requis lors de l'exécution de plus d'un réplica. |
| `redis_host` | `""` | Hôte Redis. Requis lorsque `enable_redis = true`. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES` | PostgreSQL par défaut ; `MYSQL_8_0` également pris en charge. Définir avant le premier déploiement. |
| `application_database_name` | `nocodb` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `nocodb` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption. |
| `enable_postgres_extensions` / `postgres_extensions` | `false` / `[]` | Extensions PostgreSQL facultatives à installer. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter à 30–90 pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécuter du SQL à partir d'un bucket GCS après le
provisionnement. Voir [App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner Ingress pour les noms d'hôte personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google devant NocoDB. Recommandé pour les espaces de travail internes. |
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
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode de simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen
le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Mappage des ClusterIP pour les services spécifiques à l'étape (Cloud Deploy). |
| `service_external_ip` | IP externe de l'équilibreur de charge (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre NocoDB. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (IP privée) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'importation (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `NC_AUTH_JWT_SECRET` | auto-généré (immuable) | Critique | La rotation après le premier déploiement invalide immédiatement toutes les sessions et tous les jetons d'API. |
| `application_database_name` / `_user` | défini une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit les données. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activation sans fichier de sauvegarde valide fait échouer le job d'importation. |
| `quota_memory_requests` / `_limits` | unités binaires | Critique | Les entiers bruts sont des octets et bloquent toute planification. |
| `container_resources.memory_limit` | `1Gi` | Élevé | Le processus Node.js de NocoDB est tué par manque de mémoire en dessous de 512 Mo ; les charges de travail de production avec de nombreuses automatisations nécessitent 2 Go. |
| `enable_redis` | `true` si >1 réplica | Élevé | Plusieurs pods sans Redis entraînent l'invalidation de session lorsque les requêtes sont acheminées vers différents pods. |
| `redis_host` | explicite lorsque Redis est activé | Élevé | Un hôte manquant entraîne l'échec de toutes les connexions Redis au démarrage du pod. |
| `min_instance_count` | `1` | Élevé | `0` permet des démarrages à froid pendant lesquels les rappels de webhook expirent et sont abandonnés. |
| `max_instance_count` | garder bas sans Redis | Moyen | L'augmentation au-dessus de `1` sans Redis entraîne l'invalidation de session. |
| `enable_iap` / `enable_cloud_armor` | activer pour interne | Moyen | NocoDB est autrement publiquement accessible depuis l'adresse IP de l'équilibreur de charge. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |
| `pdb_min_available` vs `min_instance_count` | laisser de la marge | Moyen | `1`/`1` peut bloquer les mises à niveau de nœuds (un seul pod ne peut pas être expulsé). |
| `application_version` | épingler à une balise spécifique | Moyen | `latest` déclenche des mises à niveau incontrôlées à chaque reconstruction de conteneur. |

---

Pour le comportement de la fondation référencé partout — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à NocoDB partagée avec la
variante Cloud Run est décrite dans **[NocoDB_Common](NocoDB_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : NocoDB sur GKE Autopilot](../labs/NocoDB_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [NocoDB sur Google Cloud Run](NocoDB_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [NocoDB Common — Configuration d'application partagée](NocoDB_Common.md) — la configuration partagée par les deux cibles de déploiement.
