"""Build the bundled CJK TrueType font using FontTools 4.61.1.

Input: official Noto Sans SC, Sans2.004, from
https://raw.githubusercontent.com/notofonts/noto-cjk/Sans2.004/Sans/Variable/TTF/Subset/NotoSansSC-VF.ttf
Usage: python scripts/build-pdf-font.py PATH_TO_DOWNLOADED_FONT
Keep the upstream SIL OFL license with the generated font.
"""
from hashlib import sha256
from pathlib import Path
import sys
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

source = Path(sys.argv[1])
if sha256(source.read_bytes()).hexdigest() != "d68bafcb48a2707749396aa12bbbd833cb70401f3a9a689fd2902c7e0d295964":
    raise SystemExit("Official source font checksum mismatch")
font = instantiateVariableFont(TTFont(source), {"wght": 400}, inplace=True)
font.recalcTimestamp = False
for record in font["name"].names:
    if record.nameID in (1, 4, 6, 16):
        value = "KumaLingoSC-Regular" if record.nameID == 6 else "KumaLingo SC"
        record.string = value.encode(record.getEncoding())
    elif record.nameID in (2, 17):
        record.string = "Regular".encode(record.getEncoding())
output = Path(__file__).resolve().parents[1] / "composeApp/src/commonMain/composeResources/font/kumalingo_sc_regular.ttf"
font.save(output)
print("Built licensed static CJK font")
