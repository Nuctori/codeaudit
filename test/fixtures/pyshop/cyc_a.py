from cyc_b import pong


def ping(n):
    if n <= 0:
        return 0
    return pong(n - 1)
