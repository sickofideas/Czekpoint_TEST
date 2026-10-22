// Ověření zdroje není terénní ověření. Neznámé údaje zůstávají null/unknown.
const checkedAt = '2026-10-22';
const mapSearch = (name) => `https://mapy.com/turisticka?q=${encodeURIComponent(name)}`;

export const routes = [
  {
    id: 'u-drtice-bila-skala',
    title: 'U Drtiče – Bílá skála',
    subtitle: 'Lesní naučná stezka s výhledy',
    region: 'Rožmitál pod Třemšínem',
    kind: 'forest',
    durationMinutes: null,
    distanceKm: 2.5,
    elevationM: null,
    access: {
      stroller: 'no',
      surface: 'Lesní cesty a pěšiny, na vyhlídkách kamenitý podklad.',
      difficulty: 'unknown',
    },
    location: null,
    startLabel: 'Konec areálu bývalých kasáren v Rožmitále pod Třemšínem',
    mapUrl: mapSearch('Naučná stezka U Drtiče – Bílá skála, Rožmitál pod Třemšínem'),
    summary: 'Pěší naučná stezka pod vrchem Štěrbina vede lesem k vyhlídkám. Infocentrum uvádí přibližně 2,5 km; přístup z náměstí do této délky není zahrnutý.',
    obstacles: [
      'Podle infocentra není trasa vhodná pro dětský kočárek.',
      'Část trasy prudčeji stoupá. U vyhlídky je strmý kamenitý svah.',
    ],
    highlights: ['Vyhlídka a altán na Drtiči', 'Bílá skála', 'Informační tabule o přírodě'],
    source: {
      label: 'Infocentrum Rožmitál pod Třemšínem',
      url: 'https://icentrum.tremsinsko.cz/informacni-centrum-1/turistika/naucna-stezka/',
      checkedAt,
    },
    fieldCheckedAt: null,
    illustration: 'forest',
    featured: true,
  },
  {
    id: 'zamek-rozmital',
    title: 'Zámek Rožmitál',
    subtitle: 'Kulturní zastávka ve městě',
    region: 'Rožmitál pod Třemšínem',
    kind: 'culture',
    durationMinutes: null,
    distanceKm: null,
    elevationM: null,
    access: {
      stroller: 'unknown',
      surface: 'Povrch a bezbariérovost přístupu zatím neověřeny.',
      difficulty: 'unknown',
    },
    location: null,
    startLabel: 'Ing. Lízla 1, Rožmitál pod Třemšínem',
    mapUrl: mapSearch('Zámek Rožmitál, Ing. Lízla 1, Rožmitál pod Třemšínem'),
    summary: 'Zastávka u rožmitálského zámku. Provozovatel uvádí sezonní sobotní návštěvy a možnost domluvy pro skupiny. Aktuální otevření ověřte na webu zámku.',
    obstacles: ['Vstup do areálu se řídí aktuálním provozem zámku. Tato karta nepotvrzuje dnešní otevření.'],
    highlights: ['Rožmitálský zámek', 'Sezonní prohlídky podle aktuální nabídky provozovatele'],
    source: {
      label: 'Rožmitálský zámek – provozovatel',
      url: 'https://rozmitalskyzamek.cz/kontakt/',
      checkedAt,
    },
    fieldCheckedAt: null,
    illustration: 'castle',
    featured: false,
  },
  {
    id: 'podzamecky-rybnik-okruh',
    title: 'Podzámecký rybník a městský okruh',
    subtitle: 'Rožmitál, voda a alej Johanky',
    region: 'Rožmitál pod Třemšínem',
    kind: 'water',
    durationMinutes: null,
    distanceKm: 3,
    elevationM: null,
    access: {
      stroller: 'yes',
      surface: 'Městské ulice, lávka, cesta u rybníka a alej; přesné povrchy neověřeny.',
      difficulty: 'easy',
    },
    // Oficiální zdroj uvádí souřadnice začátku městského okruhu, nikoli rybníka.
    location: { lat: 49.6022822, lng: 13.8641036 },
    startLabel: 'Náměstí u kostela sv. Jana Nepomuckého',
    mapUrl: mapSearch('Kostel svatého Jana Nepomuckého, Rožmitál pod Třemšínem'),
    summary: 'Oficiální městský okruh vede přes Rožmitálské Benátky k Podzámeckému rybníku, do Starého Rožmitálu a zpět alejí Johanky. Turistický portál uvádí 3 km a vhodnost pro kočárek; současný stav cesty není terénně ověřený.',
    obstacles: ['Trasa vede přes lávku a městské ulice. Aktuální průchodnost a stav povrchu nejsou ověřeny.'],
    highlights: ['Podzámecký rybník', 'Alej Johanky z Rožmitálu', 'Rožmitálské Benátky'],
    source: {
      label: 'Brdy a Podbrdsko – oficiální turistický portál',
      url: 'https://www.brdyapodbrdsko.cz/turisticke-trasy-rozmital-mestsky-okruh',
      checkedAt,
    },
    fieldCheckedAt: null,
    illustration: 'lake',
    featured: false,
  },
];

