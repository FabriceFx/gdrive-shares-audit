#!/usr/bin/env python3
"""Audit des partages Google Drive — Mon Drive et Drives partagés.

Usage : python3 audit_drive.py --help
"""
from gdshares.cli import main

if __name__ == "__main__":
    raise SystemExit(main())
