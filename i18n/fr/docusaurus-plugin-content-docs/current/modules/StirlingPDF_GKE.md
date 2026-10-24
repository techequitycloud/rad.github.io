---
title: "Stirling-PDF sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Stirling-PDF sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/StirlingPDF_GKE.md @ e69407af sha256:077d13dd6e80 -->

# Stirling-PDF sur GKE Autopilot {#stirling-pdf-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/StirlingPDF_GKE.png" alt="Stirling-PDF sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Stirling-PDF est une boîte à outils PDF web open-source (noyau sous licence MIT), hébergée localement — fusionner, diviser, convertir, OCR, compresser, filigraner, signer, caviarder et plus de 50 autres opérations PDF, toutes traitées sur votre propre infrastructure afin que les documents ne touchent jamais un service tiers. Ce module déploie Stirling-PDF sur **GKE Autopilot** au-dessus de la fondation [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud que Stirling-PDF utilise et sur la manière de les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à toutes les applications GKE — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls et le cycle de vie du déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## Ce que coûte Stirling-PDF sur RAD, et comment cela se compare {#what-stirling-pdf-costs-on-rad-and-how-that-compares}

**Le module GKE Autopilot de Stirling-PDF sur RAD coûte environ 45,68 $ US par mois dans un projet Google Cloud que vous possédez, les frais de module étant facturés une seule fois en crédits RAD.** GKE convient à Stirling-PDF qui doit être placé à côté d'autres charges de travail Kubernetes ; pour le coût le plus bas, le [module Cloud Run](StirlingPDF_CloudRun.md) exécute le même Stirling-PDF pour environ 19,16 $ US par mois. Si vous n'en avez besoin qu'occasionnellement — un lot de documents, un job de conversion unique — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits (moins de 1 $ US) au lieu de payer pour qu'il reste inactif. Voir **Mettez-le en pause gratuitement**, ci-dessous. Les chiffres sont ceux du 8 octobre 2026 ; les sources sont listées à la fin de cette section.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 40 crédits (4 $ US au prix de la recharge) | 36 crédits (10 % de moins) |
| Temps de build | Environ 3-6 crédits par build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **45,68 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **64 crédits par jour**, soit environ 1 920 par mois |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge ponctuelle, et moins avec un plan mensuel. Dans un projet géré par RAD, le réseau est partagé par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas un deuxième ensemble de ressources réseau.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Pod GKE Autopilot, 1x vCPU / 2 Gio | 39,68 $ US |
| Cloud NAT et réseau | 5,00 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ US |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 |
| **Total** | **45,68 $ US** |

### Comment cela se compare {#how-it-compares}

