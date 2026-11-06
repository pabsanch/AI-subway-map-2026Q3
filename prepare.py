"""Extract the supplied board into transparent artwork and real hinged pieces."""
from pathlib import Path
from argparse import ArgumentParser
import json
import io
import math
import fitz
from PIL import Image, ImageDraw

ROOT = Path(__file__).parent
parser = ArgumentParser(description=__doc__)
parser.add_argument('source_pdf', type=Path, help='Path to the original AI & Design subway map PDF.')
SOURCE = parser.parse_args().source_pdf.expanduser().resolve()
if not SOURCE.is_file():
    parser.error('The source PDF does not exist.')
doc = fitz.open(SOURCE)
page = doc[0]
W, H = page.rect.width, page.rect.height
drawings = page.get_drawings()
palette = [(0.767, .615, .781), (.690, .675, .784), (.957, .856, .578),
           (.892, .801, .776), (.694, .875, .886), (.587, .822, .634),
           (.638, .873, 1), (.878, .949, .984), (.824, .824, .824),
           (.192, .098, .290)]
pieces = []
for drawing in drawings[1:]:
    fill = drawing.get('fill')
    if not fill or not any(max(abs(a-b) for a,b in zip(fill,p)) < .006 for p in palette):
        continue
    items = drawing['items']
    if not items or any(item[0] != 'l' for item in items):
        continue
    points = [[round(item[1].x, 3), round(item[1].y, 3)] for item in items]
    if len(points) > 1 and math.dist(points[0], points[-1]) < .1:
        points.pop()
    area = abs(sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(points, points[1:]+points[:1]))) / 2
    if not 3 <= len(points) <= 6 or area < 6500:
        continue
    pieces.append({'kind':'tile', 'points':points, 'color':[round(c,4) for c in fill]})

for block in page.get_text('dict')['blocks']:
    if block['type'] != 1:
        continue
    x0, y0, x1, y1 = block['bbox']
    if y0 > 2800 and x1 < 1100:
        continue  # TRUIST artwork is a separate image block, not a resource.
    if x1-x0 < 20 or y1-y0 < 20:
        continue
    pieces.append({'kind':'card', 'points':[[x0,y0],[x1,y0],[x1,y1],[x0,y1]], 'color':[.95,.94,.97]})

# Remove only the PDF's explicit page-sized white rectangle. Whites inside covers survive.
xref = page.get_contents()[0]
stream = doc.xref_stream(xref)
start = stream.index(b'\nq\n')
end = stream.index(b'\nQ\n', start) + len(b'\nQ\n')
assert b'5749.000000 3259.000000 l' in stream[start:end]
doc.update_stream(xref, stream[:start]+b'\n'+stream[end:])
pix = page.get_pixmap(matrix=fitz.Matrix(4096/W,4096/W), alpha=True)
image = Image.open(io.BytesIO(pix.tobytes('png'))).convert('RGBA')
# Omit the TRUIST wordmark and emblem from the animation artwork.
ImageDraw.Draw(image).rectangle(
    (int(100*image.width/W),int(2820*image.height/H),int(1050*image.width/W),int(3220*image.height/H)),
    fill=(0,0,0,0)
)
image.save(ROOT / 'board.png', optimize=True)
residual = image.copy()
erase = ImageDraw.Draw(residual)
for piece in pieces:
    erase.polygon([(p[0]*image.width/W,p[1]*image.height/H) for p in piece['points']], fill=(0,0,0,0))
residual.save(ROOT / 'labels.png', optimize=True)

# Skip completely transparent cells in the remaining lettering/leader-line layer.
cells = []
cols, rows = 30, 17
for row in range(rows):
    for col in range(cols):
        x0,y0,x1,y1 = col*W/cols,row*H/rows,(col+1)*W/cols,(row+1)*H/rows
        crop = residual.crop((int(x0*image.width/W),int(y0*image.height/H),math.ceil(x1*image.width/W),math.ceil(y1*image.height/H)))
        if crop.getchannel('A').getbbox():
            cells.append([round(x0,3),round(y0,3),round(x1,3),round(y1,3)])

data = {'width':W,'height':H,'epicenter':[2565,1490],'pieces':pieces,'labelCells':cells}
(ROOT/'board-data.js').write_text('export const boardData = '+json.dumps(data,separators=(',',':'))+';\n')
print(json.dumps({'tiles':sum(p['kind']=='tile' for p in pieces),'cards':sum(p['kind']=='card' for p in pieces),'labelCells':len(cells),'texture':[image.width,image.height],'blankPixelAlpha':image.getpixel((2,2))[3]}))
