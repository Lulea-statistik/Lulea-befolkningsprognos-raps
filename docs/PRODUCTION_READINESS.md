# Produktionsberedskap och modellstyrning

Detta dokument sammanfattar produktionsläget för Luleås rAps-inspirerade befolkningsmodell efter **Update SCB data #78**.

## Produktionsstatus

Den genererade mognadsrapporten omfattar **38 komponenter**:

- **27 komponenter på mognadsgrad 4**
- **8 komponenter på mognadsgrad 2**
- **0 komponenter på mognadsgrad 1**
- **2 komponenter på mognadsgrad 3**

Nivå 4 betyder att komponenten har en definierad produktionsroll, är reproducerbar och har passerat sin fördefinierade produktionsgrind. För scenarier och stödkomponenter betyder nivå 4 inte att antagandet är den mest sannolika framtiden; det betyder att mekaniken är dokumenterad, reproducerbar och kontrollerad.

Nivå 2-komponenterna nedan är **medvetet underkända eller stängda kandidater**. De ska inte efterhandsjusteras mot redan använda utfall.

## Nivå 4

| Komponent | Roll | Produktionsaktiv |
|---|---|---:|
| `event_age_timing` – Kohortmotor och händelseålderstiming | production | Ja |
| `fertility_localization` – Fruktsamhet: nationell framtidsprofil × lokal nivå | production | Ja |
| `mortality_localization` – Dödlighet: nationell framtidsprofil × lokal nivå | production | Ja |
| `net_migration_10y` – Nettoflyttning: 10-årig produktionsbaslinje | production | Ja |
| `calibration_windows` – Kalibreringsfönster 3/6/10 | production_support | Ja |
| `industrial_workforce_scenario` – Industridrivet arbetskraftsscenario | production_ready_scenario | Nej / scenario eller stöd |
| `housing_scenario` – Bostadsdrivet befolkningsscenario | production_ready_scenario | Nej / scenario eller stöd |
| `household_projection` – Hushållsframskrivning för bostadsefterfrågan | production_support | Ja |
| `labour_market_support` – Arbetsmarknads- och pendlingsunderlag | production_support | Ja |
| `fading_policy` – Informationsvägd utjämning för små lokala åldersceller | production_support | Ja |
| `qutb_neutralization` – qutb: neutral utbildningsövergång | production_support | Ja |
| `base_population_ckm_bridge` – Basbefolkning och CKM-metodbrygga 2024→2025 | production_support | Ja |
| `sex_ratio_at_birth` – Könskvot vid födseln | production_support | Ja |
| `fa_additivity` – FA-additivitet | production_support | Ja |
| `national_future_profiles` – Nationella framtidsprofiler för fruktsamhet och dödlighet | production_support | Ja |
| `scenario_overlap_control` – Scenarieöverlapp bostad + jobb | production_support | Ja |
| `demographic_sensitivity_controls` – Demografiska känslighetsmultiplikatorer | production_support | Ja |
| `ckm_uncertainty_diagnostics` – CKM-osäkerhetsdiagnostik | production_support | Ja |
| `scenario_migration_profiles` – Scenarieprofiler för jobbdriven inflyttning | production_support | Ja |
| `model_data_integrity` – Kärndata: fullständighet och unikhet | production_support | Ja |
| `scenario_phase_in` – Scenarieinfasning över flera år | production_support | Ja |
| `population_accounting_identity` – Årlig befolkningsbalans | production_support | Ja |
| `housing_occupancy_defaults` – SCB-standard för personer per bostad | production_support | Ja |
| `housing_stock_support` – SCB bostadsbestånd | production_support | Ja |
| `housing_balance_indicator` – Bostadsefterfrågan och reserv | production_support | Ja |
| `source_manifest_integrity` – Källmanifest och rådataproveniens | production_support | Ja |
| `maturity_governance` – Mognadsregister och produktionsstyrning | production_support | Ja |

## Nivå 3 – validerad kandidat

| Komponent | Status | Nästa produktionsgrind |
|---|---|---|
| `fertility_spline_candidate` – Fruktsamhet: kubisk smoothing spline λ=10 | validated_candidate | Ytterligare helt orörd årlig eller extern kontroll efter 2025 med oförändrad λ=10. Lägre maternal-age-cell MAE och inte sämre totalfel för födda krävs i både Luleå och Luleå FA. |
| `mortality_wls_candidate` – Dödlighet: weighted least squares för lokal riskkurva | validated_candidate | Ytterligare helt orörd framtida eller årlig kontroll med oförändrad tvåparameters-WLS, dödsfallsbaserade vikter och 10-årsfönster. WLS ska vara minst lika bra som nuvarande metod på n+1 och n+2 och strikt bättre pooled. |

