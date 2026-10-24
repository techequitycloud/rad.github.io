---
title: "Budibase sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Budibase sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Budibase_CloudRun.md @ e69407af sha256:5edf6295f7d9 -->

# Budibase sur Google Cloud Run {#budibase-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Budibase_CloudRun.png" alt="Budibase sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Budibase est une plateforme low-code open source pour la création d'outils
internes, d'applications métier et de workflows basés sur vos données. Ce module
déploie Budibase sur **Cloud Run v2** sur la base de la fondation
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
partagée de Google Cloud.

Ce guide se concentre sur les services cloud utilisés par Budibase et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications Cloud
Run — identité de service, entrée et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter
ici.

---

## Ce que coûte Budibase sur RAD, et comment cela se compare {#what-budibase-costs-on-rad-and-how-that-compares}

**Le module Cloud Run de Budibase sur RAD coûte environ 232 $ US par mois dans
votre propre projet Google Cloud, sans frais de licence supplémentaires** —
Budibase est open source. Dans un projet géré par RAD pour vous, le même
déploiement est facturé à **105 crédits par jour** (environ 3 150 par mois,
environ 315 $ US au prix de la recharge). Ou consultez le [guide GKE](Budibase_GKE.md)
pour une capacité toujours active sur les pods. Si vous n'avez besoin de Budibase
qu'occasionnellement — études, démo, projet de courte durée — un projet géré par
RAD peut être supprimé et restauré dans les 30 jours pour quelques crédits, de
sorte que ce chiffre mensuel devient quelques dollars à la place. Voir **Mettez-le
en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

Budibase est open source, il n'y a donc pas de frais de licence. Vous payez pour
trois choses :

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 300 crédits (30 $ US au prix de la recharge) | 270 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build (environ 3 à 6 crédits) | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **232 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Facturé à l'heure en crédits ; RAD publie **105 crédits par jour**, environ 3 150 par mois (environ 315 $ US au prix de la recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde acheté minimum est conservé en réserve |

10 crédits coûtent 1 $ US en recharge unique, et moins sur un plan mensuel. Dans un
projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont
partagés par toutes les applications du projet, de sorte qu'une deuxième
application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Cloud Run, 4x vCPU / 8 GiB (alwaysOn) | 226,05 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| **Total** | **environ 232 $ US** |

Ces prix sont les mêmes en africa-south1 (Johannesburg).

- **Ce module fonctionne en continu par conception** — il n'y a pas d'option de
  mise à l'échelle à zéro ici — donc le chiffre Cloud Run ci-dessus suppose déjà
  qu'il est toujours actif.

### Comment cela se compare {#how-it-compares}

L'équipe de Budibase vend un **Budibase Cloud** hébergé :

| Plan | Par mois | Notes |
|---|---|---|
| Pro | 19 $ US | Plan cloud d'entrée de gamme |
| Premium | 49 $ US | Plus de créateurs, crédits IA, rétention des logs |
| Business | 299 $ US | Limites plus élevées, plus d'espaces de travail |
| Enterprise | Personnalisé | Contacter les ventes |

