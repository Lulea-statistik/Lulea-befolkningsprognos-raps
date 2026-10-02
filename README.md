# Luleå rAps-liknande befolkningsmodell

HTML-baserad demografisk prognosmodell för Luleå FA och kommunerna Luleå, Boden, Piteå, Älvsbyn och Kalix.

## Dashboard

Gränssnittet är uppdelat i nio rapportsidor:

1. **Resultat** – KPI:er, befolkningskurva, demografiska komponenter, årsresultat och SCB-benchmark.
2. **Befolkningsanalys** – kalibreringskänslighet 6/10/19 år, kommun/Riket-faktorer, åldersstruktur och demografisk balans.
3. **Åldersanalys 1-år** – fruktsamhets- och dödlighetsfading för varje enskild ålder, inklusive kvinnor/män för dödlighet.
4. **Flyttanalys** – inflyttning, utflyttning, netto, historisk variation och praktisk 5 %-känslighet i 1-årsåldrar.
5. **Arbetsmarknad & pendling** – jobbutveckling, bostads-/arbetsställekommun, pendlingsmatris och scenariofördelning av nya jobb.
6. **Hushåll & bostad** – hushållsbildning, personer per hushåll, SCB-standardvärden per bostadstyp, bostadsbestånd och indikativ ny bostadsefterfrågan.
7. **Scenario & justering** – val mellan Raps/SCB 2024 och SCB 2026 fruktsamhetsbana, separat 2/4/6/10-årigt nettoflyttningsfönster, generella demografiska multiplikatorer, bostadsbyggande och arbetsplatsetableringar.
8. **Validering** – historisk 2022–2024-backtest, fel per 1-årsålder och jämförelse mot SCB:s regionala framskrivning.
9. **Metod & data** – källor, CKM-status, Raps-anpassning och fading-policy.

Linjediagrammen har hover-värden för närmaste år eller ålder. Flyttanalysens historiska standardavvikelse är en variationsindikator, inte ett statistiskt konfidensintervall.

Geografi, kalibreringsfönster och slutår är globala filter och gäller på alla sidor. För FA-regionen visas inte bruttoinflyttning/utflyttning genom summering av kommuner, eftersom interna FA-flyttar då skulle dubbelräknas; FA-nettot kan däremot summeras korrekt.

## Struktur

- `index.html` – dashboardgränssnitt.
- `css/style.css` – layout och rapportsidor.
- `js/model.js` – kohortmodell, CKM-diagnostik och scenarioeffekter.
- `js/app.js` – navigering, filter, diagram, scenariotabeller och valideringsvyer.
- `data/model_data.json/js` – genererade modellindata för browser och analys.
- `data/model_validation.json/js` – 6/10/19-årig valideringssammanställning.
- `data/backtests/` – 2022–2024 utvecklingsbacktest samt rolling-origin-validering med SCB-vintages 2018–2021.
- `data/reference_fa_regions.json` – låst FA15-konfiguration för externa referensregioner.
- `data/migration_component_windows.json` – låst utvecklingskandidat för komponentvisa migrationsfönster; #38 har genomfört första externa testet utan regional omtrimning.
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
- SCB 2026 kan väljas som en **fruktsamhets-only känslighetsbana**. Den behåller samma lokala Luleåprofil och ändrar inte dödlighet eller migration. SCB-benchmark är jämförelse, inte kalibreringsmål.
- Händelserisker använder medelfolkmängd som exponering med matchad åldersdefinition: TAB2818 för dödlighet/flyttning (ålder vid årets slut) och TAB2819 för fruktsamhet (moderns ålder vid födelsen). Folkmängd 31 december används fortfarande för bestånd och redovisade befolkningsnivåer.
- Kohorttimingen är event-age-aligned: 31-decemberbeståndet åldras först till prognosårets ålder, födda beräknas på prognosårets mödrar, nyfödda läggs till och dödlighet appliceras därefter på prognosårets ålder inklusive ålder 0. Legacy V1-timing finns endast kvar i valideringen.
- Lokal nivå skattas som observerat/förväntat mot rikets åldersprofil.
- Där officiella Raps-parametrar saknas används en outcome-oberoende fading per ålderscell.
- Fading använder två outcome-oberoende informationssignaler: genomsnittlig årlig cellpopulation och förväntat antal händelser. Populationssignalen går från 0 % vid <=20 till 100 % vid >=100; händelsesignalen går från 0 % vid <=1 förväntad händelse till 100 % vid >=20. Den slutliga lokala vikten är produkten av de två.
- Fadinggränserna är fastställda före benchmarkutvärderingen och får inte trimmas mot känt utfall.
- `urisk`: historisk kommunal utflyttningsrisk lagras per kön/ettårsålder och 2/4/6/10-årsfönster. Historisk bruttoinflyttning lagras parallellt. Basscenariot använder fortfarande exogen nettoflyttning tills IMIG/UMIG/`ifl` aktiveras.
- Nettoflyttningens 2/4/6/10-årsfönster kan varieras separat från fruktsamhet/dödlighet för en ren känslighetsanalys. Rolling-origin-testet jämför samma fönster på n+1 och n+2. 19 år har tagits bort som aktivt migrationsfönster eftersom #36 inte gav något prognosstöd för det; fruktsamhet och dödlighet behåller däremot 19 år som lång stabilitetskontroll. Observerat 2025-netto sparas som post-2024 diagnostik men används inte för efterhandskalibrering.
- `qutb`: identitetsmatris tills övergångstal läggs in.
- Kalibreringsfönster 6, 10 (standard) och 19 år.
- CKM-metodbrottet 2025 flaggas separat.
- Luleå FA prognostiseras additivt som summan av de fem kommunprognoserna. FA-specifika kalibrerade profiler används som diagnostik, inte som en separat prognosmotor.
- Kommunal migration delas diagnostiskt i tre geografiska ben från SCB TAB4693/TAB6657: **övriga Norrbotten**, **övriga Sverige** och **utlandet**, vardera med in-, ut- och nettoflöde per ettårsålder och kön. Dessa ben används ännu inte som separata produktionsmotorer; de används först för komponentvis 2/4/6/10-årsvalidering.

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

