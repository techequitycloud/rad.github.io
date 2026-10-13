---
title: "Matomo sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Matomo sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Matomo_GKE.md @ e69407af sha256:ea24824f63df -->

# Matomo sur GKE Autopilot {#matomo-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Matomo_GKE.png" alt="Matomo sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Matomo est la principale plateforme d'analyse web open source et une
alternative auto-hébergée à Google Analytics, axée sur la confidentialité —
pas d'échantillonnage de données, suivi compatible GDPR/CCPA, cartes de chaleur,
enregistrements de session, tests A/B et analyse d'entonnoir, avec 100 % de
propriété des données collectées. Ce module déploie Matomo sur **GKE Autopilot**
en s'appuyant sur le socle [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Matomo et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et
la ligne de commande. Pour les mécanismes communs à toutes les applications GKE
— Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et le cycle de vie du
déploiement — reportez-vous au [guide du socle App_GKE](App_GKE.md) plutôt que
de les répéter ici.

---

## Ce que coûte Matomo sur RAD, et comment cela se compare {#what-matomo-costs-on-rad-and-how-that-compares}

**Le module Matomo sur GKE Autopilot de RAD coûte environ 110 $ US par mois dans votre propre projet, sans frais par page vue.** RAD facture 110 crédits une fois par déploiement dans votre propre projet (99 crédits, 10 % de moins, dans un projet géré par RAD), plus le temps de build. La même application se déploie également sur Cloud Run pour environ 84 $ US par mois — voir le [guide Cloud Run](Matomo_CloudRun.md) pour l'option la moins chère. Si vous n'en avez besoin qu'occasionnellement, un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour quelques crédits, de sorte que ce chiffre mensuel devient quelques dollars au lieu de 110 $ US — voir **Mettre en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 110 crédits (11,00 $ US au prix de la recharge) | 99 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **110 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **99 crédits par jour**, soit environ 2 970 par mois (environ 297,00 $ US au prix de la recharge, moins avec un abonnement) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge unique, et moins avec un abonnement mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Pod GKE Autopilot, 1x vCPU / 2 Gio | 40 $ US |
| Cloud SQL pour MySQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ US si c'est votre seul cluster, sinon ~73 $ US |
| **Total** | **environ 110 $ US** |

### Comment cela se compare {#how-it-compares}

