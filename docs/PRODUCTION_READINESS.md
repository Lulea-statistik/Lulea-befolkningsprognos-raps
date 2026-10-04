# Produktionsberedskap och modellstyrning

Detta dokument sammanfattar produktionsläget för Luleås rAps-inspirerade befolkningsmodell efter **Update SCB data #88**.

## Produktionsstatus

Den genererade mognadsrapporten omfattar **42 komponenter**:

- **27 komponenter på mognadsgrad 4**
- **11 komponenter på mognadsgrad 2**
- **0 komponenter på mognadsgrad 1**
- **4 komponenter på mognadsgrad 3**

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
| `fertility_spline_candidate` – Fruktsamhet: kubisk utjämningsspline λ=10 | validated_candidate | Ytterligare helt orörd årlig eller extern kontroll efter 2025 med oförändrad λ=10. Lägre MAE per ålderscell för modern och inte sämre totalfel för födda krävs i både Luleå och Luleå FA. |
| `mortality_wls_candidate` – Dödlighet: viktad minsta kvadratmetod (WLS) för lokal riskkurva | validated_candidate | Ytterligare helt orörd framtida eller årlig kontroll med oförändrad tvåparameters-WLS, dödsfallsbaserade vikter och 10-årsfönster. WLS ska vara minst lika bra som nuvarande metod på n+1 och n+2 och strikt bättre sammanvägt. |
| `birth_status_net10_constrained_candidate` – Födelsestatus: net10-begränsad statusfördelning | validated_candidate | Ytterligare helt orörd framtida eller årlig kontroll med oförändrad net10-total per kön×ålder, 10-årsfönster och låsta statusallokeringsregler. Kandidaten ska vara minst lika bra som beståndsandel på n+1/n+2 för båda statusgrupperna och strikt bättre sammanvägt, samtidigt som totalbefolkning och nettoflyttning exakt bevarar net10. |
| `qutb_education_transition_candidate` – qutb: kohortbaserade utbildningsövergångar | validerad kandidat, endast forskning | Ytterligare orörd framtida årskontroll med oförändrade fem utbildningsstatusar, 10-årsfönster och åldrar 20–64. Godkänd nivå 4 skulle endast validera utbildningsprognosen, inte användning i migration, fruktsamhet eller dödlighet. |

## Stängda nivå 2-kandidater

| Komponent | Status | Förvaltningsregel |
|---|---|---|
| `mortality_eb_candidate` – Dödlighet: Empirical Bayes | rejected_2025_holdout | Förbättrade cell-MAE men försämrade Luleås totalfel 2025; stängd utan eftertrimning. |
| `migration_spline_candidate` – Migration: kubisk spline för net10 | rejected | Försämrade åldersprofil-MAE, särskilt 15–39 år; stängd utan eftertrimning. |
| `component_flow` – Trebensmodell med separata bruttoflöden | rejected | Behåll endast som forskningsunderlag; trimma inte om modellen mot redan använda kontrollutfall. |
| `migration_recency` – Adaptiv tidsviktning mot senare år | rejected | Ingen vidare uppflyttning. Behåll diagnostikhistoriken så att samma underkända kandidat inte återupptäcks senare. |
| `migration_age_smoothing` – Adaptiv åldersmjukning för migration | rejected | Behåll de underkända, låsta utjämningskandidaterna utanför produktion och trimma inte om dem utifrån dessa utfall. |
| `scb_risk_flow` – Riskbaserad migration med regionala in-/utflyttningsrisker och nationell invandringsnivå | rejected_superseded | Stängd: trimma inte om approximationen. Behåll resultaten som evidens och använd net10 i produktion. |
| `profet_flow` – Födelsestatusuppdelad riskbaserad migrationsmodell | rejected_current_architecture | Lås en genuint ny Profet-arkitektur före nästa utfallsutvärdering. Trimma inte om de redan utvärderade risk-, födelsestatus- eller konsistenskandidaterna. |
| `birth_status` – Inrikes/utrikes född som modellstatus | rejected | Stängd på nivå 2. Trimma inte om födelsestatusparametrar utifrån redan använda utfall. |
| `consistency_adjustment` – Konsistensjustering kommun → län → riket | rejected | Stängd på nivå 2: den strukturella bokföringen passerade, men den låsta jämförelsen av prognosprecision med/utan justering föll. Trimma inte om modellen utifrån dessa utfall. |
| `profet_net10_status_demography_candidate` – Profet-arkitektur: net10 + födelsestatusspecifik demografi | rejected_development | Stängd på nivå 2 efter att den låsta utvecklingsgrinden inte passerade för både Luleå och Luleå FA. Ingen eftertrimning på 2018–2024. |
| `housing_migration_lead_research` – Forskningsspår: laggad bostadsbeståndsförändring och nettoflyttning | rejected_development | Stängd på nivå 2. Förbättrade Luleå kommun något men försämrade Luleå FA och den externa FA15-grinden. Ingen eftertrimning av lagg, fönster eller estimator. |

