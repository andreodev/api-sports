from pathlib import Path
import shutil
import subprocess
import sys

source = Path(sys.argv[1]).resolve()
target = Path(sys.argv[2]).resolve()
root = Path(__file__).resolve().parent.parent
if not target.is_relative_to((root / '.tmp').resolve()):
    raise SystemExit('Destino deve ser a cópia isolada')
def names(*args):
    data = subprocess.check_output(['git', '-C', str(source), *args, '-z'])
    return [Path(item.decode('utf-8')) for item in data.split(b'\0') if item]
paths = set(names('diff', '--name-only', 'HEAD')) | set(names('ls-files', '--others', '--exclude-standard'))
for path in sorted(paths):
    src, dst = source / path, target / path
    if not src.resolve().is_relative_to(source) or not dst.resolve().is_relative_to(target):
        raise SystemExit(f'Caminho fora da cópia: {path}')
    if path.name.startswith('.env') or path.suffix.lower() in {'.pem', '.key', '.p12', '.pfx'}:
        raise SystemExit(f'Arquivo sensível não copiado automaticamente: {path}')
    if src.is_file():
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        if src.read_bytes() != dst.read_bytes(): raise SystemExit(f'Verificação falhou: {path}')
    elif dst.is_file():
        dst.unlink()
    else:
        raise SystemExit(f'Alteração não suportada: {path}')
    print(path.as_posix())
