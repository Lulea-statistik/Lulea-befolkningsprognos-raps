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