## Stängda nivå 2-kandidater

| Komponent | Status | Förvaltningsregel |
|---|---|---|
| `mortality_eb_candidate` – Dödlighet: Empirical Bayes | rejected_2025_holdout | Förbättrade cell-MAE men försämrade Luleås totalfel 2025; stängd utan eftertrimning. |
| `migration_spline_candidate` – Migration: kubisk spline för net10 | rejected | Försämrade åldersprofil-MAE, särskilt 15–39 år; stängd utan eftertrimning. |
| `component_flow` – Trebensmodell med separata bruttoflöden | rejected | Retain for research only; do not retune against consumed holdouts. |
| `migration_recency` – Adaptiv tidsviktning mot senare år | rejected | No further promotion. Keep diagnostic history to prevent rediscovering the same failed candidate. |
| `migration_age_smoothing` – Adaptiv åldersmjukning för migration | rejected | Keep failed locked smoothing candidates out of production; do not retune from these outcomes. |
| `scb_risk_flow` – Riskbaserad migration med regionala in-/utflyttningsrisker och nationell invandringsnivå | rejected_superseded | Closed: do not retune this approximation; retain results as evidence and use net10 in production. |
| `profet_flow` – Födelsestatusuppdelad riskbaserad migrationsmodell | rejected_current_architecture | Lock a genuinely new Profet architecture before any new outcome evaluation; do not retune the consumed risk, birth-status or consistency candidates. |
| `birth_status` – Inrikes/utrikes född som modellstatus | rejected | Closed: keep at level 2, do not retune birth-status parameters from these consumed outcomes. |
| `consistency_adjustment` – Konsistensjustering kommun → län → riket | rejected | Closed at level 2: structural accounting passed but the locked with/without forecast-accuracy gate failed; do not retune from these outcomes. |

## Produktionsbaslinje

Den demografiska baslinjen bygger på följande huvudprinciper:

- basår 2025 med CKM-metodbrottet explicit separerat från kalibreringshistoriken,
- event-age-aligned kohorttiming,
- lokalt kalibrerad fruktsamhet och dödlighet mot nationella profiler,
- tioårigt nettoflyttningsfönster som produktionsstandard,
- Luleå FA som exakt summa av de fem kommunprognoserna,
- fast könsfördelning vid födsel enligt den dokumenterade rAps-referensparametern,
- utfallsoberoende informationsvägd utjämning för små åldersceller,
- qutb som neutral identitetsövergång tills en separat utbildningsmodell införs.

Trebensmodell med separata bruttoflöden, adaptiv tidsviktning mot senare år, adaptiv åldersutjämning, födelsestatusuppdelad riskbaserad migration och länskonsistensjustering ingår **inte** i produktionsbaslinjen eftersom deras låsta valideringsgrindar inte passerade.

## Scenario- och analysstöd

Bostads- och arbetsplatsscenarier är separata från baslinjen. Produktionsmognad för dessa delar betyder att:

- scenarioeffekter är bokföringsmässigt separata från den demografiska baslinjen,
- infasning över flera år bevarar exakt samma kumulativa scenarioeffekt,
- intern flyttning inom FA är nollsummespel,
- överlappsavdrag mellan bostads- och jobbeffekt är explicit och justerbart,
- jobbdriven inflyttning kan använda dokumenterade ålder/kön-profiler,
- personer per bostad hämtas från SCB där stöd finns och kräver manuell nivå när giltig standard saknas,
- hushålls- och bostadsbalansen är ett indikativt analysstöd och påverkar inte den demografiska prognosen.

## UI- och exportkontroll

Före produktionsförvaltning ska den publicerade dashboarden också passera följande operativa kontroller:

- alla huvudsidor ska kunna renderas oberoende; ett UI-fel på en sida får inte stoppa övriga sidor,
- Åldersanalys ska visa lokal nivå jämfört med Riket för fruktsamhet och dödlighet samt separat lokal vikt,
- dödlighetsrisk ska visas separat för 0–70 år och 71–100+ år så yngre åldrar inte komprimeras av den höga äldre-dödligheten,
- diagramaxlar ska använda naturligt avrundade intervall snarare än godtyckliga ändvärden,
- byte av geografi eller kalibreringsfönster får inte lämna kvar värden från tidigare val när data saknas,
- Validering ska fortsätta renderas även om en annan analysvy får ett JavaScriptfel,
- CSV-export ska vara kompatibel med svensk Excel, bära geografi och modellval samt innehålla både prognos och baslinje för spårbarhet,
- GitHub Pages-deploy och relevant modelltest ska båda vara gröna för den publicerade committen.

