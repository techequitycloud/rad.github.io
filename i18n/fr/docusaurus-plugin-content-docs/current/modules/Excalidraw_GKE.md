---
title: "Excalidraw sur GKE Autopilot"
description: "Référence de configuration pour le déploiement d'Excalidraw sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Excalidraw_GKE.md @ 40c83c3f sha256:c95f12c0cf8d -->

# Excalidraw sur GKE Autopilot {#excalidraw-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Excalidraw_GKE.png" alt="Excalidraw sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Excalidraw est un tableau blanc virtuel open source (MIT) pour esquisser des
diagrammes, des wireframes et des dessins collaboratifs rapides de style
dessiné à la main. La distribution auto-hébergée est une **application
statique d'une seule page servie par nginx** — il n'y a pas de backend, de
base de données ou de comptes utilisateur, et les dessins sont stockés dans le
propre navigateur du visiteur. Ce module déploie ce frontend statique sur
**GKE Autopilot** au-dessus de la fondation [App_GKE](App_GKE.md), qui
provisionne et gère l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud qu'Excalidraw utilise et sur la
façon de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à chaque application GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls et le cycle de vie du déploiement —
reportez-vous au [guide de la fondation App_GKE](App_GKE.md) plutôt que de les
répéter ici.

---

## Ce que coûte Excalidraw sur RAD, et comment cela se compare {#what-excalidraw-costs-on-rad-and-how-that-compares}

**Dans un projet Google Cloud que vous possédez, Excalidraw sur le module GKE Autopilot de RAD coûte environ 24 US$ par mois, plus 4 US$ une fois par déploiement et aucune licence par utilisateur.** Pour le coût le plus bas, le [module Cloud Run](Excalidraw_CloudRun.md) exécute le même Excalidraw pour environ 17 US$ par mois. Excalidraw est un tableau blanc statique et open source pour les diagrammes de style dessinés à la main, sans base de données, Redis ou stockage persistant propre. Les chiffres sont à jour au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

Si cela s'exécute dans un projet géré par RAD pour vous, il peut être supprimé et restauré dans les 30 jours sans frais supplémentaires au lieu de rester en cours d'exécution — ainsi, un déploiement à usage occasionnel coûte quelques dollars par mois, et non les 186 US$ par mois que coûte son maintien en fonctionnement. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 40 crédits (4 US$ au prix de la recharge) | 36 crédits (10 % de moins) |
| Builds | Inclus dans le prix : pas de frais de build pour la création, 5 mises à jour par mois (mois calendaire UTC) gratuites puis 2 crédits chacune, et rien pour la suppression ou pour un build échoué. Les sessions de lab et les projets clients sont l'exception : ils sont toujours facturés pour le temps de build à la minute | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **24 US$ par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **62 crédits par jour**, environ 1 860 par mois (environ 186 US$ au prix de la recharge ; estimé à partir des prix catalogue de Google, et incluant les frais de cluster) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

**Pourquoi les deux colonnes diffèrent.** Le chiffre géré par RAD inclut les frais de gestion du cluster GKE (environ 73 US$ par mois) et la fondation partagée du projet. Dans votre propre projet, le niveau gratuit de Google couvre les frais de gestion d'un cluster par compte de facturation, ce que le chiffre du propre projet suppose. Il est estimé à partir des prix catalogue de Google, car il n'y a pas encore suffisamment d'historique GKE géré par RAD pour le mesurer, de sorte que la confirmation de déploiement ne le cite pas. Une deuxième application GKE dans le même projet géré par RAD partage le cluster et n'ajoute que ses propres pods.

