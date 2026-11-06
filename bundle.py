"""Create two portable HTML files, including Three.js and all textures."""
from pathlib import Path
import base64
import json
import re

ROOT=Path(__file__).parent
def uri(path,mime):
    return 'data:'+mime+';base64,'+base64.b64encode(path.read_bytes()).decode()
core=uri(ROOT/'vendor/three.core.min.js','text/javascript')
module=(ROOT/'vendor/three.module.min.js').read_text().replace('"./three.core.min.js"','"three-core"')
module_uri='data:text/javascript;base64,'+base64.b64encode(module.encode()).decode()
imports='<script type="importmap">'+json.dumps({'imports':{'three-core':core}},separators=(',',':'))+'</script>'
engine=(ROOT/'animation.js').read_text()
engine=re.sub(r'^import .*?;\n','',engine,flags=re.M)
engine=engine.replace('export class OrigamiBoard','class OrigamiBoard').replace('export {descriptions};','')
for filename in ['board.png','labels.png']:
    engine=engine.replace("new URL('./"+filename+"',import.meta.url).href",json.dumps(uri(ROOT/filename,'image/png')))
data=(ROOT/'board-data.js').read_text().replace('export const boardData =','const data =')
bootstrap='import * as THREE from '+json.dumps(module_uri)+';\n'+data+'\n'+engine
viewer=(ROOT/'viewer.js').read_text()
viewer=re.sub(r'^import .*?;\n','',viewer,flags=re.M)
css=(ROOT/'styles.css').read_text()
css=re.sub(r"@import url\(.*?\);",'',css)
page=(ROOT/'index.html').read_text()
page=page.replace('<link rel="stylesheet" href="./styles.css">','<style>'+css+'</style>')
page=page.replace('href="./index.html"','href="./unfold.html"').replace('href="./overlay.html"','href="./origami-overlay.html"')
page=page.replace('<script type="module" src="./viewer.js"></script>',imports+'<script type="module">\n'+bootstrap+'\n'+viewer+'\n</script>')
(ROOT/'unfold.html').write_text(page)
overlay=(ROOT/'overlay.html').read_text()
overlay=overlay.replace('<script type="module">',imports+'<script type="module">\n'+bootstrap+'\n')
overlay=overlay.replace("import {OrigamiBoard} from './animation.js';",'')
(ROOT/'origami-overlay.html').write_text(overlay)
print(json.dumps({p.name:p.stat().st_size for p in [ROOT/'unfold.html',ROOT/'origami-overlay.html']}))
