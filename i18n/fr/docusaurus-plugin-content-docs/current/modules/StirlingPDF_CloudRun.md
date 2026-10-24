---
title: "Stirling-PDF sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Stirling-PDF sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/StirlingPDF_CloudRun.md @ e69407af sha256:cbd48baca860 -->

# Stirling-PDF sur Google Cloud Run {#stirling-pdf-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/StirlingPDF_CloudRun.png" alt="Stirling-PDF sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Stirling-PDF est une boîte à outils PDF web open-source (noyau sous licence MIT), hébergée localement — fusionner, diviser, convertir, OCR, compresser, filigraner, signer, caviarder et plus de 50 autres opérations PDF, toutes traitées sur votre propre infrastructure afin que les documents ne touchent jamais un service tiers. Ce module déploie Stirling-PDF sur **Cloud Run v2** au-dessus de la fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Stirling-PDF et sur la manière de les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à chaque application Cloud Run — identité de service, ingress et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls et le cycle de vie du déploiement — reportez-vous au [guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## Ce que coûte Stirling-PDF sur RAD, et comment cela se compare {#what-stirling-pdf-costs-on-rad-and-how-that-compares}

**Stirling-PDF sur le module Cloud Run de RAD coûte environ 19,16 US$ par mois dans un projet Google Cloud que vous possédez, les frais de module étant facturés une fois en crédits RAD.** Stirling-PDF est sans état et sans base de données, c'est donc la configuration la moins chère du côté Cloud Run de la plateforme. Pour le coût de fonctionnement le plus bas, il reste ici ; GKE Autopilot ne vaut la peine que s'il doit être placé à côté d'autres charges de travail Kubernetes — voir le [guide GKE](StirlingPDF_GKE.md) pour cette option, à environ 45,68 US$ par mois à la place. Si vous n'en avez besoin qu'occasionnellement — un lot de documents, un travail de conversion ponctuel — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits (moins de 1 US$) au lieu de payer pour qu'il reste inactif. Voir **Mettez-le en pause gratuitement**, ci-dessous. Les chiffres sont à jour au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 40 crédits (4 US$ au prix de la recharge) | 36 crédits (10 % de moins) |
| Temps de build | Environ 3-6 crédits par build | Idem |
| Coût de fonctionnement Google Cloud | Facturé par Google à votre propre compte de facturation, environ **19,16 US$ par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **3 crédits par jour**, environ 90 par mois |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde acheté minimum est conservé en réserve |

10 crédits coûtent 1 US$ pour une recharge ponctuelle, et moins pour un plan mensuel. Dans un projet géré par RAD, le réseau est partagé par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas un deuxième ensemble de celui-ci.

**Coût de fonctionnement par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Cloud Run, 1x vCPU / 2 GiB (scaleToZero) | 13,16 US$ |
| Cloud NAT et réseau | 5,00 US$ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 US$ |
| **Total** | **19,16 US$** |

### Comment cela se compare {#how-it-compares}

- Le plan hébergé de Stirling PDF, **Stirling PDF Team**, coûte **99 $/mois pour un maximum de 100 utilisateurs** sur son SaaS hébergé — des frais par organisation destinés aux équipes, et non un coût d'infrastructure (source : [stirling.com/pricing](https://www.stirling.com/pricing)). Le chiffre de RAD pour un projet propre est une petite fraction de cela car il s'agit du coût de calcul brut de Cloud Run sans frais de logiciel par siège.
- Une comparaison auto-gérée : Hetzner CPX22 (2 vCPU/4 Go) coûte environ 24 $/mois, un Droplet DigitalOcean 2 vCPU/4 Go coûte le même 24 $/mois, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) coûte environ 49 $/mois — tous plus que le chiffre de Cloud Run de RAD pour un projet propre, et tous doivent être mis à jour manuellement, ce que le Secret Manager et la surveillance gérés par RAD couvrent autrement.
- Sans base de données et sans état persistant, Stirling-PDF est proche du plancher de ce que coûte tout déploiement sur RAD — presque toute la facture est le conteneur Cloud Run lui-même.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Stirling-PDF s'exécute dans un projet géré par RAD pour vous, la suppression de l'ensemble du projet délie d'abord sa facturation, puis demande à Google de supprimer purement et simplement le projet — la suppression logicielle récupérable de 30 jours de Google. Contrairement à la suppression d'un seul module, cela ne démolit pas les ressources de calcul une par une : l'ensemble du projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de restaurer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter la mise à jour sur chaque déploiement pour confirmer que tout est revenu. Parce que rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits (moins de 1 US$) au total pour une chaîne de déploiement typique de 2-3.

