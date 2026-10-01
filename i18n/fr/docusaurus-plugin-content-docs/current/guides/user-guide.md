---
title: "Guide de l'utilisateur"
description: "Guide de l'utilisateur de la plateforme RAD — construire une solution à partir d'une simple description, déployer des modules et des solutions sur Google Cloud, gérer vos déploiements, ainsi que les crédits et les abonnements."
---
<!-- translated-from: docs/guides/user-guide.md @ 6b90c32 sha256:e92d1cfe945b -->

# Guide de l'utilisateur {#user-guide}

<img src="https://storage.googleapis.com/rad-public-2b65/guides/User_Guide.png" alt="Guide de l'utilisateur" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ce guide s'adresse à toute personne qui utilise RAD pour déployer et gérer des modules cloud — le rôle **User** (utilisateur) par défaut. Vous découvrez RAD ? Commencez par [Utiliser RAD](using-rad.md).

## Ce que vous pouvez faire {#what-you-can-do}

- Répondre à quatre questions simples dans **Build Solution with AI** et laisser RAD déterminer les applications dont vous avez besoin et le coût de l'ensemble, puis les déployer.
- Parcourir le catalogue de modules dans **Solutions → Solution Catalog → RAD modules** et déployer des modules prêts à l'emploi à l'aide d'un formulaire guidé.
- Suivre et gérer vos propres **Deployments** (déploiements) — consulter les résultats et les journaux, mettre à jour et supprimer.
- Gérer vos **Credits** (crédits) — consulter votre solde, examiner l'historique de vos transactions et en acheter davantage tant que la plateforme vend des crédits.
- Souscrire une formule de crédits récurrente, lorsque des formules sont proposées.
- Estimer vos économies avec **Calculate ROI**, sur la page **Credits**.
- Obtenir de l'aide via le formulaire **Send Message** de **Help**.
- Inviter d'autres personnes avec votre lien de parrainage, depuis **Profile → Refer and earn**.
- Exploiter des projets pour vos propres clients (en démarrer un nécessite des crédits achetés), ou accepter un projet que quelqu'un exploite pour vous, dans **Solutions → Managed Environments**. Voir [Projets clients](#client-projects).

Après votre connexion, vous arrivez sur **Solutions** : sur **Solution Catalog**, en vue **All**, si vous disposez de crédits achetés (un abonnement ou une recharge), sinon sur **Solution Catalog → RAD modules**. Les onglets sont, dans l'ordre : **Build Solution with AI**, **Solution Catalog**, puis **Managed Environments**, qui contient les projets clients (tant que la plateforme les propose), les sessions de lab pour les formateurs, Finance et les administrateurs (tant qu'elles sont activées), et tout ce que quelqu'un d'autre exploite pour vous.

**Solutions** regroupe tout ce que vous pouvez déployer, sur deux onglets :

- **Build Solution with AI** — quatre questions qui aboutissent à une solution fonctionnelle et chiffrée. Commencez ici si vous savez ce que vous voulez accomplir sans savoir comment cela s'appelle.
- **Solution Catalog** — tout ce qui est prêt à être déployé, avec un filtre par type en haut et un bouton **New solution** à côté, qui ouvre **Build Solution with AI** :
  - **All** — tous les types sur une seule page, chacun sous son propre titre ; un type qui n'a rien à afficher est omis.
  - **My solutions** — les ensembles que vous avez composés vous-même.
  - **RAD solutions** — des ensembles prêts à l'emploi sélectionnés par RAD.
  - **RAD modules** — le catalogue complet des applications individuelles.

Votre navigation supérieure affiche **Credits** (lorsque les crédits sont activés), **Deployments**, **Solutions** et **Help**.

## Construire une solution à partir d'une description {#building-a-solution-from-a-description}

