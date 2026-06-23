#!/bin/sh
# LightDM session-wrapper: run the Wayland session command as-is.
# Avoids /etc/X11/Xsession (which pulls LXDE/XDG autostart alongside labwc).
exec "$@"
