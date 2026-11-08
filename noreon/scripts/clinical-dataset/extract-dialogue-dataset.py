"""Extract Armen's clinical dialogue dataset (v2.0, Armenian) into JSON.

pdftotext drops the Armenian 'ու' ligature glyphs out of order; PyMuPDF keeps them
inline, so it is the source here. Layout: one main column (x~62-76) plus a sidebar
box (labels x~67 size 8, values x~310) with topics / data used / data missing.
"""
import json, re, sys
import pymupdf

PDF, OUT = sys.argv[1], sys.argv[2]

URGENCY = {
    "Անհապաղ շտապ օգնություն": "immediate",
    "Շտապ գնահատում՝ նույն օրը": "urgent_same_day",
    "Բժշկի գնահատում մոտ օրերին": "doctor_within_days",
    "Պլանային / կանխարգելիչ": "planned_preventive",
    "Ինքնախնամք և հսկողություն": "self_care",
}
SECTIONS = {
    "Բժշկական համատեքստ": "context",
    "Երկխոսություն": "dialogue",
    "AI-ի վերջնական ուղղորդումը": "finalGuidance",
    "Բժշկական հիմնավորումը": "rationale",
    "Անվտանգության նշումներ": "safetyNotes",
}
SIDEBAR = {"ԹԵՄԱՆԵՐ": "topics", "ՕԳՏԱԳՈՐԾՎԱԾ ՏՎՅԱԼՆԵՐ": "dataUsed", "ՊԱԿԱՍՈՂ ՏՎՅԱԼՆԵՐ": "dataMissing"}
USER, AI = "Օգտատեր:", "Noreon AI:"


def join(lines):
    out = ""
    for ln in lines:
        if not out:
            out = ln
        elif out.endswith("-") and not out.endswith(" -"):
            out += ln.lstrip()
        else:
            out = out.rstrip() + " " + ln.lstrip()
    return re.sub(r"[  ]+", " ", out).strip()


doc = pymupdf.open(PDF)
lines = []  # (page, y, x, size, text)
for pn, page in enumerate(doc):
    for b in page.get_text("dict")["blocks"]:
        for l in b.get("lines", []):
            t = "".join(s["text"] for s in l["spans"])
            if not t.strip():
                continue
            x0, y0 = l["bbox"][0], l["bbox"][1]
            lines.append((pn + 1, y0, x0, l["spans"][0]["size"], t))

scenarios, cur, chapter = [], None, None
section = None
buf = []
side_key = None
turns = []


def flush():
    global buf
    if cur is None or section is None:
        buf = []
        return
    if section == "dialogue":
        pass
    elif buf:
        cur[section] = join(buf)
    buf = []


def flush_turn():
    if turns and turns[-1].get("_lines") is not None:
        turns[-1]["text"] = join(turns[-1].pop("_lines"))


# Sidebar lines must be grouped separately; sort sidebar by (page, y), main by (page, y).
main = [l for l in lines if not (l[2] > 300) and not (60 < l[2] < 70 and abs(l[3] - 8.0) < 0.05 and l[4].strip() in SIDEBAR)]
side = [l for l in lines if l not in main]
main.sort(key=lambda l: (l[0], l[1]))

sidebar_by_page = {}
for l in sorted(side, key=lambda l: (l[0], l[1], l[2])):
    sidebar_by_page.setdefault(l[0], []).append(l)

