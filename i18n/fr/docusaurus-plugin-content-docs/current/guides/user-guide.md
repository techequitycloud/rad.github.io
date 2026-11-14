---
title: "Guide de l'utilisateur"
description: "Guide de l'utilisateur de la plateforme RAD — créer une solution à partir d'une simple description, déployer des modules et des solutions sur Google Cloud, gérer vos déploiements, et crédits et abonnements."
---

<!-- translated-from: docs/guides/user-guide.md @ f38ac9d2 sha256:3e9d54efc241 -->

# Guide de l'utilisateur {#user-guide}

<img src="https://storage.googleapis.com/rad-public-2b65/guides/User_Guide.png" alt="Guide de l'utilisateur" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ce guide s'adresse à toute personne utilisant RAD pour déployer et gérer des modules cloud — le rôle **Utilisateur** par défaut. Nouveau sur RAD ? Commencez par [Utiliser RAD](using-rad.md).

## Ce que vous pouvez faire {#what-you-can-do}

- Répondez à quatre questions simples sur **Construire une solution avec l'IA** et laissez RAD déterminer les applications dont vous avez besoin, le coût total, et les déployer.
- Parcourez le catalogue de modules sur **Solutions → Catalogue de solutions → Modules RAD** et déployez des modules prêts à l'emploi via un formulaire guidé.
- Suivez et gérez vos propres **Déploiements** — consultez les résultats et les logs, mettez à jour et supprimez.
- Gérez les **Crédits** — vérifiez votre solde, consultez l'historique de vos transactions et achetez-en davantage tant que la plateforme vend des crédits.
- Abonnez-vous à un plan de crédits récurrent, lorsque des plans sont proposés.
- Estimez vos économies avec **Calculer le ROI**, sur la page **Crédits**.
- Obtenez de l'aide via le formulaire **Envoyer un message** sur **Aide**.
- Invitez d'autres personnes avec votre lien de parrainage, depuis **Profil → Parrainer et gagner**.
- Demandez à RAD de payer Google pour un projet Google Cloud que vous possédez déjà, depuis **Crédits → Projets liés**. Voir [Projets liés](#linked-projects).
- Exécutez des projets pour vos propres clients (le démarrage d'un projet nécessite des crédits achetés), ou acceptez-en un que quelqu'un exécute pour vous, sur **Solutions → Environnements gérés**. Voir [Projets clients](#client-projects).

Après vous être connecté, vous arrivez sur **Solutions** : sur **Construire une solution avec l'IA** si vous avez acheté des crédits (un abonnement ou une recharge), ce qui le débloque, sinon sur **Catalogue de solutions → Modules RAD**. Les onglets sont, dans l'ordre : **Construire une solution avec l'IA**, **Catalogue de solutions**, puis **Environnements gérés**, qui contient les projets clients (tant que la plateforme les propose), les sessions de lab pour les formateurs, les finances et les administrateurs (tant qu'elles sont activées), et tout ce que quelqu'un d'autre exécute pour vous.

**Solutions** contient tout ce que vous pouvez déployer, sur deux onglets :

- **Construire une solution avec l'IA** — quatre questions qui aboutissent à une solution fonctionnelle et tarifée. Commencez ici si vous savez ce que vous voulez réaliser mais pas comment cela s'appelle.
- **Catalogue de solutions** — tout ce qui est prêt à être déployé, avec un filtre de type en haut et un bouton **Nouvelle solution** à côté qui ouvre **Construire une solution avec l'IA** :
  - **Tout** — toutes les catégories sur une seule page, chacune sous son propre titre ; une catégorie sans rien à montrer est omise.
  - **Mes solutions** — les bundles que vous avez composés vous-même.
  - **Solutions RAD** — bundles prêts à l'emploi sélectionnés par RAD.
  - **Modules RAD** — le catalogue complet des applications individuelles.

Votre navigation supérieure affiche **Crédits** (lorsque les crédits sont activés), **Déploiements**, **Solutions**, **Tarification** et **Aide**, avec un bouton **Demander à l'IA** et un sélecteur de langue (anglais ou français) à côté de votre menu de profil. **Demander à l'IA** ouvre un assistant auquel vous pouvez poser des questions en langage clair sur les modules, la tarification et les déploiements ; ouvert sur la page d'un déploiement, il sait de quel module il s'agit et son statut (jamais vos paramètres ou secrets), vous pouvez donc poser des questions directement à son sujet. Il répond à partir de ces guides et se termine par un lien vers la section qu'il a utilisée, afin que vous puissiez la lire en entier ; lorsque les guides ne couvrent pas une question, il le dit plutôt que de deviner. Il est disponible avec des crédits achetés ou un rôle de personnel et est limité à un certain nombre de questions au fil du temps. Ses réponses peuvent être erronées, alors vérifiez tout ce qui est important, et la conversation recommence à chaque fois que vous l'ouvrez.

## Construire une solution à partir d'une description {#building-a-solution-from-a-description}

**Construire une solution avec l'IA** et composer vos propres solutions nécessitent des **crédits achetés** (une recharge ou un abonnement ; les crédits d'inscription gratuite, mensuels et de parrainage ne comptent pas). Les partenaires en ont toujours. Sans crédits achetés, vous voyez toujours les deux, verrouillés, avec une note sur ce qui les débloque et un bouton **Acheter des crédits** tant que la plateforme vend des crédits, et toutes les solutions que vous avez déjà enregistrées restent listées : vous pouvez toujours les déployer ou les supprimer, mais pas les modifier. Le déploiement pour un projet client que vous gérez est l'exception : le portefeuille du client paie, donc cela fonctionne quel que soit votre propre solde.

Sur **Solutions → Construire une solution avec l'IA** — également accessible directement à **/build** — décrivez ce que vous voulez que les gens puissent faire, avec vos propres mots, sans avoir besoin de noms d'applications. RAD détermine quelles applications le fournissent, puis pose trois courtes questions :

1. **Où doit-il s'exécuter ?** Votre propre projet Google Cloud est la valeur par défaut : vous conservez la relation de facturation, les politiques de votre organisation et le projet lui-même par la suite. Choisir un **projet géré par RAD** place l'infrastructure au sein de l'organisation et du compte de facturation de RAD, et vous indiquez alors également à quoi sert l'environnement — pour essayer des choses, pour vos développeurs ou pour vos utilisateurs finaux. Un projet géré par RAD vous demande également de détenir un solde minimum de crédits achetés, que la page indique. Il s'agit d'une exigence de solde, pas d'un prélèvement.
2. **Où doit-il résider ?** Choisissez l'emplacement le plus proche des personnes qui l'utiliseront. Votre propre projet peut utiliser n'importe quelle région Google Cloud ; un projet géré par RAD offre les emplacements pris en charge par RAD — les moins chers dans chaque partie du monde. RAD vérifie cela à nouveau lorsque vous déployez : un emplacement en dehors de cette liste, dans n'importe quel paramètre d'emplacement (y compris un qui prend plusieurs emplacements), est refusé avant que quoi que ce soit ne soit réservé ou construit, et le message nomme le paramètre à modifier.
3. **Comment devons-nous l'appeler ?** Un nom pour votre propre référence, plus un nom court (jusqu'à sept lettres ou chiffres) utilisé dans vos ressources cloud. Réutilisez ce nom court plus tard pour partager les mêmes ressources cloud.

