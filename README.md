# Luleå rAps-liknande befolkningsmodell – V1

Första implementeringsmilstolpen för en HTML-baserad demografisk modell för Luleå FA och kommunerna Luleå, Boden, Piteå, Älvsbyn och Kalix.

## V1-principer

- Basår 2025, prognos normalt till 2050.
- `frukty`: nationell åldersprofil multiplicerad med lokal/FA-kalibreringsfaktor.
- `drisk`: nationell ålder/kön-profil multiplicerad med lokal/FA-kalibreringsfaktor.
- `urisk`: beräknas enligt rAps-formen `1-exp(-U/P)` för diagnostik/kalibrering; V1 använder exogen nettoflyttning i prognosen.
- `qutb`: identitetsmatris, alltså ingen påverkan tills riktiga övergångar läggs in.
- `ifl` och endogena IMIG/UMIG skjuts till senare version.
- Kalibreringsfönster 6, 10 (standard) och 19 år.
- SCB-serier till och med 2024 och CKM-serier från 2025 sys ihop, men 2025+ flaggas och CKM-känslighet beräknas.

## Filer

- `index.html` – lokal HTML-app.
- `js/model.js` – beräkningsmotor och CKM-diagnostik.
- `js/app.js` – UI, SVG-diagram och CSV-export.
- `data/model_data.js` – schema/konfiguration; innehåller ännu inte officiella numeriska data.
- `scripts/scb_v2_client.py` – upptäcker aktuella SCB-tabeller via PxWebApi v2 och sparar metadata.
- `tests/test_model.js` – enkla enhetstester för kärnformler.

## Nästa steg

1. Kör tabellupptäckten mot SCB på en dator med internet.
2. Lås dimension- och värdekoder från metadata.
3. Hämta historiska + CKM-data och transformera till `model_data.json`.
4. Beräkna 6/10/19-åriga parameterprofiler och CKM-diagnostik.
5. Validera prognosen mot SCB:s regionala framskrivning.

HTML-filen kan öppnas lokalt. När en färdig `model_data.json` finns kan den läsas in via filväljaren i gränssnittet utan webbserver.
