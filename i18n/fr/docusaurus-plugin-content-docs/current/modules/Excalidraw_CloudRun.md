---
title: "Excalidraw sur Google Cloud Run"
description: "Référence de configuration pour le déploiement d'Excalidraw sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Excalidraw_CloudRun.md @ 1665a43e sha256:5a6b8489c1a6 -->

# Excalidraw sur Google Cloud Run {#excalidraw-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Excalidraw_CloudRun.png" alt="Excalidraw sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Excalidraw est un tableau blanc virtuel open source (MIT) pour esquisser des
diagrammes, des wireframes et des dessins collaboratifs rapides de style
dessiné à la main. La distribution auto-hébergée est une **application
statique d'une seule page servie par nginx** — il n'y a pas de backend, de
base de données ou de comptes utilisateur, et les dessins sont stockés dans le
propre navigateur du visiteur. Ce module déploie ce frontend statique sur
**Cloud Run v2** au-dessus de la fondation
[App_CloudRun](App_CloudRun.md), qui provisionne et gère
l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'Excalidraw utilise et sur la
façon de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à chaque application Cloud Run
— identité de service, ingress et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls et le cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## Ce que coûte Excalidraw sur RAD, et comment cela se compare {#what-excalidraw-costs-on-rad-and-how-that-compares}

**Dans un projet Google Cloud que vous possédez, Excalidraw sur le module Cloud Run de RAD coûte environ 17 $ US par mois, plus 4 $ US une fois par déploiement et aucune licence par utilisateur.** GKE Autopilot est l'alternative pour les charges de travail qui doivent rester actives en continu ou s'exécuter à côté d'autres applications Kubernetes ; voir le [guide GKE](Excalidraw_GKE.md), environ 24 $ US par mois. Excalidraw est un tableau blanc statique et open source pour les diagrammes de style dessinés à la main, sans base de données, Redis ou stockage persistant propre. Les chiffres sont valables au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

Si cela s'exécute dans un projet géré par RAD pour vous, il peut être supprimé et restauré dans les 30 jours pour quelques crédits au lieu de rester en fonctionnement — ainsi, un déploiement à usage occasionnel coûte quelques dollars par mois, et non 17 $ US. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 40 crédits (4 $ US au prix de la recharge) | 36 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût de fonctionnement Google Cloud | Facturé par Google à votre propre compte de facturation, environ **17 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **3 crédits par jour**, environ 90 par mois (environ 9 $ US au prix de la recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge ponctuelle, et moins avec un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par chaque application du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût de fonctionnement par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Cloud Run, 1 vCPU / 0,5 GiB, mise à l'échelle à zéro | 11 $ US |
| Passerelle et adresse IP Cloud NAT | 5 $ US |
| Cloud Storage pour les sauvegardes | 1 $ US |
| **Total** | **environ 17 $ US** |

### Comment cela se compare {#how-it-compares}

Nous n'avons pas trouvé de plan commercial géré/SaaS spécifiquement pour Excalidraw au 8 octobre 2026, donc la comparaison honnête est avec l'exécution par vous-même :

| Option | Par mois | Qui l'exécute |
|---|---|---|
| Hetzner CPX22 (2 vCPU/4 Go) | ~24 $ US | Vous : OS, mises à jour, sauvegardes, correctifs de sécurité |
| DigitalOcean 2 vCPU/4 Go Droplet | 24 $ US | Vous : OS, mises à jour, sauvegardes, correctifs de sécurité |
| GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) | ~49 $ US | Vous : OS, mises à jour, sauvegardes, correctifs de sécurité |
| **RAD, Cloud Run, votre propre projet** | **17 $ US**, plus 4 $ US une fois | L'automatisation de RAD, dans votre projet |
| RAD, GKE Autopilot | environ 24 $ US ; voir le [guide GKE Autopilot](Excalidraw_GKE.md) | RAD |

L'empreinte propre d'Excalidraw ici (1 vCPU / 0,5 GiB) est plus légère que cette boîte de référence, donc un niveau plus petit et moins cher des mêmes fournisseurs l'exécuterait également confortablement.

