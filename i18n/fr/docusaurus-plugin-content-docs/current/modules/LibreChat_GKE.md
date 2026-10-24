---
title: "LibreChat sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de LibreChat sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/LibreChat_GKE.md @ e69407af sha256:41974899d3c2 -->

# LibreChat sur GKE Autopilot {#librechat-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/LibreChat_GKE.png" alt="LibreChat sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

LibreChat est une interface de chat IA open source avec plus de 20 000 étoiles sur GitHub qui
reproduit et étend l'expérience ChatGPT sur plus de 20 fournisseurs LLM (OpenAI, Anthropic,
Google Gemini, Mistral, Groq, Ollama, et bien d'autres). Ce module déploie LibreChat sur
**GKE Autopilot** au-dessus de la fondation [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par LibreChat et sur la manière de les
explorer et de les opérer depuis la console Google Cloud et la ligne de commande. Pour les
mécanismes communs à toutes les applications GKE — Workload Identity, ingress, autoscaling,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et le cycle de
vie du déploiement — veuillez vous référer au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## Ce que coûte LibreChat sur RAD, et comment cela se compare {#what-librechat-costs-on-rad-and-how-that-compares}

**Le module GKE Autopilot de LibreChat sur RAD coûte environ 92 $ US par mois dans un projet
Google Cloud que vous possédez, plus des frais de module uniques de 75 crédits (7,50 $ US).**
GKE convient à LibreChat pour servir une organisation en continu ; pour le coût le plus bas,
le [module Cloud Run](LibreChat_CloudRun.md) exécute le même LibreChat pour environ 46 $ US
par mois. Si vous n'en avez besoin qu'occasionnellement, un projet géré par RAD peut être
supprimé et restauré dans les 30 jours pour une poignée de crédits, de sorte que les 92 $ US
deviennent quelques dollars par mois. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 75 crédits (7,50 $ US au prix de la recharge) | 67,5 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **92 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **89 crédits par jour**, environ 2670 par mois (environ 267 $ US au prix de la recharge, 214 $ US au tarif du plan Scale) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde acheté minimum est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge unique, et moins pour un plan mensuel. Dans un
projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par
chaque application du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième
base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Pod GKE Autopilot, 2x vCPU / 2 Gio | 72,16 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5,00 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ US |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 $ |
| **Total** | **environ 92 $ US** |

### Comment cela se compare {#how-it-compares}

- **Il n'existe pas de SaaS LibreChat hébergé officiel** — il est conçu pour être auto-hébergé.
- **Un GCE e2-standard-2 (2 vCPU/8 Go, environ 49 $ US/mois)** est la comparaison auto-gérée la
  plus proche pour les 2 vCPU/2 Gio du pod GKE plus le serveur de fichiers, moins les
  sauvegardes gérées et l'autoscaling de pod inclus par RAD.
- Les appels aux fournisseurs LLM sont facturés séparément de l'infrastructure dans tous les cas.
- Ou consultez le [guide Cloud Run](LibreChat_CloudRun.md) pour l'option à moindre coût.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si LibreChat s'exécute dans **un projet géré par RAD pour vous**, vous avez une deuxième option
qui va bien au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du projet et
restaurez-le dans les 30 jours pour presque rien.** Cela convient bien mieux à LibreChat dont
vous n'avez besoin qu'occasionnellement — un projet de cours, une démo, une évaluation de
courte durée — que de l'exécuter en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD dissocie d'abord sa
  facturation, puis demande à Google de supprimer le projet. Google ne supprime pas le projet
  immédiatement : il le conserve, récupérable, pendant 30 jours. La facturation étant déjà
  dissociée, rien n'est facturé pendant cette période d'attente. Contrairement à la suppression
  d'un seul module, cela ne supprime pas une VM ou le calcul propre à LibreChat un par un —
  l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours,
  le propriétaire du projet peut le restaurer. RAD demande à Google de restaurer le projet et
  de rattacher son compte de facturation, puis vous demande d'exécuter **Mettre à jour** sur
  chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit
  individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une
  vérification, pas une reconstruction, et une mise à jour ne facture jamais à nouveau les frais
  de module. Pour LibreChat derrière un petit Services_GCP et Project_GCP, cela représente
  **une poignée de crédits (moins de 1 $ US)** au total, contre les 80 crédits que coûte un
  redéploiement complet.
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet que vous apportez et
  dont RAD gère uniquement la facturation), et vous le restaurez vous-même dans les 30 jours —
  après cela, Google le supprime définitivement. La restauration est admise comme la création
  d'un nouveau projet : votre solde de crédits achetés doit toujours dépasser le seuil du palier
  (100 crédits pour le palier sandbox qui convient à la plupart des utilisations d'étude et de
  démonstration). Google affirme que la plupart des services sont à nouveau pleinement
  opérationnels dans les 36 heures suivant une restauration.