Bostadsscenariot har nu **SCB auto** eller **Manuell** för personer per bostad. Auto använder i första hand kommunens observerade värde 2024. Flerbostadshus hämtar boendeform + lägenhetstyp från SCB HushallT30/TAB4937; småhus hämtar boendeform från HushallT29/TAB4538. Om kommunvärde saknas används motsvarande riksvärde som fallback. Värdet är en observerad hushållsstorlek, inte en fysisk maxkapacitet för bostaden.

Arbetsplatsscenarier kan använda **observerad pendling** eller en manuell fördelning. Med observerad pendling fördelas nya jobb först efter SCB TAB1830:s aktuella bostadskommunmönster för vald arbetsställekommun. Jobb som tas av boende i annan FA-kommun ger i sig ingen befolkningstillväxt i FA; en separat intern flyttandel kan omfördela boende mellan kommunerna. Endast en separat vald andel av jobben som tas av personer bosatta utanför FA omvandlas till extern inflyttning, multiplicerad med personer per inflyttat jobb.

Jobbrelaterad extern inflyttning kan dessutom använda en **ålder/kön-profil**. Standard är nu `worker_household`: upp till en person per flyttande jobb behandlas som jobbinnehavare och följer SCB TAB3205:s arbetsmarknadsstruktur (15–24, 25–54, 55–74, kön), nedbruten till 1-årsåldrar med observerad lokal inflyttning. Personer utöver den första per jobb behandlas som medföljande hushåll och följer en separat proxy baserad på observerad inflyttning 0–17 och 25–64. Alternativen `job_family`, all observerad inflyttning och befolkningsproportionell fördelning finns kvar för känslighetsanalys. Profilerna är scenarioantaganden, inte kausala skattningar.

Intern flyttning summerar till noll för hela FA-regionen. Ett justerbart överlappsavdrag minskar risken att samma hushåll dubbelräknas via både bostäder och jobb. Från sidan **Arbetsmarknad & pendling** kan ett valt jobbscenario skickas direkt till prognossidan med observerad pendling som standardfördelning.

## Validering utan resultatstyrning

Modellen ska inte konstrueras om för att passa ett känt historiskt utfall. Backtest och SCB-benchmark används för att identifiera svagheter, inte för efterhandskalibrering.

2022–2024-backtesten:

- använder lokal information endast till och med 2021,
- använder SCB:s 2021-prognosvintage för nationella framtidsprofiler,
- jämför befolkning, födda, döda och nettoflyttning,
- redovisar bland annat MAE och MAPE.
Därutöver byggs en rolling-origin-validering med startår 2018, 2019, 2020 och 2021. Varje körning använder endast lokal information som fanns tillgänglig vid respektive origin och SCB:s nationella prognosvintage från samma år, med tre års prognoshorisont. Testfönstren överlappar och ska därför tolkas som robusthetskontroll snarare än helt oberoende experiment.
Huvudbedömningen görs på **n+1**, n+2 används sekundärt och n+3 endast som kompletterande robusthetsmått. Det minskar risken att metodbedömningen domineras av senare händelser som inte var observerbara vid prognosstarten.
Rolling-rapporten innehåller dessutom en nationell vintage-diagnostik som jämför SCB:s då publicerade prognos för födda och döda med senare faktiskt utfall för Riket. Därmed kan fel i den nationella framtidsprofilen skiljas från fel som uppstår när profilen lokaliseras till kommunerna.

