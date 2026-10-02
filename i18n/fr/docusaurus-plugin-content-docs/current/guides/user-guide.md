---
title: "Guide de l'utilisateur"
description: "Guide de l'utilisateur de la plateforme RAD — créer une solution à partir d'une simple description, déployer des modules et des solutions sur Google Cloud, gérer vos déploiements, et les crédits et abonnements."
---

<!-- translated-from: docs/guides/user-guide.md @ 7d02aa0b sha256:b84276a4446e -->

# Guide de l'utilisateur {#user-guide}

<img src="https://storage.googleapis.com/rad-public-2b65/guides/User_Guide.png" alt="Guide de l'utilisateur" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ce guide s'adresse à toute personne utilisant RAD pour déployer et gérer des modules cloud — le rôle **Utilisateur** par défaut. Nouveau sur RAD ? Commencez par [Utiliser RAD](using-rad.md).

## Ce que vous pouvez faire {#what-you-can-do}

- Répondez à quatre questions simples sur **Build Solution with AI** (Créer une solution avec l'IA) et laissez RAD déterminer les applications dont vous avez besoin, le coût total, et les déployer.
- Parcourez le catalogue de modules sur **Solutions → Solution Catalog → RAD modules** (Solutions → Catalogue de solutions → Modules RAD) et déployez des modules prêts à l'emploi via un formulaire guidé.
- Suivez et gérez vos propres **Deployments** (Déploiements) — consultez les résultats et les logs, mettez à jour et supprimez.
- Gérez les **Credits** (Crédits) — vérifiez votre solde, consultez l'historique de vos transactions et achetez-en davantage tant que la plateforme vend des crédits.
- Abonnez-vous à un plan de crédits récurrents, lorsque des plans sont proposés.
- Estimez vos économies avec **Calculate ROI** (Calculer le retour sur investissement), sur la page **Credits** (Crédits).
- Obtenez de l'aide via le formulaire **Send Message** (Envoyer un message) sur **Help** (Aide).
- Invitez d'autres personnes avec votre lien de parrainage, depuis **Profile → Refer and earn** (Profil → Parrainer et gagner).
- Demandez à RAD de payer Google pour un projet Google Cloud que vous possédez déjà, depuis **Credits → Linked Projects** (Crédits → Projets liés). Voir [Projets liés](#linked-projects).
- Exécutez des projets pour vos propres clients (en démarrer un nécessite des crédits achetés), ou acceptez-en un que quelqu'un exécute pour vous, sur **Solutions → Managed Environments** (Solutions → Environnements gérés). Voir [Projets clients](#client-projects).

Après vous être connecté, vous arrivez sur **Solutions** : sur **Build Solution with AI** si vous avez acheté des crédits (un abonnement ou une recharge), ce qui le débloque, sinon sur **Solution Catalog → RAD modules**. Les onglets sont, dans l'ordre : **Build Solution with AI**, **Solution Catalog**, puis **Managed Environments**, qui contient les projets clients (tant que la plateforme les propose), les sessions de lab pour les formateurs, les finances et les administrateurs (tant qu'ils sont activés), et tout ce que quelqu'un d'autre exécute pour vous.

**Solutions** contient tout ce que vous pouvez déployer, sur deux onglets :

- **Build Solution with AI** — quatre questions qui aboutissent à une solution fonctionnelle et tarifée. Commencez ici si vous savez ce que vous voulez accomplir mais pas comment cela s'appelle.
- **Solution Catalog** — tout ce qui est prêt à être déployé, avec un filtre de type en haut et un bouton **New solution** (Nouvelle solution) à côté qui ouvre **Build Solution with AI** :
  - **All** (Tout) — toutes les catégories sur une seule page, chacune sous son propre titre ; une catégorie sans rien à montrer est omise.
  - **My solutions** (Mes solutions) — les bundles que vous avez composés vous-même.
  - **RAD solutions** (Solutions RAD) — des bundles prêts à l'emploi sélectionnés par RAD.
  - **RAD modules** (Modules RAD) — le catalogue complet des applications individuelles.

Votre navigation supérieure affiche **Credits** (lorsque les crédits sont activés), **Deployments** (Déploiements), **Solutions**, **Pricing** (Tarification) et **Help** (Aide), avec un sélecteur de langue (anglais ou français) à côté de votre menu de profil.

## Créer une solution à partir d'une description {#building-a-solution-from-a-description}

**Build Solution with AI** et la composition de vos propres solutions nécessitent des **crédits achetés** (une recharge ou un abonnement ; les crédits d'inscription gratuite, mensuels et de parrainage ne comptent pas). Les partenaires en ont toujours. Sans crédits achetés, vous voyez toujours les deux, verrouillés, avec une note sur ce qui les débloque et un bouton **Buy credits** (Acheter des crédits) tant que la plateforme vend des crédits, et toutes les solutions que vous avez déjà enregistrées restent listées : vous pouvez toujours les déployer ou les supprimer, mais pas les modifier. Le déploiement pour un projet client que vous gérez est l'exception : le portefeuille du client paie, donc cela fonctionne quel que soit votre solde.

Sur **Solutions → Build Solution with AI** — également accessible directement à l'adresse **/build** — décrivez ce que vous voulez que les gens puissent faire, avec vos propres mots, sans avoir besoin de noms d'applications. RAD détermine quelles applications le permettent, puis pose trois courtes questions :

1. **Where should it run?** (Où doit-il s'exécuter ?) Votre propre projet Google Cloud est la valeur par défaut : vous conservez la relation de facturation, les politiques de votre organisation et le projet lui-même par la suite. Choisir un **projet géré par RAD** place l'infrastructure au sein de l'organisation et du compte de facturation de RAD, et vous indiquez ensuite à quoi sert l'environnement — pour essayer des choses, pour vos développeurs ou pour vos utilisateurs finaux. Un projet géré par RAD vous demande également de détenir un solde minimum de crédits achetés, que la page indique. Il s'agit d'une exigence de solde, pas d'un débit.
2. **Where should it live?** (Où doit-il résider ?) Choisissez l'emplacement le plus proche des personnes qui l'utiliseront. Votre propre projet peut utiliser n'importe quelle région Google Cloud ; un projet géré par RAD propose les emplacements pris en charge par RAD — les moins chers dans chaque partie du monde. RAD vérifie cela à nouveau lorsque vous déployez : un emplacement en dehors de cette liste, dans n'importe quel paramètre d'emplacement (y compris un qui prend plusieurs emplacements), est refusé avant que quoi que ce soit ne soit réservé ou construit, et le message nomme le paramètre à modifier.
3. **What should we call it?** (Comment devons-nous l'appeler ?) Un nom pour votre propre référence, plus un nom court (jusqu'à sept lettres ou chiffres) utilisé à l'intérieur de vos ressources cloud. Réutilisez ce nom court plus tard pour partager les mêmes ressources cloud.

Si les applications proposées par RAD ne conviennent pas tout à fait, utilisez **Not quite? Tell us what to change** (Pas tout à fait ? Dites-nous ce qu'il faut changer) en dessous — indiquez ce qu'il faut ajouter ou supprimer, et RAD retravaille l'ensemble au lieu de repartir de zéro. Vous pouvez également supprimer une seule application, ou **Start over** (Recommencer) pour effacer vos réponses et la proposition ensemble.

Un panneau à côté des questions montre **what you'll get** (ce que vous obtiendrez), **what it costs** (ce que cela coûte) et **how long it takes** (combien de temps cela prend) — le coût total, y compris les services partagés que RAD ajoute pour vous, divisé en ce qui est prélevé lorsque vous construisez et ce qui est mesuré à mesure que chaque partie se termine, ainsi qu'une estimation de la durée de la construction telle que "environ 1h 20m". **Build this** (Construire ceci) l'enregistre sous **My solutions** (Mes solutions) et ouvre sa page de déploiement avec vos réponses déjà remplies ; examinez-le là et choisissez **Deploy Solution** (Déployer la solution). **Show the engineering detail** (Afficher les détails techniques) l'enregistre de la même manière mais l'ouvre sur le formulaire de configuration complet, si vous préférez tout configurer vous-même.

### Apporter votre propre projet Google Cloud {#bringing-your-own-google-cloud-project}

Le déploiement dans un projet que vous possédez déjà signifie que le compte de service de déploiement de RAD effectue le travail à l'intérieur de celui-ci, il a donc besoin d'un accès au préalable. Avant tout déploiement, vous prouvez que vous contrôlez le projet : choisissez **Get verification code** (Obtenir le code de vérification), exécutez les commandes affichées en tant que propriétaire du projet (par exemple dans Cloud Shell) — elles ajoutent une étiquette de vérification et donnent à RAD un accès **Browser** (Navigateur) en lecture seule — puis choisissez **Verify** (Vérifier) ; le code expire en une heure. Vous accordez ensuite au compte de service de déploiement le rôle de **Owner** (Propriétaire) sur le projet ; RAD nomme le compte exact et affiche la commande. Si un autre compte RAD a déjà enregistré le même projet, vous y êtes ajouté en tant que collaborateur. Les crédits gratuits (offerts) peuvent payer un déploiement dans votre propre projet.

### Ce dont un projet géré par RAD a besoin {#what-a-rad-managed-project-needs}

Un projet géré par RAD demande deux choses avant que RAD ne puisse le créer : une **adresse e-mail vérifiée**, et un solde minimum de crédits **achetés** pour l'objectif que vous avez choisi. Les crédits gratuits (offerts) — tels que ceux que vous recevez lors de votre inscription — ne comptent pas pour ce minimum. La page indique le nombre de crédits achetés que vous avez par rapport à ce qui est nécessaire, avec un lien **Buy credits** (Acheter des crédits), dès que vous choisissez l'option. L'en-tête affiche votre solde divisé en crédits achetés et crédits gratuits pour la même raison.

## Trouver un module {#finding-a-module}

Ouvrez **Solutions**, choisissez l'onglet **Solution Catalog** et sélectionnez **RAD modules** dans le filtre de type pour parcourir le catalogue de modules. Les modules apparaissent sous forme de cartes.

- **Parcourir :** Vous voyez un catalogue combiné unique de modules publics — à la fois les modules publiés par RAD et les modules publics publiés par les partenaires.
- **Rechercher :** La barre de recherche au-dessus des onglets recherche l'ensemble du **Solution Catalog** — vos propres solutions, les solutions RAD et les modules RAD. Chaque mot que vous tapez doit correspondre ; une correspondance dans le nom est classée en premier, puis les correspondances trouvées dans une description ou dans ce qu'une solution contient. Votre recherche reste en place lorsque vous basculez entre les types, et les décomptes sur **My solutions** et **RAD solutions** indiquent le nombre de correspondances que chacun contient.
- **Filtrer par catégorie :** Utilisez la liste de catégories à côté de la grille pour affiner le catalogue à une seule catégorie. Elle apparaît lorsqu'un seul type (**RAD solutions** ou **RAD modules**) est sélectionné, et est masquée sur **All** (Tout), car les solutions et les modules utilisent des catégories différentes. Chaque entrée indique le nombre de modules qu'elle contient ; **All** efface le filtre.
- **Parcourir les pages :** **All** affiche quatre éléments de chaque type par page ; un seul type en affiche davantage (24 modules RAD ou solutions RAD, 12 de vos propres solutions). Modifiez le nombre par page, jusqu'à 72, sous la liste.
- **Épingler :** Cliquez sur l'épingle d'une carte pour conserver un module favori en haut de votre catalogue pour un accès rapide.
- **Lire chaque carte :** Chaque carte affiche la description du module, un lien vers la **documentation**, une note moyenne en étoiles, le nombre de fois où il a été déployé et son **prix**.
- **Lire le prix :** Chaque carte de catalogue — module, solution de plateforme ou solution personnalisée — affiche son prix de la même manière : les **frais** (facturés une fois, lors de la création du déploiement) plus une estimation du **build** (mesuré à chaque build), par exemple `50 cr fee + ~19 cr build`. Un module sans frais indique **Free module** (Module gratuit) ; son build est toujours facturé. Une solution qui donne droit à une remise groupée l'affiche : les frais avant la remise sont barrés à côté des frais que vous payez. Un déploiement dans un projet géré par RAD peut également configurer un projet et des services partagés au préalable ; ce coût est affiché avant que vous ne déployiez.
- **Obtenir de l'aide sur un module :** Cliquez sur **Help** (Aide) sur une carte pour ouvrir la boîte de dialogue Obtenir de l'aide. Elle comporte trois onglets : **End User Support** (Support utilisateur final) ouvre un ticket de support concernant le module, **End User Training** (Formation utilisateur final) demande une aide payante pour le configurer (RAD vous contacte dans un délai d'un jour ouvrable), et **Contact Publisher** (Contacter l'éditeur) envoie un e-mail à l'éditeur du module avec une question.

Une bande de statistiques en haut affiche le nombre total de déploiements, votre solde de crédits actuel (lorsque les crédits sont activés) et la durée de conservation de l'historique des déploiements.

## Déployer un module {#deploying-a-module}

1. **Choisissez comment le configurer.** Cliquez sur une carte de module et choisissez **Conversational Assistant** (Assistant conversationnel) ou **Configuration Form** (Formulaire de configuration). L'assistant est la valeur par défaut si vous avez acheté des crédits (les partenaires en ont toujours) ; sans eux, vous obtenez le formulaire, et l'assistant est affiché mais verrouillé jusqu'à ce que vous achetiez des crédits. En arrivant de **Build Solution with AI**, une solution s'ouvre sur le formulaire, puisque l'entretien a déjà posé ses questions. L'assistant décrit chaque paramètre en une seule fois, puis n'applique que les modifications que vous acceptez — chaque modification proposée est affichée pour que vous l'appliquiez individuellement, de sorte que rien n'est défini sans votre accord. Vous pouvez basculer entre les deux à tout moment. Deux choses que l'assistant ne fera pas : il ne voit ni ne définit jamais un **secret** (une clé API ou un mot de passe) — il vous indique que le champ existe et vous tapez la valeur dans la boîte en surbrillance sur la page, jamais dans le chat — et il n'acceptera pas une valeur qui enfreint la règle d'un champ, vous indiquant quelle est la règle et vous demandant une valeur corrigée plutôt que de modifier silencieusement ce que vous avez tapé. De même, lorsque le déploiement se fait dans un projet géré par RAD, il refuse une région que ce projet ne peut pas utiliser et vous indique les régions autorisées.
2. **Ouvrez le formulaire.** Le formulaire de configuration guidée. La première fois que vous déployez un module, le formulaire n'affiche que les champs essentiels (obligatoires) — les champs administratifs et internes vous sont masqués, et la configuration avancée facultative est reportée. Vous pouvez déverrouiller l'ensemble complet des étapes de configuration plus tard, à partir de l'action **Update** (Mettre à jour) du déploiement : cochez **Enable advanced mode** (Activer le mode avancé), qui est disponible une fois que votre solde de crédits couvre le coût estimé de la mise à jour. Le mode avancé n'entraîne pas de frais de module — les mises à jour n'en entraînent jamais — et n'est pas disponible dans un environnement de lab.
3. **Remplissez la configuration.** Remplissez les champs requis à chaque étape (par exemple, projet et région). Passez à l'étape suivante lorsque chaque étape est valide. Le formulaire est généré à partir du module lui-même, donc là où le module déclare une règle pour un champ — un modèle de nommage, une limite de longueur — vous voyez l'erreur propre à ce module au fur et à mesure que vous tapez, plutôt que plusieurs minutes après un build échoué. Les champs contenant un secret (un jeton API, un mot de passe) sont masqués et stockés dans Google Secret Manager plutôt que d'être enregistrés avec le reste de votre configuration ; comme la valeur ne revient jamais au navigateur, un tel champ affiche **Configured** (Configuré) ou **Not configured** (Non configuré) à la place, et laisser un champ configuré vide le conserve plutôt que de l'effacer. La plupart des modules d'application construisent leur propre image conteneur : tant que **Container Image Source** (Source de l'image conteneur) est "custom" (personnalisé), une note sous **Container Image** (Image conteneur) indique que ce champ est ignoré. Choisissez "prebuilt" (pré-construit) pour déployer l'image que vous entrez à la place.
4. **Confirmez.** Le panneau **What will be deployed** (Ce qui sera déployé) en haut du formulaire liste tout ce que ce déploiement construit — dans un projet géré par RAD, cela inclut le projet Google Cloud et les services partagés — avec le coût de chacun (un qui existe déjà est réutilisé, **Free, reused** (Gratuit, réutilisé)), et marque tout ce qui **Will be updated first** (Sera mis à jour en premier) ou **Needs attention first** (Nécessite une attention en premier) ; vous ne pouvez pas déployer tant que quelque chose nécessite une attention. Avant le lancement, une boîte de dialogue de confirmation peut apparaître — par exemple lorsque le module coûte des crédits, a des dépendances ou nécessite des autorisations spéciales. Examinez les détails, y compris le nombre de crédits que le déploiement coûtera.
5. **Déployez.** Cliquez sur **Deploy Module** (Déployer le module) pour mettre le déploiement en file d'attente. Si vous n'avez pas assez de crédits, RAD affiche le coût en crédits du module par rapport à votre solde actuel et vous invite à recharger d'abord.

**Ce qui se passe ensuite :** Votre déploiement est mis en file d'attente puis provisionné sur Google Cloud. RAD ouvre la page propre au déploiement sur son onglet **Build Status** (Statut de la construction) afin que vous puissiez suivre sa progression ; il est également listé sur la page **Deployments** (Déploiements).

## Déployer une solution {#deploying-a-solution}

Une **solution** déploie plusieurs modules ensemble comme une seule unité, dans le bon ordre, pour un seul locataire. Cliquez sur **Solutions** dans la navigation supérieure. Les bundles prêts à être déployés se trouvent sur **Solution Catalog → RAD solutions** et **Solution Catalog → My solutions** ; **Build Solution with AI** et **Solution Catalog → RAD modules** sont décrits ci-dessus.

Les **solutions RAD** sont pré-composées par RAD — parcourez par catégorie, ouvrez-en une pour voir ses membres, remplissez la configuration partagée une fois, et déployez l'ensemble du bundle. Les membres qui dépendent d'un autre attendent automatiquement.

Une solution avec trois membres ou plus coûte moins cher que le déploiement des mêmes modules un par un : ses **frais de module** sont réduits de 15 % pour trois ou quatre membres, 20 % pour cinq ou six, et 25 % pour sept ou plus. La réduction ne couvre que les frais de module — le temps de build et les coûts propres à un projet géré par RAD sont facturés normalement. La boîte de dialogue de confirmation affiche la réduction appliquée.

Vos propres solutions (**Solution Catalog → My solutions**) sont composées en conversation. Décrivez ce que vous voulez construire — "J'ai besoin d'un site marketing avec un blog et des campagnes e-mail" — et RAD suggère des modules du catalogue avec une brève raison pour chacun. Ajoutez ceux que vous voulez (jusqu'à 12), donnez-lui un nom et enregistrez-le. Vos solutions personnalisées sont privées.

- Une solution enregistrée affiche **Draft** (Brouillon) jusqu'à ce que vous la déployiez, puis **Deployed** (Déployée). Un brouillon peut être modifié sur place ; une fois qu'il a été déployé, la modification propose de le copier dans un nouveau brouillon à la place, afin que l'enregistrement de ce que vous avez réellement construit reste précis.
- **Épinglez** une solution que vous utilisez souvent pour la conserver en haut de **My solutions**, tout comme vous pouvez épingler une solution RAD ou un module.
- **Delete** (Supprimer) ne supprime que la solution enregistrée. Cela ne touche jamais l'infrastructure que vous avez déjà déployée — supprimez-la depuis la page **Deployments**.
- RAD connecte les membres entre eux uniquement lorsqu'une connexion connue existe entre ces deux applications. Lorsque deux membres n'ont pas une telle connexion, il le dit sur la carte plutôt que de deviner — ils se déploient toujours, vous les connectez vous-même s'ils ont besoin de communiquer.

## Gérer vos déploiements {#managing-your-deployments}

Cliquez sur **Deployments** (Déploiements) pour voir vos déploiements. Chaque ligne affiche le module, l'ID de déploiement, une **évaluation par étoiles** modifiable, la date de création, la durée, le statut et l'action. Il n'y a pas de colonne projet ou crédits — ouvrez un déploiement pour son projet, et son onglet **Builds** (Constructions) pour ce que chaque construction a consommé.

Les statuts de déploiement incluent Queued (En file d'attente), Pending (En attente), Working (En cours), Waiting (En attente, sur un déploiement préalable à terminer), Success (Succès), Failure (Échec), Internal Error (Erreur interne), Deleting (Suppression), Deleted (Supprimé), Cancelled (Annulé), Timeout (Délai d'attente dépassé) et Expire (Expire). Un déploiement **Deleted** (Supprimé) reste dans votre liste uniquement tant que vous pouvez encore le purger ; un environnement de lab que votre formateur a supprimé, par exemple, disparaît de votre liste car seul le formateur ou un administrateur peut le purger.

Ouvrez un déploiement pour voir ses détails, qui comporte les onglets suivants :

- **Outputs** (Sorties) — commence par la page à ouvrir : **First-time setup** (Configuration initiale) lorsque l'application doit être configurée avant sa première utilisation, **Open application** (Ouvrir l'application) sinon, ou — pour un module sans interface web — l'adresse API à laquelle se connecter. En dessous se trouvent le reste des résultats non sensibles (tels que les adresses et les points de terminaison exportés par le module). Ceux-ci apparaissent une fois le déploiement réussi.
- **Build Status** (Statut de la construction) — logs en direct, utiles pour suivre la progression ou dépanner un échec. Une fois le déploiement réussi, **Explain this** (Expliquer ceci) ouvre une explication en langage clair des ressources Google Cloud qu'il a créées, rédigée pour quelqu'un qui ne lit pas Terraform. Il n'envoie que les *types* de ressources impliqués et leur nombre — jamais votre ID de projet, les noms de ressources, les adresses e-mail ou les valeurs configurées. Il lie également la page de documentation propre au module, de sorte que l'explication est basée sur le fonctionnement réel de ce module plutôt que sur des connaissances générales. Sur une étape qui a *échoué*, **Search for a fix** (Rechercher une solution) ouvre une recherche construite à partir de l'erreur réelle imprimée par l'étape, et **Ask for help** (Demander de l'aide) ouvre une demande de support avec la même sortie jointe. Lorsqu'un script de module a échoué, la recherche utilise ce que le script a imprimé plutôt que le script lui-même, et elle omet ce qui vous identifie : adresses e-mail, ID de projet, adresses de service, adresses IP et les noms que RAD a donnés à vos ressources. **Download** (Télécharger) enregistre l'ensemble du log sous forme de fichier texte, avec les secrets masqués.
- **Builds** (Constructions) — l'historique des constructions pour le déploiement.

Depuis la vue détaillée, vous pouvez également :

- **Update** (Mettre à jour) — rouvrir le formulaire de configuration (pré-rempli avec les valeurs actuelles), modifier ce dont vous avez besoin et réappliquer. Disponible une fois qu'un déploiement est terminé — réussi, échoué, expiré, annulé ou expiré. La mise à jour nécessite également des crédits *achetés* sur votre compte : si vous ne détenez que des crédits offerts, RAD affiche une invite **Credits Required** (Crédits requis) au lieu d'ouvrir le formulaire, avec un bouton **Top Up Credits** (Recharger des crédits) pour **Buy Credits** (Acheter des crédits) tant que la plateforme vend des crédits.

  Deux choses peuvent arrêter une mise à jour avant que vous n'atteigniez le formulaire. Si ce déploiement dépend d'un autre qui a **échoué**, a été annulé ou a expiré, RAD refuse et liste les déploiements à démarrer en premier — corrigez-les, puis réessayez. (Un prérequis qui est toujours en cours de construction est acceptable : la mise à jour est acceptée et mise en attente jusqu'à ce qu'elle soit terminée.) Et si vous modifiez un paramètre qui ne peut pas être modifié sur un déploiement en cours d'exécution — une région, une clé de chiffrement, un interrupteur qui crée une ressource — RAD soulève une confirmation nommant exactement les paramètres qui détruiront et reconstruiront les ressources. Lorsque votre administrateur a activé **Enforce Update Safe** (Appliquer la sécurité des mises à jour), ces champs sont en lecture seule à la place, et la seule façon d'en modifier un est de supprimer le déploiement et d'en créer un nouveau.
- **Cancel** (Annuler) — affiché lorsqu'un déploiement est en file d'attente ou en attente, avant qu'il ne commence à se construire. L'annulation le libère afin que vous puissiez réessayer, et un déploiement en attente annulé libère également tout ce qui attend derrière lui. Le même bouton apparaît pour une purge qui a duré une heure sans progression.
- **Delete** (Supprimer) — supprime le déploiement. Vous avez deux choix :
  - **Delete** exécute une suppression qui détruit les ressources cloud créées par le déploiement. Cela inclut un projet GCP géré par RAD (l'option "GCP Project on RAD") : comme sa suppression entraîne la suppression de l'ensemble du projet, RAD refuse tant qu'un autre déploiement est toujours en cours d'exécution dans ce projet et liste ceux à supprimer en premier. Google conserve un projet supprimé récupérable pendant environ 30 jours.
  - **Purge** (Purger) supprime le déploiement de RAD *sans* détruire les ressources cloud. Utilisez Purge lorsqu'un déploiement est bloqué ou a été modifié en dehors de RAD.

  Un déploiement qui fait partie d'une solution ne peut être supprimé ou purgé que depuis la page de la solution.

Pour **évaluer un module**, revenez à la liste **Deployments** et cliquez sur les étoiles de la ligne de ce déploiement — l'évaluation n'est pas définie depuis la page des détails, et vous ne pouvez évaluer que les déploiements que vous avez effectués vous-même.

## Crédits {#credits}

Ouvrez la page **Credits** (Crédits) pour gérer votre solde.

Vos crédits sont répartis en quatre soldes distincts, et ils se comportent différemment :

- **Awards** (Offerts) — crédits gratuits : votre octroi d'inscription, les octrois mensuels et les récompenses de parrainage. Ceux-ci sont réinitialisés chaque mois.
- **Event credits** (Crédits d'événement) — crédits gratuits que vous avez réclamés avec un code d'événement (voir ci-dessous). Ils expirent à leur propre date, affichée lorsque vous les réclamez, plutôt qu'avec la réinitialisation mensuelle.
- **Subscription** (Abonnement) — crédits d'un plan d'abonnement. Lorsque la plateforme est configurée pour les réinitialiser, un renouvellement remplace l'allocation plutôt que de l'ajouter.
- **Top-up** (Recharge) — crédits que vous avez achetés directement en une seule fois. Ceux-ci n'expirent jamais.

Les dépenses sont prélevées d'abord sur les crédits offerts, puis sur les crédits d'événement, puis sur l'abonnement, puis sur la recharge — ainsi, les crédits qui expirent le plus tôt sont utilisés en premier, et ceux que vous avez achetés directement sont conservés jusqu'à la fin.

Le déploiement d'un module facture deux choses. Les **frais de module** sont réservés lorsque vous confirmez et facturés lorsque le déploiement réussit pour la première fois — y compris lorsqu'un déploiement échoué est ensuite corrigé par une mise à jour. Le **coût de construction** est mesuré en fonction de la durée réelle de chaque construction, au taux de crédits par heure de construction de la plateforme, et facturé à la fin de chaque construction.

**La boîte de dialogue de confirmation cite toute la chaîne, pas seulement l'application que vous avez choisie.** Le déploiement dans un projet géré par RAD crée également votre projet Google Cloud privé et les services partagés que vos applications utilisent, et ceux-ci ont leurs propres coûts — la boîte de dialogue les liste sous *"RAD sets these up for you"* (RAD les configure pour vous) avec un total combiné. Elle sépare également ce qui est réservé lorsque vous confirmez de ce qui est mesuré à la fin de chaque construction, de sorte que la deuxième charge n'est pas une surprise. Les coûts de construction sont des estimations jusqu'à ce que la construction soit terminée, de sorte que le chiffre final peut différer légèrement.

La mise à jour d'un déploiement ne facture que le coût de construction.

**TVA.** Si l'équipe financière de RAD a défini un taux de TVA pour votre compte, il est ajouté à chaque frais de module et coût de construction que vous payez, ainsi qu'à l'utilisation de Google Cloud de vos projets gérés par RAD et liés. La boîte de dialogue de confirmation affiche les chiffres nets avec une ligne **VAT** (TVA) distincte, et la TVA doit être payée à partir des crédits achetés — la boîte de dialogue vous indique combien de crédits supplémentaires acheter si vous en manquez. Un changement de taux s'applique à partir de votre prochain déploiement ; il ne modifie jamais le prix d'un déploiement que vous avez déjà confirmé.

**Déploiements échoués.** Le fait qu'un déploiement échoué soit facturé est un paramètre de la plateforme plutôt qu'une règle fixe : les Finances décident, séparément pour le coût de construction et les frais de module, si l'un ou l'autre est prélevé lorsqu'un nouveau déploiement échoue ou est annulé. **Dans la version actuelle, aucun n'est facturé — un déploiement échoué ne vous coûte rien.** Une mise à jour ou une suppression échouée n'est pas non plus facturée.

La page Crédits comporte les onglets suivants :

- **Credit Transactions** (Transactions de crédits) — votre historique complet des récompenses, des achats et des dépenses, avec un solde **Awards** (Offerts), **Top-up** (Recharge) et **Subscription** (Abonnement) après chaque entrée. Filtrez par déploiement et par date, et utilisez **Export CSV** (Exporter CSV) pour télécharger un rapport.
- **Project Transactions** (Transactions de projet) (lorsque les crédits de projet sont activés) — ce que chaque projet Google Cloud vous a coûté, une ligne par projet, avec une recherche de projet et une plage de dates. Une charge de projet apparaît sur les Transactions de crédits sous la forme d'une seule ligne combinée couvrant tous vos projets à la fois ; cet onglet est la ventilation de cette charge.
- **Linked Projects** (Projets liés) — demandez à RAD de payer Google pour un projet que vous possédez déjà. Voir [Projets liés](#linked-projects).
- **Subscriptions** (Abonnements) (uniquement tant que la plateforme vend des crédits) — abonnez-vous à un plan de crédits récurrents, ou annulez ou réactivez celui que vous avez.
- **Buy Credits** (Acheter des crédits) (uniquement tant que la plateforme vend des crédits) — rechargez votre solde.
- **Calculate ROI** (Calculer le retour sur investissement) — le calculateur de retour sur investissement décrit ci-dessous, toujours le dernier onglet.

La possibilité d'acheter des crédits est un interrupteur unique de la plateforme. Lorsqu'il est désactivé, il n'y a pas de nouveaux abonnements ni de recharges ponctuelles, et les deux onglets ci-dessus ne sont pas affichés ; si vous avez déjà un abonnement, un avis sur **Credit Transactions** vous permet toujours de l'annuler.

**Pour acheter des crédits :** ouvrez l'onglet **Buy Credits**, choisissez un fournisseur de paiement, sélectionnez une devise et un montant, et finalisez le paiement sur la page sécurisée du fournisseur. Le formulaire affiche le montant minimum de recharge (défini par l'équipe financière de RAD, en USD) converti dans votre devise, et le formulaire vous indique le nombre de crédits que le montant achètera avant que vous ne payiez. Vos crédits sont ajoutés automatiquement une fois le paiement confirmé.

Certains déploiements nécessitent des crédits *achetés* (abonnement ou recharge, pas des crédits offerts ou d'événement) avant de pouvoir les démarrer — dans ce cas, achetez d'abord des crédits même si vous avez un solde gratuit.

**Codes d'événement.** Un événement partenaire RAD peut vous donner un code pour des crédits gratuits. Tapez-le dans la boîte de code d'événement en haut de l'onglet **Credit Transactions** sur **Credits** et choisissez **Claim credits** (Réclamer des crédits), ou ouvrez le lien que l'événement vous a donné, qui remplit le code pour vous (vous choisissez toujours **Claim credits**). Chaque code peut être réclamé une fois par compte et nécessite une adresse e-mail vérifiée ; certains codes sont limités à des participants ou des domaines d'e-mail particuliers, et chaque code a une date de clôture. Les crédits d'événement paient les frais de module et le temps de construction, mais pas l'utilisation de Google Cloud dans un projet géré par RAD, et ils ne comptent pas pour le minimum de crédits achetés qu'un projet géré par RAD demande.

## Abonnements {#subscriptions}

Un abonnement est un plan récurrent facultatif qui accorde un nombre défini de crédits à chaque cycle de facturation.

- **S'abonner :** choisissez un plan et finalisez le paiement via le fournisseur de paiement choisi. Vous ne pouvez avoir qu'un seul abonnement à la fois — pour passer à un autre palier ou à un autre fournisseur de paiement, annulez d'abord celui que vous avez et attendez qu'il expire à la fin de la période de facturation en cours.
- **Annuler :** arrêtez les renouvellements futurs. Vos crédits restants restent disponibles jusqu'à ce que vous les dépensiez.
- **Réactiver :** reprenez les renouvellements automatiques d'un plan annulé si vous changez d'avis.

Un abonnement n'accorde que des crédits — il ne modifie pas votre rôle sur la plateforme.

## Calculateur de retour sur investissement {#roi-calculator}

Ouvrez **Credits** (Crédits) et accédez à l'onglet **Calculate ROI** (Calculer le retour sur investissement) pour utiliser le calculateur de retour sur investissement interactif. Il est pré-rempli avec votre activité récente réelle (vos déploiements et dépenses) et vous permet d'ajuster les hypothèses — déploiements mensuels, temps de déploiement manuel, coût horaire de l'ingénieur et pourcentage d'économie de temps — pour estimer votre coût de main-d'œuvre, le coût de la plateforme, les économies nettes et le retour sur investissement. Il s'agit uniquement d'un estimateur : il ne déploie jamais rien et ne débite jamais votre compte.

## Voir ce que vous avez dépensé {#seeing-what-youve-spent}

Vous pouvez consulter vos dépenses de deux manières sur la page **Crédits**. **Transactions de crédits** liste chaque attribution, achat et débit de déploiement sur votre compte, filtrable par déploiement et par date. **Transactions de projet** — disponible lorsque les crédits de projet sont activés — détaille la partie projet par projet Google Cloud, montrant les crédits débités et le coût cloud sous-jacent pour chacun sur une période que vous choisissez.

Le reporting à l'échelle de la plateforme est encore restreint : les onglets **Coûts des modules** et **Factures de projet** et toute la page **Facturation** sont limités aux administrateurs et aux utilisateurs financiers. Si vous avez besoin d'une facture formelle, demandez-la via le formulaire de support.

## Projets liés {#linked-projects}

**Crédits → Projets liés** permet à RAD de payer Google pour un projet Google Cloud que vous possédez et gérez déjà. Vous prépayez des crédits, et RAD les débite toutes les heures pour l'utilisation du projet. Le projet conserve son ID, ses données et votre contrôle total ; RAD n'a pas accès à vos données ou ressources.

L'onglet indique d'abord **vos conditions** : votre taux de TVA (ou que le service financier en confirmera un avant le lien), si les propres crédits de Google — allocations gratuites, remises d'utilisation, crédits promotionnels — vous sont transmis (par défaut, ils ne le sont pas, et l'utilisation est facturée au prix catalogue de Google plus la marge de RAD), et le **seuil** : le solde minimum de crédits achetés que vous devez maintenir, affiché par rapport à ce que vous détenez. Les crédits offerts et les crédits d'événement ne sont pas pris en compte.

Pour lier un projet :

1. Entrez l'**ID du projet Google Cloud** et choisissez **Continuer**.
2. **Confirmez que vous êtes propriétaire du projet** — la même vérification d'étiquette utilisée lorsque vous déployez dans votre propre projet (un propriétaire ou un éditeur de projet ajoute l'étiquette). Un projet que vous avez déjà vérifié vous est proposé.
3. **Laissez RAD gérer le lien de facturation du projet** — exécutez les deux commandes affichées, en tant que propriétaire du projet. Elles donnent à l'identité de facturation de RAD les rôles de **Navigateur** et de **Gestionnaire de projet de facturation** : suffisamment pour attacher ou détacher un compte de facturation, et rien de plus.
4. **Plafonnez vos quotas d'API Gemini et de GPU** dans la console Google Cloud, car ceux-ci peuvent dépenser plus rapidement que votre solde ne peut couvrir. Cochez la case confirmant que vous avez accordé les deux rôles et plafonné les quotas.
5. Choisissez **Demander le lien**. L'équipe financière de RAD examine la demande ; la liste ci-dessous indique son statut (**En attente d'approbation**, **Liaison en cours**, **Lié**, **En pause**, **Déliaison en cours**, **Délié**, **Rejeté**, **Retiré**), et un rejet indique la raison du service financier. Vous pouvez envoyer une demande en dessous du seuil, mais elle ne peut être approuvée tant que vous ne le détenez pas.

Tant qu'un projet est lié :

- Si votre solde acheté tombe en dessous du seuil, RAD **met en pause** le projet en détachant la facturation : ses services s'arrêtent, mais vos données sont conservées. RAD vous envoie un e-mail avant que cela ne se produise, et l'achat de crédits au-dessus du seuil le reprend automatiquement.
- **Retirer** annule une demande qui n'a pas été approuvée. **Arrêter** (derrière une confirmation, **Arrêter le paiement de RAD**) détache le compte de facturation de RAD. Si aucun autre compte de facturation n'est lié, les services du projet s'arrêtent — liez d'abord votre propre compte de facturation s'il doit continuer à fonctionner. Lier votre propre compte de facturation au projet met également fin à la participation de RAD.
- L'utilisation jusqu'au moment où la facturation est détachée est toujours facturée une fois que Google la signale.

## Notifications par e-mail {#email-notifications}

Choisissez les e-mails que RAD vous envoie sur votre page **Profil**, sous **Paramètres de notification par e-mail**. **Déploiements** couvre tous les e-mails concernant vos déploiements — résultats de build, e-mails de lab, et les avertissements que RAD envoie avant de supprimer définitivement quelque chose qui vous appartient. **Facturation** couvre les e-mails de crédit et de paiement. (Le personnel de support voit également **Ticket de support qui m'est assigné**.) Un e-mail ignore ces paramètres : si une build coûte plus de crédits que vous n'en avez, vous êtes toujours informé de ce que vous devez, car cela explique pourquoi votre prochaine recharge vous donne moins.

Désactiver les **Déploiements** arrête tous ces e-mails, y compris les avertissements. Étant donné que RAD ne supprime jamais rien définitivement sans vous avertir au préalable, ces suppressions sont **retenues** lorsque le paramètre est désactivé : un projet géré par RAD dont la facturation a été désactivée par manque de crédits n'est pas supprimé, et un déploiement supprimé de votre liste après la période de rétention est conservé plutôt que définitivement effacé. Lorsque vous réactivez les e-mails de déploiement, les avertissements sont envoyés. Pour un enregistrement de déploiement retenu, la période de préavis complète commence à partir de cet avertissement. Pour un projet géré par RAD retenu, le projet peut être supprimé dès le lendemain, alors agissez immédiatement sur cet avertissement.

## Projets clients {#client-projects}

Lorsque la plateforme le propose, les projets clients se trouvent sur **Solutions → Environnements gérés**, après les catalogues. Cela fonctionne des deux côtés.

**Exécuté pour vous.** Tout ce que quelqu'un d'autre a configuré pour vous — une place dans une session de lab d'un formateur, ou un projet client qu'un partenaire exécute pour vous — est listé ensemble sous **Solutions → Environnements gérés → Exécuté pour vous**, quel que soit le type. La vue **Exécuté pour vous** n'apparaît que lorsque quelque chose est exécuté pour vous, y compris une invitation que vous n'avez pas encore acceptée. Tant que cette vue est ouverte, la bannière du lab en haut de la page s'efface, car les mêmes détails y sont affichés.

**Si quelqu'un exécute un projet pour vous.** Un partenaire ou un autre utilisateur RAD peut vous inviter à un projet client qu'il exécute pour vous en tant que service géré. Vous recevrez un e-mail. Connectez-vous avec l'**adresse exacte à laquelle il a été envoyé**, en créant un compte si vous n'en avez pas, et confirmez votre adresse e-mail si RAD le demande. Ensuite, ouvrez **Solutions → Environnements gérés → Exécuté pour vous** et choisissez **Accepter** sous **Invitations pour vous**.

- Le projet apparaît alors sous **Projets exécutés pour vous**, et ce qu'ils déploient pour vous apparaît dans vos **Déploiements**. C'est le vôtre : ils le construisent et l'exécutent.
- Vous ne payez pas RAD pour cela. Ses coûts proviennent d'un solde que l'abonné finance ; tout accord entre vous deux est convenu en dehors de RAD.
- Tant qu'ils le gèrent, vous pouvez le voir, mais seuls eux peuvent le modifier ou le supprimer. Vous pouvez lire ses valeurs secrètes, telles que les mots de passe et les clés API ; ils ne le peuvent pas.
- Si leur solde devient faible, le projet peut être mis en pause (rien n'est supprimé) et vous recevez un e-mail. S'il n'est pas rechargé à temps, il est supprimé, et vous en êtes informé.
- À la fin, ils peuvent vous le **transférer**. Il fonctionne alors sur vos propres crédits, comme tout ce que vous déployez vous-même, et ils n'y ont plus accès. Vous aurez besoin de suffisamment de crédits achetés pour maintenir un projet de production en cours d'exécution.

**Si vous exécutez des projets pour vos clients**, consultez le [Guide des projets clients](client-projects-guide.md). En démarrer un nécessite des crédits achetés ; gérer un que vous exécutez déjà ne le fait pas.

## Obtenir de l'aide {#getting-help}

Ouvrez **Aide** et utilisez l'onglet **Envoyer un message** pour poser une question ou signaler un problème. Remplissez le formulaire pour envoyer votre message — cela ouvre un ticket de support et avertit l'équipe de support, qui vous contactera. L'ouverture d'un ticket nécessite des crédits achetés (un abonnement ou une recharge) tant que les crédits sont en vente ; sans aucun, le formulaire affiche une invite à acheter des crédits à la place. Tant que la plateforme ne vend pas de crédits, n'importe qui peut ouvrir un ticket. Vous pouvez ouvrir jusqu'à 5 tickets en 24 heures. Un lien **Contactez-nous** dans le pied de page vous mène également à la page d'aide ; pour suggérer une amélioration à la place, utilisez le lien **Commentaires** à côté, qui ouvre le tableau de commentaires public de RAD.

Vos tickets se trouvent dans l'onglet **Mes tickets**, à côté de **Envoyer un message**, les plus récents en premier : chacun affiche son statut (**Nouveau**, **En cours**, **Résolu** ou **Fermé**), son sujet et la date d'envoi, et en développant un, vous verrez sa catégorie, sa priorité, son module, la date de résolution et votre message. **Actualiser** recharge la liste. L'envoi d'un ticket vous mène directement à cet onglet, de sorte que celui que vous venez d'ouvrir est ce que vous voyez.

Si vous n'avez plus besoin d'aide pour un ticket qui n'est pas fermé, développez-le et choisissez **Retirer le ticket**, puis confirmez. Le ticket est fermé et apparaît comme **Retiré**, et le support voit que vous l'avez retiré, donc personne ne continue à y travailler. Il n'est pas supprimé : il reste dans votre liste. Vous pouvez ouvrir un nouveau ticket à tout moment.

## Inviter d'autres personnes {#inviting-others}

Votre lien de parrainage se trouve sur votre **Profil**, dans la section **Parrainer et gagner** (la page **Crédits** a également un bouton **Lien de parrainage** qui vous y mène). Les personnes qui s'inscrivent par ce biais sont liées à votre compte, et vous gagnez des crédits de parrainage pour elles, sous réserve de toute limite mensuelle fixée par la plateforme. La section indique combien de vos parrainages vous ont rapporté des crédits ce mois-ci et au total — un simple décompte, jamais leur identité. Elle n'est masquée que lorsque la plateforme a désactivé les récompenses de parrainage.