- **RAD n'est généralement pas moins cher en espèces qu'un VPS nu — la différence est ce qui est géré pour vous.** Le prix d'un VPS n'inclut pas le temps de l'administrateur pour les sauvegardes, les correctifs de sécurité et les mises à niveau du système d'exploitation ; le Cloud SQL géré par RAD (lorsque cette application utilise une base de données), Secret Manager et la surveillance couvrent cela à la place.
- **Excalidraw est un tableau blanc statique et open source pour les diagrammes de style dessinés à la main, sans base de données, Redis ou stockage persistant propre.** Cela détermine quelle colonne est importante : un fonctionnement prévisible et sans intervention est plus précieux pour la plupart des équipes utilisant ce type d'outil que de réduire de quelques dollars la facture mensuelle.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Excalidraw s'exécute dans **un projet géré par RAD pour vous**, vous avez une option au-delà de la mise à l'échelle : **supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour presque rien.** Cela convient bien mieux à un déploiement dont vous n'avez besoin qu'occasionnellement — pour étudier en vue d'une certification, une démo, un besoin saisonnier — que de le faire fonctionner en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le projet. Google ne le supprime pas immédiatement : il le conserve, récupérable, pendant 30 jours, et comme la facturation est déjà déliée, rien n'est facturé pendant cette attente. Contrairement à la suppression d'un module, cela ne démantèle pas Cloud Run un par un — l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet peut le restaurer. RAD demande à Google de récupérer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter **Mettre à jour** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela coûte une poignée de crédits de temps de build au total (moins de 1 $ US) pour une chaîne typique de 2 à 3 déploiements.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, pas 17 $ US.** Déployez Excalidraw, utilisez-le pour une session, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Mettre à jour, et supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez que les frais de module une fois, les builds, et les heures où il était réellement en ligne.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un projet que vous apportez et dont RAD ne gère que la facturation), et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime définitivement. La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude/démo conviennent). Google indique que la plupart des services sont de nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Cloud Run se met déjà à l'échelle à zéro entre les requêtes, de sorte que la majeure partie de son propre coût de calcul s'arrête d'elle-même lorsque personne ne l'utilise. L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ 45 crédits (4,50 $ US). La suppression permet d'économiser de l'argent si Excalidraw restait inutilisé pendant environ 9 jours ou plus dans votre propre projet (environ 0,56 $ US par jour), ou environ 14 jours ou plus dans un projet géré par RAD (3 crédits par jour).
- **Notez vos paramètres.** RAD ne recrée pas un déploiement supprimé pour vous ; vous saisissez à nouveau les paramètres lors du déploiement.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant dispose d'Excalidraw dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais propres à RAD et estimation des crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour le mécanisme de pause/restauration. Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Excalidraw s'exécute comme un seul conteneur nginx sans état sur Cloud Run v2.
Comme l'application n'a pas de backend, le déploiement ne relie qu'un ensemble
minimal de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Conteneur nginx statique sur le **port 80**, 1 vCPU / 512 MiB par défaut, autoscaling sans serveur ; mise à l'échelle à zéro activée |
| Image de conteneur | Artifact Registry | Build personnalisé léger `FROM excalidraw/excalidraw`, mis en miroir dans le registre du projet |
| Base de données | _Aucune_ | Excalidraw n'a pas de backend — aucune instance Cloud SQL n'est créée |
| Stockage d'objets | _Aucun_ | Aucun bucket GCS n'est provisionné ; les dessins vivent dans le navigateur |
| Cache et file d'attente | _Aucun_ | Pas de Redis, pas de file d'attente de messages |
| Secrets | _Aucun_ | Pas de clés de chiffrement, de secrets JWT ou de mots de passe de base de données — Secret Manager est inutilisé |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL par défaut `run.app` ; équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Entièrement sans état — aucune donnée n'est stockée côté serveur.** Les
  dessins persistent dans le stockage local de chaque navigateur et sont
  exportés/importés sous forme de fichiers `.excalidraw`. Les redéploiements, la mise à
  l'échelle à zéro et les changements de révision ne perdent **aucune** donnée
  serveur car il n'y en a pas.
- **La mise à l'échelle à zéro est forcée.** L'enveloppe fixe `min_instance_count = 0` ; il n'y a
  pas de travail en arrière-plan pour maintenir une instance chaude, donc les
  déploiements inactifs ne coûtent rien. Les démarrages à froid sont rapides
  (nginx servant un bundle statique) — généralement en moins d'une seconde.
