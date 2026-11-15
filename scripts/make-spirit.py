"""Extract the approved A artwork and create transparent, gentle looping assets.
Usage: python scripts/make-spirit.py /path/to/approved-comparison.png
Only the approved left mascot is used; no redesign or hat.
"""
from pathlib import Path
from collections import deque
import sys, math
import numpy as np
from PIL import Image, ImageDraw
root=Path(__file__).resolve().parents[1]
source=Image.open(sys.argv[1]).convert('RGB').crop((60,155,745,810))
a=np.array(source).astype(float)
# Flood only background-colored regions connected to canvas edges. This
# preserves pale enclosed face/wing fills. Remove enclosed background gaps too.
bg=np.median(np.concatenate([a[0],a[-1],a[:,0],a[:,-1]],axis=0),axis=0)
d=np.sqrt(((a-bg)**2).sum(axis=2))
background=d<33
alpha=np.clip((d-12)/21,0,1)
# Near-white holes are also background; mint fills have substantially more chroma.
alpha[~background]=1
rgb=(a-(1-alpha[:,:,None])*bg)/np.maximum(alpha[:,:,None],.01)
rgba=np.dstack([np.clip(rgb,0,255),alpha*255]).astype('uint8')
cut=Image.fromarray(rgba,'RGBA')
# Keep the two floating star accents on separate layers for subtle twinkling.
stars=[]
for box in [(545,15,616,100),(615,64,673,120)]:
 layer=Image.new('RGBA',cut.size);layer.paste(cut.crop(box),box[:2]);stars.append(layer)
 ImageDraw.Draw(cut).rectangle((box[0],box[1],box[2]-1,box[3]-1),fill=(0,0,0,0))
size=256
scale=230/max(cut.size)
w,h=round(cut.width*scale),round(cut.height*scale)
body=cut.resize((w,h),Image.Resampling.LANCZOS)
starLayers=[x.resize((w,h),Image.Resampling.LANCZOS) for x in stars]
x=(size-w)//2;y=(size-h)//2
frames=[]
for n in range(48):
 phase=2*math.pi*n/48
 frame=Image.new('RGBA',(size,size))
 dy=round(2.5*math.sin(phase))
 frame.alpha_composite(body,(x,y+dy))
 for j,star in enumerate(starLayers):
  s=star.copy();opacity=.5+.5*(.5+.5*math.sin(phase+j*1.8))
  s.putalpha(s.getchannel('A').point(lambda v:int(v*opacity)))
  frame.alpha_composite(s,(x,y+dy))
 frames.append(frame)
assets=root/'assets';assets.mkdir(exist_ok=True)
frames[0].save(assets/'time-spirit-a.png',optimize=True)
frames[0].save(assets/'time-spirit-a.webp',save_all=True,append_images=frames[1:],duration=90,loop=0,quality=88,method=6,exact=True)
# GIF uses a reserved transparent palette entry; WebP is used in-app for soft edges.
gifs=[]
for frame in frames:
 rgb=frame.convert('RGB').quantize(colors=255,method=Image.Quantize.MEDIANCUT)
 pal=rgb.getpalette();rgb.putpalette(pal[:765]+[0,0,0])
 arr=np.array(rgb);arr[np.array(frame.getchannel('A'))<128]=255
 g=Image.fromarray(arr,'P');g.putpalette(rgb.getpalette());g.info['transparency']=255;gifs.append(g)
gifs[0].save(assets/'time-spirit-a.gif',save_all=True,append_images=gifs[1:],duration=90,loop=0,transparency=255,disposal=2,optimize=False)
for name in ['time-spirit-a.png','time-spirit-a.webp','time-spirit-a.gif']:
 p=assets/name;im=Image.open(p)
 print(name,im.size,'frames',getattr(im,'n_frames',1),'bytes',p.stat().st_size)
assert Image.open(assets/'time-spirit-a.webp').n_frames==48
gif=Image.open(assets/'time-spirit-a.gif')
assert gif.n_frames>1
# GIF encoder may merge identical adjacent frames; duration must be preserved.
from PIL import ImageSequence
assert sum(f.info.get('duration',0) for f in ImageSequence.Iterator(gif))==48*90
assert frames[0].getpixel((0,0))[3]==0
