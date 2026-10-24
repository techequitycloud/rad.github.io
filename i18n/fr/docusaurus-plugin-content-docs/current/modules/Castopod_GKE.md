---
title: "Castopod sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Castopod sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Castopod_GKE.md @ 1665a43e sha256:9bad70d40136 -->

# Castopod sur GKE Autopilot {#castopod-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Castopod_GKE.png" alt="Castopod sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Castopod est une plateforme d'hébergement de podcasts open source, native
d'ActivityPub, construite sur CodeIgniter 4 (PHP 8) et servie par FrankenPHP/Caddy.
Ce module déploie Castopod sur **GKE Autopilot** au-dessus de la fondation
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée de Google
Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Castopod et sur la façon
de les explorer et de les opérer depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications GKE — Workload
Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, sauvegardes et cycle de vie du déploiement —
référez-vous au [guide de la fondation App_GKE](App_GKE.md) plutôt que de les
répéter ici.

---

## Ce que coûte Castopod sur RAD, et comment cela se compare {#what-castopod-costs-on-rad-and-how-that-compares}

**Le module Castopod sur GKE Autopilot de RAD coûte environ 110 US$ par mois dans
votre propre projet Google Cloud, sans frais de licence supplémentaires** — Castopod
est open source. Dans un projet géré par RAD pour vous, le même déploiement est
facturé à **99 crédits par jour** (environ 2 970 par mois, soit environ 297 US$ au
prix de la recharge). Ou consultez le [guide Cloud Run](Castopod_CloudRun.md) pour
l'option moins chère. Si vous n'avez besoin de Castopod qu'occasionnellement —
études, démo, projet de courte durée — un projet géré par RAD peut être supprimé et
restauré dans les 30 jours pour quelques crédits, de sorte que ce chiffre mensuel
devient quelques dollars. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

Castopod est open source, il n'y a donc pas de frais de licence. Vous payez pour
trois choses :

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 110 crédits (11 US$ au prix de la recharge) | 99 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build (environ 3 à 6 crédits) | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **110 US$ par mois** pour la configuration par défaut (tableau ci-dessous) | Facturé à l'heure en crédits ; RAD publie **99 crédits par jour**, environ 2 970 par mois (environ 297 US$ au prix de la recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 US$ en recharge unique, et moins avec un abonnement mensuel.
Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau
sont partagés par toutes les applications du projet, de sorte qu'une deuxième
application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue
Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Pod GKE Autopilot, 1x vCPU / 2 Gio | 39,68 US$ |
| Cloud SQL pour MySQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 US$ |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 US$ |
| Cloud NAT et réseau | 5 US$ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 US$ |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 |
| **Total (hors frais de cluster GKE partagé)** | **environ 110 US$** |

Les prix de Cloud SQL et des pods Cloud Run/GKE sont les mêmes en africa-south1
(Johannesburg) ; la petite VM y coûte environ 10 % de plus.

- **GKE Autopilot ne se met pas à l'échelle zéro.** Au moins un pod est toujours en
  cours d'exécution, de sorte que le coût ci-dessus s'applique que l'application soit
  utilisée ou non ; des pods supplémentaires ne sont ajoutés qu'en cas de charge.

### Comment cela se compare, pour un podcast indépendant {#how-it-compares-for-an-independent-podcast}

L'équipe de Castopod vend son propre hébergement officiel sur castopod.com :

| Plan | Par mois | Stockage |
|---|---|---|
| Starter | 9,96 € (environ 11 US$) | 5 Go |
| Podcaster | 24 € (environ 26 US$) | plus de stockage et de bande passante |
| Réseau | 96 € (environ 104 US$) | jusqu'à 500 Go, plusieurs émissions |

