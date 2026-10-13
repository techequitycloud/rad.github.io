---
title: "Ntfy sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Ntfy sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Ntfy_GKE.md @ e69407af sha256:ab3d402293a6 -->

# Ntfy sur GKE Autopilot {#ntfy-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Ntfy_GKE.png" alt="Ntfy sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

ntfy est un serveur de notifications push pub/sub open source, sous licence Apache 2.0, écrit
en Go. Les applications publient des messages via une API REST/HTTP simple et les clients les reçoivent
instantanément via des flux WebSocket ou Server-Sent-Events (SSE) — aucune base de données externe
n'est requise. Ce module déploie ntfy sur **GKE Autopilot** sur la base de la
fondation [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google
Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud utilisés par ntfy et sur la manière de les explorer et de les exploiter
depuis la Google Cloud Console et la ligne de commande. Pour les mécanismes communs à
toutes les applications GKE — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement —
reportez-vous au [guide de la fondation App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## Ce que coûte Ntfy sur RAD, et comment cela se compare {#what-ntfy-costs-on-rad-and-how-that-compares}

**Le module Ntfy sur GKE Autopilot de RAD coûte environ 40 à 113 US$ par mois, les frais de module étant facturés une seule fois en crédits RAD.** GKE Autopilot convient à Ntfy qui doit rester opérationnel, s'adapter à travers les pods ou fonctionner aux côtés d'autres charges de travail Kubernetes ; pour le coût le plus bas, le [module Cloud Run](Ntfy_CloudRun.md) exécute le même Ntfy pour environ 51 US$ par mois. Si vous n'en avez besoin qu'occasionnellement — une démo, un projet saisonnier, quelque chose que vous évaluez — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits (moins de 1 US$) au lieu de payer pour qu'il reste inactif. Voir **Mettez-le en pause gratuitement**, ci-dessous. Les chiffres sont valables au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

RAD déploie **Ntfy**, qui est open source, il n'y a donc pas de frais de licence par utilisateur. Vous payez pour
trois choses :

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 40 crédits (4 US$ au prix de la recharge) | 36 crédits (10 % de moins) |
| Temps de build | Environ 3-6 crédits par build | Idem |
| Coût de fonctionnement Google Cloud | Facturé par Google à votre propre compte de facturation, environ **40 US$ par mois** pour la configuration par défaut (tableau ci-dessous) — plus si ce n'est pas votre seul cluster Autopilot | Mesuré à l'heure en crédits ; RAD publie **63 crédits par jour**, environ 1 890 par mois (environ 189 US$ au prix de la recharge, 151 US$ au tarif du plan Scale) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 US$ pour une recharge unique, et moins sur un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par chaque application du projet, de sorte qu'une deuxième application n'ajoute pas un deuxième ensemble de ceux-ci.

**Coût de fonctionnement par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Pod GKE Autopilot, 1x vCPU / 0,5 GiB | 34,29 US$ |
| Cloud NAT et réseau | 5 US$ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 US$ |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 |
| **Total** | **environ 40 US$** (environ 113 US$ si ce n'est pas votre seul cluster Autopilot) |

### Comment cela se compare {#how-it-compares}

| Option | Prix | Qui l'exécute |
|---|---|---|
| ntfy.sh, Supporter | 6 $/mois (5 $ facturés annuellement) | Instance hébergée par le mainteneur de ntfy. 2 500 messages/jour, 3 sujets réservés |
| ntfy.sh, Pro | 12 $/mois (10 $ facturés annuellement) | 20 000 messages/jour, 10 sujets réservés |
| ntfy.sh, Business | 25 $/mois (20 $ facturés annuellement) | 50 000 messages/jour, 50 sujets réservés, appels téléphoniques |
| **RAD, Cloud Run, votre propre projet** | **Environ 51 US$**, plus 4 US$ une fois par déploiement | L'automatisation de RAD, dans votre projet |
| **RAD, Cloud Run, un projet géré par RAD** | **Environ 750 crédits (60–75 US$)** | RAD |
| RAD, GKE Autopilot | Voir le [guide GKE](Ntfy_GKE.md) | RAD |

Le mainteneur de ntfy vend exactement cela — une copie hébergée du même serveur open source — c'est donc la comparaison la plus juste disponible. **La version auto-hébergée gratuite n'a aucune limite de messages**, ce qui est la raison habituelle de l'auto-hébergement plutôt que de l'abonnement : une intégration très active peut dépasser même les 50 000 messages/jour du plan Business, tandis que le propre projet de RAD n'a pas de tel plafond.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Ntfy s'exécute dans **un projet géré par RAD pour vous**, vous avez une deuxième option qui va bien
au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour presque
rien.** Cela convient bien mieux à Ntfy dont vous n'avez besoin qu'occasionnellement — une démo, une évaluation, un projet
saisonnier — que de le faire fonctionner en continu.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de
  supprimer le projet. Google ne supprime pas le projet immédiatement : il le conserve, récupérable,
  pendant 30 jours. Comme la facturation est déjà déliée, rien n'est facturé pendant qu'il attend. Contrairement
  à la suppression d'un module, cela ne démantèle pas le cluster ou la ressource de calcul
  un par un — l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte quelques crédits, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet peut le restaurer.
  RAD demande à Google de restaurer le projet et de rattacher son compte de facturation, puis vous demande de
  lancer **Update** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été
  individuellement détruit, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une
  reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela coûte environ une poignée de crédits (moins de 1 US$) au
  total pour une chaîne de déploiement typique de 2-3.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, pas 40 US$.** Déployez Ntfy, utilisez-le
  pendant un certain temps, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Update, et
  supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez les frais de module qu'une seule fois, les builds, et le temps
  pendant lequel Ntfy était réellement actif.
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet que vous apportez et dont RAD ne gère que la facturation),
  et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime définitivement.
  La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés doit toujours dépasser
  le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude et de démo conviennent). Google dit que la plupart
  des services fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.
- **Un véritable manque : les sauvegardes nocturnes ne survivent pas.** Les sauvegardes sont écrites dans un bucket à l'intérieur du
  projet, et ce bucket n'est **pas** protégé par la suppression logicielle de Cloud Storage, il est donc très probable
  qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30
  jours. Si vous avez personnalisé Ntfy et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive,
  ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien
  d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours
passée, la façon d'arrêter de payer est de supprimer le déploiement et de le déployer à nouveau lorsque vous
en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ 45
  crédits (4,50 US$) dans votre propre projet, ou 41
  crédits dans un projet géré par RAD. La suppression permet d'économiser de l'argent une fois que Ntfy resterait autrement inutilisé pendant
  environ 3 jours ou plus dans votre propre projet (environ 1,34 US$ par
  jour), ou environ 1 jour ou plus dans un projet géré par RAD (63 crédits par
  jour).
- **La majeure partie du coût de fonctionnement est généralement la base de données et toute VM de fichier/cache partagée.** Elles ne s'arrêtent que
  lorsque rien d'autre dans le projet ne les utilise, donc la suppression de Ntfy alors que quelque chose d'autre partage le
  projet n'économise que la partie calcul de cette application.
- **Gardez vos données en premier.** Les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées
  avec lui, donc copiez la dernière sauvegarde avant de supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant reçoit
  Ntfy dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par
  le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne.
  Tout est supprimé à la fin de la session et les crédits non utilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire exécute Ntfy pour un client à partir d'un
  portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation
  est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire remet
  le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par
  carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour la fenêtre de récupération de 30 jours et ce qu'elle dit sur les objets Cloud Storage sans suppression logicielle ; frais RAD et estimations de crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [ntfy.sh](https://ntfy.sh/). Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

ntfy s'exécute comme une seule charge de travail web Go. Le déploiement relie un ensemble délibérément
petit de services Google Cloud — ntfy n'a pas de dépendance propre à une base de données, un cache ou un stockage d'objets :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Déploiement Go unique, 1 vCPU / 512 MiB par défaut |
| Base de données | **Aucune** | `database_type = "NONE"` ; le cache de messages est un fichier SQLite local, aucune provision Cloud SQL |
| Persistance | Disque éphémère (par défaut), NFS, ou PVC de bloc (StatefulSet) | Cache SQLite à `/var/cache/ntfy/cache.db` ; NFS ou PVC pour l'historique durable |
| Stockage d'objets | **Aucun** | ntfy ne stocke rien dans Cloud Storage |
| Cache / file d'attente | **Aucun** | Pas de Redis ; ntfy utilise un bus de messages in-process |
| Secrets | Secret Manager | Pas de secrets auto-générés ; seulement `secret_environment_variables` fournis par l'utilisateur |
| Ingress | Cloud Load Balancing | Service LoadBalancer externe ; domaine personnalisé facultatif + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Aucune base de données n'est provisionnée.** `database_type = "NONE"` — ntfy conserve son cache de messages
  dans un fichier SQLite local. Les variables liées à la base de données existent pour
  être complètes mais sont inertes à moins que vous n'optiez délibérément pour une base de données externe.
- **Déploiement sans état par défaut.** `workload_type = "Deployment"` avec un cache SQLite **éphémère**
  à `/var/cache/ntfy/cache.db`. L'historique des messages est perdu
  lorsqu'un pod redémarre. Pour la durabilité, activez NFS (`enable_nfs = true`) ou
  passez à un **PVC de bloc StatefulSet** (`stateful_pvc_enabled = true` avec
  `stateful_pvc_mount_path = "/var/cache/ntfy"`).
- **Réplica unique par défaut** (`min_instance_count = 1`, `max_instance_count = 1`).
  Le flux d'un abonné est ancré au pod qui le contient et il n'y a pas de bus de messages partagé,
  donc la mise à l'échelle n'est pas la valeur par défaut. Gardez le maximum à 1 à moins que vous ne placiez un
  cache/broker partagé derrière ntfy.
- **Exposé via un service LoadBalancer** (`service_type = "LoadBalancer"`,
  `reserve_static_ip = true`, `enable_custom_domain = true`), afin que les éditeurs et
  les abonnés puissent l'atteindre depuis l'extérieur du cluster.
- **Le point de terminaison de santé est `/v1/health`**, qui renvoie `{"healthy":true}` avec HTTP
  200 dès que le serveur lie son port.
- **La variante GKE s'exécute dans son propre espace de noms de locataire.** `Ntfy_GKE` ajoute `-gke` à
  `tenant_id`, de sorte qu'il peut coexister avec `Ntfy_CloudRun` sur le même locataire
  sans collision de noms.
- **Le contrôle d'accès est une étape post-déploiement.** ntfy est livré avec un accès ouvert ; configurez
  les utilisateurs et les ACL de sujets par la suite via son CLI ou les variables d'environnement `NTFY_AUTH_*`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et d'autres
identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail ntfy {#a-gke-autopilot--the-ntfy-workload}

Les pods ntfy sont planifiés sur Autopilot, qui facture le CPU/la mémoire que les pods
demandent réellement. Par défaut, la charge de travail est un `Deployment` sans état avec un seul
réplica ; le passage à un `StatefulSet` provisionne un PVC de bloc par pod pour un historique
de messages durable.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail ntfy pour voir les pods
  et les événements. Kubernetes Engine → Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl get statefulset -n "$NAMESPACE"          # when stateful_pvc_enabled = true
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de charge de travail
(Deployment vs StatefulSet).

### B. Persistance — le cache de messages SQLite {#b-persistence--the-sqlite-message-cache}

ntfy n'a **pas d'instance Cloud SQL**. Son cache de messages est un fichier SQLite local à
`NTFY_CACHE_FILE` (`/var/cache/ntfy/cache.db`), créé par le point d'entrée au démarrage.
Avec le déploiement sans état par défaut, le cache est **éphémère** — l'historique des messages
ne survit pas à un redémarrage de pod. Deux façons de le rendre durable :

- **NFS (Filestore) :** `enable_nfs = true`, et pointez le répertoire du cache vers le
  montage.
- **PVC de bloc StatefulSet :** `stateful_pvc_enabled = true` avec
  `stateful_pvc_mount_path = "/var/cache/ntfy"` — un disque persistant par pod contient la
  base de données du cache.

- **Console :** Filestore → Instances (NFS) ; Kubernetes Engine → Storage →
  PersistentVolumeClaims (PVC de bloc).
- **CLI :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"                                   # StatefulSet PVCs
  kubectl exec -n "$NAMESPACE" <pod> -- ls -l /var/cache/ntfy       # cache location
  ```

Voir [App_GKE](App_GKE.md) pour les modèles NFS et StatefulSet PVC.

### C. Secret Manager {#c-secret-manager}

ntfy ne génère **aucun** secret au moment du déploiement — il n'y a pas de mot de passe de base de données ou
de clé de chiffrement à gérer. Secret Manager n'est utilisé que si vous fournissez le vôtre via
`secret_environment_variables` (par exemple une valeur `NTFY_AUTH_*` ou une
crential de push en amont).

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store CSI.

### D. Réseau et ingress {#d-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe Cloud Load Balancing via un
service LoadBalancer. Un domaine personnalisé avec un certificat géré par Google peut être
activé, et une IP statique est réservée par défaut afin que l'adresse survive aux redéploiements.
Si les clients utilisent le streaming HTTP/2, définissez `container_protocol = "h2c"`.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails de l'IP statique.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les métriques GKE sont acheminées vers Cloud Monitoring.
Des vérifications de disponibilité et des politiques d'alerte facultatives sont disponibles. ntfy enregistre son
adresse d'écoute et le chemin de cache résolu au démarrage.

- **Console :** Logging → Logs Explorer ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Ntfy {#3-ntfy-application-behaviour}

- **Pas de configuration de base de données au premier déploiement.** ntfy n'a pas de base de données externe et pas d'étape de migration.
  Le point d'entrée prépare le répertoire du cache SQLite et exécute immédiatement
  `ntfy serve`. Il n'y a pas de job `db-init` par défaut.
- **La persistance dépend du type de charge de travail.** Un `Deployment` sans état utilise un
  cache éphémère ; un `StatefulSet` avec un PVC de bloc (ou un montage NFS) rend l'historique des messages
  durable à travers les redémarrages de pod.
- **`imagePullPolicy = Always` pour l'image personnalisée.** App_GKE définit cela pour
  les images personnalisées/miroirs afin qu'une reconstruction et un redéploiement sous une balise inchangée tirent
  les nouvelles couches plutôt que de servir un cache de nœud obsolète.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/v1/health`, qui renvoie
  `{"healthy":true}` et HTTP 200 dès que le serveur lie le port 80. Vérifiez depuis
  l'intérieur du cluster :
  ```bash
  kubectl run curl --rm -it --image=curlimages/curl -n "$NAMESPACE" -- \
    curl -s http://<service-name>.$NAMESPACE.svc.cluster.local/v1/health   # {"healthy":true}
  ```
- **Test de fumée de publication / abonnement** (contre l'IP externe) :
  ```bash
  EXTERNAL_IP=$(kubectl get svc <service-name> -n "$NAMESPACE" \
    -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
  curl -d "hello from ntfy" "http://$EXTERNAL_IP/mytopic"    # publish
  ```
- **L'accès est ouvert jusqu'à ce que vous le verrouilliez.** Par défaut, tout client peut publier et
  s'abonner à n'importe quel sujet. Configurez les utilisateurs et les ACL par sujet après le déploiement via le
  CLI de ntfy (`ntfy user add`, `ntfy access`) ou les variables d'environnement `NTFY_AUTH_*`.
- **URL de base publique pour les pièces jointes / push web.** Si vous utilisez des pièces jointes ou le
  push web du navigateur, définissez `NTFY_BASE_URL` (via `environment_variables`) sur l'URL externe afin
  que les liens générés se résolvent correctement.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls
les paramètres spécifiques ou notables pour ntfy sont listés ; toute autre entrée est héritée
de [App_GKE](App_GKE.md) avec son comportement standard et ses valeurs par défaut.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 / 3 — Environnement de déploiement et identité de l'application {#group-2--3--deployment-environment--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court ; `Ntfy_GKE` ajoute `-gke` en interne afin qu'il puisse coexister avec la variante Cloud Run. |
| `application_name` | `ntfy` | Nom de base pour les ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag de version d'image ; `latest` correspond à une base `v2.11.0` épinglée. Épinglez `v2.x.y` en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | `custom` construit l'image wrapper via Cloud Build ; `prebuilt` déploie une image directement. |
| `min_instance_count` | `1` | Réplicas minimum (GKE n'a pas de mise à l'échelle à zéro). |
| `max_instance_count` | `1` | **Gardez à 1** — les flux sont locaux au pod sans broker partagé. |
| `container_resources` | `{ cpu_limit="1000m", memory_limit="512Mi" }` | CPU/mémoire par pod. |
| `container_port` | `80` | ntfy écoute sur le port 80. |
| `container_protocol` | `http1` | Définissez `h2c` pour le streaming HTTP/2 de bout en bout. |
| `workload_type` | `Deployment` | Par défaut sans état ; `StatefulSet` pour un PVC par pod durable. |
| `enable_cloudsql_volume` | `false` | Désactivé — ntfy n'a pas de base de données. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image ntfy dans Artifact Registry. |

### Groupe 5 — Identity-Aware Proxy (IAP) {#group-5--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google. **Bloque la publication/abonnement non authentifié.** Nécessite `iap_oauth_client_id` / `_secret`. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres `NTFY_*` supplémentaires (par exemple `NTFY_BASE_URL`, `NTFY_AUTH_DEFAULT_ACCESS`). |
| `secret_environment_variables` | `{}` | Mappage variable d'environnement → nom de secret Secret Manager (facultatif ; aucun requis). |

### Groupe 6 — Cluster GKE {#group-6--gke-cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `gke_cluster_name` | `""` | Laissez vide pour découvrir automatiquement le cluster Services_GCP. |
| `service_type` | `LoadBalancer` | Comment le service est exposé. |
| `session_affinity` | `None` | Définissez `ClientIP` pour épingler le flux d'un client à un pod si vous mettez à l'échelle les réplicas. |

### Groupe 7 — StatefulSet (historique de messages durable) {#group-7--statefulset-durable-message-history}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Définissez `true` pour un PVC de bloc par pod — cache de messages durable à travers les redémarrages. |
| `stateful_pvc_size` | `10Gi` | Taille de stockage PVC par pod. |
| `stateful_pvc_mount_path` | `/var/cache/ntfy` | Chemin de montage ; correspond au répertoire de `NTFY_CACHE_FILE`. |
| `stateful_pvc_storage_class` | `standard-rwo` | StorageClass pour le PVC. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protège la disponibilité pendant les mises à niveau de nœuds. |
| `pdb_min_available` | `1` | Nombre minimum de pods disponibles pendant les perturbations volontaires. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/v1/health` | Sonde de démarrage. ntfy devient sain en quelques secondes. |
| `health_check_config` | HTTP `/v1/health` | Sonde de vivacité. |
| `uptime_check_config` | désactivé | Vérification de disponibilité Cloud Monitoring facultative. |

### Groupe 13 / 14 — Système de fichiers et Cloud Storage {#group-13--14--filesystem--cloud-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Activez pour sauvegarder le cache SQLite avec NFS pour un historique durable (alternative à un PVC). |
| `nfs_mount_path` | `/var/cache/ntfy` | Chemin de montage NFS. |
| `storage_buckets` | `[]` | Non requis — ntfy n'utilise pas de stockage d'objets. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | ntfy n'a pas de base de données externe ; laissez `NONE`. |
| `application_database_name` / `application_database_user` | `ntfy` | Inerte à moins qu'une base de données externe ne soit délibérément activée. |

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Non requis — ntfy n'a pas de dépendance Redis. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner Ingress pour les noms d'hôte personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable à travers les redéploiements. |

Toutes les autres entrées suivent le comportement standard de [App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de
localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Mappage des ClusterIPs pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre ntfy. |
| `database_instance_name` / `database_name` / `database_user` | Identifiants de base de données — vides pour le moteur `NONE` par défaut. |
| `database_password_secret` / `database_host` / `database_port` | Champs de point de terminaison de base de données — inutilisés pour `NONE`. |
| `storage_buckets` | Buckets Cloud Storage créés (aucun par défaut). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'importation (aucun par défaut). |
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

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur de fondation [App_GKE](App_GKE.md), qui valide les valeurs *et les combinaisons* au moment du plan — IAP sans identifiants OAuth, `enable_cloudsql_volume = true` avec `database_type = "NONE"`, `min_instance_count > max_instance_count`, `quota_memory_*` sans unités binaires. La propre `validation.tf` de la variante GKE applique ces protections. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant qu'aucune ressource ne soit créée, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'au moment de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `stateful_pvc_enabled` / `enable_nfs` (pour l'historique durable) | Activez l'un d'eux lorsque l'historique est important | Élevé | Avec le déploiement sans état par défaut et le cache éphémère, tout l'historique des messages est perdu à chaque redémarrage de pod. |
| `stateful_pvc_mount_path` | `/var/cache/ntfy` | Élevé | Monter le PVC ailleurs que dans le répertoire `NTFY_CACHE_FILE` persiste le mauvais chemin et le cache reste éphémère. |
| `max_instance_count` | `1` | Élevé | La mise à l'échelle au-delà de 1 divise les abonnés entre les pods sans bus partagé, de sorte qu'un message publié sur un pod n'est pas livré aux abonnés sur un autre. |
| `enable_cloudsql_volume` | `false` | Élevé | Définir `true` avec `database_type = "NONE"` démarre un sidecar Auth Proxy sans instance à atteindre — rejeté par la protection au moment du plan. |
| `session_affinity` | `ClientIP` si vous mettez à l'échelle | Élevé | Sans persistance, un abonné qui se reconnecte atterrit sur un pod différent et manque les messages mis en cache détenus par le pod d'origine. |
| `enable_iap` | uniquement lorsque l'authentification est activée | Élevé | IAP nécessite une connexion Google pour chaque requête, bloquant la publication/abonnement non authentifié. |
| `min_instance_count` | `1` | Élevé | GKE exige min ≥ 1 ; la protection de validation rejette les valeurs invalides, et 0 ne laisserait aucun pod pour contenir les flux. |
| `NTFY_BASE_URL` | URL externe réelle | Moyen | Non défini, les liens de pièce jointe et de push web se résolvent vers le mauvais hôte. |
| Contrôle d'accès ntfy | Configurer après le déploiement | Moyen | Par défaut, tout client peut publier et s'abonner à n'importe quel sujet sur une IP publique. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont des octets et bloquent toute planification de pod dans l'espace de noms. |
| `enable_pod_disruption_budget` | `true` | Moyen | La désactivation permet à GKE d'expulser tous les pods simultanément pendant la maintenance. |
| `application_version` | Épinglez `v2.x.y` en production | Faible | `latest` correspond à une base épinglée (`v2.11.0`) ; épinglez explicitement pour contrôler les mises à niveau. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**.
La configuration d'application spécifique à ntfy partagée avec la variante Cloud Run est
décrite dans **[Ntfy_Common](Ntfy_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Ntfy sur GKE Autopilot](../labs/Ntfy_GKE.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [Ntfy sur Google Cloud Run](Ntfy_CloudRun.md) — la même application sur Cloud Run, pour lorsque vous avez besoin de l'autre cible de déploiement.
- [Ntfy Common — Configuration d'application partagée](Ntfy_Common.md) — la configuration partagée par les deux cibles de déploiement.
