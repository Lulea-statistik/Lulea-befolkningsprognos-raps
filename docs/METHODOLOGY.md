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

### Utflyttningsrisk

`urisk = 1 - exp(-U/P)`

V1 beräknar och lagrar `urisk` per kommun, kön och ettårsålder för 6-, 10- och 19-årsfönstren. `U` är observerad kommunal brutto-utflyttning och `P` motsvarande summerad exponering/medelfolkmängd under kalibreringsfönstret. Ett historiskt årligt bruttoinflyttningsprofil per kommun, kön och ålder lagras parallellt som underlag för en framtida IMIG-modell.

Dessa bruttoflöden skapas inte för FA genom summering av kommunerna, eftersom flyttar mellan medlemskommunerna då felaktigt skulle räknas som extern FA-migration.

Basscenariot använder fortfarande exogena nettoflyttningsprofiler. `urisk` och bruttoinflyttningen är därför i denna version modellbyggande diagnostik tills IMIG/UMIG och `ifl` aktiveras.

### Utbildningsbyte

`qutb` är i V1 en identitetsmatris. Det betyder att utbildningsgrupp inte förändras av modellen. Strukturen finns kvar så att riktiga övergångssannolikheter senare kan ersätta identitetsmatrisen utan att motorn byggs om.

## Kalibrering

Tre fönster sparas:

- 6 år: senaste sex jämförbara år.
- 10 år: standard.
- 19 år: lång historik när serien är metodiskt jämförbar.

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
