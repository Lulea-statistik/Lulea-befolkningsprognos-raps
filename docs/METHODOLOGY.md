# Metodspecifikation V1

## Geografi

Luleå FA definieras i V1 som summan av kommunerna 2580 Luleå, 2582 Boden, 2581 Piteå, 2560 Älvsbyn och 2514 Kalix. Den publicerade FA-prognosen beräknas därför år för år som summan av de fem kommunprognoserna, inklusive födda, döda, nettoflyttning, scenarieeffekter och ålder/kön. Separat kalibrerade FA-profiler behålls som diagnostik men driver inte en fristående sjätte prognos som kan avvika från kommunsumman.

## Årssteg

Produktionsmodellen använder **event-age-aligned** kohorttiming. Utgångspunkten är befolkningen den 31 december år n. För prognosåret n+1:

1. kohorterna åldras ett år till den ålder som gäller vid slutet av prognosåret,
2. födda beräknas från kvinnor i deras ålder under prognosåret,
3. nyfödda läggs till i ålder 0,
4. dödlighet appliceras på prognosårets ålder, inklusive ålder 0,
5. nettoflyttning och scenarieeffekter appliceras på prognosårets åldersstruktur.

Detta gör åldersindexeringen konsekvent med SCB:s källor: döds- och flytthändelser efter födelseår/ålder vid årets slut samt fruktsamhet efter moderns ålder vid födelsen.

Den äldre V1-sekvensen, där dödlighet applicerades på föregående årsskiftes ålder före åldring, finns kvar endast som valideringsjämförelse och används inte i produktionsprognosen.

### Bestånd och exponering/medelfolkmängd

Modellen skiljer uttryckligen mellan **folkmängd som bestånd** och **medelfolkmängd som exponering**.

- Folkmängd 31 december används för basbefolkning, redovisade befolkningsnivåer och befolkningsdiagram.
- SCB TAB2818, medelfolkmängd efter födelseår, används som nämnare för händelser där åldern avser uppnådd ålder vid årets slut. Det gäller i modellen dödsfall från TAB959 och flyttningar från TAB1212.
- SCB TAB2819, medelfolkmängd efter ålder under året, används för fruktsamhet eftersom TAB1264 klassificerar modern efter hennes ålder vid barnets födelse.
- Medelfolkmängd används också som exponeringssignal i fading när den bakomliggande händelserisken skattas.

Det är därför inte korrekt att använda samma 31-decemberbestånd som nämnare för alla händelser. Nämnaren ska följa händelsens åldersdefinition.

### Dödlighet

Basform för observerad risk:

`drisk = 1 - exp(-D/P)`

Där `D` är döda och `P` är relevant medelfolkmängd. Framtida riskprofil utgår från SCB:s nationella ålder/kön-profil och multipliceras med en lokal kalibreringsfaktor.

### Fruktsamhet

`frukty_local(a,t) = frukty_SE(a,t) * K_fert_local`

`K_fert_local` ska beräknas åldersstandardiserat genom att jämföra observerade lokala födda med det antal som skulle förväntas om lokal kvinnlig befolkning hade rikets åldersspecifika fruktsamhetstal. Historisk exponering för kvinnor 15–49 år hämtas från TAB2819 (ålder under året), eftersom moderns ålder i födelsetabellen avser ålder vid själva födelsen.

Basscenariot använder SCB:s 2024-vintage som Raps-referens. Modellen lagrar dessutom **SCB 2026** som en separat fruktsamhetsbana. Den alternativa banan byter endast `frukty_SE(a,t)`; samma lokala relativa åldersprofil, dödlighet, migration, kalibreringsfönster och kohorttiming används. Den är därför en känslighetsanalys och inte en omkalibrerad Luleåprognos.

Dashboardens manuella fruktsamhetsmultiplikator appliceras ovanpå vald nationell bana och kan användas för transparenta låg-/högscenarier. Den får inte användas för att trimma modellen mot känt historiskt utfall.

### Utflyttningsrisk

`urisk = 1 - exp(-U/P)`

V1 beräknar och lagrar `urisk` per kommun, kön och ettårsålder för 2-, 4-, 6- och 10-årsfönstren. `U` är observerad kommunal brutto-utflyttning och `P` motsvarande summerad exponering/medelfolkmängd under kalibreringsfönstret. Ett historiskt årligt bruttoinflyttningsprofil per kommun, kön och ålder lagras parallellt som underlag för en framtida IMIG-modell.

