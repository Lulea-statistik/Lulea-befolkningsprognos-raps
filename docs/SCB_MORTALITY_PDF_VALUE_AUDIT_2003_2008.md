# PDF-till-CSV-kontroll av SCB:s historiska dödlighet 2003–2008

Kontroll 2026-10-21. Original-PDF:er uppladdade av användaren; maskintext har lästs via PyMuPDF och jämförts numeriskt mot de tidigare extraherade CSV:erna med en separat kontrollparser. Alla årgångar i rubriken omfattas inte: 2006 ingår i nästa delkontroll.

| Årgång | Bas (kön × ålder) | Basavvikelser | Reduktion (kön × åldersrad × period) | Reduktionsavvikelser |
|---|---:|---:|---:|---:|
| 2003 | 214 | 0 | 372 | 0 |
| 2004 | 214 | 0 | 372 | 0 |
| 2005 | 214 | 0 | 372 | 0 |
| 2007 | 214 | 0 | 372 | 0 |
| 2008 | 214 | 0 | 372 | 0 |
| **Totalt** | **1070** | **0** | **1860** | **0** |

**Viktig upptäckt:** 2008 års bastabell 7 använder ordet **”dödstal”** medan dess reduktionstabell 8 säger **”dödsriskerna”** och engelska bastabellrubriken *Assumed risks of mortality*. **2008 nollårsvärden är 4,31 promille kvinnor och 4,78 promille män**, jämfört med 2007 års 2,20 respektive 2,44. Detta är inte en vanlig småskalig årsändring och indikerar att tabellernas mått/definition eller metod ändrats. Tills SCB:s samtida metod har granskats ingående får 2008:s tal inte tyst behandlas som direkt jämförbara dödsrisker med 2007, eller multipliceras som om de var detta.

**QA-nivå:** `source_pdf_text_compared`, inte oberoende visuell cellvalidering. Samtliga exporterade tal har en motsvarighet i PDF-textlagret och numeriskt lika värde. Data är historiska original, inte korrigerade med 2026 års information. 2003–2005 reduceringsrad `106` kontra grundtabell `106+` är en separat harmoniseringsfråga; i 2007–2008 anger båda tabellerna `106+`.

**Fortsättning:** kontrollera de fullständiga metoddefinitionerna för 2008, källgranska 2006, samt testa nollåringsvärden i modellerna före vidare produktionsanvändning. Ingen ändring i produktionsmodellen ingår i denna källrevision.


## Fortsatt granskning 2026-10-21: 2006 och 2008

### 2006: ytterligare källverifiering
Komplett original `be0401_2006i50_br_be51st0602.pdf`. Tabell 5.3 (PDF-sida 110, tryckt s. 108): **214/214** grunddödsriskvärden överensstämmer numeriskt med `mortality_base_2006_candidate.csv`, **0 avvikelser**. Tabell 5.4 (PDF-sidor 111–112, tryckt s. 109–110): **124** grupper (kön × ursprunglig åldersetikett) och tre tidsperioder = **372** faktorer direkt extraherade till `scb_mortality_reduction_2006_source.csv`. Grundvärden och reduktionsfaktorer är jämförda med PDF-texten, inte oberoende visuellt radgranskade. SCB anger uttryckligen kedjemultiplikation från basåret 2006 för prognosåret 2007; vid reduktion 2 % är multiplikatorn **0,98**. Övergångar interpoleras linjärt 2015–2019 och 2035–2039. Ingen modern statistik får korrigera ursprungsvärdena.

### 2008: klassificera inte måttet enbart utifrån rubrik
2008 tabell 7 (tryckt s. 34) heter på svenska \"Antagna dödstal\" men engelskan anger \"Assumed risks of mortality\". Samma rapport (tryckt s. 36) definierar dödsrisk som antal avlidna dividerat med folkmängden vid tidsperiodens början, justerat för migration. **2007 års rapport** (tryckt s. 32) har samma definition. Tolkning: 2008-tabellen ska inte automatiskt behandlas som ett ordinärt dödstal och omvandlas till dödsrisk enligt 2009 års formel utan fler belägg. Nollårsvärden 2007: **2,20/2,44** promille (kvinnor/män); 2008: **4,31/4,78** promille. Nästan fördubbling för just ålder 0 är ett tydligt QA-fall och ska **inte** tyst korrigeras, halveras eller jämnas ut. Förklara endast med en samtida källstyrkt metodregel, inte med en 2026-baserad efterhandsanpassning.

