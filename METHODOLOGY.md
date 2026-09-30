# Metodspecifikation V1

## Geografi

Luleå FA definieras i V1 som summan av kommunerna 2580 Luleå, 2582 Boden, 2581 Piteå, 2560 Älvsbyn och 2514 Kalix. Kommunresultat och FA-resultat ska avstämmas så att FA-totalen är summan av kommunerna.

## Årssteg

För varje kön och ettårsålder beräknas först dödsfall, därefter åldras överlevande ett år. Nyfödda läggs till i ålder 0 och exogen nettoflyttning läggs till per ålder och kön.

### Dödlighet

Basform för observerad risk:

`drisk = 1 - exp(-D/P)`

Där `D` är döda och `P` är relevant medelfolkmängd. Framtida riskprofil utgår från SCB:s nationella ålder/kön-profil och multipliceras med en lokal kalibreringsfaktor.

### Fruktsamhet

`frukty_local(a,t) = frukty_SE(a,t) * K_fert_local`

`K_fert_local` ska beräknas åldersstandardiserat genom att jämföra observerade lokala födda med det antal som skulle förväntas om lokal kvinnlig befolkning hade rikets åldersspecifika fruktsamhetstal.

### Utflyttningsrisk

`urisk = 1 - exp(-U/P)`

V1 lagrar och diagnostiserar `urisk`, men prognosens migration drivs av exogena nettoflyttningsprofiler tills `ifl` och IMIG/UMIG utvecklas vidare.

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
