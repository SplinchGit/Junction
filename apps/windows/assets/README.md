# Nethra icon assets

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
