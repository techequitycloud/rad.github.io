---
title: "Utiliser RAD"
description: "Comment utiliser la plateforme RAD : connexion, navigation, rôles, déploiement de modules sur votre propre projet Google Cloud, crédits et facturation."
---

<!-- translated-from: docs/guides/using-rad.md @ 82e1e8eb sha256:3419335f9377 -->

# Utiliser RAD {#using-rad}

<img src="https://storage.googleapis.com/rad-public-2b65/guides/Using_RAD.png" alt="Utiliser RAD" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ceci est la vue d'ensemble partagée pour tous ceux qui utilisent RAD. Elle couvre la connexion, la navigation, les rôles et les concepts fondamentaux (modules, déploiements, crédits, facturation et aide). Chaque guide de rôle renvoie ici pour les bases, puis se concentre sur ce que ce rôle fait.

---

## Qu'est-ce que RAD {#what-is-rad}

RAD (Rapid Application Deployment) est un portail web permettant de déployer des modules Google Cloud prêts à l'emploi sans écrire de code d'infrastructure. Vous choisissez un module, remplissez un formulaire de configuration guidé, et la plateforme le provisionne sur Google Cloud pour vous.

L'utilisation est mesurée en **crédits** : la plupart des modules coûtent un certain nombre de crédits à déployer, et votre solde est vérifié avant l'exécution d'un déploiement.

---

## Se connecter {#signing-in}

1. Ouvrez la page de connexion RAD et cliquez sur **Sign in with Google**. Google est le seul moyen de se connecter.
2. Choisissez votre compte Google.

La première fois que vous vous connectez, votre compte est créé automatiquement — il n'y a pas de page d'inscription distincte : l'inscription et la connexion sont le même bouton sur `/signin`, et toute page que vous ouvrez en étant déconnecté vous y envoie. Les nouveaux comptes commencent avec le rôle **User** et sont actifs immédiatement. Il vous est demandé d'accepter les conditions de la plateforme avant l'ouverture de la console ; cette acceptation est enregistrée sur votre compte, et il vous est demandé à nouveau si les conditions sont ultérieurement mises à jour. Refuser vous laisse déconnecté plutôt que piégé — **Sign out** reste disponible sur cet écran.

L'endroit où vous atterrissez dépend de votre rôle. Les administrateurs ouvrent sur **Users**, la finance sur **Billing** et le support sur **Help**, car chacun se connecte pour effectuer un travail particulier ; il en va de même pour un agent qui n'a pas d'autre rôle, sur **Credits → My Commission**. Les utilisateurs et les formateurs ouvrent sur **Solutions** : sur **Build Solution with AI** si vous y avez accès — crédits achetés, via un abonnement ou une recharge — sinon sur **Solution Catalog → RAD modules**. Un agent qui est aussi un utilisateur ou un formateur atterrit de la même manière. Les partenaires ont toujours accès, ils ouvrent donc sur **Build Solution with AI**. Si vous avez appuyé sur **Deploy** sur un module du catalogue public sur la page de connexion avant de vous connecter, vous atterrissez sur ce module, prêt à être déployé. (Si la plateforme fonctionne en mode privé, seules les personnes ayant déjà un compte RAD peuvent se connecter — la nouvelle auto-inscription est désactivée, alors demandez à un administrateur de créer votre compte si vous ne pouvez pas vous connecter.)

Pour vous déconnecter, ouvrez le **menu déroulant du profil** en haut à droite et choisissez **Sign Out**.

---

## Se repérer {#finding-your-way-around}

La barre de navigation supérieure n'affiche que les éléments pertinents pour votre rôle (ou vos rôles). Où que vous soyez, vous trouverez :

- Un **menu déroulant de profil** (en haut à droite) avec **Your Profile** et **Sign Out**.
- Un lien **Contact Us** dans le pied de page qui vous mène à la page **Help**, et un lien **Pricing** vers la page publique des tarifs.

Il n'y a pas de tableau de bord combiné séparé — chaque élément de la navigation supérieure est sa propre page.

Après vous être connecté, RAD vous dirige vers la page correspondant à votre rôle :

