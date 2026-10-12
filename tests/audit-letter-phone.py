from pathlib import Path
import zipfile, re, xml.etree.ElementTree as ET

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
for path in sorted(Path('templates').glob('*.docx')):
    print('\nTEMPLATE', path.name, flush=True)
    with zipfile.ZipFile(path) as z:
        for part in z.namelist():
            if not re.match(r'word/(?:document|header\\d+|footer\\d+)\\.xml$', part):
                continue
            root = ET.fromstring(z.read(part))
            for p in root.iter(W + 'p'):
                text = ''.join(n.text or '' for n in p.iter(W+'t'))
                if '2407' in text or '3888' in text or '2441' in text or 'ศูนย์นานาชาติ' in text:
                    print(' ', part, 'paragraph:', repr(text), flush=True)
