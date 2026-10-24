---
title: "Flowise sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Flowise sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Flowise_GKE.md @ e69407af sha256:7c000549539c -->

# Flowise sur GKE Autopilot {#flowise-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Flowise_GKE.png" alt="Flowise sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Flowise est un constructeur visuel de flux de travail IA open source qui permet aux non-développeurs d'assembler des pipelines IA LangChain et LlamaIndex via une interface glisser-déposer. Ce module déploie Flowise sur **GKE Autopilot** au-dessus de la fondation [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Flowise et sur la manière de les explorer et de les exploiter depuis la Google Cloud Console et la ligne de commande. Pour les mécanismes communs à toutes les applications GKE — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et le cycle de vie du déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## Ce que coûte Flowise sur RAD, et comment cela se compare {#what-flowise-costs-on-rad-and-how-that-compares}

**Dans un projet Google Cloud que vous possédez, le module GKE Autopilot de Flowise sur RAD coûte environ 93 US$ par mois, plus 11 US$ une fois par déploiement et aucune licence par utilisateur.** Pour le coût le plus bas, le [module Cloud Run](Flowise_CloudRun.md) exécute le même Flowise pour environ 69 US$ par mois. Flowise est un constructeur visuel de flux de travail IA open source pour assembler des pipelines LangChain et LlamaIndex par glisser-déposer. Les chiffres sont à jour au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

Si cela s'exécute dans un projet géré par RAD pour vous, il peut être supprimé et restauré dans les 30 jours pour quelques crédits au lieu de rester en fonctionnement — ainsi, un déploiement à usage occasionnel coûte quelques dollars par mois, et non 93 US$. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 110 crédits (11 US$ au prix de la recharge) | 99 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût de fonctionnement Google Cloud | Facturé par Google à votre propre compte de facturation, environ **93 US$ par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **85 crédits par jour**, environ 2 550 par mois (environ 255 US$ au prix de la recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 US$ pour une recharge ponctuelle, et moins avec un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût de fonctionnement par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Pod GKE Autopilot, 1 vCPU / 1 Gio, fonctionnant en permanence | 36 US$ |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51 US$ |
| Passerelle et adresse IP Cloud NAT | 5 US$ |
| Cloud Storage pour les sauvegardes | 1 US$ |
| **Total** | **environ 93 US$** |

Le niveau gratuit de GKE couvre les frais de gestion d'un cluster Autopilot ou zonal par compte de facturation, donc le total ci-dessus suppose qu'il s'agit de ce cluster ; sinon, ajoutez environ 73 US$ par mois.

### Comment cela se compare {#how-it-compares}

Flowise a son propre plan hébergé officiel, **Flowise Cloud** : le plan Cloud hébergé de Flowise commence à 35 $/mois (Starter : flux illimités, 10 000 prédictions/mois, 1 Go de stockage) ; un plan Pro à 65 $/mois augmente ces limites — lu le 8 octobre 2026.

| Option | Par mois | Qui l'exécute |
|---|---|---|
| Flowise Cloud, Starter (plan hébergé officiel) | 35 US$/mois | Flowise |
| **RAD, GKE Autopilot, votre propre projet** | **93 US$**, plus 11 US$ une fois | L'automatisation de RAD, dans votre projet |
| **RAD, GKE Autopilot, un projet géré par RAD** | **environ 2 550 crédits (255 US$)** | RAD |
| RAD, Cloud Run | environ 69 US$ ; voir le [guide Cloud Run](Flowise_CloudRun.md) | RAD |

Le prix de Flowise Cloud a été lu sur sa propre page de tarification le 8 octobre 2026 et a pu changer depuis — vérifiez la source avant de vous fier au chiffre.