Votre premier déploiement réussi sur RAD est exempt de frais de module, quel que soit le montant : une fois par compte, pour un module que vous déployez et payez vous-même (dans une solution, les frais d'une application : la première à réussir ; jamais une session de lab ou un projet client).

10 crédits coûtent 1 US$ lors d'une recharge ponctuelle, et moins avec un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Pod GKE Autopilot, 0,5 vCPU / 0,5 Gio, fonctionnant en permanence | 18 US$ |
| Passerelle Cloud NAT et adresse IP | 5 US$ |
| Cloud Storage pour les sauvegardes | 1 US$ |
| **Total** | **environ 24 US$** |

Le niveau gratuit de GKE couvre les frais de gestion d'un cluster Autopilot ou zonal par compte de facturation, donc le total ci-dessus suppose qu'il s'agit de ce cluster ; sinon, ajoutez environ 73 US$ par mois.

### Comment cela se compare {#how-it-compares}

Nous n'avons pas trouvé de plan commercial géré/SaaS spécifiquement pour Excalidraw au 8 octobre 2026, donc la comparaison honnête se fait par rapport à l'exécution par vous-même :

| Option | Par mois | Qui l'exécute |
|---|---|---|
| Hetzner CPX22 (2 vCPU/4 Go) | ~24 US$ | Vous : OS, mises à jour, sauvegardes, correctifs de sécurité |
| DigitalOcean 2 vCPU/4 Go Droplet | 24 US$ | Vous : OS, mises à jour, sauvegardes, correctifs de sécurité |
| GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) | ~49 US$ | Vous : OS, mises à jour, sauvegardes, correctifs de sécurité |
| **RAD, GKE Autopilot, votre propre projet** | **24 US$**, plus 4 US$ une fois | L'automatisation de RAD, dans votre projet |
| RAD, Cloud Run | environ 17 US$ ; voir le [guide Cloud Run](Excalidraw_CloudRun.md) | RAD |

L'empreinte propre d'Excalidraw ici (0,5 vCPU / 0,5 Gio) est plus légère que celle de la boîte de référence, donc un niveau plus petit et moins cher des mêmes fournisseurs l'exécuterait également confortablement.

- **RAD n'est généralement pas moins cher en espèces qu'un VPS nu — la différence réside dans ce qui est géré pour vous.** Le prix d'un VPS n'inclut pas le temps de l'administrateur pour les sauvegardes, les correctifs de sécurité et les mises à niveau du système d'exploitation ; le Cloud SQL géré par RAD (lorsque cette application utilise une base de données), Secret Manager et la surveillance couvrent cela à la place.
- **Excalidraw est un tableau blanc statique et open source pour les diagrammes de style dessinés à la main, sans base de données, Redis ou stockage persistant propre.** Cela détermine quelle colonne est importante : une opération prévisible et sans intervention vaut plus pour la plupart des équipes utilisant ce type d'outil que de réduire de quelques dollars la facture mensuelle.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Excalidraw s'exécute dans **un projet géré par RAD pour vous**, vous avez une option au-delà de la réduction d'échelle : **supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour presque rien.** Cela convient bien mieux à un déploiement dont vous n'avez besoin qu'occasionnellement — pour étudier en vue d'une certification, une démo, un besoin saisonnier — que de le faire fonctionner en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ou les ressources qu'il contient, seront utilisables après sa restauration, de sorte que la restauration ne peut pas être considérée comme un moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application et de les avoir stockées en dehors du projet. Si une restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le projet. Google ne le supprime pas immédiatement : il le conserve, récupérable, pendant 30 jours, et comme la facturation est déjà déliée, rien n'est facturé pendant cette attente. Contrairement à la suppression d'un module, cela ne démantèle pas GKE Autopilot un par un — l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration est une vérification, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet peut le restaurer. RAD demande à Google de récupérer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter **Mettre à jour** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Les mises à jour sont incluses dans le prix (5 par mois pour chaque déploiement), donc une restauration ne coûte normalement aucun crédit.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, et non les 186 US$ par mois de maintien en fonctionnement.** Déployez Excalidraw, utilisez-le pour une session, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Mettre à jour, et supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez que les frais de module une seule fois et les heures pendant lesquelles il était réellement en ligne.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un projet que vous apportez et dont RAD ne gère que la facturation), et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime définitivement. La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés doit toujours dépasser le seuil du palier (100 crédits pour le palier sandbox que la plupart des utilisations d'étude/démo conviennent). Google indique que la plupart des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

