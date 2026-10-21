# Historiska prognosårgångar – tidsmässig behörighet

## Syfte
Utöka rullande prognosstarter utan framtidsläckage. En modellkörning får endast klassas som **strikt vintage-korrekt** om både de lokala observationernas faktiska tillgänglighet och de nationella prognosantagandenas **publiceringsdatum** ligger före prognostidpunkten.

## Inventering 2026-10-21

| Märkt nationell SCB-framskrivning | SCB:s publiceringsdatum för efterfrågade nationella detaljtabeller | Slutsats för prognosstart 31 december samma märkår |
|---|---|---|
| 2018 | 2018-04-26 (kontroll av varje tabell krävs) | Befintligt test; källkontroll behövs |
| 2019 | 2019-04-12 (kontroll av varje tabell krävs) | Befintligt test; källkontroll behövs |
| 2020 | 2020-04-08 (kontroll av varje tabell krävs) | Befintligt test; källkontroll behövs |
| 2021 | 2021-04-13 | Befintligt test |
| 2022 | 2023-04-18 för nationell detalj och födda efter moderns ålder | **Inte tillåten** som 2022 års egen vintage vid start 2022-12-31 |
| 2023 | 2024-04-25 | **Inte tillåten** som 2023 års egen vintage vid start 2023-12-31 |
| 2024 | 2025-04-11 för nationella detaljtabeller | **Inte tillåten** som 2024 års egen vintage vid start 2024-12-31 |
| 2025 | Ej verifierat här | Blockerad tills publicering och specifik källuppsättning verifierats |

Källförteckning: SCB Befolkningsframskrivningar, äldre framskrivningar: https://www.scb.se/hitta-statistik/statistik-efter-amne/befolkning-och-levnadsforhallanden/befolkningens-sammansattning-och-utveckling/befolkningsframskrivningar

**Viktig avgränsning:** Publiceringsdatumen ovan avser de nationella detaljtabeller som krävs för den nuvarande modellens fruktsamhets- och dödlighetsprofiler. Regionala SCB-prognoser kan ha publicerats vid andra tidpunkter och är inte likvärdiga modellindata.

## Nästa tillåtna beräkningssteg

1. För 2022–2024: dokumentera och frys **senast faktiskt publicerade** tillgängliga nationella detaljvintage vid 31 december respektive år, även om vintage-etiketten blir föregående år. Observera att SCB:s 2022- och 2023-märkta nationella detaljserier publicerades senare än deras märkår.
2. Kontrollera tabell-id, variabler, geografi, kön, åldersdefinition, antal prognosår, publiceringsdatum och att 1-årsåldrarna räcker för befintlig kohortmotor.
3. Säkerställ att lokala SCB-observationer verkligen hade publicerats vid starttidpunkten. Kalenderår räcker inte som cutoff.
4. Återskapa prognosunderlag och kör `scripts/build_rolling_backtest.py` / `scripts/run_rolling_backtest.js` på frysta, spårbara underlag.
5. Redovisa årgång, faktisk tillgänglighetsdag, basår, horisont, resultat och eventuell CKM-jämförbarhetsflagga i frontenden.
6. För tioårig utvärdering: utred tidigare origin än 2018; tioårig framåthorisont kan inte valideras mot framtida utfall som ännu inte har inträffat.

## Kvalitetsregel
Inga utvärderingspoäng och ingen täckning får extrapoleras från befintliga rullande treårstest. Nya år läggs först in i UI när genererat underlag finns. Underlag som återskapats med sent publicerade variabler märks explicit **retrospektiv scenarioanalys**, inte strikt historisk prognos.
