# Luleå rAps-liknande befolkningsmodell

HTML-baserad demografisk prognosmodell för Luleå FA och kommunerna Luleå, Boden, Piteå, Älvsbyn och Kalix.

## Dashboard

Gränssnittet är uppdelat i åtta rapportsidor:

1. **Resultat** – KPI:er, befolkningskurva, demografiska komponenter, årsresultat och SCB-benchmark.
2. **Befolkningsanalys** – kalibreringskänslighet 6/10/19 år, kommun/Riket-faktorer, åldersstruktur och demografisk balans.
3. **Åldersanalys 1-år** – fruktsamhets- och dödlighetsfading för varje enskild ålder, inklusive kvinnor/män för dödlighet.
4. **Flyttanalys** – inflyttning, utflyttning, netto, historisk variation och praktisk 5 %-känslighet i 1-årsåldrar.
5. **Arbetsmarknad & pendling** – jobbutveckling, bostads-/arbetsställekommun, pendlingsmatris och scenariofördelning av nya jobb.
6. **Scenario & justering** – generella demografiska multiplikatorer, bostadsbyggande och arbetsplatsetableringar.
7. **Validering** – historisk 2022–2024-backtest, fel per 1-årsålder och jämförelse mot SCB:s regionala framskrivning.
8. **Metod & data** – källor, CKM-status, Raps-anpassning och fading-policy.

Linjediagrammen har hover-värden för närmaste år eller ålder. Flyttanalysens historiska standardavvikelse är en variationsindikator, inte ett statistiskt konfidensintervall.

Geografi, kalibreringsfönster och slutår är globala filter och gäller på alla sidor. För FA-regionen visas inte bruttoinflyttning/utflyttning genom summering av kommuner, eftersom interna FA-flyttar då skulle dubbelräknas; FA-nettot kan däremot summeras korrekt.

## Struktur

- `index.html` – dashboardgränssnitt.
- `css/style.css` – layout och rapportsidor.
- `js/model.js` – kohortmodell, CKM-diagnostik och scenarioeffekter.
- `js/app.js` – navigering, filter, diagram, scenariotabeller och valideringsvyer.
- `data/model_data.json/js` – genererade modellindata för browser och analys.
- `data/model_validation.json/js` – 6/10/19-årig valideringssammanställning.
- `data/backtests/` – 2022–2024 out-of-sample-backtest.
- `data/benchmarks/` – SCB- och Tillväxtverket/Raps-benchmarks.
- `data/raw/` – reproducerbara SCB-uttag.
- `docs/RAPS_ALIGNMENT.md` – Raps-prioritet, fallback-fading och anti-overfitting-regel.
- `docs/VALIDATION.md` – benchmark- och backteststrategi.
- `docs/ANALYSIS_DESIGN.md` – rekommenderade illustrationer, utvärdering och arbetsmarknads-/pendlingsanalys.
- `scripts/scb_extract.py` – rådatahämtning från SCB PxWebApi v2.
- `scripts/build_model_data.py` – bygger kalibrerad modell.
- `scripts/build_backtest_2022.py` – bygger historiskt holdout-test.
- `tests/test_model.js` – tester av kärnformler och scenariobalans.

## Modellprinciper

- Basår 2025, prognos normalt till 2050.
- Fruktsamhet och dödlighet följer SCB 2024:s nationella framtidstrender och lokaliseras mot kommun/FA.
- Lokal nivå skattas som observerat/förväntat mot rikets åldersprofil.
- Där officiella Raps-parametrar saknas används en outcome-oberoende fading per ålderscell.
- Fading använder två outcome-oberoende informationssignaler: genomsnittlig årlig cellpopulation och förväntat antal händelser. Populationssignalen går från 0 % vid <=20 till 100 % vid >=100; händelsesignalen går från 0 % vid <=1 förväntad händelse till 100 % vid >=20. Den slutliga lokala vikten är produkten av de två.
- Fadinggränserna är fastställda före benchmarkutvärderingen och får inte trimmas mot känt utfall.
- `urisk`: V1 använder exogen historisk nettoflyttning; endogena IMIG/UMIG-koefficienter kommer senare.
- `qutb`: identitetsmatris tills övergångstal läggs in.
- Kalibreringsfönster 6, 10 (standard) och 19 år.
- CKM-metodbrottet 2025 flaggas separat.

