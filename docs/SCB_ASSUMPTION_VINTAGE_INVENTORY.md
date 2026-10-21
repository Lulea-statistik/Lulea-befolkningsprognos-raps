# Inventering nationella antaganden 2006–2026 (2026-10-21)

**Resultat:** 12 identifierade årgångar med SCB-tabeller för både åldersspecifik fruktsamhet och dödlighet: **2009, 2012, 2015, 2018–2026**. Detta är inte verifiering av en komplett årlig serie från 2006. 2006 har publicerade framskrivningar, men motsvarande par åldersspecifika antagandetabeller har inte säkerställts. Mellanåren 2007–2008, 2010–2011, 2013–2014 och 2016–2017 är inte här verifierade som separata årgångar.

Maskinläsbar katalog: `data/backtests/scb_assumption_vintage_inventory.csv`.

## Klassificering
- **existing_model:** används redan i projektets rullande prognoser; kräver fortfarande kontroll av prognosdatum och historiska lokala publiceringstidpunkter.
- **metadata_check:** SCB har relevanta tabeller, men API-metadata, ålderskonvertering, prognosbanans fullständighet och användbarhet i befintlig motor återstår.
- **needs_temporal_audit:** etikettåret och faktiskt tillgänglighetsdatum skiljer sig. Kontrollera *båda* ingående tabellernas ursprungliga publicering och eventuella senare rättelser före användning.
- **investigate:** inte konstaterat att erforderliga åldersspecifika antaganden finns.

## Publicering och användning i backtester
SCB:s `Antaganden för äldre framskrivningar` listar 2009, 2012, 2015 och 2018–2025 med dödstal efter kön/ålder och fruktsamhet efter moderns ålder. Aktuella antaganden 2026 finns under separat rubrik. Notera att *tabellens senaste uppdatering* inte alltid motsvarar ursprunglig publicering: 2022 dödstal visar 2024-04-18 medan fertilitet visar 2023-04-18, och 2015 detaljer har rättats 2016-03-23. En årgång får inte låsas som tillgänglig från dess modellår.

För dropdownen **Antagande** måste båda ingående komponenterna komma från vald vintage och vara tillgängliga före origin-cutoff. Om samma-års-antagande ännu inte publicerats ska det märkas **Ej tillgängligt vid prognosstart**. Alternativet **senaste andra tillgängliga årgång** får aldrig ersättas av en yngre vintage som publicerats senare. Eftersom de två valen kan vara identiska om man inte explicit exkluderar samma årgång ska den senare definieras som senaste *föregående* vintage, om tillgänglig.

## Källor
- SCB katalog, historiska antaganden: https://www.statistikdatabasen.scb.se/pxweb/sv/ssd/START__BE__BE0401__BE0401F/
- SCB katalog, äldre framskrivningar: https://www.statistikdatabasen.scb.se/pxweb/sv/ssd/START__BE__BE0401__BE0401B/
- SCB befolkningsframskrivningar: https://www.scb.se/hitta-statistik/statistik-efter-amne/befolkning-och-levnadsforhallanden/befolkningens-sammansattning-och-utveckling/befolkningsframskrivningar

## Nästa implementation
1. Hämta API-metadata och exakta tabell-id för respektive dödstal/fruktsamhet.
2. Testa transformationskompatibilitet per ålders- och födelseregionsindelning.
3. Arkivera båda tabellernas förstapublicering och revisioner; rätta release-gate där gammal årgång antagits tillgänglig innan båda komponenterna publicerats.
4. Kör separata backtester för samma respektive närmast föregående tillgängliga vintage utan framtidsläckage.
