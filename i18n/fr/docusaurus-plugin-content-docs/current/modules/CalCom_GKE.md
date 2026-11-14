---
title: "Cal.com sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Cal.com sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/CalCom_GKE.md @ 40c83c3f sha256:cdf93e4d3b71 -->

# Cal.com sur GKE Autopilot {#calcom-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/CalCom_GKE.png" alt="Cal.com sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Cal.com est une plateforme de planification open source sous licence AGPL —
l'alternative auto-hébergée à Calendly — construite avec **Next.js** et
**Prisma** sur PostgreSQL. Ce module déploie Cal.com sur **GKE Autopilot**
par-dessus le socle [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure partagée Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Cal.com et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toute application GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — veuillez vous référer au [guide du socle App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## Ce que coûte Cal.com sur RAD, et comparaison {#what-calcom-costs-on-rad-and-how-that-compares}

**Le module GKE Autopilot de Cal.com sur RAD coûte environ 143 US$ par mois
dans votre propre projet Google Cloud, sans frais de licence supplémentaires**
— Cal.com est open source. Dans un projet géré par RAD pour vous, le même
déploiement est facturé **138 crédits par jour** (environ 4 140 par mois,
environ 414 US$ au prix de la recharge). Ou consultez le [guide Cloud
Run](CalCom_CloudRun.md) pour l'option moins chère. Si vous n'avez besoin de
Cal.com qu'occasionnellement — pour des études, une démo, un projet de courte
durée — un projet géré par RAD peut être supprimé et restauré dans les 30
jours sans frais supplémentaires, de sorte que ce chiffre mensuel devient
quelques dollars. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

Cal.com est open source, il n'y a donc pas de frais de licence. Vous payez
pour trois choses :

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 110 crédits (11 US$ au prix de la recharge) | 99 crédits (10 % de moins) |
| Builds | Inclus dans le prix : pas de frais de build pour la création, 5 mises à jour par mois (mois calendaire UTC) gratuites puis 2 crédits chacune, et rien pour la suppression ou pour un build échoué. Les sessions de lab et les projets clients sont l'exception : ils sont toujours facturés à la minute pour le temps de build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **143 US$ par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **138 crédits par jour**, environ 4 140 par mois (environ 414 US$ au prix de la recharge ; estimé à partir des prix catalogue Google, et incluant les frais de cluster) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

**Pourquoi les deux colonnes diffèrent.** Le chiffre géré par RAD inclut les
frais de gestion du cluster GKE (environ 73 US$ par mois) et le socle partagé
du projet. Dans votre propre projet, le niveau gratuit de Google couvre les
frais de gestion d'un cluster par compte de facturation, ce que le chiffre du
projet propre suppose. Il est estimé à partir des prix catalogue de Google,
car il n'y a pas encore assez d'historique GKE géré par RAD pour le mesurer,
donc la confirmation de déploiement ne le cite pas. Une deuxième application
GKE dans le même projet géré par RAD partage le cluster et n'ajoute que ses
propres pods.

Votre premier déploiement réussi sur RAD est exempt de frais de module, quel
que soit le montant : une fois par compte, pour un module que vous déployez et
payez vous-même (dans une solution, les frais d'une application : la première
à réussir ; jamais une session de lab ou un projet client).

10 crédits coûtent 1 US$ pour une recharge ponctuelle, et moins pour un plan
mensuel. Dans un projet géré par RAD, la base de données, le serveur de
fichiers et le réseau sont partagés par toutes les applications du projet,
donc une deuxième application n'ajoute pas de deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix
catalogue Google) :

| Ressource (valeur par défaut du module) | Par mois |
|---|---|
| Pod GKE Autopilot, 2x vCPU / 2 Gio | 72,16 US$ |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 US$ |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 US$ |
| Cloud NAT et réseau | 5 US$ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 US$ |
| Frais de gestion du cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 |
| **Total (hors frais de cluster GKE partagé)** | **environ 143 US$** |

Les prix des pods Cloud SQL et Cloud Run/GKE sont les mêmes en africa-south1
(Johannesburg) ; la petite VM coûte environ 10 % de plus là-bas.

- **GKE Autopilot ne se met pas à l'échelle à zéro.** Au moins un pod
  s'exécute toujours, donc le coût ci-dessus s'applique que quelqu'un utilise
  l'application ou non ; des pods supplémentaires ne sont ajoutés que sous
  charge.

### Comparaison pour une équipe de dix personnes {#how-it-compares-for-a-team-of-ten}

Cal.com, le projet que ce module déploie, vend ses propres plans hébergés par
utilisateur :

| Option | Par mois (10 utilisateurs) | Notes |
|---|---|---|
| Cal.com Teams | 120 US$ (12 US$/utilisateur) | Hébergé par Cal.com |
| Cal.com Organizations | 280 US$ (28 US$/utilisateur) | Hébergé par Cal.com, ajoute l'administration à l'échelle de l'organisation |
| **RAD, Cloud Run, votre propre projet** | **Environ 84 US$**, plus 7,50 US$ une fois par déploiement | L'automatisation de RAD, dans votre projet |
| **RAD, Cloud Run, un projet géré par RAD** | **Environ 960 crédits (96 US$)** | RAD |

- **Le prix hébergé de Cal.com augmente avec chaque siège ; le coût de RAD est
  l'infrastructure**, qu'une équipe croissante n'atteint que lorsqu'elle a
  besoin de plus de capacité. Avec dix utilisateurs, le coût d'exécution du
  projet propre de RAD est déjà inférieur à un seul mois du plan Teams.
- **Un serveur bon marché est bon marché jusqu'à ce que quelque chose tombe en
  panne.** Sur RAD, la base de données est Cloud SQL avec des sauvegardes
  automatisées, et les secrets vivent dans Secret Manager. Sur votre propre
  serveur, c'est un travail que quelqu'un doit faire.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Cal.com s'exécute dans **un projet géré par RAD pour vous**, la suppression
de l'ensemble du projet — plutôt que la suppression de ce seul module —
délie d'abord sa facturation, puis demande à Google de supprimer le projet
purement et simplement. Google le conserve, récupérable, pendant 30 jours, et
comme la facturation est déjà déliée, rien n'est facturé pendant qu'il
attend. Contrairement à la suppression d'un module, cela ne détruit pas Cloud
SQL, aucune VM ou la ressource de calcul une par une : l'ensemble du projet
s'arrête simplement.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.**
> Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ou
> les ressources qu'il contient, seront utilisables après sa restauration, de
> sorte que la restauration ne peut pas être invoquée comme moyen de récupérer
> un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des
> sauvegardes appropriées des données et de la configuration de l'application
> et de les avoir stockées en dehors du projet. Si une restauration échoue, ou
> si le projet restauré ne fonctionne pas, la solution de repli consiste à
> redéployer l'application (voir la section suivante) et à restaurer sa
> configuration et ses données à partir de ces sauvegardes.

- **La restauration est une vérification, pas une reconstruction.** Dans les
  30 jours, le propriétaire du projet peut demander à Google de récupérer le
  projet et de rattacher son compte de facturation, puis d'exécuter **Mettre
  à jour** sur chaque déploiement pour confirmer que tout est revenu. Comme
  rien n'a été détruit individuellement, cette mise à jour trouve les mêmes
  ressources déjà présentes, et une mise à jour ne facture jamais les frais
  de module à nouveau. Les mises à jour sont incluses dans le prix (5 par
  mois pour chaque déploiement), donc une restauration ne coûte normalement
  aucun crédit.
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet dont
  RAD gère uniquement la facturation), le restaurer vous-même dans les 30
  jours — après quoi Google le supprime définitivement — et effacer à nouveau
  le seuil d'admission du palier (100 crédits pour le palier sandbox qui
  convient à la plupart des utilisations d'étude/démo). Google indique que la
  plupart des services fonctionnent à nouveau pleinement dans les 36 heures
  suivant une restauration.
