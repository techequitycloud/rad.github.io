---
title: "Module Stalwart GKE — Guide de configuration"
description: "Référence de configuration pour le déploiement de Stalwart sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Stalwart_GKE.md @ e69407af sha256:9cb561b166cb -->

# Module Stalwart GKE — Guide de configuration {#stalwart-gke-module--configuration-guide}

Ce guide décrit les variables de configuration disponibles dans le module `Stalwart_GKE`. `Stalwart_GKE` est un **module enveloppant** qui combine le module d'infrastructure générique [`App_GKE`](./App_GKE.md) avec la configuration d'application partagée [`Stalwart_Common`](./Stalwart_Common.md) pour déployer [Stalwart Mail Server](https://stalw.art/) — un serveur de messagerie open source qui sert SMTP, IMAP, POP3, JMAP et ManageSieve à partir d'un seul binaire Rust — sur Google Kubernetes Engine (GKE) Autopilot.

La plupart des options de configuration dans `Stalwart GKE` correspondent directement aux mêmes options dans `App GKE`. Lorsqu'une variable a un comportement identique, ce guide fait référence au guide `App GKE` plutôt que de répéter la même documentation. Seules les variables et les valeurs par défaut **spécifiques à Stalwart** sont décrites en détail ici.

> **Note :** Les variables marquées comme *gérées par la plateforme* sont définies et maintenues par la plateforme. Vous n'avez normalement pas besoin de les modifier.

> **GKE uniquement :** Il n'y a pas de variante Cloud Run. Les protocoles de messagerie sont des protocoles en ligne que Cloud Run ne peut pas transférer, et Stalwart sert normalement sur le port 443 tandis que son port 8080 ne s'ouvre que lorsqu'il n'est pas configuré ou n'a pas réussi à démarrer — le contrat `$PORT` de Cloud Run serait donc satisfait précisément lorsque le serveur est en panne.

---

## Ce que coûte Stalwart sur RAD, et comment cela se compare {#what-stalwart-costs-on-rad-and-how-that-compares}

**Stalwart sur le module GKE Autopilot de RAD coûte environ 110,13 US$ par mois dans un projet Google Cloud que vous possédez, avec les frais de module facturés une seule fois en crédits RAD.** Il n'y a pas de variante Cloud Run — les protocoles de messagerie nécessitent les ports TCP de longue durée que Cloud Run ne peut pas transférer — GKE Autopilot est donc la seule façon dont RAD déploie Stalwart. Si vous n'avez besoin d'un serveur de messagerie qu'occasionnellement — pour des tests, un cours, un projet de courte durée — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits (moins de 1 US$) au lieu de payer pour qu'il reste inactif. Voir **Mettez-le en pause gratuitement**, ci-dessous. Les chiffres sont à jour au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 110 crédits (11 US$ au prix de la recharge) | 99 crédits (10 % de moins) |
| Temps de build | Environ 3-6 crédits par build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **110,13 US$ par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **99 crédits par jour**, soit environ 2 970 par mois |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est détenu en réserve |

10 crédits coûtent 1 US$ pour une recharge unique, et moins pour un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas un deuxième ensemble de ces éléments.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (valeur par défaut du module) | Par mois |
|---|---|
| Pod GKE Autopilot, 1 vCPU / 2 GiB | 39,68 US$ |
| Cloud SQL pour MySQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 US$ |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 US$ |
| Cloud NAT et réseau | 5,00 US$ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 US$ |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 |
| **Total** | **110,13 US$** |

### Comment cela se compare {#how-it-compares}

- Le niveau payant de Stalwart est une *licence* Enterprise pour le même binaire auto-hébergé (prix par boîte aux lettres, facturé annuellement ou mensuellement) — ce n'est pas un service de messagerie hébergé que quelqu'un d'autre gère pour vous, ce n'est donc pas une alternative comparable à RAD gérant l'infrastructure.
- Une comparaison auto-gérée pour un serveur de messagerie, qui nécessite une base de données et un serveur de fichiers ainsi que le processus de messagerie lui-même : Hetzner CPX22 (2 vCPU/4 Go) coûte environ 24 $/mois, un Droplet DigitalOcean 2 vCPU/4 Go coûte le même 24 $/mois, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) coûte environ 49 $/mois — plus le temps de l'administrateur pour la configuration DKIM/SPF/DMARC, les sauvegardes, les correctifs de sécurité et le renouvellement TLS, que Cloud SQL géré, Secret Manager et la surveillance de RAD couvrent pour vous.
- Exécuter votre propre serveur de messagerie — sur RAD ou ailleurs — échange les frais par siège d'un fournisseur de boîtes aux lettres hébergées contre l'infrastructure plus le travail continu de délivrabilité (DNS inverse, réputation IP) qu'un fournisseur comme Google Workspace ou Fastmail prend en charge pour vous.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Stalwart s'exécute dans un projet géré par RAD pour vous, la suppression de l'ensemble du projet délie d'abord sa facturation, puis demande à Google de supprimer purement et simplement le projet — la suppression logicielle récupérable de 30 jours de Google. Contrairement à la suppression d'un module, cela ne démolit pas Cloud SQL, la VM NFS ou la ressource de calcul une par une : l'ensemble du projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de récupérer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter la mise à jour sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais à nouveau les frais de module. Cela ne coûte qu'une poignée de crédits (moins de 1 US$) au total pour une chaîne de déploiement typique de 2-3.

