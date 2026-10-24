---
title: "Grocy sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Grocy sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Grocy_GKE.md @ 1665a43e sha256:d5779786f642 -->

# Grocy sur GKE Autopilot {#grocy-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Grocy_GKE.png" alt="Grocy sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

[Grocy](https://grocy.info/) est un ERP domestique auto-hébergé pour la gestion
des courses et du foyer : suivi des stocks avec lecture de codes-barres,
gestion des tâches, listes de courses et planification des repas. Il est
distinct du module `Mealie` de ce catalogue, qui ne couvre que la
planification des recettes/repas — Grocy est l'outil ERP domestique plus large.
Ce module déploie Grocy sur **GKE Autopilot** au-dessus de la fondation
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée de
Google Cloud et Kubernetes ; `Grocy_GKE` est un wrapper léger qui fournit la
propre configuration de Grocy (image, port, sondes, câblage de stockage) et
transmet tout le reste directement.

Ce guide se concentre sur les services cloud utilisés par Grocy et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à chaque application GKE —
Workload Identity, ingress et équilibrage de charge, autoscaling, CI/CD, Cloud
Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de
vie du déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## Ce que coûte Grocy sur RAD et comment cela se compare {#what-grocy-costs-on-rad-and-how-that-compares}

**L'exécution du pod Grocy sur GKE Autopilot dans votre propre projet Google Cloud coûte environ 42,08 $/mois en frais Google Cloud**, en plus d'un frais de module RAD unique de 75 crédits facturé une fois au moment du déploiement. Grocy est un ERP domestique léger avec sa propre base de données SQLite intégrée, de sorte que le coût d'exécution de ce déploiement est presque entièrement dû au petit serveur de fichiers NFS qui le sous-tend, et non à une base de données gérée. Dans un projet géré par RAD, les frais de module tombent à 67,5 crédits (10 % de moins) et le coût d'exécution est mesuré à l'heure en crédits au lieu d'être facturé directement par Google — voir [Mettez-le en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) ci-dessous pour le seul avantage géré par RAD qu'un VPS auto-hébergé ne peut égaler — ou voir le [guide Cloud Run](Grocy_CloudRun.md) pour l'option à moindre coût.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module (unique) | 75 crédits | 67,5 crédits (10 % de moins) |
| Temps de build | ~3-6 crédits par build, dans les deux cas | ~3-6 crédits par build, dans les deux cas |
| Coût d'exécution Google Cloud | 42,08 $/mois, facturé par Google au prix catalogue | ~67 crédits/jour, mesuré au prix catalogue plus la marge de RAD |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Pod GKE Autopilot, 1x vCPU / 1 GiB | 36,08 $ |
| Cloud NAT et réseau | 5,00 $ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 $ |
| **Total** | **42,08 $** |

*Les frais de gestion de cluster GKE sont exclus du total ci-dessus car ils sont partagés entre toutes les applications GKE du projet — 0 $ si c'est le seul, sinon environ 73 $/mois répartis entre le nombre d'applications que vous exécutez.*

### Comment cela se compare {#how-it-compares}

- Une comparaison auto-gérée : l'empreinte de 1 vCPU/1 GiB de Grocy est suffisamment légère pour une classe de VPS moins chère et plus petite que les boîtiers de milieu de gamme habituellement cités ici — mais pour un point de référence direct, Hetzner CPX22/DigitalOcean 2 vCPU/4 Go coûtent environ 24 $/mois et un GCP e2-standard-2 environ 49 $/mois.
- Grocy n'a pas d'offre SaaS hébergée officielle — il n'est livré qu'en tant que logiciel auto-hébergé, il s'agit donc d'une comparaison VPS vs pile gérée par RAD, et non de RAD vs un abonnement.
- Ce qu'un VPS nu ne vous donne pas : des sauvegardes automatiques du fichier de données SQLite, la rotation des secrets ou la surveillance — la pile gérée par RAD couvre ces aspects même si la base de données sous-jacente ici n'est qu'un fichier.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

C'est l'avantage principal d'un projet géré par RAD, et il ne coûte rien lorsqu'il est en pause.
La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer
le projet purement et simplement — la suppression logicielle récupérable de 30 jours de Google. Contrairement à la suppression d'un module,
cela ne détruit **pas** Cloud SQL, aucune VM, ou la ressource de calcul une par une : l'ensemble
du projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà
déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de restaurer le
projet et de rattacher son compte de facturation, puis vous demande d'exécuter la mise à jour sur chaque déploiement pour
confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve
les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture
jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits (moins de 1 $ US) au total pour une chaîne de déploiement typique de 2-3.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD gère uniquement la facturation), vous devez
le restaurer vous-même dans les 30 jours — après quoi Google le supprime définitivement — et la restauration est
admise comme la création d'un nouveau projet, donc votre solde de crédits achetés doit toujours dépasser
le seuil du palier (100 crédits pour le palier sandbox que la plupart des utilisations d'étude/démo conviennent). Google dit que la plupart
des services fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a
la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous
supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez
personnalisé Grocy et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive, ou un bucket
en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable,
cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que 30 jours se sont écoulés sur un projet géré par RAD, il n'y a pas de pause gratuite —
la suppression supprime les ressources définitivement, et ramener Grocy signifie le redéployer à partir de
zéro. Cela coûte environ 78-81 crédits (les frais de module de 75 crédits plus un build).

La suppression ne permet d'économiser de l'argent que si Grocy reste inutilisé assez longtemps pour compenser ce
coût de redéploiement par rapport à son propre coût d'exécution — pour Grocy, cela représente environ 6 jours ou
plus. La majeure partie de ce coût d'exécution est généralement la base de données (et, lorsque ce module en utilise une, la VM de serveur de fichiers partagé ou le cluster GKE) — ceux-ci ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc la suppression de cette application pendant que quelque chose d'autre partage le projet n'économise que sa propre part de calcul.

Gardez les données en premier : les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui,
donc copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de labo et environnements gérés {#lab-sessions-and-managed-environments}

Sessions de labo, pour la formation : un formateur anime une session pour une classe. Chaque participant obtient l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits non utilisés sont reversés au formateur.

Environnements gérés, pour les cabinets de conseil : un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les propres frais de RAD et les estimations de crédits quotidiens ; [documentation de Google sur la suppression/restauration de projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les affirmations de pause/restauration.

## 1. Vue d'ensemble {#1-overview}

Grocy s'exécute comme un conteneur nginx + php-fpm (l'image LinuxServer.io `grocy`
en amont, non modifiée) sur GKE Autopilot en tant que **StatefulSet**. Le
déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot (StatefulSet) | 1 vCPU / 1 GiB par défaut, `min=max=1` (pas d'autoscaling — SQLite mono-écriture) |
| Base de données | Aucune | Grocy utilise une base de données SQLite intégrée — aucune instance Cloud SQL n'est créée |
| État persistant | **PVC de stockage par blocs** (`standard-rwo`, 20Gi) | `/config` (base de données SQLite, configuration, téléchargements, sauvegardes) est monté sur un véritable périphérique de blocs, par pod via `volumeClaimTemplates` — voir §4 |
| Stockage d'objets | Cloud Storage | Un bucket `storage` est provisionné mais inutilisé lorsque le PVC est activé (le défaut) |
| Cache | Aucun | `enable_redis` est codé en dur `false` dans `main.tf` — Grocy n'a pas de dépendance de cache |
| Secrets | Secret Manager | Aucun généré pour Grocy — aucune identifiant d'administrateur injectable n'existe |
| Ingress | Service Kubernetes | `LoadBalancer` par défaut du module ; ce déploiement utilise `ClusterIP` (voir §5) |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **SQLite est la seule base de données prise en charge par Grocy.** Confirmé en lisant la source amont de Grocy (`services/DatabaseService.php`) — il n'y a pas de branchement de pilote MySQL/Postgres du tout. `database_type` est fixé à `NONE`.
- **Un vrai PVC de blocs, pas NFS ou GCS FUSE — par conception, pas comme un correctif de bug.** `stateful_pvc_enabled = true` est le défaut du module, résolvant automatiquement `workload_type` en `"StatefulSet"`. `Grocy_Common` définit `enable_gcs_storage_volume = !stateful_pvc_enabled`, de sorte que le volume GCS-FUSE est entièrement ignoré chaque fois que le PVC est utilisé (l'état par défaut). Voir §4 pour savoir pourquoi cela est important et comment cela se compare à la variante Cloud Run.
- **Une seule instance.** `min_instance_count = 1`, `max_instance_count = 1`. La base de données SQLite de Grocy est mono-écriture sans prise en charge du clustering — et parce que le StatefulSet utilise `volumeClaimTemplates`, augmenter le nombre de réplicas donnerait à chaque pod son propre PVC non synchronisé plutôt que de partager `/config`.
- **Aucun identifiant d'administrateur injectable.** L'image amont fournit des identifiants par défaut `admin` / `admin`, modifiables via l'interface utilisateur web lors de la première connexion. Aucun secret Secret Manager n'est créé pour Grocy.
- **Les sondes de santé atteignent `/`, pas `/health`.** Grocy n'a pas de point de terminaison de santé dédié ; la page de connexion (`200`, non authentifiée) est utilisée pour les sondes de démarrage et de vivacité.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. Les noms de services et de ressources
sont signalés dans les [Sorties](#6-outputs) du déploiement.

### A. GKE Autopilot — le StatefulSet Grocy {#a-gke-autopilot--the-grocy-statefulset}

Grocy s'exécute en tant que **StatefulSet** à réplica unique (pas un déploiement) afin que son
`volumeClaimTemplates` puisse lier un PVC de blocs stable et par pod.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez le StatefulSet.
- **CLI :**
  ```bash
  kubectl get statefulset -n "$NAMESPACE"
  kubectl get pods -n "$NAMESPACE" -o wide
  kubectl describe statefulset <name> -n "$NAMESPACE"
  ```

Voir [App_GKE](App_GKE.md) pour les mécanismes de StatefulSet vs. Déploiement, la stratégie de déploiement et les requêtes/limites de ressources Autopilot.

### B. Le PVC de stockage par blocs `/config` {#b-the-config-block-storage-pvc}

Tout l'état de Grocy — la base de données SQLite intégrée (`grocy.db`), `config.php`,
les images/pièces jointes téléchargées et les sauvegardes — se trouve sous `/config`, monté sur un
véritable volume de blocs `standard-rwo` (Balanced PD) via le
`volumeClaimTemplates` du StatefulSet. C'est la décision de stockage la plus importante pour ce module
(voir §4) ; la perte ou la mauvaise configuration de ce PVC entraîne la perte de toutes les données Grocy.

- **Console :** Kubernetes Engine → Stockage → Revendications de volume persistant.
- **CLI :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc <pvc-name> -n "$NAMESPACE"
  ```

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** `storage` dédié est provisionné automatiquement, mais
par défaut, il n'est **pas** utilisé pour sauvegarder `/config` — ce montage passe par le
PVC de blocs à la place (voir §4). Il reste disponible pour tout `gcs_volumes` personnalisé qu'un
opérateur ajoute.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~grocy"
  ```

### D. Réseau et ingress {#d-networking--ingress}

Le module par défaut est un service `LoadBalancer` avec un domaine personnalisé facultatif via l'API Gateway. Le `config/deploy.tfvars` de ce déploiement remplace cela par `service_type = "ClusterIP"` avec `reserve_static_ip = false` (une contrainte de quota d'IP statique par projet) — accédez-y via `kubectl port-forward` ou depuis l'intérieur du cluster.

- **Console :** Kubernetes Engine → Gateways, Services et Ingress.
- **CLI :**
  ```bash
  kubectl get svc -n "$NAMESPACE" -o wide
  kubectl port-forward -n "$NAMESPACE" svc/<service-name> 8080:80
  ```

Voir [App_GKE](App_GKE.md) pour l'API Gateway, les IP statiques et les domaines personnalisés.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les journaux de conteneurs sont acheminés vers Cloud Logging ; les métriques Kubernetes sont acheminées vers Cloud Monitoring, avec des vérifications de disponibilité et des politiques d'alerte facultatives.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  kubectl logs -n "$NAMESPACE" <pod-name> --tail=100
  ```

---

## 3. Comportement de l'application Grocy {#3-grocy-application-behaviour}

- **Pas de configuration de base de données au premier déploiement.** Grocy n'a pas de base de données externe et pas de
  job `db-init` — il crée et migre son propre schéma SQLite intégré sous
  `/config` au premier démarrage.
- **La durabilité de `/config` dépend du PVC, pas d'une base de données gérée.** Parce que
  tout l'état de Grocy (base de données, configuration, téléchargements, sauvegardes) se trouve dans des fichiers sur
  `/config`, la justesse du PVC de blocs *est* la justesse du
  déploiement. Confirmez que le PVC est lié et inscriptible avant de faire confiance à toute donnée
  écrite dessus.
- **Aucun identifiant d'administrateur n'est généré ou injectable.** L'image amont fournit
  des identifiants par défaut `admin` / `admin`. Connectez-vous avec ceux-ci lors du premier accès et
  changez le mot de passe immédiatement via Utilisateurs → admin → Modifier dans l'interface utilisateur de Grocy —
  il n'y a pas de variable d'environnement ou de valeur Secret Manager qui le définisse pour
  vous.
- **Chemin de santé.** Les sondes de démarrage et de vivacité émettent toutes deux des requêtes HTTP `GET /`, qui
  renvoient la page de connexion de Grocy (`200`) sans authentification requise. Ce n'est pas
  un point de terminaison de santé dédié — Grocy n'en a pas — mais il indique de manière fiable que la
  pile nginx + php-fpm fonctionne.
- **La contrainte mono-écriture est architecturale, pas un bouton de mise à l'échelle.** Parce que
  la base de données SQLite de Grocy n'a pas d'équivalent MySQL/Postgres et pas de prise en charge du clustering,
  `max_instance_count` doit rester à `1`. Il n'y a pas de configuration qui
  permette en toute sécurité la mise à l'échelle horizontale pour ce module.
- **Vérifié en direct.** Le pod `grocygkee6a1e84d-0` a signalé `1/1 Running`, **0
  redémarrages**. Les journaux de démarrage montrent un démarrage propre de s6-overlay/LinuxServer — les migrations
  ont réussi, les clés TLS auto-signées générées sous `/config/keys` sans
  erreurs de permission, `[ls.io-init] done.`. `kubectl exec ... curl` contre
  `GET /` a renvoyé `302` → `Location: /stockoverview` → suivi vers `GET /login`
  → `200`, corps contenant `<title>Login | Grocy</title>` (10 102 octets) —
  correspondant exactement à la page de connexion vérifiée par Cloud Run.

---

## 4. Pourquoi ce module utilise un PVC de blocs — une conception vierge, pas un correctif de bug {#4-why-this-module-uses-a-block-pvc--a-clean-slate-design-not-a-bug-fix}

Le câblage de stockage persistant de ce module mérite d'être compris par contraste avec
son homologue, `Grocy_CloudRun`.

Sur Cloud Run, Grocy montait à l'origine `/config` sur un bucket sauvegardé par GCS-FUSE —
le modèle habituel de ce catalogue pour la configuration d'application persistante — et il a planté en boucle en
production. Grocy écrit sur `data/grocy.db-journal` à chaque transaction de base de données
(environ toutes les 1 à 2 secondes en utilisation légère), et la couche de traduction de stockage d'objets de GCS FUSE,
construite autour de la sémantique d'objet entier à cohérence éventuelle,
ne pouvait pas supporter cette fréquence d'écriture. La solution Cloud Run a été de passer `/config`
à un montage Cloud Filestore (NFS) à la place — voir le
[guide Grocy_CloudRun, §4](Grocy_CloudRun.md#4-why-config-uses-nfs-instead-of-gcs-fuse--the-real-story)
pour l'histoire complète.

`Grocy_GKE` n'a jamais eu ce problème à résoudre, car il a été conçu avec un
primitif de stockage différent dès le départ : `stateful_pvc_enabled = true` est le
défaut propre au module, qui exécute Grocy en tant que StatefulSet avec un véritable **périphérique de blocs**
(`standard-rwo`, un disque persistant équilibré) monté par pod à
`/config`. Un PVC de blocs n'est pas un système de fichiers réseau et pas une couche de traduction de stockage d'objets —
du point de vue du conteneur, il se comporte exactement comme un disque local,
avec une sémantique POSIX réelle (renommer, fsync, verrous de plage d'octets) et aucune
couche FUSE ne se trouvant entre le moteur SQLite et les octets sur le disque. Il n'y a
rien ici pour qu'un fichier journal à haute fréquence d'écriture puisse submerger.

`Grocy_Common` encode cette relation directement :
`enable_gcs_storage_volume = !stateful_pvc_enabled` — donc chaque fois que le PVC est
activé (le défaut), le volume GCS-FUSE qui a causé le bug Cloud Run n'est même jamais
câblé. Cela signifie également que le bug de permission de montage gcsfuse UID/GID **séparé** spécifique à GKE
rencontré ailleurs dans ce catalogue (confirmé sur des modules comme
PeerTube_GKE, où un conteneur non root ne peut pas écrire sur un montage gcsfuse sans
options de montage `uid`/`gid` explicites) ne s'applique tout simplement pas ici non plus — il n'y a pas
de montage gcsfuse à mal configurer.

`stateful_fs_group = 1000` correspond au PUID/PGID réel de l'image LinuxServer.io
(1000/1000), de sorte que le PVC de blocs est monté avec des droits d'écriture de groupe pour le processus réel du conteneur —
confirmé en direct : le journal de démarrage du pod montre des clés TLS auto-signées générées
sous `/config/keys` sans aucune erreur de permission.

**Le résultat : ce module a été déployé et vérifié sans aucun bug trouvé ou
corrigé.** Là où l'histoire de `Grocy_CloudRun` est "le mauvais primitif de stockage a cassé
SQLite, et voici le correctif", l'histoire de `Grocy_GKE` est plus simple — le bon primitif de stockage pour une charge de travail SQLite mono-écriture a été choisi dès le départ, et rien
n'a cassé.

---

## 5. Variables de configuration {#5-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour Grocy sont listés ; toute autre entrée est héritée de [App_GKE](App_GKE.md) avec son comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `grocy` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Grocy` | Nom lisible par l'homme affiché dans la console. |
| `application_version` | `latest` | Tag de l'image LinuxServer. `"latest"` se résout en `v4.6.0-ls333` épinglé (l'ARG de build `GROCY_VERSION`, pas le générique `APP_VERSION`). |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` / `memory_limit` | `1000m` / `1Gi` | Grocy est léger ; la mémoire par défaut offre une marge de manœuvre pour les téléchargements d'images/pièces jointes. |
| `min_instance_count` | `1` | Maintient le pod chaud — évite les démarrages à froid. |
| `max_instance_count` | `1` | **Doit rester à `1`.** La base de données SQLite de Grocy est mono-écriture sans prise en charge du clustering, et le `volumeClaimTemplates` d'un StatefulSet donne à chaque réplica supplémentaire son propre PVC non synchronisé. |
| `container_port` | `80` | Port HTTP par défaut de Grocy. |
| `enable_cloudsql_volume` | `false` | Grocy n'a pas de Cloud SQL — conservez `false`. |

### Groupe 6 — Configuration du backend GKE {#group-6--gke-backend-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `workload_type` | `null` | Se résout automatiquement en `"StatefulSet"` car `stateful_pvc_enabled = true` par défaut. |
| `service_type` | `LoadBalancer` | Valeur par défaut du module pour une application orientée navigateur. Ce déploiement remplace par `ClusterIP` via `config/deploy.tfvars` (contrainte de quota d'IP statique par projet). |

### Groupe 7 — Configuration du StatefulSet {#group-7--statefulset-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | **La décision de conception fondamentale pour ce module** — voir §4. Un véritable PVC de stockage par blocs, pas un système de fichiers réseau ou GCS FUSE. |
| `stateful_pvc_size` | `20Gi` | Dimensionné pour contenir la base de données SQLite, les images/pièces jointes et les sauvegardes sous `/config`. |
| `stateful_pvc_mount_path` | `/config` | Grocy conserve tout son état (base de données, configuration, téléchargements, sauvegardes) ici. Ne pas modifier sauf si le chemin de données de l'image amont change. |
| `stateful_pvc_storage_class` | `standard-rwo` | Disque persistant équilibré — un véritable périphérique de blocs, pas de couche de traduction FUSE. |
| `stateful_fs_group` | `1000` | Correspond au PUID/PGID réel de Grocy (1000/1000) — confirmé en direct via la génération réussie de clés TLS sous `/config/keys`. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | **Non utilisé sur GKE**, contrairement à `Grocy_CloudRun` qui repose sur NFS. Le PVC de blocs remplace ce rôle ici. |

### Groupe 15 — Redis {#group-15--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` (valeur par défaut de la variable) | **Remplacé inconditionnellement par `false` dans `main.tf`** quelle que soit la valeur de cette variable — Grocy n'a pas de dépendance de cache. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixe — Grocy n'a pas de base de données SQL de quelque nature que ce soit. |

### Groupe 11 — Automatisation des charges de travail {#group-11--workload-automation}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Pas de job d'initialisation par défaut — Grocy amorce son propre schéma SQLite au premier démarrage. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/`, délai de 15s, 10 tentatives | Page de connexion de Grocy — aucun point de terminaison de santé dédié n'existe. |
| `liveness_probe` | HTTP `/`, délai de 30s, 3 tentatives | Même point de terminaison que la sonde de démarrage. |

Toutes les autres entrées sont héritées de [App_GKE](App_GKE.md) avec un comportement standard.

---

## 6. Sorties {#6-outputs}

| Sortie | Description |
|---|---|
| `service_name` / `namespace` / `service_cluster_ip` | Identité du service Kubernetes. |
| `service_external_ip` / `service_url` | Adresse externe (si `LoadBalancer` et une IP statique sont utilisées). |
| `statefulset_name` | Nom du StatefulSet exécutant Grocy. |
| `storage_buckets` | Buckets Cloud Storage créés (le bucket `storage`, inutilisé pour `/config` lorsque le PVC est activé). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `initialization_jobs` | Noms des jobs d'initialisation créés (vides par défaut). |
| `kubernetes_ready` | Si le point de terminaison du cluster est disponible et si toutes les ressources Kubernetes sont déployées. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 7. Pièges de configuration et valeurs par défaut judicieuses {#7-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service
> dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration
> via le moteur de fondation [App_GKE](App_GKE.md), qui valide les valeurs
> *et les combinaisons* au moment de la planification. La plupart des entrées hors plage ou contradictoires sont
> détectées avant la création de toute ressource.

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `stateful_pvc_enabled` | `true` | Critique | Le désactiver sans un montage `gcs_volumes` correspondant ramène `/config` à GCS FUSE, reproduisant le risque de corruption par fréquence d'écriture confirmé sur `Grocy_CloudRun` — une couche de traduction réseau/stockage d'objets ne peut pas supporter le modèle d'écriture `grocy.db-journal` de Grocy. |
| `stateful_pvc_mount_path` | `/config` | Critique | Grocy code en dur son chemin de données vers `/config`. Changer le chemin de montage sans un changement d'image correspondant entraîne la perte d'accès à la base de données, à la configuration et aux téléchargements. |
| `max_instance_count` | `1` | Critique | La base de données SQLite de Grocy est mono-écriture sans prise en charge du clustering. Parce que le StatefulSet utilise `volumeClaimTemplates`, toute valeur supérieure à `1` ne partage même pas le stockage entre les réplicas — chaque pod obtient sa propre copie déconnectée des données. |
| `stateful_fs_group` | `1000` | Élevé | Grocy s'exécute en tant qu'UID 1000 / GID 1000 (PUID/PGID LinuxServer). Un `fsGroup` mal assorti rend le PVC inscriptible par le processus réel du conteneur, produisant des erreurs de permission au premier démarrage. |
| `enable_redis` | Toute valeur — ignorée | Faible | `main.tf` code en dur `enable_redis = false` quelle que soit cette variable, donc la définir `true` n'a aucun effet. Pas un risque, juste une opération nulle à connaître. |
| `database_type` | `NONE` | Moyen | Grocy l'ignore entièrement (aucun chemin de code ne le lit), mais définir autre chose provisionne une instance Cloud SQL inutilisée et facturée. |
| Mot de passe administrateur | Changer à la première connexion | Élevé | Les identifiants par défaut `admin` / `admin` de l'image amont sont publiquement documentés ; les laisser inchangés sur un déploiement exposé `LoadBalancer` est une réelle exposition. |
| `min_instance_count` | `1` | Faible | Définir `0` permet d'économiser des coûts mais réintroduit des démarrages à froid sur la pile nginx + php-fpm de Grocy. |

---

Pour le comportement de la fondation référencé tout au long — Workload Identity, ingress
et équilibrage de charge, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**.
La configuration d'application spécifique à Grocy partagée avec la variante Cloud Run est
décrite dans **[Grocy_Common](Grocy_Common.md)**. Pour le bug de corruption de stockage
que ce module a évité par conception, voir **[Grocy_CloudRun](Grocy_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Labo pratique : Grocy sur GKE Autopilot](../labs/Grocy_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Grocy sur Google Cloud Run](Grocy_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Grocy Common — Configuration d'application partagée](Grocy_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [Mealie sur GKE Autopilot](Mealie_GKE.md), [Homebox sur GKE Autopilot](Homebox_GKE.md), [Wallos sur GKE Autopilot](Wallos_GKE.md), [LubeLogger sur GKE Autopilot](LubeLogger_GKE.md) dans la solution **Gestion de la maison et de la vie**.