**Build Solution with AI** et la composition de vos propres solutions nécessitent des **crédits achetés** (une recharge ou un abonnement ; les crédits gratuits d'inscription, mensuels et de parrainage ne comptent pas). Les partenaires en disposent toujours. Sans crédits achetés, vous voyez toujours les deux, verrouillés, avec une note sur ce qui les déverrouille et un bouton **Buy credits** tant que la plateforme vend des crédits, et les solutions que vous avez déjà enregistrées restent listées : vous pouvez encore les déployer ou les supprimer, mais pas les modifier. Le déploiement pour un projet client que vous gérez fait exception : c'est le portefeuille du client qui paie, donc cela fonctionne quel que soit votre propre solde.

Dans **Solutions → Build Solution with AI** — également accessible directement à l'adresse **/build** — décrivez avec vos propres mots ce que vous voulez que les gens puissent faire, sans avoir besoin de noms d'applications. RAD détermine quelles applications le permettent, puis vous pose trois courtes questions :

1. **Où doit-elle s'exécuter ?** Votre propre projet Google Cloud est le choix par défaut : vous conservez la relation de facturation, les règles de votre organisation, et le projet lui-même par la suite. Choisir plutôt un **projet géré par RAD** place l'infrastructure dans l'organisation et le compte de facturation de RAD, et vous indiquez alors aussi à quoi sert l'environnement — faire des essais, pour vos développeurs, ou pour vos utilisateurs finaux. Un projet géré par RAD vous demande aussi de détenir un solde minimal de crédits achetés, que la page indique. Il s'agit d'une exigence de solde, et non d'un prélèvement.
2. **Où doit-elle résider ?** Choisissez l'emplacement le plus proche des personnes qui l'utiliseront. Votre propre projet peut utiliser n'importe quelle région Google Cloud ; un projet géré par RAD propose les emplacements pris en charge par RAD — le moins cher dans chaque partie du monde. RAD vérifie de nouveau ce point lors du déploiement : un emplacement hors de cette liste, dans n'importe quel paramètre d'emplacement (y compris un paramètre qui accepte plusieurs emplacements), est refusé avant que quoi que ce soit ne soit réservé ou construit, et le message indique le paramètre à modifier.
3. **Comment devons-nous l'appeler ?** Un nom pour votre propre usage, plus un nom court (jusqu'à sept lettres ou chiffres) utilisé à l'intérieur de vos ressources cloud. Réutilisez ce nom court plus tard pour partager les mêmes ressources cloud.

Si les applications proposées par RAD ne conviennent pas tout à fait, utilisez **Not quite? Tell us what to change** en dessous — indiquez ce qu'il faut ajouter ou retirer, et RAD retravaille l'ensemble au lieu de tout recommencer. Vous pouvez aussi retirer une seule application, ou utiliser **Start over** pour effacer à la fois vos réponses et la proposition.

Un panneau à côté des questions indique **ce que vous obtiendrez**, **ce que cela coûte** et **combien de temps cela prend** — le coût total, y compris les services partagés que RAD ajoute pour vous, réparti entre ce qui est prélevé lors du build et ce qui est mesuré à mesure que chaque partie se termine, accompagné d'une estimation de la durée du build, par exemple « about 1h 20m ». **Build this** l'enregistre sous **My solutions** et ouvre sa page de déploiement avec vos réponses déjà remplies ; vérifiez-la, puis choisissez **Deploy Solution**. **Show the engineering detail** l'enregistre de la même manière mais l'ouvre sur le formulaire de configuration complet, si vous préférez tout définir vous-même.

### Utiliser votre propre projet Google Cloud {#bringing-your-own-google-cloud-project}

Déployer dans un projet que vous possédez déjà signifie que le compte de service de déploiement de RAD effectue le travail à l'intérieur de celui-ci ; il doit donc d'abord y avoir accès. Avant tout déploiement, vous prouvez que vous contrôlez le projet : choisissez **Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet (par exemple dans Cloud Shell) — elles ajoutent un libellé de vérification et donnent à RAD un accès **Browser** en lecture seule — puis choisissez **Verify** ; le code expire au bout d'une heure. Vous accordez ensuite au compte de service de déploiement le rôle **Owner** sur le projet ; RAD indique le compte exact et affiche la commande. Si un autre compte RAD a déjà enregistré le même projet, vous y êtes ajouté en tant que collaborateur. Les crédits gratuits (offerts) peuvent payer un déploiement dans votre propre projet.

### Ce dont un projet géré par RAD a besoin {#what-a-rad-managed-project-needs}

Un projet géré par RAD exige deux choses avant que RAD puisse le créer : une **adresse e-mail vérifiée**, et un solde minimal de crédits **achetés** pour l'usage que vous avez choisi. Les crédits gratuits (offerts) — comme ceux que vous recevez à l'inscription — ne comptent pas pour ce minimum. Dès que vous choisissez cette option, la page indique combien de crédits achetés vous avez par rapport à ce qui est nécessaire, avec un lien **Buy credits**. L'en-tête affiche votre solde réparti entre crédits achetés et crédits gratuits pour la même raison.

## Trouver un module {#finding-a-module}

Ouvrez **Solutions**, choisissez l'onglet **Solution Catalog** et sélectionnez **RAD modules** dans le filtre par type pour parcourir le catalogue de modules. Les modules apparaissent sous forme de cartes.

