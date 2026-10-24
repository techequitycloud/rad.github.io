---
title: "Hoppscotch sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Hoppscotch sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Hoppscotch_GKE.md @ e69407af sha256:7888dd9abbfb -->

# Hoppscotch sur GKE Autopilot {#hoppscotch-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Hoppscotch_GKE.png" alt="Hoppscotch sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Hoppscotch est une plateforme de développement d'API open-source, de type Postman,
pour la conception, l'envoi et l'inspection de requêtes HTTP, GraphQL et WebSocket
depuis le navigateur. Ce module déploie le **frontend Hoppscotch auto-hébergé**
en tant qu'application monopage sans état sur **GKE Autopilot** au-dessus de la
fondation [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure
partagée Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Hoppscotch et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à chaque application GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement
— reportez-vous au [guide de la fondation App_GKE](App_GKE.md) plutôt que de les
répéter ici.

---

## Ce que coûte Hoppscotch sur RAD, et comment cela se compare {#what-hoppscotch-costs-on-rad-and-how-that-compares}

**Hoppscotch sur le module GKE de RAD coûte environ 24 US$ par mois dans votre
propre projet, plus des frais de module de 40 crédits (4 US$) une fois par
déploiement.** Si vous n'en avez besoin qu'occasionnellement, consultez la
section "Mettez-le en pause gratuitement" ci-dessous pour arrêter de payer sans
perdre votre configuration. Hoppscotch est également disponible en tant que
module Cloud Run, qui est l'option la moins chère ici (environ 17 US$/mois)
car il se met à l'échelle zéro entre les requêtes au lieu de maintenir une
allocation de cluster — consultez le guide Cloud Run, sauf si vous utilisez déjà
GKE Autopilot pour d'autres applications.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 40 crédits (4,00 US$) | 36 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Identique |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **24,04 US$ par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **55 crédits par jour** |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 US$ pour une recharge unique, moins sur un plan. Dans un
projet géré par RAD, la base de données, le serveur de fichiers et le réseau
sont partagés par chaque application du projet, de sorte qu'une deuxième
application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix
catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Pod GKE Autopilot, 0,5x vCPU / 0,5 GiB | 18,04 US$ |
| Cloud NAT et réseau | 5,00 US$ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 US$ |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 |
| **Total** | **environ 24,04 US$** |

### Comment cela se compare {#how-it-compares}

- Il n'existe pas de SaaS hébergé officiel pour le frontend Hoppscotch
  auto-hébergé à comparer — les plans cloud de Postman sont un produit
  différent, à code source fermé — donc la comparaison honnête est un serveur
  nu.
- Le frontend de Hoppscotch est léger (1 vCPU, 0,5 GiB), donc même un niveau de
  VPS moins cher/plus petit que ceux ci-dessous le ferait fonctionner ; à titre
  de référence, un Hetzner CPX22 ou un droplet DigitalOcean 2 vCPU/4 Go coûte
  environ 24 $/mois et un GCP Compute Engine e2-standard-2 environ 49 $/mois.
- Ce que RAD ajoute par rapport à un VPS nu, c'est le TLS géré, l'accès
  restreint par IAM, Secret Manager et la surveillance — ce module n'a pas de
  base de données à patcher, donc l'écart concerne principalement l'identité et
  l'observabilité plutôt que l'administration de la base de données.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Hoppscotch s'exécute dans un projet géré par RAD pour vous et que vous
prévoyez d'y revenir — une pause entre les cours, une accalmie saisonnière, ou
simplement ne pas savoir si vous en aurez besoin le mois prochain — c'est la
meilleure option, et elle ne coûte presque rien.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La suppression d'un projet géré par RAD délie d'abord sa facturation, puis
demande à Google de supprimer le projet purement et simplement : la suppression
logique récupérable de 30 jours de Google. Contrairement à la suppression de
Hoppscotch en tant que module unique, cela ne démantèle pas le pod GKE, le
réseau et le stockage un par un — l'ensemble du projet s'arrête simplement, et
rien n'est facturé pendant qu'il attend, car la facturation est déjà déliée.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet,
demande à Google de récupérer le projet et de rattacher son compte de
facturation, puis vous demande d'exécuter la mise à jour sur chaque déploiement
pour confirmer que tout est revenu. Comme rien n'a été détruit
individuellement, cette mise à jour trouve les mêmes ressources déjà présentes
— c'est une vérification, pas une reconstruction, et une mise à jour ne facture
jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits
(moins de 1 US$) en temps de build pour une chaîne de déploiements typique.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet pour
lequel RAD ne gère que la facturation), vous devez le restaurer vous-même dans
les 30 jours — après cela, Google le supprime définitivement — et la
restauration est admise comme la création d'un nouveau projet, donc votre solde
de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour
le niveau sandbox que la plupart utilisent conviennent). Google indique que la
plupart des services fonctionnent à nouveau pleinement dans les 36 heures
suivant une restauration.

