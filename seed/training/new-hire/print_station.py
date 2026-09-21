#!/usr/bin/env python3
"""Unpack / pack the new-hire Print Station.

The dashboard reads ALL training content from one file,
  web/public/training/new hire 8 weeks training package/new_hire_print_station.html
which embeds every document as base64. This tool lets you edit ONE document
(or add / remove / reorder / retitle) without rebuilding the whole file.

    python3 seed/training/new-hire/print_station.py unpack            # → seed/training/new-hire/print-station-src/
    (edit or replace a file in that folder; edit index.json to add / remove / reorder / retitle)
    python3 seed/training/new-hire/print_station.py pack              # rebuilds the print station in place
    python3 seed/training/new-hire/print_station.py list              # what is inside, with the dashboard keys

Paths default to the repo layout; pass --station / --src to override.

Titles matter: the dashboard derives each document's permanent KEY from its
title (see web/src/hooks/useTrainingDocs.ts, keyForTitle). Quiz results and
mentor ticks are stored against that key, so keep a title recognisable when
you retitle (e.g. anything starting "HVAC Overview" stays key `hvac`).
"""
import argparse, base64, html, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
STATION = os.path.join(REPO, 'web', 'public', 'training', 'new hire 8 weeks training package', 'new_hire_print_station.html')
SRC = os.path.join(HERE, 'print-station-src')

# Mirror of keyForTitle() in web/src/hooks/useTrainingDocs.ts — keep the two in step.
ALIAS_RULES = [
    (r'^8-?week schedule', 'plan'), (r'sign-?off sheet', 'signoff_sheet'),
    (r'^week 1 guide', 'week1_guide'), (r'^week 1 checklist', 'week1_checklist'),
    (r'^week 2 guide', 'week2_guide'), (r'^week 2 checklist', 'week2_checklist'),
    (r'^upark site map', 'site_map'), (r'^binney site map', 'binney_site_map'), (r'^building check', 'building_check'),
    (r'^hvac overview', 'hvac'), (r'^plumbing overview', 'plumbing'), (r'^electrical overview', 'electrical'),
    (r'^life safety overview', 'life_safety'), (r'^bms overview', 'bms'),
    (r'^boiler.*find it', 'boiler_tagit'), (r'^boiler', 'boiler'), (r'^chiller.*find it', 'chiller_tagit'), (r'^chiller', 'chiller'),
    (r'^cooling tower.*find it', 'tower_tagit'), (r'^cooling tower', 'tower'), (r'^ahu.*find it', 'ahu_tagit'), (r'^ahu', 'ahu'),
    (r'^find it on screen.*example', 'find_on_screen_example'), (r'^find it on screen', 'find_on_screen'),
    (r'find it.*tag it.*portfolio|^portfolio.*find it', 'find_it_tag_it'),
    (r'^equipment glossary|^glossary', 'glossary'), (r'^terminology', 'terminology'), (r'level.?2', 'level2'),
    (r'answer key', 'answer_key'), (r'manager sop', 'manager_sop'),
]
def key_for_title(title):
    t = title.strip().lower()
    for pat, key in ALIAS_RULES:
        if re.search(pat, t): return key
    return re.sub(r'^_+|_+$', '', re.sub(r'[^a-z0-9]+', '_', t))[:60] or 'doc'

def read_station(path):
    s = open(path, encoding='utf-8').read()
    m_docs = re.search(r'const DOCS=(\[[^\]]*\]);', s)
    m_titles = re.search(r'const TITLES=(\[[^\]]*\]);', s)
    if not m_docs or not m_titles: sys.exit('DOCS / TITLES arrays not found — is this the print station?')
    docs, titles = json.loads(m_docs.group(1)), json.loads(m_titles.group(1))
    if len(docs) != len(titles): sys.exit(f'{len(docs)} documents but {len(titles)} titles')
    rows = {}
    for m in re.finditer(r'<div class="row( warn)?" data-g="([^"]*)"><label><input type="checkbox" class="ck" data-i="(\d+)"( checked)?\s+onchange="count\(\)">', s):
        rows[int(m.group(3))] = {'group': html.unescape(m.group(2)), 'warn': bool(m.group(1)), 'print_default': bool(m.group(4))}
    entries = []
    for i, (b64, title) in enumerate(zip(docs, titles)):
        r = rows.get(i, {'group': 'Other', 'warn': False, 'print_default': True})
        entries.append({'index': i, 'title': html.unescape(title), 'html': base64.b64decode(b64).decode('utf-8'), **r})
    return s, entries

