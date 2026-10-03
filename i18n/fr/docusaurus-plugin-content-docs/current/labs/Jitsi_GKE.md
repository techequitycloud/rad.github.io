---
title: "Jitsi sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Jitsi sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, opérations, observabilité et suppression."
---

<!-- translated-from: docs/labs/Jitsi_GKE.md @ 2829548 sha256:59efc1e90409 -->

# Jitsi sur GKE Autopilot — Guide de lab {#jitsi-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Jitsi_GKE)**

## Vue d'ensemble {#overview}

**Temps estimé :** 45 à 90 minutes

Jitsi Meet est un système de visioconférence open source basé sur un navigateur. Ce
lab vous guide à travers le cycle de vie opérationnel complet du module **Jitsi sur
GKE Autopilot** sur Google Cloud : déployez-le, accédez-y et vérifiez-le,
exécutez-le au quotidien, observez-le, diagnostiquez les problèmes courants et
supprimez-le.

Le lab se concentre sur l'exploitation du **module GKE et de la plateforme Google
Cloud**, et non sur les fonctionnalités du produit Jitsi. Pour la liste complète
des services provisionnés et de chaque entrée de configuration (organisée par
groupe), consultez le [Guide de configuration](https://docs.radmodules.dev/docs/modules/Jitsi_GKE)
— ce lab ne duplique délibérément pas ces détails afin qu'ils restent précis au
fil du temps.

Jitsi diffère de la plupart des modules de deux manières qui façonnent chaque
tâche ci-dessous : il s'exécute sous forme de **quatre** charges de travail (web,
prosody, jicofo et le pont vidéo jvb), et tout l'audio et la vidéo transitent par
le **port UDP 10000** vers un équilibreur de charge dédié sur une IP réservée. Il
n'y a pas de base de données.

## Objectifs {#objectives}

À la fin de ce lab, vous serez capable de :

- Déployer le module depuis la plateforme RAD et localiser les ressources qu'il
  provisionne.
- Vous connecter au cluster GKE et vérifier les quatre composants Jitsi.
- Confirmer que le pont vidéo annonce son adresse publique sur UDP 10000.
- Effectuer des opérations Day-2 — inspecter, mettre à l'échelle le niveau web,
  mettre à jour la version et gérer les secrets.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus
  courants.