- Le plan hébergé de Stirling PDF, **Stirling PDF Team**, coûte **99 $/mois pour un maximum de 100 utilisateurs** sur son SaaS hébergé — un coût par organisation destiné aux équipes, et non un coût d'infrastructure (source : [stirling.com/pricing](https://www.stirling.com/pricing)). Le chiffre de RAD pour un projet propre est une petite fraction de cela car il s'agit du coût de calcul GKE brut sans frais de logiciel par utilisateur.
- Une comparaison autogérée : Hetzner CPX22 (2 vCPU/4 Go) coûte environ 24 $/mois, un Droplet DigitalOcean 2 vCPU/4 Go coûte le même prix de 24 $/mois, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) coûte environ 49 $/mois — dans la même fourchette que le chiffre GKE de RAD pour un projet propre une fois les frais de cluster partagés exclus, et tous doivent être mis à jour manuellement, ce que Secret Manager et la surveillance gérés par RAD couvrent autrement.
- Sans base de données et sans état persistant, Stirling-PDF est proche du coût minimum de tout déploiement GKE sur RAD — presque toute la facture est le pod lui-même plus les frais de gestion de cluster partagés.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Stirling-PDF s'exécute dans un projet que RAD gère pour vous, la suppression de l'ensemble du projet délie d'abord sa facturation, puis demande à Google de supprimer purement et simplement le projet — la suppression logicielle récupérable de 30 jours de Google. Contrairement à la suppression d'un module, cela ne démantèle pas les ressources de calcul une par une : l'ensemble du projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de restaurer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter la mise à jour sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits (moins de 1 $ US) au total pour une chaîne typique de 2-3 déploiements.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD gère uniquement la facturation), vous devez le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est admise comme la création d'un nouveau projet, de sorte que votre solde de crédits achetés doit toujours dépasser le seuil du palier (100 crédits pour le palier sandbox qui convient à la plupart des utilisations d'étude/démo). Google indique que la plupart des services sont de nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Stirling-PDF lui-même ne contient pas de base de données, donc pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que la fenêtre de restauration de 30 jours est passée, l'alternative est de supprimer Stirling-PDF purement et simplement et de le redéployer plus tard. Un redéploiement coûte à nouveau les frais de module, plus les builds — environ 45 crédits (environ 4,50 $ US) dans votre propre projet, ou 41 crédits dans un projet géré par RAD.

La suppression ne permet d'économiser de l'argent que si Stirling-PDF reste inutilisé suffisamment longtemps pour compenser ce coût de redéploiement par rapport à son propre coût d'exécution quotidien — par rapport au total du projet propre ci-dessus (environ 1,52 $ US par jour), cela représente environ 3 jours ou plus, ou environ 1 jour ou plus dans un projet géré par RAD (64 crédits par jour). Il n'y a pas de base de données ici, donc la suppression de cette application libère l'intégralité de son coût d'exécution plutôt qu'une simple part — seuls les frais de cluster partagés, le cas échéant, continuent de s'appliquer aux autres applications.

Conservez d'abord les données : tout ce que Stirling-PDF écrit dans un bucket de sauvegarde à l'intérieur du déploiement est supprimé avec lui, alors copiez tout ce que vous voulez conserver avant de supprimer.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour une classe. Chaque participant obtient l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil :** un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les propres frais de RAD et les estimations de crédits quotidiens ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les mécanismes de pause/restauration ; [stirling.com/pricing](https://www.stirling.com/pricing) pour le prix hébergé de Stirling PDF Team.

## 1. Vue d'ensemble {#1-overview}

Stirling-PDF s'exécute comme une charge de travail web Java / Spring Boot (avec un LibreOffice intégré pour les conversions de documents). Le déploiement relie un ensemble délibérément restreint de services Google Cloud — Stirling-PDF est sans état, il n'y a donc pas de base de données, pas de stockage persistant et pas de secrets à gérer :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods Java, 1 vCPU / 2 Gio par défaut, mise à l'échelle horizontale automatique |
| Image conteneur | Artifact Registry | Image officielle `stirlingtools/stirling-pdf`, mise en miroir par défaut |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé optionnel + certificat géré |
| Redis (inerte) | Redis | Désactivé par défaut. `enable_redis` ne fait qu'injecter par la Fondation les variables d'environnement `REDIS_*` — Stirling-PDF ne les lit jamais, donc cela ne fournit aucune limitation de débit ou détection de bot |
| Observabilité | Cloud Logging / Cloud Monitoring | Journaux de pods, métriques, vérification de disponibilité et alertes optionnelles |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Sans état — pas de base de données, pas de stockage, pas de secrets.** `database_type = "NONE"`,
  pas de buckets GCS, pas de NFS, `workload_type = Deployment`, et une carte de secrets vide.
  Chaque opération PDF s'exécute dans un répertoire de travail éphémère par requête, supprimé
  à la fin.
- **Image pré-construite.** `container_image_source = "prebuilt"` déploie l'image officielle
  `stirlingtools/stirling-pdf` directement ; `enable_image_mirroring = true`
  la met en miroir dans Artifact Registry pour éviter les limites de débit de Docker Hub.
- **La connexion est désactivée par défaut.** `enable_login = false`
  (`SECURITY_ENABLELOGIN=false`) livre une instance ouverte. Activez-la et placez la
  charge de travail derrière IAP ou Cloud Armor pour un déploiement privé.
- **Minimum 1 réplica.** GKE ne prend pas en charge la mise à l'échelle à zéro ; `min_instance_count = 1`
  maintient la boîte à outils accessible. Comme il n'y a pas d'état partagé, la mise à l'échelle à
  `max_instance_count > 1` ne nécessite aucun mécanisme de coordination — Redis ou
  autre.
- **Plancher de mémoire de 2 Gio.** La JVM plus LibreOffice nécessite au moins `2Gi` ; augmentez
  `container_resources.memory_limit` pour les charges de travail OCR / conversion lourdes.
- **LoadBalancer externe avec une IP stable.** `service_type = "LoadBalancer"`,
  `reserve_static_ip = true`, et `enable_custom_domain = true` par défaut.
- **Les sondes de santé atteignent `/api/v1/info/status`** — un endpoint public, non authentifié
  renvoyant 200 une fois que la JVM et LibreOffice ont été initialisés. L'image complète peut
  prendre 2 à 4 minutes pour lier son port sur un nœud Autopilot provisionné à froid, donc la
  sonde de démarrage autorise une fenêtre d'environ 5 minutes (délai initial de 20s, 30 × 10s échecs).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Stirling-PDF {#a-gke-autopilot--the-stirling-pdf-workload}

Les pods Stirling-PDF sont planifiés sur Autopilot, qui facture le CPU/la mémoire que les
pods demandent réellement. L'autoscaling horizontal des pods dimensionne le déploiement entre le
nombre minimum et maximum de réplicas.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail Stirling-PDF pour
  voir les pods et les événements. Kubernetes Engine → Services et Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de charge de travail
(Deployment vs StatefulSet).

### B. Artifact Registry — l'image conteneur {#b-artifact-registry--the-container-image}

L'image officielle `stirlingtools/stirling-pdf` est mise en miroir dans Artifact Registry
(`enable_image_mirroring = true`) et le cluster la tire de là. Aucune étape Cloud
Build n'est exécutée — l'image est pré-construite en amont.

- **Console :** Artifact Registry → Dépôts.
- **CLI :**
  ```bash
  gcloud artifacts repositories list --project "$PROJECT" --location "$REGION"
  ```

Voir [App_GKE](App_GKE.md) pour le mécanisme de mise en miroir et la rétention des images.

### C. Réseau et ingress {#c-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe de Cloud Load Balancing.
Un domaine personnalisé avec un certificat géré par Google peut être activé, et une IP statique est
réservée par défaut afin que l'adresse survive aux redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails de l'IP statique.

### D. Redis (inerte — enable_redis n'a aucun effet sur l'application) {#d-redis-inert--enable_redis-has-no-application-effect}

Redis est **désactivé par défaut** (`enable_redis = false`). La définition de `enable_redis =
true` ne fait que faire en sorte que la fondation `App_GKE` injecte les variables d'environnement `REDIS_HOST`/`REDIS_PORT`/
`REDIS_AUTH` dans le pod — Stirling-PDF **ne les lit jamais**.
Le propre commentaire de `stirlingpdf.tf` confirme "pas de DB ou Redis", et ni
`StirlingPDF_Common` ni ce module ne mappent ces variables d'environnement dans un paramètre
reconnu par Stirling-PDF. L'activation de Redis **n'implémente pas** de limitation de débit ou de détection de bot pour cette application. Utilisez `enable_cloud_armor` pour
une véritable atténuation des abus sur une instance publique.

- **CLI (pour confirmer que les variables d'environnement sont présentes mais inutilisées) :**
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -i redis
  ```

### E. Identity-Aware Proxy (facultatif) {#e-identity-aware-proxy-optional}

Étant donné que Stirling-PDF traite des documents potentiellement sensibles, un déploiement privé doit protéger l'Ingress avec IAP. L'activation de `enable_iap` nécessite une identité Google authentifiée et autorisée avant que toute requête n'atteigne la charge de travail.

- **Console :** Sécurité → Identity-Aware Proxy.
- **CLI :**
  ```bash
  gcloud iap web get-iam-policy --resource-type=backend-services --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour le câblage OAuth IAP.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les métriques GKE sont acheminées vers Cloud Monitoring.
Des vérifications de disponibilité et des politiques d'alerte optionnelles sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Stirling-PDF {#3-stirling-pdf-application-behaviour}

- **Rien n'est persisté.** Les téléchargements sont écrits dans un répertoire de travail éphémère par requête et supprimés lorsque la réponse est renvoyée. Il n'y a pas de base de données, pas de PVC et pas de bucket — une mise à jour progressive ou une replanification de pod ne perd rien.
- **Premier démarrage lent.** L'image complète regroupe LibreOffice + OCR et peut prendre 2 à 4 minutes pour lier son port sur un nœud Autopilot provisionné à froid. La sonde de démarrage cible `/api/v1/info/status` avec un délai initial de 20s et 30 échecs à des intervalles de 10s (environ 5 minutes au total) avant qu'un pod ne soit marqué comme non sain ; la sonde de vivacité attend un délai initial de 120s afin de ne pas concurrencer la sonde de démarrage en cours de réchauffement.
- **La connexion est facultative et désactivée par défaut.** `enable_login = false` livre une instance ouverte. Définissez `enable_login = true` pour exiger l'authentification intégrée de Stirling-PDF ; combinez avec IAP pour une défense en profondeur.
- **Mise à l'échelle horizontale sûre.** Sans état partagé, `max_instance_count > 1` ne nécessite aucun mécanisme de coordination. `enable_redis` n'a aucun rapport avec cela — c'est un passthrough de la Fondation inerte que Stirling-PDF ne lit jamais (voir §2.D). Le HPA met à l'échelle les réplicas en fonction de la charge CPU/mémoire.
- **Les mises à niveau de version sont des modifications de balises d'image.** La modification de `application_version` déclenche une mise à jour progressive sans étape de migration ; la stratégie RollingUpdate par défaut convient car l'application est sans état.
- **Confirmer la configuration en cours d'exécution :**
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -iE 'SECURITY_|SYSTEM_'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour Stirling-PDF sont listés ; toutes les autres entrées sont héritées de [App_GKE](App_GKE.md) avec son comportement et ses valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails autorisés à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `stirlingpdf` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Stirling-PDF` | Nom lisible par l'homme affiché dans la console. |
| `application_version` | `latest` | Balise d'image Stirling-PDF ; épingler à une version spécifique en production. |
| `enable_login` | `false` | Activer l'authentification intégrée de Stirling-PDF (`SECURITY_ENABLELOGIN`). |
| `default_locale` | `en-US` | Locale par défaut de l'interface utilisateur (`SYSTEM_DEFAULTLOCALE`). |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `prebuilt` | Déployer l'image officielle (`prebuilt`) ou construire une image personnalisée. |
| `container_resources` | `{ cpu_limit="1000m", memory_limit="2Gi" }` | Limites CPU/mémoire ; **plancher de 2 Gio** pour JVM + LibreOffice. |
| `min_instance_count` | `1` | Réplicas minimum ; GKE nécessite ≥ 1. |
| `max_instance_count` | `3` | Réplicas maximum. Sûr à augmenter — pas d'état partagé. |
| `container_port` | `8080` | Stirling-PDF écoute sur le port 8080. |
| `enable_image_mirroring` | `true` | Mettre l'image en miroir dans Artifact Registry. |
| `timeout_seconds` | `60` | Durée maximale de la requête ; augmenter pour les grandes conversions. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres Stirling-PDF supplémentaires (par exemple `SYSTEM_MAXFILESIZE`). La connexion et la locale sont définies via `enable_login` / `default_locale`. |
| `secret_environment_variables` | `{}` | Références Secret Manager. Stirling-PDF n'en a pas besoin par défaut. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service Kubernetes est exposé. |
| `workload_type` | `null` | Se résout automatiquement en un déploiement sans état. StatefulSet est inutile. |
| `session_affinity` | `None` | Stirling-PDF est sans état — aucun routage persistant n'est requis. |
| `network_tags` | `["nfsserver"]` | Balises réseau de nœud/pod. |
| `termination_grace_period_seconds` | `30` | Secondes à attendre après SIGTERM avant SIGKILL. |
| `enable_network_segmentation` | `false` | Créer des ressources Kubernetes NetworkPolicy. |
| `enable_cloudsql_volume` | `false` | Non utilisé — Stirling-PDF n'a pas de base de données. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Laisser désactivé — Stirling-PDF ne stocke aucun état. |
| `stateful_pvc_size` / `stateful_pvc_mount_path` / `stateful_pvc_storage_class` | `10Gi` / `/data` / `standard-rwo` | Pertinent uniquement si un StatefulSet est forcé. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protéger la disponibilité pendant les mises à niveau de nœuds. |
| `pdb_min_available` | `1` | Nombre minimum de pods disponibles pendant les perturbations volontaires. |
| `enable_resource_quota` | `false` | Appliquer un ResourceQuota d'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | Doit utiliser des unités binaires (`4Gi`) — les entiers nus sont des octets et bloquent la planification. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/v1/info/status`, délai de 20s, 30 × 10s tentatives | Sonde de démarrage. Fenêtre de premier démarrage d'environ 5 minutes pour JVM + LibreOffice. |
| `liveness_probe` | HTTP `/api/v1/info/status`, délai de 120s | Sonde de vivacité ; retardée pour passer le démarrage lent. |
| `uptime_check_config` | désactivé | Vérification de disponibilité optionnelle de Cloud Monitoring. |
| `alert_policies` | `[]` | Politiques d'alerte métrique optionnelles. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Aucun requis — Stirling-PDF est sans état. |
| `cron_jobs` | `[]` | CronJobs Kubernetes planifiés. |
| `additional_services` | `[]` | Services sidecar ou auxiliaires. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard App_GKE Cloud Build / Cloud Deploy — voir [App_GKE](App_GKE.md).
Entrées clés : `enable_cicd_trigger`, `github_repository_url`, `github_token`,
`enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS est désactivé par défaut. Activer uniquement si Redis est colocalisé sur la VM du serveur NFS. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `false` | Stirling-PDF est sans état — pas de bucket par défaut. |
| `storage_buckets` | `[]` | Buckets supplémentaires optionnels. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse via le pilote CSI. |
| `max_images_to_retain` | `7` | Nombre maximum d'images Artifact Registry récentes à conserver. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 15 — Redis (passthrough inerte de la Fondation) {#group-15--redis-inert-foundation-passthrough}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Inerte pour Stirling-PDF : ne fait qu'injecter par `App_GKE` les variables d'environnement `REDIS_HOST`/`REDIS_PORT`/`REDIS_AUTH`, que l'application ne lit jamais. Aucune limitation de débit ou détection de bot ne résulte de l'activation de ceci. |
| `redis_host` | `""` | Point de terminaison Redis. Laisser vide pour utiliser l'IP interne du serveur NFS. Inutilisé par Stirling-PDF quelle que soit la valeur. |
| `redis_port` | `6379` | Port Redis. Inutilisé par Stirling-PDF quelle que soit la valeur. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis optionnel (sensible). Inutilisé par Stirling-PDF quelle que soit la valeur. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixe — Stirling-PDF n'utilise pas de base de données. |
| `database_password_length` | `32` | Non utilisé. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner Ingress pour les noms d'hôtes personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôtes à servir. |
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

> **Note :** L'activation d'IAP nécessite une authentification d'identité Google pour toutes les requêtes entrantes. Recommandé pour les instances privées traitant des documents sensibles.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google devant Stirling-PDF. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque IAP est activé (sensible). |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attacher une politique Cloud Armor (WAF) au backend Ingress. Recommandé pour les instances publiques. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à un accès privilégié. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend Ingress GKE. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | Niveaux d'accès CIDR / mode simulation. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Stirling-PDF. |
| `storage_buckets` | Buckets Cloud Storage créés (vides — Stirling-PDF est sans état). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur de la fondation [App_GKE](App_GKE.md), qui valide les valeurs *et les combinaisons* au moment de la planification — IAP sans identités autorisées, un StatefulSet forcé avec un type de charge de travail `Deployment`, `quota_memory_*` en unités non binaires, un `redis_port`/`timeout_seconds` hors plage. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence si erroné |
|---|---|---|---|
| `enable_login` + ingress | `enable_login = true` **ou** IAP pour usage privé | Élevé | Le `enable_login = false` par défaut + LoadBalancer externe laisse une boîte à outils PDF ouverte que toute personne ayant l'IP peut utiliser. |
| `enable_iap` | Activer pour les instances de documents sensibles | Élevé | Sans IAP (et avec la connexion désactivée), la charge de travail n'est pas authentifiée ; les utilisateurs peuvent télécharger des documents confidentiels vers un point de terminaison ouvert. |
| `container_resources.memory_limit` | `2Gi` | Élevé | En dessous de ~2 Gio, la JVM + LibreOffice tue les processus OOM pendant les conversions. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers nus sont des octets et bloquent toute planification de pod dans l'espace de noms. |
| `timeout_seconds` | `60`, augmenter pour les gros fichiers | Élevé | Les gros jobs OCR/conversion dépassant le délai d'attente renvoient 504 en cours d'opération. |
| `min_instance_count` | `1` | Élevé | GKE exige min ≥ 1 ; la garde de validation rejette `0`. |
| Fenêtre `startup_probe` | Conserver la valeur par défaut d'environ 5 minutes | Moyen | La raccourcir marque les pods comme non sains avant que LibreOffice ne finisse de se réchauffer, bloquant le déploiement. |
| `enable_cloud_armor` | Activer pour les instances publiques | Moyen | Une boîte à outils publique sans WAF est exposée aux abus et aux analyses. |
| `enable_pod_disruption_budget` | `true` | Moyen | La désactivation permet à GKE d'expulser tous les pods simultanément pendant la maintenance. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**.
La configuration d'application spécifique à Stirling-PDF partagée avec la variante Cloud Run est
décrite dans **[StirlingPDF_Common](StirlingPDF_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Stirling-PDF sur GKE Autopilot](../labs/StirlingPDF_GKE.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [Stirling-PDF sur Google Cloud Run](StirlingPDF_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Stirling-PDF Common — Configuration d'application partagée](StirlingPDF_Common.md) — la configuration partagée par les deux cibles de déploiement.
