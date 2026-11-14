---
title: "Logto sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Logto sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Logto_GKE.md @ 40c83c3f sha256:1300fcacfd69 -->

# Logto sur GKE Autopilot {#logto-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Logto_GKE.png" alt="Logto sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Logto est un fournisseur d'identité open source sous licence MPL-2.0 — une
alternative à Auth0 qui prend en charge OIDC et OAuth 2.0 et qui est livré avec
des flux de connexion, des connecteurs sociaux/d'entreprise, le multi-tenancy et
une console d'administration. Ce module déploie Logto sur **GKE Autopilot**
par-dessus la fondation [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Logto et sur la façon
de les explorer et de les opérer depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications GKE — Workload
Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, sauvegardes et cycle de vie du déploiement —
référez-vous au [guide de la fondation App_GKE](App_GKE.md) plutôt que de les
répéter ici.

---

## Ce que coûte Logto sur RAD, et comment cela se compare {#what-logto-costs-on-rad-and-how-that-compares}

**Le module Logto sur GKE Autopilot de RAD coûte environ 150 $ US par mois dans
votre propre projet, sans frais par utilisateur ou par MAU.** RAD facture 175
crédits une fois par déploiement dans votre propre projet (157,5 crédits, soit
10 % de moins, dans un projet géré par RAD). Les builds sont inclus dans le
prix. La même application se déploie également sur Cloud Run pour environ 110 $
US par mois — voir le [guide Cloud Run](Logto_CloudRun.md) pour l'option la
moins chère. Si vous n'en avez besoin qu'occasionnellement, un projet géré par
RAD peut être supprimé et restauré dans les 30 jours sans frais
supplémentaires, de sorte que ce chiffre mensuel devient quelques dollars
seulement — voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 175 crédits (17,50 $ US au prix de la recharge) | 157,5 crédits (10 % de moins) |
| Builds | Inclus dans le prix : pas de frais de build pour la création, 5 mises à jour par mois (mois calendaire UTC) gratuites puis 2 crédits chacune, et rien pour la suppression ou pour un build échoué. Les sessions de lab et les projets clients sont l'exception : ils sont toujours facturés à la minute pour le temps de build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **150 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **141 crédits par jour**, soit environ 4 230 par mois (environ 423 $ US au prix de la recharge ; estimé à partir des prix catalogue de Google, et incluant les frais de cluster) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge ponctuelle, et moins sur un plan
mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers
et le réseau sont partagés par chaque application du projet, de sorte qu'une
deuxième application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix
catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Pod GKE Autopilot, 2x vCPU / 4 Gio | 79 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ US si c'est votre seul cluster, sinon ~73 $ US |
| **Total** | **environ 150 $ US** |

### Comment cela se compare {#how-it-compares}

- **Auth0** (B2C) commence à **35 $ US par mois** sur son plan Essentials pour
  jusqu'à 500 utilisateurs actifs mensuels, puis évolue avec les MAU ; son plan
  B2B Essentials commence à **150 $ US par mois**. Un niveau gratuit couvre
  jusqu'à 25 000 MAU mais supprime la plupart des fonctionnalités
  d'entreprise.
- Le module Logto de RAD coûte environ 150 $ US par mois dans votre propre
  projet — plus que le niveau d'entrée d'Auth0 pour un très faible nombre
  d'utilisateurs, mais il n'a **pas de facturation basée sur les MAU ni de
  niveau de prix par locataire à dépasser**, et vous détenez vous-même la base
  de données des utilisateurs et les clés de signature plutôt que de confier
  chaque connexion à un tiers.
- Comparaison autogérée : l'empreinte de 2 vCPU / 4 Gio de Logto est proche d'un
  Compute Engine e2-standard-2 de GCP (~49 $ US/mois) ou d'une machine Hetzner/DigitalOcean
  plus grande, et vous auriez toujours besoin d'exécuter et de patcher
  PostgreSQL et la couche NFS/cache dont il dépend vous-même.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Logto s'exécute dans **un projet géré par RAD pour vous**, vous avez une
deuxième option qui va bien au-delà de la mise à l'échelle à zéro : **supprimez
tout le projet et restaurez-le dans les 30 jours pour presque rien.** Cela
convient bien mieux à Logto dont vous n'avez besoin qu'occasionnellement — pour
l'évaluer, un environnement de démonstration, une charge de travail saisonnière
ou intermittente — que de le faire fonctionner en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.**
> Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ou
> les ressources qu'il contient, seront utilisables après sa restauration, de
> sorte que la restauration ne peut pas être considérée comme un moyen de
> récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir
> effectué des sauvegardes appropriées des données et de la configuration de
> l'application et de les avoir stockées en dehors du projet. Si une
> restauration échoue, ou si le projet restauré ne fonctionne pas, la solution
> de repli consiste à redéployer l'application (voir la section suivante) et à
> restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord
  sa facturation, puis demande à Google de supprimer le projet. Google ne
  supprime pas le projet immédiatement : il le conserve, récupérable, pendant
  30 jours. Comme la facturation est déjà déliée, rien n'est facturé pendant
  cette attente. Contrairement à la suppression d'un module, cela ne détruit
  pas la base de données, aucune VM ou la ressource de calcul une par une —
  tout le projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration est une vérification, pas une reconstruction.** Dans les 30
  jours, le propriétaire du projet peut le restaurer. RAD demande à Google de
  réactiver le projet et de rattacher son compte de facturation, puis vous
  demande d'exécuter **Mettre à jour** sur chaque déploiement pour confirmer
  que tout est revenu. Comme rien n'a été détruit individuellement, cette mise
  à jour trouve les mêmes ressources déjà présentes — c'est une vérification,
  pas une reconstruction, et une mise à jour ne facture jamais les frais de
  module à nouveau. Les mises à jour sont incluses dans le prix (5 par mois
  pour chaque déploiement), donc une restauration ne coûte normalement aucun
  crédit.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, et
  non les 423 $ US par mois pour le maintenir en fonctionnement.** Déployez
  Logto, utilisez-le un certain temps, supprimez le projet. Restaurez-le la
  prochaine fois que vous en avez besoin, confirmez avec Mettre à jour, et
  supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez les frais de
  module qu'une seule fois et pour le temps où il était réellement actif.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un
  projet dont RAD gère uniquement la facturation), et vous le restaurez
  vous-même dans les 30 jours — après cela, Google le supprime définitivement.
  La restauration est admise comme la création d'un nouveau projet : votre
  solde de crédits achetés doit toujours dépasser le seuil du niveau (100
  crédits pour le niveau sandbox que la plupart des utilisations d'évaluation
  correspondent). Google indique que la plupart des services sont de nouveau
  pleinement fonctionnels dans les 36 heures suivant une restauration.
