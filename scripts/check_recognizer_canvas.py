"""Offline model acceptance on public human sketches rendered like the phone canvas.

Run with .local-services/drawzy-ai/.venv/Scripts/python.exe. No service secrets needed.
Only a bounded prefix of each public dataset file is downloaded and cached in app/reports.
"""
import importlib.util
import io
import json
from pathlib import Path
import os
import urllib.request
import numpy as np
from PIL import Image, ImageDraw
from drawzy_preprocess import prepare_sketch

os.environ.setdefault('TF_CPP_MIN_LOG_LEVEL','2')
from tensorflow.keras.models import load_model

root = Path(__file__).resolve().parents[1]
source = Path(os.environ.get('DRAWZY_SOURCE', root.parent/'.local-services/drawzy-ai'))
reports = root/'app/reports'
reports.mkdir(exist_ok=True)

def module(name, path):
    spec=importlib.util.spec_from_file_location(name,path)
    result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result)
    return result

legacy=module('legacy_sketch',source/'app/api/endpoints/guess/function.py').preprocess_image
labels=module('original_labels',source/'app/utils/constant/globals.py').WORDS_DIR
if len(labels)==45: labels=['aircraft carrier',*labels]
model=load_model(source/'app/core/model/model_75_v1.h5',compile=False)
old=[];new=[];targets=[];colors=[]
for label in ['apple','banana','airplane','bucket']:
    cache=reports/f'quickdraw-{label}.ndjson'
    if not cache.exists():
        request=urllib.request.Request(f'https://storage.googleapis.com/quickdraw_dataset/full/simplified/{label}.ndjson',headers={'Range':'bytes=0-65535'})
        with urllib.request.urlopen(request,timeout=30) as response: raw=response.read(65536)
        cache.write_bytes(raw[:raw.rfind(b'\n')+1])
    # Earlier exploration used samples 0:12. Acceptance uses different drawings, 12:24.
    samples=[json.loads(line) for line in cache.read_text().splitlines() if json.loads(line).get('recognized')][12:24]
    assert len(samples)==12, 'Public sample prefix is incomplete'
    for index,sample in enumerate(samples):
        for color in ['#000000','#2b6cff','#ffdf00']:
            image=Image.new('RGB',(800,600),'white');draw=ImageDraw.Draw(image)
            for stroke in sample['drawing']:
                points=[(int(x*1.5+180),int(y*1.5+100)) for x,y in zip(stroke[0],stroke[1])]
                if len(points)>1: draw.line(points,fill=color,width=4,joint='curve')
            if index==0 and color=='#000000': image.save(reports/f'canvas-{label}.png')
            stream=io.BytesIO();image.save(stream,'PNG');stream.seek(0)
            old.append(1-np.asarray(legacy(stream))/255.0)
            new.append(prepare_sketch(image));targets.append(labels.index(label));colors.append(color)
report={'uniqueDrawings':48,'categories':4,'renderings':len(new),'source':'Google QuickDraw recognized simplified drawings','results':{}}
for name,arrays in [('old',old),('canvas-ink-v3',new)]:
    predictions=model(np.asarray(arrays,dtype=np.float32)[...,None],training=False).numpy()
    report['results'][name]={}
    for color in sorted(set(colors)):
        indexes=[i for i,c in enumerate(colors) if c==color]
        report['results'][name][color]={'samples':len(indexes),'top1':sum(int(predictions[i].argmax()==targets[i]) for i in indexes),'meanConfidence':round(float(np.mean([predictions[i,targets[i]] for i in indexes])),4),'scoresAtMostOne':sum(int(round(float(predictions[i,targets[i]])*100)<=1) for i in indexes)}
for result in report['results']['canvas-ink-v3'].values():
    assert result['top1']>=36, 'Canvas recognition accuracy regressed on held-out samples'
    assert result['scoresAtMostOne']<=4, 'Thin strokes again produce near-zero scores'
(reports/'recognizer-canvas-acceptance.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2))