Budibase Cloud facture par niveau de plan (créateurs, crédits IA, espaces de
travail), et non par la puissance de calcul réellement utilisée par cette
application, ce n'est donc pas une comparaison directe avec le tableau
ci-dessus — c'est l'alternative officielle si vous préférez ne pas gérer
d'infrastructure du tout. Le module de RAD exécute le même Budibase open source
sur une infrastructure que vous pouvez voir et qui s'adapte à votre propre
utilisation plutôt qu'aux limites de sièges/créateurs d'un plan.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Budibase s'exécute dans **un projet géré par RAD pour vous**, la suppression
de l'ensemble du projet — plutôt que la suppression de ce seul module —
délie d'abord sa facturation, puis demande à Google de supprimer
définitivement le projet. Google le conserve, récupérable, pendant 30 jours, et
parce que la facturation est déjà déliée, rien n'est facturé pendant qu'il
attend. Contrairement à la suppression d'un module, cela ne détruit pas Cloud
SQL, aucune VM ou la ressource de calcul une par une : l'ensemble du projet
s'arrête simplement.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **La restauration est une vérification, pas une reconstruction.** Dans les 30
  jours, le propriétaire du projet peut demander à Google de restaurer le projet
  et de rattacher son compte de facturation, puis d'exécuter **Mettre à jour**
  sur chaque déploiement pour confirmer que tout est revenu. Parce que rien n'a
  été détruit individuellement, cette mise à jour trouve les mêmes ressources
  déjà présentes, et une mise à jour ne facture plus jamais les frais de module.
  Pour une chaîne typique de 2 à 3 déploiements, cela ne coûte qu'une poignée de
  crédits au total (environ 5 à 10 crédits, moins de 1 $ US).
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet dont
  RAD gère uniquement la facturation), le restaurer vous-même dans les 30 jours
  — après quoi Google le supprime définitivement — et atteindre à nouveau le
  seuil d'admission du niveau (100 crédits pour le niveau sandbox que la plupart
  des utilisations d'étude/démo conviennent). Google indique que la plupart des
  services fonctionnent à nouveau pleinement dans les 36 heures suivant une
  restauration.
- **Une lacune réelle : les sauvegardes nocturnes ne survivent pas.** Les
  sauvegardes sont écrites dans un bucket à l'intérieur du projet, et ce bucket
  a la suppression logicielle de Cloud Storage désactivée, il est donc très
  probable qu'il disparaisse dès que le projet est supprimé — même si le projet
  lui-même est récupérable pendant 30 jours. Copiez une sauvegarde (vers Google
  Drive, ou un bucket en dehors du projet) avant de la supprimer s'il y a
  quelque chose d'important à conserver ; pour une installation par défaut sans
  rien d'irremplaçable, cela n'a pas d'importance.

Source : [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects).

### Payez uniquement pendant que vous l'utilisez, l'autre façon : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que la fenêtre de restauration de 30 jours
ci-dessus est passée, la façon d'arrêter de payer est de supprimer le
déploiement et de le redéployer lorsque vous en avez besoin.

- **Ce que coûte un redéploiement.** Les frais de module à nouveau, plus les
  builds : environ 304 crédits (environ 30,40 $ US) au prix de la recharge, et
  environ 15 à 20 minutes de temps de build (moyenne de la propre plateforme de
  RAD). La suppression ne permet d'économiser de l'argent que si Budibase
  devait rester inutilisé pendant environ **3 jours ou plus** — dans votre
  propre projet, cela représente environ 7,74 $ US par jour, et dans un projet
  géré par RAD, c'est 105 crédits par jour.
- Le coût d'exécution de ce module est entièrement le sien — rien dans le
  tableau ci-dessus n'est partagé avec d'autres applications du projet, donc la
  suppression de Budibase arrête tout.
- **Conservez d'abord les données.** Les sauvegardes nocturnes vont dans un
  bucket à l'intérieur du déploiement et sont supprimées avec lui, alors copiez
  la dernière sauvegarde avant de la supprimer si vous voulez la conserver.

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
  personne ne reçoit de frais inattendus. À la fin, le partenaire remet le
  projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF,
NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud
Billing Catalog ; frais RAD et estimation des crédits quotidiens de
[radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et
restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour la fenêtre de pause/restauration et la mise en garde sur le bucket de
sauvegarde ; [Tarification Budibase Cloud](https://budibase.com/pricing/) ; les
prix changent, vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Budibase s'exécute comme un seul conteneur **tout-en-un** sur Cloud Run v2.
L'image officielle `budibase/budibase` regroupe **CouchDB + MinIO + Redis** et les
applications/worker/proxy Budibase et sert HTTP sur le **port 80** — il n'y a
pas de base de données gérée externe. Le déploiement relie un ensemble ciblé de
services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Conteneur tout-en-un unique, 4 vCPU / 8 GiB par défaut ; s'exécute comme **une** instance (min = max = 1) |
| Base de données | Aucune (CouchDB intégré) | `database_type = "NONE"` — CouchDB, MinIO et Redis s'exécutent tous à l'intérieur du conteneur |
| Stockage d'objets | Cloud Storage | Un bucket de données provisionné automatiquement ; le propre magasin d'actifs de Budibase est le MinIO intégré |
| Cache et file d'attente | Redis intégré | S'exécute à l'intérieur du conteneur sur loopback ; `enable_redis` est désactivé par défaut |
| Secrets | Secret Manager | Sept identifiants internes auto-générés injectés comme variables d'environnement de secret de service |
| Entrée | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut ; équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Cloud Run est éphémère / démo uniquement pour Budibase.** Tout l'état
  (documents CouchDB + objets MinIO) réside sur le chemin du conteneur `/data`,
  et **Cloud Run n'a pas de disque local durable** — un redémarrage ou une
  nouvelle révision perd le magasin de données. Pour un déploiement persistant,
  utilisez la [variante GKE](Budibase_GKE.md), qui monte un PVC de bloc à
  `/data`.
- **S'exécute en une seule instance.** `min_instance_count = 1` et `max_instance_count = 1`. Le conteneur
  tout-en-un conserve tout l'état localement, de sorte que plusieurs réplicas
  ne partageraient pas les données (split-brain). La mise à l'échelle à zéro
  supprimerait le magasin de données en cours d'exécution, donc min est 1.
- **`cpu_always_allocated = true`.** Le CPU est alloué en permanence afin que les processus
  d'arrière-plan CouchDB/MinIO/Redis intégrés continuent de fonctionner entre
  les requêtes ; maintenez-le `true` avec `min_instance_count >= 1`.
- **Sept identifiants internes sont générés automatiquement** et stockés dans
  Secret Manager (`INTERNAL_API_KEY`, `JWT_SECRET`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`,
  `API_ENCRYPTION_KEY`, `REDIS_PASSWORD`, `COUCH_DB_PASSWORD`). Ceux-ci ne doivent jamais être
  renouvelés après le premier démarrage — les données sur `/data` sont chiffrées
  avec eux et deviennent illisibles s'ils changent.
- **Le port 80 est fixe.** Le proxy nginx de l'image tout-en-un sert toute
  l'application sur le port 80, donc `container_port` et les sondes sont épinglées à 80.
- **Pas de base de données externe ou de job `db-init`.** Budibase
  auto-provisionne CouchDB et MinIO au premier démarrage ; `enable_cloudsql_volume` et `database_type`
  sont désactivés/`NONE` par défaut.
- **Entrée publique par défaut.** `ingress_settings = "all"` pour que l'application soit
  accessible à son URL `run.app` ; l'activation d'IAP place la connexion Google
  devant elle.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de
services et de ressources sont signalés dans les [Sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service Budibase {#a-cloud-run--the-budibase-service}

Budibase s'exécute comme un service Cloud Run v2. Parce qu'il conserve tout
l'état localement, il s'exécute comme une seule instance (min = max = 1) ;
chaque déploiement crée une révision immuable.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le
  trafic, les logs et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Magasin de données (CouchDB + MinIO intégrés) {#b-data-store-bundled-couchdb--minio}

Il n'y a **pas d'instance Cloud SQL** — `database_type = "NONE"`. Le magasin de documents CouchDB
et le magasin d'objets MinIO de Budibase s'exécutent tous deux **à l'intérieur
du conteneur** et persistent sur `/data`. Sur Cloud Run, ce répertoire se trouve
sur le système de fichiers éphémère du conteneur, il ne survit donc pas à un
redémarrage. Inspectez les services intégrés via l'environnement du conteneur et
les logs plutôt que via une console de base de données gérée :

- **CLI :**
  ```bash
  # Confirm database_type=NONE and the bundled-service env in the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

Pour un magasin de données durable, utilisez la [variante GKE](Budibase_GKE.md)
(PVC de bloc sur `/data`).

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** dédié (suffixe de nom `storage`) est provisionné
automatiquement. Le propre magasin d'actifs/pièces jointes de Budibase est le
MinIO intégré ; ce bucket GCS est disponible pour l'intégration du stockage au
niveau de la fondation.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/        # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### D. Redis (intégré) {#d-redis-bundled}

Redis s'exécute **à l'intérieur du conteneur tout-en-un** sur loopback et est
authentifié avec le `REDIS_PASSWORD` auto-généré. `enable_redis` est **désactivé par défaut** —
n'activez pas un Redis externe à moins que vous n'externalisiez
délibérément le cache.

- **CLI :**
  ```bash
  # Verify the bundled Redis password secret is wired into the revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)' | tr ',' '\n' | grep -i redis
  ```

### E. Secret Manager {#e-secret-manager}

Sept identifiants internes sont générés automatiquement et stockés dans Secret
Manager, puis injectés comme variables d'environnement de secret de service :
`INTERNAL_API_KEY`, `JWT_SECRET`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `API_ENCRYPTION_KEY`, `REDIS_PASSWORD`, et
`COUCH_DB_PASSWORD`. Ils ne doivent jamais être renouvelés après le premier démarrage.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~budibase"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et
[Budibase_Common](Budibase_Common.md) pour ce que chaque secret protège.

### F. Réseau et entrée {#f-networking--ingress}

Le service est accessible à son URL `run.app` par défaut. Un équilibreur de charge
HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peut être
superposé ; les paramètres d'entrée et de sortie VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les logs des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run
sont envoyées à Cloud Monitoring, avec des tests de disponibilité et des
politiques d'alerte facultatifs.

- **Console :** Logging → Explorateur de logs ; Monitoring → Tableaux de bord /
  Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Budibase {#3-budibase-application-behaviour}

- **Pas de bootstrap de base de données externe.** Avec `database_type = "NONE"`, il n'y a pas de
  job `db-init`. Budibase auto-provisionne son CouchDB et MinIO intégrés au premier
  démarrage à l'intérieur du conteneur. Seuls les `initialization_jobs` fournis par l'utilisateur
  sont honorés.
- **L'état réside sur `/data` — et Cloud Run ne le persiste pas.** Les documents
  CouchDB et les objets MinIO sont écrits sur `/data` sur le système de fichiers
  éphémère du conteneur. Tout redémarrage ou nouvelle révision démarre à partir
  d'un magasin vide, donc traitez un déploiement Budibase Cloud Run comme
  éphémère/démo uniquement et utilisez la variante GKE pour tout ce que vous
  devez conserver.
- **Les identifiants internes sont immuables après le premier démarrage.** Les
  sept secrets générés chiffrent les données sur `/data`. Changer `API_ENCRYPTION_KEY` corrompt
  toutes les données stockées chiffrées ; changer `JWT_SECRET` invalide toutes les
  sessions ; changer les identifiants MinIO ou CouchDB rompt l'accès aux
  magasins d'objets/documents. Ne les renouvelez que lors d'une réinitialisation
  planifiée.
- **Configuration initiale.** Budibase auto-hébergé est livré **sans compte
  administrateur par défaut**. Ouvrez l'URL du service après le déploiement et
  créez l'administrateur initial (e-mail + mot de passe) via l'écran de
  configuration avant utilisation.
- **Chemin de santé.** La sonde de démarrage est **TCP** sur le port 80 (pas
  HTTP) : nginx lie le port en quelques secondes mais renvoie 502 jusqu'à ce que
  les upstreams CouchDB/MinIO/app intégrés aient fini de démarrer, donc une
  vérification HTTP sur `/` échouerait pendant toute la fenêtre de démarrage
  de l'upstream — TCP passe dès que nginx lie le port, permettant à la révision
  de passer à l'état Prêt pendant que les upstreams se terminent en arrière-plan
  (délai initial de 30 secondes, fenêtre de 40 tentatives à une période de 15
  secondes, ~10 minutes au total). Les sondes de vivacité et de disponibilité
  sont HTTP sur la racine non authentifiée `/` ; la vivacité utilise un délai
  initial de 240 secondes pour effacer la fenêtre post-démarrage où `/`
  renvoie toujours 502.
- **Instance unique uniquement.** Gardez `min_instance_count = max_instance_count = 1` ; le magasin de données est local
  au conteneur et ne peut pas être partagé entre les réplicas.
- **Vérifiez la révision en cours d'exécution :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --project "$PROJECT" \
    --format='value(status.url)'
  gcloud run jobs list --project "$PROJECT" --region "$REGION"   # only user-supplied init jobs
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Budibase sont listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `budibase` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Budibase` | Nom lisible par l'homme affiché dans la console. |
| `application_version` | `3.39.29` | Tag de l'image Budibase ; utilisé comme `FROM budibase/budibase:<tag>` pour le build du wrapper léger. Incrémentez pour déclencher un nouveau build/révision. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_port` | `80` | Le proxy nginx de l'image tout-en-un sert toute l'application sur le port 80 — doit rester 80. |
| `container_resources` | `4000m` / `8Gi` | CPU et mémoire par instance ; le CouchDB/MinIO/Redis intégré + le niveau d'application nécessitent une mémoire généreuse — 4Gi OOM-loops sur Cloud Run gen2 (le répertoire `/data` inscriptible compte pour la limite de mémoire), donc 8Gi est le minimum fiable. |
| `min_instance_count` | `1` | Gardez à 1 — la mise à l'échelle à zéro supprimerait le magasin de données local. |
| `max_instance_count` | `1` | Gardez à 1 — le conteneur conserve tout l'état localement ; les réplicas ne partageraient pas les données. |
| `cpu_always_allocated` | `true` | Allouez le CPU en permanence afin que les services d'arrière-plan intégrés continuent de fonctionner entre les requêtes. |
| `execution_environment` | `gen2` | Gen2 recommandé. |
| `enable_cloudsql_volume` | `false` | Budibase n'utilise pas de base de données SQL externe. |
| `enable_image_mirroring` | `true` | Mettez en miroir l'image Budibase dans Artifact Registry. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Accessible à l'URL `run.app` par défaut. |
| `enable_iap` | `false` | Exigez la connexion Google devant Budibase. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires fusionnés dans le conteneur. Les valeurs principales (`BUDIBASE_ENVIRONMENT`, `SELF_HOSTED`, `COUCH_DB_USER`, `LOG_LEVEL`) sont définies automatiquement. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. Les sept identifiants internes sont injectés automatiquement — ne les définissez pas ici. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Budibase intègre son propre CouchDB ; aucune base de données gérée externe n'est provisionnée. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 21 — Cache et file d'attente Redis {#group-21--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Redis s'exécute à l'intérieur du conteneur ; laissez désactivé à moins d'externaliser le cache. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Utilisé uniquement si un Redis externe est activé. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

---

## 5. Sorties {#5-outputs}

Retournées lors d'un déploiement réussi — le moyen le plus rapide de localiser
et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` / `database_name` / `database_user` | Rempli uniquement si une base de données gérée est utilisée ; vide pour Budibase (`database_type = NONE`). |
| `database_password_secret` / `database_host` / `database_port` | Secret / point de terminaison / port de la base de données (non utilisé pour Budibase). |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs d'initialisation fournis par l'utilisateur. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration
> au moteur de fondation [App_CloudRun](App_CloudRun.md), qui valide les
> valeurs *et les combinaisons* au moment du plan — un `container_port` hors limites, une
> quantité de CPU/mémoire invalide, un `database_type` qui ne correspond pas à une
> extension activée, un `redis_port`/`backup_retention_days` hors limites. Une configuration invalide
> échoue le **plan** avec une erreur claire et nommée avant qu'aucune ressource
> ne soit créée, de sorte que la plupart des erreurs ci-dessous sont détectées
> en amont plutôt qu'au moment de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| Cloud Run comme plateforme | GKE pour la persistance | Critique | Cloud Run n'a pas de disque durable — `/data` (tout l'état CouchDB + MinIO) est perdu à chaque redémarrage/révision. Utilisez Budibase_CloudRun uniquement pour la démo/évaluation. |
| `API_ENCRYPTION_KEY` (auto-généré) | Ne jamais renouveler après le premier démarrage | Critique | Le renouveler corrompt toutes les données stockées chiffrées — elles ne peuvent pas être déchiffrées. |
| `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` / `COUCH_DB_PASSWORD` (auto-généré) | Ne jamais renouveler après le premier démarrage | Critique | Le renouveler rompt l'accès aux magasins d'objets/documents intégrés chiffrés avec `/data`. |
| `JWT_SECRET` (auto-généré) | Ne renouveler que pendant une fenêtre de maintenance | Élevé | Le renouveler invalide toutes les sessions utilisateur actives, forçant une reconnexion immédiate. |
| `max_instance_count` | `1` | Critique | Plus d'une instance divise le magasin de données local — les réplicas ne partagent pas `/data` (split-brain, perte de données). |
| `min_instance_count` | `1` | Élevé | La mise à l'échelle à zéro supprime le magasin de données en cours d'exécution dans le conteneur. |
| `cpu_always_allocated` | `true` | Élevé | La facturation basée sur les requêtes étrangle le travail d'arrière-plan CouchDB/MinIO/Redis intégré à ~0 CPU entre les requêtes. |
| `container_port` | `80` | Élevé | Le proxy nginx sert l'application sur le port 80 ; tout autre port échoue les sondes et le service ne devient jamais Prêt. |
| `database_type` | `NONE` | Élevé | La sélection d'un moteur externe provisionne une instance Cloud SQL inutilisée ; Budibase ne s'y connecte jamais. |
| `memory_limit` | `8Gi` | Élevé | 4Gi OOM-loops (redémarrages d'instance toutes les ~60s) — le répertoire `/data` inscriptible (état CouchDB/MinIO/Redis) est en mémoire sur Cloud Run gen2 et compte pour la limite ; 8Gi est le minimum fiable. |
| Premier compte administrateur | Créer immédiatement après le déploiement | Élevé | Budibase auto-hébergé est livré sans administrateur par défaut — une instance non réclamée peut être réclamée par quiconque atteint l'URL. |
| `enable_iap` | activer pour les déploiements privés | Moyen | Sans IAP ou WAF, l'interface utilisateur est publiquement accessible à l'URL `run.app`. |

---

Pour le comportement de la fondation référencé tout au long — identité de
service, mise à l'échelle et concurrence, entrée et équilibrage de charge,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en
miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration
d'application spécifique à Budibase partagée avec la variante GKE est décrite
dans **[Budibase_Common](Budibase_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Budibase sur Cloud Run](../labs/Budibase_CloudRun.md) —
  déployez-le étape par étape, avec les écrans de console et les commandes à
  chaque étape.
- [Budibase sur GKE Autopilot](Budibase_GKE.md) — la même application sur
  Kubernetes, pour lorsque vous avez besoin de l'autre cible de déploiement.
- [Budibase Common — Configuration d'application partagée](Budibase_Common.md)
  — la configuration partagée par les deux cibles de déploiement.