- **Un véritable manque : les sauvegardes nocturnes ne survivent pas.** Les
  sauvegardes et autres fichiers générés sont écrits dans un bucket à
  l'intérieur du projet, et ce bucket n'est **pas** protégé par la suppression
  logicielle de Cloud Storage, il est donc très probable qu'il disparaisse dès
  que vous supprimez le projet — même si le projet lui-même est récupérable
  pendant 30 jours. Si vous avez personnalisé Logto et que vous souhaitez
  conserver ce travail, copiez une sauvegarde (vers Google Drive ou un bucket
  en dehors du projet) avant de supprimer. Pour une installation par défaut
  sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre
propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de
payer est de supprimer le déploiement et de le déployer à nouveau lorsque vous
en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau (les builds
  sont inclus) — 175 crédits (17,50 $ US) au total. La suppression ne permet
  d'économiser de l'argent que si Logto reste inutilisé assez longtemps pour
  compenser ce coût de redéploiement par rapport à son propre coût
  d'exécution — environ **4 jours ou plus**, à la fois dans votre propre
  projet (environ 4,99 $ US par jour) et dans un projet géré par RAD (141
  crédits par jour).
- **La majeure partie du coût d'exécution est généralement partagée.** Pour
  Logto, il s'agit de la base de données et de la VM de fichier/cache partagée.
  Elles ne s'arrêtent que si rien d'autre dans le projet ne les utilise, donc
  la suppression de cette application alors que quelque chose d'autre partage
  le projet n'économise que la partie calcul de cette application.