## Produktionsbaslinje

Den demografiska baslinjen bygger på följande huvudprinciper:

- basår 2025 med CKM-metodbrottet explicit separerat från kalibreringshistoriken,
- händelseåldersanpassad kohorttiming,
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
- GitHub Pages-publicering och relevant modelltest ska båda vara gröna för den publicerade committen.

Senast verifierad UI-/exportrevision omfattar bland annat isolerad sidrendering, jämförelsediagram Luleå/Riket, delad dödlighetsrisk 0–70/71+, robust tomläge för arbetsmarknadsdata och spårbar semikolonseparerad CSV-export.

## Hårda produktionsgrindar

En ny version ska inte betraktas som produktionsklar om någon av följande kontroller faller:

1. kärndata är ofullständiga, duplicerade eller numeriskt ogiltiga,
2. den årliga befolkningsbalansen inte går exakt ihop,
3. FA inte är additivt lika med summan av medlemskommunerna,
4. SCB/rAps-källmanifestet tappar tabell-ID, urval, råfil eller korrekt CKM-tidsgräns,
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

En grön GitHub Pages-körning är inte ensam ett kvalitetsbevis; den relevanta modell- och SCB-arbetsflödet måste också vara grön.

## Regler för nya modellförslag

En ny metod som påverkar basprognosen ska behandlas som en **ny kandidat**:

- metod, parametrar och acceptansgrind låses före utvärdering,
- redan konsumerade orörda kontrollperioder får inte användas för omtrimning,
- kandidatens resultat jämförs mot den aktiva produktionsbaslinjen,
- underkänd kandidat behålls som dokumenterad evidens men aktiveras inte,
- en kandidat får nivå 4 först när den passerar sin fördefinierade grind.

Detta gäller särskilt framtida försök med IMIG/UMIG, födelsestatusuppdelade riskbaserade migrationsmodeller, separata migrationsben eller nya åldersutjämningar.

## Evidens för informationsvägd utjämning

Den informationsvägda utjämningen är reproducerbar, utfallsoberoende och passerar sina tekniska produktionsgrindar. Detta ska dock inte tolkas som att den nuvarande viktfunktionen är prognosmässigt optimal.

Efter **Update SCB data #71** jämför diagnostiken med rullande prognosursprung tre alternativ med samma generella kommunfaktor och samma fasta faktorgränser:

1. **0 % lokal åldersvikt** – riksprofil × generell kommunfaktor,
2. **nuvarande informationsvägning**,
3. **100 % lokal åldersvikt** – fullt genomslag för lokal ettårsåldersfaktor.

För Luleå kommun gav 0 % lägst MAE i fem av sex kombinationer av fruktsamhet/dödlighet och 3/6/10-årsfönster; 100 % var marginellt bäst för 3-årig fruktsamhet. För Luleå FA var 100 % bäst för fruktsamhet i samtliga tre fönster, medan 0 % var bäst för dödlighet i samtliga tre. Nuvarande informationsvägning var inte bäst i någon av de tolv huvudjämförelserna.

Slutsatsen är därför att lokal information tydligt kan vara värdefull, men att den nuvarande viktfunktionen ännu inte är visad som den mest träffsäkra kompromissen mellan riksprofil och lokal ettårsåldersprofil. Trösklarna får inte efterjusteras mot dessa redan observerade resultat. En ny viktfunktion eller SCB-inspirerad splineutjämning ska behandlas som en ny, förhandslåst kandidat och utvärderas på ny oberoende evidens.

## Låsta och validerade kandidater för lokalisering

Efter utvecklingsdiagnostiken 2018–2024 låstes alternativa lokaliseringsmetoder och testades därefter mot ett separat 2025 års orörda kontrollperiod. Produktionsbaslinjen ändras inte automatiskt av kandidatstatus.

