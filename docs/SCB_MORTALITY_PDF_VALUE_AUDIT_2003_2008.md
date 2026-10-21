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