Dessa bruttoflöden skapas inte för FA genom summering av kommunerna, eftersom flyttar mellan medlemskommunerna då felaktigt skulle räknas som extern FA-migration.

Basscenariot använder fortfarande exogena nettoflyttningsprofiler. `urisk` och bruttoinflyttningen är därför i denna version modellbyggande diagnostik tills IMIG/UMIG och `ifl` aktiveras.

Nettoflyttningens kalibreringsfönster kan analyseras separat från fruktsamhet och dödlighet. Produktionsbasen följer det globala kalibreringsfönstret (10 år som standard), men en migration-only känslighet kan hålla fruktsamhet/dödlighet på 10 år och byta endast nettoflyttningen mellan 2, 4, 6 och 10 år. 19 år används inte längre som migrationsalternativ efter #36 eftersom det saknade prognosstöd och inte kunde valideras på samma rolling-origin-grund som de kortare fönstren. Detta är en antagandekänslighet, inte en automatisk metodväljare.

Observerat netto 2025 används dessutom som en separat post-kalibreringsdiagnostik eftersom migrationsprofilerna byggs på data till och med 2024. År 2025 ligger efter CKM-metodbrottet och används därför inte för att trimma profil eller fönster.

#### Unga vuxnas flyttmönster i Luleå

Basscenariot använder nettoflyttning per **ettårsålder och kön**, vilket gör att återkommande toppar inte försvinner i breda åldersgrupper. För Luleå följs därför särskilt:
- 19–20 år: tydlig inflyttningsålder,
- 19–25 år: bred kontrollgrupp,
- 24–25 år: tydlig utflyttningsålder.

Detta är åldersmönster i faktisk flyttstatistik. Modellen klassificerar inte personer som studenter och behöver ingen särskild studentregel för att bevara topparna.

#### Tre geografiska migrationsben

SCB TAB4693 (2006–2024) och TAB6657 (2025, CKM) delar kommunal migration i:
- **övriga Norrbotten**: till/från andra kommuner i samma län,
- **övriga Sverige**: till/från andra län,
- **utlandet**: utrikes in-/utflyttning.

Varje ben lagras som in, ut och netto per ettårsålder och kön. För Luleå kommun kan alla sex bruttoflöden användas direkt. För Luleå FA får länsbrutto inte summeras från medlemskommunerna eftersom interna FA-flyttar då dubbelräknas; länsnetto kan däremot summeras eftersom interna flöden tar ut varandra.

Komponenternas 2/4/6/10-årsfönster utvärderas separat på n+1 och n+2. Syftet är att kunna använda kort historik där en process är snabbföränderlig utan att göra hela migrationsmodellen kortsiktig.

### Utbildningsbyte

`qutb` är i V1 en identitetsmatris. Det betyder att utbildningsgrupp inte förändras av modellen. Strukturen finns kvar så att riktiga övergångssannolikheter senare kan ersätta identitetsmatrisen utan att motorn byggs om.

## Kalibrering

För fruktsamhet och dödlighet sparas tre fönster:

- 6 år: relativt aktuell nivå med mer stabilitet än mycket korta fönster.
- 10 år: standard.
- 19 år: lång historik för stabilitets-/strukturkontroll när definitionerna är jämförbara.

För migration sparas **2, 4, 6 och 10 år**, eftersom flyttning kan reagera snabbare på aktuella förhållanden. 19 år används inte som aktivt migrationsfönster efter #36.

Långa råserier sparas även när ett kortare kalibreringsfönster används.

## CKM från 2025

Pre-CKM-data till och med 2024 och CKM-data från 2025 sys ihop i samma tidsserie men varje observation flaggas med metod. När SCB:s cellperturbation kan antas vara ±3 beräknas enkel maximal relativ cellkänslighet som:

`CKM_max_pct = 3 / abs(value) * 100`

För risker beräknas ett känslighetsintervall genom att samtidigt variera händelser och exponering:

`risk_low  = 1 - exp(-(max(E-3,0))/(P+3))`

`risk_base = 1 - exp(-E/P)`

`risk_high = 1 - exp(-(E+3)/(max(P-3,1)))`

Skillnaden 2024–2025 får inte tolkas som ett rent CKM-fel; modellen märker den i stället som ett metodbrott som kan analyseras separat.

## Migration i FA

Nettoflyttning kan summeras över kommunerna eftersom interna flyttar tar ut varandra i netto. Separata in- och utflyttningsflöden för FA får däremot inte skapas genom enkel summering av kommunernas flöden, eftersom interna kommunflyttar då dubbelräknas.