Ce qu'il faut : vous devez posséder le projet (pas un projet dont RAD gère uniquement la facturation), vous devez le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est admise comme la création d'un nouveau projet, de sorte que votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude/démo conviennent). Google indique que la plupart des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.

Un véritable écart : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Stirling-PDF lui-même ne contient pas de base de données, donc pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre façon : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois la fenêtre de restauration de 30 jours passée, l'alternative est de supprimer Stirling-PDF purement et simplement et de le redéployer plus tard. Un redéploiement coûte à nouveau les frais de module, plus les builds — environ 45 crédits (environ 4,50 US$) dans votre propre projet, ou 41 crédits dans un projet géré par RAD.

La suppression ne permet d'économiser de l'argent que si Stirling-PDF restait inutilisé assez longtemps pour compenser ce coût de redéploiement par rapport à son propre coût de fonctionnement quotidien — par rapport au total du projet propre ci-dessus (environ 0,64 US$ par jour), cela représente environ 8 jours ou plus, ou environ 14 jours ou plus dans un projet géré par RAD (3 crédits par jour). Il n'y a pas de base de données ici, donc la suppression de cette application libère l'intégralité de son coût de fonctionnement plutôt qu'une simple part de celui-ci.

Gardez les données en premier : tout ce que Stirling-PDF écrit dans un bucket de sauvegarde à l'intérieur du déploiement est supprimé avec lui, alors copiez tout ce que vous voulez conserver avant de le supprimer.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour une classe. Chaque participant obtient l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite fixée par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits non utilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil :** un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire remet le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les propres frais de RAD et les estimations de crédits quotidiens ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les mécanismes de pause/restauration ; [stirling.com/pricing](https://www.stirling.com/pricing) pour le prix hébergé de Stirling PDF Team.

## 1. Vue d'ensemble {#1-overview}

Stirling-PDF s'exécute comme un conteneur Java / Spring Boot (avec un LibreOffice intégré pour les conversions de documents) sur Cloud Run v2. Le déploiement connecte un ensemble délibérément restreint de services Google Cloud — Stirling-PDF est sans état, il n'y a donc pas de base de données, pas de stockage persistant et pas de secrets à gérer :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Java, 1 vCPU / 2 GiB par défaut, autoscaling sans serveur ; mise à l'échelle à zéro activée |
| Image de conteneur | Artifact Registry | Image officielle `stirlingtools/stirling-pdf`, mise en miroir par défaut |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe optionnel + domaine personnalisé |
| Redis (inerte) | Redis | Désactivé par défaut. `enable_redis` ne fait qu'injecter des variables d'environnement `REDIS_*` par la Fondation — Stirling-PDF ne les lit jamais, donc cela ne fournit aucune limitation de débit ou détection de bot |
| Observabilité | Cloud Logging / Cloud Monitoring | Journaux de conteneurs, métriques, vérification de disponibilité et alertes optionnelles |

**Valeurs par défaut judicieuses à connaître à l'avance :**

- **Sans état — pas de base de données, pas de stockage, pas de secrets.** `database_type = "NONE"`,
  pas de buckets GCS, pas de NFS, et une carte de secrets vide. Chaque opération PDF s'exécute dans un
  répertoire de travail éphémère par requête qui est supprimé à la fin.
- **Image pré-construite.** `container_image_source = "prebuilt"` déploie l'image officielle
  `stirlingtools/stirling-pdf` directement ; `enable_image_mirroring = true`
  la met en miroir dans Artifact Registry pour éviter les limites de débit de Docker Hub.
- **La connexion est désactivée par défaut.** `enable_login = false`
  (`SECURITY_ENABLELOGIN=false`) livre une instance ouverte. Activez-la et placez le
  service derrière IAP ou Cloud Armor pour un déploiement privé.
- **Facturation basée sur les requêtes + mise à l'échelle à zéro.** `cpu_always_allocated = false` et
  `min_instance_count = 0` — le CPU n'est facturé que pendant le traitement d'une requête, et le
  service se met à l'échelle à zéro lorsqu'il est inactif. Un démarrage à froid ajoute quelques secondes de
  réchauffement de la JVM.
