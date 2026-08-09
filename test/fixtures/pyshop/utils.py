def validate_user(user):
    return user.get("age", 0) > 0 and "name" in user


def format_name(name):
    parts = name.strip().split(" ")
    return " ".join(p.capitalize() for p in parts if p)


def clamp(value, lo, hi):
    if value < lo:
        return lo
    if value > hi:
        return hi
    return value
