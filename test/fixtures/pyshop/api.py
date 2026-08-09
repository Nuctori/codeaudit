from service import batch_create
from utils import clamp


def handle_request(req):
    if req.get("auth"):
        limit = clamp(req.get("limit", 10), 1, 100)
        users = req.get("users", [])[:limit]
        return {"created": len(batch_create(users))}
    return {"created": 0}


def deep_nesting(data):
    total = 0
    for group in data:
        if group.get("active"):
            for item in group["items"]:
                try:
                    if item["ok"]:
                        while item.get("retry"):
                            item["retry"] = False
                            total += 1
                except KeyError:
                    continue
    return total
