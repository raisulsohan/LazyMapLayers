#!/bin/bash
# LazyMapLayers - installs the panel for After Effects.
# Double-click this file. If macOS refuses, right-click it and choose Open.
set -u

cd "$(dirname "$0")"
EXT_ROOT="$HOME/Library/Application Support/Adobe/CEP/extensions"
DEST="$EXT_ROOT/com.sohan.LazyMapLayers"

echo "============================================================"
echo "  LazyMapLayers - install"
echo "  Free map animation for After Effects 2024 or newer"
echo "============================================================"
echo
echo "Close After Effects before going on."
read -r -p "Press return when it is closed. " _
echo

zxp=$(ls -1 ./*.zxp 2>/dev/null | head -1 || true)
if [ -z "${zxp}" ]; then
  echo "[!] There is no LazyMapLayers .zxp file next to this one."
  echo "    Unzip the whole download first, then run this from inside that folder."
  read -r -p "Press return to close. " _
  exit 1
fi

echo "Installing ${zxp}"
echo "        to ${DEST}"
if [ -L "${DEST}" ]; then
  # A developer link: remove the link, never the folder it points at.
  rm "${DEST}"
else
  rm -rf "${DEST}"
fi
mkdir -p "${DEST}"
if ! unzip -q -o "${zxp}" -d "${DEST}"; then
  echo "[!] Could not unpack the panel."
  read -r -p "Press return to close. " _
  exit 1
fi
# Quarantine flags on a downloaded file travel into what it unpacks.
xattr -dr com.apple.quarantine "${DEST}" 2>/dev/null || true

if [ ! -f "${DEST}/CSXS/manifest.xml" ]; then
  echo "[!] The panel did not unpack correctly."
  read -r -p "Press return to close. " _
  exit 1
fi

echo
echo "============================================================"
echo "  Installed."
echo "============================================================"
echo
echo "  Open it:"
echo "    After Effects  Window > Extensions > LazyMapLayers"
echo
echo "  Downloaded map regions and render caches from an earlier"
echo "  LazyMapLayers are kept."
echo
echo "  If the panel opens blank, run this in Terminal and restart After Effects:"
echo "    defaults write com.adobe.CSXS.11 PlayerDebugMode 1"
echo "    defaults write com.adobe.CSXS.12 PlayerDebugMode 1"
echo
read -r -p "Press return to close. " _
