sudo mount -t drvfs H: /mnt/h
rsync -rv "./playlists/" "/mnt/h/Music"
rsync -rv "/mnt/e/Phone Music Library/" "/mnt/h/Music"