from db import conn
conn = make_evil()
def make_evil():
    class E:
        def execute(self):
            print("real io")
    return E()
def f():
    conn.execute()