Si les applications proposées par RAD ne conviennent pas tout à fait, utilisez **Pas tout à fait ? Dites-nous ce qu'il faut changer** en dessous — dites ce qu'il faut ajouter ou supprimer, et RAD retravaille l'ensemble au lieu de repartir de zéro. Vous pouvez également supprimer une seule application, ou **Recommencer** pour effacer vos réponses et la proposition ensemble.

Un panneau à côté des questions montre **ce que vous obtiendrez**, **ce que cela coûte** et **combien de temps cela prend** — le coût total, y compris les services partagés que RAD ajoute pour vous, avec ce qui est réservé lorsque vous construisez, ainsi qu'une estimation de la durée de la build telle que "environ 1h 20m". **Construire ceci** l'enregistre sous **Mes solutions** et ouvre sa page de déploiement avec vos réponses déjà remplies ; examinez-la là et choisissez **Déployer la solution**. **Afficher les détails techniques** l'enregistre de la même manière mais l'ouvre sur le formulaire de configuration complet, si vous préférez tout configurer vous-même.

### Apporter votre propre projet Google Cloud {#bringing-your-own-google-cloud-project}

Le déploiement dans un projet que vous possédez déjà signifie que le compte de service de déploiement de RAD effectue le travail à l'intérieur, il a donc besoin d'un accès au préalable. Avant tout déploiement, vous prouvez que vous contrôlez le projet : choisissez **Obtenir le code de vérification**, exécutez les commandes affichées en tant que Propriétaire du projet (par exemple dans Cloud Shell) — elles ajoutent une étiquette de vérification et donnent à RAD un accès **Navigateur** en lecture seule — puis choisissez **Vérifier** ; le code expire en une heure. Vous accordez ensuite au compte de service de déploiement le rôle de **Propriétaire** sur le projet ; RAD nomme le compte exact et affiche la commande. Si un autre compte RAD a déjà enregistré le même projet, vous y êtes ajouté en tant que collaborateur. Les crédits gratuits (offerts) peuvent payer un déploiement dans votre propre projet.

**Connectez-le avant de commencer.** Si vous n'avez pas acheté de crédits, votre propre projet est l'endroit où vos déploiements vont, donc la connexion ouvre sur **Connecter votre projet Google Cloud** jusqu'à ce que vous en ayez connecté un. Entrez l'ID du projet et RAD exécute les mêmes vérifications que lors du déploiement — l'étiquette de vérification, le rôle de Propriétaire pour le compte de service de déploiement et la facturation activée — et montre comment corriger tout ce qui manque, y compris un lien pour configurer la facturation. Un projet connecté ici ne se voit pas demander une nouvelle étiquette lors du déploiement. **Passer pour l'instant** va directement au catalogue pour le reste de votre visite, et la page est toujours à `/connect`.

Chaque déploiement et mise à jour dans un projet que vous possédez commence par une vérification rapide, avant que quoi que ce soit ne soit modifié : que le projet existe et est actif, que la facturation y est activée et que le compte de service de déploiement de RAD peut activer les services Google Cloud dont le module a besoin. Si l'une de ces vérifications échoue, la build s'arrête immédiatement et **Statut de la build** indique quelle vérification a échoué et comment la corriger, généralement avec la commande exacte à exécuter. La vérification est ignorée lorsque le déploiement crée le projet lui-même, et elle ne bloque jamais un déploiement simplement parce qu'elle n'a pas pu obtenir de réponse.

### Ce dont un projet géré par RAD a besoin {#what-a-rad-managed-project-needs}

Un projet géré par RAD demande deux choses avant que RAD ne puisse le créer : une **adresse e-mail vérifiée** et un solde minimum de crédits **achetés** pour l'objectif que vous avez choisi. Les crédits gratuits (offerts) — tels que ceux que vous recevez lors de votre inscription — ne comptent pas pour ce minimum. La page indique le nombre de crédits achetés que vous avez par rapport à ce qui est nécessaire, avec un lien **Acheter des crédits**, dès que vous choisissez l'option. L'en-tête affiche votre solde divisé en crédits achetés et gratuits pour la même raison.

### Choisir un objectif : sandbox, développement ou production {#choosing-a-purpose-sandbox-development-or-production}

Un projet géré par RAD est créé dans un **objectif**, et vous pouvez en avoir un de chaque :

- **Sandbox** — *Pour essayer des choses.* Le plus petit budget et le solde de crédits achetés le plus bas pour commencer.
- **Développement** — *Pour nos développeurs.* Un budget plus important et un solde de crédits achetés plus élevé requis.
- **Production** — *Pour nos utilisateurs finaux.* Le plus grand budget et le solde de crédits achetés le plus élevé requis.

L'objectif détermine trois choses : dans quel dossier de RAD le projet se trouve (et donc quelles politiques d'organisation Google Cloud s'y appliquent), l'**alerte budgétaire** mensuelle sur le projet, et le **solde minimum de crédits achetés** que vous devez détenir pour le créer et le maintenir en fonctionnement. Cela ne modifie **pas** le coût d'un déploiement — la même application coûte les mêmes crédits dans un sandbox que dans un environnement de production. L'alerte budgétaire ne fait que notifier ; elle n'arrête jamais rien. Dans un projet géré par RAD, vous ne pouvez déployer que dans la région la moins chère de chacune des huit zones géographiques, et le sélecteur de région ne propose que celles-ci.

### Services partagés (Services_GCP) et leur coût {#shared-services-services_gcp-and-what-they-cost}

La première application que vous déployez dans un projet géré par RAD crée également ses **services partagés** (le déploiement **Services_GCP**) : le réseau privé sur lequel vos applications s'exécutent et, lorsqu'une application en a besoin, sa base de données et d'autres composants partagés. Ils sont créés **une seule fois par projet** ; chaque application ultérieure dans ce projet s'y attache sans frais supplémentaires.

Ce que coûtent les services partagés :

- **Lorsque RAD les crée sous une application :** rien de plus — ils sont inclus dans le prix de l'application. La boîte de dialogue de confirmation les liste toujours sous *"RAD configure également ceux-ci pour vous"*, afin que vous puissiez voir ce qui est construit. Déployés **seuls**, les Services_GCP coûtent un forfait de 20 crédits.
- **Lorsqu'ils sont mis à jour** — par exemple, RAD ajoute une base de données dont une nouvelle application a besoin — comme toute autre mise à jour : gratuit jusqu'à l'allocation mensuelle (voir **Crédits**).
- **Lorsqu'ils sont supprimés :** gratuit. Si la suppression échoue en raison d'un délai Google connu, RAD la réessaie pour vous ; voir **Suppression des services partagés** ci-dessous.

### Utilisation de Google Cloud dans un projet géré par RAD {#google-cloud-usage-in-a-rad-managed-project}

Ce qui s'exécute dans un projet géré par RAD — services Cloud Run, bases de données, stockage — utilise Google Cloud, et RAD paie Google pour cela. Cette utilisation est débitée de vos crédits **achetés** tels que Google les rapporte, et **Crédits** > **Transactions du projet** l'affiche par projet. Si votre solde acheté, moins l'utilisation non encore facturée, tombe en dessous du minimum pour l'objectif du projet — ou si vous devez des crédits — RAD désactive la facturation du projet : ses services s'arrêtent, mais vos données sont conservées. L'achat de crédits la réactive.