Senast verifierad UI-/exportrevision omfattar bland annat isolerad sidrendering, jämförelsediagram Luleå/Riket, delad dödlighetsrisk 0–70/71+, robust tomläge för arbetsmarknadsdata och spårbar semikolonseparerad CSV-export.

## Hårda produktionsgrindar

En ny version ska inte betraktas som produktionsklar om någon av följande kontroller faller:

1. kärndata är ofullständiga, duplicerade eller numeriskt ogiltiga,
2. den årliga befolkningsbalansen inte går exakt ihop,
3. FA inte är additivt lika med summan av medlemskommunerna,
4. SCB/Raps-källmanifestet tappar tabell-ID, urval, råfil eller korrekt CKM-tidsgräns,
5. framtida nationella profiler saknar täckning,
6. scenarioinfasning eller scenarieöverlappar bryter sina bokföringsregler,
7. mognadspolicyn och den genererade mognadsrapporten inte innehåller samma komponentregister.

## Årlig / periodisk uppdatering

Vid en full **Update SCB data** ska följande kedja fortsätta gälla:

1. SCB-tabeller upptäcks och hämtas.
2. Källmanifest och råfiler byggs.
3. Modell-, arbetsmarknads-, hushålls- och bostadsdata byggs.
4. Alla enhetstester och produktionsgrindar körs.
5. Backtester och diagnostik byggs om.
6. Mognadsrapporten byggs om.
7. Endast en grön körning får publicera de genererade filerna.

En grön GitHub Pages-körning är inte ensam ett kvalitetsbevis; den relevanta modell-/SCB-workflowen måste också vara grön.

## Regler för nya modellförslag

En ny metod som påverkar basprognosen ska behandlas som en **ny kandidat**:

- metod, parametrar och acceptansgrind låses före utvärdering,
- redan konsumerade holdouts får inte användas för omtrimning,
- kandidatens resultat jämförs mot den aktiva produktionsbaslinjen,
- underkänd kandidat behålls som dokumenterad evidens men aktiveras inte,
- en kandidat får nivå 4 först när den passerar sin fördefinierade grind.

Detta gäller särskilt framtida försök med IMIG/UMIG, födelsestatusuppdelade riskbaserade migrationsmodeller, separata migrationsben eller nya åldersutjämningar.

## Evidens för informationsvägd utjämning

Den informationsvägda utjämningen är reproducerbar, utfallsoberoende och passerar sina tekniska produktionsgrindar. Detta ska dock inte tolkas som att den nuvarande viktfunktionen är prognosmässigt optimal.

Efter **Update SCB data #71** jämför rolling-origin-diagnostiken tre alternativ med samma generella kommunfaktor och samma fasta faktorgränser:

1. **0 % lokal åldersvikt** – riksprofil × generell kommunfaktor,
2. **nuvarande informationsvägning**,
3. **100 % lokal åldersvikt** – fullt genomslag för lokal ettårsåldersfaktor.

För Luleå kommun gav 0 % lägst MAE i fem av sex kombinationer av fruktsamhet/dödlighet och 3/6/10-årsfönster; 100 % var marginellt bäst för 3-årig fruktsamhet. För Luleå FA var 100 % bäst för fruktsamhet i samtliga tre fönster, medan 0 % var bäst för dödlighet i samtliga tre. Nuvarande informationsvägning var inte bäst i någon av de tolv huvudjämförelserna.

Slutsatsen är därför att lokal information tydligt kan vara värdefull, men att den nuvarande viktfunktionen ännu inte är visad som den mest träffsäkra kompromissen mellan riksprofil och lokal ettårsåldersprofil. Trösklarna får inte efterjusteras mot dessa redan observerade resultat. En ny viktfunktion eller SCB-inspirerad splineutjämning ska behandlas som en ny, förhandslåst kandidat och utvärderas på ny oberoende evidens.

## Låsta och validerade kandidater för lokalisering

Efter utvecklingsdiagnostiken 2018–2024 låstes alternativa lokaliseringsmetoder och testades därefter mot ett separat 2025-holdout. Produktionsbaslinjen ändras inte automatiskt av kandidatstatus.

