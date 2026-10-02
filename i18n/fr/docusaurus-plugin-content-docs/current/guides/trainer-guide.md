---
title: "Guide du formateur"
description: "Guide du formateur pour la plateforme RAD — gérer les sessions de lab : créer une session, choisir qui paie, intégrer les participants, provisionner et démarrer les environnements, et comment les crédits inutilisés vous sont restitués."
---

<!-- translated-from: docs/guides/trainer-guide.md @ 7d02aa0b sha256:3c913ce87cc4 -->

# Guide du formateur {#trainer-guide}

<img src="https://storage.googleapis.com/rad-public-2b65/guides/Trainer_Guide.png" alt="Guide du formateur" style={{maxWidth: "100%", borderRadius: "8px"}} />

Pour les formateurs qui animent un cours sur RAD et donnent à chaque participant son propre environnement de lab dans Google Cloud. Nouveau sur RAD ? Commencez par [Utiliser RAD](using-rad.md).

## Ce que vous pouvez faire {#what-you-can-do}

- Gérer les **sessions de lab** depuis **Solutions → Managed Environments**, sous **Lab sessions**. Une session est une cohorte nommée de participants qui partagent une fenêtre temporelle, une allocation de crédits par participant et une région.
- Choisir, par session, **qui paie** pour la place d'un participant : vous, ou chaque participant.
- Payer vous-même la place d'un participant s'il ne peut pas payer sur RAD — par exemple, il vous a payé en espèces, ou sa banque ne fonctionne pas avec le fournisseur de paiement.
- Intégrer le même module ou la même solution dans l'environnement de chaque participant en une seule action, démarrer leurs horloges, ajouter du temps ou des crédits, et terminer les environnements plus tôt.
- Récupérer tous les crédits que vos participants n'ont pas utilisés une fois la session réglée. Ces crédits vous appartiennent.

Vous n'avez pas besoin d'une liste séparée ou d'un formulaire de déploiement spécial. Tout se passe sur **Solutions → Managed Environments**. Si vous ouvrez un formulaire de déploiement ordinaire, il vous renvoie là-bas avec **Open lab sessions**.

## Obtenir l'accès {#getting-access}

Connectez-vous comme n'importe quel utilisateur ; votre compte est créé comme un utilisateur ordinaire. Un administrateur accorde ensuite le rôle de **Trainer** sur la page **Users** — il ne peut pas être demandé depuis l'intérieur de RAD, alors demandez-le. Les sessions de lab doivent également être activées pour la plateforme. Une fois ces deux conditions remplies, un onglet **Managed Environments** apparaît sur **Solutions**, en tant que dernier onglet. Il n'y a pas d'entrée de menu Labs séparée pour les formateurs. Si l'onglet n'apparaît pas, demandez à un administrateur.

Un formateur est aussi toujours un utilisateur, vous conservez donc **Solutions**, **Deployments**, **Credits** et **Help**, et vous arrivez sur **Solutions** lorsque vous vous connectez, comme n'importe quel utilisateur : sur **Build Solution with AI** si vous avez acheté des crédits, sinon sur **Solution Catalog → RAD modules**. **Credits** est l'endroit où vous achetez les crédits achetés à partir desquels une session que vous financez est payée.

Les administrateurs peuvent voir et gérer les sessions de chaque formateur. Lorsqu'ils ajoutent des crédits ou des participants à votre session, les crédits proviennent toujours de **vos** crédits achetés, et vous êtes informé de qui a agi. Le personnel financier peut voir chaque session et peut en terminer une pour arrêter ses dépenses, mais ne peut pas la modifier.

## Créer une session {#creating-a-session}

Sur **Solutions → Managed Environments**, filtrez sur **Lab sessions** et choisissez **New lab session**. La boîte de dialogue demande :

