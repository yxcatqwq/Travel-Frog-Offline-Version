"""Inspect centered, Y-up Picture coordinates against the source scenery."""
from pathlib import Path
from PIL import Image, ImageDraw
import generate_photo_composites as g
import random

def main():
    records = g.load_config()['Picture_json']
    index = g._index_images()
    sheet = Image.new('RGB', (1500, 4 * 380), 'white')
    draw = ImageDraw.Draw(sheet)
    for i, record in enumerate([r for r in records if r['type'] == 'Goal'][:12]):
        canvas = Image.new('RGBA', g.CANVAS)
        for name in record['backImage']:
            p = g._resolve_background(name, 'Goal', index, random.Random(0))
            if p:
                canvas.alpha_composite(Image.open(p).convert('RGBA'))
        for logical, suffix, pos in [(record['frogPose'] or record['frogPose_s'], 'qw', record['frogPos'] if record['frogPose'] else record['frogPos_s']), (record['travelerPose'][1], 'cw', record['travelerPos'][1])]:
            p = g._pose_group(logical, 'Goal', index).get(suffix)
            if p:
                im = Image.open(p).convert('RGBA')
                xy = (round(250 + pos['x'] - im.width / 2), round(175 - pos['y'] - im.height / 2))
                canvas.alpha_composite(im, xy)
        x, y = i % 3 * 500, i // 3 * 380
        sheet.paste(canvas, (x, y))
        draw.text((x + 10, y + 353), record['name'], fill='black')
    out = g.ROOT / 'alignment_review'
    out.mkdir(exist_ok=True)
    sheet.save(out / 'coordinate_preview.jpg')

if __name__ == '__main__':
    main()
