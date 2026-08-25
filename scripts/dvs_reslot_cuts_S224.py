#!/usr/bin/env python3
"""dvs_reslot_cuts_S224.py — restore the six S224 narrative cuts onto the S200 cadence.

SELF-CONTAINED BY DESIGN. The six drafts were only ever in a working copy, never
committed, so a `git pull` could not land the bot's post-run commit on top of them.
Rather than fight that, this script CARRIES the drafts. Discard the local queue file,
pull, run this — it inserts or updates the six by id and touches nothing else.

SAFETY: refuses to run unless convicted-or-stubborn reads "posted" with a urn. That
entry went live on 25 Aug (urn:li:share:7497969930177249280); writing a stale "ready"
over it would publish it a second time, which cannot be undone.

Cut slots under the ratified S200 cadence are SUNDAY and THURSDAY only. The script
asserts the weekday of every slot and aborts rather than write a mis-slotted date.
"""
import json, datetime, sys, collections

P = 'scheduled/linkedin-queue.json'
q = json.load(open(P))
by = {e['id']: e for e in q}

guard = by.get('convicted-or-stubborn', {})
if guard.get('status') != 'posted' or not guard.get('urn'):
    sys.exit("REFUSING: convicted-or-stubborn is not 'posted' with a urn.\n"
             "  The bot's commit (1e0febb) is not in this working copy.\n"
             "  Run:  git checkout -- scheduled/linkedin-queue.json && git pull\n"
             "  Then re-run this script.")

DRAFTS = [
  {
    "id": "the-no-you-cant-hand-yourself",
    "date": "2026-08-27",
    "visibility": "PUBLIC",
    "status": "ready",
    "text": "You can't give yourself a no.\n\nNot because you're weak. Because of where you're standing. You wrote the prompt, you chose the inputs, you picked who to ask. Every instrument you own is pointed at an idea you already want to be true — and it reports back in your own voice, only more confident.\n\nThat isn't a verdict. It's a mirror.\n\nThe no worth having is the one you can't hand yourself.",
    "firstComment": "I wrote a short field guide about this — it's free, no charge, no upsell: https://digitalventurestudio.com/the-no"
  },
  {
    "id": "two-ways-to-hear-no",
    "date": "2026-08-30",
    "visibility": "PUBLIC",
    "status": "ready",
    "text": "There are two ways to hear no about your idea.\n\nOne arrives eighteen months in, from the market, with a bill attached — the savings, the job you left, the years. The other you go looking for early, from someone with no reason to spare your feelings.\n\nSame word. Wildly different invoice.\n\nFounders avoid the second because it stings now. The first stings later, and takes the runway with it.\n\nYou don't get to choose whether the no comes. Only when.",
    "firstComment": "The full field guide is free: https://digitalventurestudio.com/the-no"
  },
  {
    "id": "project-not-a-business",
    "date": "2026-09-03",
    "visibility": "PUBLIC",
    "status": "ready",
    "text": "Some of the best things founders build are projects, not businesses.\n\nThe trouble isn't building a project. It's pouring three years of business effort into one without noticing. A project is something worth doing. A business is something other people keep paying for. They overlap — and an idea can be a genuinely good project and a hopeless business at the same time.\n\nFounders defend the quality of the thing they made as if that settles the question. It doesn't. The work can be excellent and the business can still not exist.\n\nQuality was never the question. Whether anyone keeps paying is.",
    "firstComment": "The full piece: https://digitalventurestudio.com/blog/project-not-a-business.html"
  },
  {
    "id": "will-anyone-actually-pay",
    "date": "2026-09-06",
    "visibility": "PUBLIC",
    "status": "ready",
    "text": "Ask a founder whether anyone will pay for their idea. Almost all of them say yes.\n\nAsk them who, and the room gets quiet.\n\nThat gap is the whole problem. \"Will anyone pay\" isn't a yes-or-no question — it's a question about a specific person, in a specific moment, reaching for their wallet for a specific reason. Most founders answer an easier one instead: would this help someone?\n\nThat one is almost always true. It's a low bar that feels like a high one, because you're the one who thought of it.\n\n\"Would this help someone\" and \"will this person pay\" are different questions. Only one of them has a bank statement attached.",
    "firstComment": "The full piece: https://digitalventurestudio.com/blog/will-anyone-actually-pay.html"
  },
  {
    "id": "deferring-not-researching",
    "date": "2026-09-10",
    "visibility": "PUBLIC",
    "status": "ready",
    "text": "Most founders don't decide not to build. They just keep researching.\n\nA few more conversations. Another pass at the deck for a product that doesn't exist yet. The build-or-don't decision gets quietly replaced by an infinite runway of activity that feels like progress and isn't a decision at all.\n\nI understand why. A decision is binary and final-feeling. Research is safe — you can do it forever and never be wrong, because you never committed to anything that could be checked.\n\nHere's the tell: ask yourself what result would make you stop. If there isn't one, you're not researching. You're deferring.",
    "firstComment": "The full piece: https://digitalventurestudio.com/blog/the-build-or-dont-decision.html"
  },
  {
    "id": "itch-proves-one-customer",
    "date": "2026-09-13",
    "visibility": "PUBLIC",
    "status": "ready",
    "text": "\"Build something you need\" has sunk more good founders than bad ideas ever have.\n\nIt's half right, and that's exactly what makes it dangerous. Scratching your own itch gives you two real things: proof the problem exists for at least one person, and the drive to keep going long after the novelty wears off. That's worth a lot.\n\nIt's also everything it gives you. \"I have this problem\" is evidence of exactly one customer — and that customer is the least objective judge alive of whether anyone else shares it.\n\nYour itch proves the problem is real. It can't tell you it's common.",
    "firstComment": "The full piece: https://digitalventurestudio.com/blog/scratch-your-own-itch-is-dangerous-advice.html"
  }
]

for d in DRAFTS:
    dow = datetime.date.fromisoformat(d['date']).strftime('%a')
    if dow not in ('Sun', 'Thu'):
        sys.exit(f"REFUSING: {d['id']} slotted to {d['date']} ({dow}) — cut slots are Sun/Thu only.")

added = updated = 0
for d in DRAFTS:
    if d['id'] in by:
        e = by[d['id']]
        e.update({'date': d['date'], 'status': 'ready'})
        updated += 1
        print(f"  updated  {d['id']:<32} -> {d['date']}  {datetime.date.fromisoformat(d['date']).strftime('%a')}  ready")
    else:
        q.append(d)
        added += 1
        print(f"  added    {d['id']:<32} -> {d['date']}  {datetime.date.fromisoformat(d['date']).strftime('%a')}  ready")

json.dump(q, open(P, 'w'), indent=2, ensure_ascii=False)
open(P, 'a').write('\n')

counts = dict(collections.Counter(e['status'] for e in q))
ready = sum(1 for e in q if e['status'] == 'ready')
print(f"\n  {added} added, {updated} updated.  queue: {counts}")
print(f"  ready: {ready} — housekeeping alarm (threshold 1) stays quiet until 1 remains")
print(f"  next fire: {min(d['date'] for d in DRAFTS)} at 08:30 AEST")
