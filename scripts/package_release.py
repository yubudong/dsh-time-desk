"""Create a source+prebuilt zip and verify the npm tarball without user data."""
from pathlib import Path
import hashlib, json, shutil, subprocess, sys, tarfile, tempfile, zipfile
root = Path(__file__).resolve().parents[1]
release = root / 'release'
release.mkdir(exist_ok=True)
manifest = json.loads((root / 'package.json').read_text())
version = manifest['version']
archive = release / f'dsh-time-desk-{version}.tgz'
if not archive.is_file():
    raise SystemExit('Run npm pack --pack-destination release first')
allowed = ['src', 'assets', 'scripts/build.mjs', 'scripts/notices.mjs', 'scripts/verify-installed-runtime.mjs', 'scripts/package_release.py', 'scripts/make-spirit.py', 'scripts/privacy.mjs', 'scripts/market-index.mjs', 'test', 'dist', 'locale', '.github', '.gitignore', 'package.json', 'package-lock.json', 'tsconfig.json', 'cordis.patch.yml', 'icon.svg', 'README.md', 'RELEASE.md', 'PRIVACY.md', 'PUBLISHING.md', '.gitattributes', 'market', 'LICENSE', 'THIRD_PARTY_NOTICES.md']
zip_path = release / f'dsh-time-desk-{version}-source.zip'
files = []
for name in allowed:
    path = root / name
    files.extend(sorted(p for p in path.rglob('*') if p.is_file()) if path.is_dir() else [path])
for p in files:
    if p.is_symlink() or not p.resolve().is_relative_to(root):
        raise SystemExit(f'Unexpected path: {p}')
with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as z:
    for p in files:
        z.write(p, 'dsh-time-desk/' + p.relative_to(root).as_posix())
with tarfile.open(archive, 'r:gz') as tar:
    members = tar.getmembers()
    for member in members:
        name = Path(member.name)
        if not member.isfile() or name.parts[0] != 'package' or '..' in name.parts or name.is_absolute():
            raise SystemExit('Unexpected package member: ' + member.name)
    paths = {m.name for m in members}
    for required in ['package/dist/index.js','package/dist/client.js','package/icon.svg','package/locale/zh.json','package/locale/en.json','package/cordis.patch.yml','package/THIRD_PARTY_NOTICES.md']:
        assert required in paths, required
    assert not any('/node_modules/' in p or p.endswith('.env') for p in paths)
    for member in members:
        content = tar.extractfile(member).read()
        for forbidden in [b'/Users/', b'api_key=', b'apiKey: "sk-']:
            assert forbidden not in content, member.name
    with tempfile.TemporaryDirectory(prefix='life-desk-verify-', dir=release) as tmp:
        temp = Path(tmp).resolve()
        assert temp.parent == release.resolve() and temp.name.startswith('life-desk-verify-')
        tar.extractall(temp, filter='data')
        node = sys.argv[1] if len(sys.argv)>1 else 'node'
        subprocess.run([node, '--input-type=module', '-e', "const m=await import('./package/dist/index.js');if(typeof m.apply!=='function')throw Error('Missing Host apply');console.log('Isolated Host bundle import passed');"], cwd=temp, check=True)
        assert temp.parent == release.resolve()  # Verified owned target before context cleanup.
checks = '\n'.join(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+p.name for p in [archive,zip_path])+'\n'
(release/'SHA256SUMS.txt').write_text(checks)
print(json.dumps({'version':version,'packageFiles':len(members),'sourceFiles':len(files),'tarball':str(archive),'sourceZip':str(zip_path)},ensure_ascii=False,indent=2))