- **Parcourir :** vous voyez un catalogue unique et combiné de modules publics — à la fois les modules publiés par RAD et les modules publics publiés par des partenaires.
- **Rechercher :** la barre de recherche au-dessus des onglets recherche dans tout le **Solution Catalog** — vos propres solutions, les solutions RAD et les modules RAD. Chaque mot que vous saisissez doit correspondre ; une correspondance dans le nom est classée en premier, puis les correspondances trouvées dans une description ou dans le contenu d'une solution. Votre recherche est conservée lorsque vous changez de type, et les compteurs sur **My solutions** et **RAD solutions** indiquent combien de correspondances chacun contient.
- **Filtrer par catégorie :** utilisez la liste des catégories à côté de la grille pour restreindre le catalogue à une catégorie. Elle apparaît lorsqu'un seul type (**RAD solutions** ou **RAD modules**) est sélectionné, et elle est masquée sur **All**, car les solutions et les modules utilisent des catégories différentes. Chaque entrée indique combien de modules elle contient ; **All** efface le filtre.
- **Parcourir les pages :** **All** affiche quatre éléments de chaque type par page ; un type unique en affiche davantage (24 modules RAD ou solutions RAD, 12 de vos propres solutions). Modifiez le nombre par page, jusqu'à 72, sous la liste.
- **Épingler :** cliquez sur l'épingle d'une carte pour garder un module favori en haut de votre catalogue et y accéder rapidement.
- **Lire chaque carte :** chaque carte affiche la description du module, un lien vers la **documentation**, une note moyenne en étoiles, le nombre de fois où il a été déployé, et son **prix**.
- **Lire le prix :** chaque carte du catalogue — module, solution de plateforme ou solution personnalisée — affiche son prix de la même manière : les **frais** (facturés une seule fois, lors de la création du déploiement) plus une estimation du **build** (mesuré à chaque build), par exemple `50 cr fee + ~19 cr build`. Un module sans frais affiche **Free module** ; son build reste facturé. Une solution qui bénéficie d'une remise groupée l'affiche : les frais avant remise sont barrés à côté des frais que vous payez. Un déploiement dans un projet géré par RAD peut aussi mettre en place au préalable un projet et des services partagés ; ce coût est affiché avant le déploiement.
- **Obtenir de l'aide sur un module :** cliquez sur **Help** sur une carte pour ouvrir la boîte de dialogue Get Support. Elle comporte trois onglets : **End User Support** ouvre un ticket de support concernant le module, **End User Training** demande une aide payante pour sa mise en place (RAD vous contacte sous un jour ouvré), et **Contact Publisher** envoie une question par e-mail à l'éditeur du module.

Une bande de statistiques en haut indique le nombre total de déploiements, votre solde de crédits actuel (lorsque les crédits sont activés) et la durée de conservation de l'historique des déploiements.

## Déployer un module {#deploying-a-module}

1. **Choisissez comment le configurer.** Cliquez sur une carte de module et choisissez **Conversational Assistant** ou **Configuration Form**. L'assistant est proposé par défaut si vous disposez de crédits achetés (toujours le cas pour les partenaires) ; sans crédits achetés, vous obtenez le formulaire, et l'assistant est affiché mais verrouillé jusqu'à ce que vous achetiez des crédits. Lorsque vous arrivez depuis **Build Solution with AI**, une solution s'ouvre sur le formulaire, puisque l'entretien vient de poser ses questions. L'assistant décrit tous les paramètres en une seule fois, puis n'applique que les modifications que vous acceptez — chaque modification proposée vous est présentée pour que vous l'appliquiez individuellement, de sorte que rien n'est défini sans votre accord. Vous pouvez passer de l'un à l'autre à tout moment. Il y a deux choses que l'assistant ne fera pas : il ne voit ni ne définit jamais un **secret** (une clé d'API ou un mot de passe) — il vous indique que le champ existe et vous saisissez la valeur dans la zone mise en évidence sur la page, jamais dans le chat — et il n'accepte pas une valeur qui enfreint la règle propre à un champ ; il vous indique quelle est la règle et vous demande une valeur corrigée plutôt que de modifier discrètement ce que vous avez saisi. De même, lorsque le déploiement est placé dans un projet géré par RAD, il refuse une région que ce projet ne peut pas utiliser et vous indique les régions autorisées.
2. **Ouvrez le formulaire.** Le formulaire de configuration guidé. La première fois que vous déployez un module, le formulaire n'affiche que les champs essentiels (obligatoires) — les champs administratifs et internes vous sont masqués, et la configuration avancée facultative est reportée. Vous pourrez déverrouiller l'ensemble des étapes de configuration plus tard, depuis l'action **Update** du déploiement : cochez **Enable advanced mode**, disponible dès que votre solde de crédits couvre le coût estimé de la mise à jour. Le mode avancé n'entraîne aucuns frais de module — les mises à jour n'en entraînent jamais — et il n'est pas disponible sur un environnement de lab.
3. **Remplissez la configuration.** Complétez les champs obligatoires de chaque étape (par exemple, le projet et la région). Passez à l'étape suivante lorsque chaque étape est valide. Le formulaire est généré à partir du module lui-même : lorsque le module déclare une règle pour un champ — un format de nom, une limite de longueur — vous voyez l'erreur propre à ce module pendant la saisie, plutôt que plusieurs minutes après le début d'un build qui échoue. Les champs contenant un secret (un jeton d'API, un mot de passe) sont masqués et stockés dans Google Secret Manager au lieu d'être enregistrés avec le reste de votre configuration ; comme la valeur ne revient jamais au navigateur, un tel champ affiche **Configured** ou **Not configured** à la place, et laisser vide un champ déjà configuré le conserve au lieu de l'effacer. La plupart des modules d'application construisent leur propre image de conteneur : tant que **Container Image Source** vaut « custom », une note sous **Container Image** indique que ce champ est ignoré. Choisissez « prebuilt » pour déployer plutôt l'image que vous saisissez.
4. **Confirmez.** Le panneau **What will be deployed** en haut du formulaire liste tout ce que ce déploiement construit — dans un projet géré par RAD, cela inclut le projet Google Cloud et les services partagés — et marque chaque élément **Will be created**, **Will be updated first**, **Already exists, reused** (gratuit) ou **Needs attention first** ; vous ne pouvez pas déployer tant qu'un élément nécessite votre attention. Avant le lancement, une boîte de dialogue de confirmation peut apparaître — par exemple lorsque le module coûte des crédits, a des dépendances ou nécessite des autorisations particulières. Vérifiez les détails, notamment le nombre de crédits que coûtera le déploiement.
5. **Déployez.** Cliquez sur **Deploy Module** pour mettre le déploiement en file d'attente. Si vous n'avez pas assez de crédits, RAD affiche le coût en crédits du module par rapport à votre solde actuel et vous invite d'abord à recharger.

