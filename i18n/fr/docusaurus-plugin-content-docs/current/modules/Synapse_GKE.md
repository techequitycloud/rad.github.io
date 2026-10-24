---
title: "Synapse sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Synapse sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Synapse_GKE.md @ e69407af sha256:4f55b3ce517d -->

# Synapse sur GKE Autopilot {#synapse-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Synapse_GKE.png" alt="Synapse sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Synapse est le homeserver [Matrix](https://matrix.org/) de référence — le serveur Python open source sous licence Apache 2.0 pour le protocole Matrix, un standard ouvert pour la communication décentralisée et fédérée en temps réel (chat sécurisé et VoIP). Ce module déploie Synapse sur **GKE Autopilot** au-dessus du socle [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée Google Cloud et Kubernetes. Les utilisateurs se connectent au homeserver avec un client Matrix tel que l'application web [Element](https://element.io/).

Ce guide se concentre sur les services cloud utilisés par Synapse et sur la manière de les explorer et de les opérer depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à chaque application GKE — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au [guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## Ce que coûte Synapse sur RAD, et comment cela se compare {#what-synapse-costs-on-rad-and-how-that-compares}

**Le module GKE Autopilot de Synapse sur RAD coûte environ 149,81 $ US par mois dans un projet Google Cloud que vous possédez, avec des frais de module uniques de 175 crédits (17,50 $ US, ou 157,5 crédits dans un projet géré par RAD, soit 10 % de moins).** C'est la moins chère des deux façons d'exécuter Synapse sur RAD — le [module Cloud Run](Synapse_CloudRun.md) exécute le même homeserver pour environ 180,87 $ US par mois, maintenu toujours actif avec des frais de module proportionnellement plus élevés. GKE en vaut la peine ici car un homeserver de chat fédéré doit rester joignable en permanence, et les pods Autopilot le font moins cher qu'une instance Cloud Run toujours active. Si vous n'avez besoin d'un homeserver qu'occasionnellement — une communauté éphémère, une fédération de test — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits (moins de 1 $ US) au lieu de payer pour qu'il reste inactif. Voir **Mettez-le en pause gratuitement**, ci-dessous. Les chiffres sont ceux du 8 octobre 2026 ; les sources sont listées à la fin de cette section.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 175 crédits (17,50 $ US au prix de la recharge) | 157,5 crédits (10 % de moins) |
| Temps de build | Environ 3-6 crédits par build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **149,81 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **111 crédits par jour**, soit environ 3 330 par mois |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est détenu en réserve |

10 crédits coûtent 1 $ US pour une recharge ponctuelle, et moins avec un abonnement mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par chaque application du projet, de sorte qu'une deuxième application n'ajoute pas un deuxième ensemble de ces éléments.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Pod GKE Autopilot, 2x vCPU / 4 Gio | 79,35 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5,00 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ US |
| Frais de gestion de cluster GKE | partagés entre chaque application GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 |
| **Total** | **149,81 $ US** |

### Comment cela se compare {#how-it-compares}

- L'offre hébergée d'Element pour Matrix (Element Server Suite) ne publie pas de prix — les paliers Enterprise et Sovereign sont sur devis uniquement — donc aucun chiffre vérifié n'est nommé ici.
- Une comparaison autogérée, dimensionnée pour un serveur de chat fédéré toujours joignable : un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) coûte environ 49 $/mois, tandis qu'une machine 2 vCPU/4 Go de Hetzner ou DigitalOcean coûte environ 24 $/mois — avant d'ajouter une base de données gérée, des sauvegardes, TLS et le travail continu de maintien d'un service orienté fédération patché et surveillé 24h/24, ce que Cloud SQL, Secret Manager et la surveillance de RAD couvrent pour vous.
- Synapse est l'un des modules les plus lourds de cette famille car il doit rester joignable en permanence pour la fédération ; les pods GKE Autopilot gèrent cela moins cher ici que la variante Cloud Run toujours active, ce qui est la raison pour laquelle ce guide coûte moins cher que son homologue.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Synapse s'exécute dans un projet géré par RAD pour vous, la suppression de l'ensemble du projet délie d'abord sa facturation, puis demande à Google de supprimer le projet purement et simplement — la suppression logicielle récupérable de 30 jours de Google. Contrairement à la suppression d'un module, cela ne supprime pas Cloud SQL, la VM NFS ou la ressource de calcul une par une : l'ensemble du projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de restaurer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter **Update** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits (moins de 1 $ US) au total pour une chaîne typique de 2-3 déploiements.