- **User**, **Trainer** → **Solutions**, sur **Solution Catalog → All** avec des crédits achetés, sinon sur **Solution Catalog → RAD modules**
- **Partner** → **Solutions**, sur **Build Solution with AI**
- **Admin** → **Users**
- **Finance** → **Billing**
- **Agent** → **Credits**, sur l'onglet **My Commission** — sauf si vous êtes également un utilisateur ou un formateur, auquel cas vous atterrissez comme eux
- **Support** → **Help**
- Aucun rôle attribué → **Help**

---

## Rôles en un coup d'œil {#roles-at-a-glance}

Vous pouvez détenir plusieurs rôles à la fois (par exemple Agent et Partner), et un **Partner est toujours aussi un User**. Les rôles sont attribués par un administrateur.

| Rôle | Ce qu'ils font | Où ils commencent |
| :--- | :--- | :--- |
| **User** | Parcourir le catalogue, déployer et gérer leurs propres modules, gérer leurs crédits | Solutions |
| **Admin** | Tout ce qu'un utilisateur peut faire, plus l'administration complète de la plateforme : utilisateurs, paramètres, modules et supervision | Users |
| **Partner** | Un utilisateur qui publie également ses propres modules et en tire des revenus | Solutions |
| **Agent** | Un rôle commercial : gagne une commission en argent sur les frais de module payés par les utilisateurs qu'il a parrainés | Credits → My Commission (Solutions si également un User ou Trainer) |
| **Finance** | Rapports financiers et paiements : paliers d'abonnement, paramètres et octrois de crédits, codes d'événements, revenus, factures ; supervision des labs en lecture seule | Billing |
| **Support** | Triage les tickets de support ; voit les déploiements pour les clients dont les tickets ouverts lui sont attribués | Help |
| **Trainer** | Exécute des sessions de labo à partir de **Solutions → Managed Environments** — un environnement de labo par participant — et gère les environnements qu'il a provisionnés ; a également tout ce qu'un User a | Solutions |

Consultez les guides de rôle à la fin pour les listes complètes des tâches.

---

## Concepts fondamentaux {#core-concepts}

### Le catalogue de modules (Solutions → Solution Catalog → RAD modules) {#the-module-catalog-solutions--solution-catalog--rad-modules}

**RAD modules**, sous l'onglet **Solution Catalog** de **Solutions**, est le catalogue de modules. Chaque module apparaît sous forme de **carte** affichant sa description, un lien vers la documentation, une note moyenne en étoiles, le nombre de fois où il a été déployé et son prix : les **frais** uniques plus une estimation du **build**, affichés de la même manière sur chaque carte du catalogue.

Il existe deux types de modules :

- **Modules de plateforme** — publiés par RAD.
- **Modules partenaires** — publiés par des partenaires.

Si vous êtes un partenaire, vous verrez deux onglets (vos propres **Partner modules** et **Platform modules**, qui incluent également les modules publics des autres partenaires). Tous les autres voient un catalogue combiné unique de modules publics.

Vous pouvez **épingler** les modules que vous utilisez le plus afin qu'ils restent en haut, **rechercher** par nom, filtrer par **catégorie** à partir de la liste à côté de la grille, et parcourir le catalogue. Une bande de statistiques en haut affiche le total des déploiements, votre solde de crédits (lorsque les crédits sont activés) et la durée de conservation de l'historique des déploiements.

### Déployer un module {#deploying-a-module}