- **Flowise Cloud est la comparaison fixe ; un serveur autogéré est la comparaison flexible.** Sur votre propre machine Hetzner ou DigitalOcean (2 vCPU/4 Go, environ 24 US$/mois) ou un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go, environ 49 US$/mois), vous paieriez moins en espèces que l'une ou l'autre option, mais vous géreriez vous-même le système d'exploitation, la base de données, les sauvegardes, les correctifs de sécurité et les mises à niveau — exactement ce que les services Cloud SQL, Secret Manager et de surveillance gérés par RAD font pour vous.
- **Un serveur bon marché est bon marché jusqu'à ce que quelque chose tombe en panne.** Sur RAD, les sauvegardes, la récupération à un instant précis, la rotation des mots de passe via Secret Manager, ainsi que la journalisation et la surveillance proviennent de Google Cloud par défaut. Sur votre propre serveur, ou sur un plan hébergé à prix fixe sans contrôle d'infrastructure, chacun de ces éléments est un travail que quelqu'un doit encore faire ou une limite que vous ne pouvez pas modifier.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Flowise s'exécute dans **un projet géré par RAD pour vous**, vous avez une option au-delà de la mise à l'échelle : **supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour presque rien.** Cela convient bien mieux à un déploiement dont vous n'avez besoin qu'occasionnellement — pour étudier en vue d'une certification, une démo, un besoin saisonnier — que de le faire fonctionner en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le projet. Google ne le supprime pas immédiatement : il le conserve, récupérable, pendant 30 jours, et comme la facturation est déjà déliée, rien n'est facturé pendant qu'il attend. Contrairement à la suppression d'un module, cela ne détruit pas Cloud SQL, la VM ou GKE Autopilot un par un — l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet peut le restaurer. RAD demande à Google de récupérer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter **Mettre à jour** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela coûte une poignée de crédits de temps de build au total (moins de 1 US$) pour une chaîne typique de 2 à 3 déploiements.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, pas 93 US$.** Déployez Flowise, utilisez-le pour une session, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Mettre à jour, et supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez que les frais de module une fois, les builds, et les heures pendant lesquelles il était réellement en ligne.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un projet que vous apportez et que RAD ne gère que pour la facturation), et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime définitivement. La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude/démo conviennent). Google indique que la plupart des services sont de nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.
- **Une lacune réelle : les sauvegardes nocturnes ne survivent pas.** Les sauvegardes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé ce déploiement et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive, ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Ne payez que pendant que vous l'utilisez, l'autre façon : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

