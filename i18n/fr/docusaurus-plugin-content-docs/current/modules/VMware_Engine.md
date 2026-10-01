---
title: "Google Cloud VMware Engine"
description: "Référence de configuration du module RAD VMware Engine sur Google Cloud — variables, architecture, réseau et exploitation au quotidien."
---

<!-- translated-from: docs/modules/VMware_Engine.md @ 944fee5 sha256:f3f635e8925b -->

# Google Cloud VMware Engine {#google-cloud-vmware-engine}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/VMware_Engine.png" alt="Google Cloud VMware Engine" style={{maxWidth: "100%", borderRadius: "8px"}} />

Google Cloud VMware Engine (GCVE) exécute la pile complète du Software-Defined Data Center de VMware — vSphere, vSAN, NSX-T et HCX — sur du matériel bare metal dédié et géré par Google. C'est la voie éprouvée en entreprise pour migrer tels quels (lift and shift) des charges de travail VMware existantes vers Google Cloud sans refactorisation : les mêmes outils vCenter, NSX-T et HCX que vous utilisez sur site fonctionnent sans modification, tandis que l'environnement bénéficie d'un accès natif aux services Google Cloud.

Il s'agit d'un module **autonome** — il ne s'appuie pas sur un socle partagé. Il provisionne un environnement GCVE de bout en bout en un seul déploiement : un réseau VMware Engine, un cloud privé (le SDDC lui-même), un appairage VPC VMware Engine vers un VPC Google Cloud, une règle de réseau pour l'accès à Internet et aux IP externes, des règles de pare-feu par défaut, ainsi qu'un hôte de rebond Windows Server 2022 permettant d'atteindre les consoles vCenter, NSX-T et HCX. Il réinitialise et expose également les identifiants du solution-user vCenter, afin que vous puissiez immédiatement enregistrer des outils de migration ou vous connecter.

Ce guide se concentre sur les services cloud qu'utilise le module et sur la manière de les explorer et de les exploiter depuis la Google Cloud Console et la ligne de commande.

---

## 1. Vue d'ensemble {#1-overview}

Le module associe VMware Engine à quelques ressources Compute et IAM complémentaires :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| SDDC VMware | Cloud privé VMware Engine | vCenter, vSAN, NSX-T et HCX sur des nœuds bare metal ; `TIME_LIMITED` (évaluation à 1 nœud) ou `STANDARD` (production à 3 nœuds ou plus) |
| Structure réseau gérée | Réseau VMware Engine | Global, de type `STANDARD` ; sert de support au cloud privé et transporte les routes d'appairage |
| Connectivité VPC | Appairage VPC VMware Engine | Relie le réseau VMware Engine à un VPC Google Cloud, avec import/export de routes personnalisées |
| Internet et IP externe | Règle de réseau VMware Engine | Contrôle l'accès Internet sortant et l'allocation d'IP publiques pour les VM de charge de travail via le CIDR des services de périphérie |
| Poste d'accès | Compute Engine (Windows Server 2022) | Hôte de rebond sur le VPC appairé pour accéder aux consoles de gestion par navigateur/RDP |
| Réseau appairé et pare-feu | VPC Compute Engine + règles de pare-feu | VPC en mode automatique avec les règles allow-internal/ssh/rdp/icmp/http |
| Accès à vCenter | Identifiants vCenter de VMware Engine | Réinitialisation et récupération du mot de passe du solution-user après le provisionnement |

**À savoir d'emblée :**

