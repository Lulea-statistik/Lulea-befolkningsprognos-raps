# Paritet och åldersvisa dödsrisker – extraktion 2003, 2007, 2008

Datum: 2026-10-21.

## Datamodell
- `paritet`: valfri dimension, antal tidigare födda barn när det finns i originalrapportens uppdelning.
- **Tomt paritetvärde** betyder **inte redovisat**, absolut inte noll barn.
- `paritet_status`: `redovisad` eller `ej redovisad`.
- Undvik att slå samman paritetsspecifika faktorer och total åldersfruktsamhet utan att först känna till basfördelningen.

## Extraherade värden
- 2003: tabell 9.3, tryckt sida 122, 214 kön-ålder-dödsriskvärden. Tabell 9.4, tryckt sida 123–124, 372 reduktionsvärden per kön, åldersklass och period.
- 2007: tabell 8, tryckt sida 26, 214 kön-ålder-dödsriskvärden. Tabell 9, tryckt sida 27, 372 reduktionsvärden.
- 2008: 18 paritets- och åldersgruppsspecifika fertilitetsförändringsfaktorer relativt 2007, enligt 2008 års rapport. Dessa är inte en direkt fullständig fertilitetsprofil.
- 2003 och 2007 fertilitetsprofiler saknar paritetsuppdelning i motsvarande extraktion.

## QA
Samtliga 214 respektive 372 rader per årgång är unika i (kön, ålder, period) och saknar tomma numeriska fält. Detta är en **strukturell kontroll**, inte en fullständig visuell tabellvalidering. Dödsriskvärden anges per 1 000, årliga reduktionstal i procent med tecken. Tryckta källperioder skiljer sig och mellanliggande övergångsår måste beräknas efter SCB:s text; etiketten tidig/mellan/sen är inte tillräcklig för en färdig år-för-år-modell.

Filer finns i konversationens ZIP-export `scb_2003_2007_2008_extraction_updated.zip`; de är ännu **inte införda som modellerade historiska antaganden** i produktionsrepon. Godkänn först radvis/visuellt QA av källtabeller och periodinterpolering.