// Additional sourced destinations. A destination card is not a measured walking route.
const additions = [
  {id:'tremsin-okruh',title:'Za králem brdských lesů na Třemšín',subtitle:'Celodenní okruh z Rožmitálu',kind:'forest',distanceKm:19,difficulty:'hard',location:{lat:49.6030031,lng:13.8629039},startLabel:'Start v centru Rožmitálu podle turistického portálu',summary:'Oficiální 19km okruh vede z Rožmitálu na Třemšín a zpět kolem Kobylí hlavy. Značka v mapě označuje start, nikoli vrchol. Není to krátká večerní procházka.',highlights:['Třemšín','Lesní okruh','Třemšínská bouda'],slug:'za-kralem-brdskych-lesu',illustration:'forest'},
  {id:'podbrdske-muzeum',title:'Podbrdské muzeum',subtitle:'Místní příběhy a historické vozy',kind:'culture',summary:'Cíl městské procházky s regionálními expozicemi a sbírkou automobilů Aero. Návštěva interiéru závisí na aktuální otevírací době a vstupném.',highlights:['Historie Podbrdska','Automobily Aero'],slug:'podbrdske-muzeum',illustration:'castle'},
  {id:'cvokarske-muzeum',title:'Cvokařské muzeum',subtitle:'Za řemeslem do Starého Rožmitálu',kind:'culture',summary:'Malé soukromé muzeum věnované výrobě hřebíků a cvočků. Hodí se jako zastávka ve Starém Rožmitále; dnešní přístup si ověř u provozovatele.',highlights:['Cvokařské řemeslo','Starý Rožmitál'],slug:'cvokarske-muzeum',illustration:'castle'},
  {id:'kostel-stary-rozmital',title:'Kostel Povýšení sv. Kříže',subtitle:'Hudební historie Starého Rožmitálu',kind:'culture',pointKind:'place',location:{lat:49.6082050,lng:13.8507389},summary:'Kostel spojený s Jakubem Janem Rybou stojí vedle hřbitova ve Starém Rožmitále, kolem vede zelená turistická značka. Přiblížení na mapě neznamená vstup do kostela.',highlights:['Jakub Jan Ryba','Historie Starého Rožmitálu'],slug:'kostel-povyseni-sv-krize',illustration:'castle'},
  {id:'voltusska-vyhlidka',title:'Voltušská vyhlídka',subtitle:'Odbočka za pohledem do kraje',kind:'view',summary:'Vyhlídku zmiňuje oficiální popis třemšínského okruhu jako odbočku v závěru trasy. Samostatná délka přístupu ani souřadnice zde zatím nejsou ověřeny; cestu vyber podle mapy a místního značení.',highlights:['Vyhlídka','Lesy u Voltuše'],slug:'za-kralem-brdskych-lesu',illustration:'forest'},
];
routes.push(...additions.map(p=>({
  ...p,region:'Rožmitál pod Třemšínem',durationMinutes:null,distanceKm:p.distanceKm??null,elevationM:null,
  access:{stroller:'unknown',surface:'Povrch přístupu zatím terénně neověřen.',difficulty:p.difficulty||'unknown'},
  location:p.location??null,startLabel:p.startLabel||'Místo vyhledej v mapě; konkrétní přístup není terénně ověřen.',
  mapUrl:mapSearch(`${p.title}, Rožmitál pod Třemšínem`),obstacles:['Ověř aktuální přístup, místní značení a u interiérů otevírací dobu.'],
  source:{label:'Brdy a Podbrdsko – oficiální turistický portál',url:`https://www.brdyapodbrdsko.cz/${p.slug}`,checkedAt},fieldCheckedAt:null,featured:false,
})));
