# Extraktion av historiska SCB-reduktioner 2009–2011

Datum: 2026-10-21.

Tre originalrapporter har granskats för deras **reduktion av dödstal**, inte senare beräknade dödsrisker:
- **2009**, *Demografiska rapporter 2009:1*, tabell **T.4**, tryckt sida 171–172, PDF-sidor 173–174. Perioder: 2010–2020 / 2025–2035 / 2040–2060.
- **2010**, *BE 18 SM 1001*, tabell **4**, tryckt sida 25–26, PDF-sidor 25–26. Perioder: 2011–2020 / 2025–2035 / 2040–2060.
- **2011**, *BE 18 SM 1101*, tabell **4**, tryckt sida 25–26, PDF-sidor 25–26. Perioder: 2012–2020 / 2025–2035 / 2040–2060.

## Extraktionsresultat
Varje rapport har 64 tryckta åldersrader med en sammanslagen åldersgrupp **0–43** samt individuella åldrar 44–106. Den sammanslagna 0–43-raden ger samma reduktion för samtliga 44 åldrar, som har utvecklats till separata rader **utan ändring av ursprungsvärdet**. Totalt: 107 åldrar × två kön × tre perioder × tre årgångar = **1 926 värden**. Ingen saknad ålder, inga dubletter.

**Jämförelse:** alla **642** ålder–kön–periodkombinationer har identiska reduktionstal mellan 2009 och 2010, liksom mellan 2010 och 2011. Däremot är giltighetsperioderna olika. Bevara därför årgången även när värdena sammanfaller.

## Källa och modellprincip
Dödstalen efter basåret beräknas genom att multiplicera föregående års dödstal med `(1 - reduktion_procent/100)`. Mellan 2020 och 2025 respektive 2035 och 2040 anger originalen linjär interpolation av reduktionstalen. En komplett årsserie bör använda dokumenterade övergångsår och sedan omvandla dödstal till dödsrisk enligt historisk SCB-metod; beräknade värden märks `reconstructed_from_vintage`.

**Anmärkning om källtexten:** 2011 års fotnot nämner "startåret 2010" fast tabellrubriken avser 2012–2060. Detta är dokumenterat som en intern inkonsekvens i källan; 2011 års basvärde ersätts inte av en efterhandskorrigering.

Ursprungliga reduktionsvärden är textbaserat extraherade och strukturellt testade men **ännu inte radvis manuellt godkända**. Exporten `scb_mortality_reduction_2009_2011.csv` finns som konversationsfil; den har **inte** importerats till GitHub eller produktionsmodellen.
