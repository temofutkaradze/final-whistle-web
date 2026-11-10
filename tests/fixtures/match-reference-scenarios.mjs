// Synthetic reconstructions of the 17 labeled collage tiles, not real results.
const goal=(side,minute,name,detail='Normal Goal',extra=null)=>({type:'Goal',detail,comments:null,time:{elapsed:minute,extra},team:{id:side==='home'?1:2,name:side==='home'?'Home':'Away'},player:{id:name?Array.from(name).reduce((v,c)=>(v*31+c.charCodeAt(0))>>>0,0)%100000:null,name}});
const card=(side,minute,name,detail='Red Card')=>({...goal(side,minute,name),type:'Card',detail});
const row=(id,home,away,hs,as,league,events)=>({id,home,away,hs,as,league,events,match:{home_team:home,away_team:away,home_team_id:1,away_team_id:2,home_score:hs,away_score:as}});
export const referenceScenarios=[
 row(9001,'Barcelona','Real Madrid',4,2,140,[goal('home',12,'Robert Lewandowski'),goal('home',38,'Robert Lewandowski'),goal('home',71,'Robert Lewandowski'),goal('home',56,'Lamine Yamal'),goal('away',20,'Vinicius Junior'),goal('away',88,'Kylian Mbappe')]),
 row(9002,'Liverpool','Manchester City',2,2,39,[goal('home',25,'Mohamed Salah','Penalty'),goal('home',80,'Cody Gakpo'),goal('away',41,'Erling Haaland','Missed Penalty'),goal('away',61,'Erling Haaland'),goal('away',90,'Phil Foden','Normal Goal',2)]),
 row(9003,'Barcelona','Real Madrid',2,1,140,[goal('home',10,'Robert Lewandowski'),goal('away',25,'Daniel Carvajal','Own Goal'),goal('away',70,'Vinicius Junior')]),
 row(9004,'Inter','Milan',2,1,135,[goal('home',10,'Lautaro Martinez'),goal('away',33,'Fikayo Tomori','Own Goal'),goal('away',70,'Rafael Leao')]),
 row(9005,'Bayern Munich','Borussia Dortmund',1,1,78,[goal('away',60,'Mats Hummels','Own Goal'),goal('home',15,'Joshua Kimmich','Own Goal')]),
 row(9006,'Arsenal','Chelsea',1,0,39,[goal('home',30,'Bukayo Saka'),card('home',78,'William Saliba'),card('away',45,'Moises Caicedo','Yellow Card'),card('away',60,'Moises Caicedo','Second Yellow card')]),
 row(9007,'Juventus','Napoli',0,0,135,[card('home',80,'Danilo'),card('away',55,'Stanislav Lobotka','Yellow/red card')]),
 row(9008,'Paris Saint Germain','Marseille',1,1,61,[goal('home',30,'Ousmane Dembele'),goal('away',70,'Pierre-Emerick Aubameyang')]),
 row(9009,'Manchester City','Everton',2,0,39,[goal('home',15,'Bernardo Silva'),{...goal('home',50,'Bruno Silva'),player:{id:999,name:'Bruno Silva'}}]),
 row(9010,'Inter','Roma',3,4,135,[goal('home',45,'Lautaro Martinez','Normal Goal',2),goal('home',90,'Lautaro Martinez','Normal Goal',4),goal('home',105,'Nicolo Barella'),goal('away',30,'Paulo Dybala'),goal('away',120,'Paulo Dybala','Normal Goal',1),goal('away',60,'Lorenzo Pellegrini','Penalty'),goal('away',100,'Lorenzo Pellegrini')]),
 row(9011,'Atletico Madrid','Getafe',2,0,140,[goal('home',15,null),goal('home',40,'Antoine Griezmann')]),
 row(9012,'Benfica','Porto',4,0,94,[goal('home',10,'Joao Mario'),goal('home',20,'Rafa Silva'),goal('home',30,'Angel Di Maria'),goal('home',40,'Arthur Cabral'),card('home',60,'Nicolas Otamendi')]),
 row(9013,'Villarreal','Betis',0,0,140,[card('home',20,'Test Player','Yellow Card'),{...goal('home',25,'Test Player'),type:'subst',detail:'Substitution'},goal('home',30,'Test Player','Goal cancelled')]),
 row(9014,'Lazio','Torino',2,0,135,[goal('home',20,'Ciro Immobile'),goal('home',90,'Luis Alberto','Penalty',6)]),
 row(9015,'Borussia Monchengladbach','Paris Saint Germain',5,4,2,[goal('home',5,'Marcus Thuram'),goal('home',15,'Alassane Plea'),goal('home',25,'Lars Stindl'),goal('home',35,'Jonas Hofmann'),goal('home',45,'Ramy Bensebaini'),goal('away',8,'Kylian Mbappe'),goal('away',18,'Neymar Junior'),goal('away',28,'Marco Verratti'),goal('away',38,'Achraf Hakimi')]),
 row(9016,'Barcelona','Real Madrid',3,2,140,[goal('home',37,'Robert Lewandowski'),goal('away',25,'Daniel Carvajal','Own Goal'),goal('home',33,'Lamine Yamal','Penalty'),goal('away',50,'Kylian Mbappe','Missed Penalty'),card('away',79,'Aurelien Tchouameni','Second Yellow card'),goal('away',90,'Vinicius Junior','Normal Goal',3),goal('away',90,'Vinicius Junior','Normal Goal',6)]),
 row(9017,'Girona','Osasuna',1,0,140,[]),
];
