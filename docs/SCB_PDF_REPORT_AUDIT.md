# PDF-granskning av SCB:s historiska prognosantaganden (2026-10-21)

Inventering av de **11 unika** rapporter som användaren lämnat (2016-rapporten förekommer två gånger).

## Resultat

| Rapportår | Publiceringsdatum | Granskningsstatus | Relevans |
|---|---|---|---|
| 2003 | Ej verifierat | PDF kunde inte öppnas | Behöver kontroll av åldersvisa fertilitets- och dödsriskantaganden |
| 2004 | Ej verifierat | PDF kunde inte öppnas | Samma |
| 2007 | Ej verifierat | PDF kunde inte öppnas | Samma |
| 2008 | Ej verifierat | PDF kunde inte öppnas | Samma |
| 2010 | Ej verifierat | PDF kunde inte öppnas | Samma |
| 2011 | Ej verifierat | PDF kunde inte öppnas | Samma |
| 2013 | Ej verifierat | Original-PDF kunde inte öppnas; separat SCB-dokumentation beskriver ettårsåldrar | Antaganden sannolikt användbara efter verifiering |
| 2014 | 2014-04-15 | Tidigare granskning; PDF-tabeller 2–4b | Fertilitet samt dödstal och reduktion, avrundat |
| 2015 | **2015-05-19** | PDF-text läst, SCB:s publikationssida bekräftar datum | Grundlig antagande- och metodrapport, maskinläsbara åldersdata föredras |
| 2016 | **2016-04-13** | PDF-text läst, utgivningsdatum på första sidan | Reviderad prognos med fertilitets-/dödlighetsantaganden |
| 2017 | **2017-04-12** | PDF-text läst, utgivningsdatum på första sidan | Reviderad prognos med fertilitets-/dödlighetsantaganden |

**Ingen ny årgång klassas som komplett maskininläst** utifrån denna PDF-kontroll. För 2003/2004/2007/2008/2010/2011/2013 är antagandenas existens, tabellnummer och exakt datum inte belagda av original-PDF i denna körning.

## Data som krävs för modellmotorn
- Fruktsamhet: ettårsåldrar efter moderns ålder och prognosår; ange enhet och födelseregionsgrupper.
- Dödlighet: ettårsåldrar efter kön och prognosår; om endast basdödstal och årlig reduktion finns behövs dokumenterad rekonstruktion.
- Basår, prognosperiod, huvudalternativ, metodbrott och ursprungligt publiceringsdatum.
- PDF-tabeller kan vara avrundade och täcka urvalsår; använd SCB:s ursprungliga årsserier om möjligt.
- Före varje historiskt backtest ska utgivningsdatum kontrolleras mot prognosstarten; senare revisioner får inte användas utan flagga.

## Verifierade källor
- SCB 2015, publikation: https://www.scb.se/hitta-statistik/statistik-efter-amne/befolkning-och-levnadsforhallanden/befolkningens-sammansattning-och-utveckling/befolkningsframskrivningar/pong/publikationer/sveriges-framtida-befolkning-20152060/ 
- SCB 2016, PDF: https://www.scb.se/contentassets/776c88485b1d4d34bf33c36a1bde4565/be0401_2016i60_sm_be18sm1601.pdf
- SCB 2017, PDF: https://www.scb.se/contentassets/fee6de8eb7dc43bd9b3f36da925b5458/be0401_2017i60_sm_be18sm1701.pdf

Detaljer per fil och länk finns i `data/backtests/scb_pdf_report_audit.csv`. Vidare kontroll av äldre original kräver fungerande PDF-filer eller SCB:s återpublicerade adresser.