GKE maintient au moins un pod en cours d'exécution, donc Excalidraw ne se met jamais à l'échelle zéro de lui-même. L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau (les builds sont inclus) : 40 crédits (4,00 US$). La suppression permet d'économiser de l'argent si Excalidraw resterait inutilisé pendant environ 6 jours ou plus dans votre propre projet (environ 0,80 US$ par jour), ou environ 1 jour ou plus dans un projet géré par RAD (62 crédits par jour).
- **Notez vos paramètres.** RAD ne recrée pas un déploiement supprimé pour vous ; vous saisissez à nouveau les paramètres lors du déploiement.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant dispose d'Excalidraw dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais propres à RAD et estimation quotidienne des crédits de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour le mécanisme de pause/restauration. Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Excalidraw fonctionne comme une seule charge de travail web nginx sans état.
Comme l'application n'a pas de backend, le déploiement ne relie qu'un ensemble
minimal de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods nginx statiques sur le **port 80**, autoscalés horizontalement ; facturés pour le CPU/mémoire demandé |
| Image conteneur | Artifact Registry | Build personnalisé léger `FROM excalidraw/excalidraw`, mis en miroir dans le registre du projet |
| Base de données | _Aucune_ | Excalidraw n'a pas de backend — aucune instance Cloud SQL n'est créée |
| Stockage d'objets | _Aucun_ | Aucun bucket GCS n'est provisionné ; les dessins vivent dans le navigateur |
| Cache et file d'attente | _Aucun_ | Pas de Redis, pas de file d'attente de messages |
| Secrets | _Aucun_ | Pas de clés de chiffrement, de secrets JWT ou de mots de passe de base de données — Secret Manager est inutilisé |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé optionnel + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Entièrement sans état — aucune donnée n'est stockée côté serveur.** Les
  dessins persistent dans le stockage local de chaque navigateur et sont
  exportés/importés sous forme de fichiers `.excalidraw`. Le
  replanification des pods, les redéploiements et la mise à l'échelle ne
  perdent **aucune** donnée serveur car il n'y en a pas.
