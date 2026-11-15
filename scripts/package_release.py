"""Build deterministic source archives and audit both artifacts before upload."""
from pathlib import Path, PurePosixPath
from datetime import datetime, timezone
import base64, hashlib, json, os, subprocess, sys, tarfile, tempfile, zipfile
root=Path(__file__).resolve().parents[1]
release=root/'release';release.mkdir(exist_ok=True)
manifest=json.loads((root/'package.json').read_text());version=manifest['version'];package=manifest['name']
assert package=='dsh-time-desk'
node=sys.argv[1] if len(sys.argv)>1 else 'node'
archive=release/f'{package}-{version}.tgz'
if not archive.is_file():raise SystemExit('Run npm pack --pack-destination release first')
allowed=['src','assets','scripts','test','dist','locale','.github','changes','market','.gitignore','.gitattributes','package.json','package-lock.json','tsconfig.json','cordis.patch.yml','icon.svg','README.md','RELEASE.md','PRIVACY.md','PUBLISHING.md','LICENSE','THIRD_PARTY_NOTICES.md']
try:
 tracked=subprocess.check_output(['git','ls-files','-z','--',*allowed],cwd=root,stderr=subprocess.DEVNULL).decode().split('\0')
 files=[root/n for n in tracked if n]
 epoch=int(subprocess.check_output(['git','show','-s','--format=%ct','HEAD'],cwd=root).decode().strip())
except subprocess.CalledProcessError:
 files=[]
 for name in allowed:
  p=root/name
  if p.is_dir():files.extend(x for x in p.rglob('*') if x.is_file() or x.is_symlink())
  elif p.exists():files.append(p)
 epoch=int(os.environ.get('SOURCE_DATE_EPOCH','315532800'))
if not files:raise SystemExit('No reviewed source files selected')
files=sorted(set(files),key=lambda p:p.relative_to(root).as_posix())
for p in files:
 if p.is_symlink() or not p.is_file() or not p.resolve().is_relative_to(root):raise SystemExit('Unexpected source path: '+p.relative_to(root).as_posix())
entries=[]
with tarfile.open(archive,'r:gz') as tar:
 members=tar.getmembers();seen=set()
 for member in members:
  name=PurePosixPath(member.name)
  if not member.isfile() or name.parts[0]!='package' or '..' in name.parts or name.is_absolute() or member.name in seen or member.size>16*1024*1024:raise SystemExit('Unexpected package member: '+member.name)
  seen.add(member.name);entries.append({'name':member.name,'base64':base64.b64encode(tar.extractfile(member).read()).decode()})
 required=['package/dist/index.js','package/dist/client.js','package/icon.svg','package/package.json','package/PRIVACY.md','package/cordis.patch.yml','package/THIRD_PARTY_NOTICES.md']
 assert all(x in seen for x in required)
 packed=json.loads(tar.extractfile('package/package.json').read());assert packed['name']==package and packed['version']==version
 with tempfile.TemporaryDirectory(prefix='time-desk-verify-',dir=release) as tmp:
  temp=Path(tmp).resolve();assert temp.parent==release.resolve() and temp.name.startswith('time-desk-verify-')
  tar.extractall(temp,filter='data')
  subprocess.run([node,'--input-type=module','-e',"const m=await import('./package/dist/index.js');if(typeof m.apply!=='function')throw Error('Missing Host apply');console.log('Isolated Host bundle import passed');"],cwd=temp,check=True)
  assert temp.parent==release.resolve()
# Audit complete source bytes and archive bytes, not only git's index.
for p in files:entries.append({'name':package+'/'+p.relative_to(root).as_posix(),'base64':base64.b64encode(p.read_bytes()).decode()})
subprocess.run([node,'scripts/privacy.mjs','--entries-stdin'],cwd=root,input=json.dumps(entries).encode(),check=True)
zip_path=release/f'{package}-{version}-source.zip'
timestamp=datetime.fromtimestamp(max(315532800,min(epoch,4354819198)),timezone.utc).timetuple()[:6]
with zipfile.ZipFile(zip_path,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for p in files:
  info=zipfile.ZipInfo(package+'/'+p.relative_to(root).as_posix(),timestamp);info.create_system=3;info.external_attr=(0o100644<<16);info.compress_type=zipfile.ZIP_DEFLATED
  z.writestr(info,p.read_bytes(),compress_type=zipfile.ZIP_DEFLATED,compresslevel=9)
checks=''.join(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+p.name+'\n' for p in [archive,zip_path])
(release/'SHA256SUMS.txt').write_text(checks,encoding='utf8',newline='\n')
print(json.dumps({'version':version,'packageFiles':len(members),'sourceFiles':len(files),'deterministicEpoch':epoch,'tarball':archive.name,'sourceZip':zip_path.name}))
