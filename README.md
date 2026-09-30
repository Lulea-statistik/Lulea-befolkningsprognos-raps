# Luleå rAps-liknande befolkningsmodell

HTML-baserad demografisk prognosmodell för Luleå FA och kommunerna Luleå, Boden, Piteå, Älvsbyn och Kalix.

## Struktur

- `index.html` – webbgränssnitt.
- `css/style.css` – layout och tabellformat.
- `js/model.js` – kohortmodell, CKM-diagnostik och scenarioeffekter.
- `js/app.js` – UI, scenariotabeller, diagram och CSV-export.
- `data/model_data.js` – modellkonfiguration och plats för genererade data.
- `data/model_data_template.json` – schemaexempel.
- `data/SOURCES.md` – källförteckning.
- `docs/METHODOLOGY.md` – metodspecifikation.
- `scripts/scb_v2_client.py` – upptäcker aktuella SCB-tabeller via PxWebApi v2.
- `tests/test_model.js` – tester av kärnformler och scenariobalans.
- `.github/workflows/update-scb-data.yml` – månadsvis/manuell SCB-tabellupptäckt och tester.

## Modellprinciper

- Basår 2025, prognos normalt till 2050.
- `frukty`: nationell åldersprofil multiplicerad med lokal/FA-kalibreringsfaktor.
- `drisk`: nationell ålder/kön-profil multiplicerad med lokal/FA-kalibreringsfaktor.
- `urisk`: beräknas enligt `1-exp(-U/P)` för diagnostik/kalibrering; V1 använder exogen nettoflyttning.
- `qutb`: identitetsmatris, alltså ingen påverkan tills riktiga övergångar läggs in.
- `ifl` och endogena IMIG/UMIG utvecklas senare.
- Kalibreringsfönster 6, 10 (standard) och 19 år.
- SCB-serier till och med 2024 och CKM-serier från 2025 sys ihop, men metodbrottet flaggas och CKM-känslighet beräknas.

## Bostads- och arbetsplatsscenarier

Gränssnittet innehåller separata scenariotabeller för:

- bostadsbyggande: år, kommun, antal bostäder, färdigställandegrad, beläggning, personer per bostad, andel nya till FA, intern flyttning och infasning,
- arbetsplatsetableringar: år, kommun, planerade jobb, realiseringsgrad, andel som ger inflyttning, personer per inflyttat jobb, bosättningsandel i värdkommunen, intern flyttning och infasning.

Intern flyttning är konstruerad så att den summerar till noll för hela FA-regionen. Bostads- och jobbscenarier har dessutom ett justerbart överlappsavdrag för att minska risken att samma hushåll dubbelräknas.

Exempelraderna i UI är avstängda som standard och ska betraktas som scenarioantaganden, inte prognosvärden.

## GitHub Actions

Workflow `Update SCB data discovery` kan köras manuellt under **Actions** och körs även den första dagen varje månad. Den:

1. söker fram aktuella tabeller i SCB PxWebApi v2,
2. sparar tabellmetadata i `data/scb_discovery.json`,
3. kör modelltesterna,
4. committar endast om SCB-metadata har förändrats.

## Nästa steg

1. Kör workflowet första gången och kontrollera valda SCB-tabeller/dimensioner.
2. Lås värdekoder för de fem kommunerna, ålder, kön, år och innehåll.
3. Lägg till hämtning av själva statistikvärdena.
4. Bygg `model_data.json` automatiskt med 6/10/19-åriga kalibreringar.
5. Validera basscenariot mot SCB:s regionala befolkningsframskrivning.
6. Byt successivt ut förenklade scenariofördelningar mot observerade flytt- och pendlingsmatriser.
