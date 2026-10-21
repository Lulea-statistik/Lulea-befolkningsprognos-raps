# PDF-till-CSV-kontroll: SCB:s historiska dödlighet 2009–2011

Datum: 2026-10-21. Kontrollen har körts mot de **uppladdade original-PDF-filerna**, inte mot nutida SCB-tal.

## Metod
Separat parser läser bas- och reduktionstabeller med PyMuPDF (PDF-text). Den hanterar PDF-tabellernas radlayout med en, två eller tre parallella ålderskolumner. Detta är viktigt: 2009 års sista två åldrar står ensamma i högerkolumn, och 2010–2011 har bara två parallella kolumner på delar av tabellen. Originaltextens decimalkomma/-punkt normaliseras numeriskt först **vid jämförelse**, inte som ändring av historiska råvärden.

- 2009 bastabell T.3, PDF-sida 172; reduktion T.4, PDF-sidor 173–174.
- 2010 bastabell 3, PDF-sida 24; reduktion tabell 4, PDF-sidor 25–26.
- 2011 bastabell 3, PDF-sida 24; reduktion tabell 4, PDF-sidor 25–26.

| Årgång | Basvärden mot original | Basavvikelser | Reduktioner mot original | Reduktionsavvikelser |
|---|---:|---:|---:|---:|
| 2009 | 214 | 0 | 642 | 0 |
| 2010 | 214 | 0 | 642 | 0 |
| 2011 | 214 | 0 | 642 | 0 |
| **Totalt** | **642** | **0** | **1 926** | **0** |

**QA-klass:** `source_pdf_text_compared`. Inte `independently_visually_verified`: parserjämförelsen grundas på PDF:ernas textlager, inte manuell synkontroll av varenda bildcell. Den verifierar källa kontra extraktionsfil, inte korrektheten i SCB:s egen prognosmodell.

De rekonstruerade årsserierna för 2009–2011 omfattar 32 742 rader. De har fortsatt egen status `derived_from_pdf_vintage` och blandas inte ihop med originaltabellvärdena. Före produktionsimport krävs separat kontroll av metodformler (särskilt nollåringar), årsskiftesdefinition, interpolation och öppna åldrar samt oberoende kontroll av minst kritiska celler i bild.