- **Fruktsamhet – kubisk utjämningsspline, λ=10:** klarade den förhandsdefinierade 2025-grinden för både Luleå kommun och Luleå FA. MAE per ålderscell för modern förbättrades från 4,318 till 4,155 i Luleå och från 8,737 till 8,483 i FA. Totalfelet för födda förbättrades samtidigt från 97,226 till 95,189 respektive från 278,550 till 277,175. Kandidaten är därför **mognadsgrad 3 – validerad kandidat**, men är ännu inte produktionsaktiv.
- **Dödlighet – Empirical Bayes:** förbättrade ålder×kön-cell MAE i både Luleå och FA, men klarade inte den låsta 2025-grinden eftersom totalfelet för döda i Luleå försämrades från 46,845 till 51,886. Kandidaten är därför **stängd på mognadsgrad 2** och får inte eftertrimmas mot 2018–2025.
- **Dödlighet – viktad minsta kvadratmetod (WLS):** den låsta tvåparametersmodellen `log(lokal dödlighetsintensitet)=a+b×log(rikets dödlighetsintensitet)`, separat per geografi/fönster/kön och viktad med observerade lokala dödsfall per ålder, klarade den externa FA15-grinden på 10-årsfönstret. För n+1/n+2 förbättrades Trollhättan–Vänersborg 67,1→50,6 och 93,4→83,1; Gävle 51,7→48,1 och 37,7→36,8; Sundsvall 76,1→75,3 och 66,4→66,3. Sammanvägt n+1/n+2 dödsfalls-MAE förbättrades från 65,4 till 60,0. Kandidaten är därför **mognadsgrad 3 – validerad kandidat**, men är ännu inte produktionsaktiv.
- **Födelsestatus – net10-begränsad statusfördelning:** kandidaten bevarar produktionens 10-åriga nettoflyttning exakt per kön och ettårsålder och modellerar endast fördelningen mellan svensk- och utrikesfödda. I den låsta externa FA15-grinden slog den beståndsandel-komparatorn på n+1 och n+2 för båda statusgrupperna i Trollhättan–Vänersborg, Gävle och Sundsvall. Sammanvägt n+1/n+2 MAE förbättrades för svenskfödda från **1465,9 till 1029,7** och för utrikesfödda från **494,0 till 221,8**. Strukturgrinden gav **0 avvikelse** i totalbefolkning och nettoflyttning mot net10. Kandidaten är därför **mognadsgrad 3 – validerad kandidat**, men är ännu inte produktionsaktiv.
- **Migration – kubisk spline för net10-profil:** stängd på mognadsgrad 2. Total nettoflyttning bevarades, men åldersprofilen försämrades tydligt, särskilt 15–39 år. Rå 10-årig ettårsåldersprofil behålls därför.

2025 års orörda kontrollperiodet använder endast 2025 som lokalt utfall och exponering. Den nationella pre-2025-profilen hålls fixerad för båda jämförda metoderna, så kontrollen isolerar lokaliseringsmetoden och blandar inte in ett nytt nationellt nivåantagande.

### Förhandslåst nivå-4-grind för fruktsamhets-splinen

Fruktsamhets-splinen får inte gå från nivå 3 till nivå 4 på grundval av 2018–2025, eftersom dessa utfall redan är konsumerade. Nästa produktionsgrind är därför låst i förväg:

1. λ ska förbli **10** och splineformuleringen får inte ändras.
2. Evidensen ska komma från en **helt orörd årlig eller extern kontroll efter 2025**.
3. Kandidaten ska återigen ge **lägre MAE per ålderscell för modern** än nuvarande produktionsmetod för både Luleå kommun och Luleå FA.
4. Kandidaten får samtidigt **inte försämra totalfelet för antal födda** i någon av de två geografierna.
5. Först om samtliga krav passerar kan kandidaten övervägas för nivå 4 och produktionsbyte.

### Forskningsspår: qutb och utbildningsövergångar

Den kohortbaserade utbildningsmodellen använder SCB:s kommunserie för utbildningsnivå, kön och ettårsålder. Fem ordnade utbildningsstatusar används och övergångarna skattas från nationella kohortförändringar över ett låst 10-årsfönster. Komponenten påverkar **inte** befolkningsprognosen, migrationen, fruktsamheten eller dödligheten.

Utvecklingsgrinden för Luleå och Luleå FA passerade. Den förhandslåsta externa nivå-3-grinden passerade också i samtliga tre FA15-referensregioner samt ankarkommunerna Trollhättan, Gävle och Sundsvall. Sammanvägt n+1/n+2 MAE i utbildningsandelar minskade från **0,01267** med identitets-qutb till **0,00476** med kohortövergångsmodellen.

