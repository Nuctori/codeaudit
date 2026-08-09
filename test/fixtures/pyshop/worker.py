import weirdlib
from mystery import do_thing


def engage(data):
    weirdlib.run(data)
    do_thing(data)
    return len(data)
