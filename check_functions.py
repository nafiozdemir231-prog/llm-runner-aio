import sqlite3

conn = sqlite3.connect('openwebui/openwebui.db')
cursor = conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
tables = [row[0] for row in cursor.fetchall()]
print('Tables:', tables)

if 'function' in tables:
    cursor2 = conn.execute('SELECT * FROM function')
    print('Functions:', cursor2.fetchall())
else:
    print('function table does not exist')