- **Session name** — jusqu'à 100 caractères.
- **Participant emails** — collez une liste. La boîte de dialogue confirme le nombre d'adresses reconnues. Une adresse qu'elle ne peut pas lire empêche la création de toute la session, donc rien n'est facturé pour une liste qui n'a été que partiellement comprise. Le nombre de participants qu'une session peut contenir est défini par votre administrateur.
- **Credits per participant** — l'allocation de chaque participant. Elle ne peut pas être inférieure au minimum requis par un environnement de lab, ni supérieure au plafond fixé par votre administrateur.
- **Duration (minutes)** — la durée d'exécution de l'environnement de chaque participant une fois que son horloge démarre, jusqu'à 24 heures.
- **Countdown starts** — **By trainer** (vous démarrez les horloges) ou **When ready** (chaque horloge démarre dès que cet environnement est construit).
- **Region** — l'une des régions de RAD, fixe pour la session.
- **Overrun ceiling (%)** — le dépassement maximal au-delà de l'allocation qu'un environnement peut atteindre avant d'être éteint (par défaut 20 %). Vous pouvez modifier cela pendant que la session est ouverte.
- **Participants buy their own place** — qui paie. Il est **activé** lorsque la boîte de dialogue s'ouvre ; désactivez-le pour financer vous-même chaque place. Voir la section suivante.

Vous choisissez le module ou la solution plus tard, sur la session elle-même, pas dans cette boîte de dialogue.

## Qui paie {#who-pays}

Vous décidez lors de la création de la session. **Ce choix est fixe une fois la session créée.** Pour exécuter une session d'une autre manière, créez-en une nouvelle.

**Vous payez.** L'allocation de toute la cohorte — participants × crédits par participant — est réservée à partir de vos crédits **achetés** lors de la création de la session. Les crédits gratuits que vous avez reçus ne peuvent pas être utilisés. La boîte de dialogue montre ce que vous détenez, ce qui est prélevé et ce qu'il vous restera. L'ajout ultérieur de participants ou de crédits est également payé à partir de vos crédits achetés.

**Les participants achètent leur propre place (le paramètre par défaut pour une nouvelle session).** Rien n'est réservé à partir de vos crédits. Chaque participant paie les crédits par participant à partir de ses propres crédits achetés (les crédits gratuits ne comptent pas), et ce paiement devient son allocation. **L'environnement de personne n'est construit tant qu'il n'a pas payé.** Les participants que vous ajoutez plus tard achètent également leur propre place.

**TVA.** Si l'équipe financière de RAD a défini un taux de TVA pour celui qui paie une place, cette place coûte l'allocation plus la TVA, de sorte que l'allocation dure aussi longtemps que le plan le prévoit : votre taux pour une session que vous financez ou une place que vous payez, le propre taux du participant pour une place qu'il achète.

Quand le paiement d'un participant devient-il le vôtre ? Seulement une fois que **l'horloge de ce participant démarre**, c'est-à-dire au moment où il accède à son lab. Jusque-là, son paiement est retenu. S'il n'obtient jamais l'accès — son environnement n'a jamais été construit, ou a échoué à être construit, ou n'a jamais été démarré — son paiement lui est restitué lorsque la session est réglée.

### Payer vous-même la place d'un participant {#paying-for-a-participants-place-yourself}

Certains participants ne peuvent pas payer sur RAD : leur banque ne fonctionne pas avec le fournisseur de paiement, ou ils ont de l'argent liquide plutôt qu'une carte. Ils peuvent vous payer comme vous le souhaitez, et vous achetez leur place pour eux.