**Et ensuite :** votre déploiement est mis en file d'attente puis provisionné sur Google Cloud. RAD ouvre la page propre au déploiement sur son onglet **Build Status** afin que vous puissiez suivre sa progression ; il est aussi listé sur la page **Deployments**.

## Déployer une solution {#deploying-a-solution}

Une **solution** déploie plusieurs modules ensemble comme une seule unité, dans le bon ordre, au sein d'un même tenant. Cliquez sur **Solutions** dans la navigation supérieure. Les ensembles prêts à déployer se trouvent dans **Solution Catalog → RAD solutions** et **Solution Catalog → My solutions** ; **Build Solution with AI** et **Solution Catalog → RAD modules** sont décrits ci-dessus.

Les **RAD solutions** sont composées à l'avance par RAD — parcourez-les par catégorie, ouvrez-en une pour voir ses membres, remplissez une seule fois la configuration partagée, et déployez l'ensemble complet. Les membres qui dépendent d'un autre l'attendent automatiquement.

Une solution de trois membres ou plus coûte moins cher que le déploiement des mêmes modules un par un : ses **frais de module** bénéficient d'une remise de 15 % pour trois ou quatre membres, 20 % pour cinq ou six, et 25 % pour sept ou plus. La remise ne porte que sur les frais de module — le temps de build, ainsi que les coûts propres à un projet géré par RAD, sont facturés normalement. La boîte de dialogue de confirmation indique la remise appliquée.

Vos propres solutions (**Solution Catalog → My solutions**) sont composées en conversation. Décrivez ce que vous voulez construire — « J'ai besoin d'un site marketing avec un blog et des campagnes d'e-mailing » — et RAD suggère des modules du catalogue avec une brève justification pour chacun. Ajoutez ceux que vous voulez (jusqu'à 12), donnez-lui un nom et enregistrez-la. Vos solutions personnalisées sont privées.

- Une solution enregistrée affiche **Draft** jusqu'à ce que vous la déployiez, puis **Deployed**. Un brouillon peut être modifié sur place ; une fois la solution déployée, la modification propose plutôt de la copier dans un nouveau brouillon, afin que la trace de ce que vous avez réellement construit reste exacte.
- **Épinglez** une solution que vous utilisez souvent pour la garder en haut de **My solutions**, comme vous pouvez épingler une solution RAD ou un module.
- **Delete** supprime uniquement la solution enregistrée. Elle ne touche jamais à l'infrastructure que vous avez déjà déployée — supprimez celle-ci depuis la page **Deployments**.
- RAD ne relie des membres entre eux que lorsqu'une connexion connue existe entre ces deux applications. Lorsque deux membres n'ont pas de telle connexion, RAD l'indique sur la carte plutôt que de faire une supposition — ils se déploient quand même, il vous suffit de les relier vous-même s'ils doivent communiquer.

## Gérer vos déploiements {#managing-your-deployments}

Cliquez sur **Deployments** pour voir vos déploiements. Chaque ligne indique le module, l'identifiant du déploiement, une **note en étoiles** modifiable, sa date de création, sa durée, son statut et l'action disponible. Il n'y a pas de colonne projet ni de colonne crédits — ouvrez un déploiement pour voir son projet, et son onglet **Builds** pour voir ce que chaque build a consommé.

