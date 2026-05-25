const MALE = new Set<string>([
  "joao","jose","antonio","francisco","carlos","paulo","pedro","lucas","luiz","luis","marcos","gabriel",
  "rafael","daniel","marcelo","bruno","eduardo","felipe","raimundo","rodrigo","manoel","manuel","ricardo",
  "sebastiao","fernando","tiago","thiago","fabio","andre","alex","alexandre","fabricio","leonardo","leandro",
  "mateus","matheus","vinicius","gustavo","henrique","arthur","artur","miguel","davi","david","bernardo",
  "heitor","theo","enzo","lorenzo","caio","diego","diogo","douglas","edson","elias","edivaldo","emanuel",
  "everton","ezequiel","fabiano","geraldo","gilberto","gilmar","guilherme","helio","hugo","igor","ivan",
  "jair","jeferson","jefferson","jonas","jonatas","jorge","juliano","julio","kaio","kevin","laercio",
  "leonel","levi","lourival","marcio","mario","mauricio","mauro","moacir","murilo","nicolas","otavio",
  "patrick","percival","ramon","raul","reinaldo","renan","renato","roberto","robson","rogerio","romario",
  "romulo","ronaldo","rubens","samuel","sergio","silas","tadeu","talles","tales","tarcisio","valdir",
  "valter","wagner","wallace","washington","wesley","willian","william","yuri","ademir","adriano","afonso",
  "agnaldo","alan","alceu","alcides","aldo","alfredo","almir","altair","alvaro","amadeu","amauri","anderson",
  "aparecido","aristides","arlindo","armando","arnaldo","augusto","aurelio","ayrton","benedito","benicio",
  "bento","caetano","camilo","celso","cesar","cicero","claudio","cleber","cleiton","cleverson","clovis",
  "conrado","cristiano","danilo","dario","denis","denilson","dilson","dimas","domingos","donizete","durval",
  "ednaldo","edmar","edmilson","edmundo","egidio","emerson","ernani","ernesto","euclides","eugenio","eurico",
  "evandro","evaristo","feliciano","felix","filipe","flavio","fred","genival","geovane","geovani","gerson",
  "gilvan","gilson","gladson","glauber","glauco","godofredo","haroldo","hebert","hector","helder","hilario",
  "horacio","humberto","irineu","isaac","isaias","ismael","ivanildo","jadir","jairo","janderson","janio",
  "jarbas","jardel","jeronimo","jesus","joacir","joaquim","joel","jonatan","jordan","jovino","julian",
  "junior","justino","kennedy","kleber","klever","lazaro","leandro","lelio","leoncio","liberato","lindolfo",
  "lindomar","lino","lionel","lourenco","lucio","magno","marciano","marcondes","marinho","marino","marlon",
  "martim","martinho","maycon","mayron","melquior","milton","misael","moises","natanael","nelson","nestor",
  "nicacio","nilo","nilson","nilton","noe","norberto","odair","odilon","olavo","oliver","omar","orlando",
  "oscar","osmar","osmir","osni","osvaldo","oswaldo","otacilio","otoniel","pablo","paschoal","pascoal",
  "peterson","plinio","raimundo","ramires","rangel","reginaldo","regis","ribamar","ricarte","rivelino",
  "robert","roberval","roque","ronald","ronan","rondinelli","ronivaldo","rosalvo","rosivaldo","rubem",
  "ruben","ruy","ryan","saulo","savio","seraphim","severino","silvano","silvio","sinval","tomas","ubirajara",
  "ubiratan","ulisses","ulysses","uriel","valdemar","valdeci","valdemir","valentin","valmir","vanderlei",
  "vicente","vidal","viviano","wadson","walmir","waldemar","waldir","walison","wallisson","wando","wilbert",
  "wilker","wilson","winston","wladimir","yago","ygor","zacarias","zedequias",
  "alisson","emanoel","ewerton","israel","jaferson","luan","maykon","maikon","oseas","reivisson",
  "thallys","thierry","willames","edilson","eder","elio","elivaldo","eudes","iranildo",
  "jailson","jaime","jaison","jansen","jean","jeilson","jeison","jeomar","jerson","jhonatan","joab",
  "jonaldson","josimar","josivaldo","kael","kaique","kaleb","kauan","kenedy","keven","kewin","klesson",
  "kleyson","laelson","laerte","lairson","lairton","lander","lanio","laudelino","laurindo",
  "leanderson","leidson","leilson","leison","lenildo","lenio","lennon","leonaldo","leonan","leonidas",
  "lincon","lincoln","luciano","lucinaldo","lucinei","lucivaldo","maelson","maicon","maiden",
  "mailson","mailton","marcenio","marcelino","maximiliano","maximo","maykel","maylon","maylton","moabe",
  "newton","noel","obed","obede","odecio","odecir","odimir","odival","odorico","olecio","olecir",
  "olemar","olimar","olindo","olmar","olmir","olton","orinaldo","orival","osanildo","osiias","osiris",
  "osmanildo","oswaldir","saimon","ueslei","velson","walton","welton","wesleys"
]);

