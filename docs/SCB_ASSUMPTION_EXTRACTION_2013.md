# Extraherade originalantaganden: SCB:s prognosårgång 2013

Källa: SCB, BE 18 SM 1301, **Sveriges framtida befolkning 2013–2060**, originalrapport (PDF `be0401_2013i60_sm_be18sm1301.pdf`).

### Inläsning 2026-10-21
| Typ | Originaltabell och tryckt sida | Dimensioner | Värden |
|---|---|---|---:|
| Antal födda per 1 000 kvinnor | 2, s. 25 | 37 åldrar (14–50) × nio prognosår (2013,2014,2015,2016,2020,2030,2040,2050,2060) | 333 |
| Dödstal per 1 000, kvinnor och män | 3, s. 26 | 107 åldrar (0–106) × två kön | 214 |
| Årlig reduktion av dödstalen | 4a/4b, s. 27–28 | 107 åldrar × två kön × sex periodkolumner (2014–2040, 2041,2042,2043,2044,2045–2060) | 1 284 |
| **Totalt** | | | **1 831** |

2013-reduktionsprofilen har **en annan periodindelning än 2009–2011**. Dessa ska inte interpoleras enligt den äldre periodmallen. PDF:s fotnot anger att dödstalet efter basåret 2013 beräknas genom att reducera föregående års dödstal. Källvärdena skall bevaras orörda. I en teknisk export är sammanslagna åldersklasser (exempelvis 0–44 eller 100–106) expanderade till individuella åldrar, men exakt källetikett sparas i `source_age_label`.

### Kvalitetsstatus
Strukturell QA: kompletta nycklar, 214 grundvärden, 333 fertilitetsvärden, 1 284 reduktionsvärden, inget dubbelt kön/ålder/period-par. **Inte** ännu oberoende, visuell jämförelse av varje PDF-cell. Detta är en historisk originalårgång, inte en beräkning med 2026 års uppgifter. Ingen produktionsmodell har ändrats.

CSV-exporter och källnära läsrapport finns i konversationsarkivet `scb_assumptions_2013.zip`. Nästa steg: käll-QA och inläsning av 2012, 2014, 2015–2017. När externa PDF-filer inte går att ladda ner ska de inte markeras som extraherade.

### Spädbarn 2008 – öppet metodspår
Användarens observation om att 2008 kan ha varit en uppjustering för att bättre motsvara verklig dödlighet sparas som **hypotes**. År 2008 är inte ett isolerat högt publicerat värde, men det finns ännu inte samtida belägg för orsaken eller att 2007 värden var systematiskt för låga. Inget automatisk undantag eller efterhandskorrigering görs.


## Oberoende PDF-layoutjämförelse 2026-10-21
En andra parser (`pdftotext -layout`, separat från ursprunglig `PyMuPDF`) har läst tabell 2 (tryckt s. 25), tabell 3 (s. 26) och tabellerna 4a–4b (s. 27–28) i original-PDF 2013. Värdena matchades per källa/ålder/kön/år eller reduktionsperiod mot exporterade CSV-filer:

| Källa | Kontrollerade celler | Avvikelser |
|---|---:|---:|
| Fruktsamhet, tabell 2 | 333 | 0 |
| Grunddödstal, tabell 3 | 214 | 0 |
| Reduktioner, tabell 4a/4b | 1 284 | 0 |
| **Totalt** | **1 831** | **0** |

QA-status: `pdf_layout_text_compared`; inte `visual_cell_verified`. Utfallet finns som `QA_LAYOUT_COMPARISON.json` i uppdaterat konversationsarkiv `scb_assumptions_2013_verified.zip`.

**Inventering saknade årgångar:** SCB:s 2014 års rapport har verifierad original-URL `https://www.scb.se/contentassets/897026b9ec674e55845e1a8f23e9bc1e/be0401_2014i60_sm_be18sm1401.pdf` (publicerad 2014-04-15). Den gick inte att hämta till arbetsmiljön vid detta tillfälle; status `source_identified_not_ingested`. SCB:s samtida tekniska dokumentation `https://www.scb.se/contentassets/77d1f12a07214b528b2141df9bb818cf/be0401_do_2014-2060.pdf` identifierad, men inte ersättning för bastabell i originalrapporten. 2012 rapport identifierad via SCB:s publikationsregister men ingen lokal fullständig PDF. Ingen påstådd extraktion för 2012 eller 2014.