- **Plancher de mémoire de 2 GiB.** La JVM plus LibreOffice nécessite au moins `2Gi` ; augmentez
  `memory_limit` pour les charges de travail OCR / conversion lourdes.
- **Ingress public par défaut.** `ingress_settings = "all"` pour que la boîte à outils soit
  accessible à son URL `run.app`. Combinez avec IAP pour un accès
  protégé par identité.
- **Les sondes de santé atteignent `/api/v1/info/status`** — un point de terminaison public, non authentifié
  qui renvoie 200 une fois que la JVM et LibreOffice ont été initialisés (fenêtre de
  démarrage initial de ~70s).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de services et de ressources sont
rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Stirling-PDF {#a-cloud-run--the-stirling-pdf-service}

Stirling-PDF s'exécute comme un service Cloud Run v2 qui s'auto-adapte en fonction de la charge de requêtes entre
le nombre minimal (0) et maximal d'instances. Chaque déploiement crée une révision immuable ;
le trafic peut être réparti entre les révisions pour des déploiements sécurisés.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les journaux et
  les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Artifact Registry — l'image de conteneur {#b-artifact-registry--the-container-image}

L'image officielle `stirlingtools/stirling-pdf` est mise en miroir dans Artifact Registry
(`enable_image_mirroring = true`) et Cloud Run la tire de là. Aucune étape Cloud Build
n'est exécutée — l'image est pré-construite en amont.

- **Console :** Artifact Registry → Dépôts.
- **CLI :**
  ```bash
  gcloud artifacts repositories list --project "$PROJECT" --location "$REGION"
  gcloud artifacts docker images list <repo-path> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour le mécanisme de mise en miroir et la rétention d'images.

### C. Réseautage et ingress {#c-networking--ingress}

Le service est accessible à son URL `run.app` par défaut (`ingress_settings = "all"`).
Un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peuvent
être ajoutés ; les paramètres d'ingress et de sortie VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### D. Redis (inerte — enable_redis n'a aucun effet sur l'application) {#d-redis-inert--enable_redis-has-no-application-effect}

Redis est **désactivé par défaut** (`enable_redis = false`). La définition de `enable_redis =
true` ne fait que faire injecter par la fondation `App_CloudRun` les variables d'environnement `REDIS_HOST`/`REDIS_PORT`/
`REDIS_AUTH` dans le conteneur — Stirling-PDF **ne les lit jamais**.
Le propre commentaire de `stirlingpdf.tf` confirme "pas de DB ou Redis", et ni
`StirlingPDF_Common` ni ce module ne mappent ces variables d'environnement dans un paramètre
reconnu par Stirling-PDF. L'activation de Redis **n'implémente pas** la limitation de débit ou la
détection de bot pour cette application ; il n'y a aucun moyen pris en charge d'ajouter
ce comportement à Stirling-PDF via ce module. Utilisez `enable_cloud_armor` pour
une véritable atténuation des abus sur une instance publique.

- **CLI (pour confirmer que les variables d'environnement sont présentes mais inutilisées) :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### E. Identity-Aware Proxy (facultatif) {#e-identity-aware-proxy-optional}

Étant donné que Stirling-PDF traite des documents potentiellement sensibles, un déploiement privé
devrait restreindre l'accès avec IAP. L'activation de `enable_iap` nécessite une identité Google authentifiée et
autorisée avant que toute requête n'atteigne le service — aucune configuration VPN ou
de connexion Stirling-PDF n'est nécessaire.

- **Console :** Sécurité → Identity-Aware Proxy.
- **CLI :**
  ```bash
  gcloud iap web get-iam-policy --resource-type=backend-services --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour le câblage IAP.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux de conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run sont envoyées à Cloud Monitoring,
avec des vérifications de disponibilité et des politiques d'alerte facultatives.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Stirling-PDF {#3-stirling-pdf-application-behaviour}

- **Rien n'est persistant.** Les téléchargements sont écrits dans un répertoire de travail éphémère par requête et supprimés lorsque la réponse est renvoyée. Il n'y a pas de base de données ni de bucket — un redéploiement ou un événement de mise à l'échelle ne perd rien car il n'y a rien à perdre.
- **Démarrage initial lent.** L'initialisation de Spring Boot et de LibreOffice prend des dizaines de secondes. La sonde de démarrage cible `/api/v1/info/status` et autorise jusqu'à ~70 secondes (10s de délai initial + 6 × 10s) avant que la révision ne soit marquée comme non saine.
- **La connexion est facultative et désactivée par défaut.** `enable_login = false` livre une instance ouverte. Définissez `enable_login = true` pour exiger l'authentification intégrée de Stirling-PDF ; combinez avec IAP pour une défense en profondeur.
- **Les mises à niveau de version sont des changements de tag d'image.** Étant donné que l'image n'est pas modifiée en amont et qu'il n'y a pas de schéma, la modification de `application_version` déploie une nouvelle révision sans étape de migration.
- **Fichiers volumineux et conversions longues.** Augmentez `memory_limit` et `timeout_seconds`
  pour les documents volumineux ou l'OCR intensif ; définissez `SYSTEM_MAXFILESIZE` via
  `environment_variables` pour limiter la taille de téléchargement.
- **Confirmer la configuration en cours d'exécution :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --project "$PROJECT" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour Stirling-PDF sont listés ; toutes les autres entrées sont héritées de [App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Court suffixe qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails autorisés à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `stirlingpdf` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Stirling-PDF` | Nom lisible par l'homme affiché dans la console. |
| `application_version` | `latest` | Tag d'image Stirling-PDF ; épingler à une version spécifique en production. |
| `enable_login` | `false` | Activer l'authentification intégrée de Stirling-PDF (`SECURITY_ENABLELOGIN`). |
| `default_locale` | `en-US` | Locale de l'interface utilisateur par défaut (`SYSTEM_DEFAULTLOCALE`). |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `prebuilt` | Déployez l'image officielle (`prebuilt`) ou construisez une image personnalisée. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `2Gi` | Mémoire par instance ; **plancher de 2 GiB** pour JVM + LibreOffice. |
| `cpu_always_allocated` | `false` | Facturation basée sur les requêtes — Stirling-PDF n'a pas de travail en arrière-plan. |
| `min_instance_count` | `0` | Fixé à 0 (mise à l'échelle à zéro) — le module code en dur cette valeur ; la variable n'est pas transmise à la Fondation et ne peut pas être modifiée. |
| `max_instance_count` | `3` | Limite supérieure de l'autoscaling (peut être augmentée — pas d'état partagé). |
| `container_port` | `8080` | Stirling-PDF écoute sur le port 8080. |
| `execution_environment` | `gen2` | Gen2 recommandé. |
| `timeout_seconds` | `60` | Durée maximale de la requête ; augmenter pour les conversions importantes. |
| `enable_cloudsql_volume` | `false` | Non utilisé — Stirling-PDF n'a pas de base de données. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image dans Artifact Registry. |
| `traffic_split` | `[]` | Répartir le trafic entre les révisions pour des déploiements échelonnés. |

### Groupe 5 — Accès et contrôle d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` pour l'accès public ; `internal-and-cloud-load-balancing` derrière un LB. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via VPC. |
| `enable_iap` | `false` | Exiger la connexion Google. Recommandé pour les instances privées/de documents sensibles. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres Stirling-PDF supplémentaires (par exemple `SYSTEM_MAXFILESIZE`). La connexion et la locale sont définies via `enable_login` / `default_locale`. |
| `secret_environment_variables` | `{}` | Références Secret Manager. Stirling-PDF n'en a pas besoin par défaut. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

Stirling-PDF est sans état, donc les entrées de sauvegarde (`backup_schedule`,
`backup_retention_days`, `enable_backup_import`, `backup_source`, `backup_uri`,
`backup_format`) n'ont pas de données d'application à protéger. Laissées aux valeurs par défaut.

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard de Cloud Build / Cloud Deploy d'App_CloudRun — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 10 — Équilibreur de charge, CDN et rétention d'images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner le LB HTTPS global + WAF Cloud Armor. Recommandé pour les instances publiques. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour le LB HTTPS. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend du LB HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `false` | Stirling-PDF est sans état — pas de bucket par défaut. |
| `storage_buckets` | `[]` | Buckets GCS supplémentaires facultatifs. |
| `enable_nfs` | `false` | NFS désactivé par défaut ; activer uniquement si Redis est colocalisé sur le serveur NFS. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse (nécessite gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixe — Stirling-PDF n'utilise pas de base de données. |
| `database_password_length` | `32` | Non utilisé. |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Non applicable. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/v1/info/status`, 10s de délai, 6 tentatives | Sonde de démarrage. Fenêtre de démarrage initial de ~70s pour JVM + LibreOffice. |
| `liveness_probe` | HTTP `/api/v1/info/status`, 15s de délai | Sonde de vivacité. |
| `uptime_check_config` | `{ enabled=false, path="/api/v1/info/status" }` | Vérification de disponibilité Cloud Monitoring. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 21 — Redis (passage inerte de la Fondation) {#group-21--redis-inert-foundation-passthrough}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Inerte pour Stirling-PDF : ne fait qu'injecter par `App_CloudRun` les variables d'environnement `REDIS_HOST`/`REDIS_PORT`/`REDIS_AUTH`, que l'application ne lit jamais. Aucune limitation de débit ou détection de bot ne résulte de l'activation de cette option. |
| `redis_host` | `""` | Point de terminaison Redis. Laisser vide pour utiliser l'IP du serveur NFS. Inutilisé par Stirling-PDF quelle que soit la valeur. |
| `redis_port` | `6379` | Port Redis. Inutilisé par Stirling-PDF quelle que soit la valeur. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). Inutilisé par Stirling-PDF quelle que soit la valeur. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | Niveaux d'accès CIDR / mode simulation. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Renvoyées lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `storage_buckets` | Buckets Cloud Storage créés (vides — Stirling-PDF est sans état). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, vérifications de disponibilité. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur de fondation [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et les combinaisons* au moment du plan — IAP sans identités autorisées, un environnement d'exécution `gen1` avec des montages NFS/GCS, un `redis_port`/`timeout_seconds` hors plage, une mémoire inférieure au plancher gen2. Une configuration invalide échoue au **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `enable_login` + ingress | `enable_login = true` **ou** IAP pour usage privé | Élevé | Le `enable_login = false` par défaut + l'ingress public laisse une boîte à outils PDF ouverte que toute personne ayant l'URL peut utiliser. |
| `enable_iap` | Activer pour les instances de documents sensibles | Élevé | Sans IAP (et avec la connexion désactivée), le service n'est pas authentifié ; les utilisateurs peuvent télécharger des documents confidentiels vers un point de terminaison ouvert. |
| `memory_limit` | `2Gi` | Élevé | En dessous de ~2 GiB, la JVM + LibreOffice tue le processus par manque de mémoire pendant les conversions ; gen2 rejette également `< 512Mi` au moment du plan. |
| `timeout_seconds` | `60`, augmenter pour les fichiers volumineux | Élevé | Les tâches OCR/conversion volumineuses dépassant le délai d'attente renvoient 504 en cours d'opération. |
| Fenêtre `startup_probe` | Conserver la valeur par défaut de ~70s | Moyen | Raccourcir le délai initial / le seuil d'échec marque la révision comme non saine avant que LibreOffice ne termine son réchauffement. |
| `enable_cloud_armor` | Activer pour les instances publiques | Moyen | Une boîte à outils publique sans WAF est exposée aux abus et à l'analyse automatisée. |
| `enable_redis` | Laisser `false` — il est inerte pour cette application | Faible | L'activer n'ajoute que des variables d'environnement `REDIS_*` inutilisées à la révision ; Stirling-PDF ne les lit jamais, donc cela ne fournit **aucune** limitation de débit ou détection de bot. Utilisez `enable_cloud_armor` à la place pour une véritable atténuation des abus. |
| `min_instance_count` | `0` (fixe) | Faible | La mise à l'échelle à zéro ajoute quelques secondes de réchauffement de la JVM lors de la première requête après l'inactivité. Le module code en dur `min_instance_count = 0` — la variable n'est pas transmise, elle ne peut donc pas être augmentée à `1` pour éliminer les démarrages à froid. |
| `SYSTEM_MAXFILESIZE` (via `environment_variables`) | Définir une limite raisonnable | Faible | Les téléchargements illimités permettent à un seul fichier volumineux de consommer la mémoire de l'instance. |

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise à l'échelle et
concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à Stirling-PDF
partagée avec la variante GKE est décrite dans
**[StirlingPDF_Common](StirlingPDF_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Stirling-PDF sur Cloud Run](../labs/StirlingPDF_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Stirling-PDF sur GKE Autopilot](StirlingPDF_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [Stirling-PDF Common — Configuration d'application partagée](StirlingPDF_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Outline sur Google Cloud Run](Outline_CloudRun.md), [BookStack sur Google Cloud Run](BookStack_CloudRun.md), [Paperless-ngx sur Google Cloud Run](Paperless_CloudRun.md) dans la solution **Base de connaissances et documentation**.