const FEMALE = new Set<string>([
  "maria","ana","francisca","antonia","adriana","juliana","marcia","fernanda","patricia","aline","sandra",
  "camila","amanda","bruna","jessica","leticia","julia","luciana","vanessa","mariana","gabriela","carla",
  "cristina","rita","monica","priscila","beatriz","larissa","cintia","cynthia","silvia","tatiana","claudia",
  "leila","luana","raquel","renata","roberta","rosana","sabrina","simone","sonia","tania","valeria","vera",
  "viviane","yara","alessandra","alice","alicia","alana","alexandra","alessia","aliny","amelia","andrea",
  "andreia","angela","angelica","anita","aparecida","arlete","barbara","beatris","benedita","bianca","branca",
  "brenda","carina","carmen","carmem","carol","carolina","catarina","catia","cassandra","celia","celiana",
  "cibele","clara","clarissa","clarice","clea","cleide","cleonice","cleusa","conceicao","cora","cristiana",
  "cristiane","dagmar","daiana","daiane","dalila","dalva","damaris","daniela","daniele","danielly","dayana",
  "dayane","debora","deise","deisy","denilce","denilda","denise","desiree","diana","diane","dilma","dina",
  "dinorah","dirce","dolores","dora","dulce","edna","edwiges","elaine","elena","eliana","eliane","elis",
  "elisa","elisabete","elisangela","ellen","elma","eloa","eloisa","elvira","ema","emanuela","emilia","emilly",
  "ester","esther","eugenia","eunice","eva","evania","evelyn","fabiana","fabiola","fatima","filomena","flavia",
  "franciele","francielle","gabi","geisa","geni","georgia","gertrudes","giane","gilda","gilmara",
  "giovana","giovanna","gisela","gisele","giselle","gislaine","gloria","gracas","graziela","graziele",
  "grazielle","greice","greicy","guiomar","hadassa","heidi","helena","helga","heloisa","hilda","hortencia",
  "iara","ida","idelma","ieda","ilda","ines","ingrid","iolanda","iracema","iraci","irene","iris","isabel",
  "isabela","isabella","isadora","isaura","isis","iva","ivana","ivone","jacira","jacqueline","jade","jamile",
  "jamily","jandira","janete","janice","janine","jaqueline","jenifer","jennifer","jhenifer","joana","joaquina",
  "joelma","joice","jordana","josefa","josiane","josiele","jovita","julieta","juliene","juraci",
  "jurema","karen","karina","karine","karla","karol","karoline","katia","kelly","keren","kerolen","kerolly",
  "keylla","kiara","kimberly","laila","laisa","lais","lana","lara","laudelina","laura","lauriane",
  "lavinia","layla","layra","lea","leandra","leda","lena","leni","lenir","leoneide","leonidia","lia","liana",
  "libia","lidia","lila","liliam","lilian","lilly","linda","lis","lisa","lisangela","livia","liz",
  "lizandra","lorena","loreta","lourdes","lucelia","lucia","luciene","ludmila","luisa","luiza","lurdes","luzia",
  "mafalda","magali","magda","manoela","manuela","mara","marcela","marcele","marciane","margarete","margarida",
  "margot","mariah","mariane","marielle","marilda","marilene","marilia","marilu","marina","marisa","marisol",
  "marlene","marli","marta","martha","mary","matilde","maura","maxima","mayara","meire","meiry","melania",
  "melissa","mercedes","merces","michele","michelle","midori","milena","mila","minerva","miranda","miriam",
  "mirella","mirian","mirna","monalisa","myrian","nadia","nadir","nair","naiara","nara","natacha","natalia",
  "natanya","nathalia","nathaly","neide","nelci","neuza","nice","nicolly","nilda","nilza","ninive","nivea",
  "noeli","noemia","nubia","odete","ofelia","olivia","onelia","oscarina","otavia","palmira","pamela","paula",
  "paulina","penha","pia","pietra","poliana","polyana","quezia","raissa","rafaela","raika","rebeca","regiane",
  "regina","reginalda","ridiane","rivanea","romilda","rosa","rosalia","rosane","rosangela","roseane","roseli",
  "rosemary","rosilda","roxana","rute","ruth","sabina","safira","salete","samanta","samantha","samara","sara",
  "sarah","selene","selma","serena","silmara","silvana","simara","sirley","solange","stefani","stefany",
  "stella","sueli","susana","suzana","suzane","suzi","sylvia","tabata","tabita","tainara","tais","talita",
  "tamara","tassia","tayna","telma","teresa","teresinha","terezinha","thais","thaisa","thalia","thaliane",
  "thamires","thamiris","thayane","thayla","thereza","tiana","valentina","valda","valdete","valeska","vanda",
  "vania","vanusa","veronica","violeta","virginia","vitoria","viviana","walda","walesca","walkiria","wanda",
  "wania","wilma","yasmin","yolanda","yvone","zaida","zelia","zenaide","zilda","zilma","zuleica","zulmira",
  "tamires","tamirys","andrelize","annekelly","elivane","emanuelle","emanuelly","emmanuelle","gloreci",
  "juliane","karolyne","liliane","lucineide","melanye","natalie","nataly","natalee","agatha","aisling",
  "andressa","andresa","andriela","andrielle","anelise","anelize","angelina","angelita","annelise","annelize",
  "annelizi","annely","annelya","annette","edilane","edilany","edileia","edilena","edilene",
  "edileuza","edilia","ediliane","edilice","edilma","edilmara","elivani","elizamar","elizana",
  "elizandra","elizangela","emanuele","emeline","emelly","emely","emilce","emile","emiliana",
  "emiliane","glorecia","glorecy","gloredna","gloreny","gloriana","glorice","gloricia","gloriciane",
  "gloriene","glorieny","glorilane","juliani","juliany","julieni","julieny","juliete",
  "karolaine","karolane","karolani","karolany","karole","karoleine","karolene","karoleni","karoleny",
  "karolinne","karolise","karolize","karolynne","liliani","liliany","liliene","lilieni",
  "lilieny","lucineia","lucinele","lucinelza","lucinete","lucineuza","lucineusa",
  "melany","melayne","melina","melinda","meline","melisa"
]);

