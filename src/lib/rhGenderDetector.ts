// Detector de gênero por nome usando lista de nomes brasileiros comuns (IBGE)
// Retorna "M" | "F" | "N" (não identificado)

const MALE = new Set<string>([
  "joao","jose","antonio","francisco","carlos","paulo","pedro","lucas","luiz","luis","marcos","luiz","gabriel",
  "rafael","daniel","marcelo","bruno","eduardo","felipe","raimundo","rodrigo","manoel","manuel","ricardo","sebastiao",
  "fernando","tiago","thiago","fabio","andre","alex","alexandre","fabricio","leonardo","leandro","mateus","matheus",
  "vinicius","gustavo","henrique","arthur","artur","miguel","davi","david","bernardo","heitor","theo","enzo",
  "lorenzo","caio","diego","diogo","douglas","edson","elias","edivaldo","emanuel","everton","ezequiel","fabiano",
  "geraldo","gilberto","gilmar","guilherme","helio","hugo","igor","ivan","jair","jeferson","jefferson","jonas",
  "jonatas","jorge","juliano","julio","kaio","kevin","laercio","leonel","levi","lourival","marcio","mario",
  "mauricio","mauro","moacir","murilo","nicolas","otavio","patrick","percival","rafael","ramon","raul","reinaldo",
  "renan","renato","roberto","robson","rogerio","romario","romulo","ronaldo","rubens","samuel","sergio","silas",
  "tadeu","talles","tales","tarcisio","valdir","valter","wagner","wallace","washington","wesley","willian","william",
  "yuri","ademir","adriano","aelson","afonso","agnaldo","alan","alceu","alcides","aldo","alfredo","almir",
  "altair","alvaro","amadeu","amauri","ananias","anderson","aparecido","aristides","arlindo","armando","arnaldo",
  "augusto","aurelio","ayrton","baltazar","barbosa","benedito","benicio","bento","bonifacio","caetano","camilo",
  "celso","cesar","cicero","claudio","cleber","cleiton","cleverson","clovis","conrado","cristiano","danilo",
  "dario","decio","delcio","denis","denilson","derli","dilson","dimas","dinaldo","domingos","donizete","durval",
  "ednaldo","edney","edmar","edmilson","edmundo","ednei","edney","egidio","ednilson","elenildo","eli","elisio",
  "elio","ely","emerson","ernani","ernesto","eronildes","euclides","eugenio","eurico","euvaldo","evandro","evaristo",
  "ezequiel","fabio","feliciano","felix","fernandes","filipe","flavio","francinaldo","fred","gabriel","genival",
  "geovane","geovani","gerson","gilvan","gilson","gilmar","gladson","glauber","glauco","godofredo","graciano",
  "haroldo","hebert","hector","helder","hilario","hipolito","horacio","humberto","idelfonso","ilan","irineu",
  "isaac","isaias","ismael","ivanildo","jadir","jair","jairo","jandir","janderson","janio","jarbas","jardel",
  "jeronimo","jesus","joacir","joao","joaquim","joel","jonatan","jordan","jovino","judas","juliano","julian",
  "junior","justino","keller","kennedy","kleber","klever","ladislau","laercio","lazaro","leandro","lelio",
  "leoncio","liberato","lindolfo","lindomar","lino","lionel","loris","lourenco","lucio","luiz","macedo",
  "macielly","magno","manfredo","manuel","marcio","marciano","marcondes","marinho","marino","mario","marlon",
  "martim","martinho","mateus","mauricio","maycon","mayron","melquior","milton","misael","moacir","moises",
  "natanael","nelson","nestor","nicacio","nilo","nilson","nilton","noe","norberto","odair","odilon","olavo",
  "olegario","oliver","omar","orlando","oscar","osmar","osmir","osni","osvaldo","oswaldo","otacilio","otavio",
  "otoniel","ovidio","ozeas","pablo","paschoal","pascoal","peterson","plinio","quincas","raimundo","ramires",
  "rangel","reginaldo","regis","reuel","reuben","ribamar","ricarte","rivelino","robert","roberval","roque",
  "ronald","ronaldo","ronan","rondinelli","ronivaldo","rosalvo","rosivaldo","rubem","ruben","ruy","ryan",
  "saimon","saulo","savio","seraphim","sergio","severino","silvano","silvio","sinval","tomas","ubirajara",
  "ubiratan","ulisses","ulysses","uriel","valdemar","valdeci","valdemir","valdir","valentin","valmir","valter",
  "vanderlei","velson","vicente","vidal","vinicius","vitor","viviano","wadson","walmir","waldemar","waldir",
  "walfrido","walison","wallisson","walmir","wando","wandeir","wesleys","wesley","wilbert","wilker","wilson",
  "winston","wladimir","yago","ygor","zacarias","zedequias"
]);