- **Une lacune réelle : le bucket de sauvegarde ne survit pas.** Les sauvegardes nocturnes de
  LibreChat sont écrites dans un bucket à l'intérieur du projet, et ce bucket n'est **pas**
  protégé par la suppression logicielle de Cloud Storage, il est donc très probable qu'il
  disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable
  pendant 30 jours. Si vous avez personnalisé LibreChat et que vous souhaitez conserver ce
  travail, copiez une sauvegarde (vers Google Drive ou un bucket en dehors du projet) avant de
  supprimer, comme pour le flux de redéploiement ci-dessous. Pour une installation par défaut
  sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

GKE maintient au moins un pod en cours d'exécution, il ne se met donc jamais à l'échelle à zéro
tout seul. L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre
projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de supprimer
le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ
  80 crédits (8,00 $ US), car RAD recrée le projet et les services partagés avant LibreChat. La
  suppression ne permet d'économiser de l'argent que si LibreChat resterait inutilisé pendant
  environ trois jours ou plus, à la fois dans votre propre projet (environ 3,05 $ US par jour)
  et dans un projet géré par RAD (89 crédits par jour).
- **Supprimez tout ce que LibreChat utilise.** La majeure partie du coût d'exécution est
  généralement la VM de fichier/cache partagée. Elle ne s'arrête que si rien d'autre dans le
  projet ne l'utilise, donc la suppression de LibreChat alors que quelque chose d'autre partage
  le projet n'économise que la partie calcul propre à LibreChat.
