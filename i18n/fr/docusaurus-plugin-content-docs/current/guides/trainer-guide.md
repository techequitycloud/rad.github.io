---
title: "Guide du formateur"
description: "Guide du formateur de la plateforme RAD — animer des sessions de lab : créer une session, choisir qui paie, intégrer les participants, provisionner et démarrer les environnements, et comment les crédits non utilisés vous reviennent."
---
<!-- translated-from: docs/guides/trainer-guide.md @ 6b90c32 sha256:64c17ddf4ed9 -->

# Guide du formateur {#trainer-guide}

<img src="https://storage.googleapis.com/rad-public-2b65/guides/Trainer_Guide.png" alt="Guide du formateur" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ce guide s'adresse aux formateurs qui animent un cours sur RAD et donnent à chaque participant son propre environnement de lab dans Google Cloud. Vous découvrez RAD ? Commencez par [Utiliser RAD](using-rad.md).

## Ce que vous pouvez faire {#what-you-can-do}

- Animer des **sessions de lab** depuis **Solutions → Managed Environments**, sous **Lab sessions**. Une session est une cohorte nommée de participants qui partagent une plage horaire, une allocation de crédits par participant et une région.
- Choisir, pour chaque session, **qui paie** la place d'un participant : vous, ou chaque participant.
- Payer vous-même la place d'un participant lorsqu'il ne peut pas payer sur RAD — par exemple parce qu'il vous a payé en espèces, ou que sa banque ne fonctionne pas avec le prestataire de paiement.
- Construire le même module ou la même solution dans l'environnement de chaque participant en une seule action, démarrer leurs chronomètres, ajouter du temps ou des crédits, et mettre fin à des environnements de manière anticipée.
- Récupérer chaque crédit que vos participants n'ont pas utilisé une fois la session soldée. Ces crédits sont à vous.

Vous n'avez besoin ni d'une liste de participants séparée ni d'un formulaire de déploiement spécial. Tout se passe sous **Solutions → Managed Environments**. Si vous ouvrez un formulaire de déploiement ordinaire, il vous y renvoie avec **Open lab sessions**.

## Obtenir l'accès {#getting-access}

Connectez-vous comme n'importe quel utilisateur ; votre compte est créé en tant qu'utilisateur ordinaire. Un administrateur vous attribue ensuite le rôle **Trainer** sur la page **Users** — il ne peut pas être demandé depuis RAD, adressez-vous donc à lui. Les sessions de lab doivent également être activées sur la plateforme. Une fois ces deux conditions remplies, un onglet **Managed Environments** apparaît dans **Solutions**, en dernière position. Il n'y a pas d'entrée de menu Labs séparée pour les formateurs. Si l'onglet n'apparaît pas, adressez-vous à un administrateur.

Un formateur est toujours aussi un utilisateur : vous conservez donc **Solutions**, **Deployments** (déploiements), **Credits** (crédits) et **Help** (aide), et vous arrivez sur **Solutions** à la connexion, comme tout utilisateur : sur **Solution Catalog** (sa vue **All**) si vous disposez de crédits achetés, sinon sur **Solution Catalog → RAD modules**. **Credits** est l'endroit où vous achetez les crédits avec lesquels est payée une session que vous financez.

Les administrateurs peuvent voir et gérer les sessions de tous les formateurs. Lorsqu'ils ajoutent des crédits ou des participants à votre session, les crédits proviennent tout de même de **vos** crédits achetés, et vous êtes informé de qui est intervenu. Le personnel Finance peut voir toutes les sessions et en terminer une pour arrêter ses dépenses, mais ne peut pas la modifier.

## Créer une session {#creating-a-session}

Sous **Solutions → Managed Environments**, filtrez sur **Lab sessions** et choisissez **New lab session**. La boîte de dialogue demande :