- **Un véritable manque : les sauvegardes nocturnes ne survivent pas.** Les
  sauvegardes sont écrites dans un bucket à l'intérieur du projet, et ce
  bucket a la suppression logicielle de Cloud Storage désactivée, il est donc
  très probable qu'il disparaisse dès que le projet est supprimé — même si le
  projet lui-même est récupérable pendant 30 jours. Copiez une sauvegarde
  (vers Google Drive, ou un bucket en dehors du projet) avant de supprimer si
  elle contient quelque chose qui vaut la peine d'être conservé ; pour une
  installation par défaut sans rien d'irremplaçable, cela n'a pas
  d'importance.

Source : [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects).

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que la fenêtre de restauration de 30
jours ci-dessus est passée, la façon d'arrêter de payer est de supprimer le
déploiement et de le redéployer lorsque vous en avez besoin.

- **Ce que coûte un redéploiement.** Les frais de module à nouveau (les builds
  sont inclus) : 110 crédits (11,00 US$) au prix de la recharge. La
  suppression ne permet d'économiser de l'argent que si Cal.com resterait
  inutilisé pendant environ **2 jours ou plus** — dans votre propre projet,
  cela représente environ 4,75 US$ par jour, et dans un projet géré par RAD,
  c'est 138 crédits par jour.
