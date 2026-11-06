"""Authenticated adapter for the original Drawzy CNN; weights stay outside Git."""
import base64
import hmac
import importlib.util
import io
import os
from pathlib import Path

os.environ.setdefault('TF_CPP_MIN_LOG_LEVEL', '2')
import numpy as np
from fastapi import FastAPI, Header, HTTPException
from PIL import Image
from pydantic import BaseModel, Field
from tensorflow.keras.models import load_model
from drawzy_preprocess import prepare_sketch, PREPROCESSING_VERSION

source = Path(os.environ['DRAWZY_SOURCE']).resolve()
token = os.environ['DRAWZY_TOKEN']
if len(token) < 32:
    raise RuntimeError('DRAWZY_TOKEN must contain at least 32 characters')

def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result

labels = module('drawzy_labels', source / 'app/utils/constant/globals.py').WORDS_DIR
# Training sorts Google's bitmap files. Upstream omitted the first class in its labels.
# Official apple/banana/airplane/bucket samples confirm the resulting one-index shift.
if len(labels) == 45 and labels[0] == 'airplane':
    labels = ['aircraft carrier', *labels]
model = load_model(source / 'app/core/model/model_75_v1.h5', compile=False)
if model.output_shape[-1] != len(labels):
    raise RuntimeError('Original model and corrected class labels do not match')
model(np.zeros((1, 28, 28, 1), dtype=np.float32), training=False)  # Warm before accepting traffic.
app = FastAPI()

class Sketch(BaseModel):
    sketch_data: str = Field(max_length=1500000)

@app.get('/health')
def health():
    return {'status': 'ready', 'model': 'drawzy-original-cnn', 'classes': len(labels), 'outputs': model.output_shape[-1], 'preprocessing_version': PREPROCESSING_VERSION}

@app.post('/predict/sketch')
def predict(body: Sketch, authorization: str = Header(default='')):
    if not hmac.compare_digest(authorization, 'Bearer ' + token):
        raise HTTPException(401, 'UNAUTHORIZED')
    try:
        data = base64.b64decode(body.sketch_data, validate=True)
        with Image.open(io.BytesIO(data)) as image:
            array = prepare_sketch(image)[None, :, :, None]
        probabilities = model(array, training=False).numpy()[0]
        top = np.argsort(probabilities)[-5:][::-1]
        return {'status': 'success', 'data': {
            'sketch_class_name': labels[int(top[0])],
            'top_five_sketch_classes': [labels[int(index)] for index in top],
            'class_probabilities': {label: float(probabilities[index]) for index, label in enumerate(labels)},
            'preprocessing_version': PREPROCESSING_VERSION,
        }}
    except (ValueError, OSError) as error:
        raise HTTPException(422, str(error)) from error
