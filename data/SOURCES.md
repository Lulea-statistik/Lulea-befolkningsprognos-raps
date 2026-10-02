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

## Geografier

- 2580 Luleå
- 2582 Boden
- 2581 Piteå
- 2560 Älvsbyn
- 2514 Kalix
- FA_LULEA = summan av ovanstående i V1.

## CKM

Från 2025 lagras `method=CKM`. För varje cell kan ett maximalt relativt perturbationsmått beräknas som `3/value*100` när CKM-perturbationen är ±3. För risker används låg/bas/hög-scenario genom att variera både händelser och exponering med ±3.