- **Facturation basée sur les requêtes par défaut.** `cpu_always_allocated = false` : le CPU n'est
  facturé que pendant qu'une requête est servie, ce qui est approprié pour un
  serveur de fichiers statiques sans travail en arrière-plan en cours.
- **Port fixe 80.** L'écouteur nginx est intégré à l'image ; `container_port` est par
  défaut à 80 et ne doit pas être modifié.
- **Pas de Cloud SQL, Secret Manager, Redis ou GCS.** Les fonctionnalités de
  fondation correspondantes sont inertes pour cette application — les activer
  provisionne une infrastructure inutilisée.
- **Ingress public par défaut.** `ingress_settings = "all"` pour que le tableau blanc soit
  accessible depuis un navigateur. Protégez-le avec IAP ou Cloud Armor si vous
  devez restreindre l'accès.
- **Entrées héritées `homeserver_url` / `homeserver_name`.** Reportées du modèle Element et toujours
  injectées comme `HOMESERVER_URL` / `HOMESERVER_NAME`, que le SPA statique ignore. Elles sont
  masquées du formulaire de déploiement.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de
services et de ressources sont rapportés dans les [Sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service Excalidraw {#a-cloud-run--the-excalidraw-service}

Excalidraw s'exécute comme un service Cloud Run v2 qui s'adapte
automatiquement à la charge des requêtes entre le nombre minimum (`0`) et
maximum d'instances. Chaque déploiement crée une révision immuable ; le
trafic peut être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le
  trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~excalidraw"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  # Confirm the listening port and image on the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].ports[0].containerPort, spec.template.spec.containers[0].image)'
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la
concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Artifact Registry — l'image de conteneur {#b-artifact-registry--the-container-image}

L'image Excalidraw est un build personnalisé léger `FROM excalidraw/excalidraw` que Cloud Build
produit et pousse dans l'Artifact Registry du projet (`enable_image_mirroring
= true`). Aucun pull
Docker Hub n'est nécessaire à l'exécution.

- **Console :** Artifact Registry → Dépôts.
- **CLI :**
  ```bash
  gcloud artifacts repositories list --project "$PROJECT" --location "$REGION"
  gcloud artifacts docker images list <repo-path> --include-tags
  # Cloud Build history for the image build:
  gcloud builds list --project "$PROJECT" --region "$REGION" --limit 5
  ```

### C. Base de données, Secret Manager, Cloud Storage, Redis — non utilisés {#c-database-secret-manager-cloud-storage-redis--not-used}

Excalidraw ne provisionne **aucun** de ces éléments. Il n'y a pas d'instance
Cloud SQL, pas de secret Secret Manager, pas de bucket GCS et pas de Redis
pour ce déploiement. Les commandes suivantes renverront des résultats vides
pour l'application — c'est normal :

```bash
gcloud sql instances list --project "$PROJECT" --filter="name~excalidraw"   # (none)
gcloud secrets list --project "$PROJECT" --filter="name~excalidraw"          # (none)
gcloud storage buckets list --project "$PROJECT" --filter="name~excalidraw"  # (none)
```

La collaboration en direct fonctionne, mais via le propre serveur de salle
hébergé d'Excalidraw (`oss-collab.excalidraw.com`, chiffré de bout en bout), et non un service dans
votre projet — voir les valeurs par défaut ci-dessus. L'hébergement de la
collaboration vous-même nécessiterait un build source du frontend et un
serveur `excalidraw-room` séparé, que ce module ne déploie **pas**.

### D. Réseau et ingress {#d-networking--ingress}

Le service est accessible à son URL `run.app` par défaut. Un équilibreur de charge
HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peuvent
être superposés ; les paramètres d'ingress et de sortie VPC contrôlent la
connectivité. Comme la charge utile est constituée d'actifs statiques, Cloud
CDN est particulièrement adapté pour réduire la latence et les coûts.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les journaux de conteneur (accès/erreur nginx) sont envoyés à Cloud Logging ;
les métriques Cloud Run sont envoyées à Cloud Monitoring, avec des tests de
disponibilité et des stratégies d'alerte facultatifs. Un test de disponibilité
public sur le chemin racine est un signal de santé naturel pour le frontend
statique.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Excalidraw {#3-excalidraw-application-behaviour}

- **Pas de configuration au premier déploiement.** Il n'y a pas de base de
  données, pas de job d'initialisation et pas de migrations. Le service est
  prêt dès que nginx commence à servir le bundle statique — généralement en une
  ou deux secondes après l'activation de la révision.
- **Pas de comptes, pas de connexion, pas de persistance côté serveur.** Le
  frontend auto-hébergé n'a pas d'authentification et ne stocke rien côté
  serveur. Les dessins de chaque utilisateur vivent dans le **stockage local de
  leur propre navigateur** ; l'effacement des données du navigateur entraîne la
  perte des dessins locaux. Utilisez **Exporter** (`.excalidraw`, PNG ou SVG) pour
  enregistrer ou partager le travail.
- **Certaines fonctionnalités optionnelles utilisent les propres services
  hébergés d'Excalidraw.** Le bundle amont connecte la collaboration en direct
  (`oss-collab.excalidraw.com` et Firebase), "Exporter vers un lien" (`json.excalidraw.com`), les
  fonctionnalités IA texte-vers-diagramme et diagramme-vers-code (`oss-ai.excalidraw.com`) et
  le navigateur de bibliothèques de formes (`libraries.excalidraw.com`) aux serveurs d'Excalidraw,
  et non à quoi que ce soit dans votre projet. Rien n'est contacté lors d'un
  simple chargement de page — seulement lorsqu'un utilisateur invoque la
  fonctionnalité — et la collaboration est chiffrée de bout en bout, mais ce
  contenu quitte le projet. Les URL sont compilées dans le frontend au moment
  du build, donc ce module ne peut pas les rediriger ; l'auto-hébergement de la
  collaboration nécessiterait un build source plus un serveur `excalidraw-room`.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent la racine
  `/`, à laquelle nginx répond immédiatement avec `200`. Vérifiez depuis un
  navigateur ou :
  ```bash
  SERVICE_URL=$(gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" --format='value(status.url)')
  curl -sI "$SERVICE_URL/" | head -1          # expect: HTTP/2 200
  ```
- **Les mises à niveau de version sont un rebuild + redéploiement.** Mettre à
  jour `application_version` reconstruit l'image à partir d'une nouvelle balise `excalidraw/excalidraw` et
  déploie une nouvelle révision ; comme il n'y a pas d'état, les mises à niveau
  et les retours arrière sont triviaux et non destructifs.
- **Variables d'environnement vestigiales.** `HOMESERVER_URL` / `HOMESERVER_NAME` sont injectées
  (héritage d'Element) mais ignorées par le SPA statique. Les définir n'a
  aucun effet.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Excalidraw sont listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `excalidraw` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image Excalidraw. Contrairement à certains modules frères, `latest` ne se résout **pas** en un tag connu et épinglé — le local `Excalidraw_Common` de `pinned_excalidraw_version` est lui-même `"latest"`, donc le build suit le tag `excalidraw/excalidraw:latest` roulant de Docker Hub. Épinglez une version spécifique (par exemple `v1.11.86`) en production. |
| `homeserver_url` / `homeserver_name` | `""` | Héritage de l'élément Legacy, masqué du formulaire — ignoré par le SPA Excalidraw. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | Gardez `custom` — le build léger met en miroir l'image statique dans Artifact Registry. Avec `custom`, `container_image` est ignoré ; il n'est lu qu'avec `prebuilt`. |
| `cpu_limit` | `1000m` | CPU par instance ; un serveur de fichiers statiques en a peu besoin. |
| `memory_limit` | `512Mi` | Mémoire par instance. Gen2 impose un plancher de 512 MiB ; le bundle statique utilise beaucoup moins. |
| `cpu_always_allocated` | `false` | Facturation basée sur les requêtes — correct pour un serveur statique sans travail en arrière-plan. |
| `container_port` | `80` | Port d'écoute nginx ; intégré à l'image — ne pas modifier. |
| `min_instance_count` | `0` | Forcé à `0` par l'enveloppe — mise à l'échelle à zéro, aucune instance chaude n'est nécessaire. |
| `max_instance_count` | `3` | Plafond de coût/concurrence. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Excalidraw dans Artifact Registry. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Variables d'environnement supplémentaires en texte brut. Le SPA statique n'en lit aucune à l'exécution ; les remplacements sont rarement utiles. |
| `secret_environment_variables` | `{}` | Inutilisé — Excalidraw n'a pas besoin de secrets. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 5 — Accès et contrôle d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Accès public pour que le tableau blanc soit accessible par navigateur. |
| `enable_iap` | `false` | Placez la connexion Google devant Excalidraw pour restreindre l'accès. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupes 10-21 — Stockage, base de données, Redis {#groups-1021--storage-database-redis}

Ces groupes sont **inertes** pour Excalidraw : il n'y a pas de base de données
(`database_type = NONE`), pas de bucket GCS et pas de Redis. Laisser `enable_nfs`, `enable_redis`, `create_cloud_storage` et
les entrées de la base de données à leurs valeurs par défaut ne provisionne
aucune infrastructure inutilisée. Toutes les autres entrées suivent le
comportement standard d'App_CloudRun.

---

## 5. Sorties {#5-outputs}

Retournées lors d'un déploiement réussi — le moyen le plus rapide de localiser
et d'explorer les ressources en cours d'exécution. Les sorties de stockage/base
de données/secrets sont présentes pour la parité d'interface avec d'autres
modules mais se résolvent en valeurs vides ici.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | Détails du service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `storage_buckets` | Buckets Cloud Storage créés — vides pour Excalidraw. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration — vides pour Excalidraw. |
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

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration au moteur de fondation [App_CloudRun](App_CloudRun.md), qui
> valide les valeurs *et les combinaisons* au moment de la planification — un
> port hors plage, un runtime `gen1` avec des montages NFS/GCS, IAP sans
> identités autorisées. Une configuration invalide échoue la **planification**
> avec une erreur claire et nommée avant la création de toute ressource.

| Paramètre | Valeur judicieuse | Risque | Conséquence si erroné |
|---|---|---|---|
| `container_port` | `80` | Élevé | Le nginx de l'image n'écoute que sur le port 80 ; un port non concordant signifie que la sonde de démarrage ne passe jamais et que la révision ne sert jamais. |
| `container_image_source` | `custom` | Élevé | Passer à `prebuilt` sans image mise en miroir pointe le service vers un chemin Artifact Registry non construit (`Image not found`). |
| `memory_limit` | `512Mi` | Moyen | Gen2 rejette `< 512Mi` à l'apply ; le bundle statique n'en a pas besoin de plus. |
| `ingress_settings` | `all` | Moyen | `internal` rend le tableau blanc inaccessible depuis un navigateur en dehors du VPC. |
| `application_version` | épingler en production | Moyen | `latest` flotte — un nouveau tag amont peut modifier l'interface utilisateur/le comportement lors du prochain rebuild. Épinglez une version. |
| `enable_redis` / entrées de base de données | laisser par défaut | Faible | Les activer provisionne Redis/Cloud SQL qu'Excalidraw n'utilise jamais — coût gaspillé, aucun avantage. |
| `homeserver_url` / `homeserver_name` | laisser vide | Faible | Entrées Element vestigiales ; les définir n'a aucun effet sur le SPA Excalidraw. |
| `min_instance_count` | `0` | Faible | La mise à l'échelle à zéro est idéale ici ; forcer `> 0` n'ajoute que des coûts d'inactivité sans état à maintenir chaud. |

---

Pour le comportement de la fondation référencé tout au long — identité de
service, mise à l'échelle et concurrence, ingress et équilibrage de charge,
CI/CD, Cloud CDN, Cloud Armor, IAP, Binary Authorization, VPC-SC et mise en
miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration
d'application spécifique à Excalidraw partagée avec la variante GKE est
décrite dans **[Excalidraw_Common](Excalidraw_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Excalidraw sur Cloud Run](../labs/Excalidraw_CloudRun.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [Excalidraw sur GKE Autopilot](Excalidraw_GKE.md) — la même application sur Kubernetes, pour lorsque vous avez besoin de l'autre cible de déploiement.
- [Excalidraw Common — Configuration d'application partagée](Excalidraw_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Penpot sur Google Cloud Run](Penpot_CloudRun.md), [AFFiNE sur Google Cloud Run](Affine_CloudRun.md) dans la solution **Conception et collaboration visuelle**.