- **Conservez vos données en premier.** Les sauvegardes nocturnes vont dans un
  bucket à l'intérieur du déploiement et sont supprimées avec lui, donc copiez
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
  personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le
  projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF,
NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud
Billing Catalog ; frais RAD et estimation des crédits quotidiens de
[radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et
restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour les mécanismes de pause/restauration et ce qu'il dit sur les objets Cloud
Storage sans suppression logicielle ; [Auth0](https://auth0.com/pricing). Les
prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Logto s'exécute comme une charge de travail web Node.js. Le déploiement relie
un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods Node.js, 2 vCPU / 4 Gio par défaut, mise à l'échelle horizontale automatique |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — Logto ne prend pas en charge MySQL ou d'autres moteurs |
| Stockage d'objets | Cloud Storage | Un bucket provisionné automatiquement ; facultatif pour Logto (tout l'état principal est dans Postgres) |
| Secrets | Secret Manager | Seulement le mot de passe de la base de données — Logto n'a **pas** de secret d'application externe (les clés OIDC sont amorcées par la base de données) |
| Ingress | Cloud Load Balancing | LoadBalancer externe ; domaine personnalisé facultatif + certificat géré (hôte nip.io par défaut) |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par
  la couche d'application partagée ; une garde au moment de la planification
  rejette tout ce qui n'est pas PostgreSQL `database_type`.
- **Le cœur de Logto est publié sur le port 3001 ; la console d'administration
  (3002) ne l'est pas.** Un seul service GKE publie un port, donc seul le point
  de terminaison de l'API/OIDC principal (3001) est accessible. La console
  d'administration — où le premier compte administrateur et les applications
  sont enregistrés — s'exécute sur 3002 et nécessite une route séparée (par
  exemple `kubectl port-forward`) pour la configuration initiale (voir §3).
- **Il n'y a pas de secret d'application à protéger.** Logto génère ses clés de
  signature OIDC au premier démarrage et les stocke **dans la base de
  données**. Rien dans Secret Manager n'a besoin d'être protégé ou renouvelé,
  sauf le mot de passe de la base de données géré par la fondation. Protéger
  les clés de Logto signifie protéger Cloud SQL.
- **Cloud SQL via la boucle de rappel du proxy d'authentification.** Sur GKE,
  le sidecar du proxy d'authentification écoute sur `127.0.0.1` ; le point d'entrée
  de Logto se connecte via une boucle de rappel TCP simple avec SSL désactivé
  (le proxy termine TLS vers Cloud SQL).
- **L'affinité de session est `ClientIP` par défaut** afin qu'un client atteigne
  toujours le même pod.
- **`service_type = LoadBalancer` avec une IP statique et un domaine personnalisé nip.io par
  défaut** (`reserve_static_ip = true`, `enable_custom_domain = true`), donnant à Logto un hôte HTTPS stable
  accessible de l'extérieur dès le départ.
- **Pas de Redis.** Logto est basé sur Postgres ; `enable_redis` est par défaut
  `false`.
- **`ENDPOINT` est dérivé de l'URL du service.** Le point d'entrée définit
  l'émetteur OIDC de Logto et les URL absolues à partir de `GKE_SERVICE_URL` injecté ;
  mettez à jour `ENDPOINT` vers l'URL externe du LoadBalancer / domaine
  personnalisé une fois qu'elle est connue.