for pg, y, x, size, raw in main:
    t = raw.strip()
    m = re.fullmatch(r"Գլուխ (\d+)\s+·\s+(.+)", t)
    if m:
        flush(); flush_turn()
        chapter = {"number": int(m.group(1)), "title": m.group(2).strip()}
        section = "chapterhead"
        continue
    if t.startswith("ԲԱԺԻՆ ") and size >= 12.9 and cur is not None:
        flush(); flush_turn()
        section = "parthead"
        continue
    if section == "chapterhead" and size >= 12.9:
        chapter["title"] = join([chapter["title"], t])
        continue
    if section in ("chapterhead", "parthead") and not re.fullmatch(r"ՍՑԵՆԱՐ \d{3}", t):
        continue
    m = re.fullmatch(r"ՍՑԵՆԱՐ (\d{3})", t)
    if m:
        if cur:
            flush(); flush_turn()
            cur["turns"] = turns
        cur = {"id": m.group(1), "chapter": chapter, "pages": [pg], "title": None, "urgencyLabel": None,
               "urgency": None, "topics": None, "dataUsed": None, "dataMissing": None, "context": None,
               "turns": [], "finalGuidance": None, "rationale": None, "safetyNotes": None, "_side": None}
        scenarios.append(cur)
        turns = []
        section = "title"
        buf = []
        continue
    if cur is None:
        continue
    if pg not in cur["pages"]:
        cur["pages"].append(pg)
    if section == "title" and t.startswith("ՇՏԱՊՈՒԹՅԱՆ ՄԱԿԱՐԴԱԿ"):
        cur["title"] = join(buf); buf = []
        lab = t[len("ՇՏԱՊՈՒԹՅԱՆ ՄԱԿԱՐԴԱԿ"):].strip()
        cur["urgencyLabel"] = lab
        cur["urgency"] = URGENCY[lab]
        cur["_side"] = (pg, y)
        section = "header"
        continue
    if t in SECTIONS and size >= 9.9:
        flush(); flush_turn()
        section = SECTIONS[t]
        continue
    if section == "dialogue":
        m = re.match(r"(Օգտատեր|Noreon AI)\s*[:։]", t)
        if m:
            flush_turn()
            role = "user" if m.group(1) == "Օգտատեր" else "ai"
            turns.append({"role": role, "_lines": [t[m.end():]]})
        elif turns:
            turns[-1]["_lines"].append(raw)
        else:
            raise SystemExit(f"dialogue text before first turn: p{pg} {t}")
        continue
    if section == "header":
        raise SystemExit(f"unexpected header text p{pg}: {t}")
    buf.append(raw)
if cur:
    flush(); flush_turn(); cur["turns"] = turns

# Sidebar: each scenario's box sits on the page of its urgency line, right after it.
for s in scenarios:
    pg, y_start = s.pop("_side")
    nxt = min((l[0], l[1]) for l in main if l[4].strip() == "Բժշկական համատեքստ" and (l[0], l[1]) > (pg, y_start))
    groups, key = {}, None
    for l in sorted(side, key=lambda l: (l[0], l[1] - (3 if l[2] < 100 else 0))):
        if not ((pg, y_start) < (l[0], l[1]) < nxt):
            continue
        tt = l[4].strip()
        if tt in SIDEBAR and l[2] < 100:
            key = SIDEBAR[tt]; groups[key] = []
        else:
            if key is None: raise SystemExit(f"orphan sidebar {s['id']} {l}")
            groups[key].append(l[4])
    for k, v in groups.items():
        s[k] = join(v)

for s in scenarios:
    s["topics"] = [x.strip() for x in s["topics"].split(",")] if s["topics"] else []

meta = {
    "source": "docs/reference/clinical-dialogue-dataset-v2.0-hy.pdf",
    "title": "Noreon AI clinical dialogue dataset v2.0 (HY)",
    "author": "Armen (Noreon clinical lead)",
    "extractedWith": "PyMuPDF text extraction (verbatim Armenian), parsed by layout",
    "urgencyLevels": {v: k for k, v in URGENCY.items()},
    "urgencyOrder": ["self_care", "planned_preventive", "doctor_within_days", "urgent_same_day", "immediate"],
}
json.dump({"meta": meta, "scenarios": scenarios}, open(OUT, "w"), ensure_ascii=False, indent=2)
print(len(scenarios))

# Front matter: six immutable safety rules (p.3) and the urgency taxonomy descriptions (pp.2-3).
fm = doc[1].get_text() + "\n" + doc[2].get_text()
rules_txt = fm[fm.index("ԱՆՓՈՓՈԽ ԱՆՎՏԱՆԳՈՒԹՅԱՆ ԿԱՆՈՆՆԵՐ"):]
rules = []
for n in range(1, 7):
    a = rules_txt.index(f"{n}.  ")
    b = rules_txt.index(f"{n+1}.  ") if n < 6 else rules_txt.index("\n", rules_txt.index("։", a))
    rules.append({"n": n, "text": join(rules_txt[a + 4:b].splitlines())})
tax = {}
labels = list(URGENCY)
for i, lab in enumerate(labels):
    a = fm.index(lab + "\n") + len(lab) + 1
    ends = [fm.index(x, a) for x in labels + ["ԱՆՓՈՓՈԽ"] if fm.find(x, a) >= 0] + [len(fm)]
    tax[URGENCY[lab]] = {"label": lab, "description": join(fm[a:min(ends)].splitlines())}
data = json.load(open(OUT))
data["meta"]["safetyRules"] = rules
data["meta"]["urgencyTaxonomy"] = tax
data["meta"].pop("urgencyLevels", None)
json.dump(data, open(OUT, "w"), ensure_ascii=False, indent=2)