const FEMALE = new Set<string>([
  "maria","ana","francisca","antonia","adriana","juliana","marcia","fernanda","patricia","aline","sandra","camila",
  "amanda","bruna","jessica","leticia","julia","luciana","vanessa","mariana","gabriela","carla","cristina","rita",
  "monica","priscila","beatriz","larissa","cintia","cynthia","silvia","tatiana","claudia","leila","luana","raquel",
  "renata","roberta","rosana","sabrina","simone","sonia","tania","valeria","vera","viviane","yara","alessandra",
  "alice","alicia","alana","alexandra","alessia","aliny","aliana","amelia","andrea","andreia","angela","angelica",
  "anita","apoena","aparecida","arlete","barbara","beatris","benedita","bianca","branca","brenda","brunela","caio",
  "carina","carla","carmen","carmem","carol","carolina","catarina","catia","cassandra","celia","celiana","celiane",
  "cibele","cibelle","cida","cintia","clara","clarissa","clarice","clea","cleide","cleonice","cleusa","conceicao",
  "constanca","cora","cristiana","cristiane","dagmar","daiana","daiane","dalila","dalva","damaris","daniela",
  "daniele","danielly","dayana","dayane","debora","deise","deisy","denilce","denilda","denise","desiree","diana",
  "diane","dilma","dina","dinorah","dirce","dolores","dora","dorinha","dorotea","drica","dulce","edna","edwiges",
  "elaine","elaisa","elci","eleanor","elena","eliana","eliane","elis","elisa","elisabete","elisangela","ellen",
  "elma","eloa","eloisa","elvira","ema","emanuela","emilia","emilly","ester","esther","eugenia","eunice","eva",
  "evania","evelyn","fabiana","fabiola","fatima","fernanda","filomena","flavia","franciele","francielle","gabi",
  "gabriela","geisa","geni","georgia","gertrudes","giane","gilda","gilmara","gioconda","giovana","giovanna","gisela",
  "gisele","giselle","gislaine","gizele","gloria","gracas","graziela","graziele","grazielle","greice","greicy",
  "grettel","guiomar","hadassa","heidi","helena","helga","heloisa","helo","henrieta","heralda","hilda","hortencia",
  "iara","ida","idelma","ieda","ilda","ines","ingrid","iolanda","iracema","iraci","irene","iris","isabel",
  "isabela","isabella","isadora","isaura","isidora","isis","iva","ivana","ivone","jacira","jacqueline","jade",
  "jamile","jamily","jandira","janete","janice","janine","jaqueline","jenifer","jennifer","jessica","jhenifer",
  "joana","joaquina","joelma","joice","jordana","josefa","josiane","josiele","jovita","juçara","juliana","julieta",
  "juliene","juraci","jurema","karen","karina","karine","karla","karol","karoline","katia","kelly","keren","kerolen",
  "kerolly","keylla","kiara","kimberly","laila","laisa","lais","lana","lara","larissa","laudelina","laura",
  "lauriane","lavinia","layla","layra","lea","leandra","leda","lena","leni","lenir","leoneide","leonidia","lia",
  "liana","libia","lidia","liduina","lila","liliam","lilian","liliana","lilly","linda","lis","lisa","lisangela",
  "livia","liz","lizandra","lorena","loreta","lourdes","luana","lucelia","lucia","luciene","ludmila","luisa",
  "luiza","lurdes","luzia","mafalda","magali","magda","manoela","manuela","mara","marcela","marcele","marciane",
  "margarete","margarida","margot","maria","mariah","mariane","marielle","marilda","marilene","marilia","marilu",
  "marina","marisa","marisol","marlene","marli","marta","martha","mary","matilde","maura","maxima","mayara",
  "meire","meiry","melania","melissa","mercedes","merces","michele","michelle","midori","milena","mila","minerva",
  "miranda","miriam","mirella","mirian","mirna","monalisa","monica","myrian","nadia","nadir","nair","naiara",
  "namibia","nara","natacha","natalia","natanya","nathalia","nathaly","neide","nelci","neuza","nice","nicolly",
  "nilda","nilza","ninive","nivea","noeli","noemia","nubia","odete","ofelia","olivia","onelia","orquidea","oscarina",
  "otavia","palmira","pamela","patricia","paula","paulina","penha","pia","pietra","poliana","polyana","preciosa",
  "primavera","priscila","quezia","raissa","rafaela","raika","raquel","rebeca","regiane","regina","reginalda",
  "renata","ridiane","rita","rivanea","roberta","romilda","rosa","rosalia","rosane","rosangela","roseane","roseli",
  "rosemary","rosilda","roxana","rute","ruth","sabina","sabrina","safira","salete","samanta","samantha","samara",
  "sandra","sara","sarah","selene","selma","semiramis","serena","silmara","silvana","silvia","simara","simone",
  "sirley","solange","sonia","stefani","stefany","stella","sueli","susana","suzana","suzane","suzi","sylvia",
  "tabata","tabita","tainara","tais","talita","tamara","tania","tassia","tatiana","tatiane","tayna","telma",
  "teresa","teresinha","terezinha","thais","thaisa","thalia","thaliane","thamires","thamiris","thayane","thayla",
  "thereza","tiana","tirza","ubirany","ueslei","ulrica","ulrika","urania","ursula","valda","valdeci","valdete",
  "valentina","valeria","valeska","vanda","vania","vanusa","veronica","violeta","virginia","vitoria","viviana",
  "viviane","walda","walesca","walkiria","wanda","wania","wilma","yara","yasmin","yolanda","yvone","zaida",
  "zelia","zenaide","zilda","zilma","zuleica","zulmira"
]);

function normalize(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function detectGender(fullName: string | null | undefined): "M" | "F" | "N" {
  if (!fullName) return "N";
  const first = normalize(fullName).split(/\s+/)[0];
  if (!first) return "N";
  if (FEMALE.has(first)) return "F";
  if (MALE.has(first)) return "M";
  // Heurística secundária: nomes terminados em "a" tendem a feminino, em "o" a masculino
  if (/a$/.test(first)) return "F";
  if (/o$/.test(first)) return "M";
  return "N";
}

export function detectGenderBatch(names: string[]): Array<"M" | "F" | "N"> {
  return names.map(detectGender);
}