1. Ouvrez la session et trouvez le participant dans la liste **Participants**. Une place qui n'a pas été payée affiche **Pay for place** à côté de **Remove**.
2. Choisissez **Pay for place**. La boîte de dialogue affiche le prix — les crédits par participant de la session — et indique qu'il provient de vos crédits.
3. Ajoutez éventuellement une note sur le paiement, telle que "Espèces, reçu 0412" (jusqu'à 120 caractères). Elle est conservée avec la place et affichée lorsque vous survolez son badge.
4. Choisissez **Pay N credits** (le prix) pour confirmer.

Le prix est prélevé sur vos crédits **achetés** (les crédits gratuits ne peuvent pas être utilisés) et versé à la session exactement comme si le participant avait acheté la place. À partir de ce moment, la place fonctionne comme n'importe quelle autre : leur environnement est construit, leur allocation est dépensée, et ce qu'ils n'utilisent pas vous est restitué lors du règlement. La ligne affiche **Paid by trainer**, et le participant reçoit un e-mail l'informant que sa place est payée, afin qu'il n'essaie pas de payer à nouveau.

- **Si la place n'est jamais utilisée** — la session se termine avant que leur horloge ne démarre, ou vous les retirez avant que leur environnement ne soit construit — les crédits vous sont restitués à **vous**, et non au participant, lorsque la session est réglée.
- **RAD ne prend pas, ne retient pas et ne vérifie pas le paiement qui vous est fait.** C'est entre vous et le participant ; RAD n'enregistre que votre note.
- Seul le formateur de la session peut le faire, car cela dépense vos crédits. Un administrateur s'occupant de votre session ne se voit pas proposer le bouton.
- Il n'est pas proposé sur une session que vous financez déjà : chaque place y est déjà payée.

### Ce qui arrive aux crédits inutilisés {#what-happens-to-unused-credits}

Quelle que soit la manière dont la session est financée, ce que les participants n'ont pas utilisé vous est restitué à **vous** lorsque la session est réglée, dans vos crédits de recharge, qui n'expirent pas. Dans une session où les participants paient, ce reste est votre marge.

Si les environnements dépassent leur allocation, le dépassement est facturé sur vos crédits achetés, jusqu'au plafond que vous avez défini.

### Quand une session est réglée {#when-a-session-settles}

Le règlement attend que Google ait signalé les coûts cloud de la session. Cela prend généralement jusqu'à un jour après l'arrêt du dernier environnement, car les données de facturation de Google arrivent en retard. Un règlement plus précoce vous rembourserait des crédits que les environnements avaient en fait déjà utilisés.

Le panneau **Settlement** de la session montre ce qui a été engagé, consommé et remboursé, ainsi que tout dépassement qui vous a été facturé. Vous recevez également un e-mail, **"Lab session settled"**, sauf si vous l'avez désactivé dans vos préférences de notification. Chaque mouvement apparaît dans votre historique de crédits sous forme d'entrées **Lab escrow** et **Lab refund**.

## Participants {#participants}

**Chaque participant a besoin de son propre compte RAD**, sous l'adresse e-mail exacte que vous avez inscrite.

- **Les participants sans compte** reçoivent une invitation par e-mail à s'inscrire. Un bouton **Resend** sur leur ligne la renvoie, et **Resend to all not yet signed up** au-dessus de la liste fait de même pour tous ceux qui attendent encore ; aucun n'envoie à la même personne plus souvent que toutes les 10 minutes. Tant qu'ils ne se sont pas inscrits, **Provision** les exclut.
- **Les participants qui ont déjà un compte** reçoivent un e-mail pour leur dire qu'ils ont été ajoutés.
- **Dans une session où les participants paient,** les deux e-mails indiquent le prix d'une place et leur disent qu'ils doivent l'acheter avant que quoi que ce soit ne soit construit, et comment le faire. Ils paient depuis la bannière du lab en haut de chaque page RAD, ou choisissent **Decline** là s'ils ne veulent pas la place. Une place refusée se termine et est retirée de votre liste ; vous seul pouvez la proposer à nouveau. Si vous payez vous-même la place de quelqu'un, il reçoit un e-mail séparé lui indiquant qu'elle est payée.

Pour ajouter des personnes à une session en cours, utilisez **Add participants**. Dans une session que vous financez, la boîte de dialogue montre ce qu'elle prendra sur vos crédits avant que vous ne confirmiez. Une adresse déjà dans la session — même une que vous avez supprimée plus tôt — ne peut pas être ajoutée à nouveau.

Pour arrêter des personnes, cochez leurs lignes. **End selected** éteint leurs environnements. **Remove** les retire également de la session. Leur allocation inutilisée vous est restituée lors du règlement.

Si vous retirez quelqu'un avant que son environnement ne soit construit, sa bannière lui indique que rien n'a été créé. S'il avait payé sa place, elle lui indique également que le paiement est restitué à ses crédits lorsque la session est réglée, puis que cela a été fait. Si **vous** avez payé sa place, les crédits vous sont restitués à vous, et ils ne sont pas informés du contraire.

## Construire et exécuter des environnements {#building-and-running-environments}

1. **Choisissez quoi construire** sur la session : **Module** ou **Solution** (du catalogue de RAD), ou **Custom** pour l'une de vos propres solutions personnalisées depuis **Solutions → Solution Catalog → My solutions**. Ensuite, recherchez dans la liste. Vos solutions personnalisées vous sont privées, donc vous seul (ou un administrateur) pouvez en choisir une ; vos participants obtiennent l'environnement, pas la solution. Remplissez la première page de paramètres du module ; la région provient toujours de la session. Votre choix est enregistré avec la session au fur et à mesure que vous le faites, il reste donc sélectionné lorsque vous quittez la page et revenez ; il ne change que lorsque vous choisissez autre chose ou le supprimez.
2. **Provision.** RAD affiche un plan avec le coût par participant et au total avant que quoi que ce soit ne commence. Les environnements se construisent quelques-uns à la fois, donc une grande cohorte prend plus de temps à terminer. Les participants qui ne se sont pas encore inscrits à RAD sont exclus et comptés sous le bouton ("N waiting to sign up") ; provisionnez à nouveau une fois qu'ils l'ont fait.
3. **Démarrez les horloges.** Un environnement qui a terminé sa construction affiche **Ready** et vous attend ; une fois que chaque environnement dans une session **By trainer** est construit, la liste des sessions affiche la session comme **Ready to start**. Utilisez **Start all** ou **Start selected**. Avec **When ready**, les horloges démarrent d'elles-mêmes. Chaque participant obtient la durée complète à partir de son propre démarrage.
4. **Pendant qu'il fonctionne,** utilisez **Extend time** pour ajouter du temps aux environnements en cours d'exécution (le total ne peut pas dépasser le maximum de la session), **Add credits** pour recharger les allocations, ou **Add to running** pour déployer quelque chose de supplémentaire dans les environnements qui sont déjà en cours d'exécution sans toucher à leurs horloges.

Un environnement qui est construit mais jamais démarré ne peut pas attendre éternellement : par défaut, après une semaine sans démarrage, il est détruit, non démarré. Tant que certains attendent, **Keep waiting longer** leur donne plus de temps, jusqu'à la plus longue attente autorisée par la plateforme.

### Quand le temps est écoulé {#when-time-runs-out}

Les participants reçoivent un avertissement par e-mail avant la fin de leur temps, par défaut à 15 et 5 minutes. L'e-mail indique le temps réellement restant. Si vous prolongez leur temps après un avertissement, ils sont avertis à nouveau avant la nouvelle fin.

À la fin, la facturation de l'environnement est désactivée, toute construction encore en cours est annulée, l'accès du participant au projet est supprimé et le projet de lab est supprimé. Un environnement est également éteint plus tôt s'il utilise tous ses crédits, ou si ses dépenses dépassent le plafond de dépassement.

Chaque participant reçoit un e-mail indiquant que son lab a pris fin et pourquoi : son temps était écoulé, ses crédits étaient épuisés, ou il a été terminé plus tôt. Il indique que **vous** l'avez terminé seulement si vous l'avez fait ; lorsqu'un administrateur ou le service financier l'a terminé, il indique que le lab a été terminé plus tôt.

Utilisez **End now** pour terminer toute la session à tout moment. Cela arrête immédiatement les dépenses de la session mais ne déplace pas d'argent lui-même : RAD vérifie toutes les 10 minutes les sessions prêtes à être réglées, et règle la vôtre une fois que Google a signalé ses coûts cloud (voir [Quand une session est réglée](#when-a-session-settles)). Si aucun environnement n'a jamais été construit, il n'y a rien à attendre, et le remboursement arrive à la prochaine vérification. Une session que personne ne provisionne est automatiquement terminée après 14 jours.

### Exporter et réutiliser une session {#exporting-and-reusing-a-session}

Au-dessus de la liste **Participants** d'une session :

- **Export CSV** télécharge le tableau des participants : le statut de chaque participant, les heures de début et de fin, les modules et les ID de déploiement, et les crédits alloués, consommés et restants.
- **Duplicate session** ouvre **New lab session** rempli à partir de celle-ci : ses paramètres, qui paie, ses participants (sauf ceux que vous avez supprimés) et le module ou la solution que vous avez choisi, avec ses paramètres. Les valeurs secrètes ne sont pas copiées, alors saisissez-les à nouveau. La création est une nouvelle session ordinaire, payée comme d'habitude.

## Ce que vos participants voient {#what-your-participants-see}

Les participants voient une bannière de lab en haut de chaque page RAD. Elle affiche :

- quand leur environnement est en cours de construction ;
- quand il est prêt et attend que vous démarriez leur horloge ;
- une fois qu'il fonctionne, leur temps et leurs crédits restants, et un lien vers leur projet dans la console Google Cloud.

Lorsque leur horloge démarre, ils accèdent à leur projet dans la console. Ils peuvent voir ce qui a été déployé et ses journaux, lire les fichiers dans ses buckets de stockage et se connecter à sa base de données Cloud SQL. Sur Cloud Run, ils peuvent supprimer une ancienne révision et exécuter des jobs existants ; sur GKE, ils peuvent redémarrer des pods, annuler un déploiement et rediriger des ports. Ils ne peuvent pas lire les secrets de Secret Manager ou de Kubernetes, modifier la configuration ou les images, mettre à l'échelle ou créer des ressources, et tout est supprimé à la fin du lab.

**Ne mettez pas les identifiants dans les paramètres ordinaires.** Les participants peuvent voir les variables d'environnement en clair d'un service Cloud Run et les fichiers dans ses buckets. Une valeur qu'un module marque comme secrète, telle qu'un champ de clé API, est stockée dans Secret Manager et leur reste cachée.

Les participants ne peuvent rien déployer eux-mêmes dans un lab. Chaque déploiement de lab est le vôtre.

## Ce qu'un formateur ne peut pas faire {#what-a-trainer-cant-do}

- **Changer qui paie** après avoir créé une session. Créez plutôt une nouvelle session.
- **Lire les secrets** sur les déploiements de lab : leurs variables de configuration restent avec les administrateurs, et les mots de passe générés avec le participant et les administrateurs. Vous pouvez voir les sorties d'un déploiement de lab, avec les valeurs sensibles supprimées.
- **Utiliser les paramètres avancés** lors de la mise à jour d'un déploiement de lab. Seuls les administrateurs le peuvent.
- **Voir les propres déploiements d'un participant.** Votre accès couvre les environnements de lab dans vos sessions, pas ce qu'un participant déploie pour lui-même.
- **Forcer une suppression.** Seuls les administrateurs le peuvent.
- **Déployer pour quelqu'un à partir du formulaire de déploiement ordinaire.** Seuls les administrateurs peuvent déployer au nom d'une autre personne là-bas ; vous provisionnez pour les participants à partir d'une session de lab.
- **Purger l'environnement d'un participant avant qu'il ne soit détruit.** Le supprimer détruit les ressources ; purger uniquement l'enregistrement en premier est pour un administrateur. Une fois qu'un lab est terminé, vous pouvez toujours purger l'enregistrement d'un environnement qui a déjà été supprimé.
- **Changer la région d'une session, ou modifier une session une fois qu'elle est terminée.**

## Obtenir de l'aide {#getting-help}

- Pour les bases de la plateforme — connexion, navigation, crédits et fonctionnement des déploiements — voir [Utiliser RAD](using-rad.md).
- Pour le rôle de formateur, l'accès aux sessions de lab, le plafond de participants ou les crédits d'un participant, utilisez l'onglet **Send Message** de la page **Help**, et suivez votre ticket sur **My Tickets**. Le personnel de support, les administrateurs et les finances gèrent cette file d'attente.