Som extern robusthetskontroll körs samma rolling-origin-metod även på tre fördefinierade FA15-referensregioner: **FA16 Trollhättan-Vänersborg**, **FA36 Gävle** och **FA42 Sundsvall**. Regionerna används endast för validering och får inga regionspecifika parameterjusteringar. Trollhättan-Vänersborg behålls med FA15-medlemskap även om regionen inte längre finns separat i FA25.

Den fördefinierade n+1-valideringen stödde event-age-timingen: dödsfalls-MAE förbättrades i samtliga 23 medlemskommuner i Luleå och referensregionerna, medan population MAE förbättrades i 19 av 23 och på FA-totalnivå i alla fyra testade regioner. Därför är event-age-aligned timing produktionsstandard från schema 0.9.0.

**Update SCB data #38** testade dessutom den efter #37 låsta migrationskandidaten (Norrbotten 6/6, övriga Sverige 10/4, utlandet 10/2 år för in/ut) på samma externa referenskommuner utan regional omtrimning. Poolad net migration MAE förbättrades från 109.0 till **107.1** på n+1 och från 148.9 till **144.0** på n+2 jämfört med 10 år för all in- och utflyttning. Stödet är dock tydligare för **komponentstrukturen** än för samtliga exakta fönster: länsbenets 6/6 generaliserade starkt, medan 4 år för utflyttning till övriga Sverige var sämre än 10 år externt och 2 år för utvandring gav blandat n+1/n+2-resultat. Kandidaten är därför fortsatt utvecklingsdiagnostik och inte produktionsstandard. Referenskommunerna i #38 är efter detta test förbrukade som oberoende holdout för eventuell omtrimning.

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
- behåll #38-resultatet orört och testa den låsta komponentkandidaten på nya, fördeklarerade holdout-kommuner/regioner innan någon komponentmotor eller ändrade komponentfönster kan bli produktionsstandard,
- använda TAB1830-pendlingsmatrisen som prior för var nya jobbinnehavare bor och därefter separat skatta faktisk flyttbenägenhet,
- vidareutveckla den jobbrelaterade ålder/kön-profilen med riktade flytt-/hushållsdata när sådana finns,
- koppla empiriska personer-per-bostad-antaganden per bostadstyp/upplåtelseform/storlek,
- lägga till delområden när stabila delområdesdata och geometrier finns.


## Arbetsmarknadens åldersprofil

SCB TAB3205 används för ålder/kön bland sysselsatta efter arbetsställekommun. Dashboarden visar ett 2022–2024-genomsnitt i SCB:s tre ömsesidigt uteslutande breda åldersgrupper **15–24, 25–54 och 55–74**.

Jämförelsen visade att Luleås observerade inflyttning är mycket koncentrerad till unga vuxna: 38,4 % av 0–64-inflyttningen ligger i 18–24 år, medan cirka 11,2 % av de sysselsatta på arbetsställen i Luleå ligger i 15–24 år. Flyttanalysen följer därför 19–20 år som tydlig inflyttningsålder, 24–25 år som tydlig utflyttningsålder och 19–25 år som bred kontrollgrupp. Modellen klassificerar inte personer som studenter från ålder. Därför används arbetsmarknadsprofilen i standardscenariot för jobbinnehavaren, medan medföljande hushåll hanteras separat.


## Hushåll och bostadsefterfrågan

Hushållsdelen använder flera separata SCB-källor:

- **TAB4538 / HushallT29** – personer per hushåll efter region och boendeform; används bland annat för småhus.
- **TAB4937 / HushallT30** – hushåll och genomsnittligt antal personer per hushåll efter boendeform och lägenhetstyp; används för flerbostadshus och antal rum.
- **TAB1533 / HushallT05** – hushåll och personer efter hushållstyp och antal barn.
- **TAB4374 / HushallT09** – totalt antal hushåll och personer per hushåll över tid.
- **TAB824 / BO0104T04** – bostadsbestånd efter hustyp och upplåtelseform.

Dashboardens bostadsefterfrågan är en **indikativ hushållsbildningsmodell**. Prognostiserad befolkning divideras med vald hushållsstorlek (senaste nivå, femårstrend eller manuell nivå). Förändringen i beräknat hushållsbehov jämförs med färdigställt tillskott i aktiva bostadsscenarier. En valbar reserv/vakansandel kan läggas ovanpå efterfrågan.

Måttet ska inte tolkas som ett direkt marknadsunderskott eller som en prisprognos. Det tar i denna version inte fullt hänsyn till vakanser, fritidsbostäder, specialbostäder, bostadspriser, hushållens ekonomi eller matchning mellan hushållstyp och bostad.
