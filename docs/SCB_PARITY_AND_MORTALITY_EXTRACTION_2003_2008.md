# Paritet och åldersvisa dödsrisker – extraktion 2003, 2007, 2008

Datum: 2026-10-21.

## Datamodell
- `paritet`: valfri dimension, antal tidigare födda barn när det finns i originalrapportens uppdelning.
- **Tomt paritetvärde** betyder **inte redovisat**, absolut inte noll barn.
- `paritet_status`: `redovisad` eller `ej redovisad`.
- Undvik att slå samman paritetsspecifika faktorer och total åldersfruktsamhet utan att först känna till basfördelningen.

## Extraherade värden
- 2003: tabell 9.3, tryckt sida 122, 214 kön-ålder-dödsriskvärden. Tabell 9.4, tryckt sida 123–124, 372 reduktionsvärden per kön, åldersklass och period.
- 2007: tabell 8, tryckt sida 26, 214 kön-ålder-dödsriskvärden. Tabell 9, tryckt sida 27, 372 reduktionsvärden.
- 2008: 18 paritets- och åldersgruppsspecifika fertilitetsförändringsfaktorer relativt 2007, enligt 2008 års rapport. Dessa är inte en direkt fullständig fertilitetsprofil.
- 2003 och 2007 fertilitetsprofiler saknar paritetsuppdelning i motsvarande extraktion.

## QA
Samtliga 214 respektive 372 rader per årgång är unika i (kön, ålder, period) och saknar tomma numeriska fält. Detta är en **strukturell kontroll**, inte en fullständig visuell tabellvalidering. Dödsriskvärden anges per 1 000, årliga reduktionstal i procent med tecken. Tryckta källperioder skiljer sig och mellanliggande övergångsår måste beräknas efter SCB:s text; etiketten tidig/mellan/sen är inte tillräcklig för en färdig år-för-år-modell.

Filer finns i konversationens ZIP-export `scb_2003_2007_2008_extraction_updated.zip`; de är ännu **inte införda som modellerade historiska antaganden** i produktionsrepon. Godkänn först radvis/visuellt QA av källtabeller och periodinterpolering.


## Låst princip för historiska prognoser (beslut 2026-10-21)
- Originalversion: spara SCB:s ursprungliga antagandeårgång, publiceringsdatum, tabell, källa, enhet, ålder, kön och värde utan efterhandsjustering med statistik eller modeller från 2026.
- Separat teknisk representation: om motorn kräver annan åldersindelning redovisas transformeringen separat med metod, ingående ursprungsvärden, antagandeårgång och QA-status. Originalfilen förblir oförändrad.
- Ålder 106 och 106+: behåll dem som skilda beteckningar tills SCB:s ursprungliga metodbeskrivning verifierar relationen. Ingen automatisk likställning av en öppen åldersklass och en exakt ålder. Dokumentera eventuell harmonisering som modellberäkning, inte som publicerat SCB-värde.
- 2008: basrisk avser prognosåret 2008; reduktionsperiodens etikett 2008 accepteras som ursprunglig tabelluppgift. Om basrisk och reduktion båda är märkta 2008 måste ordningsföljden preciseras mot 2008 års metodtext. Tillämpa inte reduktionen dubbelt på basrisken.
- Historiespärr: inga utfall eller antaganden som först blev tillgängliga efter historiskt prognosdatum får användas i en körning som betecknas vintage-korrekt.
- Källstatus: skilj SCB original, samtida dokumenterad rekonstruktion, vår tekniska omkodning, approximation och ej verifierat.


## Källkontroll 2026-10-21: originaltabellerna, inte 2026 års standard
En ny genomgång av original-PDF:erna korrigerar tidigare generalisering om `106` kontra `106+`:
- **2003, 2004, 2005:** basrisk `106+`, reduktionstabell `106`. Bevara källbeteckningarna; modellen får inte använda en tyst sammanslagning.
- **2007, 2008:** både bas- och reduktionstabell anger **`106+`**. Dessa årgångar har ingen motsägelse om den etiketten.
- **2006:** basrisk 2006, årlig reduktion **2007–2050** (tabell 5.3–5.4, tryckta s. 108–110).
- **2008:** basrisk **2008** (tabell 7 s. 34), reduktionstabell **2008–2050** (tabell 8 s. 35). Eftersom 2008 års bastal redan uttryckligen är givet ska bastalet 2008 aldrig ersättas av ytterligare tillämpning av första periodens reduktion. Tabellen säger också ordagrant att reduktionstalen interpoleras linjärt **2015–2019** och **2035–2039**. För 2009 och senare måste årlig tillämpning rekonstrueras separat; publicerade 2008-basvärden är låsta.
- **2009:** tabell T.3 bas *dödstal* 2009 (tryckt s. 170), tabell T.4 positivt uttryckt *reduktion av dödstal* 2010–2060 (s. 171). **Obs teckenkonvention:** 2008-talen visas som negativa procentuella förändringar medan 2009-tabellen anger positiva reduktionsstorlekar. Dessa får inte få samma algebraiska teckentolkning.
- **2010:** tabell 3 basdödstal 2010, tabell 4 reduktion 2011–2060 (s. 24–25).
- **2011:** tabell 3 basdödstal 2011, tabell 4 reduktion 2012–2060 (s. 24–25).

### Konsekvens för implementation
Inför fälten `measure_type` (dodsrisk/dodstal), `reduction_sign_convention` (negativ_forandring/positiv_reduktionsstorlek), `base_year`, `first_reduction_label_year`, `age_group_source` och `age_group_model`. Bevara båda åldersetiketterna och validera matchning per årgång. Om `base_year == first_reduction_label_year` som 2008: lås basåret och flagga en tolkning av *första applicerade övergång* för metodkontroll. Aldrig tyst normalisering eller dubbelt tillämpad reduktion.
