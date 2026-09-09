#!/bin/sh
exec python3 "$(dirname "$(readlink -f "$0")")/../decay_monitor.py"
