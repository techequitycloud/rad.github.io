---
title: "Stalwart sur GKE Autopilot — Guide de Lab"
description: "Lab pratique : déployer Stalwart sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, opérations, observabilité et suppression."
---

<!-- translated-from: docs/labs/Stalwart_GKE.md @ 2829548 sha256:b4fea72c814e -->

# Stalwart sur GKE Autopilot — Guide de Lab {#stalwart-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Stalwart_GKE)**

## Vue d'ensemble {#overview}

**Temps estimé :** 60 à 90 minutes

Stalwart est un serveur de messagerie open source qui gère SMTP, IMAP, POP3, JMAP et
ManageSieve à partir d'un seul binaire. Ce lab vous guide à travers le cycle de vie opérationnel complet du module **Stalwart sur GKE Autopilot** sur Google Cloud : déployer,
accéder et vérifier, exécuter au quotidien, observer, diagnostiquer les problèmes courants et
supprimer.

Le lab se concentre sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non
sur les fonctionnalités du produit Stalwart ou sur l'exécution d'un domaine de messagerie de production. Pour la
liste complète des services provisionnés et de chaque entrée de configuration (organisée par
groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Stalwart_GKE) — ce
lab ne duplique délibérément pas ces détails afin qu'ils restent exacts au fil du temps.

> **Ce que ce lab peut et ne peut pas montrer.** Il vérifie que Stalwart démarre avec
> Cloud SQL et que les ports de messagerie sont publiés sur l'équilibreur de charge. Il ne peut
> pas montrer le flux de courrier : cela nécessite un vrai domaine avec MX et DNS inverse, et Google
> Cloud bloque le port 25 **sortant** de chaque VM et pod, donc l'envoi vers d'autres
> domaines nécessite un relais smart-host sur le port 587.

## Objectifs {#objectives}

À la fin de ce lab, vous serez capable de :

- Déployer le module depuis la plateforme RAD et localiser les ressources qu'il provisionne.
- Vous connecter au cluster GKE et vérifier la charge de travail et ses sept ports publiés.
- Effectuer les opérations de jour 2 — inspecter, mettre à l'échelle, mettre à jour et gérer les secrets et le stockage.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Supprimer le déploiement proprement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Cloud SQL pour MySQL,
  Artifact Registry et les comptes de service partagés dont dépend ce module). Vous n'avez
  pas besoin de le déployer vous-même au préalable — la plateforme détecte automatiquement
  s'il existe déjà dans le projet cible et le provisionne avant ce
  module si ce n'est pas le cas (voir Tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` terminés.
- Rôle **Propriétaire du projet** (ou équivalent) IAM sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Obtenir le code de vérification**, exécutez les commandes qu'elle affiche en tant que Propriétaire du projet, puis **Vérifier**) et de donner au compte de service de déploiement RAD le rôle **Propriétaire**. Un projet créé par RAD pour vous n'a besoin de rien de tout cela.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page d'entrées (et, dans un projet créé par RAD pour vous, guère plus que le nom du locataire et la région). Toute autre entrée du Guide de configuration — y compris les entrées de mise à l'échelle et de version dans les tâches de jour 2 — est modifiée ultérieurement avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui nécessite un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.
- **`openssl`** et **`nc`** (netcat) sur votre poste de travail, pour les vérifications de port de la Tâche 2.

Définissez ces variables shell une fois ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. **(Recommandé) Créez d'abord le secret de l'administrateur.** L'administrateur de bootstrap de Stalwart
   est lu à partir de `STALWART_RECOVERY_ADMIN` comme `username:password`.
   Sans cela, Stalwart imprime un mot de passe aléatoire dans le journal du conteneur une seule fois.

   ```bash
   printf 'admin:%s' "$(openssl rand -base64 24)" | \
     gcloud secrets create stalwart-recovery-admin --data-file=- --project="$PROJECT"
   ```

   Vous mapperez ce secret dans le déploiement à l'étape 2 (l'entrée se trouve dans le
   groupe *Variables d'environnement et secrets* ; si elle n'est pas sur le formulaire de création, ajoutez-la
   ensuite avec **Update** en mode avancé).

