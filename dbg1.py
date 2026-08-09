import collections

names = collections.Counter()
with open('unk_log.txt', encoding='utf-8', errors='replace') as fh:
    for line in fh:
        parts = line.rstrip('\n').split('\t')
        if parts[0] not in ('UNK', 'DYN'):
            continue
        f = parts[1].replace('\\', '/')
        if 'response-body' in f or 'request-snippets/fn' in f:
            names[(f.split('/')[-1], parts[3])] += 1
for k, v in names.most_common():
    print(v, k)