## Trouver un module {#finding-a-module}

Ouvrez **Solutions**, choisissez l'onglet **Catalogue de solutions** et sélectionnez **Modules RAD** dans le filtre de type pour parcourir le catalogue de modules. Les modules apparaissent sous forme de cartes.

- **Parcourir :** Vous voyez un catalogue combiné unique de modules publics — à la fois les modules publiés par RAD et les modules publics publiés par les partenaires.
- **Rechercher :** La barre de recherche au-dessus des onglets recherche dans tout le **Catalogue de solutions** — vos propres solutions, les solutions RAD et les modules RAD. Chaque mot que vous tapez doit correspondre ; une correspondance dans le nom est classée en premier, puis les correspondances trouvées dans une description ou dans ce qu'une solution contient. Votre recherche reste en place lorsque vous basculez entre les types, et les décomptes sur **Mes solutions** et **Solutions RAD** indiquent le nombre de correspondances que chacun contient.
- **Filtrer par catégorie :** Utilisez la liste de catégories à côté de la grille pour affiner le catalogue à une seule catégorie. Elle apparaît lorsqu'un seul type (**Solutions RAD** ou **Modules RAD**) est sélectionné, et est masquée sur **Tout**, car les solutions et les modules utilisent des catégories différentes. Chaque entrée indique le nombre de modules qu'elle contient ; **Tout** efface le filtre.
- **Parcourir les pages :** **Tout** affiche quatre éléments de chaque type par page ; un seul type en affiche davantage (24 modules RAD ou solutions RAD, 12 de vos propres solutions). Modifiez le nombre par page, jusqu'à 72, sous la liste.
- **Épingler :** Cliquez sur l'épingle d'une carte pour conserver un module favori en haut de votre catalogue pour un accès rapide.
- **Lire chaque carte :** Chaque carte affiche la description du module, un lien vers la **documentation**, une note moyenne en étoiles, le nombre de fois où il a été déployé et son **prix**.
- **Lire le prix :** Chaque carte de catalogue — module, solution de plateforme ou solution personnalisée — affiche son prix de la même manière : les **frais**, facturés une seule fois, lorsque le déploiement réussit pour la première fois — par exemple `50 cr fee`. Le temps de build est inclus dans le prix. Un module sans frais indique **Module gratuit**. Une solution qui bénéficie d'une remise groupée l'affiche : les frais avant la remise sont barrés à côté des frais que vous payez. Un déploiement dans un projet géré par RAD peut également configurer un projet et des services partagés en premier ; ce coût est affiché avant le déploiement.
- **Obtenir de l'aide sur un module :** Cliquez sur **Aide** sur une carte pour ouvrir la boîte de dialogue Obtenir de l'aide. Elle comporte trois onglets : **Support utilisateur final** ouvre un ticket de support concernant le module, **Formation utilisateur final** demande une aide payante pour le configurer (RAD vous contacte dans un délai d'un jour ouvrable), et **Contacter l'éditeur** envoie un e-mail à l'éditeur du module avec une question.

Une bande de statistiques en haut affiche le nombre total de déploiements, votre solde de crédits actuel (lorsque les crédits sont activés) et la durée de conservation de l'historique des déploiements.

## Déployer un module {#deploying-a-module}

1. **Choisissez comment le configurer.** Cliquez sur une carte de module et choisissez **Assistant conversationnel** ou **Formulaire de configuration**. L'assistant est la valeur par défaut si vous avez acheté des crédits (les partenaires en ont toujours) ; sans eux, vous obtenez le formulaire, et l'assistant est affiché mais verrouillé jusqu'à ce que vous achetiez des crédits. En arrivant de **Construire une solution avec l'IA**, une solution s'ouvre sur le formulaire, puisque l'entretien vient de poser ses questions. L'assistant décrit chaque paramètre en une seule fois, puis n'applique que les modifications que vous acceptez — chaque modification proposée est affichée pour que vous l'appliquiez individuellement, de sorte que rien n'est défini sans votre accord. Vous pouvez basculer entre les deux à tout moment. Deux choses que l'assistant ne fera pas : il ne voit ni ne définit jamais un **secret** (une clé API ou un mot de passe) — il vous dit que le champ existe et vous tapez la valeur dans la boîte en surbrillance sur la page, jamais dans le chat — et il n'acceptera pas une valeur qui enfreint la règle d'un champ, vous disant quelle est la règle et demandant une valeur corrigée plutôt que de modifier discrètement ce que vous avez tapé. De même, lorsque le déploiement se fait dans un projet géré par RAD, il refuse une région que ce projet ne peut pas utiliser, et vous indique les régions autorisées.
2. **Ouvrez le formulaire.** Le formulaire de configuration guidée. La première fois que vous déployez un module, le formulaire n'affiche que les champs essentiels (obligatoires) — les champs administratifs et internes vous sont masqués, et la configuration avancée facultative est différée. Vous pouvez déverrouiller l'ensemble complet des étapes de configuration plus tard, à partir de l'action **Mettre à jour** du déploiement : cochez **Activer le mode avancé**, qui est disponible une fois que votre solde de crédits couvre le coût estimé de la mise à jour. Le mode avancé n'entraîne pas de frais de module — les mises à jour n'en entraînent jamais — et n'est pas disponible dans un environnement de lab.
3. **Remplissez la configuration.** Remplissez les champs obligatoires à chaque étape (par exemple, projet et région). Passez à l'étape suivante lorsque chaque étape est valide. Le formulaire est généré à partir du module lui-même, donc lorsque le module déclare une règle pour un champ — un modèle de nommage, une limite de longueur — vous voyez l'erreur propre à ce module au fur et à mesure que vous tapez, plutôt que plusieurs minutes après une build échouée. Les champs contenant un secret (un jeton API, un mot de passe) sont masqués et stockés dans Google Secret Manager plutôt que d'être enregistrés avec le reste de votre configuration ; comme la valeur ne revient jamais au navigateur, un tel champ affiche **Configuré** ou **Non configuré** à la place, et laisser un champ configuré vide le conserve plutôt que de l'effacer. Un champ qui prend une liste ou une carte doit en contenir une : une carte tapée sous forme de texte est lue comme du JSON, une carte vide utilise la valeur par défaut du module, et tout le reste est refusé lors du déploiement ou de la mise à jour, en nommant le champ, plutôt que d'échouer en cours de build. La plupart des modules d'application construisent leur propre image de conteneur : tant que **Source de l'image de conteneur** est "personnalisée", une note sous **Image de conteneur** indique que ce champ est ignoré. Choisissez "pré-construite" pour déployer l'image que vous entrez à la place.
4. **Confirmer.** Le panneau **Ce qui sera déployé** en haut du formulaire liste tout ce que ce déploiement construit — dans un projet géré par RAD, cela inclut le projet Google Cloud et les services partagés — avec le coût de chacun (un qui existe déjà est réutilisé, **Gratuit, réutilisé**), et marque tout ce qui **Sera mis à jour en premier** ou **Nécessite une attention particulière en premier** ; vous ne pouvez pas déployer tant que quelque chose nécessite une attention particulière. Avant le lancement, une boîte de dialogue de confirmation peut apparaître — par exemple lorsque le module coûte des crédits, a des dépendances ou nécessite des autorisations spéciales. Examinez les détails, y compris le nombre de crédits que le déploiement coûtera.
5. **Déployer.** Cliquez sur **Déployer le module** pour mettre le déploiement en file d'attente. Si vous n'avez pas assez de crédits, RAD affiche le coût en crédits du module par rapport à votre solde actuel et vous invite à recharger d'abord.

**Ce qui se passe ensuite :** Votre déploiement est mis en file d'attente puis provisionné sur Google Cloud. RAD ouvre la page du déploiement sur son onglet **Statut de la build** afin que vous puissiez suivre sa progression ; il est également listé sur la page **Déploiements**.

## Déployer une solution {#deploying-a-solution}

Une **solution** déploie plusieurs modules ensemble comme une seule unité, dans le bon ordre, dans un seul locataire. Cliquez sur **Solutions** dans la navigation supérieure. Les bundles prêts à être déployés se trouvent sur **Catalogue de solutions → Solutions RAD** et **Catalogue de solutions → Mes solutions** ; **Construire une solution avec l'IA** et **Catalogue de solutions → Modules RAD** sont décrits ci-dessus.

Les **solutions RAD** sont pré-composées par RAD — parcourez par catégorie, ouvrez-en une pour voir ses membres, remplissez la configuration partagée une fois, et déployez l'ensemble du bundle. Les membres qui dépendent d'un autre l'attendent automatiquement.

Une solution avec trois membres ou plus coûte moins cher que de déployer les mêmes modules un par un : ses **frais de module** sont réduits de 15 % pour trois ou quatre membres, 20 % pour cinq ou six, et 25 % pour sept ou plus. La réduction ne couvre que les frais de module — le temps de build et les coûts propres à un projet géré par RAD sont facturés normalement. La boîte de dialogue de confirmation affiche la réduction appliquée.

Vos propres solutions (**Catalogue de solutions → Mes solutions**) sont composées en conversation. Décrivez ce que vous voulez construire — "J'ai besoin d'un site marketing avec un blog et des campagnes e-mail" — et RAD suggère des modules du catalogue avec une courte raison pour chacun. Ajoutez ceux que vous voulez (jusqu'à 12), donnez-lui un nom et enregistrez-le. Vos solutions personnalisées vous sont privées.

- Une solution enregistrée affiche **Brouillon** jusqu'à ce que vous la déployiez, puis **Déployée**. Un brouillon peut être modifié sur place ; une fois déployé, la modification propose de le copier dans un nouveau brouillon à la place, afin que l'enregistrement de ce que vous avez réellement construit reste précis.
- **Épinglez** une solution que vous utilisez souvent pour la garder en haut de **Mes solutions**, tout comme vous pouvez épingler une solution RAD ou un module.
- **Supprimer** ne supprime que la solution enregistrée. Cela ne touche jamais l'infrastructure que vous avez déjà déployée — supprimez-la depuis la page **Déploiements**.
- RAD connecte les membres entre eux uniquement lorsqu'une connexion connue existe entre ces deux applications. Lorsque deux membres n'ont pas une telle connexion, il le dit sur la carte plutôt que de deviner — ils se déploient toujours, vous les connectez vous-même s'ils ont besoin de communiquer.

## Gérer vos déploiements {#managing-your-deployments}

Cliquez sur **Déploiements** pour voir vos déploiements. Chaque ligne affiche le module, l'ID de déploiement, une **évaluation par étoiles** modifiable, la date de création, le temps qu'il a fallu, le statut et l'action. Il n'y a pas de colonne projet ou crédits — ouvrez un déploiement pour son projet, et son onglet **Builds** pour ce que chaque build a consommé.

Les statuts de déploiement incluent En file d'attente, En attente, En cours, En attente (qu'un déploiement préalable se termine), Succès, Échec, Erreur interne, Suppression, Supprimé, Annulé, Délai d'attente et Expiré. Un déploiement **Annulé** parce que quelque chose dont il dépend a échoué indique lequel — même lorsque l'échec est un niveau plus bas, comme le projet derrière vos services partagés — et y renvoie ; la page de ce déploiement explique l'échec et ce qu'il faut faire. Un déploiement **Supprimé** reste dans votre liste uniquement tant que vous pouvez encore le purger ; un environnement de lab que votre formateur a supprimé, par exemple, disparaît de votre liste car seul le formateur ou un administrateur peut le purger.

Ouvrez un déploiement pour voir ses détails, qui comporte les onglets suivants :

- **Sorties** — commence par la page à ouvrir : **Configuration initiale** lorsque l'application doit être configurée avant sa première utilisation, **Ouvrir l'application** sinon, ou — pour un module sans interface web — l'adresse API à laquelle se connecter. En dessous se trouvent le reste des résultats non sensibles (tels que les adresses et les points de terminaison exportés par le module). Ceux-ci apparaissent une fois le déploiement réussi. L'e-mail que RAD envoie lorsqu'un déploiement ou une mise à jour réussit contient le même premier lien, plus un lien vers le guide du module.
- **Statut de la build** — logs en direct, utiles pour suivre la progression ou dépanner un échec. Une fois le déploiement réussi, **Expliquer ceci** ouvre une explication en langage clair des ressources Google Cloud qu'il a créées, écrite pour quelqu'un qui ne lit pas Terraform. Il n'envoie que les *types* de ressources impliquées et leur nombre — jamais votre ID de projet, les noms de ressources, les adresses e-mail ou les valeurs configurées. Il renvoie également à la page de documentation propre au module, de sorte que l'explication est basée sur le fonctionnement réel de ce module plutôt que sur des connaissances générales. Sur une étape qui a *échoué*, **Rechercher une solution** ouvre une recherche construite à partir de l'erreur réelle imprimée par l'étape, et **Demander de l'aide** ouvre une demande de support avec la même sortie jointe. Si RAD reconnaît déjà l'échec — ou si une suggestion d'IA a déjà été générée pour cette build — **Demander de l'aide** l'affiche en premier et demande **Est-ce que cela résout le problème ?** : choisissez **Oui, je vais essayer ceci** et rien n'est envoyé, ou **Non, envoyer au support** et le diagnostic que vous avez vu accompagne votre demande. Si le script d'un module a échoué, la recherche utilise ce que le script a imprimé plutôt que le script lui-même, et elle omet ce qui vous identifie : adresses e-mail, ID de projet, adresses de service, adresses IP et les noms que RAD a donnés à vos ressources. **Télécharger** enregistre l'ensemble du log sous forme de fichier texte, avec les secrets masqués.
- **Builds** — l'historique des builds pour le déploiement.

Depuis la vue détaillée, vous pouvez également :

- **Mettre à jour** — rouvrir le formulaire de configuration (pré-rempli avec les valeurs actuelles), modifier ce dont vous avez besoin et réappliquer. Disponible une fois qu'un déploiement est terminé — réussi, échoué, expiré, annulé ou arrivé à expiration. La mise à jour nécessite également des crédits *achetés* sur votre compte : si vous ne détenez que des crédits offerts, RAD affiche une invite **Crédits requis** au lieu d'ouvrir le formulaire, avec un bouton **Recharger les crédits** pour **Acheter des crédits** tant que la plateforme vend des crédits.

  Deux choses peuvent arrêter une mise à jour avant que vous n'arriviez au formulaire. Si ce déploiement dépend d'un autre qui a **échoué**, a été annulé ou a expiré, RAD refuse et liste les déploiements à démarrer en premier — corrigez-les, puis réessayez. (Un prérequis qui est toujours en cours de construction est acceptable : la mise à jour est acceptée et mise en attente jusqu'à ce qu'il soit terminé.) Et si vous modifiez un paramètre qui ne peut pas être modifié sur un déploiement en cours — une région, une clé de chiffrement, un interrupteur qui crée une ressource — RAD soulève une confirmation nommant exactement les paramètres qui détruiront et reconstruiront les ressources. Lorsque votre administrateur a activé **Appliquer la mise à jour sécurisée**, ces champs sont en lecture seule à la place, et la seule façon d'en modifier un est de supprimer le déploiement et d'en créer un nouveau.
- **Annuler** — affiché tant qu'un déploiement est en file d'attente ou en attente, avant qu'il ne commence à se construire. L'annulation le libère afin que vous puissiez réessayer, et un déploiement en attente annulé libère également tout ce qui l'attend. Le même bouton apparaît pour une purge qui a duré une heure sans progression.
- **Supprimer** — supprime le déploiement. Vous avez deux choix :
  - **Supprimer** exécute un démantèlement qui détruit les ressources cloud créées par le déploiement. Cela inclut un projet GCP géré par RAD (l'option "Projet GCP sur RAD") : parce que sa suppression entraîne la suppression de l'ensemble du projet, RAD refuse tant qu'un autre déploiement est toujours en cours d'exécution dans ce projet et liste ceux à supprimer en premier. Google conserve un projet supprimé récupérable pendant environ 30 jours. Les conditions de Google Cloud ne garantissent pas qu'un projet restauré sera utilisable, de sorte qu'une restauration ne peut pas être invoquée pour récupérer un projet supprimé : effectuez des sauvegardes appropriées de vos données et de votre configuration avant de supprimer, et si une restauration échoue, redéployez l'application et restaurez sa configuration à partir de ces sauvegardes.
  - **Purger** supprime le déploiement de RAD *sans* détruire les ressources cloud. Utilisez Purger lorsqu'un déploiement a été modifié en dehors de RAD, ou est bloqué et que **Vérifier le statut** (ci-dessous) ne peut pas le corriger.

  Un déploiement qui fait partie d'une solution ne peut être supprimé ou purgé que depuis la page de la solution.

### Quand un déploiement échoue {#when-a-deployment-fails}

- **Une cause connue vous est expliquée.** Lorsque RAD reconnaît la raison de l'échec d'une étape — facturation désactivée sur le projet, autorisation manquante, service Google Cloud non encore activé, et bien d'autres — l'étape échouée sur **Statut de la build** indique ce qui n'a pas fonctionné et ce qu'il faut faire. L'e-mail d'échec nomme la même cause et la même solution, vous savez donc souvent quoi faire avant d'ouvrir la page.
- **Solutions suggérées.** Pour un échec que RAD ne reconnaît pas, **Suggérer des solutions** sur **Statut de la build** demande à l'IA les causes probables et les étapes à essayer, élaborées à partir de la sortie d'erreur de la build avec vos secrets masqués. Cela nécessite des crédits achetés sur votre compte (ou un rôle de personnel), sauf que sans crédits achetés, vous l'obtenez gratuitement sur vos premières builds échouées de vos propres déploiements (actuellement trois, et le panneau indique combien il vous en reste ; labs exclus) ; une build compte une fois, peu importe le nombre de fois que vous demandez, et un échec que RAD reconnaît déjà n'en utilise jamais un. RAD peut déjà l'avoir préparé au moment où vous ouvrez la page, et lorsqu'il est prêt quelques instants après l'échec, l'e-mail d'échec contient également les causes probables et les premières étapes. Les suggestions peuvent être erronées : vérifiez-les avant d'agir.
- **Appliquer la solution suggérée.** Certaines suggestions incluent une modification d'un ou deux paramètres — par exemple, plus de mémoire, plus de CPU, un nombre d'instances ou un délai d'attente plus élevé, une taille de machine plus grande ou un autre choix dans la liste d'un paramètre. **Appliquer la solution suggérée** ouvre le formulaire de mise à jour avec ces valeurs remplies et mises en évidence ; rien ne change tant que vous n'avez pas examiné le formulaire et l'avez soumis. RAD ne suggère jamais que des paramètres simples comme ceux-ci qui peuvent être modifiés en toute sécurité sur un déploiement en cours — jamais une adresse, une image de conteneur, une commande, une plage réseau, un secret, une région ou quoi que ce soit lié à votre projet, à la facturation ou à l'accès. Vous obtenez une solution suggérée par échec : si la mise à jour qu'elle a entraînée échoue à nouveau, le bouton n'est plus proposé et RAD vous oriente vers le support.
- **Avant de demander de l'aide**, RAD vous montre ce qu'il sait déjà (voir **Statut de la build** ci-dessus), afin que vous n'attendiez pas une réponse que vous auriez pu avoir immédiatement.
- **Suppression des services partagés.** La suppression des services partagés d'un projet (**Services_GCP**) peut échouer tant que Google libère encore les adresses réseau utilisées par Cloud Run — cela prend environ 20 à 30 minutes après la suppression de la dernière application. RAD réessaie cette suppression automatiquement, pas plus tôt que 30 minutes plus tard et au maximum deux fois, vous envoie un e-mail pour vous informer qu'il le fait, et **Statut de la build** indique quand la prochaine tentative aura lieu. Vous n'avez rien à faire.

### Quand un déploiement semble bloqué {#when-a-deployment-seems-stuck}

Si un déploiement est resté en **File d'attente**, **En attente**, **En cours** ou **Suppression** sans changement pendant 30 minutes, sa page propose **Vérifier le statut**. RAD demande à Cloud Build si une build est toujours en cours d'exécution pour ce déploiement :

- **Rien n'est en cours d'exécution** — le statut est corrigé immédiatement (RAD le ferait autrement lors de sa prochaine vérification automatique), et vous pouvez alors supprimer ou mettre à jour le déploiement normalement.
- **Une build est toujours en cours d'exécution** — RAD vous indique quand elle se terminera, ou quand Cloud Build l'arrêtera à sa limite de temps, afin que vous sachiez quand vérifier à nouveau. Une build qui est seulement en file d'attente et n'a pas commencé à s'appliquer peut être arrêtée avec **Annuler** ; une qui est déjà en cours d'application n'est jamais arrêtée, car l'arrêter en cours de route peut laisser des ressources à moitié créées.

**Vérifier le statut** est proposé à quiconque peut supprimer le déploiement — son propriétaire ou un administrateur, par exemple — et non au support. Un déploiement qui est **En attente** d'un autre a **Annuler** à la place, et un qui attend que les déploiements associés se terminent continue seul lorsqu'ils le font.

Pour **évaluer un module**, revenez à la liste **Déploiements** et cliquez sur les étoiles de la ligne de ce déploiement — l'évaluation n'est pas définie à partir de la page de détails, et vous ne pouvez évaluer que les déploiements que vous avez effectués vous-même.

## Crédits {#credits}

Ouvrez la page **Crédits** pour gérer votre solde.

Vos crédits sont répartis en quatre soldes distincts, qui se comportent différemment :

- **Crédits offerts** — crédits gratuits : votre prime d'inscription, les primes mensuelles et les récompenses de parrainage. Ceux-ci sont réinitialisés chaque mois (les crédits offerts non utilisés ne sont jamais reportés), sauf qu'un nouveau compte conserve ses crédits d'inscription pendant au moins 30 jours. À partir du **1er décembre 2026**, la prime mensuelle ne sera accordée qu'aux comptes qui étaient actifs au cours des 30 jours précédents — un déploiement réussi ou un achat de crédits.
- **Crédits événementiels** — crédits gratuits que vous avez réclamés avec un code événementiel (voir ci-dessous). Ils expirent à leur propre date, affichée lorsque vous les réclamez, plutôt qu'avec la réinitialisation mensuelle.
- **Abonnement** — crédits provenant d'un plan d'abonnement. Lorsque la plateforme est configurée pour les réinitialiser, un renouvellement remplace l'allocation plutôt que de l'ajouter.
- **Recharge** — crédits que vous avez achetés directement en une seule fois. Ceux-ci n'expirent jamais.

Les dépenses sont prélevées d'abord sur les crédits offerts, puis sur les crédits événementiels, puis sur l'abonnement, puis sur la recharge — ainsi, les crédits qui expirent le plus tôt sont utilisés en premier, et ceux que vous avez achetés directement sont conservés jusqu'à la fin.

Le déploiement d'un module facture ses **frais de module** et rien pour le temps de build : **les builds sont inclus dans le prix, vous ne payez donc que pour le succès.** Les frais sont réservés lorsque vous confirmez et facturés lorsque le déploiement réussit pour la première fois — y compris lorsqu'un déploiement échoué est ensuite corrigé par une mise à jour.

- **Créer** — les frais de module. **Votre premier déploiement réussi est gratuit** lorsque ses frais de module sont de 110 crédits ou moins : une fois par compte, pour un seul module que vous déployez vous-même (pas une solution, une session de lab, un projet client ou un module publié par un partenaire, dont les frais sont le revenu du partenaire).
- **Mettre à jour** — les 5 premières mises à jour réussies de chaque déploiement au cours d'un mois calendaire (UTC) sont gratuites ; chaque mise à jour réussie supplémentaire coûte 2 crédits.
- **Démontage, purge et tout build qui échoue** — gratuit.
- **Le projet et les services partagés que RAD met en place sous une application** — inclus. Déployés seuls, **Project_GCP** coûte 10 crédits et **Services_GCP** 20.

Ces chiffres sont fixés par l'équipe financière de RAD, qui peut également revenir à la facturation du temps de build à la minute ; la boîte de dialogue de confirmation indique toujours ce qui s'applique à votre déploiement.

**La boîte de dialogue de confirmation cite toute la chaîne, pas seulement l'application que vous avez choisie.** Le déploiement dans un projet géré par RAD crée également votre projet Google Cloud privé et les services partagés que vos applications utilisent, et la boîte de dialogue les liste sous *"RAD met également ceux-ci en place pour vous"* avec un total combiné. Elle affiche le prix en deux parties : **crédits à déployer (mises à jour incluses)** et, pour un projet géré par RAD, **environ combien il en coûte par mois pour fonctionner** — une estimation basée sur ce que des projets gérés par RAD similaires ont coûté au prix catalogue de Google, et non une facturation.

**TVA.** Si l'équipe financière de RAD a défini un taux de TVA pour votre compte, il est ajouté à chaque frais de module et prélèvement de crédits que vous payez, et à l'utilisation de Google Cloud de vos projets gérés par RAD et liés. La boîte de dialogue de confirmation affiche les chiffres nets avec une ligne **TVA** distincte, et la TVA doit être payée à partir des crédits achetés — la boîte de dialogue vous indique combien de crédits supplémentaires acheter si vous en manquez. Un changement de taux s'applique à partir de votre prochain déploiement ; il ne modifie jamais le prix d'un déploiement que vous avez déjà confirmé.

**Les déploiements échoués ne vous coûtent rien** : pas de frais de module et pas de frais de build, et il en va de même pour une mise à jour ou un démontage échoué. (Les finances peuvent choisir de facturer les frais de module lorsqu'un nouveau déploiement échoue ; la boîte de dialogue de confirmation l'indique le cas échéant.)

La page Crédits comporte ces onglets :

- **Transactions de crédits** — votre historique complet des crédits offerts, des achats et des dépenses, avec un solde **Crédits offerts**, **Recharge** et **Abonnement** après chaque entrée. Filtrez par déploiement et par date, et utilisez **Exporter CSV** pour télécharger un rapport.
- **Transactions de projet** (lorsque les crédits de projet sont activés) — ce que chaque projet Google Cloud vous a coûté, une ligne par projet, avec une recherche de projet et une plage de dates. Un prélèvement de projet apparaît dans les Transactions de crédits comme une seule ligne combinée couvrant tous vos projets à la fois ; cet onglet est la ventilation de ce prélèvement.
- **Projets liés** — demandez à RAD de payer Google pour un projet que vous possédez déjà. Voir [Projets liés](#linked-projects).
- **Abonnements** (uniquement lorsque la plateforme vend des crédits) — abonnez-vous à un plan de crédits récurrent, ou annulez ou réactivez celui que vous avez.
- **Acheter des crédits** (uniquement lorsque la plateforme vend des crédits) — rechargez votre solde.
- **Calculer le ROI** — le calculateur de ROI décrit ci-dessous, toujours le dernier onglet.

La possibilité d'acheter des crédits est un interrupteur unique de la plateforme. Lorsqu'il est désactivé, il n'y a pas de nouveaux abonnements ni de recharges ponctuelles, et les deux onglets ci-dessus ne sont pas affichés ; si vous avez déjà un abonnement, un avis sur les **Transactions de crédits** vous permet toujours de l'annuler.

**Pour acheter des crédits** : ouvrez l'onglet **Acheter des crédits**, choisissez un fournisseur de paiement, choisissez une devise et un montant, et complétez le paiement sur la page sécurisée du fournisseur. Le formulaire affiche la recharge minimale (définie par l'équipe financière de RAD, en USD) convertie dans votre devise, et le formulaire vous indique combien de crédits le montant achètera avant que vous ne payiez. La première option proposée est le **pack de démarrage** — 100 crédits pour 10 $, suffisant pour une application en direct et quelques jours de fonctionnement. Vos crédits sont ajoutés automatiquement une fois le paiement confirmé.

**Remboursements et rejets de débit.** Si un paiement est remboursé, ou si vous le contestez auprès de l'émetteur de votre carte (un rejet de débit), RAD récupère les crédits que ce paiement a ajoutés, du solde dans lequel ils sont allés — au prorata, pour un remboursement partiel. Votre historique l'affiche comme une ligne d'achat négative. Ce solde peut passer en dessous de zéro, et RAD désactive alors les projets Google Cloud qu'il paie en votre nom jusqu'à ce que vous rechargiez. Si un litige est tranché en votre faveur, les crédits sont remis.

Certains déploiements nécessitent des crédits *achetés* (abonnement ou recharge, pas des crédits offerts ou événementiels) avant de pouvoir les démarrer — dans ce cas, achetez d'abord des crédits même si vous avez un solde gratuit.

**Codes événementiels.** Un événement partenaire RAD peut vous donner un code pour des crédits gratuits. Saisissez-le dans la boîte de code événementiel en haut de l'onglet **Transactions de crédits** sur **Crédits** et choisissez **Réclamer des crédits**, ou ouvrez le lien que l'événement vous a donné, qui remplit le code pour vous (vous choisissez toujours **Réclamer des crédits**). Chaque code peut être réclamé une fois par compte et nécessite une adresse e-mail vérifiée ; certains codes sont limités à des participants ou des domaines de messagerie particuliers, et chaque code a une date de clôture. Les crédits événementiels paient les frais de module et le temps de build, mais pas l'utilisation de Google Cloud dans un projet géré par RAD, et ils ne comptent pas pour le minimum de crédits achetés qu'un projet géré par RAD demande.

## Abonnements {#subscriptions}

Un abonnement est un plan récurrent facultatif qui accorde un nombre défini de crédits à chaque cycle de facturation.

- **S'abonner** : choisissez un plan et complétez le paiement via le fournisseur de paiement choisi. Vous ne pouvez avoir qu'un seul abonnement à la fois — pour passer à un autre palier, ou à un autre fournisseur de paiement, annulez d'abord celui que vous avez et attendez qu'il expire à la fin de la période de facturation en cours.
- **Annuler** : arrêtez les renouvellements futurs. Vos crédits restants restent disponibles jusqu'à ce que vous les dépensiez.
- **Réactiver** : reprenez les renouvellements automatiques d'un plan annulé si vous changez d'avis.

Un abonnement n'accorde que des crédits — il ne modifie pas votre rôle sur la plateforme.

## Calculateur de ROI {#roi-calculator}

Ouvrez **Crédits** et accédez à l'onglet **Calculer le ROI** pour utiliser le calculateur de ROI interactif. Il est pré-rempli avec votre activité récente réelle (vos déploiements et dépenses) et vous permet d'ajuster les hypothèses — déploiements mensuels, temps de déploiement manuel, coût horaire de l'ingénieur et pourcentage d'économies de temps — pour estimer votre coût de main-d'œuvre, le coût de la plateforme, les économies nettes et le retour sur investissement. Ce n'est qu'un estimateur : il ne déploie jamais rien et ne débite jamais votre compte.

## Voir ce que vous avez dépensé {#seeing-what-youve-spent}

Vous pouvez voir vos propres dépenses de deux manières sur la page **Crédits**. Les **Transactions de crédits** listent chaque crédit offert, achat et prélèvement de déploiement sur votre compte, filtrables par déploiement et par date. Les **Transactions de projet** — disponibles lorsque les crédits de projet sont activés — détaillent la partie projet par projet Google Cloud, affichant les crédits débités et le coût cloud sous-jacent pour chacun sur une plage de dates que vous choisissez.

Le reporting à l'échelle de la plateforme est toujours restreint : les onglets **Coûts des modules** et **Factures de projet** et toute la page **Facturation** sont limités aux administrateurs et aux utilisateurs financiers. Si vous avez besoin d'une facture formelle, demandez-la via le formulaire de support.

## Projets liés {#linked-projects}

**Crédits → Projets liés** permet à RAD de payer Google pour un projet Google Cloud que vous possédez déjà et que vous gérez vous-même. Vous prépayez des crédits, et RAD les débite toutes les heures pour l'utilisation du projet. Le projet conserve son ID, ses données et votre contrôle total ; RAD n'a pas accès à vos données ou ressources.

L'onglet indique d'abord **vos conditions** : votre taux de TVA (ou que les Finances en confirmeront un avant le lien), si les propres crédits de Google — allocations gratuites, remises d'utilisation, crédits promotionnels — vous sont transmis (par défaut, ils ne le sont pas, et l'utilisation est facturée au prix catalogue de Google plus la marge de RAD), et le **seuil** : le solde minimum de crédits achetés que vous devez maintenir, affiché par rapport à ce que vous détenez. Les crédits offerts et événementiels ne comptent pas pour cela.

Pour lier un projet :

1. Saisissez l'**ID du projet Google Cloud** et choisissez **Continuer**.
2. **Confirmez que vous êtes propriétaire du projet** — la même vérification d'étiquette utilisée lorsque vous déployez dans votre propre projet (un propriétaire ou un éditeur de projet ajoute l'étiquette). Un projet que vous avez déjà vérifié vous est proposé.
3. **Laissez RAD gérer le lien de facturation du projet** — exécutez les deux commandes affichées, en tant que propriétaire du projet. Elles donnent à l'identité de facturation de RAD les rôles **Lecteur** et **Gestionnaire de projet de facturation** : suffisamment pour attacher ou détacher un compte de facturation, et rien de plus.
4. **Plafonnez vos quotas d'API Gemini et de GPU** dans la console Google Cloud, car ceux-ci peuvent dépenser plus rapidement que votre solde ne peut couvrir. Cochez la case confirmant que vous avez accordé les deux rôles et plafonné les quotas.
5. Choisissez **Demander un lien**. L'équipe financière de RAD examine la demande ; la liste ci-dessous affiche son statut (**En attente d'approbation**, **Liaison en cours**, **Lié**, **En pause**, **Déliaison en cours**, **Délié**, **Rejeté**, **Retiré**), et un rejet indique la raison des Finances. Vous pouvez envoyer une demande en dessous du seuil, mais elle ne peut être approuvée tant que vous ne le détenez pas.