Un véritable écart : les sauvegardes nocturnes sont écrites dans un bucket à
l'intérieur du projet, et ce bucket a la suppression logique de Cloud Storage
explicitement désactivée, il est donc très probable qu'il disparaisse dès que
vous supprimez le projet, même si le projet lui-même est récupérable pendant 30
jours. Hoppscotch conserve peu de son propre état côté serveur (les
collections et les environnements sont principalement dans le navigateur), donc
pour une installation par défaut, il y a peu à perdre.

### Ne payez que pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que la fenêtre de 30 jours ci-dessus est
passée, la solution de repli consiste à supprimer Hoppscotch purement et
simplement et à le redéployer plus tard.

- **Ce que coûte un redéploiement :** les frais de module à nouveau, plus les
  builds — environ les frais de module indiqués ci-dessus plus 3 à 6 crédits de
  temps de build.
- **Quand cela en vaut la peine :** la suppression ne permet d'économiser de
  l'argent que si Hoppscotch devait rester inutilisé pendant environ 6 jours ou
  plus dans votre propre projet (moins d'une journée dans un projet géré par
  RAD, car le taux journalier géré de GKE est relativement élevé pour cette
  application). La majeure partie du coût d'exécution ici est les frais de
  gestion de cluster GKE partagés et NAT, donc la suppression de Hoppscotch
  seule n'économise que la part de son propre pod si d'autres applications
  partagent le cluster.
- **Conservez d'abord les données.** Les sauvegardes nocturnes sont écrites
  dans un bucket à l'intérieur du déploiement, et ce bucket est supprimé avec
  lui — copiez la dernière sauvegarde (vers Google Drive, ou un bucket que vous
  conservez) avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour
  une classe. Chaque participant obtient l'application dans son propre projet
  Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation
  définie par le formateur. Soit le formateur finance toutes les places, soit
  chaque participant paie la sienne. Tout est supprimé à la fin de la session
  et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire exécute
  l'application pour un client à partir d'un portefeuille cloisonné qu'il
  finance, et règle directement avec le client. Si le portefeuille est faible,
  la facturation est suspendue et les données sont conservées, de sorte que
  personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le
  projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF,
  NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud
Billing Catalog ; frais RAD et estimation des crédits quotidiens de
[radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Google Cloud :
supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour le mécanisme de pause/restauration. Les prix changent ; vérifiez chaque
source avant de vous fier à un chiffre.

---

## 1. Vue d'ensemble {#1-overview}

Hoppscotch s'exécute comme une application web monopage statique (servie par
Caddy) dans un déploiement sur GKE Autopilot. Elle est délibérément
**sans état** — pas de base de données, pas de cache, pas de stockage persistant
— de sorte que le déploiement relie un petit ensemble de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods SPA statiques sur le port 3000 ; autoscaling horizontal ; min 1 réplica |
| Image conteneur | Artifact Registry + Cloud Build | Build personnalisé léger `FROM hoppscotch/hoppscotch-frontend`, mis en miroir dans Artifact Registry |
| Ingress | Cloud Load Balancing | Service LoadBalancer externe avec une IP statique réservée par défaut |
| Secrets | Secret Manager | **Aucun spécifique à l'application** — Hoppscotch ne nécessite aucun secret |
| Observabilité | Cloud Logging & Monitoring | Journaux de pods, métriques GKE, vérification de disponibilité et alertes optionnelles |

