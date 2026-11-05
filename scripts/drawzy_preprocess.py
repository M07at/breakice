"""Convert the app's colored, thin strokes to the CNN's centered ink bitmap."""
import numpy as np
from PIL import Image, ImageFilter, ImageOps

PREPROCESSING_VERSION = 'canvas-ink-v3'


def prepare_sketch(image: Image.Image) -> np.ndarray:
    if image.width * image.height > 4_000_000:
        raise ValueError('IMAGE_TOO_LARGE')
    rgba = image.convert('RGBA')
    white = Image.new('RGBA', rgba.size, 'white')
    white.alpha_composite(rgba)
    # Minimum RGB detects yellow/cyan as well as dark ink. Luminance rejects bright pens.
    ink = 255 - np.asarray(white.convert('RGB')).min(axis=2)
    ink[ink < 24] = 0
    ys, xs = np.where(ink > 0)
    if not len(xs):
        raise ValueError('EMPTY_DRAWING')
    cropped = ImageOps.autocontrast(Image.fromarray(ink).crop((xs.min(), ys.min(), xs.max()+1, ys.max()+1)))
    # Preserve thin ink during downsampling; a 4px stroke on an 800px canvas otherwise vanishes.
    # Wider existing strokes need less expansion, avoiding an unconditional thickening filter.
    mask = np.asarray(cropped) > 24
    border = np.pad(mask.astype(np.int8), 1)
    perimeter = np.abs(np.diff(border, axis=0)).sum() + np.abs(np.diff(border, axis=1)).sum()
    stroke_width = 2 * mask.sum() / max(1, perimeter)
    scale = max(cropped.size) / 26
    expansion = max(1, int(1.4 * scale - stroke_width)) | 1
    if expansion > 1:
        cropped = cropped.filter(ImageFilter.MaxFilter(expansion))
    cropped.thumbnail((26, 26), Image.Resampling.LANCZOS)
    bitmap = Image.new('L', (28, 28), 0)
    bitmap.paste(cropped, ((28-cropped.width)//2, (28-cropped.height)//2))
    return np.asarray(bitmap, dtype=np.float32) / 255.0