GKE maintient au moins un pod en cours d'exécution, de sorte que Flowise ne se met jamais à l'échelle à zéro de lui-même. L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ 115 crédits (11,50 US$). La suppression permet d'économiser de l'argent si Flowise resterait inutilisé pendant environ 4 jours ou plus dans votre propre projet (environ 3,10 US$ par jour), ou environ 2 jours ou plus dans un projet géré par RAD (85 crédits par jour).
- **Supprimez tout ce que Flowise utilise.** La majeure partie du coût de fonctionnement est généralement la base de données et toute VM de fichier/cache partagée. Ils ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc la suppression de cette application pendant que quelque chose d'autre partage le projet n'économise que la partie calcul de cette application.
- **Conservez d'abord les données.** Les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui, alors copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.
- **Notez vos paramètres.** RAD ne recrée pas un déploiement supprimé pour vous ; vous entrez à nouveau les paramètres lorsque vous déployez.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant dispose de Flowise dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite fixée par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits non utilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais propres à RAD et estimation des crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour le mécanisme de pause/restauration ; [Tarification Flowise Cloud](https://flowiseai.com/). Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Flowise s'exécute comme une charge de travail de conteneur Node.js. Le déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods Node.js, 1 vCPU / 1 Gio par défaut, mise à l'échelle horizontale automatique |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — Flowise ne prend pas en charge MySQL dans ce déploiement |
| Stockage d'objets | Cloud Storage | Un bucket de téléchargement dédié toujours provisionné ; stocke les fichiers téléchargés par Flowise |
| Secrets | Secret Manager | Mot de passe administrateur Flowise auto-généré |
| Ingress | Cloud Load Balancing | Équilibreur de charge externe, domaine personnalisé facultatif + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixe ; la sélection de MySQL ou
  `NONE` provoque l'échec du démarrage.
- **Le stockage de fichiers basé sur GCS est toujours activé.** `STORAGE_TYPE=gcs` et
  `APIKEY_STORAGE_TYPE=db` sont injectés automatiquement ; les clés API sont stockées dans le
  base de données, pas dans des fichiers.
- **L'affinité de session est `ClientIP`.** Les requêtes d'un navigateur sont épinglées à un pod
  pour maintenir la cohérence de la session de l'interface utilisateur de Flowise.
- **Le mot de passe administrateur est généré automatiquement** et stocké dans Secret Manager ;
  vous ne le définissez jamais en texte clair.
- **Les variables `DATABASE_*` sont mappées par le script d'entrée** (`flowise-entrypoint.sh`)
  à partir des variables `DB_*` standard de la plateforme au démarrage du conteneur — ne les définissez pas
  directement comme variables d'environnement.
- **Redis est désactivé par défaut.** Il n'est pas requis pour les fonctionnalités de base de Flowise,
  mais les déploiements multi-répliques qui partagent l'état d'exécution des flux en bénéficient.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Flowise {#a-gke-autopilot--the-flowise-workload}

Les pods Flowise sont planifiés sur Autopilot, qui facture le CPU/la mémoire que les pods
demandent réellement. L'autoscaling horizontal des pods dimensionne le déploiement entre les
nombres minimum et maximum de réplicas.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail Flowise pour voir
  les pods, les révisions et les événements. Kubernetes Engine → Services et Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de charge de travail
(Déploiement vs StatefulSet).

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Flowise stocke toutes les données d'application (définitions de flux, identifiants, exécutions) dans une
instance Cloud SQL pour PostgreSQL 15 gérée. Les pods l'atteignent en privé via le
sidecar **Cloud SQL Auth Proxy** via un socket Unix, de sorte qu'aucune IP publique n'est exposée. Lors du
premier déploiement, un job d'initialisation crée la base de données et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret Manager contenant le
mot de passe sont tous affichés dans les [Sorties](#5-outputs). Pour le modèle de connexion,
les sauvegardes automatisées et la rotation des mots de passe, voir
[App_GKE](App_GKE.md).

### C. Cloud Storage {#c-cloud-storage}

Un bucket de téléchargement **Cloud Storage** dédié est toujours provisionné par Flowise_Common.
Son nom est injecté automatiquement dans le conteneur sous le nom
`GOOGLE_CLOUD_STORAGE_BUCKET_NAME`. Flowise écrit tous les fichiers téléchargés par l'utilisateur (documents,
images) dans ce bucket. Des buckets supplémentaires peuvent être configurés via `storage_buckets`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<uploads-bucket>/          # bucket name is in the Outputs
  ```

Voir [App_GKE](App_GKE.md) pour les montages GCS Fuse et les options CMEK.

### D. Secret Manager {#d-secret-manager}

Le mot de passe administrateur de Flowise est stocké en tant que secret Secret Manager et injecté dans
les pods au moment de l'exécution ; le texte en clair n'apparaît jamais dans la configuration. Le mot de passe de la base de données est
géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données se trouve dans les [Sorties](#5-outputs). Voir
[App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store CSI.

### E. Réseau et ingress {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe de Cloud Load Balancing. Un
domaine personnalisé avec un certificat géré par Google peut être activé, et une IP statique peut
être réservée afin que l'adresse survive aux redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et
les détails de l'IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les métriques GKE et Cloud SQL sont acheminées vers Cloud
Monitoring. Des tests de disponibilité et des politiques d'alerte facultatifs sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Flowise {#3-flowise-application-behaviour}

- **Configuration de la base de données lors du premier déploiement.** Un job d'initialisation (`db-init`) utilisant l'image
  `postgres:15-alpine` crée la base de données et l'utilisateur Flowise et accorde
  des privilèges avant le démarrage de l'application. Il est idempotent et peut être réexécuté en toute sécurité.
- **Sonde de santé.** Les sondes de démarrage et de vivacité ciblent le point de terminaison de santé dédié de Flowise
  `/api/v1/ping`, qui renvoie HTTP 200 lorsque l'application est
  prête. La sonde de démarrage alloue un budget de démarrage de 5 minutes (30 échecs
  × intervalle de 10 secondes) pour tenir compte de l'initialisation de la base de données au premier démarrage.
- **Connexion administrateur.** Le nom d'utilisateur administrateur initial est configurable via `flowise_username`
  (par défaut `admin`). Le mot de passe administrateur est auto-généré et stocké dans Secret
  Manager ; récupérez-le avec :
  ```bash
  gcloud secrets versions access latest \
    --secret=<resource_prefix>-flowise-password --project "$PROJECT"
  ```
- **Re-mappage des variables de la base de données.** `flowise-entrypoint.sh` mappe inconditionnellement
  `DB_HOST`, `DB_USER`, `DB_NAME` et `DB_PASSWORD` (injectés par la plateforme)
  vers `DATABASE_HOST`, `DATABASE_USER`, `DATABASE_NAME` et `DATABASE_PASSWORD`
  au démarrage du conteneur. Ne définissez pas les variables `DATABASE_*` directement.
- **Stockage de fichiers GCS.** `STORAGE_TYPE=gcs` et `GCLOUD_PROJECT` sont toujours injectés.
  Flowise écrit les fichiers téléchargés dans le bucket GCS auto-provisionné. La surcharge de
  `STORAGE_TYPE` entraîne l'écriture des téléchargements dans le stockage éphémère des pods et leur perte à
  chaque redémarrage.
- **Considérations multi-répliques.** Flowise stocke l'état d'exécution des flux en mémoire.
  L'exécution de plusieurs répliques sans Redis entraîne l'échec des exécutions de flux lorsque
  les requêtes sont équilibrées en charge vers un pod différent. Conservez `max_instance_count = 1`
  sauf si Redis est configuré.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour Flowise sont listés ; toutes les autres entrées sont héritées de [App_GKE](App_GKE.md) avec son comportement standard et ses valeurs par défaut.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources pour le suivi des coûts/de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `flowise` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Flowise` | Nom convivial affiché dans la Console. |
| `application_description` | _(défini)_ | Annotation de description de la charge de travail. |
| `application_version` | `latest` | Balise de version de l'image Flowise ; mettez à jour pour déployer une nouvelle version. |
| `flowise_username` | `admin` | Nom d'utilisateur administrateur Flowise injecté en tant que `FLOWISE_USERNAME`. Modifiez avant d'exposer publiquement. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | `custom` construit via Cloud Build ; `prebuilt` déploie une URI d'image existante. |
| `container_image` | `""` | Remplace l'URI de l'image (utilisé uniquement lorsque `container_image_source = "prebuilt"`). |
| `container_resources` | `{ cpu_limit="1000m", memory_limit="1Gi" }` | Limites CPU/mémoire par pod. |
| `min_instance_count` | `1` | Réplicas minimum. Gardez ≥ 1 pour éviter les démarrages à froid pour l'exécution de flux de travail IA. |
| `max_instance_count` | `1` | Réplicas maximum. Augmentez uniquement avec Redis activé. |
| `container_port` | `3000` | Flowise écoute sur le port 3000. |
| `timeout_seconds` | `300` | Attente maximale de réponse du pod backend. Augmentez pour les flux de travail IA de longue durée (max 3600). |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions socket. |
| `enable_vertical_pod_autoscaling` | `false` | Laissez Autopilot ajuster automatiquement les demandes de ressources. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Ne pas remplacer les variables gérées par la plateforme (`DATABASE_*`, `FLOWISE_*`, `STORAGE_TYPE`). |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager (par exemple `{ OPENAI_API_KEY = "flowise-openai-key" }`). |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `gke_cluster_name` | `""` | Nom du cluster GKE. Laissez vide pour la découverte automatique. |
| `service_type` | `LoadBalancer` | Comment le service est exposé. |
| `session_affinity` | `ClientIP` | Routage persistant recommandé pour l'interface utilisateur de Flowise. |
| `workload_type` | `null` | Par défaut à `Deployment` pour Flowise (sans état). |
| `network_tags` | `["nfsserver"]` | Balises de nœud/pod pour les règles de pare-feu. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

Pertinent uniquement lorsque `workload_type = "StatefulSet"`.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Active les modèles PVC dans la spécification StatefulSet. |
| `stateful_pvc_size` | `10Gi` | Taille de stockage pour chaque PVC. |
| `stateful_pvc_mount_path` | `/data` | Chemin du conteneur où le PVC est monté. |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass pour les PVC. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Plafonne les nombres de CPU/mémoire/objets de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doit utiliser des unités binaires (`4Gi`, `8192Mi`)** — les entiers bruts sont lus comme des octets et bloquent toute planification. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `false` | Protège la disponibilité pendant les mises à niveau de nœuds. |
| `pdb_min_available` | `1` | Nombre minimum de pods disponibles pendant les perturbations volontaires. |
| `enable_topology_spread` | `false` | Répartit les pods sur plusieurs zones. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | chemin `/api/v1/ping`, délai de 30s, 30 échecs | Budget de démarrage de 5 minutes pour l'initialisation de la base de données au premier démarrage. |
| `health_check_config` | chemin `/api/v1/ping`, délai de 15s | Sonde de vivacité. |
| `uptime_check_config` | désactivé, chemin `/` | Test de disponibilité Cloud Monitoring depuis des emplacements mondiaux. |
| `alert_policies` | `[]` | Politiques d'alerte métriques facultatives. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | CronJobs Kubernetes planifiés. |
| `additional_services` | `[]` | Services GKE sidecar ou auxiliaires déployés avec Flowise. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard App_GKE Cloud Build / Cloud Deploy — voir
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Provisionne un volume NFS Filestore. Utile pour les téléchargements de fichiers de flux de travail Flowise lorsque NFS est préféré à GCS. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne les buckets supplémentaires dans `storage_buckets`. Le bucket de téléchargement Flowise est toujours créé par Flowise_Common. |
| `storage_buckets` | `[{ name_suffix="data" }]` | Buckets GCS supplémentaires à provisionner. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 15 — Redis (facultatif) {#group-15--redis-optional}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Active Redis. Non requis pour les fonctionnalités de base ; nécessaire pour les déploiements multi-répliques. |
| `redis_host` | `""` | Point de terminaison Redis. Requis lorsque `enable_redis = true` (ou `enable_nfs = true` utilise l'IP de l'hôte NFS). |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Moteur Cloud SQL. Flowise nécessite PostgreSQL. |
| `application_database_name` | `flowisedb` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `flowiseuser` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16-64). |
| `enable_postgres_extensions` | `false` | Active l'installation des extensions PostgreSQL. |
| `postgres_extensions` | `[]` | Liste des extensions PostgreSQL à installer. |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmentez à 30-90 pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaure à partir d'une sauvegarde lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécute du SQL à partir d'un bucket GCS après le provisionnement. Voir
[App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne l'Ingress pour les noms d'hôtes personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôtes à servir (par exemple `["flowise.example.com"]`). |
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |

### Groupe 20 — Proxy conscient de l'identité (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google devant Flowise. Recommandé pour la production. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque l'IAP est activé (sensible). |
| `iap_support_email` | `""` | Affiché sur l'écran de consentement OAuth. |

### Groupe 21 — Cloud Armor et CDN {#group-21--cloud-armor--cdn}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attache une politique Cloud Armor (WAF) au backend Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à un accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la politique. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend Ingress GKE. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode dry-run. |
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
| `stage_service_cluster_ips` | Carte des ClusterIP pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe de l'équilibreur de charge (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Flowise. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` | Point de terminaison de la base de données (127.0.0.1 via le proxy d'authentification). |
| `database_port` | Port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `db_import_job` | Nom du job d'importation (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails du dépôt CI/CD. |
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
| `database_type` | `POSTGRES_15` | Critique | Flowise nécessite PostgreSQL ; MySQL/`NONE` empêche le démarrage. |
| `enable_cloudsql_volume` | `true` | Critique | Sans le sidecar Auth Proxy, la connexion à la base de données est refusée. |
| `application_database_name` / `_user` | défini une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit les données. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans fichier de sauvegarde valide fait échouer le job d'importation. |
| `quota_memory_requests` / `_limits` | unités binaires | Critique | Les entiers bruts sont des octets et bloquent toute planification. |
| `flowise_username` | changer de `admin` | Élevé | Le nom d'utilisateur par défaut est publiquement connu ; combiné à un mot de passe deviné, il donne un accès complet à tous les flux d'IA. |
| `FLOWISE_SECRETKEY_OVERWRITE` | laisser non défini après le premier déploiement | Élevé | Modifier ou supprimer ceci après le premier déploiement brouille de manière permanente toutes les clés API LLM et les identifiants de magasin de vecteurs stockés. |
| `container_resources.memory_limit` | `1Gi` | Élevé | En dessous de 512 Mio, le processus Node.js est tué par manque de mémoire au démarrage. La production avec de grands graphes de flux nécessite 2 Gio. |
| `max_instance_count` | `1` (sans Redis) | Élevé | Plusieurs réplicas sans magasin Redis partagé entraînent l'échec des exécutions de flux lorsque les requêtes sont acheminées vers un pod différent. |
| `enable_iap` | activer pour l'interface d'administration | Élevé | L'interface utilisateur de Flowise est autrement accessible publiquement sans authentification. |
| `STORAGE_TYPE` | `gcs` (par défaut) | Élevé | Toute autre valeur écrase les téléchargements vers le stockage éphémère du pod, perdu à chaque redémarrage du pod. |
| `min_instance_count` | `1` | Moyen | `0` risque une latence de démarrage à froid qui dépasse les délais d'attente des clients LLM en aval. |
| `enable_redis` | activer avec >1 réplica | Moyen | Requis pour l'état partagé de la session/file d'attente sur plusieurs réplicas. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |
| `pdb_min_available` vs `min_instance_count` | laisser de la marge | Moyen | `1`/`1` peut bloquer les mises à niveau des nœuds (un seul pod ne peut pas être expulsé). |

---

Pour le comportement de base référencé partout — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Flowise partagée avec la
variante Cloud Run est décrite dans **[Flowise_Common](Flowise_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Flowise sur GKE Autopilot](../labs/Flowise_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Flowise sur Google Cloud Run](Flowise_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Flowise Common — Configuration d'application partagée](Flowise_Common.md) — la configuration partagée par les deux cibles de déploiement.
