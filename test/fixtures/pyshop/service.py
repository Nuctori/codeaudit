from db import save_user
from utils import validate_user, format_name


def create_user(raw):
    if validate_user(raw):
        user = {"id": raw["id"], "name": format_name(raw["name"])}
        save_user(user)
        return user
    return None


def batch_create(raw_users):
    created = []
    for raw in raw_users:
        user = create_user(raw)
        if user:
            created.append(user)
    return created