Pendant qu'un projet est lié :

- Si votre solde acheté tombe en dessous du seuil, RAD **met en pause** le projet en détachant la facturation : ses services s'arrêtent, mais vos données sont conservées. RAD vous envoie un e-mail avant que cela ne se produise, et l'achat de crédits au-dessus du seuil le reprend automatiquement.
- **Retirer** annule une demande qui n'a pas été approuvée. **Arrêter** (derrière une confirmation, **Arrêter le paiement par RAD**) détache le compte de facturation de RAD. Si aucun autre compte de facturation n'est lié, les services du projet s'arrêtent — liez d'abord votre propre compte de facturation s'il doit continuer à fonctionner. Lier votre propre compte de facturation au projet met également fin à la participation de RAD.
- L'utilisation jusqu'au moment où la facturation est détachée est toujours facturée une fois que Google la signale.
- **Arrêter** ne se termine qu'une fois que RAD a confirmé que son compte de facturation est détaché du projet. Si RAD ne peut pas le détacher — par exemple parce que le rôle de facturation de RAD a été supprimé du projet — le projet reste **Déliaison en cours**, son utilisation vous est toujours facturée, et RAD continue d'essayer. Vous ne pouvez pas demander un nouveau lien tant que cela n'est pas terminé.
- Conservez les deux rôles de RAD sur le projet tant qu'il est lié. Si RAD ne peut plus lire la facturation du projet, il ne peut pas le mettre en pause, donc tant que les rôles ne sont pas restaurés, RAD ne reprendra aucun de vos projets liés en pause et ne pourra pas approuver un nouveau lien pour vous.

