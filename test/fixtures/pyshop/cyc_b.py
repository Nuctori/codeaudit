from cyc_a import ping


def pong(n):
    if n <= 0:
        return 1
    return ping(n - 1)