- **Fruktsamhet – kubisk smoothing spline, λ=10:** klarade den förhandsdefinierade 2025-grinden för både Luleå kommun och Luleå FA. Maternal-age-cell MAE förbättrades från 4,318 till 4,155 i Luleå och från 8,737 till 8,483 i FA. Totalfelet för födda förbättrades samtidigt från 97,226 till 95,189 respektive från 278,550 till 277,175. Kandidaten är därför **mognadsgrad 3 – validerad kandidat**, men är ännu inte produktionsaktiv.
- **Dödlighet – Empirical Bayes:** förbättrade ålder×kön-cell MAE i både Luleå och FA, men klarade inte den låsta 2025-grinden eftersom totalfelet för döda i Luleå försämrades från 46,845 till 51,886. Kandidaten är därför **stängd på mognadsgrad 2** och får inte eftertrimmas mot 2018–2025.
- **Dödlighet – weighted least squares:** den låsta tvåparametersmodellen `log(lokal hazard)=a+b×log(rikets hazard)`, separat per geografi/fönster/kön och viktad med observerade lokala dödsfall per ålder, klarade den externa FA15-grinden på 10-årsfönstret. För n+1/n+2 förbättrades Trollhättan–Vänersborg 67,1→50,6 och 93,4→83,1; Gävle 51,7→48,1 och 37,7→36,8; Sundsvall 76,1→75,3 och 66,4→66,3. Pooled n+1/n+2 dödsfalls-MAE förbättrades från 65,4 till 60,0. Kandidaten är därför **mognadsgrad 3 – validerad kandidat**, men är ännu inte produktionsaktiv.
- **Migration – kubisk spline för net10-profil:** stängd på mognadsgrad 2. Total nettoflyttning bevarades, men åldersprofilen försämrades tydligt, särskilt 15–39 år. Rå 10-årig ettårsåldersprofil behålls därför.

2025-holdoutet använder endast 2025 som lokalt utfall och exponering. Den nationella pre-2025-profilen hålls fixerad för båda jämförda metoderna, så kontrollen isolerar lokaliseringsmetoden och blandar inte in ett nytt nationellt nivåantagande.

### Förhandslåst nivå-4-grind för fruktsamhets-splinen

Fruktsamhets-splinen får inte gå från nivå 3 till nivå 4 på grundval av 2018–2025, eftersom dessa utfall redan är konsumerade. Nästa produktionsgrind är därför låst i förväg:

1. λ ska förbli **10** och splineformuleringen får inte ändras.
2. Evidensen ska komma från en **helt orörd årlig eller extern kontroll efter 2025**.
3. Kandidaten ska återigen ge **lägre maternal-age-cell MAE** än nuvarande produktionsmetod för både Luleå kommun och Luleå FA.
4. Kandidaten får samtidigt **inte försämra totalfelet för antal födda** i någon av de två geografierna.
5. Först om samtliga krav passerar kan kandidaten övervägas för nivå 4 och produktionsbyte.

### Förhandslåst nivå-4-grind för dödlighets-WLS

Dödlighets-WLS får inte gå från nivå 3 till nivå 4 på grundval av de redan konsumerade Luleå-, Luleå FA- och FA15-resultaten. Nästa produktionsgrind är därför låst i förväg:

1. Tvåparametersformen `log(lokal hazard)=a+b×log(rikets hazard)` ska vara oförändrad.
2. Vikterna ska fortsatt baseras på observerade lokala dödsfall per ålder.
3. Produktionskandidaten ska fortsatt använda **10-årsfönstret**.
4. Evidensen ska komma från en **helt orörd framtida eller årlig kontroll** som inte använts för att formulera eller välja WLS-kandidaten.
5. WLS ska ge lägre eller lika dödsfalls-MAE än nuvarande metod på n+1 och n+2 och samtidigt ge strikt lägre pooled MAE.
6. Först om samtliga krav passerar kan kandidaten övervägas för nivå 4 och produktionsbyte.

## Kända avgränsningar

Modellen är produktionsmogen inom den definierade arkitekturen, men den är inte en full marknads- eller samhällsekonomisk modell. Bland annat:

- bostadsanalysen innehåller ännu inte full modellering av rivningar, vakanser, fritidsbostäder, priser eller hushållens ekonomi,
- jobbscenariernas flyttandelar och spin-off-effekter är scenarioantaganden, inte sannolikheter,
- scenarioåldersprofiler är deskriptiva priors, inte kausala skattningar,
- CKM-känslighetsmått är diagnostik och inte statistiska konfidensintervall,
- qutb är neutraliserad och representerar ännu ingen empirisk utbildningsövergångsmodell.

## Maskinläsbar status

Den aktuella statusen finns i:

- `data/model_maturity.json`
- `data/model_maturity_policy.json`
- `data/backtests/`

Dessa filer är den primära tekniska evidensen för mognadsnivåerna; detta dokument är den läsbara sammanfattningen.