- **Session name** (nom de la session) — jusqu'à 100 caractères.
- **Participant emails** (adresses e-mail des participants) — collez une liste. La boîte de dialogue confirme combien d'adresses elle a reconnues. Une adresse qu'elle ne parvient pas à lire empêche la création de toute la session, si bien que rien n'est facturé pour une liste qui n'a été que partiellement comprise. Le nombre de participants qu'une session peut accueillir est fixé par votre administrateur.
- **Credits per participant** (crédits par participant) — l'allocation de chaque participant. Elle ne peut pas être inférieure au minimum nécessaire à un environnement de lab, ni supérieure au plafond fixé par votre administrateur.
- **Duration (minutes)** (durée) — la durée de fonctionnement de l'environnement de chaque participant une fois son chronomètre démarré, jusqu'à 24 heures.
- **Countdown starts** (début du compte à rebours) — **By trainer** (vous démarrez les chronomètres) ou **When ready** (chaque chronomètre démarre dès que l'environnement correspondant est construit).
- **Region** (région) — l'une des régions de RAD, fixée pour la session.
- **Overrun ceiling (%)** (plafond de dépassement) — de combien un environnement peut dépasser son allocation avant d'être arrêté (20 % par défaut). Vous pouvez le modifier tant que la session est ouverte.
- **Participants buy their own place** (les participants achètent leur propre place) — qui paie. Cette option est **activée** à l'ouverture de la boîte de dialogue ; désactivez-la pour financer vous-même toutes les places. Voir la section suivante.

Vous choisissez le module ou la solution plus tard, sur la session elle-même, et non dans cette boîte de dialogue.

## Qui paie {#who-pays}

Vous en décidez lors de la création de la session. **Ce choix est définitif une fois la session créée.** Pour animer une session dans l'autre mode, créez-en une nouvelle.

**Vous payez.** L'allocation de toute la cohorte — participants × crédits par participant — est réservée sur vos crédits **achetés** lors de la création de la session. Les crédits gratuits qui vous ont été offerts ne peuvent pas être utilisés. La boîte de dialogue indique ce que vous détenez, ce qui est prélevé et ce qui vous restera. L'ajout ultérieur de participants ou de crédits est également payé avec vos crédits achetés.

**Les participants achètent leur propre place (le choix par défaut pour une nouvelle session).** Rien n'est réservé sur vos crédits. Chaque participant paie le montant de crédits par participant avec ses propres crédits achetés (les crédits gratuits ne comptent pas), et ce paiement devient son allocation. **L'environnement d'une personne n'est construit qu'une fois qu'elle a payé.** Les participants que vous ajoutez ultérieurement achètent eux aussi leur propre place.

Quand le paiement d'un participant vous revient-il ? Uniquement une fois que **le chronomètre de ce participant démarre**, c'est-à-dire au moment où il obtient l'accès à son lab. Jusque-là, son paiement est conservé en attente. S'il n'obtient jamais l'accès — son environnement n'a jamais été construit, sa construction a échoué ou il n'a jamais été démarré —, son paiement lui est restitué lorsque la session est soldée.

### Payer vous-même la place d'un participant {#paying-for-a-participants-place-yourself}

Certains participants ne peuvent pas payer sur RAD : leur banque ne fonctionne pas avec le prestataire de paiement, ou ils disposent d'espèces plutôt que d'une carte. Ils peuvent vous payer selon les modalités convenues entre vous, et vous achetez leur place pour eux.

1. Ouvrez la session et trouvez le participant dans la liste **Participants**. Une place qui n'a pas été payée affiche **Pay for place** à côté de **Remove**.
2. Choisissez **Pay for place**. La boîte de dialogue indique le prix — les crédits par participant de la session — et précise qu'il est prélevé sur vos crédits.
3. Ajoutez éventuellement une note sur le paiement, par exemple « Espèces, reçu 0412 » (jusqu'à 120 caractères). Elle est conservée avec la place et s'affiche lorsque vous survolez son badge.
4. Choisissez **Pay N credits** (le prix) pour confirmer.

Le prix est prélevé sur vos crédits **achetés** (les crédits gratuits ne peuvent pas être utilisés) et versé dans la session exactement comme si le participant avait acheté la place. Dès lors, la place fonctionne comme n'importe quelle autre : son environnement est construit, son allocation est dépensée, et ce qu'il n'utilise pas vous revient lors du règlement. La ligne affiche **Paid by trainer**, et le participant reçoit un e-mail l'informant que sa place est payée, afin qu'il ne tente pas de payer à nouveau.

- **Si la place n'est jamais utilisée** — la session se termine avant que son chronomètre ne démarre, ou vous le retirez avant que son environnement ne soit construit —, les crédits reviennent à **vous**, et non au participant, lors du règlement de la session.
- **RAD ne perçoit, ne conserve ni ne vérifie le paiement qui vous a été fait.** Cela reste entre vous et le participant ; RAD enregistre uniquement votre note.
- Seul le formateur de la session peut le faire, car cela dépense vos crédits. Un administrateur qui s'occupe de votre session ne se voit pas proposer le bouton.
- Cette option n'est pas proposée sur une session que vous financez déjà : chaque place y est déjà payée.

### Ce qu'il advient des crédits non utilisés {#what-happens-to-unused-credits}

Quel que soit le mode de financement de la session, tout ce que les participants n'ont pas utilisé vous revient lorsque la session est soldée, sous forme de crédits de recharge, qui n'expirent pas. Dans une session où les participants paient, ce reliquat constitue votre marge.

Si des environnements dépassent leur allocation, le dépassement est imputé sur vos crédits achetés, dans la limite du plafond que vous avez fixé.

### Quand une session est soldée {#when-a-session-settles}

Le règlement attend que Google ait communiqué les coûts cloud de la session. Cela prend généralement jusqu'à une journée après l'arrêt du dernier environnement, car les données de facturation de Google arrivent avec retard. Solder plus tôt vous rembourserait des crédits que les environnements avaient en réalité déjà consommés.

Le panneau **Settlement** (règlement) de la session indique ce qui a été engagé, consommé et remboursé, ainsi que tout dépassement qui vous a été imputé. Vous recevez également un e-mail, **« Lab session settled »**, sauf si vous l'avez désactivé dans vos préférences de notification. Chaque mouvement apparaît dans votre historique de crédits sous forme d'entrées **Lab escrow** et **Lab refund**.

## Participants {#participants}

**Chaque participant a besoin de son propre compte RAD**, avec l'adresse e-mail exacte sous laquelle vous l'avez inscrit.

- **Les participants sans compte** reçoivent par e-mail une invitation à s'inscrire. Un bouton **Resend** sur leur ligne la renvoie, et **Resend to all not yet signed up** au-dessus de la liste fait de même pour toutes les personnes encore en attente ; aucun des deux n'envoie à la même personne plus d'une fois toutes les 10 minutes. Tant qu'ils ne sont pas inscrits, **Provision** les laisse de côté.
- **Les participants qui ont déjà un compte** reçoivent un e-mail les informant qu'ils ont été ajoutés.
- **Dans une session où les participants paient,** les deux e-mails indiquent le prix d'une place, précisent qu'ils doivent l'acheter avant que quoi que ce soit ne soit construit, et expliquent comment procéder. Ils paient depuis la bannière de lab affichée en haut de chaque page RAD, ou choisissent **Decline** à cet endroit s'ils ne souhaitent pas la place. Une place refusée prend fin et est retirée de votre liste de participants ; vous seul pouvez la proposer à nouveau. Si vous payez vous-même la place de quelqu'un, cette personne reçoit un e-mail distinct indiquant qu'elle est payée.

Pour ajouter des personnes à une session en cours, utilisez **Add participants**. Dans une session que vous financez, la boîte de dialogue indique ce qui sera prélevé sur vos crédits avant que vous ne confirmiez. Une adresse déjà présente dans la session — même une que vous avez retirée auparavant — ne peut pas être ajoutée à nouveau.

Pour arrêter des participants, cochez leurs lignes. **End selected** arrête leurs environnements. **Remove** les retire en outre de la session. Leur allocation non utilisée vous revient lors du règlement.

Si vous retirez quelqu'un avant que son environnement ne soit construit, sa bannière lui indique que rien n'a été créé. S'il avait payé sa place, elle lui indique aussi que le paiement est restitué sur ses crédits lors du règlement de la session, puis qu'il l'a été. Si c'est **vous** qui avez payé sa place, les crédits vous reviennent, et il n'en est pas informé autrement.

## Construire et faire fonctionner les environnements {#building-and-running-environments}

1. **Choisissez ce qu'il faut construire** sur la session : **Module** ou **Solution** (issus du catalogue de RAD), ou **Custom** pour l'une de vos propres solutions personnalisées de **Solutions → Solution Catalog → My solutions**. Puis effectuez une recherche dans la liste. Vos solutions personnalisées sont privées : vous seul (ou un administrateur) pouvez en choisir une ; vos participants reçoivent l'environnement, pas la solution. Renseignez la première page de paramètres du module ; la région provient toujours de la session. Votre choix est enregistré avec la session au fur et à mesure, de sorte qu'il est toujours sélectionné lorsque vous quittez la page et y revenez ; il ne change que lorsque vous choisissez autre chose ou le retirez.
2. **Provision.** RAD affiche un plan avec le coût par participant et le coût total avant tout démarrage. Les environnements sont construits quelques-uns à la fois, si bien qu'une grande cohorte prend plus de temps à terminer. Les participants qui ne se sont pas encore inscrits sur RAD sont laissés de côté et comptés sous le bouton (« N waiting to sign up ») ; provisionnez à nouveau une fois qu'ils se sont inscrits.
3. **Démarrez les chronomètres.** Un environnement dont la construction est terminée affiche **Ready** et vous attend. Utilisez **Start all** ou **Start selected**. Avec **When ready**, les chronomètres démarrent d'eux-mêmes. Chaque participant dispose de la durée complète à partir de son propre démarrage.
4. **Pendant le fonctionnement,** utilisez **Extend time** pour ajouter du temps aux environnements en cours (le total ne peut pas dépasser le maximum de la session), **Add credits** pour recharger les allocations, ou **Add to running** pour déployer quelque chose de supplémentaire dans des environnements déjà en cours sans toucher à leurs chronomètres.

Un environnement construit mais jamais démarré ne peut pas attendre indéfiniment : par défaut, au bout d'une semaine sans démarrage, il est détruit, et non démarré. Tant que certains sont en attente, **Keep waiting longer** leur accorde davantage de temps, dans la limite de l'attente maximale autorisée par la plateforme.

### Quand le temps est écoulé {#when-time-runs-out}

Les participants reçoivent un e-mail d'avertissement avant la fin de leur temps, par défaut à 15 et 5 minutes. L'e-mail indique le temps réellement restant. Si vous prolongez leur temps après un avertissement, ils sont avertis à nouveau avant la nouvelle échéance.

À la fin, la facturation de l'environnement est désactivée, tout build encore en cours pour celui-ci est annulé, l'accès du participant au projet est retiré et le projet de lab est supprimé. Un environnement est également arrêté de manière anticipée s'il épuise ses crédits, ou si ses dépenses dépassent le plafond de dépassement.

Chaque participant reçoit un e-mail indiquant que son lab est terminé et pourquoi : son temps était écoulé, ses crédits étaient épuisés, ou il a été arrêté de manière anticipée. L'e-mail indique que c'est **vous** qui l'avez arrêté uniquement si c'est le cas ; lorsqu'un administrateur ou Finance l'a arrêté, il indique que le lab a été arrêté de manière anticipée.

Utilisez **End now** pour mettre fin à toute la session à tout moment. Une session que personne ne provisionne est automatiquement terminée au bout de 14 jours.

### Exporter et réutiliser une session {#exporting-and-reusing-a-session}

Au-dessus de la liste **Participants** d'une session :

- **Export CSV** télécharge le tableau des participants : le statut de chaque participant, les heures de début et de fin, les modules et les ID de déploiement, ainsi que les crédits alloués, consommés et restants.
- **Duplicate session** ouvre **New lab session** prérempli à partir de cette session : ses paramètres, qui paie, ses participants (sauf ceux que vous avez retirés) et le module ou la solution choisi, avec ses paramètres. Les valeurs secrètes ne sont pas copiées ; saisissez-les donc à nouveau. Sa création correspond à une nouvelle session ordinaire, payée comme d'habitude.

## Ce que voient vos participants {#what-your-participants-see}

Les participants voient une bannière de lab en haut de chaque page RAD. Elle indique :

- quand leur environnement est en cours de construction ;
- quand il est prêt et attend que vous démarriez leur chronomètre ;
- une fois en fonctionnement, le temps et les crédits qui leur restent, ainsi qu'un lien vers leur projet dans la console Google Cloud.

Lorsque leur chronomètre démarre, ils obtiennent l'accès à leur projet dans la console. Ils peuvent voir ce qui a été déployé et ses journaux, lire les fichiers de ses buckets de stockage et se connecter à sa base de données Cloud SQL. Sur Cloud Run, ils peuvent supprimer une ancienne révision et exécuter des jobs existants ; sur GKE, ils peuvent redémarrer des pods, restaurer une version précédente d'un déploiement et effectuer une redirection de port (port-forward). Ils ne peuvent pas lire Secret Manager ni les secrets Kubernetes, modifier la configuration ou les images, mettre à l'échelle ni créer de ressources, et tout est supprimé à la fin du lab.

**Ne placez pas d'identifiants dans les paramètres ordinaires.** Les participants peuvent voir les variables d'environnement en clair d'un service Cloud Run et les fichiers de ses buckets. Une valeur qu'un module marque comme secrète, comme un champ de clé API, est stockée dans Secret Manager et leur reste masquée.

Les participants ne peuvent rien déployer eux-mêmes dans un lab. Chaque déploiement de lab vous appartient.

## Ce qu'un formateur ne peut pas faire {#what-a-trainer-cant-do}

- **Changer qui paie** après la création d'une session. Créez plutôt une nouvelle session.
- **Lire les secrets** des déploiements de lab : leurs variables de configuration restent réservées aux administrateurs, et les mots de passe générés au participant et aux administrateurs. Vous pouvez voir les sorties d'un déploiement de lab, sans les valeurs sensibles.
- **Utiliser les paramètres avancés** lors de la mise à jour d'un déploiement de lab. Seuls les administrateurs le peuvent.
- **Voir les déploiements personnels d'un participant.** Votre accès couvre les environnements de lab de vos sessions, et non ce qu'un participant déploie pour lui-même.
- **Forcer une destruction.** Seuls les administrateurs le peuvent.
- **Déployer pour quelqu'un depuis le formulaire de déploiement ordinaire.** Seuls les administrateurs peuvent y déployer pour le compte d'une autre personne ; vous provisionnez pour les participants depuis une session de lab.
- **Purger l'environnement d'un participant avant sa destruction.** Le supprimer détruit les ressources ; purger d'abord uniquement l'enregistrement est réservé à un administrateur. Une fois un lab terminé, vous pouvez toujours purger l'enregistrement d'un environnement déjà supprimé.
- **Changer la région d'une session, ou modifier une session une fois terminée.**

## Obtenir de l'aide {#getting-help}

- Pour les bases de la plateforme — connexion, navigation, crédits et fonctionnement des déploiements —, consultez [Utiliser RAD](using-rad.md).
- Pour le rôle Trainer, l'accès aux sessions de lab, le plafond de participants ou les crédits d'un participant, utilisez l'onglet **Send Message** de la page **Help**, et suivez votre ticket dans **My Tickets**. Le personnel de support, les administrateurs et Finance traitent cette file.