L'approbation vérifie le seuil par rapport à vos dépenses récentes sur tous vos projets liés, pas seulement le minimum fixe, et vérifie que vous êtes toujours le propriétaire vérifié du projet. Un projet que RAD a lui-même créé ou gère pour vous (un projet géré par RAD, de lab ou client) ne peut pas être lié.

## Suppression de votre compte {#deleting-your-account}

**Supprimer le compte** en bas de votre page **Profil** supprime définitivement votre compte. Elle est refusée, avec les raisons listées, tant que votre compte doit encore de l'argent à RAD ou est responsable de quelque chose que RAD paie : utilisation impayée de Google Cloud ou coûts de build, un solde de crédits achetés inférieur à zéro, un projet client que vous gérez qui n'a pas été terminé et réglé, un projet lié que RAD paie toujours ou détache, ou une session de lab que vous gérez qui n'a pas été terminée et réglée. Réglez ceux-ci d'abord. Vous devez également supprimer tout déploiement qui est toujours en cours d'exécution. Vos enregistrements de déploiement sont conservés après la suppression de votre compte, afin que l'utilisation tardive soit toujours facturée correctement ; votre historique de crédits est conservé pour les audits.

## Notifications par e-mail {#email-notifications}

Choisissez les e-mails que RAD vous envoie sur votre page **Profil**, sous **Paramètres de notification par e-mail**. **Déploiements** couvre tous les e-mails concernant vos déploiements — résultats de build, e-mails de lab et les avertissements que RAD envoie avant de supprimer définitivement quelque chose qui vous appartient. Il couvre également un suivi : si un de vos déploiements échoue et que vous n'êtes pas revenu depuis un jour, RAD envoie une seule note avec la cause probable et ce qu'il faut essayer (au maximum une par déploiement, et une par semaine). **Facturation** couvre les e-mails de crédits et de paiement. (Le personnel de support voit également **Ticket de support qui m'est attribué**.) Un e-mail ignore ces paramètres : si un build coûte plus de crédits que vous n'en avez, vous êtes toujours informé de ce que vous devez, car cela explique pourquoi votre prochaine recharge vous donne moins.

Désactiver les **Déploiements** arrête tous ces e-mails, y compris les avertissements. Parce que RAD ne supprime jamais rien définitivement sans vous avertir au préalable, ces suppressions sont **retenues** lorsque le paramètre est désactivé : un projet géré par RAD dont la facturation a été désactivée par manque de crédits n'est pas supprimé, et un déploiement supprimé de votre liste après la période de rétention est conservé plutôt que définitivement effacé. Lorsque vous réactivez les e-mails de déploiement, les avertissements sont envoyés. Pour un enregistrement de déploiement retenu, la période de préavis complète commence à partir de cet avertissement. Pour un projet géré par RAD retenu, le projet peut être supprimé dès le lendemain, alors agissez immédiatement sur cet avertissement.

## Projets clients {#client-projects}

Lorsque la plateforme le propose, les projets clients se trouvent sur **Solutions → Environnements gérés**, après les catalogues. Cela fonctionne des deux côtés.

**Géré pour vous.** Tout ce que quelqu'un d'autre a mis en place pour vous — une place dans une session de lab d'un formateur, ou un projet client qu'un partenaire gère pour vous — est listé ensemble sous **Solutions → Environnements gérés → Géré pour vous**, quel que soit le type. La vue **Géré pour vous** n'apparaît que tant que quelque chose est géré pour vous, y compris une invitation que vous n'avez pas encore acceptée. Pendant que vous avez cette vue ouverte, la bannière du lab en haut de la page s'écarte, car les mêmes détails y sont affichés.

**Si quelqu'un gère un projet pour vous.** Un partenaire ou un autre utilisateur RAD peut vous inviter à un projet client qu'il gère pour vous en tant que service géré. Vous recevrez un e-mail. Connectez-vous avec l'**adresse exacte à laquelle il a été envoyé**, en créant un compte si vous n'en avez pas, et confirmez votre adresse e-mail si RAD le demande. Ensuite, ouvrez **Solutions → Environnements gérés → Géré pour vous** et choisissez **Accepter** sous **Invitations pour vous**.

- Le projet apparaît alors sous **Projets gérés pour vous**, et ce qu'ils déploient pour vous apparaît dans vos **Déploiements**. C'est le vôtre : ils le construisent et le gèrent.
- Vous ne payez pas RAD pour cela. Ses coûts proviennent d'un solde que l'abonné finance ; tout accord entre vous deux est conclu en dehors de RAD.
- Tant qu'ils le gèrent, vous pouvez le voir, mais seuls eux peuvent le modifier ou le supprimer. Vous pouvez lire ses valeurs secrètes, telles que les mots de passe et les clés API ; eux ne le peuvent pas.
- Si leur solde est faible, le projet peut être mis en pause (rien n'est supprimé) et vous recevez un e-mail. S'il n'est pas rechargé à temps, il est supprimé, et vous en êtes informé.
- À la fin, ils peuvent vous le **transférer**. Il fonctionne alors avec vos propres crédits, comme tout ce que vous déployez vous-même, et ils n'y ont plus accès. Vous aurez besoin de suffisamment de crédits achetés pour maintenir un projet de production en fonctionnement.

**Si vous gérez des projets pour vos clients**, consultez le [Guide des projets clients](client-projects-guide.md). En démarrer un nécessite des crédits achetés ; gérer un projet que vous gérez déjà ne le nécessite pas.

## Obtenir de l'aide {#getting-help}

Ouvrez **Aide** et utilisez l'onglet **Envoyer un message** pour poser une question ou signaler un problème. Remplissez le formulaire pour envoyer votre message — cela crée un ticket de support et avertit l'équipe de support, qui vous contactera. La création d'un ticket nécessite des crédits achetés (un abonnement ou une recharge) tant que les crédits sont en vente ; sans aucun, le formulaire affiche une invite à acheter des crédits à la place. Tant que la plateforme ne vend pas de crédits, n'importe qui peut créer un ticket. Les comptes ayant un rôle de personnel — administrateur, partenaire, finance, support, agent ou formateur — n'ont jamais besoin de crédits achetés pour en créer un. Vous pouvez créer jusqu'à 5 tickets en 24 heures. Un lien **Contactez-nous** dans le pied de page vous mène également à la page d'aide ; pour suggérer une amélioration à la place, utilisez le lien **Commentaires** à côté, qui ouvre le tableau de commentaires public de RAD.

Vos tickets se trouvent dans l'onglet **Mes tickets**, à côté de **Envoyer un message**, les plus récents en premier : chacun affiche son statut (**Nouveau**, **En cours**, **Résolu** ou **Fermé**), son sujet et la date d'envoi, et en développant un, vous verrez sa catégorie, sa priorité, son module, la date de résolution et votre message. **Actualiser** recharge la liste. L'envoi d'un ticket vous mène directement à cet onglet, de sorte que celui que vous venez de créer est ce que vous voyez.

Si vous n'avez plus besoin d'aide pour un ticket qui n'est pas fermé, développez-le et choisissez **Retirer le ticket**, puis confirmez. Le ticket est fermé et apparaît comme **Retiré**, et le support voit que vous l'avez retiré, donc personne ne continue à y travailler. Il n'est pas supprimé : il reste dans votre liste. Vous pouvez créer un nouveau ticket à tout moment.

## Inviter d'autres personnes {#inviting-others}

Votre lien de parrainage se trouve sur votre **Profil**, dans la section **Parrainer et gagner** (la page **Crédits** a également un bouton **Lien de parrainage** qui vous y mène). Les personnes qui s'inscrivent via ce lien sont liées à votre compte, et vous gagnez des crédits de parrainage pour elles, sous réserve de toute limite mensuelle fixée par la plateforme. La section indique combien de vos parrainages vous ont rapporté des crédits ce mois-ci et au total — un simple décompte, jamais leur identité. Elle n'est masquée que lorsque la plateforme a désactivé les récompenses de parrainage.
