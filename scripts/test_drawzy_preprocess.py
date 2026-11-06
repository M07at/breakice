"""Run with the isolated model runtime's Python; no TensorFlow or network required."""
import unittest
import numpy as np
from PIL import Image, ImageDraw
from drawzy_preprocess import prepare_sketch


class SketchPreprocessingTest(unittest.TestCase):
    def drawing(self, color='black', mode='RGB'):
        im = Image.new(mode, (800,600), (255,255,255,0) if mode=='RGBA' else 'white')
        ImageDraw.Draw(im).ellipse((260,180,530,430), outline=color, width=4)
        return im

    def test_thin_strokes_remain_strong_at_model_resolution(self):
        bitmap = prepare_sketch(self.drawing())
        self.assertEqual(bitmap.shape, (28,28))
        self.assertEqual(bitmap.dtype, np.float32)
        self.assertGreater((bitmap>.5).sum(), 60)
        self.assertGreater(bitmap.max(), .9)

    def test_yellow_and_blue_ink_are_not_rejected_as_blank(self):
        black = prepare_sketch(self.drawing())
        for color in ['#ffdf00','#2b6cff','#00dddd']:
            result = prepare_sketch(self.drawing(color))
            self.assertLess(float(np.abs(black-result).mean()), .02)

    def test_transparency_is_composited_on_white(self):
        self.assertTrue(np.allclose(prepare_sketch(self.drawing()),prepare_sketch(self.drawing(mode='RGBA'))))
        with self.assertRaisesRegex(ValueError,'EMPTY_DRAWING'):
            prepare_sketch(Image.new('RGBA',(200,200),(0,0,0,0)))

    def test_blank_and_oversized_images_fail_explicitly(self):
        with self.assertRaisesRegex(ValueError,'EMPTY_DRAWING'):
            prepare_sketch(Image.new('RGB',(800,600),'white'))
        with self.assertRaisesRegex(ValueError,'IMAGE_TOO_LARGE'):
            prepare_sketch(Image.new('L',(2100,2000),255))

    def test_single_point_and_tall_drawing_do_not_resize_to_zero(self):
        im=Image.new('RGB',(800,600),'white')
        ImageDraw.Draw(im).line((400,50,400,550),fill='black',width=1)
        self.assertGreater(prepare_sketch(im).sum(),0)
        im=Image.new('RGB',(800,600),'white');im.putpixel((200,300),(0,0,0))
        self.assertGreater(prepare_sketch(im).sum(),0)


if __name__=='__main__': unittest.main()
