---
title: "Utiliser RAD"
description: "Comment utiliser la plateforme RAD : connexion, navigation, rôles, déploiement de modules sur votre propre projet Google Cloud, crédits et facturation."
---

<!-- translated-from: docs/guides/using-rad.md @ 15fd4c7 sha256:b5fc13e8e800 -->

# Utiliser RAD {#using-rad}

<img src="https://storage.googleapis.com/rad-public-2b65/guides/Using_RAD.png" alt="Utiliser RAD" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ceci est la vue d'ensemble partagée pour tous ceux qui utilisent RAD. Elle couvre la connexion, la navigation, les rôles et les concepts fondamentaux (modules, déploiements, crédits, facturation et aide). Chaque guide de rôle renvoie ici pour les bases, puis se concentre sur ce que ce rôle fait.

---

## Qu'est-ce que RAD {#what-is-rad}

RAD (Rapid Application Deployment) est un portail web pour le déploiement de modules Google Cloud prêts à l'emploi sans écrire de code d'infrastructure. Vous choisissez un module, remplissez un formulaire de configuration guidé, et la plateforme le provisionne sur Google Cloud pour vous.

L'utilisation est mesurée en **crédits** : la plupart des modules coûtent un certain nombre de crédits à déployer, et votre solde est vérifié avant qu'un déploiement ne s'exécute.

---

## Se connecter {#signing-in}

1. Ouvrez la page de connexion RAD et cliquez sur **Sign in with Google**. Google est le seul moyen de se connecter.
2. Choisissez votre compte Google.

La première fois que vous vous connectez, votre compte est créé automatiquement — il n'y a pas de page d'inscription séparée : l'inscription et la connexion sont le même bouton sur `/signin`, et toute page que vous ouvrez en étant déconnecté vous y envoie. Les nouveaux comptes commencent avec le rôle **User** et sont actifs immédiatement. Il vous est demandé d'accepter les conditions de la plateforme avant que la console ne s'ouvre ; cette acceptation est enregistrée sur votre compte, et il vous est demandé à nouveau si les conditions sont mises à jour ultérieurement. Refuser vous laisse déconnecté plutôt que piégé — **Sign out** reste disponible sur cet écran.

L'endroit où vous atterrissez dépend de votre rôle. Les administrateurs ouvrent sur **Users** et la Finance sur **Billing**, car chacun se connecte pour effectuer un travail particulier ; il en va de même pour les comptes Support et Agent qui n'ont pas d'autre rôle, sur **Help** et sur **Credits → My Commission** respectivement. Un opérateur de support ou un agent qui est également un utilisateur, un formateur ou un partenaire atterrit comme tel. Les utilisateurs et les formateurs ouvrent sur **Solutions** : sur **Build Solution with AI** si vous y avez accès — crédits achetés, via un abonnement ou une recharge — sinon sur **Solution Catalog → RAD modules**. Un agent qui est également un utilisateur ou un formateur atterrit de la même manière. Les partenaires ont toujours accès, ils ouvrent donc sur **Build Solution with AI**. Si vous avez appuyé sur **Deploy** sur un module du catalogue public sur la page de connexion avant de vous connecter, vous atterrissez plutôt sur ce module, prêt à être déployé. (Si la plateforme fonctionne en mode privé, seules les personnes qui ont déjà un compte RAD peuvent se connecter — la nouvelle auto-inscription est désactivée, alors demandez à un administrateur de créer votre compte si vous ne pouvez pas vous connecter.)

Pour vous déconnecter, ouvrez le **profile dropdown** (menu déroulant du profil) dans le coin supérieur droit et choisissez **Sign Out**.

### Langue {#language}

RAD est disponible en **anglais** et en **français**. Choisissez votre langue dans le sélecteur de langue de la barre supérieure — il se trouve également sur les pages de connexion et de tarification. RAD recharge la page sur laquelle vous vous trouvez dans cette langue et mémorise le choix, de sorte que l'actualisation d'une page ou le suivi d'un lien le conserve. Les descriptions de modules, de solutions et de plans, l'assistant conversationnel et les e-mails que RAD vous envoie suivent tous cette préférence : les e-mails sont rédigés dans la langue que vous avez utilisée en dernier dans la console.