2. Ouvrez **Solutions → Catalogue de solutions → Modules RAD** dans la navigation supérieure de la plateforme RAD, ouvrez **Stalwart (GKE)** depuis la liste **Modules de plateforme** pour commencer la configuration, choisissez **Formulaire de configuration** sous *Comment souhaitez-vous configurer ce déploiement ?* (le formulaire s'ouvre sur l'**Assistant conversationnel** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id`, et examinez les entrées.
   Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Stalwart_GKE)
   documente chaque entrée par groupe, avec les valeurs par défaut. Recommandé pour ce module :
   `secret_environment_variables = { STALWART_RECOVERY_ADMIN = "stalwart-recovery-admin" }`,
   `max_instance_count = 1` et `application_display_name = "Stalwart Mail Server"`.
   Cliquez sur **Déployer le module**, examinez le coût estimé dans la boîte de dialogue **Confirmation de déploiement** lorsqu'elle apparaît et cliquez sur **Soumettre** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, complétez-la et cliquez sur **Confirmer**), ce qui ouvre la page d'état du déploiement avec des journaux en temps réel.

3. La plateforme construit l'image wrapper, réserve une IP statique régionale, crée
   la base de données et l'utilisateur Stalwart dans Cloud SQL (MySQL 8.0) avec son secret de mot de passe,
   et déploie un StatefulSet à réplica unique avec un PVC de 10 GiB à
   `/var/lib/stalwart`, derrière un service `LoadBalancer` qui publie les ports 443, 25,
   465, 587, 993, 995 et 4190. Il n'y a pas de job d'initialisation d'application — Stalwart crée
   ses propres tables lors de la première connexion. Les premiers déploiements prennent environ **20 à 35 minutes**.

4. Connectez-vous au cluster et découvrez l'espace de noms avec des filtres agnostiques au nom :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep stalwart | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all,pvc -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Confirmez que le pod est en cours d'exécution et lisez les lignes de démarrage écrites par le point d'entrée —
   elles nomment la cible DataStore et indiquent si un administrateur a été fourni :

   ```bash
   POD=$(kubectl get pods -n "$NS" -o jsonpath='{.items[0].metadata.name}')
   kubectl get pod -n "$NS" "$POD"
   kubectl logs -n "$NS" "$POD" | grep '\[startup\]'
   # [startup] DataStore=MySql 10.x.x.x:3306/... as ... (password via env DB_PASSWORD, not in the file)
   # [startup] recovery_admin=<set>
   ```

   Si vous n'avez pas défini `STALWART_RECOVERY_ADMIN`, le mot de passe administrateur aléatoire
   est imprimé dans ce journal lors du premier démarrage — copiez-le maintenant.

2. Vérifiez l'état de santé depuis l'intérieur du pod. Le port 443 doit répondre ; le port 8080 répondant
   signifie que Stalwart est toujours sur sa surface de bootstrap/récupération (attendu jusqu'à ce que la
   configuration du serveur soit appliquée — voir l'étape 4) :

   ```bash
   kubectl exec -n "$NS" "$POD" -- curl -sk -o /dev/null -w '443:  %{http_code}\n' https://127.0.0.1:443/healthz/live
   kubectl exec -n "$NS" "$POD" -- curl -s  -o /dev/null -w '8080: %{http_code}\n' http://127.0.0.1:8080/healthz/live
   ```

3. Trouvez l'IP externe et confirmez chaque port publié :

   ```bash
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   kubectl get svc -n "$NS" -o jsonpath='{range .items[*].spec.ports[*]}{.name}{"\t"}{.port}{"\n"}{end}'

   for p in 25 443 465 587 993 995 4190; do nc -z -w 3 "$EXTERNAL_IP" "$p" && echo "$p open" || echo "$p closed"; done

   # ManageSieve answers in plain text with Stalwart's own banner:
   nc -w 3 "$EXTERNAL_IP" 4190 | head -3
   ```

   Le port 25 peut apparaître comme fermé **depuis votre poste de travail** si votre propre réseau bloque
   le port 25 sortant — il s'agit d'une restriction côté client, et non du déploiement.

4. **Connaître l'état actuel.** Le module ne configure que le DataStore de Stalwart.
   Les domaines, les écouteurs et TLS sont stockés dans la base de données et sont appliqués avec
   `stalwart-cli` (une image distincte, `ghcr.io/stalwartlabs/cli`) contre un vrai domaine de messagerie
   — le module ne le fait pas. Tant que ce n'est pas fait, le port 8080 reste ouvert dans
   le pod, et les connexions HTTPS à `$EXTERNAL_IP` depuis l'extérieur du VPC peuvent être
   fermées sans certificat même si la vérification in-pod sur 443 renvoie 200.
   C'est l'état attendu d'un nouveau déploiement, pas un défaut.

---

## Tâche 3 — Opérer et maintenir en fonctionnement (Jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspecter la charge de travail** — StatefulSet, pod, PVC, et (seulement si
   `max_instance_count > 1`) l'autoscaler et le budget de perturbation :

   ```bash
   kubectl get statefulset,pods,pvc,hpa,pdb -n "$NS"
   kubectl describe statefulset -n "$NS"
   ```

2. **Maintenez un seul réplica.** Si `hpa` apparaît ci-dessus, définissez `max_instance_count = 1`
   via **Update** sur la page des détails du déploiement — un deuxième réplica nécessite le
   coordinateur Redis de Stalwart, que ce module ne configure pas. La mise à l'échelle est un
   changement de configuration, pas un `kubectl scale` manuel (une modification manuelle serait
   annulée lors du prochain apply).

3. **Mettez à jour la version de l'application** en changeant `application_version` pour une autre
   version exacte de Stalwart (par exemple `v0.16.x`) via **Update** ; une nouvelle image est construite et le
   StatefulSet déploie le pod. Si vous reconstruisez sous la **même** étiquette, redéployez le pod
   vous-même pour que la nouvelle image soit tirée :

   ```bash
   kubectl rollout restart statefulset -n "$NS" "$(kubectl get statefulset -n "$NS" -o jsonpath='{.items[0].metadata.name}')"
   ```

4. **Confirmez l'IP statique** vers laquelle les enregistrements MX et DNS doivent pointer :

   ```bash
   gcloud compute addresses list --project="$PROJECT" --filter="name~stalwart" \
     --format="table(name,address,region,status)"
   ```

5. **Gérer les secrets, le stockage et les jobs :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~stalwart"
   kubectl get secrets,jobs,cronjobs -n "$NS"     # db-create, backup CronJob
   ```

6. **Ouvrez une session de base de données** pour inspection (Stalwart possède ses tables — regardez,
   ne modifiez pas) :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. stalwartdemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^stalwart" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : Journalisation et Surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — Stalwart journalise vers stdout (la journalisation de fichiers n'est pas activée), donc tout
   se trouve dans `kubectl logs` et Cloud Logging :

   ```bash
   kubectl logs -n "$NS" "$POD" --tail=50
   ```

   Filtre de l'Explorateur de journaux :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation du CPU et de la mémoire du pod,
   les nombres de redémarrages et l'utilisation du PVC. La vérification de disponibilité du module est
   désactivée par défaut (elle sonderait le HTTP simple par rapport au HTTPS uniquement de Stalwart
   sur le port 443) ; examinez Alerting → Policies pour toute politique que vous avez configurée.

---

## Tâche 5 — Dépannage et débogage [Manuel] {#task-5--troubleshoot--debug-manual}

Techniques durables pour les modes de défaillance que vous êtes le plus susceptible de rencontrer. Ce sont
des diagnostics au niveau de la plateforme et ne changent pas avec les versions de Stalwart.

- **Pod non prêt / CrashLoopBackOff :** inspectez les événements et les journaux :
  ```bash
  kubectl describe pod -n "$NS" "$POD"          # Events: scheduling, probe, PVC mount errors
  kubectl logs -n "$NS" "$POD" --previous       # logs from the crashed container
  ```
  Une ligne `FATAL: DB_IP is empty or unset` (ou `DB_NAME` / `DB_USER` / `DB_PASSWORD`)
  signifie que la fondation n'a pas injecté les paramètres de la base de données — le point d'entrée
  refuse de démarrer plutôt que de revenir à la surface de bootstrap 8080.
- **La sonde de démarrage continue d'échouer :** la sonde est TCP sur 443, qui ne se lie que lorsque
  Stalwart démarre normalement. Vérifiez le journal pour une erreur de connexion DataStore et
  confirmez que l'instance Cloud SQL est `RUNNABLE`. Ne la "réparez" **pas** en pointant la
  sonde sur 8080 — ce port répond précisément lorsque Stalwart n'a pas réussi à démarrer.
- **Le pod est prêt mais le port 8080 répond toujours :** le DataStore est connecté mais aucune
  configuration de serveur (domaines, écouteurs, TLS) n'a été appliquée — voir Tâche 2,
  étape 4. Aucune sonde ne peut détecter cela ; c'est une vérification de l'opérateur.
- **Erreurs de connexion à la base de données après avoir changé `database_password_length` :** le
  nouveau mot de passe a atteint Secret Manager mais pas l'utilisateur Cloud SQL. Évitez de le changer
  sur un déploiement en cours d'exécution.
- **Pod en attente / pas d'IP externe :** vérifiez les événements `kubectl describe pod` pour
  les problèmes de ressources ou de quota, et confirmez que le projet dispose d'une IP externe régionale libre
  pour l'adresse réservée.
- **Le courrier sortant n'arrive jamais ailleurs :** Google Cloud bloque le port 25 sortant.
  Configurez Stalwart pour relayer via un smart host sur le port 587.
- **Erreurs de tirage d'image :** confirmez que l'image existe dans Artifact Registry et que le compte
  de service du nœud peut la tirer.

Consultez la section *Pièges de configuration* du Guide de configuration pour les pièges spécifiques aux paramètres.

---

## Tâche 6 — Suppression [Automatisé] {#task-6--tear-down-automated}

Sur la page **Déploiements**, ouvrez le déploiement et cliquez sur l'icône **Corbeille** (**Supprimer**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles qui entrent en conflit avec l'état Terraform), utilisez plutôt **Purger** (depuis la même boîte de dialogue **Supprimer**) — cela supprime le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (cela fait oublier le déploiement à RAD). La suppression supprime tout ce que le module a créé — la charge de travail Kubernetes,
le service et l'espace de noms, l'IP statique réservée, la base de données et l'utilisateur Stalwart,
le secret du mot de passe de la base de données, les buckets GCS et les images Artifact Registry. Les ressources
appartenant à **Services_GCP** (le VPC, le cluster GKE, l'instance Cloud SQL partagée,
le registre) sont gérées séparément et ne sont pas supprimées ici. Le
secret `stalwart-recovery-admin` que vous avez créé à la main dans la Tâche 1 n'est pas géré par
le module — supprimez-le vous-même :

```bash
gcloud secrets delete stalwart-recovery-admin --project="$PROJECT"
```

---

## Résumé {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Image wrapper, IP statique, base de données Cloud SQL (MySQL 8.0), StatefulSet à réplica unique avec PVC, LoadBalancer avec 443 + six ports de messagerie |
| 2 — Accéder et vérifier | Manuel | Le journal de démarrage affiche le DataStore ; 443 sain dans le pod ; les sept ports accessibles ; bannière ManageSieve ; état 8080 compris |
| 3 — Opérer | Manuel | Inspecter la charge de travail, maintenir un réplica, mettre à jour la version, confirmer l'IP statique, gérer les secrets/jobs, accès à la base de données |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques GKE et les politiques d'alerte |
| 5 — Dépannage | Manuel | Diagnostiquer les problèmes de crash, de sonde, d'état de bootstrap, de base de données, d'IP et de courrier sortant |
| 6 — Suppression | Automatisé | La suppression (Corbeille) supprime toutes les ressources du module ; supprimer le secret d'administrateur créé à la main |
