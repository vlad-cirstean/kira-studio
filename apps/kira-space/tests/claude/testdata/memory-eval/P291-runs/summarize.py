"""Prints retrieval tables from P291-runs/retrieval/*.json. Usage: summarize.py <file-stem> [variant-substring...]"""
import json, sys, os
d = os.path.join(os.path.dirname(__file__), "retrieval")
f = json.load(open(os.path.join(d, sys.argv[1] + ".json")))
subs = sys.argv[2:]
print(f["round"], f["set"], "queries", len(f["queries"]), "facts", f["facts"])
print("%-44s %6s %6s %6s %6s %6s | %6s %6s %6s %6s" % ("variant", "MRR", "h@1", "h@5", "h@10", "chars5", "cMRR", "ch@1", "ch@5", "ch@10"))
for k, v in f["agg"].items():
    if subs and not any(s in k for s in subs):
        continue
    a = v["all"]
    print("%-44s %6.3f %6.3f %6.3f %6.3f %6d | %6.3f %6.3f %6.3f %6.3f" % (k, a["MRR"], a["Hit1"], a["Hit5"], a["Hit10"], f["chars5"].get(k, 0), a["CMRR"], a["CHit1"], a["CHit5"], a["CHit10"]))