---

## Se repérer {#finding-your-way-around}

La barre de navigation supérieure n'affiche que les éléments pertinents pour votre rôle (ou vos rôles). Où que vous soyez, vous trouverez :

- Un **profile dropdown** (menu déroulant du profil) (en haut à droite) avec **Your Profile** et **Sign Out**.
- Un **sélecteur de langue** dans la barre supérieure, à côté du contrôle du thème clair/sombre.
- **Pricing** (Tarification), juste avant **Help** (Aide) dans la navigation supérieure — les prix de RAD, affichés dans la console.
- Dans le pied de page : **Contact Us** (vers la page **Help**), **Feedback** (le tableau de feedback public de RAD, sur fider.radbusiness.dev, où vous pouvez suggérer et voter des améliorations), les documents Conditions et Confidentialité, **Cookie settings** (Paramètres des cookies), et **Pricing** (Tarification) à nouveau.

Il n'y a pas de tableau de bord combiné séparé — chaque élément de la navigation supérieure est sa propre page.

Après vous être connecté, RAD vous dirige vers la page qui correspond à votre rôle :

- **User**, **Trainer** → **Solutions**, sur **Build Solution with AI** avec des crédits achetés, sinon sur **Solution Catalog → RAD modules**
- **Partner** → **Solutions**, sur **Build Solution with AI**
- **Admin** → **Users**
- **Finance** → **Billing**
- **Agent** → **Credits**, sur l'onglet **My Commission** — sauf si vous êtes également un utilisateur ou un formateur, auquel cas vous atterrissez comme eux
- **Support** → **Help** — sauf si vous êtes également un utilisateur, un formateur ou un partenaire, auquel cas vous atterrissez comme eux
- Aucun rôle attribué → **Help**

---

## Rôles en un coup d'œil {#roles-at-a-glance}

Vous pouvez détenir plusieurs rôles à la fois (par exemple Agent et Partner), et un **Partner est toujours aussi un User**. Les rôles sont accordés par un administrateur.

| Rôle | Ce qu'ils font | Où ils commencent |
| :--- | :--- | :--- |
| **User** | Parcourir le catalogue, déployer et gérer leurs propres modules, gérer leurs crédits | Solutions |
| **Admin** | Tout ce qu'un utilisateur peut faire, plus l'administration complète de la plateforme : utilisateurs, paramètres, modules et supervision | Users |
| **Partner** | Un utilisateur qui publie également ses propres modules et en tire des revenus | Solutions |
| **Agent** | Un rôle commercial : gagne une commission en argent sur les frais de module que les utilisateurs qu'il a parrainés paient avec des crédits achetés | Credits → My Commission (Solutions si également un User ou Trainer) |
| **Finance** | Rapports financiers et paiements : paliers d'abonnement, paramètres et octrois de crédits, codes d'événement, revenus, factures ; supervision des labs en lecture seule | Billing |
| **Support** | Triage les tickets de support ; voit les déploiements pour les clients dont les tickets ouverts lui sont attribués | Help |
| **Trainer** | Exécute des sessions de labo à partir de **Solutions → Managed Environments** — un environnement de labo par participant — et gère les environnements qu'il a provisionnés ; a également tout ce qu'un User a | Solutions |

Voir les guides de rôle à la fin pour les listes complètes des tâches.

---

## Concepts fondamentaux {#core-concepts}

### Le catalogue de modules (Solutions → Solution Catalog → RAD modules) {#the-module-catalog-solutions--solution-catalog--rad-modules}

**RAD modules**, sous l'onglet **Solution Catalog** de **Solutions**, est le catalogue de modules. Chaque module apparaît comme une **carte** affichant sa description, un lien vers la documentation, une note moyenne en étoiles, le nombre de fois où il a été déployé et son prix : les **frais** uniques plus une estimation du **build**, affichés de la même manière sur chaque carte du catalogue.

Il existe deux types de modules :

- **Platform modules** — publiés par RAD.
- **Partner modules** — publiés par des partenaires.