Les statuts de déploiement sont notamment Queued, Pending, Working, Waiting (en attente de la fin d'un déploiement prérequis), Success, Failure, Internal Error, Deleting, Deleted, Cancelled, Timeout et Expire.

Ouvrez un déploiement pour voir ses détails, qui comportent les onglets suivants :

- **Outputs** — commence par la page à ouvrir : **First-time setup** lorsque l'application doit être configurée avant sa première utilisation, **Open application** sinon, ou — pour un module sans interface web — l'adresse de l'API à laquelle se connecter. En dessous figurent les autres résultats non sensibles (comme les adresses et points de terminaison exportés par le module). Ils apparaissent une fois le déploiement réussi.
- **Build Status** — les journaux en direct, utiles pour suivre la progression ou diagnostiquer un échec. Une fois le déploiement réussi, **Explain this** ouvre une explication en langage courant des ressources Google Cloud qu'il a créées, rédigée pour quelqu'un qui ne lit pas Terraform. Elle n'envoie que les *types* de ressources concernés et leur nombre — jamais l'identifiant de votre projet, les noms des ressources, les adresses e-mail ni aucune valeur configurée. Elle renvoie aussi vers la page de documentation propre au module, afin que l'explication repose sur le fonctionnement réel de ce module plutôt que sur des connaissances générales. Sur une étape qui a *échoué*, **Search for a fix** ouvre une recherche construite à partir de l'erreur réelle affichée par l'étape, et **Ask for help** ouvre une demande de support avec cette même sortie en pièce jointe. Lorsque le script d'un module a échoué, la recherche utilise ce que le script a affiché plutôt que le script lui-même, et elle omet ce qui vous identifie : les adresses e-mail, les identifiants de projet, les adresses de service, les adresses IP et les noms que RAD a donnés à vos ressources. **Download** enregistre l'intégralité du journal dans un fichier texte, avec les secrets masqués.
- **Builds** — l'historique des builds du déploiement.

Depuis la vue détaillée, vous pouvez aussi :

- **Update** — rouvrir le formulaire de configuration (prérempli avec les valeurs actuelles), modifier ce dont vous avez besoin et réappliquer. Disponible une fois qu'un déploiement est terminé — réussi, échoué, expiré par délai, annulé ou arrivé à expiration. La mise à jour nécessite aussi des crédits *achetés* sur votre compte : si vous ne détenez que des crédits offerts, RAD affiche un message **Credits Required** au lieu d'ouvrir le formulaire, avec un bouton **Top Up Credits** menant à **Buy Credits** tant que la plateforme vend des crédits.

  Deux choses peuvent bloquer une mise à jour avant que vous n'arriviez au formulaire. Si ce déploiement dépend d'un autre qui a **échoué**, a été annulé ou a expiré, RAD refuse et liste les déploiements à démarrer d'abord — corrigez-les, puis réessayez. (Un prérequis encore en cours de build ne pose pas de problème : la mise à jour est acceptée et mise en attente jusqu'à sa fin.) Et si vous modifiez un paramètre qui ne peut pas être changé sur un déploiement en cours d'exécution — une région, une clé de chiffrement, un commutateur qui crée une ressource — RAD affiche une confirmation indiquant exactement quels paramètres vont détruire et reconstruire des ressources. Lorsque votre administrateur a activé **Enforce Update Safe**, ces champs sont plutôt en lecture seule, et la seule façon d'en modifier un est de supprimer le déploiement et d'en créer un nouveau.