Ce qu'il faut : vous devez posséder le projet (pas un projet dont RAD ne gère que la facturation), vous devez le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est admise comme la création d'un nouveau projet, de sorte que votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude/démo conviennent). Google indique que la plupart des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.

Un véritable écart : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé la configuration de messagerie de Stalwart ou conservé des données de boîte aux lettres que vous souhaitez conserver, copiez une sauvegarde (vers Google Drive ou un bucket en dehors du projet) avant de la supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois la fenêtre de restauration de 30 jours passée, l'alternative est de supprimer Stalwart purement et simplement et de le redéployer plus tard. Un redéploiement coûte à nouveau les frais de module, plus les builds — environ 115 crédits (environ 11,50 US$) dans votre propre projet, ou 104 crédits dans un projet géré par RAD.

La suppression ne permet d'économiser de l'argent que si Stalwart devait rester inutilisé assez longtemps pour compenser ce coût de redéploiement par rapport à son propre coût d'exécution quotidien — par rapport au total du projet ci-dessus (environ 3,67 US$ par jour), cela représente environ 4 jours ou plus, ou environ 2 jours ou plus dans un projet géré par RAD (99 crédits par jour). La majeure partie du coût d'exécution ici est la base de données et le serveur de fichiers NFS ; ils ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc la suppression de Stalwart pendant que quelque chose d'autre partage le projet n'économise que la partie calcul de cette application.

Conservez d'abord les données : les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui, alors copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour une classe. Chaque participant obtient l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil :** un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est interrompue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les frais propres à RAD et les estimations de crédits quotidiens ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les mécanismes de pause/restauration. Aucun SaaS de messagerie hébergé commercial actuellement vérifié exécutant Stalwart lui-même n'existe, donc aucun prix concurrent n'est mentionné.

## Référence de configuration standard {#standard-configuration-reference}

Les zones de configuration suivantes sont fournies par le module sous-jacent `App_GKE`. Consultez les sections liées du [Guide de configuration App_GKE](./App_GKE.md) pour une documentation complète.

