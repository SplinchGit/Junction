"""Rebuild Nethra's code-native logo exports. Requires Pillow."""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'apps/windows/assets'
RES = ROOT / 'apps/android/src/main/res'
NAVY, TEAL, WHITE = '#10272D', '#65E5D5', '#F7FAFC'
EYE = 'M18 50 C35 29 65 29 82 50 C65 71 35 71 18 50 Z'
IRIS = 'M50 41 A9 9 0 1 1 50 59 A9 9 0 1 1 50 41'
PUPIL = 'M50 47 A3 3 0 1 1 50 53 A3 3 0 1 1 50 47'

def save(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding='utf-8')

def artwork(size, mask='rounded', themed=False):
    scale = 8
    image = Image.new('RGBA', (size*scale, size*scale))
    draw = ImageDraw.Draw(image)
    s = size*scale/100
    box = (0, 0, size*scale-1, size*scale-1)
    bg = '#D8E8E3' if themed else NAVY
    if mask == 'circle':
        draw.ellipse(box, fill=bg)
    else:
        draw.rounded_rectangle(box, radius=22*s, fill=bg)
    top=[]; bottom=[]
    for step in range(101):
        t=step/100; u=1-t
        top.append((u**3*18+3*u*u*t*35+3*u*t*t*65+t**3*82,
                    u**3*50+3*u*u*t*29+3*u*t*t*29+t**3*50))
        bottom.append((u**3*82+3*u*u*t*65+3*u*t*t*35+t**3*18,
                       u**3*50+3*u*u*t*71+3*u*t*t*71+t**3*50))
    draw.line([(x*s,y*s) for x,y in top+bottom],fill=NAVY if themed else TEAL,width=round(5*s),joint='curve')
    draw.ellipse((41*s,41*s,59*s,59*s),fill=NAVY if themed else WHITE)
    draw.ellipse((47*s,47*s,53*s,53*s),fill=TEAL if themed else NAVY)
    return image.resize((size,size), Image.Resampling.LANCZOS)

ASSETS.mkdir(parents=True, exist_ok=True)
save(ASSETS/'junction.svg', f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <title>Nethra eye</title>
  <rect width="100" height="100" rx="22" fill="{NAVY}"/>
  <path d="{EYE}" fill="none" stroke="{TEAL}" stroke-width="5" stroke-linejoin="round"/>
  <circle cx="50" cy="50" r="9" fill="{WHITE}"/>
  <circle cx="50" cy="50" r="3" fill="{NAVY}"/>
</svg>
''')
artwork(512).save(ASSETS/'junction.png')
artwork(256).save(ASSETS/'junction.ico', sizes=[(s,s) for s in (16,20,24,32,40,48,64,128,256)])
for density,size in [('mdpi',48),('hdpi',72),('xhdpi',96),('xxhdpi',144),('xxxhdpi',192)]:
    folder=RES/f'mipmap-{density}'; folder.mkdir(parents=True,exist_ok=True)
    artwork(size).save(folder/'ic_launcher.png')
    artwork(size,'circle').save(folder/'ic_launcher_round.png')

def vector(monochrome=False, notification=False):
    size=24 if notification else 108
    transform='android:scaleX="0.24" android:scaleY="0.24"' if notification else 'android:scaleX="0.8" android:scaleY="0.8" android:translateX="14" android:translateY="14"'
    return f'''<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="{size}dp" android:height="{size}dp" android:viewportWidth="{size}" android:viewportHeight="{size}">
    <group {transform}>
        <path android:pathData="{EYE}" android:fillColor="@android:color/transparent" android:strokeColor="{WHITE if monochrome else TEAL}" android:strokeWidth="5" android:strokeLineJoin="round" />
        <path android:pathData="{IRIS}" android:fillColor="{WHITE}" />
        <path android:pathData="{PUPIL}" android:fillColor="{NAVY}" />
    </group>
</vector>
'''
save(RES/'drawable/ic_launcher_foreground.xml', vector())
save(RES/'drawable/ic_launcher_monochrome.xml', vector(True))
save(RES/'drawable/ic_junction.xml', vector(True, True))
save(RES/'values/icon_colors.xml', f'<resources>\n    <color name="ic_launcher_background">{NAVY}</color>\n</resources>\n')
for version in [26,33]:
    mono='\n    <monochrome android:drawable="@drawable/ic_launcher_monochrome" />' if version==33 else ''
    xml=f'''<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />{mono}
</adaptive-icon>
'''
    for name in ['ic_launcher','ic_launcher_round']:
        save(RES/f'mipmap-anydpi-v{version}/{name}.xml',xml)

# Contact sheet includes native tiny sizes and common launcher masks.
sheet=Image.new('RGB',(700,260),'#E9EDF2'); d=ImageDraw.Draw(sheet)
x=24
for size in [16,24,32,48,64,128]:
    sheet.paste(artwork(size),(x,40),artwork(size)); d.text((x,190),str(size),fill=NAVY); x+=size+22
for i,(mask,themed,label) in enumerate([('rounded',False,'Rounded'),('circle',False,'Circle'),('circle',True,'Themed')]):
    icon=artwork(64,mask,themed); sheet.paste(icon,(470+i*76,40),icon); d.text((470+i*76,120),label,fill=NAVY)
save(ASSETS/'README.md', '''# Nethra icon assets

An open eye represents Nethra's attentive local agent, with a teal outline and ivory iris.
`junction.svg` is the vector artwork; `junction.png` is the 512 px export; `junction.ico`
contains 16, 20, 24, 32, 40, 48, 64, 128 and 256 px Windows images.

Regenerate all exports and Android launcher resources with
`python scripts/generate-junction-icons.py` (Pillow required).
Android adaptive foregrounds are inset inside the 66 dp safe zone; API 33 adds the
monochrome themed layer. Legacy launchers have density-specific PNGs.
`ic_junction` remains a transparent white notification mark.

Windows packaging embeds the ICO in Junction.exe and includes these assets for
BrowserWindow. The desktop shortcut uses Junction.exe,0.
''')
sheet.save(ASSETS/'icon-preview.png')
print('Generated Windows and Android Nethra icons')
