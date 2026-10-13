---
title: "Karakeep sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Karakeep sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Karakeep_GKE.md @ e69407af sha256:10e4310b4f18 -->

# Karakeep sur GKE Autopilot {#karakeep-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Karakeep_GKE.png" alt="Karakeep sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Karakeep est une application open-source et auto-hébergeable pour tout marquer
(liens, notes et images) avec un étiquetage automatique basé sur l'IA et une
recherche sémantique/en texte intégral. Ce module déploie Karakeep sur **GKE
Autopilot** au-dessus de la fondation [App_GKE](App_GKE.md), qui provisionne et
gère l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Karakeep et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et le cycle de vie du
déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## Ce que coûte Karakeep sur RAD, et comment cela se compare {#what-karakeep-costs-on-rad-and-how-that-compares}

**Karakeep sur le module GKE de RAD coûte environ 54 US$ par mois dans votre propre projet, plus des frais de module de 40 crédits (4 US$) une fois par déploiement.** Si vous n'en avez besoin que pour un projet limité, consultez la section "Mettez-le en pause gratuitement" ci-dessous pour arrêter de payer sans perdre vos favoris. Karakeep est également livré en tant que module Cloud Run, qui est l'option la moins chère ici (environ 30 US$/mois) — consultez le guide Cloud Run, sauf si vous utilisez déjà GKE Autopilot pour d'autres applications.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 40 crédits (4,00 US$) | 36 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **53,72 US$ par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **69 crédits par jour** |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 US$ pour une recharge ponctuelle, moins sur un plan. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Pod GKE Autopilot, 1x vCPU / 0,5 GiB | 34,29 US$ |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 US$ |
| Cloud NAT et réseau | 5,00 US$ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 US$ |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 |
| **Total** | **environ 53,72 US$** |

### Comment cela se compare {#how-it-compares}

- Karakeep (anciennement Hoarder) n'a pas de plan SaaS hébergé officiel à comparer — il est
  distribué purement comme une application auto-hébergée avec une base de données SQLite
  intégrée — donc la comparaison honnête est un serveur nu.
- Son empreinte est légère (1 vCPU, 0,5 GiB), donc même un niveau de VPS moins cher/plus petit
  que ceux ci-dessous le ferait fonctionner confortablement ; à titre de référence, un Hetzner
  CPX22 ou un droplet DigitalOcean 2 vCPU/4 Go coûte environ 24 $/mois.
- Ce que RAD ajoute par rapport à un VPS nu : le partage NFS pour les images et les pièces
  jointes téléchargées, la gestion du réseau et la surveillance — la propre base de données
  SQLite de Karakeep n'a pas besoin de service de base de données séparé à administrer, donc
  l'écart ici est principalement le stockage et la commodité opérationnelle plutôt que
  l'entretien de la base de données.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Karakeep s'exécute dans un projet géré par RAD pour vous et que vous prévoyez d'y revenir — une pause
entre les cours, un creux saisonnier, ou simplement ne pas savoir encore si vous en aurez besoin le mois
prochain — c'est la meilleure option, et cela ne coûte presque rien.

La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer
purement et simplement le projet : la suppression logicielle récupérable de 30 jours de Google. Contrairement
à la suppression de Karakeep en tant que module unique, cela ne supprime pas le service Cloud Run/GKE, le
serveur de fichiers NFS et le réseau un par un — l'ensemble du projet s'arrête simplement, et rien n'est
facturé pendant qu'il attend, car la facturation est déjà déliée.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de
récupérer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter la mise à jour
sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement,
cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une
reconstruction, et une mise à jour ne facture plus jamais les frais de module. Cela ne coûte qu'une
poignée de crédits (moins de 1 US$) en temps de build pour une chaîne de déploiements typique.