Ce qu'il faut : vous devez posséder le projet (pas un projet dont RAD ne gère que la facturation), vous devez le restaurer vous-même dans les 30 jours — après quoi Google le supprime définitivement — et la restauration est admise comme la création d'un nouveau projet, donc votre solde de crédits achetés doit toujours dépasser le seuil du palier (100 crédits pour le palier sandbox qui convient à la plupart des utilisations d'étude/démo). Google indique que la plupart des services sont de nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vos salons et votre historique de messages sont importants pour vous, copiez une sauvegarde (vers Google Drive, ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois la fenêtre de restauration de 30 jours passée, l'alternative est de supprimer Synapse purement et simplement et de le redéployer plus tard. Un redéploiement coûte à nouveau les frais de module, plus les builds — environ 180 crédits (environ 18 $ US) dans votre propre projet, ou 162,5 crédits dans un projet géré par RAD.

La suppression ne permet d'économiser de l'argent que si Synapse resterait inutilisé assez longtemps pour compenser ce coût de redéploiement par rapport à son propre coût d'exécution quotidien — par rapport au total du projet ci-dessus (environ 4,99 $ US par jour), cela représente environ 4 jours ou plus, ou environ 2 jours ou plus dans un projet géré par RAD (111 crédits par jour). La majeure partie du coût d'exécution ici est le pod GKE, la base de données et le serveur de fichiers NFS ; ils ne s'arrêtent que si rien d'autre dans le projet ne les utilise, donc la suppression de Synapse alors que quelque chose d'autre partage le projet n'économise que la partie calcul de cette application.

Conservez d'abord les données : les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui, alors copiez la dernière sauvegarde avant de supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour une classe. Chaque participant obtient l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil :** un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, afin que personne ne reçoive de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les propres frais de RAD et les estimations de crédits quotidiens ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les mécanismes de pause/restauration. La page de tarification d'Element Server Suite liste les paliers mais pas de chiffres publiés, donc aucun prix concurrent n'est nommé.

## 1. Vue d'ensemble {#1-overview}

Synapse s'exécute comme une charge de travail web Python. Le déploiement connecte un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods Python, 2 vCPU / 4 Gio par défaut, au moins 1 réplica |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — Synapse ne prend pas en charge MySQL ; la base de données **doit** utiliser la collation `C` |
| Stockage d'objets | Cloud Storage | Un bucket de données dédié provisionné automatiquement |
| Fichiers persistants | NFS (Filestore) | Clé de signature + dépôt de médias sous le répertoire de données ; activé par défaut |
| Secrets | Secret Manager | Secret partagé d'enregistrement auto-généré ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing | LoadBalancer externe, nom de domaine personnalisé facultatif + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire, avec la collation `C`.** Le moteur est fixé par la couche d'application partagée, et le job `db-init` du premier déploiement crée la base de données avec `LC_COLLATE='C' LC_CTYPE='C'` — Synapse refuse de démarrer avec toute autre collation.
- **Synapse gère son schéma lui-même.** Il n'y a pas de job de migration séparé ; Synapse crée et met à jour son propre schéma automatiquement à chaque démarrage.
- **`homeserver.yaml` et la clé de signature sont générés au premier démarrage.** Le point d'entrée cloud génère la configuration ainsi qu'une clé de signature persistante dans le répertoire de données et connecte la plateforme PostgreSQL avant de démarrer Synapse.
- **La clé de signature doit persister.** La régénérer rompt la fédération et invalide toutes les sessions d'appareil, de sorte que le répertoire de données est sauvegardé par un stockage NFS persistant (`enable_nfs = true` par défaut). Pour une durabilité par pod, un PVC StatefulSet peut être utilisé.
- **`server_name` est fixé à `matrix.local`.** C'est le domaine dans chaque ID utilisateur (`@user:server_name`) et dans la fédération. `Synapse_GKE` n'expose pas d'entrée `server_name` — la valeur provient toujours de la valeur par défaut de `Synapse_Common`, donc un déploiement de production nécessitant un vrai domaine nécessite actuellement de surcharger directement le module Common. Il est immuable après le premier démarrage.
- **Le port du conteneur et toutes les sondes doivent être 8008.** L'écouteur client + fédération de Synapse est défini sur `8008` dans la configuration générée ; le port du conteneur et les sondes de démarrage/vivacité/disponibilité de Kubernetes doivent tous cibler `8008` ou le pod ne deviendra jamais **Ready** même si le homeserver est sain.
- **Au moins 1 réplica est maintenu.** GKE ne met pas à l'échelle à zéro, ce qui convient à un homeserver fédérateur qui doit rester joignable. Un PodDisruptionBudget le maintient disponible lors des mises à niveau de nœuds.
- **L'affinité de session est `ClientIP` par défaut.** Maintient les requêtes d'un client sur le même pod.
- **Redis n'est pas utilisé.** Synapse exécute un seul processus principal entièrement basé sur PostgreSQL.
- **Le premier utilisateur administrateur est créé pour vous.** L'enregistrement en libre-service ouvert est désactivé par défaut, mais le job d'initialisation `create-admin` enregistre le compte `admin` via `register_new_matrix_user` en utilisant le secret partagé d'enregistrement et le mot de passe superutilisateur généré (tous deux dans Secret Manager). D'autres utilisateurs sont créés de la même manière, hors bande.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres identifiants sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Synapse {#a-gke-autopilot--the-synapse-workload}

Les pods Synapse sont planifiés sur Autopilot, qui facture le CPU/la mémoire que les pods demandent réellement. L'autoscaling horizontal des pods dimensionne le déploiement entre le nombre minimal et maximal de réplicas.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail Synapse pour voir les pods, les révisions et les événements. Kubernetes Engine → Services et Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"
  ```

Voir [App_GKE](App_GKE.md) pour savoir comment Autopilot, la mise à l'échelle et le type de charge de travail (Deployment vs StatefulSet) sont gérés.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Synapse stocke tout l'état du homeserver (comptes, salons, événements, clés d'appareil, état de fédération) dans une instance gérée de Cloud SQL pour PostgreSQL 15. Les pods l'atteignent en privé via le sidecar **Cloud SQL Auth Proxy** sur une boucle de retour `127.0.0.1` ; aucune IP publique n'est exposée. Lors du premier déploiement, un job `db-init` crée la base de données de l'application **avec la collation `C`** et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  # Verify the mandatory collation:
  #   SELECT datname, datcollate, datctype FROM pg_database WHERE datname = '<db-name>';
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret Secret Manager contenant le mot de passe sont tous affichés dans les [Sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes automatisées et la rotation des mots de passe, voir [App_GKE](App_GKE.md).

### C. Cloud Storage et le répertoire de données persistant {#c-cloud-storage--the-persistent-data-directory}

Un bucket de données **Cloud Storage** dédié est provisionné automatiquement. L'état d'exécution propre à Synapse — `homeserver.yaml`, les surcharges `conf.d`, la **clé de signature** et le dépôt de médias — se trouve sous le répertoire de données (`SYNAPSE_DATA_DIR = /data`), sauvegardé par le volume NFS (Filestore) monté au chemin de montage configuré.

- **Console :** Cloud Storage → Buckets ; Filestore → Instances.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"          # if using a StatefulSet PVC
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### D. Secret Manager {#d-secret-manager}

Un **secret partagé d'enregistrement** est généré automatiquement et stocké dans Secret Manager ; il prend en charge `register_new_matrix_user` pour la création de comptes hors bande. Le mot de passe de la base de données est géré séparément par le socle. Les secrets sont matérialisés dans l'espace de noms via le pilote CSI Secret Store.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~synapse"
  kubectl get secrets -n "$NAMESPACE"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation du Secret Store CSI.

### E. Réseau et ingress {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe de Cloud Load Balancing. Le trafic client Matrix et de fédération nécessite une accessibilité publique. Un domaine personnalisé avec un certificat géré par Google (le domaine doit correspondre à `server_name`) peut être activé, et une IP statique peut être réservée afin que l'adresse survive aux redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails de l'IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les métriques GKE et Cloud SQL sont acheminées vers Cloud Monitoring. Des tests de disponibilité et des règles d'alerte facultatifs sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Synapse {#3-synapse-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job `db-init` exécute `db-init.sh` en utilisant `postgres:15-alpine`. Il se connecte via le Cloud SQL Auth Proxy et crée de manière idempotente le rôle d'application et la base de données **avec la collation `C`** (`LC_COLLATE='C' LC_CTYPE='C' TEMPLATE template0`). Le job peut être réexécuté en toute sécurité.
- **Pas de job de migration — schéma autogéré.** Synapse crée et met à jour son schéma à chaque démarrage, de sorte que la mise à niveau de la version de l'application applique les modifications de schéma sans étape de migration distincte.
- **Configuration + clé de signature générées au premier démarrage.** Le point d'entrée cloud génère `homeserver.yaml` et une clé de signature persistante dans `/data`, écrit un extrait `conf.d` connectant PostgreSQL (via le sidecar `127.0.0.1` Auth Proxy) et l'écouteur `0.0.0.0:8008`, puis exécute Synapse. La clé de signature n'est générée qu'une seule fois — conservez `/data` sur un volume persistant (NFS par défaut, ou un PVC StatefulSet).
- **`server_name` est immuable après le premier démarrage.** `Synapse_GKE` n'expose pas d'entrée `server_name` (il utilise toujours la valeur par défaut `Synapse_Common` `matrix.local`) ; modifier la valeur sous-jacente ultérieurement invalide chaque ID utilisateur, session d'appareil et relation de fédération.
- **Le port du conteneur et les sondes doivent être 8008.** Le port du conteneur de déploiement et les sondes de démarrage/vivacité/disponibilité ciblent tous `8008` ; une non-concordance signifie que la sonde atteint un port mort et que le pod ne devient jamais **Ready**.
- **Chemin de santé.** Les sondes par défaut sont `/` sur 8008 — Synapse y sert une page d'accueil non authentifiée ; `/health` (renvoie `OK`) fonctionne également comme chemin de sonde. Confirmez que l'API client est en service avec `GET /_matrix/client/versions` :
  ```bash
  EXTERNAL_IP=$(kubectl get svc -n "$NAMESPACE" \
    -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
  curl -s "http://${EXTERNAL_IP}/_matrix/client/versions"
  ```
- **Le job `create-admin` enregistre le premier utilisateur administrateur.** Il s'exécute après `db-init`, interroge `http://<service-name>/health` (le Service écoute sur le port 80 quelle que soit la valeur 8008 du conteneur), puis exécute `register_new_matrix_user -u admin -a` avec le secret partagé d'enregistrement et le mot de passe superutilisateur généré. Il peut être réexécuté en toute sécurité ("User ID already taken" est toléré). Lisez le mot de passe avec :
  ```bash
  gcloud secrets versions access latest \
    --secret=secret-<prefix>-synapse-superuser-password --project "$PROJECT"
  ```
- **Créez d'autres utilisateurs** avec le même outil depuis l'intérieur d'un pod :
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- \
    register_new_matrix_user -c /data/homeserver.yaml -u alice -a http://localhost:8008
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour Synapse sont listés ; toutes les autres entrées sont héritées de [App_GKE](App_GKE.md) avec son comportement et ses valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail autorisées à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts/propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `synapse` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Synapse Helpdesk` | Nom lisible par l'homme. |
| `application_version` | `latest` | Tag d'image Synapse ; épingler à une version spécifique (par exemple `v1.119.0`) en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `container_port` | `8008` | Écouteur client + fédération de Synapse. Les sondes doivent correspondre à cela. |
| `min_instance_count` | `1` | Réplicas minimum ; maintenir à 1 pour que le homeserver soit toujours joignable pour la fédération. |
| `max_instance_count` | `5` | Réplicas maximum. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions. |
| `container_image_source` | `custom` | Build personnalisé léger `FROM matrixdotorg/synapse`. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image de base Synapse dans Artifact Registry. |
| `enable_vertical_pod_autoscaling` | `false` | VPA pour l'ajustement automatique des requêtes. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Les valeurs principales `SYNAPSE_*` sont définies automatiquement. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | IP externe pour le trafic client Matrix + fédération. |
| `workload_type` | `null` (auto) | `Deployment` ou `StatefulSet` ; lorsqu'il n'est pas défini, se résout en `Deployment` sauf si `stateful_pvc_enabled = true` (alors `StatefulSet`). |
| `session_affinity` | `ClientIP` | Le routage persistant maintient un client sur le même pod. |
| `network_tags` | `["nfsserver"]` | Requis lorsque `enable_nfs = true`. |
| `termination_grace_period_seconds` | `60` | Secondes à attendre après SIGTERM avant SIGKILL. |
| `enable_network_segmentation` | `false` | Créer des ressources Kubernetes NetworkPolicy. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` (désactivé) | Activer les modèles PVC — utile pour donner à la clé de signature + aux médias une persistance par pod. |
| `stateful_pvc_size` | `10Gi` | Taille de stockage PVC par pod. |
| `stateful_pvc_mount_path` | `/data` | Chemin de montage du conteneur pour le PVC (le répertoire de données Synapse). |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass pour les PVC. |
| `stateful_headless_service` | `null` (auto) | Créer un Service sans tête pour des noms DNS de pod stables. |
| `stateful_pod_management_policy` | `null` (→ `OrderedReady`) | Ordre de création des pods. |
| `stateful_update_strategy` | `null` (auto) | Stratégie de mise à jour (`RollingUpdate` ou `OnDelete`). |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protéger la disponibilité pendant les mises à niveau de nœuds. |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles pendant les perturbations volontaires. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/` sur 8008, délai initial de 60s | Sonde de démarrage. Prévoir du temps pour la configuration du schéma au premier démarrage. |
| `liveness_probe` | HTTP `/` sur 8008, délai initial de 60s | Sonde de vivacité. |
| `uptime_check_config` | désactivé | Test de disponibilité facultatif de Cloud Monitoring. |
| `alert_policies` | `[]` | Règles d'alerte métrique facultatives. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser les jobs intégrés : `db-init` (base de données + rôle avec collation C) et `create-admin` (enregistre le superutilisateur `admin`). |
| `cron_jobs` | `[]` | CronJobs Kubernetes planifiés. |
| `additional_services` | `[]` | Services sidecar ou auxiliaires déployés avec Synapse. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard App_GKE Cloud Build / Cloud Deploy — voir [App_GKE](App_GKE.md).
Entrées clés : `enable_cicd_trigger`, `github_repository_url`, `github_token`,
`enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | NFS persistant pour le répertoire de données (clé de signature + médias). |
| `nfs_mount_path` | `/data` | Chemin de montage à l'intérieur du conteneur. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer les buckets GCS configurés. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets à provisionner — la valeur par défaut crée le bucket de données dédié. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse via le pilote CSI. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 15 — Redis {#group-15--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Synapse utilise une file d'attente/cache basée sur PostgreSQL — laisser `false` sauf si externalisation. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Point de terminaison Redis (uniquement en cas d'externalisation). |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_database_name` | `synapse` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `application_database_user` | `synapse` | Utilisateur de la base de données de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |
| `rotation_propagation_delay_sec` | `90` | Secondes à attendre après la rotation avant de redémarrer les pods en rolling-restart. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter à 30–90 pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécuter du SQL à partir d'un bucket GCS après le provisionnement. Voir
[App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner Ingress pour les noms d'hôtes personnalisés + certificat géré (doit correspondre à `server_name`). |
| `application_domains` | `[]` | Noms d'hôtes à servir. |
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |
| `network_tags` | `["nfsserver"]` | Tags de pare-feu ; `nfsserver` requis pour NFS. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

> **Avertissement :** L'activation d'IAP nécessite une authentification d'identité Google pour **toutes** les requêtes entrantes, y compris la fédération Matrix et les clients externes. N'activez IAP que pour les homeservers privés/réservés aux administrateurs qui ne fédèrent pas.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google devant Synapse. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque IAP est activé (sensible). |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attacher une politique Cloud Armor (WAF) au backend Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à un accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la politique. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend Ingress GKE (utile pour les médias). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Mappage des ClusterIP pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `api_url` | URL pour atteindre Synapse. |
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
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur de base [App_GKE](App_GKE.md), qui valide les valeurs *et les combinaisons* au moment de la planification — un réplica en lecture sans son primaire, IAP sans identités autorisées, un environnement d'exécution `gen1` avec des montages NFS/GCS, un `redis_port`/`backup_retention_days` hors limites, une mémoire ResourceQuota sans suffixe d'unité binaire. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'au moment de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `server_name` (`matrix.local` fixe) | Non exposé comme une entrée `Synapse_GKE` | Critique | Une fédération réelle et des identifiants utilisateur durables nécessitent un domaine personnalisé ; ce module n'a pas de variable `server_name`, donc l'utilisation en production nécessite actuellement de surcharger `Synapse_Common` directement. Modifier la valeur sous-jacente après le premier démarrage invalide chaque identifiant utilisateur, session d'appareil et relation de fédération. |
| Persistance de la clé de signature (`enable_nfs` / PVC StatefulSet) | persistant | Critique | Si le répertoire de données n'est pas persistant, un redémarrage du pod régénère la clé de signature, ce qui rompt la fédération et invalide toutes les sessions d'appareil. |
| Collation de la base de données (`db-init`) | `C` (automatique) | Critique | Synapse refuse de démarrer avec toute collation non-`C` ; ne contournez pas le job `db-init`. |
| `application_database_name` / `application_database_user` | Défini une seule fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activation sans un `backup_uri` valide fait échouer le job d'importation. |
| `container_port` / port de sonde | `8008` | Élevé | Les sondes sur tout autre port atteignent un port mort et le pod ne devient jamais Ready même si Synapse est sain. |
| Chemin de sonde | `/` (par défaut) ou `/health` | Élevé | Pointer une sonde vers un chemin d'API Matrix authentifié renvoie 401/403 et le pod ne devient jamais Ready. |
| `container_resources.memory_limit` | `4Gi` (≥ 2 Gio) | Élevé | En dessous de 2 Gio, Synapse subit des OOM (manque de mémoire) sous une charge réelle de salle/fédération. |
| `min_instance_count` | `1` | Élevé | GKE exige min ≥ 1 ; garder 1 assure que le serveur domestique est toujours joignable pour la fédération. |
| `session_affinity` | `ClientIP` | Élevé | Sans persistance de session, les requêtes d'un client se dispersent entre les pods, perturbant les connexions de synchronisation de longue durée. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy est requis pour la connectivité PostgreSQL ; sa désactivation est bloquée par une garde de validation au moment de la planification. |
| `enable_iap` | uniquement pour les serveurs privés | Élevé | IAP bloque la fédération et les clients externes ; à utiliser uniquement pour les déploiements réservés aux administrateurs. |
| Mise à jour progressive sur les pods basés sur NFS | `Recreate` (automatique) | Élevé | Deux pods contre le même répertoire de données + DB peuvent entrer en conflit ; la fondation utilise `Recreate` pour les applications basées sur NFS. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers nus sont des octets et bloquent toute planification de pod dans l'espace de noms. |
| `enable_pod_disruption_budget` | `true` | Moyen | La désactivation permet à GKE d'expulser tous les pods simultanément pendant la maintenance. |
| `backup_retention_days` | `7` (à augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé partout — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**. La
configuration d'application spécifique à Synapse partagée avec la variante Cloud Run
est décrite dans **[Synapse_Common](Synapse_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Synapse sur GKE Autopilot](../labs/Synapse_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Synapse sur Google Cloud Run](Synapse_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Synapse Common — Configuration d'application partagée](Synapse_Common.md) — la configuration partagée par les deux cibles de déploiement.
