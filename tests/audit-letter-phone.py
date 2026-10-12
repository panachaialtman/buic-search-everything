from pathlib import Path
import zipfile, xml.etree.ElementTree as ET

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
for path in sorted(Path('templates').glob('*.docx')):
    print('\\nTEMPLATE', path.name, flush=True)
    with zipfile.ZipFile(path) as z:
        for part in z.namelist():
            if not (part == 'word/document.xml' or (part.startswith(('word/header','word/footer')) and part.endswith('.xml'))):
                continue
            root = ET.fromstring(z.read(part))
            for p in root.iter(W + 'p'):
                line = ''.join(n.text or '' for n in p.iter(W+'t'))
                if any(t in line for t in ('2407','3888','2441','ศูนย์นานาชาติ')):
                    print(' ', part, 'paragraph:', repr(line), flush=True)