function normalize(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function heuristicGender(first: string): "M" | "F" | "N" {
  const n = first;

  if (/ane$|any$|ani$/.test(n)) return "F";
  if (/iele$|ieli$|iely$/.test(n)) return "F";
  if (/iene$|ieni$|ieny$/.test(n)) return "F";
  if (/iane$|iani$|iany$/.test(n)) return "F";
  if (/eine$|eini$|einy$/.test(n)) return "F";
  if (/eide$/.test(n)) return "F";
  if (/eusa$|euza$/.test(n)) return "F";
  if (/ezia$/.test(n)) return "F";
  if (/elly$/.test(n)) return "F";
  if (/ely$/.test(n)) return "F";
  if (/elle$/.test(n)) return "F";
  if (/ires$|irys$/.test(n)) return "F";
  if (/eci$|ecy$/.test(n)) return "F";
  if (/elde$|elda$/.test(n)) return "F";
  if (/eline$|elina$/.test(n)) return "F";
  if (/elize$|elise$/.test(n)) return "F";
  if (/ice$/.test(n)) return "F";
  if (/ilde$|ilda$/.test(n)) return "F";
  if (/ilma$|ilza$/.test(n)) return "F";
  if (/ina$/.test(n)) return "F";
  if (/ine$/.test(n)) return "F";
  if (/inha$/.test(n)) return "F";
  if (/ise$/.test(n)) return "F";
  if (/ize$/.test(n)) return "F";
  if (/mara$/.test(n)) return "F";
  if (/neia$|nela$/.test(n)) return "F";
  if (/nete$/.test(n)) return "F";
  if (/nya$|nia$/.test(n)) return "F";
  if (/ssa$/.test(n)) return "F";
  if (/ude$/.test(n)) return "F";
  if (/une$/.test(n)) return "F";
  if (/ura$/.test(n)) return "F";
  if (/yane$|yani$|yany$/.test(n)) return "F";
  if (/yne$/.test(n)) return "F";
  if (/yde$/.test(n)) return "F";

  if (/ael$|iel$/.test(n)) return "M";
  if (/aldo$/.test(n)) return "M";
  if (/ando$/.test(n)) return "M";
  if (/ano$/.test(n)) return "M";
  if (/ao$/.test(n)) return "M";
  if (/ardo$/.test(n)) return "M";
  if (/ario$/.test(n)) return "M";
  if (/arson$|erson$|irson$|orson$/.test(n)) return "M";
  if (/as$/.test(n)) return "M";
  if (/eiro$/.test(n)) return "M";
  if (/el$/.test(n)) return "M";
  if (/emo$/.test(n)) return "M";
  if (/eo$/.test(n)) return "M";
  if (/erto$/.test(n)) return "M";
  if (/il$/.test(n)) return "M";
  if (/im$/.test(n)) return "M";
  if (/in$/.test(n)) return "M";
  if (/ion$/.test(n)) return "M";
  if (/iro$/.test(n)) return "M";
  if (/isson$|ison$/.test(n)) return "M";
  if (/ito$/.test(n)) return "M";
  if (/kon$|con$/.test(n)) return "M";
  if (/ldo$/.test(n)) return "M";
  if (/lmo$/.test(n)) return "M";
  if (/lon$|lan$/.test(n)) return "M";
  if (/lton$|lson$/.test(n)) return "M";
  if (/mes$|mas$/.test(n)) return "M";
  if (/nal$/.test(n)) return "M";
  if (/naldo$/.test(n)) return "M";
  if (/ndo$/.test(n)) return "M";
  if (/nel$/.test(n)) return "M";
  if (/ney$/.test(n)) return "M";
  if (/nho$/.test(n)) return "M";
  if (/nio$/.test(n)) return "M";
  if (/nir$/.test(n)) return "M";
  if (/nton$/.test(n)) return "M";
  if (/oel$/.test(n)) return "M";
  if (/on$/.test(n)) return "M";
  if (/or$/.test(n)) return "M";
  if (/os$/.test(n)) return "M";
  if (/rdo$/.test(n)) return "M";
  if (/rson$|rton$/.test(n)) return "M";
  if (/son$/.test(n)) return "M";
  if (/ston$/.test(n)) return "M";
  if (/ton$/.test(n)) return "M";
  if (/tor$/.test(n)) return "M";
  if (/us$/.test(n)) return "M";
  if (/val$/.test(n)) return "M";
  if (/valdo$/.test(n)) return "M";
  if (/van$/.test(n)) return "M";
  if (/vin$/.test(n)) return "M";
  if (/vis$/.test(n)) return "M";
  if (/visson$|vison$/.test(n)) return "M";
  if (/wald$|waldo$/.test(n)) return "M";
  if (/wan$/.test(n)) return "M";
  if (/win$/.test(n)) return "M";
  if (/ys$/.test(n)) return "M";

  if (/a$/.test(n)) return "F";
  if (/o$/.test(n)) return "M";

  return "N";
}

export function detectGender(fullName: string | null | undefined): "M" | "F" | "N" {
  if (!fullName) return "N";
  const normalized = normalize(fullName);
  if (/^\d/.test(normalized.trim())) return "N";
  const first = normalized.split(/\s+/)[0];
  if (!first || first.length < 2) return "N";
  if (FEMALE.has(first)) return "F";
  if (MALE.has(first)) return "M";
  return heuristicGender(first);
}

export function detectGenderBatch(names: string[]): Array<"M" | "F" | "N"> {
  return names.map(detectGender);
}