- Supprimer proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, le serveur NFS et les
  comptes de service partagés dont ce module dépend). Vous n'avez pas besoin de le
  déployer vous-même au préalable — la plateforme détecte automatiquement s'il
  existe déjà dans le projet cible et le provisionne avant ce module si ce n'est
  pas le cas (voir Tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` complétés.
- Rôle **Propriétaire du projet** (ou équivalent) IAM sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement, la boîte de
  dialogue de confirmation du déploiement vous demande de prouver que vous le
  contrôlez (**Obtenir le code de vérification**, exécutez les commandes affichées
  en tant que Propriétaire du projet, puis **Vérifier**) et de donner le rôle
  **Propriétaire** au compte de service de déploiement RAD. Un projet créé par RAD
  pour vous n'a besoin de rien de tout cela.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création ne
  demande que la première page d'entrées (et, dans un projet créé par RAD pour
  vous, guère plus que le nom du locataire et la région). Toutes les autres
  entrées du Guide de configuration — y compris les entrées de mise à l'échelle et
  de version dans les tâches Day-2 — sont modifiées ultérieurement avec
  **Update** sur la page du déploiement après avoir coché **Enable advanced mode**,
  ce qui nécessite un solde de crédits couvrant le coût de build estimé de la
  mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un
  environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le
  projet.
- Un réseau qui autorise le **trafic UDP sortant vers le port 10000** pour les
  navigateurs avec lesquels vous testez. Certains réseaux d'entreprise le bloquent ;
  Jitsi n'a pas de repli TCP dans cette version.

Définissez ces variables shell une fois ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Catalogue de solutions → Modules RAD** dans la navigation
   supérieure de la plateforme RAD, ouvrez **Jitsi (GKE)** depuis la liste
   **Modules de plateforme** pour commencer la configuration, choisissez
   **Formulaire de configuration** sous *Comment souhaitez-vous configurer ce
   déploiement ?* (le formulaire s'ouvre sur l'**Assistant conversationnel** si
   vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur),
   définissez `project_id`, et examinez les entrées.
   Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Jitsi_GKE)
   documente chaque entrée par groupe, avec les valeurs par défaut. Si vous
   possédez déjà le domaine que les utilisateurs parcourront, définissez
   `public_url` (par exemple `https://meet.example.com`) et
   `application_domains` maintenant. Cliquez sur **Déployer le module**, examinez le coût
   estimé dans la boîte de dialogue **Confirmation de déploiement** lorsqu'elle
   apparaît et cliquez sur **Soumettre** (si la boîte de dialogue ajoute ensuite
   une étape de confirmation, comme la vérification d'un projet que vous
   apportez, complétez-la et cliquez sur **Confirmer**), ce qui ouvre la page
   d'état du déploiement avec des logs en temps réel.

2. La plateforme réserve une IP statique régionale pour le pont vidéo, génère les
   deux mots de passe XMPP internes dans Secret Manager, déploie les quatre
   charges de travail dans le cluster GKE Autopilot et publie le frontal web via
   une passerelle. Aucune image de conteneur n'est construite et aucune base de
   données n'est créée.

3. Connectez-vous au cluster et découvrez l'espace de noms avec des filtres
   agnostiques au nom :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep jitsi | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Confirmez que les quatre composants sont en cours d'exécution — la charge de
   travail web plus trois déploiements dont les noms se terminent par
   `-prosody`, `-jicofo` et `-jvb` :

   ```bash
   kubectl get deploy,pods -n "$NS"
   kubectl get svc -n "$NS"     # web, prosody and jicofo are ClusterIP; jvb is LoadBalancer (UDP)
   ```

2. Trouvez l'adresse publique du pont vidéo et confirmez qu'il utilise UDP 10000 :

   ```bash
   JVB_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "jvb IP: $JVB_IP"
   kubectl get svc -n "$NS" -o wide | grep -i udp
   gcloud compute addresses list --project="$PROJECT" --filter="name~jvb"
   ```

   L'adresse du Service doit correspondre à l'adresse `*-jvb` réservée.

3. Confirmez que le backend est connecté — jicofo s'est authentifié auprès de
   prosody et a trouvé le pont, et jvb annonce l'adresse publique :

   ```bash
   kubectl logs -n "$NS" deploy/$(kubectl get deploy -n "$NS" -o name | grep jicofo | cut -d/ -f2) \
     | grep -E "authenticated|addJvbAddress"
   kubectl logs -n "$NS" deploy/$(kubectl get deploy -n "$NS" -o name | grep jvb | cut -d/ -f2) \
     | grep StaticMapping      # expect ... mask=<the jvb IP>:9/udp
   ```

4. Trouvez l'URL web. Sur la page du déploiement dans la plateforme RAD, lisez la
   sortie `service_url` ; c'est l'URL `nip.io` de la passerelle, sauf si vous
   avez défini un domaine personnalisé. Vérifiez qu'elle sert la page Jitsi :

   ```bash
   SERVICE_URL="<service_url from the deployment outputs>"
   curl -s "$SERVICE_URL/" | grep -o "<title>[^<]*</title>"   # expect <title>Jitsi Meet</title>
   ```

5. Ouvrez l'URL dans un navigateur via **HTTPS** (les navigateurs n'autorisent la
   caméra et le microphone que sur des origines sécurisées), créez une salle et
   rejoignez-la depuis un deuxième appareil ou un navigateur sur un réseau
   différent. Si les deux participants apparaissent mais que ni l'un ni l'autre
   ne se voit ni ne s'entend, le trafic UDP 10000 vers l'IP jvb ne passe pas —
   voir Tâche 5.

---

## Tâche 3 — Opérer et maintenir en fonctionnement (Day-2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspecter les charges de travail** — déploiements, pods et (si plus d'une
   réplique web est autorisée) l'autoscaler horizontal :

   ```bash
   kubectl get deploy,pods,hpa -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Mettre à l'échelle le niveau web** en modifiant les entrées d'instances min/max
   et en cliquant sur **Update** sur la page des détails du déploiement — le module
   possède la spécification de la charge de travail, donc la mise à l'échelle est
   un changement de configuration, pas un `kubectl scale` manuel (une édition
   manuelle serait annulée lors du prochain apply). prosody, jicofo et jvb
   exécutent toujours une réplique chacun ; ces entrées n'ajoutent pas de capacité
   de pont vidéo.

3. **Mettre à jour la version de Jitsi** en modifiant `application_version` via **Update**.
   Les quatre images passent ensemble à la nouvelle étiquette, alors choisissez un
   `stable-NNNN` qui est publié pour web, prosody, jicofo et jvb.

4. **Gérer les secrets :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~jitsi"   # *-jicofo-auth, *-jvb-auth
   ```

   Ce sont des identifiants machine partagés par prosody et les composants qui
   s'y enregistrent. Ne les modifiez pas à la main : prosody et les composants
   doivent voir les mêmes valeurs.