- La majeure partie du coût d'exécution ici est généralement la base de
  données et/ou la VM ou le cluster de fichiers/cache partagé. Ils ne
  s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc la
  suppression de Cal.com alors qu'une autre application partage le projet ne
  sauve que la partie calcul propre à Cal.com.
- **Conservez les données en premier.** Les sauvegardes nocturnes vont dans un
  bucket à l'intérieur du déploiement et sont supprimées avec lui, donc
  copiez la dernière sauvegarde avant de supprimer si vous voulez la
  conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour
  une classe. Chaque participant obtient l'application dans son propre projet
  Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une
  autorisation définie par le formateur. Soit le formateur finance toutes les
  places, soit chaque participant paie la sienne. Tout est supprimé à la fin
  de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire
  exécute l'application pour un client à partir d'un portefeuille cloisonné
  qu'il finance, et règle directement avec le client. Si le portefeuille est
  faible, la facturation est mise en pause et les données sont conservées,
  afin que personne ne reçoive de frais inattendus. À la fin, le partenaire
  remet le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF,
NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud
Billing Catalog ; frais RAD et estimation des crédits quotidiens de
[radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et
restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour la fenêtre de pause/restauration et la mise en garde sur le bucket de
sauvegarde ; [Tarifs Cal.com](https://cal.com/pricing) ; les prix changent,
vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Cal.com s'exécute comme une charge de travail web Next.js. Le déploiement
connecte un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods Next.js, 2 vCPU / 2 Gio par défaut, mise à l'échelle horizontale automatique |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — Cal.com (Prisma/`pg`) cible uniquement PostgreSQL |
| Stockage d'objets | Cloud Storage (aucun par défaut) | Cal.com stocke tout l'état dans PostgreSQL ; aucun bucket de téléchargement n'est créé |
| Cache | Redis (facultatif) | Désactivé par défaut ; utilisé pour la mise en cache / la limitation de débit |
| Secrets | Secret Manager | `NEXTAUTH_SECRET` et `CALENDSO_ENCRYPTION_KEY` auto-générés ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing | Service LoadBalancer externe, domaine personnalisé facultatif + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par
  la couche d'application partagée ; le schéma Prisma de Cal.com cible
  uniquement PostgreSQL.
- **`NEXTAUTH_SECRET` et `CALENDSO_ENCRYPTION_KEY` sont générés automatiquement** et
  stockés dans Secret Manager. Ne les faites jamais pivoter après le premier
  démarrage sans fenêtre de maintenance — la rotation de `CALENDSO_ENCRYPTION_KEY` rend
  toutes les informations d'identification de calendrier/OAuth stockées
  indéchiffrables, et la rotation de `NEXTAUTH_SECRET` invalide toutes les
  sessions.
- **L'URL publique est validée au démarrage.** `NEXT_PUBLIC_WEBAPP_URL` / `NEXTAUTH_URL`
  par défaut l'URL du service de cluster (définie à partir de `GKE_SERVICE_URL` à
  l'exécution) ; définissez `webapp_url` sur l'adresse du LoadBalancer externe
  ou le domaine personnalisé une fois connu, sinon les liens de réservation/OAuth
  seront incorrects.
- **Le schéma est créé au démarrage, pas par un job de migration.** Le job
  `db-init` ne provisionne que la base de données et le rôle vides ;
  Cal.com exécute `prisma migrate deploy` à chaque démarrage. Prévoyez plusieurs
  minutes pour le premier démarrage.
- **Le seuil de mémoire est de 2 Gio.** Cal.com (Next.js 16) plante par manque
  de mémoire au démarrage en dessous de 2 Gio.
- **L'affinité de session est `ClientIP` par défaut**, gardant les
  requêtes d'un client sur le même pod pour un comportement cohérent de
  l'interface utilisateur/session.
- **Le sidecar Cloud SQL Auth Proxy est utilisé par défaut** (`enable_cloudsql_volume = true`),
  donnant à Cal.com un point de terminaison PostgreSQL de bouclage `127.0.0.1`
  avec du texte brut (le proxy termine mTLS).
- **Redis est désactivé par défaut.** Activez-le uniquement pour le cache / la
  limitation de débit.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les
autres identifiants sont signalés dans les [Sorties](#5-outputs) du
déploiement.

### A. GKE Autopilot — la charge de travail Cal.com {#a-gke-autopilot--the-calcom-workload}

Les pods Cal.com sont planifiés sur Autopilot, qui facture le CPU/la mémoire
réellement demandés par les pods. L'autoscaling horizontal des pods dimensionne
le déploiement entre le nombre minimal et maximal de réplicas.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge
  de travail Cal.com pour voir les pods, les révisions et les événements.
  Kubernetes Engine → Services et Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle
et du type de charge de travail (Deployment vs StatefulSet).

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Cal.com stocke toutes les données de l'application (utilisateurs, types
d'événements, réservations, informations d'identification de calendrier
connecté) dans une instance gérée de Cloud SQL pour PostgreSQL 15. Les pods y
accèdent en privé via le sidecar **Cloud SQL Auth Proxy** sur `127.0.0.1` ;
aucune IP publique n'est exposée. Lors du premier déploiement, un job
d'initialisation crée la base de données et le rôle de l'application, et
Cal.com applique son schéma via Prisma au démarrage.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les indicateurs et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret
Secret Manager contenant le mot de passe sont tous affichés dans les
[Sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes
automatisées et la rotation des mots de passe, voir [App_GKE](App_GKE.md).

### C. Cloud Storage {#c-cloud-storage}

Cal.com conserve tout l'état dans PostgreSQL, donc **aucun bucket de données
n'est créé par défaut** (`storage_buckets` est vide). Des buckets
supplémentaires peuvent toujours être déclarés via `storage_buckets` si
nécessaire pour des intégrations personnalisées.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### D. Redis (cache facultatif) {#d-redis-optional-cache}

Redis est **désactivé par défaut** (`enable_redis = false`). Lorsqu'il est activé,
Cal.com l'utilise comme backend de cache / de limitation de débit. Lorsque
`redis_host` est laissé vide et `enable_nfs` est vrai, l'IP de la VM du
serveur NFS est utilisée comme point de terminaison Redis.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  # Confirm env injected into the running pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -i redis
  ```

### E. Secret Manager {#e-secret-manager}

Deux secrets cryptographiques sont générés automatiquement et stockés dans
Secret Manager : `NEXTAUTH_SECRET` (signe les jetons de session NextAuth.js) et
`CALENDSO_ENCRYPTION_KEY` (chiffre les informations d'identification de calendrier/OAuth
stockées). Le mot de passe de la base de données est géré séparément par le
socle.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données se trouve dans les
[Sorties](#5-outputs). Voir [App_GKE](App_GKE.md) pour l'intégration et la
rotation de Secret Store CSI.

### F. Réseau et ingress {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe Cloud Load
Balancing (`service_type = LoadBalancer`). Un domaine personnalisé avec un certificat géré
par Google peut être activé (`enable_custom_domain = true` par défaut), et une IP
statique est réservée afin que l'adresse survive aux redéploiements. Définissez
`webapp_url` sur l'URL externe résultante afin que les liens de
réservation/OAuth générés par Cal.com soient corrects.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses
  IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails des IP statiques.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les
métriques GKE et Cloud SQL sont acheminées vers Cloud Monitoring. Des tests de
disponibilité et des stratégies d'alerte facultatifs sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Cal.com {#3-calcom-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation exécute `db-init.sh` en utilisant `postgres:15-alpine`. Il se
  connecte via le Cloud SQL Auth Proxy et crée de manière idempotente le rôle
  et la base de données de l'application et accorde des privilèges sur le
  schéma `public`. Il ne crée **pas** le schéma de l'application —
  c'est le travail de Cal.com.
- **Migrations de schéma au démarrage.** Le script de démarrage de l'image
  exécute `prisma migrate deploy` à chaque démarrage, créant le schéma au premier
  démarrage et appliquant de nouvelles migrations lors des mises à niveau de
  version — pas d'étape de migration séparée. Prévoyez plusieurs minutes pour
  le premier démarrage avant que le pod ne devienne Prêt.
- **`NEXTAUTH_SECRET` et `CALENDSO_ENCRYPTION_KEY` sont immuables après le premier
  démarrage.** Modifier `CALENDSO_ENCRYPTION_KEY` rend toutes les informations
  d'identification de calendrier/OAuth stockées indéchiffrables (chaque
  intégration doit être ré-autorisée) ; modifier `NEXTAUTH_SECRET` déconnecte
  tous les utilisateurs. Ne faites pivoter que pendant une fenêtre de
  maintenance planifiée.
- **L'URL publique nécessite l'IP externe.** `NEXT_PUBLIC_WEBAPP_URL` / `NEXTAUTH_URL`
  sont définis à partir de `GKE_SERVICE_URL` à l'exécution. Une fois l'IP du
  LoadBalancer (ou le domaine personnalisé) attribuée, définissez `webapp_url`
  sur cette adresse :
  ```bash
  kubectl get svc <service-name> -n "$NAMESPACE" -o jsonpath='{.status.loadBalancer.ingress[0].ip}'
  ```
  Ou définissez `environment_variables`/`webapp_url` dans la configuration du module
  avant le déploiement.
- **Configuration initiale.** Ouvrez l'URL externe et complétez l'intégration
  de Cal.com pour créer le compte administrateur/propriétaire initial, puis
  configurez au moins un calendrier connecté. Cal.com auto-hébergé permet
  l'inscription en libre-service par défaut — restreignez-la (ou placez le
  service derrière IAP) si l'instance ne doit pas être publique.
- **Chemin de santé.** La sonde de démarrage cible `/` (une
  redirection 307, que le kubelet accepte) ; la sonde de vivacité cible
  `/api/auth/providers`, qui renvoie un 200 littéral. La sonde de vivacité est
  mise en miroir dans la vérification de santé de la passerelle, qui
  nécessite un 200, donc la pointer vers `/` laisse la passerelle
  servir des 503. La fenêtre de démarrage généreuse (délai initial de 0
  seconde, jusqu'à une fenêtre de nouvelle tentative de 30×30s ≈ 15 minutes)
  s'adapte aux migrations Prisma du premier démarrage.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Cal.com sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec son comportement et ses valeurs par défaut
standards.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `calcom` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Cal.com` | Nom lisible par l'homme affiché dans la console. |
| `application_version` | `latest` | Tag d'image Cal.com (définit `CALCOM_VERSION`) ; épingler à une version spécifique en production. |
| `webapp_url` | `""` | URL publique pour `NEXT_PUBLIC_WEBAPP_URL`/`NEXTAUTH_URL`. Vide → l'URL du cluster d'exécution ; définir sur l'adresse du LoadBalancer/domaine personnalisé une fois connue. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `container_port` | `3000` | Port sur lequel Cal.com écoute. |
| `cpu_limit` | `2000m` | CPU par pod. |
| `memory_limit` | `2Gi` | **Minimum 2 Gio** — Next.js 16 plante par manque de mémoire en dessous. |
| `min_instance_count` | `0` | Réplicas minimum. |
| `max_instance_count` | `3` | Réplicas maximum. |
| `enable_cloudsql_volume` | `true` | Sidecar Auth Proxy pour les connexions socket/loopback. Garder `true` pour la connectivité PostgreSQL. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Cal.com dans Artifact Registry avant le déploiement. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires. Ne pas définir `NEXTAUTH_SECRET`, `CALENDSO_ENCRYPTION_KEY` ou `DATABASE_URL` ici — ils sont gérés automatiquement. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager (par exemple, informations d'identification SMTP ou d'application OAuth). |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service Kubernetes est exposé. |
| `workload_type` | `Deployment` | `Deployment` (sans état) ou `StatefulSet`. Cal.com est sans état — garder `Deployment`. |
| `session_affinity` | `ClientIP` | Routage persistant afin que les requêtes d'un client atteignent le même pod. |
| `termination_grace_period_seconds` | `30` | Secondes à attendre après SIGTERM avant SIGKILL. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `false` | Activer les modèles PVC. Non nécessaire — Cal.com stocke tout l'état dans PostgreSQL. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume partagé facultatif ; héberge également Redis colocalisé lorsqu'il est activé. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Activer Redis comme backend de cache / de limitation de débit. |
| `redis_host` | `""` | Point de terminaison Redis. Laisser vide pour utiliser l'IP du serveur NFS (nécessite `enable_nfs = true`). |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `db_name` | `calcom` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `calcom` | Utilisateur de la base de données de l'application. Immuable après le premier déploiement. |
| `database_type` | `POSTGRES_15` | Fixé à PostgreSQL 15 ; les autres moteurs ne sont pas pris en charge. |
| `database_password_length` | `32` | Longueur du mot de passe généré. |
| `enable_postgres_extensions` | `true` | **Valeur par défaut GKE uniquement** — remplace la propre valeur par défaut désactivée de `CalCom_Common`. Déclenche le job Kubernetes privilégié `App_GKE` de `<service>-db-extensions`. |
| `postgres_extensions` | `["vector", "uuid-ossp"]` | Extensions que le job `db-extensions` pré-crée. `vector` (pgvector) est requis par le schéma Prisma de Cal.com ; sans cela, le propre `CREATE EXTENSION IF NOT EXISTS` non privilégié de l'application échoue avec une erreur de permission refusée. `CalCom_CloudRun` ne transmet pas du tout ces deux variables. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner Ingress pour les noms d'hôtes personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôtes à servir. |
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 20 — Proxy d'identité (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google devant Cal.com. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque IAP est activé (sensible). |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 22 — Contrôles de service VPC et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

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
| `stage_service_cluster_ips` | Mappage des ClusterIP pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Cal.com. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via le proxy d'authentification) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (vides par défaut). |
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

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration au moteur de socle [App_GKE](App_GKE.md), qui valide les
> valeurs *et les combinaisons* au moment de la planification — `min_instance_count > max_instance_count`,
> IAP sans client OAuth, Redis activé sans `redis_host` ni NFS, `enable_cloudsql_volume`
> avec `database_type = NONE`, et les valeurs ResourceQuota en unités binaires. Une
> configuration invalide fait échouer le **plan** avec une erreur claire et
> nommée avant la création de toute ressource, de sorte que la plupart des
> erreurs ci-dessous sont détectées en amont plutôt qu'à l'application ou à
> l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `CALENDSO_ENCRYPTION_KEY` (auto-généré) | Ne jamais faire pivoter après le premier démarrage | Critique | Le faire pivoter rend toutes les informations d'identification de calendrier/OAuth stockées indéchiffrables — chaque intégration doit être ré-autorisée. |
| `NEXTAUTH_SECRET` (auto-généré) | Ne faire pivoter que dans une fenêtre de maintenance | Critique | Le faire pivoter invalide toutes les sessions utilisateur actives, forçant une reconnexion immédiate. |
| `db_name` / `db_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `database_type` | `POSTGRES_15` | Critique | Le schéma Prisma de Cal.com cible uniquement PostgreSQL ; tout autre moteur interrompt le démarrage. |
| `webapp_url` | URL du LoadBalancer externe / du domaine | Critique | Une URL incorrecte ou non définie est intégrée à chaque lien de réservation/OAuth ; la valeur par défaut `localhost:3000` de l'image fait que le serveur refuse de démarrer. |
| `enable_redis` + `redis_host`/`enable_nfs` | paire cohérente | Élevé | Redis activé sans hôte et sans NFS échoue à une précondition au moment de la planification — `REDIS_URL` serait vide et Cal.com ne pourrait pas se connecter. |
| `memory_limit` | `2Gi` | Élevé | En dessous de 2 Gio, Next.js 16 plante par manque de mémoire au démarrage et le pod ne devient jamais Prêt. |
| `session_affinity` | `ClientIP` | Élevé | Sans persistance, les requêtes d'un client sautent entre les pods, perturbant les sessions d'interface utilisateur. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy fournit le point de terminaison de bouclage PostgreSQL ; le désactiver avec une vraie base de données est bloqué par une garde au moment de la planification. |
| `enable_postgres_extensions` / `postgres_extensions` | `true` / `["vector", "uuid-ossp"]` | Élevé | GKE les active par défaut (contrairement à la propre valeur par défaut désactivée de `CalCom_Common` et contrairement à `CalCom_CloudRun`, qui ne les transmet pas du tout) de sorte que le job privilégié `db-extensions` pré-crée `vector` — sans cela, le propre `CREATE EXTENSION IF NOT EXISTS` non privilégié de Cal.com rencontre une erreur de permission refusée sur Cloud SQL. |
| `enable_iap` | uniquement pour les instances privées | Élevé | IAP bloque toutes les requêtes non authentifiées — y compris les intégrations et les pages de réservation publiques. |
| Inscription ouverte | désactiver pour les instances privées | Élevé | Cal.com auto-hébergé permet l'inscription en libre-service ; le laisser ouvert permet à quiconque ayant l'URL de créer un compte. |
| `min_instance_count` ≤ `max_instance_count` | garder ordonné | Moyen | Une plage HPA conflictuelle échoue à une précondition au moment de la planification. |
| Synchronisation `startup_probe` | conserver la valeur par défaut généreuse | Moyen | Une fenêtre trop courte fait échouer la sonde pendant les migrations Prisma du premier démarrage, bloquant le déploiement. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement du socle référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Cal.com
partagée avec la variante Cloud Run est décrite dans
**[CalCom_Common](CalCom_Common.md)**.

<!-- related-guides -->

## Guides connexes {#related-guides}

- [Lab pratique : Cal.com sur GKE Autopilot](../labs/CalCom_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Cal.com sur Google Cloud Run](CalCom_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [CalCom Common — Configuration d'application partagée](CalCom_Common.md) — la configuration partagée par les deux cibles de déploiement.