- **Un minimum de 1 réplica est maintenu** (GKE ne prend pas en charge la mise
  à l'échelle à zéro) pour que le point de terminaison d'identité soit toujours
  accessible.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté `gcloud container clusters get-credentials <cluster> --region <region> --project <project>` et que `PROJECT`,
`REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Logto {#a-gke-autopilot--the-logto-workload}

Les pods Logto sont planifiés sur Autopilot, qui facture le CPU/la mémoire que
les pods demandent réellement. L'autoscaling horizontal des pods dimensionne le
déploiement entre les nombres minimum et maximum de réplicas. Le conteneur et
le service publient le port **3001** (cœur de Logto).

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge
  de travail Logto pour voir les pods, les révisions et les événements.
  Kubernetes Engine → Services et Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E 'DB_HOST|DB_IP|ENDPOINT'
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle
et du type de charge de travail (Deployment vs StatefulSet).

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Logto stocke tout — utilisateurs, applications, connecteurs, clés de signature
OIDC et rôles par locataire — dans une instance gérée de Cloud SQL pour
PostgreSQL 15. Les pods l'atteignent via le sidecar **Cloud SQL Auth Proxy** sur
`127.0.0.1` ; le point d'entrée se connecte via une boucle de rappel TCP simple (le
proxy termine TLS). Lors du premier déploiement, un job d'initialisation crée la
base de données et le rôle de l'application (avec `CREATEROLE`, requis pour les rôles
RLS par locataire de Logto).

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les indicateurs et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données (`logto`), l'utilisateur (`logto`) et le
secret Secret Manager contenant le mot de passe sont tous affichés dans les
[Sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes
automatisées et la rotation des mots de passe, voir [App_GKE](App_GKE.md).

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** est provisionné automatiquement et le compte de
service de la charge de travail se voit accorder l'accès. Logto conserve tout
l'état principal dans PostgreSQL, de sorte que ce bucket est disponible pour
des actifs facultatifs plutôt que pour un stockage d'exécution requis.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<bucket-name>/          # bucket name is in the Outputs
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### D. Secret Manager {#d-secret-manager}

Logto n'a **pas de secret d'application externe** — ses clés de signature OIDC
sont générées et stockées dans la base de données au premier démarrage. Le seul
secret en jeu est le **mot de passe de la base de données**, que la fondation
génère, gère et synchronise dans le pod via le pilote CSI Secret Store.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~logto"
  gcloud secrets versions access latest --secret=<database_password_secret> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation du Secret Store
CSI.

### E. Réseau et ingress {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe Cloud
Load Balancing avec une adresse statique réservée et un domaine personnalisé
basé sur nip.io + un certificat géré. L'émetteur OIDC de Logto et toutes les
URL de redirection absolues sont construits à partir de `ENDPOINT`, de sorte que
l'hôte externe, l'émetteur et les URI de redirection enregistrés doivent tous
concorde — mettez à jour `ENDPOINT` vers l'URL externe une fois que l'adresse IP /
le domaine du LoadBalancer est attribué.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses
  IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails de l'IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les
métriques GKE et Cloud SQL sont acheminées vers Cloud Monitoring. Le point
d'entrée imprime une ligne `[cloud-entrypoint]` rapportant le mode de connexion DB résolu et
`ENDPOINT` — utile pour diagnostiquer les problèmes de connexion ou d'URL
d'émetteur.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Logto {#3-logto-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation exécute `db-init.sh` en utilisant `postgres:15-alpine`. Il crée de manière
  idempotente le rôle de l'application **avec `CREATEDB CREATEROLE`** (requis pour les rôles
  RLS par locataire de Logto) et la base de données de l'application, accorde
  les privilèges, transfère la propriété du schéma `public` au rôle de
  l'application, puis signale au sidecar Auth Proxy de s'arrêter afin que le
  pod du job puisse se terminer. Le job peut être réexécuté en toute sécurité.
- **Schéma et clés OIDC amorcés au démarrage.** Au démarrage, Logto exécute
  `npm run cli db seed -- --swe` (`--swe` = amorcer-si-vide, idempotent) qui crée son schéma et génère
  les clés de signature privées OIDC **dans la base de données** — uniquement
  lorsque la base de données est vide. Ces clés ne sont pas stockées dans
  Secret Manager ; la base de données est leur seul dépositaire. L'effacement
  de la base de données régénère de nouvelles clés et invalide tous les jetons
  précédemment émis et les clients enregistrés.
- **Pas de secret d'application à renouveler.** Il n'y a pas de clé de
  chiffrement ou de secret JWT dans Secret Manager — seulement le mot de passe
  de la base de données géré par la fondation.
- **La console d'administration (3002) n'est pas publiée.** Le service expose
  uniquement le cœur (3001). Accédez à la console d'administration pour créer
  le premier administrateur et enregistrer les applications via un transfert de
  port :
  ```bash
  kubectl port-forward -n "$NAMESPACE" deploy/<service-name> 3002:3002
  # then open http://localhost:3002
  ```
  `ADMIN_ENDPOINT` est par défaut le même hôte que `ENDPOINT` pour la cohérence des URL.
- **`ENDPOINT` doit correspondre à l'hôte visible par le navigateur.** Logto
  construit son émetteur OIDC et ses URL de redirection à partir de `ENDPOINT` ; le
  point d'entrée le définit à partir de `GKE_SERVICE_URL`. Mettez-le à jour vers l'URL
  externe du LoadBalancer ou du domaine personnalisé via `environment_variables` une fois que
  l'adresse externe est connue.
- **Chemin de santé.** La sonde de démarrage cible `/api/status` ; les sondes de
  vivacité et de disponibilité ciblent `/oidc/.well-known/openid-configuration`. Le chemin de vivacité doit
  retourner un `200` littéral car App_GKE le reflète dans la vérification de
  santé de la passerelle, et `/api/status` retourne `204`, que l'équilibreur de
  charge traite comme malsain (la passerelle servirait 503). Le port du
  conteneur et les sondes doivent tous être `3001`. Vérifier :
  ```bash
  kubectl port-forward -n "$NAMESPACE" deploy/<service-name> 3001:3001 &
  curl -s http://localhost:3001/oidc/.well-known/openid-configuration
  ```
- **Inspecter l'exécution du job d'initialisation :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Logto sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec son comportement et ses valeurs par défaut
standards.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `logto` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag d'image Logto (`svhd/logto:<tag>`) ; épingler à une version spécifique (par exemple `1.33`) en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `min_instance_count` | `1` | Réplicas minimum ; GKE nécessite ≥ 1. Maintient le point de terminaison d'identité accessible. |
| `max_instance_count` | `5` | Réplicas maximum. |
| `container_resources` | `{cpu_limit="2000m", memory_limit="4Gi"}` | Limites et requêtes CPU/mémoire pour le conteneur Logto ; Logto nécessite au moins 2 Gio de mémoire. |
| `container_port` | `3001` | Le cœur de Logto écoute sur 3001 ; la console d'administration (3002) n'est pas publiée. Le port et les sondes doivent correspondre à 3001. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy (boucle de rappel TCP). |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service Kubernetes est exposé. |
| `workload_type` | `null` (→ Déploiement) | `Deployment` (sans état ; Logto conserve tout l'état dans Postgres) ou `StatefulSet`. |
| `session_affinity` | `ClientIP` | Routage persistant pour qu'un client reste sur un seul pod. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` (désactivé) | Non nécessaire — Logto stocke tout l'état dans PostgreSQL. L'activation sélectionne automatiquement `StatefulSet`. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/status`, large fenêtre de premier démarrage | Laisse le temps à l'étape d'amorçage. |
| `liveness_probe` | HTTP `/oidc/.well-known/openid-configuration` | Sonde de vivacité/disponibilité. Doit retourner un `200` littéral — il est reflété dans la vérification de santé de la passerelle, et `/api/status` retourne `204`. |
| `uptime_check_config` | désactivé — `/` | Vérification de disponibilité Cloud Monitoring facultative par rapport à l'hôte du LoadBalancer ; désactivée par défaut. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Provisionne un volume Filestore partagé. Non requis par Logto (il stocke tout l'état dans PostgreSQL) — peut être remplacé en toute sécurité par `false`. |

### Groupe 15 — Cache et file d'attente Redis {#group-15--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Logto utilise Postgres pour toute la persistance — laisser `false`. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_database_name` | `logto` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `application_database_user` | `logto` | Utilisateur de la base de données de l'application (octroyé `CREATEROLE`). Immuable après le premier déploiement. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner Ingress + certificat géré (hôte nip.io par défaut). |
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |
| `application_domains` | `[]` | Noms d'hôtes à servir ; définir `ENDPOINT` pour correspondre. |

### Groupe 20 — Proxy conscient de l'identité (IAP) {#group-20--identity-aware-proxy-iap}

> **Avertissement :** L'activation d'IAP nécessite une authentification d'identité
> Google pour **toutes** les requêtes entrantes, y compris les flux OIDC/de
> connexion que Logto est censé servir. Laissez désactivé pour un fournisseur
> d'identité public.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google devant Logto. |

Toutes les autres entrées suivent le comportement standard de [App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen
le plus rapide de localiser et d'explorer les ressources en cours
d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Carte des ClusterIP pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre le cœur de Logto. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via le proxy d'authentification) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
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
> configuration au moteur de fondation [App_GKE](App_GKE.md), qui valide les
> valeurs *et les combinaisons* au moment de la planification — un `database_type` non
> PostgreSQL, `min_instance_count > max_instance_count`, Redis activé sans hôte résolvable, IAP sans identités
> autorisées, un domaine personnalisé sans noms d'hôtes. Une configuration
> invalide fait échouer le **plan** avec une erreur claire et nommée avant la
> création de toute ressource, de sorte que la plupart des erreurs ci-dessous
> sont détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| Base de données Cloud SQL | Sauvegarder ; ne jamais effacer | Critique | Les clés de signature OIDC de Logto résident dans la base de données. L'effacer régénère de nouvelles clés et invalide tous les jetons émis et les clients enregistrés. |
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/le rôle et détruit toutes les données d'identité. |
| `database_type` | `POSTGRES_15` | Critique | MySQL/autres moteurs sont rejetés au moment de la planification ; Logto ne fonctionne que sur PostgreSQL. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans fichier de sauvegarde valide fait échouer le job d'importation. |
| `ENDPOINT` | URL du LoadBalancer externe / domaine personnalisé | Élevé | Un émetteur non concordant interrompt la découverte OIDC, les URI de redirection et chaque rappel OAuth. |
| `container_port` | `3001` | Élevé | Le cœur écoute sur 3001 ; un mauvais port fait échouer chaque sonde et requête. La console d'administration (3002) est intentionnellement non publiée. |
| `enable_iap` | `false` pour un IdP public | Élevé | IAP bloque toutes les requêtes non authentifiées, y compris les flux OIDC/de connexion que Logto est censé servir. |
| `container_resources.memory_limit` | `4Gi` (≥ 2 Gio) | Élevé | En dessous de ~2 Gio, Logto est sujet aux OOM sous charge. |
| `session_affinity` | `ClientIP` | Élevé | Sans persistance, les requêtes séquentielles d'un client peuvent atteindre différents pods en cours de flux. |
| Accès à la console d'administration (3002) | `kubectl port-forward` pour la configuration | Élevé | L'interface utilisateur du premier administrateur/de la configuration est sur 3002, inaccessible via le LoadBalancer — la configuration initiale est bloquée sans transfert de port. |
| `min_instance_count` | `1` | Élevé | GKE nécessite min ≥ 1 ; la garde de validation rejette les valeurs invalides. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy est requis pour le chemin PostgreSQL en boucle de rappel sur GKE. |
| `enable_redis` | `false` | Faible | Logto n'utilise pas Redis ; l'activer connecte une dépendance inutilisée. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers nus sont des octets et bloquent toute planification de pod dans l'espace de noms. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Logto
partagée avec la variante Cloud Run est décrite dans
**[Logto_Common](Logto_Common.md)**.

<!-- related-guides -->

## Guides associées {#related-guides}

- [Lab pratique : Logto sur GKE Autopilot](../labs/Logto_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Logto sur Google Cloud Run](Logto_CloudRun.md) — la même application sur Cloud Run, pour quand vous avez besoin de l'autre cible de déploiement.
- [Logto Common — Configuration d'application partagée](Logto_Common.md) — la configuration partagée par les deux cibles de déploiement.
