# Spädbarnsdödlighet: originalantaganden i prognosårgångar 2003–2013

Granskning 2026-10-21. Syfte: avgöra om ålder 0 i 2008 års rapport är en isolerad avvikelse innan eventuell modellmässig undantagshantering. Inga originalvärden ändras.

| SCB-årgång | Flickor, promille | Pojkar, promille | Rapportens mått |
|---|---:|---:|---|
| 2003 | 2,35 | 3,12 | dödsrisk |
| 2004 | 2,30 | 3,05 | dödsrisk |
| 2005 | 2,26 | 2,99 | dödsrisk |
| 2006 | 2,21 | 2,93 | dödsrisk |
| 2007 | 2,20 | 2,44 | dödsrisk |
| 2008 | 4,31 | 4,78 | svensk tabellrubrik dödstal; engelsk dödsrisk |
| 2009 | 4,39 | 4,39 | dödstal |
| 2010 | 4,26 | 4,30 | dödstal |
| 2011 | 4,18 | 4,22 | dödstal |
| 2013 | 3,60 | 4,24 | dödstal |

**Källor:** SCB-årgångarnas ursprungliga bastabeller, se tidigare separata PDF-revisioner. 2013 kontrollerat i BE18 SM 1301, tabell 3, tryckt sida 26, `Dödstal för år 2013 efter kön och ålder vid årets slut. Promille` (rad 0). 2012 ej tillgänglig i denna filsamling och ingår inte i tabellen.

**Observation:** nivån 4–5 promille för år 2008 återkommer 2009–2011, och 2013 är fortsatt över 2007 för båda könen. 2008 är därför inte ett uppenbart fristående utliggarår. Samtidigt är etiketten *dödsrisk* för 2003–2007 inte automatiskt numeriskt jämförbar med *dödstal* för 2009–2013. Slutsatsen gäller de publicerade **tabellvärdena**, inte en homogen dödssannolikhetsserie.

## QA-beslut och produktionsspärr
- **Ingen ersättning av 2008 års nollårsvärden nu.** Eventuellt undantag beslutas först efter en jämförbar genomgång av senare prognosårgångar och samtida definitioner.
- Spara `original_age_0_value` orört; härled vid behov `model_age_0_value` separat med kodad transformation, källa och QA-flagga.
- 2008: `measurement_definition_review_pending`, inte `invalid_original`.
- Separera dödstal och dödsrisker; använd inte samma faktor 2 för alla årgångar eller kön utifrån den matematiska likheten 2007–2008.
- Komplettera 2012 och 2014–2017 innan något beslut om 2008-undantag, kontrollera formel för spädbarns exponering mot rapporternas metodavsnitt samt validera mot publicerade förväntad-livslängd-summeringar.

Källa för export av samtliga 20 värden i denna granskning finns som konversationsfil `scb_infant_mortality_vintages_2003_2013.csv`. Produktionsprognoser är oförändrade.
