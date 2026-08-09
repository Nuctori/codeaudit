import sqlite3


def connect():
    return sqlite3.connect("shop.db")


def save_user(user):
    conn = connect()
    conn.execute("INSERT INTO users VALUES (?, ?)", (user["id"], user["name"]))
    conn.commit()


def get_user(uid):
    conn = connect()
    cur = conn.execute("SELECT * FROM users WHERE id = ?", (uid,))
    return cur.fetchone()
