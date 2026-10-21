# SCB historiska prognosantaganden: originalårgång 2014

**Källa:** *Sveriges framtida befolkning 2014–2060*, SCB BE 18 SM 1401. Publiceringsdatum **2014-04-15** (tryckt s. 1). Original-PDF uppladdad till konversationen: `be0401_2014i60_sm_be18sm1401-2014(2).pdf`.

## Extraherade tabeller

| Data | Originaltabell | Tryckt sida | Dimension | Antal värden |
|---|---|---:|---|---:|
| Åldersspecifika födelsetal per 1 000 kvinnor | 2 | 24 | 37 åldrar (14–50) × 9 prognosår (2014,2015,2016,2017,2020,2030,2040,2050,2060) | 333 |
| Grunddödstal per 1 000 | 3 | 25 | 107 åldrar (0–106) × 2 kön | 214 |
| Årliga reduktionsprocent | 4a–4b | 26–27 | 107 åldrar × 2 kön × 6 perioder | 1 284 |
| **Totalt** | | | | **1 831** |

Perioderna är **2015–2040, 2041, 2042, 2043, 2044, 2045–2060**. Ursprungliga åldersklasser är sparade i `source_age_label`, exempelvis 0–44 och 100–106, samtidigt som deras lika faktorer är tekniskt utvidgade till varje enskild ålder för modelleringssyfte. **Ingen imputation eller 2026-baserad justering.** Paritet saknas i originaltabell 2 och ska vara tom/ej redovisad, inte 0.

Nollåringarnas basdödstal i tabell 3 är **3,57 ‰ kvinnor och 4,14 ‰ män**, det vill säga fortsatt höga jämfört med 2007 års direkt publicerade tabellvärden. År 2014:s dödstal är inte direkt likställda med 2007:s dödsrisker. SCB beskriver på s. 5 att 2014 års fruktsamhet reviderades kortsiktigt och dödligheten justerades för första året; på s. 20 står att startåret 2014 justerats med de observerade dödstalen för 2013, medan framtida reduktionsprincip i stort bibehållits. Detta är samtida, källstyrkt provenance, inte efterhandsrekonstruktion.

### Dokumenterad avvikelse i SCB:s original
Fotnot 3 till **tabell 4b (män), tryckt s. 27**, anger `efter startåret 2013`, men tabellrubriken är `2015–2060`, tabell 3 redovisar **basåret 2014** och fotnot 2 till tabell 4a anger uttryckligen **efter startåret 2014**. Det är en intern motstridighet i 2014 års PDF som bevaras som en QA-flagga. Vi använder inte fotnoten isolerat för att flytta den publicerade åldersprofilens basår.

### QA och leverans
Filer: `scb_assumptions_2014.zip`, med `fertility_age_year_2014.csv`, `mortality_base_2014.csv`, `mortality_reduction_2014.csv`, `README_QA.md` från konversationen. Extraktion via PDF-textlager och `pdftotext -layout`. Strukturell QA: 333 + 214 + 1284 unika nycklar och fullständig täckning. **Status: strukturellt extraherat, inte oberoende cellvis PDF-granskat.** Ingen påverkan på produktionsprognos eller låsta originaltabeller.