5. **Modifier qui peut créer des salles** avec `enable_auth` et `enable_guests` via
   **Update**.

---

## Tâche 4 — Observer : Logging et Monitoring [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Logs** — depuis `kubectl` ou l'Explorateur de logs :

   ```bash
   for d in $(kubectl get deploy -n "$NS" -o name); do
     echo "== $d"; kubectl logs -n "$NS" "$d" --tail=20
   done
   ```

   Filtre de l'Explorateur de logs :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — ouvrez les tableaux de bord GKE / Kubernetes et examinez
   l'utilisation du CPU et de la mémoire des pods ainsi que le nombre de
   redémarrages, en accordant une attention particulière au pod jvb, qui gère
   tous les médias. Le module provisionne également un **test de disponibilité**
   (lorsqu'il est activé) ; examinez Monitoring → Tests de disponibilité et
   Alerting → Stratégies.

---

## Tâche 5 — Dépannage et débogage [Manuel] {#task-5--troubleshoot--debug-manual}

Techniques durables pour les modes de défaillance que vous êtes le plus
susceptible de rencontrer. Ce sont des diagnostics au niveau de la plateforme et
ils ne changent pas avec les versions de Jitsi.

- **Les participants rejoignent mais il n'y a pas d'audio ou de vidéo :** c'est la
  signature des deux défaillances ci-dessous. Confirmez d'abord que le Service jvb
  a une IP externe et que `StaticMapping` dans son log affiche cette IP. Vérifiez
  ensuite que le réseau client autorise le trafic UDP sortant vers le port 10000
  — il n'y a pas de repli TCP.
- **jvb ou jicofo refusé par prosody :** recherchez les erreurs d'authentification
  dans les logs de prosody, jicofo et jvb. Les deux mots de passe des composants
  proviennent des mêmes secrets Secret Manager ; s'ils ont été modifiés à la main,
  ils ne correspondent plus.
- **La page se charge mais ne peut pas se connecter :** vérifiez que
  `public_url` correspond à l'URL dans la barre d'adresse du navigateur.
- **Service jvb bloqué en `<pending>` :** vérifiez le quota d'adresses IP
  externes du projet (`IN_USE_ADDRESSES`) — laisser `service_type` à
  `ClusterIP` évite de dépenser une adresse supplémentaire pour le Service web.
- **Pod non prêt / CrashLoopBackOff :** inspectez les événements et les logs :
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/pull errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Erreurs de pull d'image :** confirmez que l'étiquette `application_version` existe
  pour les quatre images `jitsi/*`.

Consultez la section *Pièges de configuration* du Guide de configuration pour les
pièges spécifiques aux paramètres.

---

## Tâche 6 — Suppression [Automatisé] {#task-6--tear-down-automated}

Sur la page **Déploiements**, ouvrez le déploiement et cliquez sur l'icône
**Corbeille** (**Supprimer**). La suppression exécute `terraform destroy` et est
irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si
un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par
exemple après des modifications manuelles qui entrent en conflit avec l'état
Terraform), utilisez plutôt **Purger** (depuis la même boîte de dialogue
**Supprimer**) — cela supprime le déploiement des enregistrements de RAD
**sans** détruire les ressources cloud (cela fait oublier le déploiement à RAD).
La suppression supprime tout ce que le module a créé — les quatre charges de
travail Kubernetes et leurs Services, l'espace de noms, l'IP statique jvb, les
secrets Secret Manager et le bucket GCS. Les ressources appartenant à
**Services_GCP** (le VPC, le cluster GKE, le serveur NFS) sont gérées
séparément et ne sont pas supprimées ici.

---

## Résumé {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie web, prosody, jicofo et jvb, réserve l'IP jvb et crée les secrets des composants |
| 2 — Accéder et vérifier | Manuel | Les quatre composants sont en cours d'exécution ; jvb annonce son IP publique sur UDP 10000 ; le web sert Jitsi Meet |
| 3 — Opérer | Manuel | Inspecter les charges de travail, mettre à l'échelle le niveau web, mettre à jour la version, gérer les secrets et la politique des salles |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépannage | Manuel | Diagnostiquer les appels sans média, l'authentification des composants, l'URL, le quota, les problèmes de pod et de pull d'image |
| 6 — Suppression | Automatisé | La suppression (Corbeille) supprime toutes les ressources du module |
