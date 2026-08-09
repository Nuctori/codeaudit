import os
from .util import helper


def run(path):
    os.makedirs(path, exist_ok=True)
    return helper(len(path))