Services délibérément **non** utilisés : **Cloud SQL** (`database_type = "NONE"`,
appliqué par une garde au moment du plan), **Cloud Storage** (pas de buckets),
et **Redis** (désactivé par défaut ; le frontend statique n'a pas de
limitation de débit côté serveur ou de file d'attente à sauvegarder).

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de base de données, jamais — et c'est appliqué.** `database_type = "NONE"` et
  `enable_cloudsql_volume = false`. Une précondition au moment du plan (`validation.tf`)
  **échoue le plan** si `database_type` est défini sur autre chose que
  `NONE`, de sorte qu'un opérateur ne peut pas provisionner
  accidentellement une instance Cloud SQL inutilisée. Hoppscotch conserve tout
  l'état dans le **stockage local du navigateur**.
- **L'image uniquement frontend est utilisée à dessein.** L'image tout-en-un
  `hoppscotch/hoppscotch` regroupe un backend NestJS qui `exit(1)` sans
  `DATABASE_URL`. Ce module utilise `hoppscotch/hoppscotch-frontend`, qui sert le
  SPA sur le port 3000 sans exigence de backend.
- **`HOPPSCOTCH_VERSION`, pas `APP_VERSION`, épingle l'image.** Un build
  personnalisé définit un ARG `HOPPSCOTCH_VERSION` spécifique à l'application
  afin que le `APP_VERSION` injecté de la Fondation ne
  remplace pas le tag ; `application_version = "latest"` se résout en un tag épinglé et
  connu au moment du build.
- **Un LoadBalancer avec une IP statique réservée est la valeur par défaut.**
  `service_type =
  "LoadBalancer"` et `reserve_static_ip = true`, de sorte que l'adresse
  externe survit aux redéploiements.
- **Minimum 1 réplica est maintenu** (`min_instance_count = 1` ; GKE ne prend pas en charge
  l'échelle zéro), gardant le SPA toujours accessible. `max_instance_count = 3`
  par défaut et peut être augmenté en toute sécurité — il n'y a pas d'état
  partagé à coordonner.
- **Un déploiement sans état, pas un StatefulSet.** `workload_type` est
  non défini (se résout en `Deployment`) et `stateful_pvc_enabled` est
  non défini ; le SPA n'a pas besoin de volume par pod.
- **`session_affinity = "None"`.** Le bundle statique est identique sur chaque pod,
  donc le routage sticky est inutile.
- **Aucun secret et aucun bucket de stockage** ne sont provisionnés par ce
  module.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Hoppscotch {#a-gke-autopilot--the-hoppscotch-workload}

Les pods Hoppscotch sont planifiés sur Autopilot, qui facture le CPU/la mémoire
réellement demandés par les pods. L'autoscaling horizontal des pods dimensionne
le déploiement entre le nombre minimal (`1`) et maximal de réplicas. Le
conteneur écoute sur le **port 3000** et répond `GET /` avec l'interface
utilisateur de l'application (HTTP 200).

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge
  de travail Hoppscotch pour voir les pods et les événements. Kubernetes Engine
  → Services et Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de l'autoscaling et du
type de charge de travail (Déploiement vs StatefulSet).

### B. Image conteneur — Artifact Registry et Cloud Build {#b-container-image--artifact-registry--cloud-build}

Parce que `container_image_source = "custom"`, l'image est construite par Cloud Build à partir
du build léger `Dockerfile` (`FROM hoppscotch/hoppscotch-frontend:${HOPPSCOTCH_VERSION}`)
et poussée vers Artifact Registry (la mise en miroir d'images est activée par
défaut). Les images personnalisées/mises en miroir sont tirées avec
`imagePullPolicy=Always` sur GKE afin qu'un tag reconstruit ne soit jamais servi
obsolète à partir d'un cache de nœud.

- **Console :** Artifact Registry → Dépôts ; Cloud Build → Historique.
- **CLI :**
  ```bash
  gcloud builds list --project "$PROJECT" --region "$REGION" --limit 5
  gcloud artifacts docker images list \
    "$REGION-docker.pkg.dev/$PROJECT/<repo>" --project "$PROJECT" \
    --include-tags --filter="package~hoppscotch"
  # Confirm the image the running pod actually pulled:
  kubectl get deploy -n "$NAMESPACE" -o jsonpath='{.items[0].spec.template.spec.containers[0].image}'
  ```

### C. Secret Manager {#c-secret-manager}

Hoppscotch ne provisionne **aucun secret d'application** — `secret_ids` est vide,
donc aucun volume Secret Store CSI n'est monté pour ce module. Vous pouvez
toujours mapper vos propres références de variables d'environnement vers des
secrets via `secret_environment_variables` si vous étendez le déploiement, mais rien n'est
requis.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~hoppscotch"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store
CSI.

### D. Réseau et ingress {#d-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe de Cloud Load
Balancing (`service_type = "LoadBalancer"`), et une IP statique est réservée
(`reserve_static_ip = true`) afin que l'adresse survive aux redéploiements. Un domaine
personnalisé avec un certificat géré par Google peut être activé.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses
  IP.
- **CLI :**
  ```bash
  kubectl get svc -n "$NAMESPACE"                       # EXTERNAL-IP of the LoadBalancer
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails des IP statiques.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les sorties standard/erreur des pods sont envoyées à Cloud Logging ; les
métriques GKE sont envoyées à Cloud Monitoring. Des vérifications de
disponibilité optionnelles (contre l'hôte LoadBalancer) et des politiques
d'alerte sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Hoppscotch {#3-hoppscotch-application-behaviour}

- **Pas de configuration de base de données au premier déploiement.** Il n'y a
  pas de job `db-init`, pas d'instance Cloud SQL et pas de schéma. Les pods
  servent un bundle statique immédiatement.
- **Pas de persistance côté serveur.** Les collections, les environnements,
  l'historique des requêtes et les paramètres résident dans le **stockage local
  du navigateur** sur la machine de chaque utilisateur. Le redémarrage des pods,
  la mise à l'échelle ou le redéploiement ne perdent aucune donnée utilisateur
  — il n'y en a pas sur le serveur à perdre. Comme le SPA est sans état, la
  stratégie par défaut `RollingUpdate` est sûre (pas de verrouillage NFS/DB partagé
  pour provoquer un interblocage).
- **Pas de clés immuables.** Sans secrets ni base de données, il n'y a pas de
  matériel cryptographique qui pourrait corrompre les données stockées s'il
  était modifié.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent la racine
  `/`, qui renvoie l'interface utilisateur de l'application (HTTP 200)
  dès que Caddy lie le port 3000 — généralement en quelques secondes. Une sonde
  défaillante signifie presque toujours que le tag de l'image est invalide, et
  non qu'un backend est inaccessible.
- **Pas de compte administrateur au premier démarrage.** Le frontend auto-hébergé
  n'a pas de gestion de connexion ou d'utilisateur propre ; naviguez vers l'IP
  du LoadBalancer et commencez à construire des requêtes. (Les espaces de travail
  d'équipe, qui nécessitent le backend + la base de données, sont
  intentionnellement hors du champ d'application de ce module.)
- **La mise à l'échelle est illimitée.** Sans file d'attente ou base de données
  partagée, n'importe quel nombre de pods s'exécute indépendamment — augmentez
  `max_instance_count` librement comme plafond de débit.
- **Vérifiez la charge de travail en cours d'exécution :**
  ```bash
  kubectl get deploy,pods -n "$NAMESPACE"
  EXTERNAL_IP=$(kubectl get svc -n "$NAMESPACE" -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')
  curl -sS -o /dev/null -w '%{http_code}\n' "http://$EXTERNAL_IP/"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Hoppscotch sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut
standards.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `hoppscotch` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image Hoppscotch ; `latest` se résout en un tag `hoppscotch-frontend` épinglé et connu au moment du build. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure de support. |
| `container_image_source` | `custom` | Build personnalisé léger `FROM hoppscotch/hoppscotch-frontend`. Conservez `custom`. |
| `container_port` | `3000` | Le port sur lequel le SPA frontend écoute. |
| `min_instance_count` | `1` | Réplicas minimum ; GKE n'a pas d'échelle zéro, donc gardez ≥ 1. |
| `max_instance_count` | `3` | Réplicas maximum ; peut être augmenté en toute sécurité (pas d'état partagé). |
| `enable_cloudsql_volume` | `false` | Hoppscotch n'a pas de base de données — laissez `false`. |
| `enable_image_mirroring` | `true` | Mettez l'image en miroir dans Artifact Registry (évite les limites de Docker Hub). |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Variables d'environnement de texte brut supplémentaires facultatives. Aucune n'est requise. |
| `secret_environment_variables` | `{}` | Références facultatives de variables d'environnement → Secret Manager. Aucune n'est requise. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Le LoadBalancer externe expose le SPA. |
| `workload_type` | `null` (→ `Deployment`) | Déploiement sans état ; pas de StatefulSet nécessaire. |
| `session_affinity` | `None` | Le bundle statique est identique sur chaque pod ; aucune persistance requise. |
| `reserve_static_ip` | `true` | Conservez une IP externe stable lors des redéploiements. |
| `namespace_name` | `""` | Espace de noms Kubernetes pour la charge de travail. Généré automatiquement à partir de `application_name` et `tenant_id` lorsqu'il est vide. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Laissez non défini — Hoppscotch est sans état et n'a pas besoin de PVC par pod. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 15 — Cache et file d'attente Redis {#group-15--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Désactivé par défaut. Le frontend statique n'a pas de file d'attente ou de limiteur de débit côté serveur, donc laissez désactivé. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Pertinent uniquement si vous connectez Redis à des fins personnalisées. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | **Doit rester `NONE`.** Une garde au moment du plan échoue le plan si elle est définie sur un moteur. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen
le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Carte des ClusterIPs pour les services spécifiques à la phase. |
| `service_external_ip` | IP du LoadBalancer externe (une IP statique est réservée par défaut). |
| `service_url` | URL pour atteindre Hoppscotch. |
| `storage_buckets` | Buckets Cloud Storage créés (vides — Hoppscotch est sans état). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` | Noms des jobs de configuration (vides — pas de bootstrap de base de données). |
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

> **Validation héritée au moment du plan.** Ce module transmet sa configuration
> via le moteur de fondation [App_GKE](App_GKE.md) plus une garde spécifique à
> Hoppscotch (`validation.tf`), qui valide les valeurs *et les combinaisons* au
> moment du plan — `database_type` autre que `NONE`,
> `min_instance_count > max_instance_count`, IAP activé sans identifiants OAuth, `quota_memory_*` sans
> suffixes d'unité binaire. Une configuration invalide échoue le **plan** avec
> une erreur claire et nommée avant la création de toute ressource, de sorte que
> la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'au moment
> de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `database_type` | `NONE` | Élevé | Tout autre moteur échoue le plan (garde) ; si cela passait, cela provisionnerait une instance Cloud SQL inutilisée et facturée. |
| `container_image_source` | `custom` | Élevé | Passer à `prebuilt` déclenche le chemin de build sans image utilisable et laisse les pods tirer un tag inexistant. |
| `application_version` | `latest` ou un vrai tag `hoppscotch-frontend` | Élevé | Un tag invalide fait échouer le Cloud Build ; les pods alors `ImagePullBackOff` ou servent une image obsolète. |
| `container_port` | `3000` | Élevé | Le frontend ne sert que sur le port 3000 ; un port non concordant fait échouer la sonde de démarrage et les pods ne deviennent jamais prêts. |
| `min_instance_count` | `1` | Élevé | GKE nécessite min ≥ 1 ; la garde de validation rejette `0`. Garder 1 maintient le SPA accessible. |
| `enable_cloudsql_volume` | `false` | Moyen | L'activer ajoute un sidecar Auth Proxy pour une base de données qui n'existe pas — coût gaspillé et dépendance inutile. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont des octets et bloquent toute planification de pod dans l'espace de noms. |
| `session_affinity` | `None` | Faible | La persistance n'est pas nécessaire pour un bundle statique identique ; l'activer ne fait que limiter la répartition de la charge. |
| `enable_redis` | `false` | Faible | Le frontend statique n'a pas de file d'attente côté serveur ; l'activation de Redis ajoute des coûts sans avantage. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Hoppscotch
partagée avec la variante Cloud Run est décrite dans
**[Hoppscotch_Common](Hoppscotch_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Hoppscotch sur GKE Autopilot](../labs/Hoppscotch_GKE.md) —
  déployez-le étape par étape, avec les écrans de la console et les commandes à
  chaque étape.
- [Hoppscotch sur Google Cloud Run](Hoppscotch_CloudRun.md) — la même
  application sur Cloud Run, lorsque vous avez besoin de l'autre cible de
  déploiement.
- [Hoppscotch Common — Configuration d'application partagée](Hoppscotch_Common.md)
  — la configuration partagée par les deux cibles de déploiement.
