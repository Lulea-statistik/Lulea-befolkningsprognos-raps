# Källor – planerad SCB-mappning

## SCB PxWebApi v2

Bas: `https://statistikdatabasen.scb.se/api/v2`

API v2 erbjuder bl.a. `GET /tables`, `GET /tables/{id}/metadata`, `GET/POST /tables/{id}/data`. Modellen använder runtime-discovery så att tabell-id inte behöver hårdkodas innan metadata är verifierad.

## Planerade tabeller

- Folkmängd t.o.m. 2024 + `BefolkningCKM` 2025+.
- Medelfolkmängd efter födelseår t.o.m. 2024 + `MedelfolkFodarCKM` 2025+.
- Medelfolkmängd efter ålder under året t.o.m. 2024 + CKM-variant 2025+; används för fruktsamhet när moderns ålder avser ålder vid födelsen.
- Flyttningar 1997–2024 + `Flyttningar97CKM` 2025+.
- Födda historiskt + `FoddaKCKM` 2025+.
- Döda historiskt + CKM-variant från 2025 när exakt tabell-id är verifierat.
- Nationella framtida fruktsamhets- och dödlighetsprofiler.
  - Produktionsbas: SCB 2024/Raps, byggd från `raps_national_detail_2024` och `raps_births_2024`.
  - Fruktsamhetskänslighet: SCB 2026, byggd från `national_forecast_detail` och `national_forecast_births`; samma lokala relativa profil används och dödlighet/migration lämnas oförändrade.

## Geografier

- 2580 Luleå
- 2582 Boden
- 2581 Piteå
- 2560 Älvsbyn
- 2514 Kalix
- FA_LULEA = summan av ovanstående i V1.

### Externa valideringsgeografier

För generaliserbarhetstest används dessutom fasta FA15-regioner, endast i historisk validering:

- FA16 Trollhättan-Vänersborg: 1427 Sotenäs, 1430 Munkedal, 1439 Färgelanda, 1444 Grästorp, 1461 Mellerud, 1484 Lysekil, 1485 Uddevalla, 1487 Vänersborg, 1488 Trollhättan.
- FA36 Gävle: 0319 Älvkarleby, 2101 Ockelbo, 2104 Hofors, 2180 Gävle, 2181 Sandviken.
- FA42 Sundsvall: 2260 Ånge, 2262 Timrå, 2280 Härnösand, 2281 Sundsvall.

Medlemskapen kommer från Tillväxtverkets FA15-indelning och ligger låsta i `data/reference_fa_regions.json`. Historiska SCB-uttag 2006–2024 inkluderar dessa kommuner, medan produktionsprognosen fortfarande är avgränsad till Luleå FA.

## CKM

Från 2025 lagras `method=CKM`. För varje cell kan ett maximalt relativt perturbationsmått beräknas som `3/value*100` när CKM-perturbationen är ±3. För risker används låg/bas/hög-scenario genom att variera både händelser och exponering med ±3.
