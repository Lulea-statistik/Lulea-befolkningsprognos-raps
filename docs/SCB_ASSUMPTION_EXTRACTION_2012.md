# SCB:s historiska prognosantaganden 2012 – extraktion

Källa: SCB, *Sveriges framtida befolkning 2012–2060*, Demografiska rapporter 2012:2 (original-PDF, 268 sidor; maj 2012). Denna fil är den årgång som fanns tillgänglig vid 2012 års prognos; inga senare utfallsdata används.

## Extraherade originaltabeller, 2026-10-21

| Mått | Originaltabell | Tryckt sida | Dimensioner | Värden |
|---|---|---:|---|---:|
| Födda per 1 000 kvinnor | T.2 | 213 | Ålder 14–50 × åren 2012, 2013, 2014, 2015, 2020, 2030, 2040, 2050, 2060 | 333 |
| Grunddödstal per 1 000 | T.3 | 214 | Ålder 0–106 × kön | 214 |
| Årlig reduktion av dödstal, % | T.4a/T.4b | 215–216 | Ålder 0–106 × kön × sex periodkolumner | 1 284 |
| **Totalt** | | | | **1 831** |

Årlig reduktion, sex periodkolumner: **2013–2040, 2041, 2042, 2043, 2044, 2045–2060**. Reducera dödstalen från föregående år; **2012 års basvärde lämnas orört** (tabellfotnot 40). SCB:s originala åldersgrupper exempelvis 0–44 och 100–106 expanderas tekniskt med oförändrat publicerat gruppvärde och sparad `source_age_label`. Ingen 2009–2011-periodmall får appliceras.

### Måttdefinitioner och nollåringar
Fotnot 39 till T.3: dödstal är antal döda dividerat med medelfolkmängden under året, och dödsrisker behandlas separat i *Fakta om statistiken*. Ålder 0: **3,76 promille flickor; 4,17 promille pojkar**. Detta är *publicerade dödstal*, inte automatiskt dödssannolikheter. Högre nollårsvärden efter 2008 återkommer även 2012, vilket talar emot ett isolerat 2008-tabellfel men bevisar ingen särskild ändringsorsak.

SCB:s 2012 års metod beskriver vidare paritetsuppdelade kohortincidenstal för svenskfödda kvinnor (första, andra, tredje, fjärde eller senare barn), medan T.2 enbart visar sammanlagda åldersspecifika födelsetal. **Paritet saknas i T.2; tomt värde är `not_published`, inte noll.** Detta framgår i metodavsnittet kring tryckt s. 42.

## QA och avgränsning
CSV-paket: konversationens `scb_assumptions_2012.zip` med `fertility_age_year_2012.csv`, `mortality_base_2012.csv`, `mortality_reduction_2012.csv` och `README_QA.md`. Strukturella kontroller: kompletta nycklar, unika åldrar/år/kön/perioder, rätt antal värden. Status **`structured_pdf_text_extracted`**, ännu inte självständig cell-för-cell-layoutkontroll och visuell QA. Ingen årsvis rekonstruktion eller produktionsmodell har ändrats.
