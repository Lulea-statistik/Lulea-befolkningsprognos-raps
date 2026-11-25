import io,json,re,urllib.request
from pathlib import Path
import openpyxl
url='https://tillvaxtverket.se/download/18.19d85e0e1961e0c5e2e1863d/1744356017266/FA25%20%282025%20%C3%A5rs%20indelning%20i%20FA-regioner%29.xlsx'
w=openpyxl.load_workbook(io.BytesIO(urllib.request.urlopen(url).read()),data_only=True)
# Detect header using explicit municipality and FA labels, never assume column order.
for sh in w:
 rows=list(sh.values)
 for i,row in enumerate(rows[:20]):
  labels=[str(x or '').lower() for x in row]
  mc=[j for j,x in enumerate(labels) if ('kommun' in x or 'kommunkod' in x) and ('kod' in x or 'nr' in x)]
  fc=[j for j,x in enumerate(labels) if 'fa' in x and ('kod' in x or 'nr' in x)]
  fn=[j for j,x in enumerate(labels) if 'fa' in x and ('namn' in x or 'benämning' in x)]
  if not(mc and fc and fn): continue
  groups={}; seen=set()
  for r in rows[i+1:]:
   m=str(r[mc[0]] or '').strip(); f=str(r[fc[0]] or '').strip(); name=str(r[fn[0]] or '').strip()
   if not re.fullmatch(r'\d{1,4}',m) or not re.fullmatch(r'\d{1,2}',f) or not name: continue
   m=m.zfill(4); f=f.zfill(2)
   if m in seen: raise ValueError('Duplicate municipality '+m)
   seen.add(m); g=groups.setdefault(f,dict(code=f,name=name,members=[])); g['members'].append(m)
  if len(seen)!=290 or len(groups)!=71: continue
  Path('data').mkdir(exist_ok=True);Path('data/fa25-housing.json').write_text(json.dumps(list(groups.values()),ensure_ascii=False),encoding='utf-8'); print('Validated 290 municipalities / 71 FA regions');raise SystemExit(0)
raise ValueError('Could not verify FA25 headers and 290/71 coverage; inspect official workbook')
