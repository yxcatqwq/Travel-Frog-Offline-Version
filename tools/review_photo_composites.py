"""Create labeled contact sheets for visual review of generated photographs."""
import argparse
import json
from pathlib import Path
from PIL import Image, ImageDraw

def review(source: Path, destination: Path):
    rows = [json.loads(line) for line in (source / 'manifest.jsonl').read_text(encoding='utf-8').splitlines()]
    selected = {}
    for row in rows:
        key = row['category'], row['id']
        if key not in selected or row['traveler_suffix'] == 'cw':
            selected[key] = row
    destination.mkdir(parents=True, exist_ok=True)
    for category in ('Goal', 'Unique', 'Normal', 'Tools'):
        entries = [r for r in selected.values() if r['category'] == category]
        for start in range(0, len(entries), 24):
            batch = entries[start:start + 24]
            sheet = Image.new('RGB', (1000, ((len(batch) + 3) // 4) * 195), 'white')
            draw = ImageDraw.Draw(sheet)
            for i, row in enumerate(batch):
                im = Image.open(source / row['file'])
                im = im.resize((250, 175), Image.Resampling.LANCZOS)
                x, y = i % 4 * 250, i // 4 * 195
                sheet.paste(im, (x, y))
                draw.text((x+3, y+176), str(row['id']) + ' ' + row['name'], fill='black')
            sheet.save(destination / f'{category}_{start // 24 + 1}.jpg')

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('source', type=Path)
    parser.add_argument('destination', type=Path)
    args = parser.parse_args()
    review(args.source, args.destination)