- **Un minimum de 1 réplica est maintenu** (GKE ne prend pas en charge la
  mise à l'échelle à zéro) pour que le tableau blanc soit toujours
  accessible. Le wrapper épingle `min_instance_count = 1`.
- **Charge de travail de déploiement, pas StatefulSet.** Il n'y a pas de
  volume persistant par pod — chaque pod sert le même bundle statique, donc un
  simple `Deployment` est utilisé et les pods sont entièrement
  interchangeables.
- **Port fixe 80.** L'écouteur nginx est intégré à l'image ; `container_port`
  est par défaut à 80 et ne doit pas être modifié.
- **Pas de Cloud SQL, Secret Manager, Redis, NFS ou GCS.** Les
  fonctionnalités de fondation correspondantes sont inertes pour cette
  application — les activer provisionne une infrastructure inutilisée.
- **LoadBalancer externe par défaut** pour que le tableau blanc soit
  accessible par navigateur ; une IP statique réservée maintient l'adresse
  stable lors des redéploiements.
- **Entrées héritées `homeserver_url` / `homeserver_name`.** Reportées du
  modèle Element et toujours injectées comme `HOMESERVER_URL` / `HOMESERVER_NAME`,
  que le SPA statique ignore. Elles sont masquées du formulaire de déploiement.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Excalidraw {#a-gke-autopilot--the-excalidraw-workload}

Les pods Excalidraw sont planifiés sur Autopilot, qui facture le CPU/la mémoire
que les pods demandent réellement. L'autoscaling horizontal des pods dimensionne
le déploiement entre le nombre minimum (`1`) et maximum de réplicas. Comme
chaque pod est identique et sans état, la mise à l'échelle est sûre sans
coordination.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge
  de travail Excalidraw pour les pods, les révisions et les événements.
  Kubernetes Engine → Services et Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100      # nginx access/error logs
  kubectl describe hpa -n "$NAMESPACE"                                # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle
et du type de charge de travail.

### B. Artifact Registry — l'image conteneur {#b-artifact-registry--the-container-image}

L'image Excalidraw est un build personnalisé léger `FROM excalidraw/excalidraw` que Cloud Build
produit et pousse dans l'Artifact Registry du projet (`enable_image_mirroring
= true`). App_GKE définit
`imagePullPolicy=Always` pour les images personnalisées/mises en miroir afin qu'une balise
reconstruite soit toujours re-tirée.

- **Console :** Artifact Registry → Dépôts.
- **CLI :**
  ```bash
  gcloud artifacts repositories list --project "$PROJECT" --location "$REGION"
  gcloud artifacts docker images list <repo-path> --include-tags
  gcloud builds list --project "$PROJECT" --region "$REGION" --limit 5
  # Confirm the digest running in the cluster matches the freshly built image:
  kubectl get pod -n "$NAMESPACE" -o jsonpath='{.items[0].status.containerStatuses[0].imageID}'
  ```

### C. Base de données, Secret Manager, Cloud Storage, Redis — non utilisés {#c-database-secret-manager-cloud-storage-redis--not-used}

Excalidraw ne provisionne **aucun** de ces éléments. Il n'y a pas d'instance
Cloud SQL, pas de secret Secret Manager, pas de bucket GCS et pas de Redis pour
ce déploiement. Les commandes suivantes renverront des résultats vides pour
l'application — c'est attendu :

```bash
gcloud sql instances list --project "$PROJECT" --filter="name~excalidraw"   # (none)
gcloud secrets list --project "$PROJECT" --filter="name~excalidraw"          # (none)
gcloud storage buckets list --project "$PROJECT" --filter="name~excalidraw"  # (none)
```

La collaboration en direct fonctionne, mais via le propre serveur de salle
hébergé d'Excalidraw (`oss-collab.excalidraw.com`, chiffré de bout en bout), et non un service dans
votre projet — voir les valeurs par défaut ci-dessus. L'hébergement de la
collaboration vous-même nécessiterait un build source du frontend et un serveur
`excalidraw-room` séparé, que ce module ne déploie **pas**.

### D. Réseau et ingress {#d-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe de Cloud Load
Balancing. Un domaine personnalisé avec un certificat géré par Google peut être
activé, et une IP statique peut être réservée afin que l'adresse survive aux
redéploiements. Cloud CDN est bien adapté aux ressources statiques.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses
  IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés,
Cloud CDN et les IP statiques.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les sorties stdout/stderr des pods (journaux nginx) sont acheminées vers Cloud
Logging ; les métriques GKE sont acheminées vers Cloud Monitoring. Des tests de
disponibilité et des stratégies d'alerte optionnels sont disponibles ; un test
de disponibilité public sur le chemin racine est un signal de santé naturel
pour le frontend statique.

- **Console :** Journalisation → Explorateur de journaux ; Surveillance →
  Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Excalidraw {#3-excalidraw-application-behaviour}

- **Pas de configuration au premier déploiement.** Il n'y a pas de base de
  données, pas de job d'initialisation et pas de migrations. Un pod est prêt
  dès que nginx commence à servir le bundle statique — généralement en une ou
  deux secondes.
- **Pas de comptes, pas de connexion, pas de persistance côté serveur.** Le
  frontend auto-hébergé n'a pas d'authentification et ne stocke rien côté
  serveur. Les dessins de chaque utilisateur vivent dans **le stockage local de
  leur propre navigateur** ; utilisez **Exporter** (`.excalidraw`, PNG ou SVG) pour
  enregistrer ou partager le travail.
- **Les pods sont interchangeables.** Chaque réplica sert le même bundle
  statique, de sorte que les requêtes n'ont pas besoin d'affinité de session et
  que la mise à l'échelle ne nécessite aucune coordination — contrairement aux
  modules d'application avec état.
- **Certaines fonctionnalités optionnelles utilisent les propres services
  hébergés d'Excalidraw.** Le bundle amont connecte la collaboration en direct
  (`oss-collab.excalidraw.com` et Firebase), "Exporter vers un lien" (`json.excalidraw.com`), les
  fonctionnalités IA texte-vers-diagramme et diagramme-vers-code (`oss-ai.excalidraw.com`) et
  le navigateur de bibliothèques de formes (`libraries.excalidraw.com`) aux serveurs
  d'Excalidraw, et non à quoi que ce soit dans votre projet. Rien n'est
  contacté lors d'un simple chargement de page — seulement lorsqu'un
  utilisateur invoque la fonctionnalité — et la collaboration est chiffrée de
  bout en bout, mais ce contenu quitte le projet. Les URL sont compilées dans
  le frontend au moment de la construction, donc ce module ne peut pas les
  rediriger ; l'auto-hébergement de la collaboration nécessiterait un build
  source plus un serveur `excalidraw-room`.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent la racine
  `/`, à laquelle nginx répond immédiatement avec `200`. Vérifiez depuis
  l'intérieur du cluster ou via l'IP du LoadBalancer :
  ```bash
  kubectl port-forward -n "$NAMESPACE" deploy/<service-name> 8080:80
  curl -sI http://localhost:8080/ | head -1        # expect: HTTP/1.1 200 OK
  ```
- **Les mises à niveau de version sont une reconstruction + un redéploiement.**
  Augmenter `application_version` reconstruit l'image à partir d'une nouvelle balise `excalidraw/excalidraw`
  et déploie de nouveaux pods ; comme il n'y a pas d'état, les mises à niveau
  et les retours arrière sont triviaux et non destructifs.
- **Variables d'environnement vestigiales.** `HOMESERVER_URL` / `HOMESERVER_NAME` sont injectées
  (héritage d'Element) mais ignorées par le SPA statique. Confirmez/inspectez
  l'environnement avec :
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep HOMESERVER
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Excalidraw sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec son comportement et ses valeurs par défaut
standards.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `excalidraw` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image Excalidraw. Contrairement à DokuWiki/EspoCRM, `latest` ne se résout **pas** en un tag épinglé connu et valide — le local `Excalidraw_Common` de `pinned_excalidraw_version` est lui-même `"latest"`, donc le build suit toujours le tag `excalidraw/excalidraw:latest` roulant de Docker Hub. Définissez un tag explicite (par exemple `v1.11.86`) pour épingler réellement une version de production. |
| `homeserver_url` / `homeserver_name` | `""` | Héritage d'Element, masqué du formulaire — ignoré par le SPA Excalidraw. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | Gardez `custom` — le build léger met en miroir l'image statique dans Artifact Registry. Avec `custom`, `container_image` est ignoré ; il n'est lu qu'avec `prebuilt`. |
| `container_port` | `80` | Port d'écoute nginx ; intégré à l'image — ne pas modifier. |
| `container_resources` | `cpu_limit=500m`, `memory_limit=512Mi` | Un serveur de fichiers statiques a besoin de peu ; la requête pilote la facturation Autopilot. |
| `min_instance_count` | `1` | Forcé à `1` par le wrapper — GKE n'a pas de mise à l'échelle à zéro ; maintient le tableau blanc accessible. |
| `max_instance_count` | `3` | Nombre maximal de réplicas ; sûr à augmenter puisque les pods sont sans état. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Excalidraw dans Artifact Registry. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Variables d'environnement supplémentaires en texte brut. Le SPA statique n'en lit aucune à l'exécution ; les remplacements sont rarement utiles. |
| `secret_environment_variables` | `{}` | Inutilisé — Excalidraw n'a pas besoin de secrets. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 6 — Backend et cluster GKE {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Expose une IP externe pour que le tableau blanc soit accessible par navigateur. |
| `workload_type` | `null` (se résout en `Deployment`) | Sans état — les pods sont interchangeables. Laissé `null`, App_GKE le résout en `Deployment` car `stateful_pvc_enabled` est également par défaut à `null`/`false` pour Excalidraw ; définir explicitement `stateful_pvc_enabled = true` résoudrait automatiquement cela en `StatefulSet` à la place (inutile pour Excalidraw). |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 7 — StatefulSet / Groupes 13-16 — NFS, Stockage, Redis, Base de données {#group-7--statefulset--groups-1316--nfs-storage-redis-database}

Ces groupes sont **inertes** pour Excalidraw : il n'y a pas de PVC par pod à
modéliser (`stateful_pvc_enabled` doit rester `false`), pas de NFS, pas de bucket GCS, pas de
Redis, et pas de base de données (`database_type = NONE`). Les laisser à leurs valeurs par
défaut ne provisionne aucune infrastructure inutilisée. Toutes les autres
entrées suivent le comportement standard d'App_GKE.

### Groupe 20 — Proxy conscient de l'identité (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Placez la connexion Google devant Excalidraw pour restreindre l'accès au tableau blanc. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder lorsque l'IAP est activé. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen
le plus rapide de localiser et d'explorer les ressources en cours
d'exécution. Les sorties de stockage/base de données/secrets sont présentes
pour la parité d'interface avec d'autres modules mais se résolvent en valeurs
vides ici.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Carte des ClusterIPs pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Excalidraw. |
| `storage_buckets` | Buckets Cloud Storage créés — vides pour Excalidraw. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` | Noms des jobs de configuration — vides pour Excalidraw. |
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
> valeurs *et les combinaisons* au moment de la planification — un port hors
> plage, un StatefulSet sans PVC, IAP sans identités autorisées, des valeurs de
> quota de mémoire sans suffixes d'unité binaire. Une configuration invalide
> fait échouer le **plan** avec une erreur claire et nommée avant la création
> de toute ressource.

| Paramètre | Valeur judicieuse | Risque | Conséquence si erroné |
|---|---|---|---|
| `container_port` | `80` | Élevé | Le nginx de l'image n'écoute que sur le port 80 ; un port non concordant signifie que la sonde de démarrage ne passe jamais et que le pod ne devient jamais prêt. |
| `container_image_source` | `custom` | Élevé | Passer à `prebuilt` sans image mise en miroir déclenche `build_and_push_application_image` sans Dockerfile / pointe vers un chemin non construit. |
| `min_instance_count` | N/A — codé en dur à `1` | Faible | `excalidraw.tf` remplace toujours la configuration par `min_instance_count = 1` quelle que soit la valeur de cette variable (il n'y a pas de garde au moment de la planification rejetant `0` — App_GKE lui-même autorise `0` pour les applications capables de mise à l'échelle à zéro). Définir cette variable à `0` n'a aucun effet et ne réduira pas les coûts ; un pod résident maintient le tableau blanc accessible en permanence. |
| `service_type` | `LoadBalancer` | Moyen | `ClusterIP` rend Excalidraw inaccessible depuis l'extérieur du cluster. |
| `application_version` | épingler en production | Moyen | `latest` flotte — un nouveau tag amont peut modifier l'interface utilisateur/le comportement lors de la prochaine reconstruction. Épinglez une version. |
| `stateful_pvc_enabled` / `enable_redis` / entrées de base de données | laisser par défaut (désactivé) | Faible | Les activer provisionne des PVC/Redis/Cloud SQL qu'Excalidraw n'utilise jamais — coût gaspillé, aucun avantage. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Moyen | Les entiers bruts sont traités comme des octets et bloquent toute planification de pod dans l'espace de noms (pertinent uniquement si vous activez les quotas de ressources). |
| `homeserver_url` / `homeserver_name` | laisser vide | Faible | Entrées vestigiales d'Element ; les définir n'a aucun effet sur le SPA Excalidraw. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud CDN, Cloud Armor,
IAP, Binary Authorization, VPC-SC et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à
Excalidraw partagée avec la variante Cloud Run est décrite dans
**[Excalidraw_Common](Excalidraw_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Excalidraw sur GKE Autopilot](../labs/Excalidraw_GKE.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [Excalidraw sur Google Cloud Run](Excalidraw_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Excalidraw Common — Configuration d'application partagée](Excalidraw_Common.md) — la configuration partagée par les deux cibles de déploiement.
