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

# The map data. The full download carries two packs: offline-data (the whole
# world to zoom 9, elevation, satellite pictures and every country's districts)
# and light-data (the world to zoom 6 and coarse elevation). The light download
# carries only light-data. Online keeps neither: the panel fetches the detail
# maps need from the internet, and keeps it.
DATA="$HOME/Library/Application Support/LazyMapLayers"
has_full=0
has_light=0
[ -f "offline-data/offline/world.pmtiles" ] && has_full=1
[ -f "light-data/offline/world.pmtiles" ] && has_light=1
mode=online
if [ "${has_full}${has_light}" != "00" ]; then
  default=2
  [ "${has_full}" = 1 ] && default=1
  echo
  echo "How much map data should this computer keep?"
  echo
  if [ "${has_full}" = 1 ]; then
    echo "  1  Full     about 2 GB: the world down to city level, elevation,"
    echo "             satellite pictures and every country's districts."
    echo "             Everything works without the internet."
  fi
  if [ "${has_light}" = 1 ]; then
    echo "  2  Light    about 120 MB: the world to country level and coarse"
    echo "             elevation. Closer detail comes from the internet as"
    echo "             your maps need it, and is kept."
  fi
  echo "  3  Online   nothing more: all detail comes from the internet as"
  echo "             your maps need it, and is kept."
  echo
  mode=
  while [ -z "${mode}" ]; do
    pick=
    read -r -p "Type 1, 2 or 3 and press return (return alone: ${default}): " pick || pick=
    [ -z "${pick}" ] && pick="${default}"
    if [ "${pick}" = 1 ] && [ "${has_full}" = 1 ]; then mode=full
    elif [ "${pick}" = 2 ] && [ "${has_light}" = 1 ]; then mode=light
    elif [ "${pick}" = 3 ]; then mode=online
    else echo "That is not one of the choices above."
    fi
  done
fi

# rsync skips files that are already there and unchanged, so installing again
# is quick, and it replaces the world files of another choice made before.
copied=0
copy_pack() {
  mkdir -p "${DATA}"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a "$1/" "${DATA}/" && copied=1
  else
    cp -R "$1/." "${DATA}/" && copied=1
  fi
  xattr -dr com.apple.quarantine "${DATA}" 2>/dev/null || true
  if [ "${copied}" != 1 ]; then
    echo "[!] The map data could not be copied completely. Check that the disk"
    echo "    has enough free space, then run this again. The panel itself is installed."
  else
    echo "The map data is in place."
  fi
}
if [ "${mode}" = full ]; then
  echo
  echo "Copying the map data for working offline (about 2 GB)"
  echo "        to ${DATA}"
  echo "This takes a minute or two."
  copy_pack "offline-data"
elif [ "${mode}" = light ]; then
  echo
  echo "Copying the light map data (about 120 MB)"
  echo "        to ${DATA}"
  copy_pack "light-data"
elif [ -f "${DATA}/offline/pack.json" ]; then
  # Online after a full or light install: the world files that install copied
  # go, so they no longer take the space. Downloads are kept.
  echo
  echo "Removing the offline world map an earlier install copied to"
  echo "        ${DATA}"
  rm -f "${DATA}/offline/world.pmtiles" "${DATA}/offline/pack.json" "${DATA}/offline/CREDITS.txt" "${DATA}/terrain/world.pmtiles"
fi

echo
echo "============================================================"
echo "  Installed."
echo "============================================================"
echo
echo "  Open it:"
echo "    After Effects  Window > Extensions > LazyMapLayers"
echo
if [ "${mode}" = full ] && [ "${copied}" = 1 ]; then
  echo "  It works without the internet: the world map down to city"
  echo "  level, elevation, satellite pictures and the districts of"
  echo "  every country are on this computer now. Closer than city"
  echo "  level, street detail comes from the internet as maps need it."
  echo
elif [ "${mode}" = light ] && [ "${copied}" = 1 ]; then
  echo "  The world to country level and coarse elevation are on this"
  echo "  computer. Closer detail comes from the internet as your maps"
  echo "  need it, and is kept for working offline later."
  echo
elif [ "${mode}" = online ]; then
  echo "  Map detail closer than country level comes from the internet"
  echo "  as your maps need it, and is kept for working offline later."
  echo
fi
echo "  Downloaded map regions and render caches from an earlier"
echo "  LazyMapLayers are kept."
echo
echo "  If the panel opens blank, run this in Terminal and restart After Effects:"
echo "    defaults write com.adobe.CSXS.11 PlayerDebugMode 1"
echo "    defaults write com.adobe.CSXS.12 PlayerDebugMode 1"
echo
read -r -p "Press return to close. " _