| Zone de configuration | Section App GKE.md | Notes spécifiques à Stalwart |
|---|---|---|
| Projet et identité | §2 IAM et contrôle d'accès | Identique. |
| Identité de l'application | §3.A Calcul (GKE Autopilot) | Modifiez le nom d'affichage restant `Wiki.js` ; voir [Groupe 3](#group-3-application-identity). |
| Exécution et mise à l'échelle | §3.A Calcul (GKE Autopilot) | `container_port = 443` ; conservez un réplica ; voir [Groupe 4](#group-4-runtime--scaling). |
| Variables d'environnement et secrets | §3 Configuration du service principal | `STALWART_RECOVERY_ADMIN` appartient à `secret_environment_variables` ; voir [Groupe 5](#group-5-environment-variables--secrets). |
| Service Kubernetes et ports | §5 Trafic et Ingress | L4 `LoadBalancer` transportant 443 plus six ports de messagerie ; voir [Groupe 6 et la carte des ports](#group-6-kubernetes-service-workload--ports). |
| Charges de travail avec état | §3.A Calcul (GKE Autopilot) | StatefulSet avec un PVC à `/var/lib/stalwart` ; voir [Groupe 7](#group-7-stateful-workloads). |
| Budgets d'interruption de pod | §7.A Budgets d'interruption de pod | Créé uniquement lorsque `max_instance_count > 1`. |
| Observabilité et vérifications de santé | §3.A Calcul (GKE Autopilot) | **Sondes TCP sur 443** ; voir [Groupe 10](#group-10-observability--health). |
| Jobs d'initialisation et CronJobs | §3.E Jobs d'initialisation et CronJobs | Pas de job d'initialisation — Stalwart crée son propre schéma. |
| CI/CD, autorisation binaire | §6 CI/CD et livraison, §4.C | Identique. |
| Stockage — NFS / GCS | §3.C Stockage (NFS / GCS / GCS Fuse) | Non utilisé par Stalwart ; voir [Groupes 13–14](#groups-13-and-14-storage). |
| Redis | §8.A Redis / Memorystore | Désactiver ; voir [Groupe 15](#group-15-redis). |
| Configuration de la base de données | §3.B Base de données (Cloud SQL) | **MySQL 8.0, fixé par `Stalwart_Common`** ; voir [Groupe 16](#group-16-database). |
| Planification de sauvegarde, importation et SQL personnalisé | §3.B, §8.B, §3.E | Identique. |
| Domaine personnalisé et IP statique | §5.C Réservation d'IP statique | IP statique sur le LoadBalancer ; pas de Gateway ; voir [Groupe 19](#group-19-custom-domain-static-ip--network-tags). |
| IAP, Cloud Armor, CDN | §4.A, §4.B, §5.B | Fonctionnalités de la passerelle (HTTP) — elles ne couvrent pas les ports de messagerie. |
| Contrôles de service VPC | §4.D Contrôles de service VPC | Identique. |

---

## Comment Stalwart GKE est lié à App GKE {#how-stalwart-gke-relates-to-app-gke}

`Stalwart GKE` transmet ses variables à `App GKE` et ajoute un sous-module `Stalwart Common` qui fournit la configuration d'application spécifique à Stalwart. Les principaux effets sont les suivants :

1.  **Une image wrapper écrit `config.json`.** Stalwart lit un seul fichier `--config /etc/stalwart/config.json` qui ne contient que sa définition **DataStore**, et le fichier n'est pas livré dans l'image. `App_GKE` ne peut pas monter une ConfigMap dans le conteneur de l'application, donc `Stalwart_Common` construit `FROM stalwartlabs/stalwart:<version>` avec un point d'entrée qui rend le fichier à partir des variables `DB_IP`, `DB_PORT`, `DB_NAME` et `DB_USER` de la fondation à chaque démarrage. Le mot de passe n'est pas écrit dans le fichier — son `authSecret` est `{ "@type": "EnvironmentVariable", "variableName": "DB_PASSWORD" }`.
2.  **La base de données est MySQL 8.0, accessible via l'IP privée.** `Stalwart_Common` définit `database_type = "MYSQL_8_0"` et `enable_cloudsql_volume = false` ; le `host` DataStore est l'IP privée brute de Cloud SQL. Ces valeurs proviennent de `Stalwart_Common` et remplacent les entrées `database_type` et `enable_cloudsql_volume` du wrapper, tout comme le port du conteneur (443).
3.  **Il n'y a pas de job d'initialisation.** L'étape `db-create` de la fondation provisionne la base de données et l'utilisateur, et Stalwart crée ses propres tables (27 lors d'une nouvelle installation) lors de la première connexion.
4.  **Le conteneur sert sur le port 443, jamais 8080.** L'écouteur HTTPS normal de Stalwart (interface d'administration, JMAP, `/healthz/live`) est le port 443. Le port 8080 ne s'ouvre que dans ses états de démarrage ("aucun fichier de configuration n'a été trouvé") et de récupération ("le démarrage a échoué").
5.  **Les sondes sont TCP sur le port 443.** La propre `HEALTHCHECK` de l'image est `curl https://127.0.0.1:443/healthz/live || curl http://127.0.0.1:8080/healthz/live`, qui signale un serveur défectueux comme sain via le repli 8080. Une sonde HTTP n'est pas non plus possible : la sonde HTTP de `App_GKE` n'a pas de champ `scheme`, elle ne peut donc pas vérifier un port HTTPS.
6.  **Le service est un équilibreur de charge TCP L4 avec les ports de messagerie ajoutés.** `service_port = 443` plus `extra_service_ports` (25, 465, 587, 993, 995, 4190).
7.  **Réplica unique par conception.** Un deuxième réplica nécessite le coordinateur de Stalwart, qui nécessite Redis ; le module évite Redis. Notez que la valeur par défaut `max_instance_count` du wrapper est `3` — définissez-la sur `1`.
8.  **Les domaines, les écouteurs et TLS ne sont pas configurés.** Tous les paramètres de Stalwart autres que le DataStore résident dans la base de données et sont appliqués avec `stalwart-cli` (une image distincte). Le module ne câble pas cette étape.

---

## Groupe 1 : Projet et identité {#group-1-project--identity}

Identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-1--project--identity). Entrées : `project_id` (obligatoire), `tenant_id` (`"demo"`), `region` (`"us-central1"`).

---

## Groupe 2 : Environnement de déploiement {#group-2-deployment-environment}

Identique à `App_GKE` : `support_users` (`[]`) et `resource_labels` (`{}`).

---

## Groupe 3 : Identité de l'application {#group-3-application-identity}

| Variable | Valeur par défaut Stalwart GKE | Notes |
|---|---|---|
| `application_name` | `"stalwart"` | Nom de base pour toutes les ressources GCP et Kubernetes. **Ne pas modifier après le déploiement.** |
| `application_display_name` | `"Wiki.js"` | Un reste du module dont le wrapper a été copié. C'est ce que la console GCP, la description de l'IP statique et les tableaux de bord affichent — définissez-le sur `"Stalwart Mail Server"` ou similaire. |
| `application_description` | `"Wiki.js - The most powerful and extensible open source Wiki software"` | Également un reste, mais **non utilisé** — la description de la charge de travail provient de `Stalwart_Common` ("Stalwart — serveur de messagerie et de collaboration open source…"). |
| `application_version` | `"v0.16.22"` | Tag `stalwartlabs/stalwart`, transmis au build en tant que `STALWART_VERSION`. **Épinglez une version exacte** — cette valeur remplace la valeur par défaut `_Common`. Une reconstruction sous un tag inchangé ne produit pas de diff Terraform. |

---

## Groupe 4 : Exécution et mise à l'échelle {#group-4-runtime--scaling}

| Variable | Valeur par défaut Stalwart GKE | Notes |
|---|---|---|
| `container_port` | `443` | **Sans effet** — `App_GKE` prend le port du conteneur de `Stalwart_Common`, qui le fixe à 443, l'écouteur HTTPS normal de Stalwart (jamais 8080, le port de démarrage/récupération). Les sondes TCP vérifient ce port. |
| `container_resources` | `{ cpu_limit = "1000m", memory_limit = "2Gi" }` | Également transmis à `Stalwart_Common` comme limites du conteneur. |
| `min_instance_count` | `1` | Gardez au moins un réplica — le courrier doit être reçu en continu. |
| `max_instance_count` | `3` | **Définir sur `1`.** Toute valeur supérieure à 1 crée un HorizontalPodAutoscaler (min `min_instance_count`, max cette valeur, mise à l'échelle sur l'utilisation du CPU et de la mémoire) et un PodDisruptionBudget. Un deuxième réplica nécessite le coordinateur de Stalwart, qui nécessite Redis, que ce module ne configure pas. |
| `container_image_source` | `"custom"` | Construit l'image wrapper. `"prebuilt"` déploierait une image sans le générateur `config.json` ; Stalwart ne trouverait alors aucune configuration et ouvrirait le port 8080. |
| `container_image` | `"stalwartlabs/stalwart"` | Référence de l'image de base. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image dans Artifact Registry. |
| `enable_cloudsql_volume` | `true` | **Sans effet** — `Stalwart_Common` le définit toujours sur `false` (pas de sidecar Auth Proxy). |
| `service_annotations` / `service_labels` | `{}` | Appliqué au service Kubernetes **uniquement à la création** ; `App_GKE` ignore les modifications ultérieures. |

---

## Groupe 5 : Variables d'environnement et secrets {#group-5-environment-variables--secrets}

Ces variables se comportent de manière identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-5--environment-variables--secrets).

**Comportement spécifique à Stalwart :**

`Stalwart_Common` définit deux variables d'environnement, et `environment_variables` est fusionné par-dessus :

| Variable | Valeur par défaut | Objectif |
|---|---|---|
| `STALWART_PUBLIC_URL` | `""` | URL de base publiée pour la découverte OAuth, OIDC et JMAP. Laissée vide volontairement — une mauvaise valeur est transmise aux clients dans les documents de découverte. Le wrapper n'a pas d'entrée dédiée pour cela ; définissez-la via `environment_variables` une fois que vous avez un domaine (par exemple `https://mail.example.com`). |
| `STALWART_DATASTORE_TYPE` | `"MySql"` | Le `@type` DataStore que le point d'entrée rend, dérivé des provisions du moteur `Stalwart_Common`. Ne le remplacez pas. |

Le point d'entrée lit également `STALWART_DB_USE_TLS` et `STALWART_DB_ALLOW_INVALID_CERTS` (tous deux par défaut `false`) pour la connexion DataStore ; les valeurs par défaut sont correctes pour Cloud SQL via l'IP privée.

**Administrateur de démarrage — définissez-le :**

L'administrateur de Stalwart est fourni en tant que `STALWART_RECOVERY_ADMIN`, avec la valeur `username:password`. Stockez-le dans Secret Manager et mappez-le dans `secret_environment_variables` :

```bash
printf 'admin:%s' "$(openssl rand -base64 24)" | \
  gcloud secrets create stalwart-recovery-admin --data-file=- --project "$PROJECT"
```

```hcl
secret_environment_variables = {
  STALWART_RECOVERY_ADMIN = "stalwart-recovery-admin"
}
```

Sans cela, Stalwart génère un mot de passe administrateur aléatoire et l'imprime dans le journal du conteneur **une seule fois** ; le point d'entrée enregistre `recovery_admin=<unset - a random password will be printed below>` juste avant.

Les variables de secrets restantes (`secret_rotation_period`, `secret_propagation_delay`, `protect_sensitive_environment_variables`) se comportent comme décrit dans [App_GKE](./App_GKE.md#group-5--environment-variables--secrets).

---

## Groupe 6 : Service Kubernetes, charge de travail et ports {#group-6-kubernetes-service-workload--ports}

| Variable | Valeur par défaut | Notes |
|---|---|---|
| `service_type` | `"LoadBalancer"` | Un équilibreur de charge réseau passthrough externe (`networking.gke.io/load-balancer-type: External`). Les protocoles de messagerie en ont besoin — une passerelle/Ingress ne transporte que du HTTP. |
| `service_port` | `443` | Port de service principal (nommé `http`), ciblant le port de conteneur 443. |
| `session_affinity` | `"ClientIP"` | Les requêtes provenant d'une même adresse IP client vont vers le même pod. |
| `workload_type` | `"StatefulSet"` | Identité stable plus le PVC par pod du groupe 7. |
| `namespace_name` | `""` | Dérivé du nom du service lorsqu'il est vide. |
| `enable_network_segmentation` | `false` | Politiques réseau Kubernetes. |
| `termination_grace_period_seconds` | `30` | Secondes entre SIGTERM et SIGKILL. |

**Carte des ports.** `extra_service_ports` (une entrée du groupe 0, gérée par la plateforme) ajoute les ports de messagerie au même service. Chacun cible le même port sur le conteneur et utilise TCP :

| Port | Nom | Protocole |
|---|---|---|
| `443` | `http` | HTTPS — interface d'administration, JMAP, `/healthz/live`. TLS est terminé par Stalwart, pas par Google. |
| `25` | `smtp` | SMTP. Entrant uniquement en pratique — Google Cloud bloque le port 25 sortant. |
| `465` | `submissions` | Soumission SMTP, TLS implicite. |
| `587` | `submission` | Soumission SMTP (STARTTLS) ; également le port pour relayer le courrier sortant via un hôte intelligent. |
| `993` | `imaps` | IMAP, TLS implicite. |
| `995` | `pop3s` | POP3, TLS implicite. |
| `4190` | `managesieve` | ManageSieve (vérifié pour renvoyer la propre bannière de Stalwart). |

Les ports IMAP (143) et POP3 (110) en texte clair sont omis volontairement — les ports TLS implicites font le même travail sans chemin d'authentification en clair. Le port 8080 n'est pas publié. GKE crée automatiquement les règles de pare-feu pour un service `LoadBalancer`. La description de la variable indique toujours qu'elle est "déclarée mais NON transférée" ; ce texte est obsolète — `main.tf` la transfère à `App_GKE`.

---

## Groupe 7 : Charges de travail avec état {#group-7-stateful-workloads}

| Variable | Valeur par défaut | Notes |
|---|---|---|
| `stateful_pvc_enabled` | `true` | Un PVC par pod. |
| `stateful_pvc_mount_path` | `"/var/lib/stalwart"` | Répertoire de travail et état local de Stalwart. Le courrier lui-même est stocké dans le DataStore Cloud SQL. |
| `stateful_pvc_size` | `"10Gi"` | Taille de chaque PVC. |
| `stateful_pvc_storage_class` | `"standard-rwo"` | PD équilibré. Les modèles de PVC StatefulSet sont immuables — choisissez la classe avant le premier déploiement. |
| `stateful_fs_group` | `0` | `fsGroup` du pod. |
| `stateful_headless_service`, `stateful_pod_management_policy`, `stateful_update_strategy` | `null` | Valeurs par défaut `App_GKE` (`OrderedReady`, `RollingUpdate`). |

`/etc/stalwart` n'est délibérément **pas** persisté — `config.json` est régénéré à partir des variables de la plateforme à chaque démarrage.

---

## Groupe 9 : Politiques de fiabilité {#group-9-reliability-policies}

`enable_pod_disruption_budget` (`true`) et `pdb_min_available` (`"1"`). `App_GKE` crée le PDB uniquement lorsque `max_instance_count > 1` ; avec le `max_instance_count = 1` recommandé, aucun PDB n'existe. Voir [App_GKE](./App_GKE.md).

---

## Groupe 10 : Observabilité et santé {#group-10-observability--health}

Contrairement aux wrappers dont les sondes proviennent des propres variables de leur module `_Common`, `Stalwart GKE` transmet `startup_probe_config` et `health_check_config` à `Stalwart_Common`, de sorte que **ces deux entrées sont les sondes sur le conteneur Stalwart**.

**Sonde de démarrage (`startup_probe_config`) :**

| Champ | Valeur par défaut | Notes |
|---|---|---|
| `type` | `"TCP"` | Connexion TCP à `container_port` (443). Ne pas passer à HTTP — la sonde ne peut pas parler HTTPS. |
| `initial_delay_seconds` | `60` | |
| `timeout_seconds` | `5` | |
| `period_seconds` | `10` | |
| `failure_threshold` | `3` | |

**Sonde de vivacité (`health_check_config`) :** `TCP`, `initial_delay_seconds = 60`, `timeout_seconds = 5`, `period_seconds = 30`, `failure_threshold = 3`.

**Ce que la sonde détecte.** Elle fait échouer un serveur qui n'a pas démarré (seul le port 8080 est alors lié). Elle ne fait **pas** échouer un serveur qui a démarré avec son DataStore connecté mais sans configuration de serveur — le port 443 est également lié dans cet état, et sur le déploiement vérifié, les ports 443 et 8080 ont répondu `/healthz/live` avec 200. Vérifier que le port 8080 est fermé est une tâche d'opérateur :

```bash
kubectl exec -n "$NS" <pod> -- curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/healthz/live
```

Un serveur entièrement configuré refuse cette connexion. **Ne redirigez pas une sonde défaillante vers le port 8080.**

`uptime_check_config` est par défaut `{ enabled = false, path = "/" }`. Sans passerelle, le test de disponibilité de `App_GKE` est un test HTTP simple (sans SSL) contre `service_port` sur l'adresse externe — mais Stalwart ne sert le port 443 qu'en HTTPS, donc laissez-le désactivé.

---

## Groupe 11 : Jobs et services additionnels {#group-11-jobs--additional-services}

Aucun job d'initialisation n'est défini — laissez `initialization_jobs = []`. `cron_jobs` et `additional_services` se comportent comme dans [App_GKE](./App_GKE.md#group-11--workload-automation).

---

## Groupe 12 : CI/CD et autorisation binaire {#group-12-cicd--binary-authorization}

Identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-12--cicd).

---

## Groupes 13 et 14 : Stockage {#groups-13-and-14-storage}

| Variable | Valeur par défaut | Notes |
|---|---|---|
| `enable_nfs` | `true` | Monte un partage NFS à `nfs_mount_path` (`"/mnt/nfs"`). Stalwart ne le lit ni ne l'écrit ; son état est sur le PVC et dans Cloud SQL. |
| `create_cloud_storage` | `true` | Crée le bucket générique `data` à partir de `storage_buckets`. `Stalwart_Common` ne déclare aucun de ses propres buckets. |
| `gcs_volumes` | `[]` | Pas de montages GCS FUSE par défaut. |

Les autres entrées de stockage et de rétention d'images se comportent comme dans [App_GKE](./App_GKE.md#group-13--nfs-storage).

---

## Groupe 15 : Redis {#group-15-redis}

`enable_redis` est par défaut `false` ; laissez-le désactivé. Redis ne serait nécessaire que pour plusieurs réplicas, et la connexion Redis de Stalwart est une URL (`redis://user:pass@host:port`), dans laquelle une chaîne AUTH Memorystore devrait être encodée en pourcentage — le module ne le fait pas.

---

## Groupe 16 : Base de données {#group-16-database}

| Variable | Valeur par défaut | Notes |
|---|---|---|
| `database_type` | `"MYSQL_8_0"` | Utilisé uniquement pour la validation au moment de la planification. Le moteur provisionné et rendu dans `config.json` est défini par `Stalwart_Common` (MySQL 8.0) ; le wrapper ne lui transmet pas cette valeur. |
| `application_database_name` / `application_database_user` | `"stalwart"` | **Inerte** — la fondation nomme la base de données et l'utilisateur d'après le service. |
| `database_password_length` | `32` | Ne pas modifier sur un déploiement en cours — cela écrit un nouveau mot de passe dans Secret Manager sans mettre à jour l'utilisateur de la base de données. |
| `enable_postgres_extensions` | `false` | Non applicable à MySQL ; laisser `false`. |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | `false` / `90` | Stalwart lit le mot de passe de la variable d'environnement `DB_PASSWORD`, de sorte qu'un mot de passe modifié prend effet lorsque le pod est redémarré après la rotation. |

---

## Groupe 17 : Sauvegarde {#group-17-backup}

Identique à `App_GKE` : `backup_schedule` (`"0 2 * * *"`, un CronJob Kubernetes), `backup_retention_days` (`7`, une règle de cycle de vie sur le bucket de sauvegardes), et les entrées de restauration `enable_backup_import` / `backup_source` / `backup_file` / `backup_format`.

---

## Groupe 18 : Scripts SQL personnalisés {#group-18-custom-sql-scripts}

Identique à `App_GKE`. Les scripts s'exécutent sur la base de données Stalwart via l'IP privée. Ne modifiez pas les tables appartenant à Stalwart.

---

## Groupe 19 : Domaine personnalisé, IP statique et balises réseau {#group-19-custom-domain-static-ip--network-tags}

| Variable | Valeur par défaut | Notes |
|---|---|---|
| `reserve_static_ip` | `true` | Réserve une IP externe statique **régionale** et l'attribue au service LoadBalancer, de sorte que les enregistrements MX et DNS aient une cible stable. (Elle n'est pas appliquée lorsque Cloud Deploy est activé.) |
| `static_ip_name` | `""` | Généré automatiquement comme `<service-name>-lb-ip` lorsqu'il est vide. |
| `enable_custom_domain` | `false` | Laisser `false`. `true` crée une passerelle, qui est uniquement HTTP et duplique le port 443 déjà sur le LoadBalancer — et utilise une autre IP externe. |
| `application_domains` | `[]` | Utilisé uniquement avec une passerelle. |
| `network_tags` | `["nfsserver"]` | Balises réseau de nœud/pod. |

---

## Groupes 20-22 : IAP, Cloud Armor et CDN, contrôles de service VPC {#groups-2022-iap-cloud-armor--cdn-vpc-service-controls}

`enable_iap`, `enable_cloud_armor` et `enable_cdn` agissent tous sur une passerelle (HTTP) ; l'activation de Cloud Armor ou du CDN en crée une. Aucun d'entre eux ne protège les ports de messagerie sur le LoadBalancer. Les contrôles de service VPC et la journalisation d'audit (Groupe 22) sont identiques à [App_GKE](./App_GKE.md).

---

## Gardes de validation {#validation-guards}

`validation.tf` fait échouer le plan lorsque `min_instance_count > max_instance_count` ; lorsque `enable_redis = true` sans `redis_host` ni `enable_nfs` ; lorsque `enable_iap = true` sans les deux champs client OAuth ; ou lorsque `enable_cloudsql_volume = true` avec `database_type = "NONE"`.

---

## Exploration du déploiement {#exploring-the-deployment}

### Console Google Cloud {#google-cloud-console}

-   **Kubernetes Engine → Charges de travail** — le StatefulSet Stalwart et son pod.
-   **Kubernetes Engine → Passerelles, services et Ingress** — le service LoadBalancer avec ses sept ports et son IP externe.
-   **Réseau VPC → Adresses IP** — l'adresse `…-lb-ip` réservée.
-   **SQL** — l'instance Cloud SQL hébergeant la base de données Stalwart.
-   **Secret Manager** — le mot de passe de la base de données et votre secret `STALWART_RECOVERY_ADMIN`.

### gcloud CLI et kubectl {#gcloud-cli-and-kubectl}

```bash
# Cluster credentials
gcloud container clusters get-credentials <cluster-name> --region "$REGION" --project "$PROJECT"

# Namespace, pod, Service and PVC
NS=$(kubectl get ns -o name | grep stalwart | head -1 | cut -d/ -f2)
kubectl get statefulset,pods,svc,pvc -n "$NS"

# The ports published on the LoadBalancer
kubectl get svc -n "$NS" -o jsonpath='{range .items[*].spec.ports[*]}{.name}{"\t"}{.port}{"\n"}{end}'

# Startup lines written by the entrypoint (DataStore target, admin state)
kubectl logs -n "$NS" statefulset/"$(kubectl get statefulset -n "$NS" -o jsonpath='{.items[0].metadata.name}')" | grep '\[startup\]'

# Health from inside the pod (443 must answer; 8080 should refuse once configured)
POD=$(kubectl get pods -n "$NS" -o jsonpath='{.items[0].metadata.name}')
kubectl exec -n "$NS" "$POD" -- curl -sk -o /dev/null -w '%{http_code}\n' https://127.0.0.1:443/healthz/live
kubectl exec -n "$NS" "$POD" -- curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/healthz/live

# Database password secret
gcloud secrets list --project "$PROJECT" --filter="name~stalwart"
```

---

## Sorties du module {#module-outputs}

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes |
| `namespace` | Espace de noms Kubernetes |
| `service_cluster_ip` | ClusterIP du service |
| `service_external_ip` | IP externe de l'équilibreur de charge — l'adresse vers laquelle pointent les clients de messagerie et les enregistrements MX |
| `service_url` | Rendu comme `http://` plus l'IP externe. Stalwart répond **HTTPS sur 443**, utilisez donc `https://` + `service_external_ip`. |
| `database_instance_name` / `database_name` / `database_user` | Instance Cloud SQL, base de données et utilisateur |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données |
| `database_host` | Toujours `127.0.0.1` (la valeur par défaut du proxy de la fondation) ; Stalwart se connecte en fait à l'IP privée de Cloud SQL |
| `database_port` | Port de la base de données |
| `storage_buckets` | Buckets GCS créés |
| `container_image` | Image de conteneur utilisée pour le déploiement |
| `initialization_jobs` / `db_import_job` | Noms des jobs |
| `cicd_enabled` / `github_repository_url` | Statut CI/CD |
| `kubernetes_ready` | `true` lorsque le point de terminaison du cluster était accessible et que les ressources Kubernetes ont été déployées |

---

## Pièges de configuration et valeurs par défaut judicieuses {#configuration-pitfalls--sensible-defaults}

> Niveaux de risque : **Critique** (perte de données, panne complète, faille de sécurité) — **Élevé** (service indisponible ou dégradation significative) — **Moyen** (fonction dégradée ou coût accru) — **Faible** (impact mineur).

| Variable | Valeur par défaut judicieuse | Risque | Conséquence d'une valeur incorrecte |
|---|---|---|---|
| `startup_probe_config` / `health_check_config` | `type = "TCP"` | **Critique** | Une sonde `HTTP` ne peut pas vérifier le port 443 de Stalwart (HTTPS uniquement) et fera échouer un pod sain. Le port de la sonde est fixé à 443 par `Stalwart_Common` ; ne contournez jamais une sonde défaillante en ciblant le port 8080, qui ne répond que lorsque Stalwart n'est pas configuré ou n'a pas réussi à démarrer. |
| `container_image_source` | `"custom"` | **Critique** | Sans le wrapper, il n'y a pas de `config.json` ; Stalwart ouvre le port 8080 en mode bootstrap et ne sert aucun courrier. |
| `STALWART_RECOVERY_ADMIN` | Défini via `secret_environment_variables` | **Élevé** | Non défini, le seul mot de passe administrateur est imprimé une fois dans le journal du conteneur. |
| `max_instance_count` | `1` | **Élevé** | Le `3` par défaut permet au HPA d'ajouter des réplicas, qui nécessitent un coordinateur basé sur Redis que le module ne configure pas, et crée un PDB. |
| Configuration du serveur (domaines, écouteurs, TLS) | Appliquer avec `stalwart-cli` après le déploiement | **Élevé** | Non effectué par le module. Tant que ce n'est pas fait, le port 8080 reste ouvert dans le pod et des connexions TLS externes ont été observées comme étant fermées sans certificat. |
| Courrier sortant | Smart host sur 587 | **Élevé** | Google Cloud bloque le port 25 sortant ; la livraison MX directe vers d'autres domaines ne peut pas fonctionner. |
| `database_password_length` | Laisser inchangé | **Élevé** | Le modifier sur un déploiement en cours rompt l'authentification de la base de données. |
| `application_version` | Une balise de version exacte | **Moyen** | Une reconstruction sous une balise inchangée ne crée pas de nouveau modèle de pod ; `kubectl rollout restart` tire l'image reconstruite (politique de tirage `Always`). |
| `enable_custom_domain` / `enable_cloud_armor` / `enable_cdn` | `false` | **Moyen** | Chacun crée une passerelle qui ne transporte que du HTTP et consomme une autre IP externe ; les ports de messagerie ne sont pas affectés. |
| `reserve_static_ip` | `true` | **Moyen** | Avec `false`, le LoadBalancer obtient une IP éphémère qui change chaque fois que le Service est recréé — les enregistrements MX deviendraient obsolètes. |
| `stateful_pvc_storage_class` / `stateful_pvc_size` | Décider avant le premier déploiement | **Moyen** | Les modèles de PVC StatefulSet sont immuables ; les modifications ultérieures ne s'appliquent pas au PVC existant. |
| `application_display_name` | `"Stalwart Mail Server"` | **Faible** | La valeur par défaut fournie affiche `Wiki.js` dans la console et les tableaux de bord. |
| `enable_nfs` | `false` si rien d'autre n'en a besoin | **Faible** | Par défaut `true` et monte un partage NFS que Stalwart n'utilise jamais. |

## Guides associés {#related-guides}

- [Lab pratique : Stalwart sur GKE Autopilot](../labs/Stalwart_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Module de configuration partagée commune de Stalwart](Stalwart_Common.md) — la couche applicative sur laquelle ce module est construit.
