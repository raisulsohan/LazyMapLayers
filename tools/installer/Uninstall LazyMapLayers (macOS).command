#!/bin/bash
# LazyMapLayers - removes the panel. Downloaded map regions, the render queue and
# renders made without a saved project are removed too, but only if you say so.
# Renders next to your saved projects stay where they are.
set -u

DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/com.sohan.LazyMapLayers"
DATA="$HOME/Library/Application Support/LazyMapLayers"

echo "Removing the LazyMapLayers panel..."
read -r -p "Close After Effects, then press return. " _

if [ -L "${DEST}" ]; then
  rm "${DEST}" && echo "Removed the developer link."
elif [ -e "${DEST}" ]; then
  rm -rf "${DEST}" && echo "Removed the panel."
else
  echo "The panel was not installed."
fi

if [ -d "${DATA}" ]; then
  echo
  echo "LazyMapLayers keeps downloaded map regions, the render queue and"
  echo "renders of unsaved projects in"
  echo "  ${DATA}"
  read -r -p "Delete them as well? [y/N] " answer
  case "${answer}" in
    [yY]*) rm -rf "${DATA}" && echo "Removed the downloaded regions and renders." ;;
    *) echo "Kept them." ;;
  esac
fi

echo
echo "Renders of saved projects stay in the \"LazyMapLayers Renders\" folders next to those projects."
read -r -p "Press return to close. " _
