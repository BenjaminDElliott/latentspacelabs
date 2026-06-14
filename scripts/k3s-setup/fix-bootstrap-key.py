#!/usr/bin/env python3
"""
Fix stuck k3s bootstrap key in kine SQLite DB.
Run after: rm -rf /var/lib/rancher/k3s/server/db/etcd/*
"""
import sqlite3
import sys
import os

DB_PATH = "/var/lib/rancher/k3s/server/db/state.db"

def fix_bootstrap_key():
    if not os.path.exists(DB_PATH):
        print(f"DB not found at {DB_PATH}. Fresh start needed?")
        return

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # Delete bootstrap entries from kine table
    cursor.execute('DELETE FROM kine WHERE name LIKE "%bootstrap%"')
    deleted = cursor.rowcount

    # Reset sequence
    try:
        cursor.execute("UPDATE sqlite_sequence SET seq=0 WHERE name='kine'")
    except sqlite3.OperationalError:
        pass  # sequence table may not exist

    conn.commit()
    conn.close()

    print(f"Cleared {deleted} bootstrap key entries from kine DB")
    print("Restart k3s: supervisorctl restart k3s-server")

if __name__ == "__main__":
    fix_bootstrap_key()