## Bostads- och arbetsplatsscenarier

Bostadsrader kan ange:

- kommun och år,
- småhus eller flerbostadshus,
- äganderätt, hyresrätt eller bostadsrätt,
- storleksklass,
- antal bostäder,
- färdigställandegrad,
- beläggning,
- personer per bostad,
- andel som ger nya invånare till FA,
- intern flyttning och infasningstid.

Bostadstyp/upplåtelseform/storlek är ännu metadata. Personer per bostad anges explicit tills empiriska hushållsstorlekar per bostadstyp kopplas in.

Arbetsplatsscenarier kan använda **observerad pendling** eller en manuell fördelning. Med observerad pendling fördelas nya jobb först efter SCB TAB1830:s aktuella bostadskommunmönster för vald arbetsställekommun. Jobb som tas av boende i annan FA-kommun ger i sig ingen befolkningstillväxt i FA; en separat intern flyttandel kan omfördela boende mellan kommunerna. Endast en separat vald andel av jobben som tas av personer bosatta utanför FA omvandlas till extern inflyttning, multiplicerad med personer per inflyttat jobb.

Jobbrelaterad extern inflyttning kan dessutom använda en **ålder/kön-profil**. Standard är `job_family`: observerad kommunal inflyttning efter ålder och kön, begränsad till 0–64 år och normaliserad till 100 %. Alternativ är all observerad inflyttning eller den äldre befolkningsproportionella fördelningen. Profilen är ett empiriskt scenarioantagande, inte en kausal skattning av vilka individer som flyttar för ett arbete.

Intern flyttning summerar till noll för hela FA-regionen. Ett justerbart överlappsavdrag minskar risken att samma hushåll dubbelräknas via både bostäder och jobb. Från sidan **Arbetsmarknad & pendling** kan ett valt jobbscenario skickas direkt till prognossidan med observerad pendling som standardfördelning.

## Validering utan resultatstyrning

Modellen ska inte konstrueras om för att passa ett känt historiskt utfall. Backtest och SCB-benchmark används för att identifiera svagheter, inte för efterhandskalibrering.

2022–2024-backtesten:

- använder lokal information endast till och med 2021,
- använder SCB:s 2021-prognosvintage för nationella framtidsprofiler,
- jämför befolkning, födda, döda och nettoflyttning,
- redovisar bland annat MAE och MAPE.

SCB TAB6008 används som en separat alternativ metodbenchmark och visas även omankrad till faktisk befolkning 2025.

## GitHub Actions

Workflow **Update SCB data** kan köras manuellt och månadsvis. Det:

1. upptäcker SCB-tabeller,
2. hämtar rådata,
3. bygger modellindata,
4. kör tester,
5. skapar valideringsrapport,
6. kör historisk backtest,
7. normaliserar SCB-benchmark,
8. jämför modellen mot SCB,
9. committar genererade data om något har förändrats.

## Nästa modellsteg

- koppla officiella Raps-kluster/parametrar där de går att få fram,
- förbättra IMIG/UMIG och `urisk`,
- använda TAB1830-pendlingsmatrisen som prior för var nya jobbinnehavare bor och därefter separat skatta faktisk flyttbenägenhet,
- vidareutveckla den jobbrelaterade ålder/kön-profilen med riktade flytt-/hushållsdata när sådana finns,
- koppla empiriska personer-per-bostad-antaganden per bostadstyp/upplåtelseform/storlek,
- lägga till delområden när stabila delområdesdata och geometrier finns.