- **Cancel** — affiché tant qu'un déploiement est à l'état Queued ou Waiting, avant le début de son build. L'annulation le libère afin que vous puissiez réessayer, et un déploiement Waiting annulé libère aussi tout ce qui attend derrière lui. Le même bouton apparaît pour une purge restée une heure sans progresser.
- **Delete** — supprimer le déploiement. Deux choix s'offrent à vous :
  - **Delete** lance une suppression qui détruit les ressources cloud créées par le déploiement. Cela inclut un projet GCP géré par RAD (l'option « GCP Project on RAD ») : comme sa suppression emporte tout le projet, RAD refuse tant qu'un autre déploiement est encore en cours d'exécution dans ce projet et liste ceux à supprimer d'abord. Google conserve un projet supprimé récupérable pendant environ 30 jours.
  - **Purge** retire le déploiement de RAD *sans* détruire les ressources cloud. Utilisez Purge lorsqu'un déploiement est bloqué ou a été modifié en dehors de RAD.

  Un déploiement qui fait partie d'une solution ne peut être supprimé ou purgé que depuis la page de la solution.

Pour **noter un module**, revenez à la liste **Deployments** et cliquez sur les étoiles de la ligne de ce déploiement — la note ne se définit pas depuis la page de détails, et vous ne pouvez noter que les déploiements que vous avez effectués vous-même.

## Crédits {#credits}

Ouvrez la page **Credits** pour gérer votre solde.

Vos crédits sont répartis en quatre soldes distincts, qui se comportent différemment :

- **Awards** (crédits offerts) — des crédits gratuits : votre dotation d'inscription, les dotations mensuelles et les récompenses de parrainage. Ils sont réinitialisés chaque mois.
- **Event credits** (crédits d'événement) — des crédits gratuits obtenus avec un code d'événement (voir ci-dessous). Ils expirent à leur propre date, indiquée lorsque vous les réclamez, plutôt qu'avec la réinitialisation mensuelle.
- **Subscription** (abonnement) — des crédits issus d'une formule d'abonnement. Lorsque la plateforme est configurée pour les réinitialiser, un renouvellement remplace l'allocation au lieu de s'y ajouter.
- **Top-up** (recharge) — des crédits que vous avez achetés directement, en une seule fois. Ils n'expirent jamais.

Les dépenses puisent d'abord dans les crédits offerts, puis dans les crédits d'événement, puis dans l'abonnement, puis dans la recharge — de sorte que les crédits qui expirent le plus tôt sont utilisés en premier, et que ceux que vous avez achetés directement sont conservés jusqu'à la fin.

Le déploiement d'un module entraîne deux prélèvements. Les **frais de module** sont réservés lorsque vous confirmez et facturés lorsque le déploiement réussit pour la première fois — y compris lorsqu'un déploiement en échec est ensuite corrigé par une mise à jour. Le **coût de build** est mesuré selon la durée réelle d'exécution de chaque build, au tarif en crédits par heure de build de la plateforme, et facturé à la fin de chaque build.

**La boîte de dialogue de confirmation chiffre toute la chaîne, et pas seulement l'application que vous avez choisie.** Un déploiement dans un projet géré par RAD crée aussi votre projet Google Cloud privé et les services partagés qu'utilisent vos applications, et ceux-ci ont leurs propres coûts — la boîte de dialogue les liste sous *« RAD also sets these up for you »* avec un total combiné. Elle distingue aussi ce qui est réservé lorsque vous confirmez de ce qui est mesuré à la fin de chaque build, afin que le second prélèvement ne soit pas une surprise. Les coûts de build restent des estimations jusqu'à la fin du build, le montant final peut donc légèrement différer.

La mise à jour d'un déploiement ne facture que le coût de build.

**Déploiements en échec.** La facturation d'un déploiement qui échoue relève d'un paramètre de la plateforme plutôt que d'une règle fixe : Finance décide, séparément pour le coût de build et pour les frais de module, si l'un ou l'autre est prélevé lorsqu'un nouveau déploiement échoue ou est annulé. **Dans la version actuelle, aucun des deux n'est facturé — un déploiement en échec ne vous coûte rien.** Une mise à jour ou une suppression en échec n'est pas facturée non plus.

La page Credits comporte les onglets suivants :

- **Credit Transactions** — l'historique complet de vos crédits offerts, achats et dépenses, avec un solde **Awards**, **Top-up** et **Subscription** après chaque entrée. Filtrez par déploiement et par date, et utilisez **Export CSV** pour télécharger un rapport.
- **Project Transactions** (lorsque les crédits de projet sont activés) — ce que chaque projet Google Cloud vous a coûté, une ligne par projet, avec une recherche par projet et une période. Une facturation de projet arrive dans Credit Transactions sous la forme d'une seule ligne combinée couvrant tous vos projets à la fois ; cet onglet en est le détail.
- **Subscriptions** (uniquement tant que la plateforme vend des crédits) — souscrire une formule de crédits récurrente, ou résilier ou réactiver celle que vous avez.
- **Buy Credits** (uniquement tant que la plateforme vend des crédits) — recharger votre solde.
- **Calculate ROI** — le calculateur de ROI décrit ci-dessous, toujours le dernier onglet.

La possibilité d'acheter des crédits dépend d'un seul commutateur de la plateforme. Tant qu'il est désactivé, il n'y a ni nouvel abonnement ni recharge ponctuelle, et les deux onglets ci-dessus ne sont pas affichés ; si vous avez déjà un abonnement, un avis sur **Credit Transactions** vous permet toujours de le résilier.

**Pour acheter des crédits :** ouvrez l'onglet **Buy Credits**, choisissez un prestataire de paiement, une devise et un montant, puis finalisez le paiement sur la page sécurisée du prestataire. Le formulaire affiche la recharge minimale (fixée par l'équipe financière de RAD, en USD) convertie dans votre devise, et il vous indique combien de crédits le montant permettra d'acheter avant que vous ne payiez. Vos crédits sont ajoutés automatiquement dès que le paiement est confirmé.

Certains déploiements exigent des crédits *achetés* (abonnement ou recharge, et non des crédits offerts ou d'événement) avant de pouvoir être lancés — dans ce cas, achetez d'abord des crédits, même si vous disposez d'un solde gratuit.

**Codes d'événement.** Un événement d'un partenaire RAD peut vous fournir un code donnant droit à des crédits gratuits. Saisissez-le dans la zone de code d'événement en haut de l'onglet **Credit Transactions** de **Credits** et choisissez **Claim credits**, ou ouvrez le lien fourni lors de l'événement, qui remplit le code pour vous (vous choisissez toujours **Claim credits**). Chaque code ne peut être réclamé qu'une fois par compte et nécessite une adresse e-mail vérifiée ; certains codes sont réservés à des participants ou à des domaines de messagerie précis, et chaque code a une date de clôture. Les crédits d'événement paient les frais de module et le temps de build, mais pas l'utilisation de Google Cloud dans un projet géré par RAD, et ils ne comptent pas pour le minimum de crédits achetés qu'exige un projet géré par RAD.

## Abonnements {#subscriptions}

Un abonnement est une formule récurrente facultative qui accorde un nombre fixe de crédits à chaque cycle de facturation.

- **S'abonner :** choisissez une formule et finalisez le paiement via le prestataire de paiement de votre choix. Vous ne pouvez détenir qu'un seul abonnement à la fois — pour passer à un autre palier, ou à un autre prestataire de paiement, résiliez d'abord celui que vous avez et attendez qu'il prenne fin à l'issue de la période de facturation en cours.
- **Résilier :** arrête les renouvellements futurs. Vos crédits restants demeurent disponibles jusqu'à ce que vous les dépensiez.
- **Réactiver :** reprend les renouvellements automatiques d'une formule résiliée si vous changez d'avis.

Un abonnement accorde uniquement des crédits — il ne modifie pas votre rôle sur la plateforme.

## Calculateur de ROI {#roi-calculator}

Ouvrez **Credits** et allez dans l'onglet **Calculate ROI** pour utiliser le calculateur de ROI interactif. Il est prérempli avec votre activité récente réelle (vos déploiements et vos dépenses) et vous permet d'ajuster des hypothèses — nombre de déploiements mensuels, temps de déploiement manuel, coût horaire d'un ingénieur et pourcentage de temps gagné — afin d'estimer votre coût de main-d'œuvre, le coût de la plateforme, vos économies nettes et votre retour sur investissement. Ce n'est qu'un outil d'estimation : il ne déploie jamais rien et ne prélève rien sur votre compte.

## Voir ce que vous avez dépensé {#seeing-what-youve-spent}

Vous pouvez consulter vos propres dépenses de deux manières sur la page **Credits**. **Credit Transactions** liste chaque crédit offert, chaque achat et chaque prélèvement lié à un déploiement sur votre compte, filtrable par déploiement et par date. **Project Transactions** — disponible dès que les crédits de projet sont activés — détaille la partie projet par projet Google Cloud, en indiquant les crédits débités et le coût cloud sous-jacent pour chacun sur une période que vous choisissez.

Les rapports à l'échelle de la plateforme restent restreints : les onglets **Module Costs** et **Project Invoices** ainsi que toute la page **Billing** sont réservés aux administrateurs et aux utilisateurs Finance. Si vous avez besoin d'une facture officielle, faites-en la demande via le formulaire de support.

## Notifications par e-mail {#email-notifications}

Choisissez les e-mails que RAD vous envoie sur votre page **Profile**, sous **Email Notification Settings**. **Deployments** couvre tous les e-mails concernant vos déploiements — résultats de build, e-mails de lab, et les avertissements que RAD envoie avant de supprimer définitivement quelque chose qui vous appartient. **Billing** couvre les e-mails de crédits et de paiement. (Le personnel de support voit aussi **Support ticket assigned to me**.) Un e-mail ignore ces paramètres : si un build coûte plus de crédits que vous n'en avez, vous êtes toujours informé de ce que vous devez, car cela explique pourquoi votre prochaine recharge vous en rapporte moins.

Désactiver **Deployments** arrête tous ces e-mails, y compris les avertissements. Comme RAD ne supprime jamais rien définitivement sans vous avoir averti au préalable, ces suppressions sont **suspendues** tant que le paramètre est désactivé : un projet géré par RAD dont la facturation a été désactivée faute de crédits n'est pas supprimé, et un déploiement retiré de votre liste après la période de conservation est conservé plutôt qu'effacé définitivement. Lorsque vous réactivez les e-mails de déploiement, les avertissements sont envoyés. Pour un enregistrement de déploiement suspendu, le délai de préavis complet court à partir de cet avertissement. Pour un projet géré par RAD suspendu, le projet peut être supprimé dès le lendemain : agissez donc immédiatement après cet avertissement.

## Projets clients {#client-projects}

Lorsque la plateforme les propose, les projets clients se trouvent dans **Solutions → Managed Environments**, après les catalogues. Cela fonctionne dans les deux sens.

**Run for you.** Tout ce que quelqu'un d'autre a mis en place pour vous — une place dans la session de lab d'un formateur, ou un projet client qu'un partenaire exploite pour vous — est listé ensemble sous **Solutions → Managed Environments → Run for you**, quel qu'en soit le type. La vue **Run for you** n'apparaît que tant que quelque chose est exploité pour vous, y compris une invitation que vous n'avez pas encore acceptée. Tant que cette vue est ouverte, la bannière de lab en haut de la page s'efface, puisque les mêmes informations y sont affichées.

**Si quelqu'un exploite un projet pour vous.** Un partenaire ou un autre utilisateur RAD peut vous inviter à un projet client qu'il exploite pour vous sous forme de service géré. Vous recevrez un e-mail. Connectez-vous avec **l'adresse exacte à laquelle il a été envoyé**, en créant un compte si vous n'en avez pas, et confirmez votre adresse e-mail si RAD vous le demande. Ouvrez ensuite **Solutions → Managed Environments → Run for you** et choisissez **Accept** sous **Invitations for you**.

- Le projet apparaît alors sous **Projects run for you**, et ce qu'il déploie pour vous apparaît dans vos **Deployments**. Il vous appartient : c'est lui qui le construit et l'exploite.
- Vous ne payez pas RAD pour ce projet. Ses coûts sont prélevés sur un solde que l'abonné alimente ; tout arrangement entre vous deux est convenu en dehors de RAD.
- Tant qu'il le gère, vous pouvez le voir, mais lui seul peut le modifier ou le supprimer. Vous pouvez lire ses valeurs secrètes, comme les mots de passe et les clés d'API ; lui ne le peut pas.
- Si son solde s'épuise, le projet peut être mis en pause (rien n'est supprimé) et vous recevez un e-mail. S'il n'est pas rechargé à temps, il est supprimé, et vous en êtes informé.
- À la fin, il peut vous **transférer** le projet. Celui-ci fonctionne alors sur vos propres crédits, comme tout ce que vous déployez vous-même, et il n'y a plus accès. Vous aurez besoin de suffisamment de crédits achetés pour maintenir un projet de production en fonctionnement.

**Si vous exploitez des projets pour vos clients**, consultez le [Guide des projets clients](client-projects-guide.md). En démarrer un nécessite des crédits achetés ; gérer un projet que vous exploitez déjà n'en nécessite pas.

## Obtenir de l'aide {#getting-help}

Ouvrez **Help** et utilisez l'onglet **Send Message** pour poser une question ou signaler un problème. Remplissez le formulaire pour envoyer votre message — cela ouvre un ticket de support et prévient l'équipe de support, qui reviendra vers vous. Ouvrir un ticket nécessite des crédits achetés (un abonnement ou une recharge) tant que des crédits sont en vente ; sans crédits achetés, le formulaire vous invite plutôt à en acheter. Tant que la plateforme ne vend pas de crédits, tout le monde peut ouvrir un ticket. Vous pouvez ouvrir jusqu'à 5 tickets sur 24 heures. Un lien **Contact Us** dans le pied de page mène aussi à la page Help.

Vos tickets se trouvent dans l'onglet **My Tickets**, à côté de **Send Message**, du plus récent au plus ancien : chacun indique son statut (**New**, **In progress**, **Resolved** ou **Closed**), son objet et la date d'envoi, et le déplier affiche sa catégorie, sa priorité, le module, la date de résolution et votre message. **Refresh** recharge la liste. L'envoi d'un ticket vous amène directement à cet onglet, de sorte que vous voyez celui que vous venez d'ouvrir.

Si vous n'avez plus besoin d'aide pour un ticket qui n'est pas clos, dépliez-le et choisissez **Withdraw ticket**, puis confirmez. Le ticket est clos et affiché comme **Withdrawn**, et le support voit que vous l'avez retiré, afin que personne ne continue à y travailler. Il n'est pas supprimé : il reste dans votre liste. Vous pouvez ouvrir un nouveau ticket à tout moment.

## Inviter d'autres personnes {#inviting-others}

Votre lien de parrainage se trouve sur votre **Profile**, dans la section **Refer and earn** (parrainer et gagner) ; la page **Credits** comporte aussi un bouton **Referral link** qui vous y mène. Les personnes qui s'inscrivent par ce lien sont rattachées à votre compte, et vous gagnez des crédits de parrainage pour elles, dans la limite mensuelle éventuellement fixée par la plateforme. La section n'est masquée que lorsque la plateforme a désactivé les récompenses de parrainage.