- **Conservez d'abord vos données.** Les sauvegardes nocturnes sont écrites dans un bucket à
  l'intérieur du déploiement et sont supprimées avec lui, alors copiez la dernière sauvegarde
  avant de supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session LibreChat pour une
  classe. Chaque participant obtient LibreChat dans son propre projet Google Cloud pendant 15
  minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le
  formateur finance toutes les places à l'avance, soit chaque participant paie la sienne. Tout
  est supprimé à la fin de la session, et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute LibreChat pour
  un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le
  client. Si le portefeuille est faible, la facturation est suspendue et les données sont
  conservées, de sorte que personne ne reçoit de frais inattendus. À la fin de l'engagement, le
  partenaire transfère le projet, et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et
ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ;
frais RAD et estimation quotidienne de 89 crédits de
[radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des
projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour la
fenêtre de récupération de 30 jours et ce qu'elle dit sur les objets Cloud Storage sans
suppression logicielle. Les prix changent ; vérifiez chaque source avant de vous fier à un
chiffre.

## 1. Vue d'ensemble {#1-overview}

LibreChat s'exécute comme une charge de travail web Node.js. Le déploiement connecte un ensemble
ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods Node.js, 2 vCPU / 2 Gio par défaut, autoscalés horizontalement |
| Base de données | MongoDB (service d'aide in-namespace `mongo:7` par défaut) | Cloud SQL n'est pas utilisé ; la compatibilité MongoDB de Firestore est une alternative optionnelle |
| Stockage d'objets | Cloud Storage | Un bucket dédié aux téléchargements de fichiers, plus des buckets supplémentaires optionnels |
| Secrets | Secret Manager | Clés JWT, clés de chiffrement des identifiants et URI MongoDB auto-générés |
| Cache et sessions | Redis (optionnel) | Requis pour les déploiements multi-réplicas afin de maintenir la cohérence des sessions |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé optionnel + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de Cloud SQL.** LibreChat utilise MongoDB. `mongodb_uri` par défaut à `""`, mais `main.tf`
  substitue un URI de service d'aide in-namespace `mongo:7` calculé (`mongodb://<service>-mongo.<namespace>.svc.cluster.local:27017/LibreChat`) avant
  d'appeler `LibreChat_Common` — ce **service d'aide MongoDB in-namespace est la base de données par
  défaut**, reflétant le sidecar in-pod `LibreChat_CloudRun`. Firestore ENTERPRISE avec compatibilité
  MongoDB est une **alternative optionnelle** : l'auto-provisionnement de `LibreChat_Common` ne se
  déclenche que lorsqu'il reçoit un `mongodb_uri` et un `firestore_mongodb_host` réellement vides, une
  combinaison que la configuration par défaut de ce module ne produit jamais. Définissez `mongodb_uri`
  explicitement (vers un MongoDB externe, Atlas ou un hôte Firestore) pour ne plus utiliser
  l'aide par défaut.
- **L'aide MongoDB par défaut nécessite NFS.** Son répertoire de données `/data/db` est monté à
  partir du volume Filestore (NFS) partagé, donc `enable_nfs` par défaut à `true`. Gardez-le
  activé à moins que vous ne remplaciez `mongodb_uri` par un MongoDB externe — avec NFS désactivé,
  l'aide n'a pas de volume à monter et LibreChat boucle en cas de crash.
- **Une base de données Firestore (lorsqu'elle est activée) n'est jamais supprimée lors de la
  destruction.** La base de données est conservée pour éviter la perte de données ; supprimez-la
  manuellement si elle n'est plus nécessaire.
- **Les secrets JWT et d'identifiants sont auto-générés** lors du premier déploiement et stockés
  dans Secret Manager. La rotation de `CREDS_KEY` ou `CREDS_IV` après que les utilisateurs ont
  enregistré des identifiants de fournisseur IA rend tous les identifiants stockés
  indéchiffrables.
- **Redis est désactivé par défaut.** Activez-le pour tout déploiement avec plus d'un réplica —
  sans Redis, l'état de session est isolé par pod et les utilisateurs perdent leurs sessions
  lors des redémarrages de pod.
- **L'affinité de session est `ClientIP`.** LibreChat utilise des connexions WebSocket ; le routage
  persistant maintient le trafic d'un utilisateur sur le même pod.
- **Le délai d'attente est de 600 secondes par défaut.** Les réponses IA de longue durée via le
  streaming SSE nécessitent un délai d'attente généreux.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté `gcloud container clusters get-credentials <cluster> --region <region> --project <project>` et que `PROJECT`, `REGION` et
`NAMESPACE` sont définis. L'espace de noms et les autres identifiants sont signalés dans les
[Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail LibreChat {#a-gke-autopilot--the-librechat-workload}

Les pods LibreChat sont planifiés sur Autopilot, qui facture le CPU et la mémoire que les pods
demandent réellement. L'autoscaling horizontal des pods dimensionne le déploiement entre le
nombre minimal et maximal de réplicas.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail
  LibreChat pour voir les pods, les révisions et les événements. Kubernetes Engine → Services et
  Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de
charge de travail (Déploiement vs StatefulSet).

### B. Aide MongoDB in-namespace — la base de données LibreChat {#b-in-namespace-mongodb-helper--the-librechat-database}

LibreChat stocke tout l'historique des chats, les comptes utilisateurs et la configuration dans
MongoDB. Par défaut, le bloc `main.tf` de `librechat_additional_services` exécute l'image officielle `mongo:7`
en tant que service d'aide in-namespace singleton (`min=max=1`) `Deployment`+`Service`,
accessible via le DNS du cluster à `<service>-mongo.<namespace>.svc.cluster.local:27017`. Cela reflète le sidecar in-pod `LibreChat_CloudRun` de
`mongo:7`, mais sur GKE, l'aide est une charge de travail distincte plutôt qu'un conteneur
du même pod — car LibreChat est construit autour de MongoDB standard et l'API compatible Mongo
de Firestore supprime les commandes de démarrage de LibreChat. Le répertoire de données de l'aide
(`/data/db`) est monté à partir du volume Filestore (NFS) partagé ; le nombre de réplicas
singleton évite les problèmes de verrouillage de fichiers multi-écrivains que MongoDB a sur NFS.
`mongodb_uri` (par défaut `""`) est résolu automatiquement vers l'URI de cette aide —
définissez-le explicitement pour le remplacer par MongoDB Atlas ou toute instance MongoDB
auto-hébergée accessible depuis le VPC.

Alternativement, effacez la configuration effective pour opter pour une **base de données
Firestore ENTERPRISE avec compatibilité MongoDB** — cela ne se produit que lorsque `LibreChat_Common`
lui-même reçoit un `mongodb_uri` et un `firestore_mongodb_host` vides, ce qui nécessite de
remplacer le câblage par défaut de ce module (le wrapper `librechat.tf` substitue toujours l'URI de
l'aide lorsque `var.mongodb_uri == ""`).

- **Console :** Kubernetes Engine → Charges de travail → le déploiement `<service>-mongo` affiche le
  pod, les journaux et les événements de l'aide. Firestore → sélectionnez la base de données
  (uniquement lorsque le mode Firestore est utilisé ; l'ID correspond à `firestore_mongodb_database`, par défaut :
  `LibreChat`).
- **CLI :**
  ```bash
  # Inspect the default MongoDB helper and its NFS-backed data directory:
  kubectl get pods,svc -n "$NAMESPACE" -l component=mongo
  kubectl logs -n "$NAMESPACE" deploy/<service-name>-mongo --tail=100

  # If using Firestore mode instead (opt-in only):
  gcloud firestore databases list --project "$PROJECT"
  gcloud firestore databases describe LibreChat --project "$PROJECT"
  ```

Récupérez l'URI MongoDB résolu de Secret Manager pour vérifier la connectivité :

```bash
gcloud secrets list --project "$PROJECT" --filter="name~mongo-uri"
gcloud secrets versions access latest --secret=<mongo-uri-secret> --project "$PROJECT"
```

### C. Cloud Storage — téléchargements de fichiers {#c-cloud-storage--file-uploads}

`LibreChat_Common` provisionne un bucket Cloud Storage **`librechat-uploads`** dédié aux téléchargements de
fichiers utilisateur partagés dans le chat (images, documents). Le compte de service de la charge
de travail se voit accorder l'accès automatiquement.

- **Console :** Cloud Storage → Buckets → recherchez le bucket avec le suffixe `uploads`.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<uploads-bucket>/
  # Confirm the GCS Fuse mount is active inside the pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h | grep -i fuse
  ```

Voir [App_GKE](App_GKE.md) pour le provisionnement NFS, GCS Fuse et les options CMEK.

### D. Secret Manager — secrets d'application auto-générés {#d-secret-manager--auto-generated-application-secrets}

LibreChat nécessite plusieurs secrets cryptographiques qui sont générés automatiquement lors du
premier déploiement et ne sont jamais exposés en texte clair.

| Suffixe du secret | Variable d'environnement | Objectif |
|---|---|---|
| `creds-key` | `CREDS_KEY` | Clé AES-GCM hexadécimale de 32 octets pour les identifiants de fournisseur enregistrés |
| `creds-iv` | `CREDS_IV` | IV AES-GCM hexadécimal de 16 octets — associé à `CREDS_KEY` |
| `jwt-secret` | `JWT_SECRET` | Signe les jetons d'accès utilisateur |
| `jwt-refresh-secret` | `JWT_REFRESH_SECRET` | Signe les jetons d'actualisation de longue durée |
| `mongo-uri` | `MONGO_URI` | Chaîne de connexion MongoDB |

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store CSI.

### E. Cache Redis (optionnel) {#e-redis-cache-optional}

Redis prend en charge la gestion des sessions de LibreChat et la mise en file d'attente des
messages en temps réel. Il est requis lorsque plus d'un réplica de pod est en cours d'exécution
— sans lui, chaque pod a un état de session en mémoire isolé et les utilisateurs perdent leurs
sessions lorsque les requêtes sont acheminées vers un pod différent.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  # From inside the cluster:
  kubectl run redis-check --rm -it --image=redis --restart=Never -- redis-cli -h <redis-host> ping
  ```

### F. Réseau et ingress {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe Cloud Load Balancing. Un domaine
personnalisé avec un certificat géré par Google peut être activé, et une IP statique peut être
réservée afin que l'adresse survive aux redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails de l'IP
statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties standard/erreur des pods sont acheminées vers Cloud Logging ; les métriques GKE sont
acheminées vers Cloud Monitoring. Des vérifications de disponibilité et des politiques d'alerte
optionnelles sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read \
    'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application LibreChat {#3-librechat-application-behaviour}

- **Pas de job de migration de base de données.** LibreChat migre automatiquement son schéma
  MongoDB au premier démarrage ; aucun job d'initialisation séparé n'est nécessaire.
- **Aide `mongo:7` in-namespace par défaut, pas Firestore.** `mongodb_uri` par défaut à `""`,
  mais `main.tf` substitue un URI de service d'aide `mongo:7` in-namespace calculé avant
  d'appeler `LibreChat_Common` — voir §1 et §2.B. L'auto-provisionnement Firestore ENTERPRISE
  (découverte ou création, plus provisionnement automatique d'utilisateur SCRAM) est une
  alternative optionnelle atteinte uniquement lorsque le `mongodb_uri` effectif passé à `LibreChat_Common`
  est vide, ce qui nécessite de remplacer le câblage par défaut de ce module. Lorsque le mode
  Firestore est utilisé, la base de données n'est jamais détruite avec le module.
- **Clés API de fournisseur IA.** LibreChat se connecte aux API de fournisseur IA au moment de la
  requête. Injectez les clés de fournisseur (OpenAI, Anthropic, etc.) via `secret_environment_variables`, qui
  référence des secrets Secret Manager préexistants. Ne passez pas les clés comme des `environment_variables`
  en clair — elles apparaîtraient dans les spécifications de pod visibles via `kubectl describe pod`.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent toutes deux `/` (la
  racine de LibreChat), qui renvoie HTTP 200 une fois que l'application est entièrement
  initialisée et connectée à MongoDB. La sonde de démarrage a un seuil d'échec généreux pour
  permettre l'établissement de la connexion MongoDB au premier démarrage.
- **Continuité WebSocket et SSE.** LibreChat utilise les événements envoyés par le serveur (SSE)
  pour le streaming des réponses IA et WebSocket pour les mises à jour en temps réel. L'affinité
  de session (`ClientIP`) maintient la connexion d'un utilisateur sur le même pod. Assurez-vous
  que `timeout_seconds` est défini suffisamment haut (600 s par défaut) pour éviter de tronquer les
  longues réponses IA en cours de streaming.
- **Enregistrement utilisateur.** L'auto-enregistrement est activé par défaut. Définissez `allow_registration = false`
  après la création du compte administrateur initial pour empêcher les inscriptions non
  autorisées sur les déploiements publics.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres spécifiques ou notables pour LibreChat sont listés ; toutes
les autres entrées sont héritées de [App_GKE](App_GKE.md) avec son comportement et ses valeurs
par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |
| `firestore_mongodb_host` | `""` | Hôte du point de terminaison Firestore MongoDB (remplacement manuel). Laissez vide pour la découverte automatique. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources pour le suivi des coûts/propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `librechat` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `LibreChat AI Chat` | Nom convivial affiché dans la console. |
| `application_description` | _(défini)_ | Annotation de description de la charge de travail. |
| `application_version` | `latest` | Tag de version de l'image LibreChat — **épingler à une version spécifique en production**. |
| `mongodb_uri` | `""` | URI de connexion MongoDB (sensible). Laissez la valeur par défaut `""` pour utiliser le service d'aide `mongo:7` in-namespace que `main.tf` calcule automatiquement — l'auto-provisionnement Firestore est un chemin d'accès optionnel distinct (voir §2.B), ce n'est pas ce que laisser ce champ vide déclenche seul. |
| `app_title` | `LibreChat` | Titre affiché dans l'en-tête de l'interface utilisateur LibreChat et l'onglet du navigateur. |
| `allow_registration` | `true` | Autoriser les nouveaux utilisateurs à s'auto-enregistrer. **Définissez `false` après la création du compte administrateur initial.** |
| `allow_social_login` | `false` | Activer les fournisseurs de connexion sociale OAuth. Nécessite une configuration d'application OAuth dans `librechat.yaml`. |
| `allow_social_registration` | `null` | Autoriser la création de compte via la connexion sociale. Par défaut à la valeur de `allow_social_login`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `prebuilt` | `prebuilt` (GHCR) ou `custom` (Cloud Build). |
| `container_image` | `ghcr.io/danny-avila/librechat` | URI de l'image du conteneur. |
| `container_resources` | `{ cpu_limit = "2000m", memory_limit = "2Gi" }` | CPU et mémoire par pod ; 2 vCPU / 2 Gio minimum. |
| `container_port` | `3080` | Port HTTP natif de LibreChat. |
| `min_instance_count` | `1` | Réplicas minimum. Gardez ≥ 1 pour éviter les démarrages à froid et les flux SSE interrompus. |
| `max_instance_count` | `5` | Réplicas maximum (plafond HPA). |
| `timeout_seconds` | `600` | Délai d'expiration de la requête ; augmentez pour les backends LLM lents ou les longues réponses IA. |
| `enable_cloudsql_volume` | `false` | **Doit rester `false`.** LibreChat n'utilise pas Cloud SQL. |
| `enable_vertical_pod_autoscaling` | `false` | Laissez Autopilot ajuster automatiquement les demandes de ressources. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image GHCR vers Artifact Registry — évite les limites de débit. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Les variables LibreChat de base sont définies automatiquement. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. **Utilisez ceci pour les clés API de fournisseur IA.** |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service Kubernetes est exposé. |
| `session_affinity` | `ClientIP` | Routage persistant pour la continuité WebSocket et SSE. |
| `workload_type` | `null` | Se résout automatiquement en `StatefulSet` lorsque le stockage par pod est activé. |
| `network_tags` | `['nfsserver']` | Tags de nœud/pod ; `nfsserver` est requis pour la connectivité NFS. |
| `termination_grace_period_seconds` | `60` | Secondes à attendre après SIGTERM avant de terminer de force ; augmentez pour les requêtes IA en cours. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Activer le PVC par pod. Sélectionne automatiquement `StatefulSet`. |
| `stateful_pvc_size` | `10Gi` | Taille de stockage pour chaque PVC. |
| `stateful_pvc_mount_path` | `/data` | Chemin du conteneur pour le PVC. |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass pour les PVC. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Limiter les comptes CPU/mémoire/objets de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doit utiliser des unités binaires (`4Gi`, `8192Mi`)** — les entiers bruts sont lus comme des octets et bloquent toute planification. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `false` | Créer un PodDisruptionBudget (désactivé par défaut car le nombre maximal de réplicas est de 1 pod). |
| `pdb_min_available` | `1` | Augmentez `min_instance_count` au-dessus de 1 si vous avez besoin d'une marge d'éviction. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | `{ path="/", initial_delay_seconds=30, failure_threshold=12 }` | Sonde HTTP permettant le temps de connexion MongoDB et de chargement des ressources. |
| `health_check_config` | `{ path="/", initial_delay_seconds=60, failure_threshold=3 }` | Sonde de vivacité ciblant le chemin racine de LibreChat. |
| `uptime_check_config` | désactivé, `/` | Vérification de disponibilité Cloud Monitoring optionnelle. |
| `alert_policies` | `[]` | Politiques d'alerte métrique optionnelles. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide — LibreChat migre automatiquement MongoDB au démarrage. Ajoutez des tâches de configuration personnalisées si nécessaire. |
| `cron_jobs` | `[]` | CronJobs Kubernetes planifiés pour les tâches périodiques (nettoyage des données, préchauffage du cache, etc.). |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard App_GKE Cloud Build / Cloud Deploy — voir [App_GKE](App_GKE.md). Entrées
clés : `enable_cicd_trigger`, `github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Provisionner un volume Filestore NFS partagé entre tous les réplicas. Requis par l'aide MongoDB par défaut. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner des buckets GCS supplémentaires. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets supplémentaires au-delà du bucket de téléchargements auto-provisionné. |
| `gcs_volumes` | `[]` | Buckets GCS à monter via le pilote CSI GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 15 — Redis {#group-15--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Activer Redis pour la gestion des sessions. **Requis pour les déploiements multi-réplicas.** |
| `redis_host` | `""` | Point de terminaison Redis. Requis lorsque `enable_redis = true`. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis optionnel (sensible). |

### Groupe 16 — Base de données / MongoDB {#group-16--database--mongodb}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | **Fixe — ne pas modifier.** LibreChat n'utilise pas Cloud SQL. |
| `firestore_mongodb_database` | `LibreChat` | ID de base de données Firestore / nom de base de données MongoDB. |
| `firestore_mongodb_username` | `""` | Nom d'utilisateur SCRAM pour l'authentification Firestore. |
| `firestore_mongodb_password` | `""` | Mot de passe SCRAM (sensible). Auto-généré lorsqu'il n'est pas défini. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde NFS automatisé (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmentez à 30–90 pour la production/conformité. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

Non applicable — LibreChat n'utilise pas Cloud SQL. Voir [App_GKE](App_GKE.md) pour les
mécanismes partagés.

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner une passerelle Kubernetes pour les noms d'hôte personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |

### Groupe 20 — Proxy conscient de l'identité (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google devant LibreChat. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque l'IAP est activé (sensible). |
| `iap_support_email` | `""` | Affiché sur l'écran de consentement OAuth. |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attacher une politique Cloud Armor (WAF) au backend Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à un accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la politique. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode dry-run. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Mappage des ClusterIP pour les services spécifiques à chaque étape (Cloud Deploy). |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre LibreChat. |
| `storage_buckets` | Buckets Cloud Storage créés (inclut le bucket des téléversements). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` | Noms des jobs de configuration qui ont été exécutés. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster et la charge de travail sont prêts. Faux lors du premier apply d'un nouveau cluster inline — relancer l'apply pour terminer. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `CREDS_KEY` / `CREDS_IV` (auto-généré) | défini une fois | Critique | Clés AES-GCM pour les identifiants de fournisseur d'IA enregistrés. La rotation après que les utilisateurs ont enregistré des clés détruit tous les identifiants stockés — chaque utilisateur doit ressaisir ses clés API. |
| `mongodb_uri` | laisser par défaut (aide `mongo:7` dans l'espace de noms) ou définir explicitement | Critique | LibreChat nécessite MongoDB. L'aide `mongo:7` par défaut dans l'espace de noms a besoin de `enable_nfs = true` pour son répertoire de données ; la surcharge de `mongodb_uri` à `""` sur l'appel `LibreChat_Common` (contournant le câblage par défaut de ce module) avec une configuration Firestore/Atlas défectueuse fait planter le pod au démarrage et ne sert aucun trafic. |
| `enable_cloudsql_volume` | `false` | Critique | Doit rester `false`. L'activation injecte un sidecar Cloud SQL Auth Proxy qui entre en conflit avec le routage de connexion uniquement MongoDB. |
| `database_type` | `NONE` | Critique | La définition d'un moteur SQL provisionne une instance Cloud SQL inutilisée à un coût supplémentaire sans bénéficier à LibreChat. |
| `secret_environment_variables` (clés AI) | utiliser des secrets | Critique | Les clés de fournisseur d'IA passées comme `environment_variables` en clair sont visibles dans `kubectl describe pod` et les journaux d'audit GCP. Toujours utiliser les références Secret Manager. |
| `iap_oauth_client_id` / `_secret` | définir lorsque IAP est activé | Critique | Requis lorsque `enable_iap = true`. Si non fourni, la passerelle IAP ne parvient pas à s'initialiser et le service devient inaccessible. |
| `quota_memory_requests` / `_limits` | unités binaires | Critique | Les entiers nus sont des octets et bloquent toute planification. |
| `allow_registration` | `false` après la configuration | Élevé | L'enregistrement ouvert sur un déploiement exposé par un LoadBalancer permet à quiconque de créer un compte. Désactiver après la création de l'administrateur ou restreindre avec IAP. |
| `enable_redis` | `true` pour multi-réplica | Élevé | Sans Redis, les redémarrages et la replanification des pods interrompent toutes les sessions actives et les flux SSE acheminés vers ce pod. |
| `redis_host` | point de terminaison explicite | Élevé | Requis lorsque `enable_redis = true`. Si vide, LibreChat ne parvient pas à se connecter à Redis au démarrage. |
| `timeout_seconds` | `600` | Élevé | Le streaming SSE pour les longues réponses d'IA peut dépasser plusieurs minutes. Un délai d'attente insuffisant tronque les réponses en cours de flux. |
| `min_instance_count` | `1` | Élevé | La mise à l'échelle à zéro interrompt tous les flux SSE en cours et provoque une latence de démarrage à froid au réveil. |
| `JWT_SECRET` (auto-généré) | défini une fois | Élevé | La rotation invalide toutes les sessions actives simultanément. Planifier la rotation pendant une fenêtre de maintenance. |
| `enable_nfs` | `true` (par défaut) avec l'aide MongoDB par défaut | Élevé | L'aide `mongo:7` dans l'espace de noms (le backend de base de données par défaut) monte son répertoire de données (`/data/db`) à partir du volume NFS — désactiver `enable_nfs` avec l'aide active le laisse sans volume à monter. Également nécessaire pour les déploiements multi-réplicas afin que les fichiers téléchargés ne soient pas locaux au pod. |
| `backup_schedule` | définir pour la production | Élevé | Sans sauvegardes, l'historique des conversations et les données utilisateur dans MongoDB/Firestore n'ont pas d'instantanés au niveau GCS. |
| `application_version` | version épinglée | Moyen | `latest` peut introduire des changements de schéma MongoDB ou des incompatibilités d'API lors de mises à niveau non planifiées. |
| `enable_iap` / `enable_cloud_armor` | activer pour la production | Moyen | LibreChat est autrement directement accessible depuis l'internet public avec seulement la connexion au niveau de l'application pour le protéger. |
| `pdb_min_available` vs `min_instance_count` | laisser de la marge | Moyen | `1`/`1` peut bloquer les mises à niveau de nœuds (un seul pod ne peut pas être expulsé). |

---

Pour le comportement de base référencé partout — IAM et Workload Identity, autoscaling,
ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et
mise en miroir d'images — voir **[App_GKE](App_GKE.md)**. La configuration d'application spécifique à LibreChat
partagée avec la variante Cloud Run est décrite dans **[LibreChat_Common](LibreChat_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : LibreChat sur GKE Autopilot](../labs/LibreChat_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [LibreChat sur Google Cloud Run](LibreChat_CloudRun.md) — la même application sur Cloud Run, pour quand vous avez besoin de l'autre cible de déploiement.
- [LibreChat Common — Configuration d'application partagée](LibreChat_Common.md) — la configuration partagée par les deux cibles de déploiement.