1. Cliquez sur une carte de module, puis choisissez comment le configurer. L'**Assistant conversationnel** est la valeur par défaut pour toute personne ayant des crédits achetés (les partenaires toujours) ; sans eux, le **Formulaire de configuration** est la valeur par défaut et l'assistant est affiché mais verrouillé jusqu'à ce que vous achetiez des crédits. Le **Formulaire de configuration** est le formulaire guidé en plusieurs étapes — remplissez les champs, en utilisant **Next** pour passer d'une étape à l'autre. L'**Assistant conversationnel** décrit chaque paramètre dans un seul message et propose des modifications au fur et à mesure que vous décrivez ce que vous voulez ; vous appliquez chaque modification proposée vous-même, de sorte que rien n'est défini sans votre accord. Vous pouvez basculer entre les deux à tout moment, et les deux écrivent la même configuration.

   Deux choses que l'assistant ne fera délibérément pas. Il ne voit ni ne définit jamais un **secret** (une clé API, un jeton ou un mot de passe) : il vous indique que le champ existe et vous tapez la valeur dans la boîte en surbrillance sur la page — jamais dans le chat, où elle serait envoyée au modèle et conservée dans la conversation. Et il n'acceptera pas une valeur qui enfreint la règle d'un champ ; il vous dit quelle est la règle et demande une valeur corrigée plutôt que de modifier silencieusement ce que vous avez tapé. Il en va de même pour une région qu'un projet géré par RAD ne peut pas utiliser : il le dit et liste les régions autorisées.
2. Le formulaire s'ouvre avec un panneau **What will be deployed** listant tout ce que le déploiement construit — dans un projet géré par RAD, le projet Google Cloud et les services partagés ainsi que l'application — et si chacun est créé, mis à jour en premier, ou existe déjà et est réutilisé gratuitement. Une boîte de dialogue de confirmation apparaît si le module coûte des crédits, a des dépendances ou nécessite des autorisations spéciales.
3. Cliquez sur **Deploy Module**. Le déploiement est mis en file d'attente et provisionné, et RAD ouvre la page du nouveau déploiement sur son onglet **Build Status** afin que vous puissiez le voir s'exécuter. Si vous n'avez pas assez de crédits, RAD affiche le coût du module par rapport à votre solde et vous invite à recharger.

Sur la page **Deployments**, chaque ligne affiche le module, l'ID de déploiement, une **note en étoiles** modifiable, la date de création, le temps qu'il a fallu, le statut et l'action. Il n'y a pas de colonne projet ou crédits — ouvrez un déploiement pour son projet, et son onglet **Builds** pour ce que chaque build a consommé. Les administrateurs et le support voient une colonne supplémentaire pour savoir qui l'a déployé. Les administrateurs peuvent basculer entre **All deployments** et **My deployments** ; le support n'a pas de bascule et ne voit que les déploiements des clients dont les tickets ouverts leur sont attribués, pas toute la plateforme ; tous les autres voient les leurs.

Cliquez sur un déploiement pour ouvrir ses détails, qui comporte trois onglets :

- **Outputs** — les résultats non sensibles (tels que les URL et les points de terminaison), affichés une fois que le déploiement réussit et a des sorties à afficher.
- **Build Status** — journaux en direct pendant l'exécution du déploiement. Une fois qu'il réussit, **Explain this** ouvre un résumé en langage clair de ce qui a été créé dans votre projet Google Cloud ; sur une étape qui a échoué, **Search for a fix** et **Ask for help** fonctionnent tous deux à partir de l'erreur imprimée par cette étape. **Download** enregistre l'ensemble du journal sous forme de fichier texte, avec les secrets masqués.
- **Builds** — l'historique des builds pour ce déploiement.

Depuis la vue détaillée, vous pouvez :

