import sqlite3

DB_NAME = "matches.db"

def init_db():
    conn = sqlite3.connect(DB_NAME)
    cur = conn.cursor()
    cur.execute('''
        CREATE TABLE IF NOT EXISTS users (
            user_id INTEGER PRIMARY KEY,
            username TEXT,
            project TEXT,
            month TEXT
        )
    ''')
    cur.execute('''
        CREATE TABLE IF NOT EXISTS likes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            from_user INTEGER,
            to_user INTEGER,
            UNIQUE(from_user, to_user)
        )
    ''')
    cur.execute('''
        CREATE TABLE IF NOT EXISTS viewed (
            user_id INTEGER,
            viewed_user INTEGER,
            PRIMARY KEY (user_id, viewed_user)
        )
    ''')
    cur.execute('''
        CREATE TABLE IF NOT EXISTS matches (
            user1 INTEGER,
            user2 INTEGER,
            PRIMARY KEY (user1, user2)
        )
    ''')
    conn.commit()
    conn.close()

def save_user(user_id, username, project, month):
    conn = sqlite3.connect(DB_NAME)
    cur = conn.cursor()
    cur.execute('''
        INSERT OR REPLACE INTO users (user_id, username, project, month)
        VALUES (?, ?, ?, ?)
    ''', (user_id, username, project, month))
    conn.commit()
    conn.close()

def get_user(user_id):
    conn = sqlite3.connect(DB_NAME)
    cur = conn.cursor()
    cur.execute('SELECT * FROM users WHERE user_id = ?', (user_id,))
    row = cur.fetchone()
    conn.close()
    return row

def get_all_users_except(user_id):
    conn = sqlite3.connect(DB_NAME)
    cur = conn.cursor()
    cur.execute('SELECT user_id FROM users WHERE user_id != ?', (user_id,))
    rows = cur.fetchall()
    conn.close()
    return [r[0] for r in rows]

def add_like(from_user, to_user):
    conn = sqlite3.connect(DB_NAME)
    cur = conn.cursor()
    try:
        cur.execute('INSERT INTO likes (from_user, to_user) VALUES (?, ?)', (from_user, to_user))
        conn.commit()
        conn.close()
        return True
    except:
        conn.close()
        return False

def has_liked(from_user, to_user):
    conn = sqlite3.connect(DB_NAME)
    cur = conn.cursor()
    cur.execute('SELECT 1 FROM likes WHERE from_user = ? AND to_user = ?', (from_user, to_user))
    res = cur.fetchone()
    conn.close()
    return res is not None

def add_viewed(user_id, viewed_user):
    conn = sqlite3.connect(DB_NAME)
    cur = conn.cursor()
    cur.execute('INSERT OR IGNORE INTO viewed (user_id, viewed_user) VALUES (?, ?)', (user_id, viewed_user))
    conn.commit()
    conn.close()

def get_viewed(user_id):
    conn = sqlite3.connect(DB_NAME)
    cur = conn.cursor()
    cur.execute('SELECT viewed_user FROM viewed WHERE user_id = ?', (user_id,))
    rows = cur.fetchall()
    conn.close()
    return [r[0] for r in rows]

def add_match(u1, u2):
    conn = sqlite3.connect(DB_NAME)
    cur = conn.cursor()
    cur.execute('INSERT OR IGNORE INTO matches (user1, user2) VALUES (?, ?)', (min(u1,u2), max(u1,u2)))
    conn.commit()
    conn.close()

def get_matches(user_id):
    conn = sqlite3.connect(DB_NAME)
    cur = conn.cursor()
    cur.execute('SELECT user1, user2 FROM matches WHERE user1 = ? OR user2 = ?', (user_id, user_id))
    rows = cur.fetchall()
    conn.close()
    return rows

def delete_user(user_id):
    conn = sqlite3.connect(DB_NAME)
    cur = conn.cursor()
    cur.execute('DELETE FROM users WHERE user_id = ?', (user_id,))
    cur.execute('DELETE FROM likes WHERE from_user = ? OR to_user = ?', (user_id, user_id))
    cur.execute('DELETE FROM viewed WHERE user_id = ? OR viewed_user = ?', (user_id, user_id))
    cur.execute('DELETE FROM matches WHERE user1 = ? OR user2 = ?', (user_id, user_id))
    conn.commit()
    conn.close()

def update_user_field(user_id, field, value):
    conn = sqlite3.connect(DB_NAME)
    cur = conn.cursor()
    cur.execute(f'UPDATE users SET {field} = ? WHERE user_id = ?', (value, user_id))
    conn.commit()
    conn.close()