**Aktuell status:** 2006 grundvärden PDF-textjämförda, reduktion extraherad; 2008 måttdefinition delvis klargjord men nollårsskillnaden ej förklarad. Produktionsmodellen är orörd.


## Fortsatt undersökning: 2007 kontra 2008 nollåringar (2026-10-21)
Källor: original-PDF BE18SM0701 tabell 8 (tryckt s. 26) och BE18SM0801 tabell 7 (tryckt s. 34) samt tabell 8 (s. 35), metodtext dödlighet (s. 20) och definitioner (s. 36).

| Kön | Publicerad 2007, promille | Beräkning hypotetisk | Publicerad 2008, promille |
|---|---:|---|---:|
| Kvinnor | 2,20 | 2,20 × 2 × 0,98 = 4,312 | 4,31 |
| Män | 2,44 | 2,44 × 2 × 0,98 = 4,7824 | 4,78 |

Identiteten gäller efter tvådecimalig avrundning och den årliga reduktionsfaktorn −2,00 % är publicerad för ålder 0–45 år. **Hypotes, inte belagd metodregel:** exakt faktor 2 talar för en särskild exponerings- eller nollåringsomräkning, men genomgången av 2007/2008 års metod- och definitionsavsnitt gav inte någon explicit förklaring till faktor 2. Det går därför ännu inte att ange att SCB verkligen bytte definition; likheten ensam bevisar inte det. För 2008 anges 2008-bastal trots att reduktionsintervallet också börjar 2008; ingen extra reduktion får göras på det ursprungliga basvärdet.

**Produktion:** behåll originalvärdena 2,20/2,44 och 4,31/4,78 och flagga `infant_age0_definition_under_investigation`. Beräkningen med faktor 2 är ett diagnostiskt spår och **ska inte användas som konverteringsregel** i produktion utan originalbelägg. Säkerställ också att SCB:s förklarande text om dödsrisk och ålder 0 kan verifieras i samtida kompletterande rapport eller metodmetadata.


## Förtydligande efter direkt kontroll av 2008 års metodtext (2026-10-21)
**Väsentlig källuppgift, BE18 SM 0801, tryckt s. 9:** SCB skriver att "Modellen för mortalitet är i grunden oförändrad och förändringar i mortalitetsantaganden kommer enbart från uppdatering av befolkningsdata." På tryckt s. 20 skriver SCB att "Antagandet om trendutvecklingen har lämnats oförändrad jämfört med tidigare prognos." Rapporten belägger alltså **inte** en särskild omdefinition eller omräkning av ålder-0-risker 2008. Tvärtom talar texten emot ett dokumenterat modellbyte i mortalitetsdelen.

**Primärkällor:** tabell 7, tryckt s. 34, publicerade bastal 2008; tabell 8, tryckt s. 35, reduktionstakter; definitioner, tryckt s. 36. Bastabellens engelska benämning är "Assumed risks of mortality" trots den svenska benämningen "dödstal". Nollåringarnas bastal 4,31/4,78 promille står uttryckligen i tabell 7 och ska bevaras som de är.

**Korrigering av tidigare hypotes:** relationen `2007 års ålder-0-värde × 2 × 0,98 ≈ 2008 års ålder-0-värde` är **en aritmetisk observation**, inte belägg för ny skalning eller 2008-metodbyte. Den tidigare spekulationen om en möjlig ändrad ålder-0-definition får **inte** presenteras som sannolik förklaring eller användas som omräkningsregel. Fortsatt spår: undersök källornas ålder-0-definition och jämför fler åldersrader i samtidens rapporter; behåll båda originalårgångarna och förklara avvikelsen som ännu **orsak okänd**.