- **Update** — rouvrir le formulaire de configuration (pré-rempli) et réappliquer les modifications. Disponible une fois qu'un déploiement est terminé.
- **Delete** — choisissez **Delete** pour détruire les ressources cloud, ou **Purge** pour supprimer le déploiement de RAD *sans* détruire les ressources cloud (utile lorsqu'un déploiement est bloqué ou a été modifié en dehors de RAD). Un déploiement appartenant à une solution ne peut être supprimé ou purgé que depuis la page de la solution. Un projet GCP géré par RAD ("GCP Project on RAD") est détruit de la même manière, mais comme cela entraîne la destruction de l'ensemble du projet, RAD refuse tant qu'un autre déploiement est en cours d'exécution dans ce projet et liste ceux à supprimer en premier. Google conserve un projet supprimé récupérable pendant environ 30 jours.
- **Cancel** — libère un déploiement qui est toujours en file d'attente ou en attente et n'a pas commencé à être construit, ou une purge qui a échoué.

Les statuts de déploiement que vous pouvez voir incluent Queued, Pending, Working, Waiting (qu'un déploiement préalable se termine), Success, Failure, Internal Error, Deleting, Deleted, Cancelled, Timeout et Expire.

### Solutions {#solutions}

**Solutions** contient tout ce que vous pouvez déployer, sur deux onglets — et c'est là que les utilisateurs, les partenaires et les formateurs atterrissent après s'être connectés (voir [Se connecter](#signing-in)). Après ces deux onglets vient **Managed Environments** : les projets clients tant que la plateforme les propose (voir le [Guide des projets clients](client-projects-guide.md)) et, pour les formateurs, la finance et les administrateurs, les sessions de labo tant qu'elles sont activées. Sa vue **All** liste les deux ; les vues **Lab sessions** et **Client projects** ont chacune leur propre bouton de création (**New lab session**, **New client project**) pour ceux qui sont autorisés à en créer un.

- **Build Solution with AI** — répondez à quatre questions simples et RAD détermine quelles applications fournissent ce que vous avez décrit, évalue le coût total et estime le temps nécessaire. **Build this** l'enregistre comme l'une de vos solutions et l'ouvre prête à être déployée. Commencez ici si vous savez ce que vous voulez accomplir mais pas comment cela s'appelle. Il est également accessible directement à l'adresse **/build**. Il nécessite des crédits achetés (les partenaires y ont toujours accès) ; sans eux, l'onglet montre ce qu'il fait, verrouillé, avec un bouton **Buy credits** tant que la plateforme vend des crédits.
- **Solution Catalog** — tout ce qui est prêt à être déployé, avec un filtre de type en haut (**All** · **My solutions** · **RAD solutions** · **RAD modules**) et un bouton **New solution** à côté qui ouvre **Build Solution with AI**. **All** affiche tous les types sur une seule page, chacun sous son propre titre, en omettant tout type sans rien à afficher ; la liste des catégories à côté de la grille n'apparaît que lorsqu'un seul type (**RAD solutions** ou **RAD modules**) est sélectionné, car les solutions et les modules utilisent des catégories différentes. La boîte de recherche au-dessus des onglets recherche dans tout le catalogue de solutions, et votre requête reste en place lorsque vous changez de type.
  - **My solutions** — des ensembles que vous avez composés vous-même. Décrivez ce que vous voulez construire, et RAD suggère des modules du catalogue avec une brève raison pour chacun. Ajoutez ceux que vous voulez, nommez-le et enregistrez. Vos solutions personnalisées sont privées pour vous, affichent **Draft** jusqu'au déploiement et **Deployed** ensuite, et se déploient via exactement le même pipeline qu'une solution RAD. Lorsque deux membres n'ont pas de connexion connue entre eux, RAD le signale sur la carte plutôt que de deviner.
  - **RAD solutions** — des ensembles de modules prêts à l'emploi, organisés par RAD, regroupés en catégories. Chaque carte affiche un coût combiné en crédits et une note moyenne dérivée des modules qu'elle contient.
  - **RAD modules** — le catalogue de modules décrit ci-dessus.

Les modules d'une solution sont regroupés en **vagues**, un ordre de déploiement approximatif — mais ce qui déclenche réellement le démarrage d'un membre est sa dépendance de configuration réelle vis-à-vis d'un autre membre : il n'attend que la fin de ce producteur spécifique, et non de toute sa vague nominale, de sorte que les membres se provisionnent fréquemment de manière concurrente à l'intérieur et entre les vagues. Le provisionnement d'une solution vous guide à travers un seul formulaire de configuration couvrant ses membres. Le **déploiement de solution** résultant obtient sa propre page de détails, où — comme pour un déploiement de module — vous pouvez le mettre à jour, le supprimer ou le purger.

### Crédits {#credits}

L'utilisation est mesurée en crédits, détenus dans quatre soldes distincts :

- **Awards** — crédits gratuits (inscription, mensuels, parrainage), réinitialisés chaque mois.
- **Event credits** — crédits gratuits réclamés avec un code d'un événement partenaire RAD. Ils expirent à leur propre date.
- **Subscription** — crédits d'un plan d'abonnement. Lorsque la plateforme est configurée pour les réinitialiser, un renouvellement remplace l'allocation plutôt que de l'ajouter.
- **Top-up** — crédits achetés directement en une seule fois. Ceux-ci n'expirent jamais.

Les dépenses sont prélevées d'abord sur les crédits offerts, puis sur les crédits d'événement, puis sur l'abonnement, puis sur la recharge, de sorte que les crédits qui expirent le plus tôt sont utilisés en premier. Votre **solde** est l'ensemble de tous ces crédits et est vérifié avant chaque déploiement.

Le déploiement d'un module coûte les frais de ce module plus un coût de build. Les frais sont réservés lorsque vous confirmez et facturés lorsque le déploiement réussit pour la première fois ; le coût de build est mesuré en fonction de la durée réelle de chaque build et facturé une fois qu'il est terminé — le chiffre final peut donc différer légèrement de l'estimation dans la boîte de dialogue de confirmation. Cette boîte de dialogue indique la CHAÎNE ENTIÈRE — le déploiement dans un projet géré par RAD crée également votre projet Google Cloud privé et les services partagés que vos applications utilisent, et les deux sont listés avec le total. Si le coût de build dépasse votre solde, le reste est reporté et réglé lors de votre prochain achat. Un partenaire qui déploie son propre module ne paie pas le coût du module, mais paie le coût de build. Une mise à jour ne facture que le coût de build. Une solution de trois modules ou plus bénéficie d'une remise groupée sur ses frais de module — par défaut 15 % pour trois ou quatre, 20 % pour cinq ou six, 25 % pour sept ou plus.

Vous choisissez les e-mails que RAD envoie sur votre page **Profile**. La désactivation des e-mails de **Deployments** arrête tous les e-mails de déploiement, y compris l'avertissement que RAD envoie avant de supprimer définitivement quelque chose — donc tant qu'ils sont désactivés, ces suppressions sont retenues plutôt que faites sans avertissement. Voir le [Guide de l'utilisateur](user-guide.md#email-notifications).

Le coût d'un déploiement **échoué** est un paramètre de la plateforme, et non une règle fixe : la Finance peut choisir, séparément pour le coût de build et les frais de module, si l'un ou l'autre est facturé lorsqu'un nouveau déploiement échoue ou est annulé. **Dans la version actuelle, aucun n'est facturé, donc un déploiement échoué ne vous coûte rien.** Les mises à jour et les suppressions échouées ne sont pas non plus facturées.

La page **Credits** contient :

- Un onglet **Credit Transactions** — votre historique complet des crédits offerts, des achats et des dépenses, filtrable par déploiement et par date, avec **Export CSV**.
- Un onglet **Subscriptions** et un onglet **Buy Credits** — affichés uniquement lorsque la plateforme vend des crédits (voir ci-dessous).
- Selon votre rôle, les onglets de revenus — **My Commission** (agents), **Module Revenue** (partenaires) — se trouvent également ici. Il n'y a pas de page de revenus séparée.
- Un onglet **Calculate ROI**, toujours en dernier — le calculateur décrit ci-dessous.

Pour acheter des crédits, choisissez une devise et un montant, sélectionnez un fournisseur de paiement et finalisez le paiement sur la page sécurisée du fournisseur. Vos crédits sont ajoutés automatiquement une fois le paiement confirmé.

Certaines plateformes exigent des crédits *achetés* (pas seulement des crédits offerts) pour certains déploiements — la boîte de dialogue de confirmation vous indiquera quand cela s'applique.

### Facturation et abonnements {#billing-and-subscriptions}

Les paiements sont gérés via **Stripe** et **Flutterwave**. Vous choisissez le fournisseur au moment du paiement ; ceux qui sont disponibles dépendent de votre devise et de ce que la plateforme a activé. Les prix sont affichés dans la devise que vous avez sélectionnée.

Les abonnements sont des plans récurrents optionnels ("paliers") qui accordent un nombre défini de crédits à chaque cycle de facturation. Vous pouvez vous abonner, annuler ou réactiver à tout moment, mais vous ne pouvez avoir qu'un seul abonnement à la fois — pour passer à un palier différent, ou à un fournisseur de paiement différent, annulez d'abord celui en cours. Les abonnements n'accordent que des crédits — ils n'accordent pas le rôle de partenaire, qu'un administrateur attribue manuellement.

La possibilité d'acheter quoi que ce soit est un interrupteur de plateforme, **Enable Subscription**. Tant qu'il est désactivé, il n'y a pas de nouveaux abonnements ni de recharges ponctuelles chez aucun des fournisseurs : les onglets **Subscriptions** et **Buy Credits** ne sont pas affichés et la page publique des tarifs ne liste aucun plan. Si vous avez déjà un abonnement, un avis sur **Credit Transactions** vous permet toujours de l'annuler.

### ROI {#roi}

L'onglet **Calculate ROI** de la page **Credits** est un estimateur interactif. Il est pré-rempli avec votre activité récente et vous permet d'ajuster des hypothèses (telles que les déploiements mensuels, le temps de déploiement manuel, le coût horaire de l'ingénieur et le pourcentage de gain de temps) pour estimer votre coût de main-d'œuvre, le coût de la plateforme, les économies nettes et le ROI. Il s'agit uniquement d'un estimateur — il ne déploie ni ne facture rien.

### Coûts et factures {#costs-and-invoices}

Vous pouvez consulter vos propres dépenses sur la page **Credits**, de deux manières. **Credit Transactions** liste chaque attribution, achat et débit sur votre compte. **Project Transactions** — affiché lorsque les crédits de projet sont activés — détaille le côté projet par projet Google Cloud, avec les crédits débités et le coût cloud sous-jacent pour chacun, sur une période que vous choisissez. Il existe parce qu'un débit de projet arrive au grand livre sous la forme d'une ligne combinée couvrant tous vos projets à la fois.

Les rapports à l'échelle de la plateforme restent une vue d'administrateur et de finance : les onglets **Module Costs** et **Project Invoices** de la page Crédits, et l'ensemble de la page **Billing**, sont limités à ces deux rôles. Si vous avez besoin d'une facture formelle, demandez-la via le formulaire de support.

---

## Obtenir de l'aide {#getting-help}

L'onglet **Send Message** de la page **Help** est un formulaire de contact qui génère un ticket de support et envoie un e-mail à l'équipe de support. La création d'un ticket nécessite des crédits achetés (un abonnement ou une recharge) lorsque les crédits sont en vente, et vous pouvez en créer jusqu'à 5 en 24 heures. L'onglet **My Tickets** à côté liste les tickets que vous avez créés, les plus récents en premier, avec leur statut (**New**, **In progress**, **Resolved** ou **Closed**) — l'envoi d'un ticket vous y mène, vous voyez donc celui que vous venez de créer. Selon votre rôle, vous pouvez voir plus d'onglets : **Setup Requests** (administrateur et finance) et **Support Tickets** (administrateur, support et finance). (Les administrateurs voient un formulaire de message sur Send Message au lieu du formulaire de contact, et n'ont pas d'onglet My Tickets.)

Votre **lien de parrainage** se trouve sur votre **Profile**, dans la section **Refer and earn** — ouvrez le menu de profil en haut à droite. Il est affiché chaque fois que le programme de parrainage est actif, y compris lorsque les parrainages sont illimités (il n'est jamais affiché aux administrateurs), et la page **Credits** a un bouton **Referral link** qui vous y mène. Toute personne qui s'inscrit via votre lien est liée à votre compte.

Vous pouvez également accéder à l'aide via le lien **Contact Us** dans le pied de page.

---

## Guides de rôle {#role-guides}

Pour l'ensemble des tâches de chaque rôle :

- [Admin](admin-guide.md)
- [Partner](partner-guide.md)
- [User](user-guide.md)
- [Agent](agent-guide.md)
- [Finance](finance-guide.md)
- [Support](support-guide.md)
- [Trainer](trainer-guide.md)
