"""Render a public recognized human sketch using the mini-program's canvas dimensions/pen."""
import json
import re
import sys
import urllib.request
from pathlib import Path
from PIL import Image, ImageDraw

label=sys.argv[1]
if not re.fullmatch('[a-z ]+',label): raise ValueError('Invalid public category')
root=Path(__file__).resolve().parents[1]
cache=root/'app/reports'/f'quickdraw-{label}.ndjson'
if not cache.exists():
    request=urllib.request.Request('https://storage.googleapis.com/quickdraw_dataset/full/simplified/'+urllib.parse.quote(label)+'.ndjson',headers={'Range':'bytes=0-65535'})
    with urllib.request.urlopen(request,timeout=30) as response: raw=response.read(65536)
    cache.write_bytes(raw[:raw.rfind(b'\n')+1])
samples=[json.loads(line) for line in cache.read_text().splitlines() if json.loads(line).get('recognized')]
sample=samples[min(12,len(samples)-1)]
image=Image.new('RGB',(800,600),'white');draw=ImageDraw.Draw(image)
for stroke in sample['drawing']:
    points=[(int(x*1.5+180),int(y*1.5+100)) for x,y in zip(stroke[0],stroke[1])]
    if len(points)>1: draw.line(points,fill='black',width=4,joint='curve')
image.save(sys.argv[2])