Si vous êtes un partenaire, vous verrez deux onglets (vos propres **Partner modules** et **Platform modules**, qui incluent également les modules publics d'autres partenaires). Tous les autres voient un seul catalogue combiné de modules publics.

Vous pouvez **épingler** les modules que vous utilisez le plus afin qu'ils restent en haut, **rechercher** par nom, filtrer par **catégorie** à partir de la liste à côté de la grille, et parcourir le catalogue. Une bande de statistiques en haut affiche le total des déploiements, votre solde de crédits (lorsque les crédits sont activés) et la durée de conservation de l'historique des déploiements.

### Déployer un module {#deploying-a-module}

1. Cliquez sur une carte de module, puis choisissez comment le configurer. L'**Assistant conversationnel** est la valeur par défaut pour toute personne ayant des crédits achetés (les partenaires toujours) ; sans eux, le **Formulaire de configuration** est la valeur par défaut et l'assistant est affiché mais verrouillé jusqu'à ce que vous achetiez des crédits. Le **Formulaire de configuration** est le formulaire guidé en plusieurs étapes — remplissez les champs, en utilisant **Next** pour passer d'une étape à l'autre. L'**Assistant conversationnel** décrit chaque paramètre dans un seul message et propose des modifications au fur et à mesure que vous décrivez ce que vous voulez ; vous appliquez chaque modification proposée vous-même, de sorte que rien n'est défini sans votre accord. Vous pouvez basculer entre les deux à tout moment, et les deux écrivent la même configuration.

   Deux choses que l'assistant ne fera délibérément pas. Il ne voit ni ne définit jamais un **secret** (une clé API, un jeton ou un mot de passe) : il vous dit que le champ existe et vous tapez la valeur dans la boîte en surbrillance sur la page — jamais dans le chat, où elle serait envoyée au modèle et conservée dans la conversation. Et il n'acceptera pas une valeur qui enfreint la règle d'un champ ; il vous dit quelle est la règle et demande une valeur corrigée plutôt que de modifier silencieusement ce que vous avez tapé. Il en va de même pour une région qu'un projet géré par RAD ne peut pas utiliser : il le dit et liste les régions autorisées.
2. Le formulaire s'ouvre avec un panneau **What will be deployed** (Ce qui sera déployé) listant tout ce que le déploiement construit — dans un projet géré par RAD, le projet Google Cloud et les services partagés ainsi que l'application — et si chacun est créé, mis à jour en premier, ou existe déjà et est réutilisé gratuitement. Une boîte de dialogue de confirmation apparaît si le module coûte des crédits, a des dépendances ou nécessite des autorisations spéciales.
3. Cliquez sur **Deploy Module**. Le déploiement est mis en file d'attente et provisionné, et RAD ouvre la page du nouveau déploiement sur son onglet **Build Status** (Statut de la build) afin que vous puissiez le voir s'exécuter. Si vous n'avez pas assez de crédits, RAD affiche le coût du module par rapport à votre solde et vous invite à recharger.

Basique et avancé concernent les paramètres que vous pouvez atteindre, pas ce que vous payez. Un nouveau déploiement est toujours créé avec les paramètres essentiels uniquement, et les frais du module sont facturés comme décrit sous [Crédits](#credits). L'ensemble complet des paramètres — le **mode avancé** — n'est proposé que lorsque vous **mettez à jour** un déploiement, et une mise à jour ne facture jamais de frais de module.

Sur la page **Deployments** (Déploiements), chaque ligne affiche le module, l'ID de déploiement, une **note en étoiles** modifiable, la date de création, le temps qu'il a fallu, le statut et l'action. Il n'y a pas de colonne projet ou crédits — ouvrez un déploiement pour son projet, et son onglet **Builds** pour ce que chaque build a consommé. Les administrateurs et le support voient une colonne supplémentaire pour savoir qui l'a déployé. Les administrateurs peuvent basculer entre **All deployments** (Tous les déploiements) et **My deployments** (Mes déploiements) ; le support n'a pas de bascule et ne voit que les déploiements des clients dont les tickets ouverts lui sont attribués, pas toute la plateforme ; tous les autres voient les leurs. Un déploiement **Deleted** (Supprimé) reste listé uniquement pour quelqu'un qui peut encore le purger (ou, pour le support, le restaurer) — par exemple, un participant à un labo ne voit pas les environnements que son formateur a supprimés.

Cliquez sur un déploiement pour ouvrir ses détails, qui comporte trois onglets :

- **Outputs** (Sorties) — les résultats non sensibles (tels que les URL et les points de terminaison), affichés une fois que le déploiement réussit et a des sorties à afficher.
- **Build Status** (Statut de la build) — journaux en direct pendant l'exécution du déploiement. Une fois qu'il réussit, **Explain this** (Expliquer ceci) ouvre un résumé en langage clair de ce qui a été créé dans votre projet Google Cloud ; sur une étape qui a échoué, **Search for a fix** (Rechercher une solution) et **Ask for help** (Demander de l'aide) fonctionnent tous deux à partir de l'erreur que cette étape a imprimée. **Download** (Télécharger) enregistre l'ensemble du journal sous forme de fichier texte, avec les secrets masqués.
- **Builds** (Builds) — l'historique des builds pour ce déploiement.

Depuis la vue détaillée, vous pouvez :

- **Update** (Mettre à jour) — rouvrir le formulaire de configuration (pré-rempli) et réappliquer les modifications. Disponible une fois qu'un déploiement est terminé.
- **Delete** (Supprimer) — choisissez **Delete** pour détruire les ressources cloud, ou **Purge** pour supprimer le déploiement de RAD *sans* détruire les ressources cloud (utile lorsqu'un déploiement est bloqué ou a été modifié en dehors de RAD). Un déploiement appartenant à une solution ne peut être supprimé ou purgé que depuis la page de la solution. Un projet GCP géré par RAD ("GCP Project on RAD") est détruit de la même manière, mais comme cela entraîne la destruction de l'ensemble du projet, RAD refuse tant qu'un autre déploiement est en cours d'exécution dans ce projet et liste ceux à supprimer en premier. Google conserve un projet supprimé récupérable pendant environ 30 jours.
- **Cancel** (Annuler) — libère un déploiement qui est toujours en file d'attente (Queued) ou en attente (Waiting) et n'a pas commencé à être construit, ou une purge qui a échoué.

Les statuts de déploiement que vous pouvez voir incluent Queued (En file d'attente), Pending (En attente), Working (En cours), Waiting (En attente d'un déploiement préalable), Success (Succès), Failure (Échec), Internal Error (Erreur interne), Deleting (Suppression en cours), Deleted (Supprimé), Cancelled (Annulé), Timeout (Délai dépassé) et Expire (Expiré).

### Solutions {#solutions}

**Solutions** contient tout ce que vous pouvez déployer, sur deux onglets — et c'est là que les utilisateurs, les partenaires et les formateurs atterrissent après s'être connectés (voir [Se connecter](#signing-in)). Après ces deux onglets vient **Managed Environments** (Environnements gérés) : les projets clients tant que la plateforme les propose (voir le [Guide des projets clients](client-projects-guide.md)) et, pour les formateurs, la finance et les administrateurs, les sessions de labo tant qu'elles sont activées. Sa vue **All** (Tout) liste les deux ; les vues **Lab sessions** (Sessions de labo) et **Client projects** (Projets clients) ont chacune leur propre bouton de création (**New lab session**, **New client project**) pour ceux qui sont autorisés à en créer un.

- **Build Solution with AI** — répondez à quatre questions simples et RAD détermine quelles applications livrent ce que vous avez décrit, évalue le coût total et estime le temps nécessaire. **Build this** (Construire ceci) l'enregistre comme l'une de vos solutions et l'ouvre prêt à être déployé. Commencez ici si vous savez ce que vous voulez réaliser mais pas comment cela s'appelle. Il est également accessible directement à l'adresse **/build**. Il nécessite des crédits achetés (les partenaires y ont toujours accès) ; sans eux, l'onglet montre ce qu'il fait, verrouillé, avec un bouton **Buy credits** (Acheter des crédits) tant que la plateforme vend des crédits.
- **Solution Catalog** — tout ce qui est prêt à être déployé, avec un filtre de type en haut (**All** · **My solutions** · **RAD solutions** · **RAD modules**) et un bouton **New solution** (Nouvelle solution) à côté qui ouvre **Build Solution with AI**. **All** affiche tous les types sur une seule page, chacun sous son propre titre, en omettant tout type sans rien à afficher ; la liste des catégories à côté de la grille n'apparaît que lorsqu'un seul type (**RAD solutions** ou **RAD modules**) est sélectionné, car les solutions et les modules utilisent des catégories différentes. La boîte de recherche au-dessus des onglets recherche dans tout le catalogue de solutions, et votre requête reste en place lorsque vous changez de type.
  - **My solutions** — les bundles que vous avez composés vous-même. Décrivez ce que vous voulez construire, et RAD suggère des modules du catalogue avec une brève raison pour chacun. Ajoutez ceux que vous voulez, nommez-le et enregistrez. Vos solutions personnalisées vous sont privées, affichent **Draft** (Brouillon) jusqu'à leur déploiement et **Deployed** (Déployé) ensuite, et se déploient exactement de la même manière qu'une solution RAD. Lorsque deux membres n'ont pas de connexion connue entre eux, RAD le signale sur la carte plutôt que de deviner.
  - **RAD solutions** — des bundles de modules prêts à l'emploi, organisés par RAD, regroupés en catégories. Chaque carte affiche un coût combiné en crédits et une note moyenne dérivée des modules qu'elle contient.
  - **RAD modules** — le catalogue de modules décrit ci-dessus.

Les modules d'une solution sont regroupés en **vagues**, un ordre de déploiement approximatif — mais ce qui détermine réellement le démarrage d'un membre est sa dépendance de configuration réelle vis-à-vis d'un autre membre : il n'attend que la fin de ce producteur spécifique, et non la fin de toute sa vague nominale, de sorte que les membres se provisionnent fréquemment de manière concurrente à l'intérieur et entre les vagues. Le provisionnement d'une solution vous guide à travers un formulaire de configuration unique couvrant ses membres. Le **déploiement de solution** résultant obtient sa propre page de détails, où — comme pour un déploiement de module — vous pouvez le mettre à jour, le supprimer ou le purger.

### Crédits {#credits}

L'utilisation est mesurée en crédits, détenus dans quatre soldes distincts :

- **Awards** (Récompenses) — crédits gratuits (inscription, mensuels, parrainage), réinitialisés chaque mois.
- **Event credits** (Crédits d'événement) — crédits gratuits réclamés avec un code d'un événement partenaire RAD. Ils expirent à leur propre date.
- **Subscription** (Abonnement) — crédits d'un plan d'abonnement. Lorsque la plateforme est configurée pour les réinitialiser, un renouvellement remplace l'allocation plutôt que de l'ajouter.
- **Top-up** (Recharge) — crédits achetés directement en une seule fois. Ceux-ci n'expirent jamais.

Les dépenses sont d'abord prélevées sur les récompenses, puis sur les crédits d'événement, puis sur l'abonnement, puis sur la recharge, de sorte que les crédits qui expirent le plus tôt sont utilisés en premier. Votre **solde** est l'ensemble de tous ces crédits et est vérifié avant chaque déploiement.

Le déploiement d'un module coûte les frais de ce module plus un coût de build. Les frais sont réservés lorsque vous confirmez et facturés lorsque le déploiement réussit pour la première fois ; le coût de build est mesuré en fonction de la durée réelle de chaque build et facturé une fois qu'il est terminé — le chiffre final peut donc différer légèrement de l'estimation dans la boîte de dialogue de confirmation. Cette boîte de dialogue indique la CHAÎNE COMPLÈTE — le déploiement dans un projet géré par RAD crée également votre projet Google Cloud privé et les services partagés que vos applications utilisent, et les deux sont listés avec le total. Si le coût de build dépasse votre solde, le reste est reporté et réglé lors de votre prochain achat. Un partenaire déployant son propre module n'est pas facturé le coût du module, mais paie le coût de build. Une mise à jour ne facture que le coût de build. Si l'équipe financière de RAD a défini un taux de TVA pour votre compte, il est ajouté à chaque frais de module, coût de build et frais d'utilisation de projet, la boîte de dialogue de confirmation l'affiche comme sa propre ligne **VAT** (TVA), et il doit être payé avec des crédits achetés. Une solution de trois modules ou plus bénéficie d'une réduction groupée sur ses frais de module — par défaut 15 % pour trois ou quatre, 20 % pour cinq ou six, 25 % pour sept ou plus.

Vous choisissez les e-mails que RAD envoie sur votre page **Profile**. La désactivation des e-mails de **Deployments** (Déploiements) arrête tous les e-mails de déploiement, y compris l'avertissement que RAD envoie avant de supprimer définitivement quelque chose — donc, tant qu'ils sont désactivés, ces suppressions sont retenues plutôt que effectuées sans avertissement. Voir le [Guide de l'utilisateur](user-guide.md#email-notifications).

Le coût d'un déploiement **failed** (échoué) est un paramètre de la plateforme, pas une règle fixe : la Finance peut choisir, séparément pour le coût de build et les frais de module, si l'un ou l'autre est facturé lorsqu'un nouveau déploiement échoue ou est annulé. **Dans la version actuelle, aucun n'est facturé, donc un déploiement échoué ne vous coûte rien.** Les mises à jour et les suppressions échouées ne sont pas non plus facturées.

La page **Credits** (Crédits) contient :

- Un onglet **Credit Transactions** (Transactions de crédits) — votre historique complet des récompenses, achats et dépenses, filtrable par déploiement et date, avec **Export CSV**.
- Un onglet **Subscriptions** (Abonnements) et un onglet **Buy Credits** (Acheter des crédits) — affichés uniquement lorsque la plateforme vend des crédits (voir ci-dessous).
- Un onglet **Linked Projects** (Projets liés) — demandez à RAD de payer Google pour un projet Google Cloud que vous possédez déjà (voir [Coûts et factures](#costs-and-invoices)).
- Selon votre rôle, les onglets de revenus — **My Commission** (agents), **Module Revenue** (partenaires), **My Referral Revenue** (administrateurs et finance) — se trouvent également ici. Il n'y a pas de page de revenus séparée.
- Un onglet **Calculate ROI** (Calculer le ROI), toujours le dernier — le calculateur décrit ci-dessous.

Pour acheter des crédits, choisissez une devise et un montant, sélectionnez un fournisseur de paiement et finalisez le paiement sur la page sécurisée du fournisseur. Vos crédits sont ajoutés automatiquement une fois le paiement confirmé.

Certaines plateformes exigent des crédits *achetés* (pas seulement des crédits offerts) pour certains déploiements — la boîte de dialogue de confirmation vous indiquera quand cela s'applique.

### Facturation et abonnements {#billing-and-subscriptions}

Les paiements sont gérés via **Stripe** et **Flutterwave**. Vous choisissez le fournisseur au moment du paiement ; ceux qui sont disponibles dépendent de votre devise et de ce que la plateforme a activé. Les prix sont affichés dans la devise que vous avez sélectionnée.

Les abonnements sont des plans récurrents optionnels (« paliers ») qui accordent un nombre défini de crédits à chaque cycle de facturation. Vous pouvez vous abonner, annuler ou réactiver à tout moment, mais vous ne pouvez détenir qu'un seul abonnement à la fois — pour passer à un palier différent, ou à un fournisseur de paiement différent, annulez d'abord celui en cours. Les abonnements n'accordent que des crédits — ils n'accordent pas le rôle de partenaire, qu'un administrateur attribue manuellement.

La possibilité d'acheter quoi que ce soit est un interrupteur de plateforme, **Enable Subscription**. Tant qu'il est désactivé, il n'y a pas de nouveaux abonnements ni de recharges ponctuelles chez aucun des fournisseurs : les onglets **Subscriptions** et **Buy Credits** ne sont pas affichés et la page publique des prix ne liste aucun plan. Si vous détenez déjà un abonnement, un avis sur **Credit Transactions** vous permet toujours de l'annuler.

### ROI {#roi}

L'onglet **Calculate ROI** (Calculer le ROI) sur la page **Credits** est un estimateur interactif. Il est pré-rempli avec votre activité récente et vous permet d'ajuster les hypothèses (telles que les déploiements mensuels, le temps de déploiement manuel, le coût horaire de l'ingénieur et le pourcentage d'économies de temps) pour estimer votre coût de main-d'œuvre, le coût de la plateforme, les économies nettes et le ROI. C'est un estimateur uniquement — il ne déploie ni ne facture rien.

### Coûts et factures {#costs-and-invoices}

Vous pouvez consulter vos propres dépenses sur la page **Credits**, de deux manières. **Credit Transactions** (Transactions de crédits) liste chaque récompense, achat et débit sur votre compte. **Project Transactions** (Transactions de projet) — affiché lorsque les crédits de projet sont activés — détaille le côté projet de cela par projet Google Cloud, avec les crédits débités et le coût cloud sous-jacent pour chacun, sur une période que vous choisissez. Il existe parce qu'un débit de projet arrive au grand livre comme une seule ligne combinée couvrant tous vos projets à la fois.

**Linked Projects** (Projets liés), également sur la page Crédits, permet à RAD de payer Google pour un projet Google Cloud que vous possédez déjà et que vous gérez vous-même. Vous prouvez que vous possédez le projet, accordez à l'identité de facturation de RAD deux rôles qui lui permettent d'attacher ou de détacher un compte de facturation (et rien d'autre — RAD n'a pas accès à vos données), plafonnez les quotas d'API Gemini et de GPU du projet, et envoyez une demande. Une fois que l'équipe financière de RAD l'approuve, RAD paie Google et débite vos crédits achetés toutes les heures pour l'utilisation du projet, au prix catalogue de Google plus la marge de RAD, plus votre taux de TVA. Vous devez maintenir un solde minimum de crédits achetés ; en dessous, RAD met le projet en pause en détachant la facturation (vos données sont conservées) et le reprend lorsque vous rechargez, en vous envoyant un e-mail avant la pause. Vous pouvez arrêter à tout moment avec **Stop**, ou en liant votre propre compte de facturation au projet. Voir le [Guide de l'utilisateur](user-guide.md#linked-projects).

Les rapports à l'échelle de la plateforme restent une vue administrateur et finance : les onglets **Module Costs** (Coûts des modules) et **Project Invoices** (Factures de projet) sur la page Crédits, et toute la page **Billing** (Facturation), sont limités à ces deux rôles. Si vous avez besoin d'une facture formelle, demandez-la via le formulaire de support.

---

## Obtenir de l'aide {#getting-help}

L'onglet **Send Message** (Envoyer un message) de la page **Help** (Aide) est un formulaire de contact qui génère un ticket de support et envoie un e-mail à l'équipe de support. La création d'un ticket nécessite des crédits achetés (un abonnement ou une recharge) lorsque les crédits sont en vente, et vous pouvez en créer jusqu'à 5 en 24 heures. L'onglet **My Tickets** (Mes tickets) à côté liste les tickets que vous avez créés, du plus récent au plus ancien, avec leur statut (**New**, **In progress**, **Resolved** ou **Closed**) — l'envoi d'un ticket vous y amène, de sorte que vous voyez celui que vous venez de créer. Selon votre rôle, vous pouvez voir plus d'onglets : **Setup Requests** (admin et finance) et **Support Tickets** (admin, support et finance). (Les administrateurs voient un formulaire de message sur Send Message au lieu du formulaire de contact, et n'ont pas d'onglet My Tickets.)

Votre **lien de parrainage** se trouve sur votre **Profile**, dans la section **Refer and earn** (Parrainer et gagner) — ouvrez le menu de profil en haut à droite. Il est affiché chaque fois que le programme de parrainage est activé, y compris lorsque les parrainages sont illimités (il n'est jamais affiché aux administrateurs), et la page **Credits** (Crédits) a un bouton **Referral link** (Lien de parrainage) qui vous y mène. Toute personne qui s'inscrit via votre lien est liée à votre compte.

Vous pouvez également accéder à l'aide via le lien **Contact Us** (Nous contacter) dans le pied de page. Pour suggérer une amélioration plutôt que de signaler un problème, utilisez le lien **Feedback** (Commentaires) à côté.

---

## Guides de rôle {#role-guides}

Pour l'ensemble complet des tâches de chaque rôle :

- [Admin](admin-guide.md)
- [Partner](partner-guide.md)
- [User](user-guide.md)
- [Agent](agent-guide.md)
- [Finance](finance-guide.md)
- [Support](support-guide.md)
- [Trainer](trainer-guide.md)
