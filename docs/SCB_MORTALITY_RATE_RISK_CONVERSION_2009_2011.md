# Historiskt trogen omvandling: dödstal till dödsrisk 2009–2011

Granskad 2026-10-21. SCB:s **2009 års originalrapport**, *Sveriges framtida befolkning 2009–2060*, avsnitt **Fakta om statistiken > Definitioner och förklaringar**, tryckt sidan 133, anger uttryckligen: dödstal = antal döda / medelfolkmängden och dödsrisk = antal döda / folkmängden i början av perioden (med migrationsjustering).

Om `m` är dödstalet **per 1 000**, konvertera till sannolikhet per person:
- Ålder **1 och äldre**: `q = 1 - exp(-m / 1000)`.
- Ålder **0**: `q0 = 1 - exp(-0.5*m / 1000)`.

För `q` **per 1 000** multiplicera uttrycket med 1000. Omvänd konvertering: `m = -1000*ln(1-q)` från andel, respektive `m0=-2000*ln(1-q0)` för ålder 0.

Den matematiska operationen baseras på **2009 års SCB-metod**, inte senare tabeller eller förhållanden. För 2010–2011 återfinns motsvarande konverteringstext i deras historiska metodavsnitt men formeln är grafiskt satt och saknas delvis i textuttaget. Åldrarna ska därför granskas visuellt innan fullständig metod-QA.

Den separata konversationsexporten `scb_mortality_conversion_2009_2011.csv` innehåller **642** härledda rader (214 per årgång) med fälten ursprunglig källa, kön, ursprunglig åldersetikett, ursprungligt dödstal, härledd dödsrisk, källa och `qa=derived_not_original`. Grundtalen kommer från de tidigare extraherade `mortality_base_*_candidate.csv` och är **enbart strukturellt verifierade** mot tabelllayout. Inga omräknade värden får ersätta historiskt publicerade bastal.

### Framåt
1. Genomför visuell cellkontroll mot PDF innan import som kvalitetsgodkända antaganden.
2. Extrahera originalens reduktionstabeller och identifiera rätt intervall samt teckenkonvention.
3. Rekonstruera dödstal årsvis **först**, och omvandla därefter åldersvis till dödsrisker. Tillåt inte dubbla transformationer.
4. Hantera 106 och 106+ enligt årgångens ursprungliga definition; tilldela inte ett numeriskt maxåldersantagande från senare år.