- Le "Matomo Cloud" hébergé par Matomo propose des plans payants, mais son prix
  dépend d'un sélecteur de niveau de trafic sans chiffre fixe publié, de sorte
  qu'aucun chiffre unique ne peut être cité de manière fiable ici — vérifiez
  [matomo.org/pricing](https://matomo.org/pricing) pour votre propre volume de
  trafic avant de comparer.
- **Google Analytics est gratuit**, ce qui est la véritable alternative à
  partir de laquelle la plupart des sites commencent. Le module Matomo de RAD
  coûte environ 110 $ US par mois dans votre propre projet, et la raison de le
  payer n'est pas le prix — c'est la possession à 100 % de vos données de
  visiteurs, sans échantillonnage et sans données partagées avec Google, ce qui
  est important pour les sites sensibles au GDPR/CCPA.
- Comparaison auto-gérée : avec 1 vCPU / 2 Gio et une base de données MySQL,
  un droplet Hetzner CPX22 ou DigitalOcean 2 vCPU/4 Go (~24 $ US/mois) est
  dans la fourchette, plus vous exécutez MySQL, les sauvegardes et les mises à
  niveau vous-même.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Matomo s'exécute dans **un projet géré par RAD pour vous**, vous avez une
deuxième option qui va bien au-delà de la mise à l'échelle à zéro : **supprimer
tout le projet et le restaurer dans les 30 jours pour presque rien.** Cela
convient bien mieux à Matomo dont vous n'avez besoin qu'occasionnellement —
évaluation, environnement de démonstration, charge de travail saisonnière ou
intermittente — que de le faire fonctionner en continu.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord
  sa facturation, puis demande à Google de supprimer le projet. Google ne
  supprime pas le projet immédiatement : il le conserve, récupérable, pendant
  30 jours. Comme la facturation est déjà déliée, rien n'est facturé pendant
  cette attente. Contrairement à la suppression d'un module, cela ne détruit
  pas la base de données, une VM ou la ressource de calcul une par une — tout
  le projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte quelques crédits, pas une reconstruction.** Dans les
  30 jours, le propriétaire du projet peut le restaurer. RAD demande à Google
  de restaurer le projet et de rattacher son compte de facturation, puis vous
  demande d'exécuter **Update** sur chaque déploiement pour confirmer que tout
  est revenu. Comme rien n'a été détruit individuellement, cette mise à jour
  trouve les mêmes ressources déjà présentes — c'est une vérification, pas une
  reconstruction, et une mise à jour ne facture plus les frais de module. Pour
  Matomo derrière Services_GCP (un cluster GKE, une petite VM NFS/cache, une
  base de données Mysql) et Project_GCP, cela représente environ **une poignée
  de crédits (moins de 1 $ US)** au total, contre environ 115 crédits (11,50 $
  US) que coûte un redéploiement complet.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars,
  pas 110 $ US.** Déployez Matomo, utilisez-le un certain temps, supprimez le
  projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez
  avec Update, et supprimez-le à nouveau lorsque vous avez terminé. Vous ne
  payez les frais de module qu'une seule fois, les builds, et le temps pendant
  lequel il a été réellement actif.
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet dont
  RAD ne gère que la facturation), et vous le restaurez vous-même dans les 30
  jours — après cela, Google le supprime définitivement. La restauration est
  admise comme la création d'un nouveau projet : votre solde de crédits achetés
  doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox
  qui convient à la plupart des utilisations d'évaluation). Google indique que
  la plupart des services sont de nouveau pleinement fonctionnels dans les 36
  heures suivant une restauration.
- **Une lacune réelle : les sauvegardes nocturnes ne survivent pas.** Les
  sauvegardes et autres fichiers générés sont écrits dans un bucket à
  l'intérieur du projet, et ce bucket n'est **pas** protégé par la
  suppression logicielle de Cloud Storage, il est donc très probable qu'il
  disparaisse dès que vous supprimez le projet — même si le projet lui-même
  est récupérable pendant 30 jours. Si vous avez personnalisé Matomo et que
  vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google
  Drive ou un bucket en dehors du projet) avant de supprimer. Pour une
  installation par défaut sans rien d'irremplaçable, cela n'a pas
  d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre
propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter
de payer est de supprimer le déploiement et de le redéployer lorsque vous en
avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau, plus les
  builds — environ 115 crédits (11,50 $ US) au total. La suppression permet
  d'économiser de l'argent seulement si Matomo resterait inutilisé assez
  longtemps pour compenser ce coût de redéploiement par rapport à son propre
  coût d'exécution — environ **4 jours ou plus**, à la fois dans votre propre
  projet (environ 3,67 $ US par jour) et dans un projet géré par RAD (99
  crédits par jour).
- **La majeure partie du coût d'exécution est généralement partagée.** Pour
  Matomo, il s'agit de la base de données et de la VM de fichier/cache partagée.
  Ils ne s'arrêtent que si rien d'autre dans le projet ne les utilise, donc la
  suppression de cette application alors que quelque chose d'autre partage le
  projet n'économise que la partie calcul de cette application.
- **Conservez d'abord vos données.** Les sauvegardes nocturnes vont dans un
  bucket à l'intérieur du déploiement et sont supprimées avec lui, alors
  copiez la dernière sauvegarde avant de supprimer si vous voulez la
  conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour
  une classe. Chaque participant obtient l'application dans son propre projet
  Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation
  définie par le formateur. Soit le formateur finance toutes les places, soit
  chaque participant paie la sienne. Tout est supprimé à la fin de la session
  et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire
  exécute l'application pour un client à partir d'un portefeuille cloisonné
  qu'il finance, et règle directement avec le client. Si le portefeuille est
  faible, la facturation est suspendue et les données sont conservées, de sorte
  que personne ne reçoit de frais inattendus. À la fin, le partenaire remet le
  projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF,
NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud
Billing Catalog ; frais RAD et estimation des crédits quotidiens de
[radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et
restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour les mécanismes de pause/restauration et ce qu'il dit sur les objets Cloud
Storage sans suppression logicielle. Les prix changent ; vérifiez chaque source
avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Matomo s'exécute comme une seule charge de travail web PHP/Apache construite à
partir de l'image officielle pré-construite. Le déploiement relie un ensemble
ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods PHP/Apache (`matomo:<application_version>`) sur le port 80, 1 vCPU / 2 Gio par défaut |
| Base de données | Cloud SQL pour MySQL 8.0 | Obligatoire — le moteur est fixé à `MYSQL_8_0` |
| Persistance des fichiers | Cloud Filestore (NFS) | La racine de document de Matomo (`/var/www/html`) persiste ici, partagée entre les pods |
| Cache | Redis (co-hébergé sur VM NFS ou Memorystore) | Cache d'objets optionnel ; connectivité uniquement — voir [Section 6](#6-configuration-pitfalls--sensible-defaults) |
| Stockage d'objets | Cloud Storage | Un bucket `data` provisionné automatiquement |
| Secrets | Secret Manager | Mot de passe de l'utilisateur de l'application Cloud SQL auto-généré uniquement |
| Ingress | Cloud Load Balancing | LoadBalancer externe avec une IP statique réservée ; domaine personnalisé optionnel + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** Le moteur de base de données est fixé par la
  couche d'application partagée (`Matomo_Common` code en dur `database_type = "MYSQL_8_0"`) ;
  les autres moteurs ne sont pas pris en charge.
- **L'image officielle pré-construite est utilisée par défaut.** `container_image_source =
  "prebuilt"`
  déploie `matomo:<application_version>` (par défaut `5-apache`) directement — pas d'étape
  Cloud Build. L'image est mise en miroir dans Artifact Registry (`enable_image_mirroring = true`)
  pour éviter les limites de débit de Docker Hub.
- **Cloud SQL est atteint via le sidecar Auth Proxy sur loopback.** GKE injecte
  `enable_cloudsql_volume = true` par défaut ; un sidecar cloud-sql-proxy écoute sur
  `127.0.0.1:3306`, et la plateforme mappe les identifiants de base de données
  déployés sur `MATOMO_DATABASE_HOST`/`USERNAME`/`DBNAME`/`PASSWORD` — les
  variables d'environnement exactes que le plugin `EnvironmentVariables` de Matomo lit
  pour pré-remplir l'écran de base de données de l'installateur web.
- **NFS est activé par défaut** (`enable_nfs = true`, monté à `/var/www/html`),
  persistant la configuration de Matomo (`config.ini.php`), les plugins installés
  et les ressources générées. Le point d'entrée de l'image officielle peuple
  un volume vide à partir de `/usr/src/matomo` au premier démarrage.
- **Réplica unique par défaut.** `min_instance_count = 1`, `max_instance_count
  = 1`. `session_affinity = ClientIP`
  maintient les requêtes d'un client sur le même pod ; la charge de travail
  basée sur NFS se déploie avec la stratégie de mise à jour `Recreate` afin
  qu'une mise à jour glissante n'exécute jamais deux pods simultanément sur le
  même volume NFS et la même base de données partagée.
- **Aucun secret d'application n'est auto-généré.** Contrairement aux
  applications qui créent un mot de passe administrateur ou un secret de sel
  d'instance, le seul secret géré par Matomo est le mot de passe de
  l'utilisateur de l'application Cloud SQL. Le compte super-utilisateur Matomo
  est créé interactivement via l'installateur web lors de la première
  navigation — il n'y a pas de job d'initialisation qui le provisionne.
- **`db-init` crée uniquement la base de données vide + l'utilisateur ;
  l'installateur web fait le reste.** Il n'y a pas de job de migration de
  schéma sans interface graphique — l'assistant d'installation de Matomo,
  accessible à l'URL du service, crée le schéma et le premier compte
  administrateur.
- **La connectivité Redis est câblée mais non auto-consommée.** `enable_redis = true`
  par défaut injecte `REDIS_HOST`/`REDIS_PORT` dans le pod, mais rien dans
  ce module n'édite le backend `config.ini.php` `[Cache]` de Matomo —
  l'utilisation de Redis comme cache d'objets de Matomo nécessite toujours une
  configuration manuelle post-déploiement.
  {/* TODO: vérifier si l'image officielle de Matomo ou un plugin détecte
  automatiquement REDIS_HOST ; non confirmé par les sources de ce dépôt. */}

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region "$REGION" --project "$PROJECT"`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Matomo {#a-gke-autopilot--the-matomo-workload}

Les pods Matomo sont planifiés sur Autopilot, qui facture le CPU/la mémoire
réellement demandés par les pods. Comme la charge de travail est basée sur NFS,
le déploiement utilise la stratégie `Recreate` (une mise à jour glissante
exécuterait deux pods sur le même volume NFS et la même base de données
partagée et provoquerait un blocage).

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge
  de travail Matomo pour les pods, les révisions et les événements. Kubernetes
  Engine → Services et Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle
et du type de charge de travail (Deployment vs StatefulSet).

### B. Cloud SQL pour MySQL 8.0 {#b-cloud-sql-for-mysql-80}

Matomo stocke toutes les données analytiques (sites, visites, tables de logs,
rapports, utilisateurs) dans une instance gérée de Cloud SQL pour MySQL 8.0.
Les pods l'atteignent via le sidecar **Cloud SQL Auth Proxy** sur `127.0.0.1:3306` ;
aucune IP publique n'est exposée. Lors du premier déploiement, le job
`db-init` crée la base de données de l'application, l'utilisateur et les
autorisations ; l'installateur web de Matomo crée ensuite le schéma.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les drapeaux, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret Secret
Manager contenant le mot de passe se trouvent tous dans les
[Sorties](#5-outputs). Voir [App_GKE](App_GKE.md) pour le modèle de connexion,
les sauvegardes automatisées et la rotation des mots de passe.

### C. Cloud Storage et persistance des fichiers {#c-cloud-storage--file-persistence}

Un bucket **Cloud Storage** dédié (suffixe par défaut `data`) est
provisionné automatiquement et le compte de service de la charge de travail
reçoit l'accès. Séparément, la racine de document de Matomo se trouve sur
**NFS (Cloud Filestore)** à `/var/www/html`, partagée entre les pods — la
configuration, les plugins et les ressources de rapport générées persistent là
malgré les redémarrages de pods.

- **Console :** Cloud Storage → Buckets ; Filestore → Instances.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~-data"
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### D. Secret Manager {#d-secret-manager}

Le seul secret d'application que Matomo consomme est le mot de passe de
l'utilisateur de l'application Cloud SQL, généré et géré par le module de
secrets partagés du socle (aucun mot de passe administrateur ou secret de sel
spécifique à Matomo n'est créé). Sur GKE, les secrets sont projetés dans les
pods via le pilote CSI du Secret Store.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~matomo"
  gcloud secrets versions access latest --secret=<db-password-secret-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation du Secret Store CSI.

### E. Réseau et ingress {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe de Cloud Load
Balancing (`service_type = LoadBalancer`, `reserve_static_ip = true` afin que l'adresse
survive aux redéploiements). Un domaine personnalisé avec un certificat géré
par Google peut être activé.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails des IP statiques.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les
métriques GKE et Cloud SQL sont acheminées vers Cloud Monitoring. Des tests de
disponibilité et des politiques d'alerte optionnels sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Matomo {#3-matomo-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job
  `db-init` exécute un script utilisant `mysql:8.0-debian`. Il se connecte à
  Cloud SQL (via le socket du sidecar Auth Proxy, en se rabattant sur TCP
  contre l'IP privée), crée de manière idempotente la base de données et
  l'utilisateur de l'application, accorde les privilèges, vérifie que
  l'utilisateur de l'application peut se connecter, puis arrête proprement le
  sidecar proxy (`quitquitquit`, de sorte que le job se termine `0`
  et n'est pas relancé sous `restartPolicy: OnFailure`). Le job peut être réexécuté en
  toute sécurité (`execute_on_apply = true`, `max_retries = 3`).
- **Pas d'installation de schéma sans interface graphique.** Matomo n'exécute
  pas de job de migration au démarrage. La base de données vide créée par
  `db-init` est remplie par l'assistant d'installation de Matomo,
  accessible en naviguant vers l'URL du service — il parcourt la vérification
  du système, la connexion à la base de données (pré-remplie à partir de
  `MATOMO_DATABASE_*`) et la création du premier compte super-utilisateur.
- **Les variables d'environnement de la base de données pré-remplissent, mais
  ne complètent pas automatiquement, l'installateur.** La plateforme injecte
  `MATOMO_DATABASE_HOST` (`127.0.0.1` via le sidecar proxy), `MATOMO_DATABASE_USERNAME`,
  `MATOMO_DATABASE_DBNAME` et `MATOMO_DATABASE_PASSWORD` — lus par le plugin `EnvironmentVariables` de
  Matomo pour pré-remplir l'écran de connexion à la base de données de
  l'installateur. Vous devez toujours parcourir l'installateur pour terminer la
  configuration et créer le compte administrateur.
- **Le préfixe de table et l'adaptateur sont fixes.** `MATOMO_DATABASE_ADAPTER=mysql` et
  `MATOMO_DATABASE_TABLES_PREFIX=matomo_` sont définis par `Matomo_Common` et ne sont pas exposés
  comme variables de module.
- **Les déploiements basés sur NFS utilisent `Recreate`.** Les mises à jour
  terminent l'ancien pod avant de démarrer le nouveau, évitant ainsi que deux
  pods ne se bloquent sur le volume NFS partagé et les verrous de base de
  données.
- **Sondes de santé.** La sonde de démarrage est **TCP** sur `/`
  avec un délai initial généreux de 30 s, une période de 15 s et un seuil
  d'échec de 40 tentatives (~10,5 min au total) — donnant au point d'entrée de
  l'image le temps de peupler la racine de document montée sur NFS à partir de
  `/usr/src/matomo` et d'atteindre la base de données au premier démarrage. Le
  seuil a été relevé de 20 (~5,5 min) après un mode de défaillance confirmé :
  l'extraction n'est pas toujours terminée en 5,5 minutes sur la racine de
  document montée sur NFS, et un SIGKILL de sonde de démarrage en cours
  d'extraction laisse une arborescence partiellement copiée, appartenant à
  root, qui ne se répare pas au redémarrage (voir Pièges de configuration). La
  sonde de vivacité est **HTTP** `GET /` avec un délai initial de 300 s
  (200/302 vers l'installateur compte comme sain).
- **Inspecter le job d'initialisation et la configuration en cours :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep MATOMO_DATABASE
  ```
- **Contrainte de mise à l'échelle.** Conserver `max_instance_count = 1` à moins que le
  comportement de verrouillage de session/NFS multi-pod n'ait été vérifié —
  Matomo ne coordonne pas nativement l'archivage/l'écriture des logs de suivi
  entre les réplicas partageant un volume NFS et une base de données.
- **Le cron/archivage n'est pas câblé.** Ce module ne provisionne pas de
  CronJob pour le traitement périodique des archives de Matomo (`console core:archive`)
  ; si un pré-traitement de rapport planifié est requis, ajoutez-en un via la
  variable générique `cron_jobs` (Groupe 11) pointant vers l'image et la
  commande déployées.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Matomo sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut
standards.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `matomo` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `5-apache` | Tag de l'image officielle Matomo à déployer. Utilisez un tag de variante Apache (par exemple `5.11-apache`, `latest`). |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `prebuilt` | `prebuilt` déploie directement l'image officielle de Matomo ; `custom` construit via Cloud Build. |
| `container_port` | `80` | Matomo/Apache écoute sur le port 80. |
| `cpu_limit` | `1000m` | Limite de CPU pour le conteneur Matomo. |
| `memory_limit` | `2Gi` | Limite de mémoire ; Matomo avec les plugins courants nécessite généralement au moins 512 Mio. |
| `min_instance_count` | `1` | Maintenir à 1 pour que la charge de travail reste accessible. |
| `max_instance_count` | `1` | **Maintenir à 1** sauf si le comportement NFS/session multi-pod est vérifié. |
| `enable_cloudsql_volume` | `true` | Sidecar Auth Proxy (loopback) — requis sur GKE. |
| `php_memory_limit` | `512M` | PHP `memory_limit` ; doit être ≤ `memory_limit`. S'applique uniquement à un build d'image `custom`. |
| `upload_max_filesize` | `64M` | Taille maximale d'un seul téléchargement (par exemple, importation de fichier journal). Doit être ≤ `post_max_size`. |
| `post_max_size` | `64M` | Taille maximale du corps POST. Doit être ≥ `upload_max_filesize`. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | IP externe pour l'interface utilisateur de Matomo. |
| `workload_type` | `null` → `Deployment` | Déploiement (basé sur NFS, stratégie `Recreate`). |
| `session_affinity` | `ClientIP` | Routage persistant pour qu'un client atteigne le même pod. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP `/`, 30 s de délai, 15 s de période, 40 échecs (~10,5 min) | Remplacement spécifique à Matomo avec un seuil généreux pour le premier démarrage de la population NFS + connexion à la base de données. |
| `liveness_probe` | HTTP `/`, 300 s de délai, 60 s de période, 3 échecs | Confirme qu'Apache/PHP fonctionne (200/302 vers l'installateur compte comme sain). |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | NFS est activé par défaut afin que `config.ini.php`, les plugins et les ressources générées persistent et soient partagés. |
| `nfs_mount_path` | `/var/www/html` | Racine de document de Matomo ; le point d'entrée de l'image peuple un volume vide à partir de `/usr/src/matomo` au premier démarrage. |

### Groupe 15 — Redis {#group-15--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Injecte `REDIS_HOST`/`REDIS_PORT` dans le pod pour être utilisé comme cache d'objets de Matomo. Connectivité uniquement — voir [Section 6](#6-configuration-pitfalls--sensible-defaults). |
| `redis_host` | `""` | Laisser vide pour utiliser l'IP Redis co-hébergée du serveur NFS par défaut ; définir explicitement pour Memorystore. |
| `redis_port` | `6379` | Port Redis standard. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `null` → `MYSQL_8_0` (fixé par Matomo_Common) | Seul MySQL est pris en charge. |
| `application_database_name` | `matomo` | Nom de la base de données, injecté comme `MATOMO_DATABASE_DBNAME`. Immuable après le premier déploiement. |
| `application_database_user` | `matomo` | Utilisateur de la base de données de l'application, injecté comme `MATOMO_DATABASE_USERNAME` ; mot de passe auto-généré dans Secret Manager. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `reserve_static_ip` | `true` | IP externe stable malgré les redéploiements. |
| `application_domains` | `[]` | Noms d'hôte personnalisés + certificat géré. |

Toutes les autres entrées suivent le comportement standard de [App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen
le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Carte des ClusterIP pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Matomo. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
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

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration au moteur du socle [App_GKE](App_GKE.md), qui valide les
> valeurs *et les combinaisons* au moment de la planification — un
> `StatefulSet` forcé à côté d'un paramètre sans état, IAP sans identités
> autorisées, `quota_memory_*` donné comme des entiers bruts, un
> `container_port`/`backup_retention_days` hors de portée. Une configuration
> invalide échoue à la **planification** avec une erreur claire et nommée
> avant la création de toute ressource, de sorte que la plupart des erreurs
> ci-dessous sont détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `null` (→ `MYSQL_8_0`) | Critique | Matomo nécessite MySQL/MariaDB ; le moteur ne peut pas être changé en Postgres. |
| `application_database_name` / `application_database_user` | Défini une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et orpheline toutes les données analytiques. |
| `enable_nfs` | `true` | Élevé | Le désactiver rend `config.ini.php`, les plugins installés et les ressources générées éphémères — perdus lors de la recréation du pod, ce qui casse le site après le premier redémarrage. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy sur `127.0.0.1:3306` est requis pour la connectivité à la base de données sur GKE. |
| `max_instance_count` | `1` | Élevé | La mise à l'échelle au-delà de 1 sans comportement de stockage/session partagé vérifié risque des sessions fractionnées et des conflits de verrouillage NFS/DB pendant le traitement des archives. |
| `session_affinity` | `ClientIP` | Élevé | Sans persistance, les requêtes rebondissent entre les pods et perturbent la session de l'interface utilisateur d'administration. |
| `container_port` | `80` | Critique | Matomo/Apache sert sur le port 80 ; une non-concordance fait échouer toutes les sondes de vivacité/démarrage et le déploiement ne devient jamais Prêt. |
| `memory_limit` | `2Gi` | Élevé | En dessous d'environ 512 Mio, le pod PHP/Apache manque de mémoire sous charge, surtout pendant la génération d'archives/rapports. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont traités comme des octets et bloquent toute planification de pod dans l'espace de noms. |
| `enable_redis` | `true`, avec un backend de cache réel configuré après le déploiement | Moyen | Les variables d'environnement seules ne configurent pas le backend `[Cache]` de Matomo — laisser Redis "activé" sans service accessible (par exemple, `redis_host` vide et pas de Redis co-hébergé) peut faire apparaître des erreurs de connexion sans réel avantage de mise en cache. |
| `reserve_static_ip` | `true` | Moyen | Sans cela, l'IP externe peut changer lors des redéploiements, ce qui rompt le DNS et toutes les URL de suivi mises en signet/intégrées. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité des sauvegardes analytiques historiques. |
| `startup_probe.failure_threshold` | `40` (~10,5 min) | Critique | Le point d'entrée de l'image `tar`-remplit la racine de document montée sur NFS à partir de `/usr/src/matomo` en tant que root, `chown -R` uniquement après la fin de l'extraction ; un seuil trop strict SIGKILL le conteneur en cours de copie, laissant une racine de document corrompue en permanence, partiellement appartenant à root (erreurs "non installé" de composer/vendor) qui ne se répare **pas** au redémarrage — la récupération nécessite de vider manuellement `/var/www/html` sur le volume NFS et de laisser le point d'entrée le remplir à nouveau. |

---

Pour le comportement du socle référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Matomo
partagée avec la variante Cloud Run est décrite dans
**[Matomo_Common](Matomo_Common.md)**.

<!-- related-guides -->

## Guides connexes {#related-guides}

- [Lab pratique : Matomo sur GKE Autopilot](../labs/Matomo_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Matomo sur Google Cloud Run](Matomo_CloudRun.md) — la même application sur Cloud Run, pour quand vous avez besoin de l'autre cible de déploiement.
- [Matomo Common — Configuration d'application partagée](Matomo_Common.md) — la configuration partagée par les deux cibles de déploiement.