Ce qu'il faut : vous devez posséder le projet (pas un que RAD gère uniquement pour la facturation), vous
devez le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la
restauration est admise comme la création d'un nouveau projet, donc votre solde de crédits achetés doit
toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart utilisent
convient). Google indique que la plupart des services sont à nouveau pleinement fonctionnels dans les 36
heures suivant une restauration.

Un véritable écart : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce
bucket a la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable
qu'il disparaisse dès que vous supprimez le projet, même si le projet lui-même est récupérable pendant 30
jours. L'exportation nocturne de Karakeep de sa base de données SQLite et de ses actifs téléchargés est
conservée dans ce bucket ; pour une installation par défaut, c'est la seule copie de vos favoris qui
vaille la peine d'être conservée.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que la fenêtre de 30 jours ci-dessus est passée, la solution de
repli est de supprimer Karakeep purement et simplement et de le redéployer plus tard.

- **Ce que coûte un redéploiement :** les frais de module à nouveau, plus les builds —
  environ les frais de module indiqués ci-dessus plus 3 à 6 crédits de temps de build.
- **Quand cela en vaut la peine :** la suppression ne permet d'économiser de l'argent que si
  Karakeep resterait autrement inutilisé pendant environ 2 jours ou plus dans votre propre
  projet (moins d'une journée dans un projet géré par RAD). Les frais de gestion de cluster
  GKE et la VM NFS constituent la majeure partie du coût d'exécution ici, donc la suppression
  de Karakeep seule n'économise que sa propre part si l'un ou l'autre est partagé avec
  d'autres applications.
- **Conservez d'abord les données.** Les sauvegardes nocturnes sont écrites dans un bucket
  à l'intérieur du déploiement, et ce bucket est supprimé avec lui — copiez la dernière
  sauvegarde (vers Google Drive, ou un bucket que vous conservez) avant de la supprimer si
  vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe.
  Chaque participant obtient l'application dans son propre projet Google Cloud pendant 15
  minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le
  formateur finance toutes les places, soit chaque participant paie la sienne. Tout est
  supprimé à la fin de la session et les crédits inutilisés retournent au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute l'application
  pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement
  avec le client. Si le portefeuille est faible, la facturation est suspendue et les données
  sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le
  partenaire transfère le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES
  et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais RAD et estimation des crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Google Cloud : supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour le mécanisme de pause/restauration. Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

---

## 1. Vue d'ensemble {#1-overview}

Karakeep s'exécute comme une charge de travail web Next.js, associée à un
Service Meilisearch sidecar obligatoire pour la recherche. Contrairement à la
plupart des applications de ce catalogue, il n'utilise **aucune base de données
relationnelle externe** — tout l'état réside dans une base de données SQLite
intégrée et des actifs téléchargés sur le volume NFS partagé de la plateforme :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pod Next.js, 1 vCPU / 512 Mio par défaut, épinglé à un seul réplica |
| Recherche | GKE Autopilot (Service interne) | Un sidecar Meilisearch requis, déployé automatiquement — non optionnel |
| Base de données | aucune | L'état réside dans une base de données SQLite intégrée, pas Cloud SQL |
| Stockage d'objets | aucun (NFS à la place) | Les actifs téléchargés persistent sur le volume NFS partagé de la plateforme, pas GCS |
| Secrets | Secret Manager | Auto-généré `NEXTAUTH_SECRET` et `MEILI_MASTER_KEY` |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé optionnel + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de Cloud SQL.** `database_type = "NONE"` — la base de données SQLite intégrée de Karakeep
  et les actifs téléchargés résident tous deux sur le volume NFS partagé de la
  plateforme.
- **Un seul réplica.** `max_instance_count = 1` — plusieurs pods écrivant le même fichier SQLite
  sur NFS risquent une corruption même avec le mode WAL désactivé.
- **`Recreate` stratégie de déploiement appliquée automatiquement.** La Fondation
  détecte les applications basées sur NFS et utilise `Recreate` au lieu de
  `RollingUpdate`, évitant le blocage de deux pods s'exécutant brièvement qu'une
  mise à jour glissante provoquerait autrement.
- **Meilisearch est obligatoire, pas optionnel.** Déployé automatiquement en
  tant que Service Kubernetes interne uniquement. Sans lui, `MEILI_ADDR` de
  Karakeep n'est pas défini et la recherche est silencieusement désactivée.
- **Pas de build de conteneur personnalisé.** Le mode journal SQLite de Karakeep
  est déjà par défaut le mode `DELETE` sûr pour NFS — l'image officielle
  pré-construite est déployée telle quelle.
- **Pas de credential d'amorçage administrateur.** Le premier compte créé via
  le formulaire d'inscription de l'interface web devient l'administrateur.
- **`NEXTAUTH_URL` utilise la substitution native de Kubernetes `$(VAR)`** —
  `$(GKE_SERVICE_URL)` se résout à la valeur injectée de la Fondation au démarrage du
  conteneur (contrairement à Cloud Run, où `$(VAR)` est passé littéralement).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis.

### A. GKE Autopilot — la charge de travail Karakeep {#a-gke-autopilot--the-karakeep-workload}

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail Karakeep.
  Kubernetes Engine → Services & Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de charge de travail.

### B. Meilisearch (sidecar requis) {#b-meilisearch-required-sidecar}

Déployé automatiquement en tant que Service Kubernetes séparé, interne uniquement. Son URL
est auto-injectée dans `MEILI_ADDR` de l'application principale. Son index réside sur le
stockage éphémère du sidecar — les services supplémentaires ne partagent pas le volume NFS de
l'application principale — et se reconstruit à partir de zéro à chaque redémarrage. Cela
affecte uniquement la disponibilité de la recherche, pas la sécurité des données ; les
favoris persistent sur `/data` monté sur NFS de l'application principale.

- **CLI :**
  ```bash
  kubectl get svc -n "$NAMESPACE" -l app=meilisearch
  kubectl logs -n "$NAMESPACE" deploy/<service>-meilisearch --tail=50
  ```

### C. NFS (Cloud Filestore ou la VM NFS+Redis auto-gérée) {#c-nfs-cloud-filestore-or-the-self-managed-nfsredis-vm}

La base de données SQLite intégrée de Karakeep et ses actifs téléchargés résident tous deux sur le
volume NFS partagé de la plateforme, monté à `/data`.

- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT" 2>/dev/null
  gcloud compute instances list --project "$PROJECT" --filter="name~nfs"
  ```

### D. Secret Manager {#d-secret-manager}

Deux secrets sont générés automatiquement : `NEXTAUTH_SECRET` et
`MEILI_MASTER_KEY`.

- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~karakeep"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

### E. Réseau et ingress {#e-networking--ingress}

- **CLI :**
  ```bash
  kubectl get svc -n "$NAMESPACE" -o wide
  ```

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

- **CLI :**
  ```bash
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100 -f
  ```

---

## 3. Comportement de l'application Karakeep {#3-karakeep-application-behaviour}

- **Pas de Job de configuration de base de données au premier déploiement.** Karakeep gère
  son propre schéma SQLite en interne au démarrage.
- **Pas de credential d'amorçage administrateur à récupérer.** Le premier compte créé via
  l'interface web devient l'administrateur.
- **La recherche dépend de la joignabilité du sidecar.** Si le Service Meilisearch ne démarre
  pas, la recherche cesse silencieusement de fonctionner ; la mise en favori continue.
- **Chemin de santé.** La sonde de démarrage cible `/` ; la sonde de vivacité
  (`health_check_config`) cible `/api/health`, qui renvoie un 200 littéral. `/`
  redirige vers `/signin` (307), et le chemin de vivacité est reflété dans la
  vérification de santé de la passerelle, qui traite une redirection comme malsaine.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres spécifiques ou notables pour Karakeep sont listés ;
toute autre entrée est héritée de [App_GKE](App_GKE.md) avec son comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `karakeep` | Nom de base pour les ressources. |
| `application_version` | `latest` | Correspond à la propre balise `"release"` de Karakeep. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `prebuilt` | Pas de build personnalisé nécessaire. |
| `min_instance_count` / `max_instance_count` | `0` / `1` | Réplica unique épinglé pour la sécurité de SQLite sur NFS. |
| `container_port` | `3000` | Port natif par défaut de Karakeep. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Requis — la base de données SQLite et les actifs de Karakeep résident ici. |
| `nfs_mount_path` | `"/app/data"` | Le module définit `DATA_DIR` sur ce chemin. La variante Cloud Run utilise `/data` à la place — les deux fonctionnent, car `DATA_DIR` suit toujours le montage. |
| `stateful_pvc_enabled` | `null` | Non défini, donc la propre logique de résolution de `App_GKE` s'applique (pas de PVC). Karakeep utilise NFS, pas un PVC de bloc. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixe — aucune instance Cloud SQL n'est provisionnée. |

---

## 5. Sorties {#5-outputs}

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms Kubernetes. |
| `service_external_ip` | Adresse IP externe du LoadBalancer. |
| `database_instance_name` / `database_name` / `database_user` / `database_host` / `database_port` | Vide — non applicable. |
| `storage_buckets` | Vide — Karakeep persiste via NFS. |
| `kubernetes_ready` | Indique si la charge de travail a atteint l'état Prêt. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `max_instance_count` | `1` (par défaut épinglé) | Critique | Augmenter cela risque une corruption SQLite due à des écrivains NFS concurrents. |
| Premier compte créé via l'inscription | Créez-le immédiatement après le déploiement | Critique | Le premier compte à s'inscrire devient administrateur. |
| `enable_nfs` | `true` (par défaut) | Critique | Le désactiver supprime tout stockage durable. |
| `container_image_source` | `prebuilt` (par défaut) | Élevé | `"custom"` déclenche un Cloud Build inutile sans Dockerfile dans ce module. |
| Joignabilité du sidecar Meilisearch | Vérifiez que `MEILI_ADDR` est résolu après le déploiement | Moyen | La recherche cesse silencieusement de fonctionner si le sidecar ne démarre pas. |
| `NEXTAUTH_SECRET` (auto-généré) | Ne jamais faire pivoter après le premier démarrage | Critique | Le faire pivoter invalide toutes les sessions actives. |
| Variable d'environnement `DATA_DIR` | Définie explicitement (ce module la définit toujours à `nfs_mount_path`) | Critique | La valeur par défaut de Karakeep est une **chaîne vide**, pas `/data` (cette valeur par défaut n'existe que dans le modèle docker-compose en amont). Si elle n'est pas définie, les migrations et le fichier SQLite se résolvent silencieusement en stockage éphémère au lieu du montage NFS. |
| Format de la valeur `additional_services[].secret_env_vars` | Nom de clé simple (par exemple `"MEILI_MASTER_KEY"`) | Élevé | Les magasins de secrets K8s consolidés par locataire de GKE nomment les clés d'après la variable d'environnement elle-même — **pas** la chaîne brute `secret_id` de Secret Manager (c'est la convention Cloud Run). L'utilisation d'un format incorrect provoque `CreateContainerConfigError: couldn't find key <secret_id> in Secret <prefix>-secrets`. |

---

Pour le comportement de la fondation référencé tout au long — Workload Identity, ingress,
autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et
mise en miroir d'images — voir **[App_GKE](App_GKE.md)**. La configuration d'application
spécifique à Karakeep partagée avec la variante Cloud Run est décrite dans
**[Karakeep_Common](Karakeep_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Karakeep sur GKE Autopilot](../labs/Karakeep_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Karakeep sur Google Cloud Run](Karakeep_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Karakeep Common — Configuration d'application partagée](Karakeep_Common.md) — la configuration partagée par les deux cibles de déploiement.