(Les chiffres en USD sont une conversion approximative ; les plans sont facturés en
euros.) Les niveaux d'hébergement de Castopod sont basés sur le stockage et la bande
passante plutôt que sur la taille de calcul, ce n'est donc pas une comparaison
directe avec le tableau ci-dessus — le module de RAD vous offre le même Castopod
open source sur une infrastructure facturée en fonction de l'utilisation réelle de
Google Cloud, plus Cloud SQL géré, Secret Manager et Cloud Monitoring.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Castopod s'exécute dans **un projet géré par RAD pour vous**, la suppression de
l'ensemble du projet — plutôt que la suppression de ce seul module — délie d'abord
sa facturation, puis demande à Google de supprimer le projet purement et simplement.
Google le conserve, récupérable, pendant 30 jours, et comme la facturation est déjà
déliée, rien n'est facturé pendant qu'il attend. Contrairement à la suppression d'un
seul module, cela ne détruit pas Cloud SQL, aucune VM ou la ressource de calcul une
par une : l'ensemble du projet s'arrête simplement.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **La restauration est une vérification, pas une reconstruction.** Dans les 30
  jours, le propriétaire du projet peut demander à Google de restaurer le projet et
  de rattacher son compte de facturation, puis d'exécuter **Mettre à jour** sur
  chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été
  détruit individuellement, cette mise à jour trouve les mêmes ressources déjà
  présentes, et une mise à jour ne facture jamais les frais de module à nouveau. Pour
  une chaîne typique de 2 à 3 déploiements, cela ne coûte qu'une poignée de crédits
  au total (environ 5 à 10 crédits, moins de 1 US$).
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un projet
  dont RAD ne gère que la facturation), le restaurer vous-même dans les 30 jours —
  après quoi Google le supprime définitivement — et franchir à nouveau le seuil
  d'admission du niveau (100 crédits pour le niveau sandbox qui convient à la
  plupart des utilisations d'étude/démo). Google indique que la plupart des services
  fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.
- **Une lacune réelle : les sauvegardes nocturnes ne survivent pas.** Les
  sauvegardes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a la
  suppression logicielle de Cloud Storage désactivée, il est donc très probable
  qu'il disparaisse dès que le projet est supprimé — même si le projet lui-même est
  récupérable pendant 30 jours. Copiez une sauvegarde (vers Google Drive, ou un
  bucket en dehors du projet) avant de la supprimer s'il y a quelque chose à
  conserver ; pour une installation par défaut sans rien d'irremplaçable, cela n'a
  pas d'importance.

Source : [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects).

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que la fenêtre de restauration de 30 jours
ci-dessus est passée, la façon d'arrêter de payer est de supprimer le déploiement et
de le redéployer lorsque vous en avez besoin.

- **Ce que coûte un redéploiement.** Les frais de module à nouveau, plus les builds
  : environ 114 crédits (environ 11,40 US$) au prix de la recharge, et environ 15 à
  20 minutes de temps de build (moyenne de la propre plateforme de RAD). La
  suppression ne permet d'économiser de l'argent que si Castopod devait rester
  inutilisé pendant environ **2 jours ou plus** — dans votre propre projet, cela
  représente environ 3,67 US$ par jour, et dans un projet géré par RAD, c'est 99
  crédits par jour.
- La majeure partie du coût d'exécution ici est généralement la base de données
  et/ou la VM ou le cluster de fichiers/cache partagé. Ils ne s'arrêtent que si
  aucune autre application du projet ne les utilise, de sorte que la suppression de
  Castopod alors qu'une autre application partage le projet n'économise que la
  partie de calcul propre à Castopod.
- **Conservez d'abord les données.** Les sauvegardes nocturnes vont dans un bucket
  à l'intérieur du déploiement et sont supprimées avec lui, alors copiez la
  dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une
  classe. Chaque participant obtient l'application dans son propre projet Google
  Cloud pendant 15 minutes à 24 heures, dans la limite fixée par le formateur. Soit
  le formateur finance toutes les places, soit chaque participant paie la sienne.
  Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés
  au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute
  l'application pour un client à partir d'un portefeuille cloisonné qu'il finance,
  et règle directement avec le client. Si le portefeuille est faible, la facturation
  est suspendue et les données sont conservées, de sorte que personne ne reçoit de
  facture inattendue. À la fin, le partenaire transfère le projet et les
  déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN,
GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing
Catalog ; frais RAD et estimation des crédits quotidiens de
[radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer
des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour la fenêtre de pause/restauration et la mise en garde sur le bucket de
sauvegarde ; [Hébergement Castopod](https://castopod.com/) ; les prix changent,
vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Castopod s'exécute comme une seule charge de travail web FrankenPHP/Caddy. Le
déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods FrankenPHP/Caddy sur le port 8080, 1 vCPU / 2 Gio par défaut |
| Base de données | Cloud SQL pour MySQL 8.0 | Requis — le moteur est fixé à `MYSQL_8_0` ; Castopod ne prend pas en charge PostgreSQL |
| Persistance des fichiers | Cloud Filestore (NFS) | Les médias de podcast (audio, illustrations) persistent sur NFS monté dans le répertoire média de Castopod, `/var/www/html/public/media` |
| Stockage d'objets | Cloud Storage | Deux buckets sont provisionnés par défaut (suffixes `data` et `media`) — aucun n'est monté dans le pod sauf si `gcs_volumes` est configuré |
| Cache | Redis (optionnel) | Castopod utilise par défaut un cache de système de fichiers (`CP_CACHE_HANDLER = file`) ; Redis est optionnel |
| Secrets | Secret Manager | `CP_ANALYTICS_SALT` auto-généré ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing / Gateway API | LoadBalancer externe avec une IP statique réservée et HTTPS sans configuration via un nom d'hôte `<ip>.nip.io` auto-émis |

**Valeurs par défaut judicieuses à connaître à l'avance :**

- **MySQL 8.0 est obligatoire.** Le moteur de base de données est fixé par la couche
  d'application partagée (la variante passe `database_type = null`, qui conserve la valeur par
  défaut commune `MYSQL_8_0`) ; les autres moteurs ne sont pas pris en charge et
  cassent les migrations CodeIgniter.
- **Cloud SQL est atteint via le sidecar Auth Proxy sur loopback, mais l'application
  le compose via TCP.** `enable_cloudsql_volume = true` monte un sidecar cloud-sql-proxy
  écoutant sur `127.0.0.1:3306`, et le module Common code en dur `DB_HOST = 127.0.0.1`
  pour le conteneur de service. Parce que Castopod (CodeIgniter 4) lit sa connexion
  à la base de données à partir de clés `database.default.*` **en notation pointée** — qui ne
  peuvent pas être exprimées comme noms de variables d'environnement Cloud Run/K8s
  — le point d'entrée de la plateforme les écrit dans le fichier `.env` de
  Castopod au démarrage du conteneur plutôt que de les injecter comme variables
  d'environnement.
- **Deux réplicas de configuration existent pour les sondes de santé — un seul est
  efficace.** Les variables `startup_probe`/`liveness_probe` spécifiques à l'application
  Castopod (Groupe 10) l'emportent toujours ; les variables génériques
  `health_check_config`/`startup_probe_config` héritées d'App_GKE sont transmises mais
  structurellement remplacées par la propre configuration de sonde du module Common,
  elles n'ont donc aucun effet pour cette application.
- **Réplica unique par défaut.** `min_instance_count = 1`, `max_instance_count = 1`. La charge de
  travail basée sur NFS se déploie avec la stratégie `Recreate`, donc ne pas
  dépasser 1 sans vérifier le comportement de stockage partagé pour les
  téléchargements de médias et le cache d'objets.
- **NFS est activé par défaut** (`enable_nfs = true`, monté à `/var/www/html/public/media`) de sorte
  que l'audio et les illustrations des épisodes téléchargés persistent lors des
  redémarrages de pod et sont partagés entre les réplicas — Castopod stocke les
  médias sur le système de fichiers, pas dans la base de données.
- **L'affinité de session est `ClientIP`** de sorte que les requêtes d'un client
  atteignent le même pod.
- **HTTPS sans configuration est activé par défaut.** `enable_custom_domain = true` et
  `reserve_static_ip = true` sont tous deux des valeurs par défaut ; avec `application_domains` laissé
  vide, App_GKE provisionne une passerelle et dérive un nom d'hôte `<ip>.nip.io`
  gratuit avec un certificat géré par Google — aucune configuration DNS n'est
  requise pour atteindre Castopod via HTTPS.
- **`CP_ANALYTICS_SALT` est généré automatiquement** et stocké dans Secret Manager. Il
  anonymise les analyses d'écouteurs de podcast et doit rester stable après le
  premier démarrage.
- **Pas de job de migration séparé — mais les migrations ne sont pas non plus
  automatiques dans l'image de base.** L'image `castopod/castopod` (construite sur
  `serversideup/php`) n'a pas de hook de migration CodeIgniter propre ; son seul
  comportement de migration automatique intégré est spécifique à Laravel
  (`php artisan migrate`, protégé par `AUTORUN_ENABLED`, par défaut
  `false`). Le point d'entrée du wrapper de plateforme (`Castopod_Common/scripts/entrypoint.sh`)
  exécute explicitement `php spark migrate --all` à chaque démarrage de conteneur, de sorte que
  le schéma est créé au premier démarrage une fois que le job `db-init` a
  provisionné la base de données et l'utilisateur.
- **La configuration initiale est manuelle.** Après le déploiement, ouvrez l'URL du
  service et complétez l'assistant d'installation web de Castopod pour créer le
  premier compte super-administrateur et configurer les valeurs par défaut de
  l'instance/podcast.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté `gcloud container clusters get-credentials <cluster> --region <region> --project <project>` et que
`PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et
les autres identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Castopod {#a-gke-autopilot--the-castopod-workload}

Les pods Castopod sont planifiés sur Autopilot, qui facture le CPU/la mémoire
réellement demandés par les pods. Comme la charge de travail est basée sur NFS, le
déploiement utilise la stratégie `Recreate` (une mise à jour progressive
exécuterait deux pods sur le même répertoire média basé sur NFS et la base de
données partagée, et provoquerait un blocage).

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de
  travail Castopod pour les pods, les révisions et les événements. Kubernetes Engine
  → Services et Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE" --selector="app~castopod" 2>/dev/null || kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et
du type de charge de travail (Déploiement vs StatefulSet).

### B. Cloud SQL pour MySQL 8.0 {#b-cloud-sql-for-mysql-80}

Castopod stocke toutes les données d'application (podcasts, épisodes, utilisateurs,
analyses) dans une instance Cloud SQL gérée pour MySQL 8.0. Les pods l'atteignent
via le sidecar **Cloud SQL Auth Proxy** sur `127.0.0.1:3306` ; aucune IP publique
n'est exposée. Lors du premier déploiement, le job `db-init` crée la base de
données de l'application, l'utilisateur et les autorisations ; les migrations
CodeIgniter créent ensuite le schéma au premier démarrage du conteneur de
l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes,
  les drapeaux, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT" --filter="name~castopod"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret Secret Manager
contenant le mot de passe sont tous dans les [Sorties](#5-outputs). Voir
[App_GKE](App_GKE.md) pour le modèle de connexion, les sauvegardes automatisées et
la rotation des mots de passe.

### C. Cloud Storage et persistance des fichiers {#c-cloud-storage--file-persistence}

**Deux buckets Cloud Storage** sont provisionnés automatiquement par défaut — un
bucket générique `data` (la valeur par défaut de la fondation App_GKE) et
un bucket `media` spécifique à Castopod déclaré par `Castopod_Common`. Aucun
n'est monté dans le système de fichiers du pod sauf si `gcs_volumes` est
explicitement configuré ; au lieu de cela, le répertoire média réel de Castopod
(`/var/www/html/public/media`) est lui-même le montage **NFS (Cloud Filestore)**. Un nouveau
partage se monte vide, de sorte que le point d'entrée ré-initialise l'arborescence
média (`persons/`, `podcasts/`, `site/`) et la transmet à
`www-data` à chaque démarrage.

- **Console :** Cloud Storage → Buckets ; Filestore → Instances.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~castopod"
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### D. Redis (cache d'objets optionnel) {#d-redis-optional-object-cache}

Redis est **désactivé par défaut** — Castopod utilise un cache de système de
fichiers (`CP_CACHE_HANDLER = file`). Lorsque `enable_redis = true`, le module injecte
`REDIS_HOST`/`REDIS_PORT` pour le cache d'objets de Castopod ; si
`redis_host` est laissé vide, la fondation le résout à l'adresse IP de la VM du
serveur NFS (nécessite `enable_nfs = true`).

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée au lieu de
  Redis colocalisé avec NFS).
- **CLI :**
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -i redis
  ```

### E. Secret Manager {#e-secret-manager}

Un secret cryptographique est généré automatiquement et stocké dans Secret Manager
: `CP_ANALYTICS_SALT` (utilisé pour anonymiser les analyses d'écouteurs de podcast).
Le mot de passe de la base de données est géré séparément par la fondation. Sur
GKE, les secrets sont projetés dans les pods via le pilote CSI Secret Store.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~analytics-salt"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store CSI.

### F. Réseau et ingress {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe Cloud Load Balancing
(`service_type = LoadBalancer`, `reserve_static_ip = true`). Parce que `enable_custom_domain = true` par défaut,
App_GKE provisionne en outre une passerelle et — lorsque `application_domains` est laissé
vide — un nom d'hôte `<ip>.nip.io` sans configuration avec un certificat géré par
Google, de sorte que Castopod est immédiatement accessible via HTTPS sans posséder
de domaine. Un véritable domaine personnalisé peut être fourni à la place.

- **Console :** Services réseau → Équilibrage de charge / Passerelles ; Réseau VPC
  → Adresses IP.
- **CLI :**
  ```bash
  kubectl get svc,gateway,httproute -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails
de l'IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les flux stdout/stderr des pods vers Cloud Logging ; les métriques GKE et Cloud SQL
vers Cloud Monitoring. Des vérifications de disponibilité et des politiques
d'alerte optionnelles sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord /
  Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Castopod {#3-castopod-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job
  `db-init` exécute `db-init.sh` en utilisant `mysql:8.0-debian`. Il se
  connecte à Cloud SQL (socket Unix sous `/cloudsql` via le sidecar Auth Proxy,
  avec repli sur TCP IP privée), crée de manière idempotente la base de données de
  l'application, l'utilisateur et les autorisations, vérifie que l'utilisateur de
  l'application peut se connecter, puis arrête le sidecar proxy. Le job peut être
  réexécuté en toute sécurité (`execute_on_apply = true`, `max_retries = 3`).
- **Les migrations s'exécutent au démarrage du conteneur (pas de job de migration
  séparé) — via le point d'entrée de la plateforme, pas l'image de base.** L'image
  `castopod/castopod` (construite sur `serversideup/php`) n'a pas de hook de
  migration CodeIgniter propre ; son seul comportement de migration automatique est
  spécifique à Laravel (`php artisan migrate`, protégé par `AUTORUN_ENABLED`,
  par défaut `false`) et n'exécuterait pas `spark migrate` de CI4 même
  s'il était activé. Le point d'entrée du wrapper de plateforme (`Castopod_Common/scripts/entrypoint.sh`)
  exécute explicitement `php spark migrate --all` — idempotent, sûr à chaque démarrage — une
  fois que `.env`/la connectivité DB est écrite, de sorte que le schéma est
  créé au premier démarrage une fois que `db-init` a provisionné la base de
  données et l'utilisateur, et la mise à niveau de `application_version` applique les
  modifications de schéma au démarrage suivant, sans job séparé. Si cet appel
  explicite est jamais supprimé, chaque requête renvoie 500 avec `Table '...' doesn't exist` même
  si `db-init` a réussi — vérifiez `entrypoint.sh` en premier lors du
  débogage de ce symptôme.
- **La configuration de la base de données se trouve dans `.env`,
  matérialisée au démarrage du conteneur.** Castopod (CodeIgniter 4) lit sa
  connexion par défaut à partir de clés natives du framework, en notation pointée
  (`database.default.hostname|database|username|password|port|DBDriver|DBPrefix`) qui ne peuvent pas être exprimées comme noms de variables
  d'environnement Kubernetes. Le point d'entrée du wrapper de plateforme les écrit
  dans `.env` de Castopod à partir de `DB_HOST` injecté par la
  fondation (qui sur GKE est `127.0.0.1`, le sidecar Auth Proxy) et
  `DB_NAME`/`DB_USER`/`DB_PASSWORD`, puis délègue au point
  d'entrée amont FrankenPHP/Caddy.
- **`CP_BASEURL` est dérivé automatiquement.** Lorsqu'il n'est pas
  explicitement défini, le point d'entrée le dérive de `GKE_SERVICE_URL` injecté par
  la fondation et l'écrit comme `app.baseURL` dans `.env`, de sorte
  que les liens de flux de podcast et de médias reflètent l'adresse de service
  réelle (y compris le nom d'hôte nip.io auto-émis).
- **`CP_ANALYTICS_SALT` doit être stable après le premier démarrage.** Il est généré
  une fois et écrit dans Secret Manager ; le modifier rompt la continuité de la
  déduplication pour les analyses précédemment enregistrées, bien qu'il ne corrompe
  pas les lignes existantes.
- **Les déploiements basés sur NFS utilisent `Recreate`.** Les mises à jour
  terminent l'ancien pod avant de démarrer le nouveau, évitant que deux pods ne se
  bloquent sur le répertoire média partagé basé sur NFS et les verrous de base de
  données.
- **Chemin de santé.** La sonde de démarrage est **TCP** sur le port du conteneur
  avec un délai initial de 30 secondes et une fenêtre de 20 tentatives
  (`period_seconds = 15`), donnant aux migrations CodeIgniter du premier démarrage amplement
  le temps de se terminer. La sonde de vivacité est **HTTP `GET /`** avec un
  délai initial de 300 secondes (5 minutes) — la page d'accueil non authentifiée de
  Castopod renvoie 200 une fois démarrée et connectée à MySQL.
- **Configuration initiale.** Après le déploiement, ouvrez l'URL du service et
  complétez l'assistant d'installation web de Castopod pour créer le premier compte
  super-administrateur et définir le nom de l'instance et les valeurs par défaut du
  podcast. Les téléchargements de médias persistent ensuite dans le répertoire média
  basé sur NFS.
- **Inspectez le job d'initialisation et la configuration en cours d'exécution :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- cat /var/www/html/.env
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement (par leur balise `{{UIMeta group=N}}`, qui ne correspond pas toujours aux
titres de section du fichier source). Seuls les paramètres spécifiques ou notables
pour Castopod sont listés ; toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md)
avec leur comportement et leurs valeurs par défaut standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `castopod` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag d'image `castopod/castopod` utilisé comme base de build personnalisé ; `latest` est épinglé à un tag connu et valide (`1.15.5`) au moment du build via l'ARG de build `CASTOPOD_VERSION` spécifique à l'application. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` | `1000m` | 1 vCPU par instance de conteneur Castopod. |
| `memory_limit` | `2Gi` | Minimum ~512 Mio pour démarrer ; 2 Gio recommandés pour les grandes bibliothèques de médias. |
| `min_instance_count` | `1` | Maintenir à 1 pour que la charge de travail reste accessible. |
| `max_instance_count` | `1` | **Maintenir à 1** sauf si le comportement de partage NFS/cache est vérifié pour plusieurs pods. |
| `container_port` | `8080` | Le serveur FrankenPHP/Caddy de Castopod écoute sur le port 8080. |
| `enable_cloudsql_volume` | `true` | Sidecar Auth Proxy (loopback) — requis sur GKE. |
| `php_memory_limit` | `512M` | Limite de mémoire PHP ; augmenter pour les plugins gourmands en mémoire. |
| `upload_max_filesize` / `post_max_size` | `64M` | Taille maximale de téléchargement / POST ; conserver `post_max_size ≥ upload_max_filesize` pour les téléchargements audio d'épisodes. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | IP externe pour l'interface utilisateur de Castopod et les flux de podcast publics. |
| `workload_type` | `null` → `Deployment` | Déploiement (basé sur NFS, stratégie `Recreate`). |
| `session_affinity` | `ClientIP` | Routage persistant pour qu'un client atteigne le même pod. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP, délai de 30s, 20 tentatives | Sonde de démarrage effective — remplace la sonde générique `startup_probe_config`, qui est transmise mais remplacée et n'a aucun effet. |
| `liveness_probe` | HTTP `/`, délai de 300s | Sonde de vivacité effective contre la page d'accueil non authentifiée de Castopod — remplace la sonde générique `health_check_config`. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | NFS est activé par défaut afin que l'audio/les illustrations des épisodes téléchargés persistent et soient partagés. |
| `nfs_mount_path` | `/var/www/html/public/media` | Où l'état des médias partagés de Castopod est monté. |

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Bascule le cache d'objets de Castopod du système de fichiers vers Redis. |
| `redis_host` | `""` | Point d'accès Redis. Laisser vide pour utiliser l'IP du serveur NFS (nécessite `enable_nfs = true`). |
| `redis_port` | `6379` | Port Redis. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `null` → `MYSQL_8_0` | Conserve la valeur par défaut commune de MySQL 8.0 ; Castopod ne prend pas en charge d'autres moteurs. |
| `application_database_name` | `castopod` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `castopod` | Utilisateur de la base de données de l'application ; mot de passe auto-généré dans Secret Manager. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne une passerelle ; avec `application_domains` vide, génère un nom d'hôte HTTPS `<ip>.nip.io` sans configuration. |
| `application_domains` | `[]` | Définir pour utiliser un véritable nom d'hôte personnalisé + certificat géré au lieu du repli nip.io. |
| `reserve_static_ip` | `true` | IP externe stable entre les redéploiements — requise pour que le nom d'hôte nip.io reste constant. |

Toutes les autres entrées suivent le comportement standard d'[App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le
plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Carte des ClusterIPs pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Castopod. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom de la base de données de l'application / utilisateur. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point d'accès DB (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (`data` et `media`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration (`db-init`) et d'importation (optionnel). |
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

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service
> dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration au moteur de fondation [App_GKE](App_GKE.md), qui valide les valeurs
> *et les combinaisons* au moment de la planification — un `StatefulSet` forcé
> à côté d'un paramètre sans état, IAP sans identités autorisées, `quota_memory_*`
> donné comme des entiers bruts, un `container_port`/`backup_retention_days` hors de
> portée. Une configuration invalide échoue la **planification** avec une erreur
> claire et nommée avant la création de toute ressource, de sorte que la plupart des
> erreurs ci-dessous sont détectées en amont plutôt qu'au moment de l'application ou
> de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `null` (→ `MYSQL_8_0`) | Critique | La sélection d'un moteur non-MySQL rompt les migrations CodeIgniter et toutes les routes basées sur la base de données. |
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données de podcast. |
| `enable_nfs` | `true` | Critique | Avec NFS désactivé, l'audio et les illustrations des épisodes téléchargés résident sur un disque éphémère et sont perdus à chaque redémarrage/redéploiement du pod. |
| `CP_ANALYTICS_SALT` (auto-généré) | Ne jamais changer | Élevé | Le modifier après le premier démarrage rompt la continuité de la déduplication des écouteurs pour les analyses précédemment enregistrées. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy sur `127.0.0.1:3306` est requis pour la connectivité DB sur GKE. |
| `max_instance_count` | `1` | Élevé | La mise à l'échelle au-delà de 1 sans comportement de stockage/cache partagé vérifié risque un état média incohérent et des analyses dupliquées. |
| `session_affinity` | `ClientIP` | Élevé | Sans persistance, les requêtes rebondissent entre les pods et perturbent les sessions d'administration authentifiées. |
| `memory_limit` | `2Gi` | Élevé | En dessous de ~512 Mio, le pod PHP/FrankenPHP ne démarre pas ; les grandes bibliothèques de médias nécessitent plus de marge. |
| `quota_memory_requests` / `_limits` | Unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont traités comme des octets et bloquent toute planification de pod dans l'espace de noms. |
| `reserve_static_ip` | `true` | Moyen | Sans cela, l'IP externe et tout nom d'hôte nip.io auto-dérivé peuvent changer lors des redéploiements, rompant les URL de flux RSS/mis en signet. |
| `enable_custom_domain` + `application_domains` vide | Bien par défaut (nip.io) | Faible | Produit une URL `<ip>.nip.io` fonctionnelle mais non marquée ; définissez `application_domains` pour un véritable nom d'hôte. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Castopod
partagée avec la variante Cloud Run est décrite dans
**[Castopod_Common](Castopod_Common.md)**.

<!-- related-guides -->

## Guides associées {#related-guides}

- [Lab pratique : Castopod sur GKE Autopilot](../labs/Castopod_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Castopod sur Google Cloud Run](Castopod_CloudRun.md) — la même application sur Cloud Run, pour quand vous avez besoin de l'autre cible de déploiement.
- [Castopod Common — Configuration d'application partagée](Castopod_Common.md) — la configuration partagée par les deux cibles de déploiement.