Komponenten är därför **mognadsgrad 3 – validerad kandidat**, men med status **endast forskning**. Den får inte påverka produktionsmodellen.

#### Förhandslåst nivå-4-grind för qutb-forskningen

1. Metoden fryses på fem utbildningsstatusar, 10-årigt nationellt kohortfönster, endast angränsande uppåtövergångar och scoring i åldrarna 20–64.
2. Identitets-qutb förblir comparator.
3. Nästa evidens måste komma från en **orörd framtida årsobservation** efter att metoden frysts.
4. Kandidaten ska slå identitets-qutb på n+1 för både Luleå och Luleå FA och vara minst lika bra på n+2 när det finns ett verkligt orört n+2-utfall.
5. Strukturkontroller för sannolikheter och andelssummor ska fortsatt passera.
6. En godkänd nivå-4-grind validerar endast **utbildningsprognosen**. Koppling till migration, fruktsamhet eller dödlighet kräver en ny separat, förhandslåst och självständigt validerad komponentmodell.

### Förhandslåst nivå-4-grind för net10-begränsad födelsestatus

Den net10-begränsade födelsestatuskandidaten får inte gå från nivå 3 till nivå 4 på grundval av redan konsumerade Luleå-, Luleå FA- eller externa FA15-resultat. Nästa produktionsgrind är därför låst i förväg:

1. Produktionsbaslinjens **net10 per kön och ettårsålder** ska vara oförändrad.
2. **10-årsfönstret** ska vara oförändrat.
3. Positiv nettoflyttning ska fortsatt fördelas efter 10-årig bruttoinflyttningsandel per födelsestatus och negativ nettoflyttning efter 10-årig bruttoutflyttningsandel.
4. Samma låsta reservregel ska användas när historiska händelser saknas; nyfödda ska fortsatt tillföras svenskfödda och dödligheten ska vara statusoberoende.
5. Evidensen ska komma från en **helt orörd framtida eller årlig kontroll** som inte använts för att formulera eller välja kandidaten.
6. Kandidaten ska vara minst lika bra som beståndsandel-komparatorn för både svenskfödda och utrikesfödda på n+1 och n+2 och samtidigt strikt bättre sammanvägt för båda statusgrupperna.
7. Totalbefolkning och nettoflyttning ska fortsatt exakt bevara net10.
8. Först om samtliga krav passerar kan kandidaten övervägas för nivå 4 och produktionsanvändning.

### Förhandslåst nivå-4-grind för dödlighets-WLS

Dödlighets-WLS får inte gå från nivå 3 till nivå 4 på grundval av de redan konsumerade Luleå-, Luleå FA- och FA15-resultaten. Nästa produktionsgrind är därför låst i förväg:

1. Tvåparametersformen `log(lokal dödlighetsintensitet)=a+b×log(rikets dödlighetsintensitet)` ska vara oförändrad.
2. Vikterna ska fortsatt baseras på observerade lokala dödsfall per ålder.
3. Produktionskandidaten ska fortsatt använda **10-årsfönstret**.
4. Evidensen ska komma från en **helt orörd framtida eller årlig kontroll** som inte använts för att formulera eller välja WLS-kandidaten.
5. WLS ska ge lägre eller lika dödsfalls-MAE än nuvarande metod på n+1 och n+2 och samtidigt ge strikt lägre sammanvägt MAE.
6. Först om samtliga krav passerar kan kandidaten övervägas för nivå 4 och produktionsbyte.

## Kända avgränsningar

Modellen är produktionsmogen inom den definierade arkitekturen, men den är inte en full marknads- eller samhällsekonomisk modell. Bland annat:

- bostadsanalysen innehåller ännu inte full modellering av rivningar, vakanser, fritidsbostäder, priser eller hushållens ekonomi,
- jobbscenariernas flyttandelar och spridningseffekter är scenarioantaganden, inte sannolikheter,
- scenarioåldersprofiler är deskriptiva priors, inte kausala skattningar,
- CKM-känslighetsmått är diagnostik och inte statistiska konfidensintervall,
- qutb är neutraliserad och representerar ännu ingen empirisk utbildningsövergångsmodell.

## Maskinläsbar status

Den aktuella statusen finns i:

- `data/model_maturity.json`
- `data/model_maturity_policy.json`
- `data/backtests/`

Dessa filer är den primära tekniska evidensen för mognadsnivåerna; detta dokument är den läsbara sammanfattningen.
