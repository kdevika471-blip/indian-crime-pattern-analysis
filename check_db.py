import sqlite3

def check_db():
    conn = sqlite3.connect('crime_data.db')
    c = conn.cursor()
    c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='emergency_alerts'")
    table_exists = c.fetchone()
    print(f"Table exists: {table_exists}")
    
    if table_exists:
        c.execute("SELECT * FROM emergency_alerts")
        rows = c.fetchall()
        print(f"Rows count: {len(rows)}")
    conn.close()

if __name__ == '__main__':
    check_db()