- **Le provisionnement est lent par nature.** Google doit allouer et configurer des serveurs bare metal avant l'installation du logiciel SDDC. Un cloud privé `TIME_LIMITED` à un seul nœud atteint généralement l'état `ACTIVE` en **30 à 90 minutes** ; les clouds privés `STANDARD` (3 nœuds ou plus) prennent plus de temps, jusqu'à environ **2 heures**. La ressource de cloud privé porte des délais d'expiration de 180 minutes pour la création, la mise à jour et la suppression : un provisionnement qui dépasse trois heures fait donc échouer l'apply sur expiration du délai au lieu de continuer à attendre. Le déploiement semble « bloqué » pendant cette période — c'est normal ; ne l'interrompez pas.
- **Un nœud VMware Engine coûte cher.** GCVE facture par nœud bare metal, et un seul nœud représente un coût horaire important. Utilisez `TIME_LIMITED` (un nœud) pour les labs et les démonstrations, et supprimez l'environnement rapidement une fois terminé.
- **Les consoles de gestion sont privées.** vCenter, NSX-T et HCX ne sont accessibles que depuis l'intérieur du réseau VMware Engine ou d'un VPC appairé — jamais directement depuis l'Internet public. L'hôte de rebond existe précisément pour combler cet écart.
- **Les identifiants vCenter sont réinitialisés, pas stockés.** Une fois le cloud privé à l'état `ACTIVE`, le module réinitialise le mot de passe du solution-user vCenter et affiche les nouveaux identifiants dans les journaux du déploiement. Ils ne sont **pas** exposés en tant que sortie Terraform — récupérez-les dans les journaux ou relancez la commande describe (voir §2.E).
- **Le CIDR de gestion est immuable.** `management_cidr` ne peut pas être modifié après la création du cloud privé. Choisissez-le avec soin pour qu'il ne chevauche ni le VPC appairé ni le CIDR des services de périphérie.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT`, `REGION` et `ZONE` sont définis et que vous êtes authentifié avec une identité disposant de `roles/owner` (ou des rôles d'administration VMware Engine + Compute). Les noms de ressources suivent le modèle `altostrat-<deployment-id>-*` ; les identifiants exacts figurent dans les [sorties](#5-outputs).

### A. Cloud privé VMware Engine {#a-vmware-engine-private-cloud}

Le cloud privé est le SDDC lui-même — vCenter, vSAN, NSX-T et HCX s'exécutant sur les nœuds bare metal du cluster de gestion. Il est créé dans une **zone** (`ZONE`), utilise le `management_cidr` immuable pour les appliances de gestion et exécute le type et le nombre de nœuds que vous sélectionnez.

- **Console :** VMware Engine → Resources → Private clouds → sélectionnez le cloud pour voir son état, le résumé vCenter/NSX-T/HCX, les clusters et les sous-réseaux.
- **CLI :**
  ```bash
  gcloud vmware private-clouds list --location "$ZONE" --project "$PROJECT"
  gcloud vmware private-clouds describe <private-cloud-name> \
    --location "$ZONE" --project "$PROJECT" \
    --format="yaml(state, vcenter, nsx, hcx, managementCluster)"
  # Wait for ACTIVE — provisioning can take 30 min to several hours:
  gcloud vmware private-clouds describe <private-cloud-name> \
    --location "$ZONE" --project "$PROJECT" --format="value(state)"
  ```

### B. Réseau VMware Engine et appairage VPC {#b-vmware-engine-network--vpc-peering}

Le **réseau VMware Engine** est une structure globale gérée par Google (distincte d'un VPC classique — il n'apparaît pas dans la console VPC) qui sous-tend le cloud privé. Le module l'appaire à un **VPC appairé** Google Cloud afin que l'hôte de rebond puisse atteindre les appliances de gestion et que les segments de charge de travail NSX-T soient annoncés en retour à Google Cloud. L'import et l'export de routes personnalisées sont activés, de sorte que les segments créés dans NSX-T se propagent automatiquement.

- **Console :** VMware Engine → Network → VMware Engine networks ; VMware Engine → Network → Peering. Le VPC appairé et ses routes apparaissent sous VPC network.
- **CLI :**
  ```bash
  gcloud vmware networks list --location global --project "$PROJECT"
  gcloud vmware network-peerings list --location global --project "$PROJECT" \
    --format="table(name, state)"
  # Routes exported from GCVE into the peer VPC:
  gcloud compute routes list --project "$PROJECT" \
    --format="table(name, network, destRange, priority)"
  ```

L'appairage n'atteint l'état `ACTIVE` qu'une fois le cloud privé entièrement provisionné — un état `CREATING`/`INACTIVE` pendant la période de provisionnement est normal.

### C. Règle de réseau VMware Engine {#c-vmware-engine-network-policy}

La règle de réseau détermine, au niveau du réseau, si les VM de charge de travail du cloud privé peuvent accéder à Internet et si NSX-T peut allouer des IP externes (publiques) pour le NAT. Les deux sont contrôlés via le **CIDR des services de périphérie** et sont activés par défaut. La règle est limitée à la **région** (`REGION`).

> GCVE n'autorise qu'**une seule** règle de réseau par réseau VMware Engine. Une règle résiduelle issue d'une exécution en échec bloque la recréation avec `Resource for the given network already exists` — listez et supprimez la règle orpheline, puis redéployez.

- **Console :** VMware Engine → Network → Network policies.
- **CLI :**
  ```bash
  gcloud vmware network-policies list --location "$REGION" --project "$PROJECT" \
    --format="table(name, internetAccess.enabled, externalIp.enabled, edgeServicesCidr)"
  # Remove an orphaned policy from a prior failed deploy:
  gcloud vmware network-policies delete <policy-name> \
    --location "$REGION" --project "$PROJECT" --quiet
  ```

### D. Hôte de rebond (Compute Engine) {#d-jump-host-compute-engine}

Une instance Windows Server 2022 sur le VPC appairé sert de poste de travail pour tout accès aux consoles. Elle porte le tag `jump-host`, reçoit une IP externe éphémère pour le RDP et se voit accorder le champ d'application `cloud-platform` afin que `gcloud` fonctionne depuis la session. Le RDP (3389), le SSH (22), le HTTP/HTTPS (80/443 vers les instances portant le tag `jump-host`), l'ICMP et le trafic interne sont ouverts par les règles de pare-feu par défaut.

- **Console :** Compute Engine → VM instances → sélectionnez l'hôte de rebond. Utilisez **Set Windows password** pour générer des identifiants Windows (le module ne les définit pas).
- **CLI :**
  ```bash
  gcloud compute instances list --filter="name~jump-host" --project "$PROJECT" \
    --format="table(name, zone, status, networkInterfaces[0].accessConfigs[0].natIP)"
  # Generate a Windows password for RDP:
  gcloud compute reset-windows-password <jump-host-name> \
    --zone "$ZONE" --project "$PROJECT"
  ```

Connectez-vous ensuite en RDP à `<external-ip>:3389` avec le nom d'utilisateur et le mot de passe générés. Sous macOS, utilisez **Windows App** (`brew install --cask windows-app`) ; sous Linux, utilisez `xfreerdp /u:<user> /p:<pass> /v:<ip>:3389 /dynamic-resolution`.

### E. Accès à vCenter {#e-vcenter-access}

vCenter, NSX-T et HCX exposent chacun un FQDN interne (indiqué dans les [sorties](#5-outputs)) accessible uniquement depuis l'hôte de rebond ou un autre hôte du VPC appairé. Pour vous connecter, il vous faut les identifiants du solution-user, que le module réinitialise et affiche dans les journaux du déploiement dès que le cloud privé est à l'état `ACTIVE`.

- **Console :** VMware Engine → Private clouds → sélectionnez le cloud → les liens de gestion vSphere / NSX-T / HCX et les vues des identifiants.
- **CLI :**
  ```bash
  # Retrieve current vCenter solution-user credentials:
  gcloud vmware private-clouds vcenter credentials describe \
    --private-cloud=<private-cloud-name> --username=<solution-user> \
    --location "$ZONE" --project "$PROJECT"
  # Reset them (re-run if they have expired):
  gcloud vmware private-clouds vcenter credentials reset \
    --private-cloud=<private-cloud-name> --username=<solution-user> \
    --location "$ZONE" --project "$PROJECT" --no-async
  # NSX-T credentials:
  gcloud vmware private-clouds nsx credentials describe \
    --private-cloud=<private-cloud-name> \
    --location "$ZONE" --project "$PROJECT"
  ```

Depuis le navigateur de l'hôte de rebond, ouvrez `https://<vcenter-fqdn>` (ou le FQDN NSX-T / HCX), acceptez le certificat autosigné et connectez-vous.

---

## 3. Comportement {#3-behaviour}

**Ce qui est provisionné lors de l'apply.** Dans l'ordre des dépendances : les API requises sont activées (`vmwareengine`, `vmmigration`, `compute`, `cloudresourcemanager`, `iam`, `iamcredentials`) ; l'agent de service VM Migration reçoit `roles/iam.serviceAccountUser` (afin que Migrate to Virtual Machines puisse agir en tant que comptes de service du projet) ; le réseau VMware Engine global est créé ; le cloud privé est provisionné (l'étape longue) ; le VPC appairé et ses règles de pare-feu sont créés ; l'appairage VPC est établi entre le réseau VMware Engine et le VPC appairé ; la règle de réseau est appliquée ; l'hôte de rebond Windows est déployé ; enfin, les identifiants vCenter sont réinitialisés et récupérés.

**Accéder à vCenter.** Générez un mot de passe Windows pour l'hôte de rebond, connectez-vous en RDP, puis ouvrez dans le navigateur les FQDN vCenter/NSX-T/HCX figurant dans les [sorties](#5-outputs). Utilisez les identifiants du solution-user issus des journaux du déploiement (ou relancez la commande describe du §2.E). Les consoles ne sont pas accessibles depuis l'extérieur du VPC appairé.

**Mise en place de l'appairage.** L'appairage est créé avec l'import et l'export de routes personnalisées activés : les segments NSX-T définis dans le cloud privé sont donc automatiquement annoncés au VPC appairé, et inversement. L'appairage dépend du cloud privé et ne devient pleinement `ACTIVE` qu'une fois le cloud opérationnel.

**La réinitialisation des identifiants est conditionnelle et idempotente.** La réinitialisation ne s'exécute qu'une fois que le cloud privé signale l'état `ACTIVE` ; s'il est encore en cours de provisionnement, l'étape est ignorée et des instructions indiquent comment effectuer la réinitialisation manuellement plus tard. La réinitialisation ne se relance que lorsque le cloud privé est recréé. Les identifiants sont affichés dans les journaux du déploiement, et non stockés en tant que sortie.

**Comportement lors du nettoyage.** La suppression détruit les ressources gérées dans le bon ordre — la règle de réseau et l'appairage sont supprimés avant le réseau VMware Engine, et le cloud privé est supprimé avec son délai d'expiration de 180 minutes. **La suppression d'un cloud privé est irréversible et détruit toutes les VM et toutes les données qu'il contient** ; migrez ou sauvegardez d'abord les charges de travail. La suppression est elle aussi lente (le déprovisionnement du bare metal prend du temps). L'activation des API est conservée lors de la destruction (`disable_on_destroy = false`) : les API VMware Engine et Compute du projet ne sont donc pas désactivées.

**Remarques sur l'exécution.** Les clouds privés `TIME_LIMITED` sont des environnements d'évaluation à un seul nœud — Google les récupère à la fin de la période d'évaluation, avec toutes leurs VM ; utilisez `STANDARD` pour tout ce qui doit perdurer. La disponibilité des types de nœuds dépend de la zone. Le `management_cidr` est fixé à la création ; le modifier impose de détruire et de recréer le cloud.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement.

### Groupe 1 — Projet et emplacement {#group-1--project--location}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible ; il doit déjà exister et l'identité qui déploie doit disposer de `roles/owner`. |
| `tenant_id` | `demo` | Identifiant de tenant (1 à 20 lettres minuscules, chiffres, traits d'union). Déclaré uniquement par cohérence avec la plateforme — ce module ne le référence dans aucun nom de ressource. |
| `region` | `us-west2` | Région du cloud privé et de la règle de réseau. |
| `zone` | `us-west2-a` | Zone du cloud privé et de l'hôte de rebond. Doit se trouver dans `region`. |

### Groupe 4 — Cloud privé {#group-4--private-cloud}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `management_cidr` | `172.20.1.0/24` | CIDR du cluster de gestion (vCenter, NSX-T, HCX, ESXi). **Immuable après la création.** Ne doit chevaucher ni le VPC appairé ni `edge_services_cidr`. |
| `private_cloud_type` | `TIME_LIMITED` | `TIME_LIMITED` (évaluation à un seul nœud, pour les labs/démonstrations) ou `STANDARD` (production, 3 nœuds au minimum). |
| `node_type_id` | `standard-72` | Type de nœud VMware Engine. Utilisez la forme courte de l'API (`standard-72`), et non le libellé de l'interface (`ve1-standard-72`). La disponibilité dépend de la zone. |
| `node_count` | `1` | Nombre de nœuds du cluster de gestion. Utilisez `1` pour `TIME_LIMITED` ; `STANDARD` en exige au moins `3`. |

### Groupe 5 — Appairage réseau {#group-5--network-peering}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_vpc` | `true` | Crée le VPC appairé. Définissez `false` pour réutiliser un VPC existant portant le nom attendu. |

### Groupe 6 — Règle de réseau {#group-6--network-policy}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `edge_services_cidr` | `10.11.3.0/26` | CIDR `/26` pour les services de périphérie VMware Engine (entrée/sortie Internet). Ne doit chevaucher ni `management_cidr` ni les sous-réseaux du VPC appairé. |
| `enable_internet_access` | `true` | Autorise l'accès Internet sortant des VM de charge de travail via le CIDR des services de périphérie. |
| `enable_external_ip` | `true` | Autorise l'allocation d'IP externes (publiques) aux VM de charge de travail. |

### Groupe 7 — Règles de pare-feu {#group-7--firewall-rules}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_default_firewall_rules` | `true` | Crée les quatre règles par défaut (allow-internal, allow-ssh, allow-rdp, allow-icmp) sur le VPC appairé. Définissez `false` si elles existent déjà. |
| `internal_traffic_cidr` | `10.128.0.0/9` | Plage source de la règle allow-internal. Correspond à la plage de sous-réseaux par défaut du mode automatique ; remplacez-la pour les VPC en mode personnalisé. |

### Groupe 8 — Hôte de rebond {#group-8--jump-host}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_jump_host` | `true` | Déploie l'hôte de rebond Windows Server 2022 pour l'accès RDP à vCenter/NSX-T/HCX. |
| `jump_host_machine_type` | `e2-medium` | Type de machine de l'hôte de rebond. |
| `jump_host_boot_disk_size_gb` | `50` | Taille du disque de démarrage en Go (50 Go minimum recommandés pour Windows Server 2022). |
| `jump_host_subnetwork` | `""` | Self-link ou nom du sous-réseau pour la carte réseau de l'hôte de rebond. Obligatoire pour les VPC en mode personnalisé ; laissez vide pour une sélection automatique par région. |

### Groupe 9 — Identifiants vCenter {#group-9--vcenter-credentials}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `reset_vcenter_credentials` | `true` | Réinitialise et récupère les identifiants du solution-user vCenter après le provisionnement. Nécessite `gcloud` dans l'exécuteur du déploiement. |
| `vcenter_solution_user` | `solution-user-01@gve.local` | Compte solution-user dont le mot de passe est réinitialisé. Sert à accéder à vCenter et à enregistrer les outils de migration. |

---

## 5. Sorties {#5-outputs}

| Sortie | Description |
|---|---|
| `deployment_id` | Suffixe de déploiement utilisé dans tous les noms de ressources `altostrat-<id>-*`. |
| `project_id` | Projet GCP dans lequel se trouvent les ressources. |
| `vmware_engine_network_id` | ID de ressource complet du réseau VMware Engine. |
| `private_cloud_id` | ID de ressource complet du cloud privé. |
| `vcenter_fqdn` | FQDN de vCenter Server — à ouvrir depuis le navigateur de l'hôte de rebond pour accéder au vSphere Client. |
| `nsx_fqdn` | FQDN de NSX-T Manager — à ouvrir depuis le navigateur de l'hôte de rebond pour accéder à la console NSX-T. |
| `hcx_fqdn` | FQDN de HCX Manager. |
| `network_peering_state` | État actuel de l'appairage VPC (`ACTIVE` une fois le cloud privé entièrement provisionné). |
| `network_policy_id` | ID de ressource complet de la règle de réseau VMware Engine. |

> Les identifiants du solution-user vCenter ne sont **pas** une sortie. Récupérez-les dans les journaux du déploiement ou avec `gcloud vmware private-clouds vcenter credentials describe` (voir §2.E).

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `private_cloud_type` + `node_count` | `TIME_LIMITED`+`1` ou `STANDARD`+`3` | Critical | Les combinaisons incohérentes sont rejetées par l'API : `TIME_LIMITED` exige exactement 1 nœud, `STANDARD` au moins 3. L'apply échoue après la longue tentative de provisionnement. |
| `private_cloud_type` | `TIME_LIMITED` pour les labs | High (coût) | Chaque nœud bare metal est facturé à un tarif horaire élevé. `STANDARD` avec 3 nœuds multiplie ce coût ; ne l'utilisez que pour les charges de travail qui doivent perdurer. |
| `management_cidr` | défini une seule fois, sans chevauchement | Critical | Immuable après la création. Un CIDR erroné ou qui se chevauche impose une destruction/recréation complète (plusieurs heures) et entraîne la perte de toutes les VM. |
| `edge_services_cidr` | `/26` sans chevauchement | High | Un chevauchement avec `management_cidr` ou les sous-réseaux du VPC appairé est rejeté à la création ; la règle de réseau ne peut pas être appliquée. |
| `node_type_id` | `standard-72` (forme de l'API) | High | Utiliser le libellé de l'interface `ve1-standard-72`, ou un type de nœud indisponible dans la zone cible, provoque une erreur bloquante de l'API lors de la création du cloud privé. |
| `region` / `zone` | zone située dans la région | High | Le cloud privé est créé dans `zone` et la règle de réseau dans `region` ; une paire incohérente fait échouer la création de la règle. |
| `deployment_id` | défini une seule fois | Critical | Le modifier après le déploiement renomme toutes les ressources — ce qui force la recréation du cloud privé (plusieurs heures) et détruit toutes les VM. |
| `reset_vcenter_credentials` | `true` (avec gcloud disponible) | Medium | Sans `gcloud` dans l'exécuteur, la réinitialisation est ignorée ; vous devez réinitialiser les identifiants manuellement avant de vous connecter à vCenter. |
| Identifiants vCenter | à récupérer rapidement dans les journaux | Medium | Ils sont affichés dans les journaux, et non stockés en tant que sortie, et le mot de passe du solution-user expire ; relancez la réinitialisation pour les actualiser. |
| Accès aux consoles | uniquement via l'hôte de rebond | Medium | Les FQDN vCenter/NSX-T/HCX se résolvent en IP privées accessibles uniquement depuis le VPC appairé. Un accès direct depuis un poste de travail expire. |
| `create_vpc = false` | uniquement avec un VPC existant correspondant | High | Les règles de pare-feu et l'appairage référencent le nom de VPC calculé `altostrat-<id>-vpc` ; si ce VPC n'existe pas, ces ressources échouent. |
| `enable_internet_access` / `enable_external_ip` | `false` pour les clouds isolés | Medium | Les deux valent `true` par défaut : les VM de charge de travail peuvent donc accéder à Internet et recevoir des IP publiques d'emblée ; désactivez-les pour un environnement totalement isolé. |
| Délai de suppression | prévoir du temps, sauvegarder d'abord | Critical | La suppression du cloud privé est irréversible et détruit toutes les VM/données, et le déprovisionnement du bare metal est lent — ne l'interrompez pas. |

---

Pour les concepts du service et des opérations plus approfondies, consultez la [documentation GCVE](https://cloud.google.com/vmware-engine/docs/overview) ainsi que le [guide de lab VMware Engine](https://docs.radmodules.dev/docs/labs/VMware_Engine) pratique.
