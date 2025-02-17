sudo mount -t drvfs G: /mnt/g
#rsync -rv "./playlists/" "/mnt/g/Music"
rsync -rv --size-only --delete "/mnt/h/Music/" "/mnt/g/Music"