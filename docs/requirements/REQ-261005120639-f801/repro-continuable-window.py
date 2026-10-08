import json, os, re, subprocess

WS = '/Users/mac/.dsh/sessions/--Users-mac-Documents-ai-dsh-dsh-pmboard--'
PARENTS = ['f92af7dc-0c8b-4759-bbc9-a0b9916aae1b', '00af6c69-e55e-4878-8d4e-74056a439b01']

def load(sid):
    for cand in (os.path.join(WS, 'session-' + sid, 'session.v4.jsonl.zstd'),
                 os.path.join(WS, sid, 'session.v4.jsonl.zstd')):
        if os.path.exists(cand):
            out = subprocess.run(['zstd', '-dc', cand], capture_output=True).stdout.decode('utf8', 'replace')
            ev = []
            for line in out.splitlines():
                line = line.strip()
                if not line:
                    continue
                try:
                    ev.append(json.loads(line))
                except Exception:
                    pass
            return ev
    return None

def own_events(ev):
    """Events the child produced itself (after its seed boundary)."""
    cut = -1
    for e in ev:
        if e.get('type') == 'session/end-seed':
            cut = e.get('seq', -1)
    return [e for e in ev if isinstance(e.get('seq'), int) and e['seq'] > cut]

for PARENT in PARENTS:
    pev = load(PARENT)
    if pev is None:
        print('parent', PARENT, 'not found'); continue
    started = {}
    for e in pev:
        if e.get('type') == 'tool/result':
            m = re.search(r'started subagent ([0-9a-f-]{36})', json.dumps(e.get('data'), ensure_ascii=False))
            if m:
                started[e['seq']] = m.group(1)
    turn_starts = [e for e in pev if e.get('type') == 'turn/start']
    turn_ends = [e for e in pev if e.get('type') == 'turn/end']
    print(f"\n##### parent {PARENT[:8]} turns={len(turn_starts)} subagent_delegations={len(started)}")
    cases = 0
    for i, te in enumerate(turn_ends):
        t0 = turn_starts[i]['seq'] if i < len(turn_starts) else -1
        kids = [(s, c) for s, c in started.items() if t0 < s < te['seq']]
        if not kids:
            continue
        for s, c in kids:
            cev = load(c)
            if cev is None:
                print(f'  child {c[:8]}: no log'); continue
            own = own_events(cev)
            times = [e['time'] for e in own if isinstance(e.get('time'), int)]
            if not times:
                continue
            last = max(times)
            delta = last - te['time']
            if delta <= 0:
                continue
            own_ends = [e for e in own if e.get('type') == 'turn/end']
            end_after = [e for e in own_ends if e['time'] > te['time']]
            cases += 1
            print(f"  parent turn/end seq={te['seq']} ({te['data'].get('reason',{}).get('kind')}) at {te['time']}")
            print(f"    child {c[:8]}: own activity {min(times)}..{last} "
                  f"(+{delta/1000:.0f}s after parent turn/end), own turn/end after that: {len(end_after)}"
                  f" reasons={[e['data'].get('reason',{}).get('kind') for e in end_after]}")
    print(f"  -> false 'session complete' windows in this session: {cases}")
