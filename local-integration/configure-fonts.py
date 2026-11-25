from pathlib import Path
import shutil

root = Path(__file__).resolve().parent.parent
frontend = (root / '.tmp/sports-local/casino-web').resolve()
if not frontend.is_relative_to((root / '.tmp').resolve()) or not (frontend / 'package.json').exists():
    raise SystemExit('Cópia isolada do frontend não encontrada')
layout = frontend / 'src/app/[locale]/layout.tsx'
sports = frontend / 'src/app/[locale]/(public)/sports/layout.tsx'
original = layout.read_text(encoding='utf-8')
old = """const montserrat = Montserrat({ subsets: ['latin'] });
const sorteRoboto = Roboto({
  subsets: ['latin'],
  weight: ['400', '500', '700', '900'],
  variable: '--font-sorte-roboto',
  preload: false,
});"""
new = """const montserrat = localFont({ src: '../../../public/fonts/integration/montserrat.ttf', weight: '100 900' });
const sorteRoboto = localFont({
  src: '../../../public/fonts/integration/roboto.ttf',
  weight: '400 900',
  variable: '--font-sorte-roboto',
  preload: false,
});"""
replacement = original.replace("import { Montserrat, Roboto } from 'next/font/google';", "import localFont from 'next/font/local';").replace(old, new)
if replacement == original or old not in original or "from 'next/font/google'" in replacement:
    raise SystemExit('Layout principal incompatível; nada foi alterado')
original_sports = sports.read_text(encoding='utf-8')
old_sports = """const display = Barlow_Semi_Condensed({
  subsets: ['latin'],
  weight: ['800'],
  variable: '--font-sb-display',
  display: 'swap',
});"""
new_sports = """const display = localFont({
  src: '../../../../../public/fonts/integration/barlow-semi-condensed-800.ttf',
  weight: '800',
  variable: '--font-sb-display',
  display: 'swap',
});"""
replacement_sports = original_sports.replace("import { Barlow_Semi_Condensed } from 'next/font/google';", "import localFont from 'next/font/local';").replace(old_sports, new_sports)
if replacement_sports == original_sports or old_sports not in original_sports or "from 'next/font/google'" in replacement_sports:
    raise SystemExit('Layout esportivo incompatível; nada foi alterado')
target = frontend / 'public/fonts/integration'
target.mkdir(parents=True, exist_ok=True)
for name in ['montserrat.ttf', 'roboto.ttf', 'barlow-semi-condensed-800.ttf']:
    shutil.copy2(root / 'local-integration/frontend-files/fonts' / name, target / name)
layout.write_text(replacement, encoding='utf-8')
sports.write_text(replacement_sports, encoding='utf-8')
print('Fontes locais configuradas apenas na cópia de integração')