def slug(t): return re.sub(r'^_+|_+$', '', re.sub(r'[^a-z0-9]+', '_', t.lower()))[:50]

def cmd_list(a):
    _, entries = read_station(a.station)
    print(f'{len(entries)} documents in {a.station}\n')
    print(f"{'#':>2}  {'key':24} {'group':12} {'quiz':4} {'print':5}  title")
    for e in entries:
        quiz = 'yes' if 'id="qDone"' in e['html'] else ''
        pr = 'yes' if e['print_default'] else 'no'
        print(f"{e['index']:>2}  {key_for_title(e['title']):24} {e['group']:12} {quiz:4} {pr:5}  {e['title']}")

def cmd_unpack(a):
    _, entries = read_station(a.station)
    os.makedirs(a.src, exist_ok=True)
    index = []
    for e in entries:
        fn = f"{e['index']:02d}_{slug(e['title'])}.html"
        open(os.path.join(a.src, fn), 'w', encoding='utf-8').write(e['html'])
        index.append({'file': fn, 'title': e['title'], 'group': e['group'], 'print_default': e['print_default'], 'warn': e['warn']})
    json.dump({'_readme': ['Order here = order in the print station. Edit a file in place, replace it with a new build,',
                           'add an entry (any .html in this folder), remove one, retitle, regroup — then run: print_station.py pack',
                           'Keep titles recognisable: the dashboard keys quiz results and mentor ticks by title (see print_station.py list).'],
               'docs': index}, open(os.path.join(a.src, 'index.json'), 'w', encoding='utf-8'), indent=2, ensure_ascii=False)
    print(f'unpacked {len(entries)} documents → {a.src}\nedit, then: python3 {os.path.relpath(__file__, REPO)} pack')

def cmd_pack(a):
    station, _ = read_station(a.station)
    idx = json.load(open(os.path.join(a.src, 'index.json'), encoding='utf-8'))['docs']
    docs, titles, rows_html = [], [], []
    groups_seen = []
    for i, d in enumerate(idx):
        p = os.path.join(a.src, d['file'])
        if not os.path.exists(p): sys.exit(f'missing file: {p}')
        h = open(p, encoding='utf-8').read()
        docs.append(base64.b64encode(h.encode('utf-8')).decode('ascii'))
        titles.append(d['title'])
        g = d.get('group', 'Other')
        if g not in groups_seen:
            groups_seen.append(g)
            rows_html.append(f'<div class="grp"><label><input type="checkbox" class="gk" data-g="{html.escape(g, quote=True)}" checked onchange="grpToggle(this)"> {html.escape(g)}</label></div>')
        rows_html.append(f'<div class="row{" warn" if d.get("warn") else ""}" data-g="{html.escape(g, quote=True)}"><label><input type="checkbox" class="ck" data-i="{i}"{" checked" if d.get("print_default", True) else ""} onchange="count()"> <span class="t" onclick="preview({i});return false">{html.escape(d["title"])}</span></label></div>')
    # replace the list (first .grp … up to the .prev pane), then the two arrays
    m = re.search(r'(<div class="grp">.*?)(\s*</div>\s*<div class="prev">)', station, flags=re.S)
    if not m: sys.exit('could not find the document list in the print station')
    out = station[:m.start(1)] + '\n'.join(rows_html) + station[m.end(1):]
    out = re.sub(r'const DOCS=\[[^\]]*\];', lambda _: 'const DOCS=' + json.dumps(docs, ensure_ascii=False) + ';', out, count=1)
    out = re.sub(r'const TITLES=\[[^\]]*\];', lambda _: 'const TITLES=' + json.dumps(titles, ensure_ascii=False) + ';', out, count=1)
    # sanity: re-read
    open(a.station, 'w', encoding='utf-8').write(out)
    _, entries = read_station(a.station)
    print(f'packed {len(entries)} documents → {a.station} ({os.path.getsize(a.station)//1024} KB)')
    for e in entries: print(f"  {e['index']:>2} {key_for_title(e['title']):24} {e['group']:12} {e['title']}")

ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
ap.add_argument('cmd', choices=['list', 'unpack', 'pack'])
ap.add_argument('--station', default=STATION)
ap.add_argument('--src', default=SRC)
a = ap.parse_args()
{'list': cmd_list, 'unpack': cmd_unpack, 'pack': cmd_pack}[a.cmd](a)
