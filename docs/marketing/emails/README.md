# Welcome emails

The source copy for the newsletter welcome sequence. These are authored here and pasted into the Resend Automation steps — the dashboard is the runtime, this directory is the source of truth (and the place to review wording in a PR).

## How it works

The marketing signup form ([site/src/components/EmailSignup.astro](../../../site/src/components/EmailSignup.astro)) asks why the visitor is here and posts `{ email, reason }` to `POST /api/v1/subscribe` ([api/routes/subscribe.py](../../../api/routes/subscribe.py)). The route creates a Resend contact and stamps the reason onto its `properties`. A single Resend Automation triggers on "contact added to the audience" and **branches on `properties.reason`** into the three tracks below. See [ADR-0028](../../adr/0028-resend-for-subscriptions-and-automations.md) for the decision and the operator runbook.

## Rendering + pasting into Resend

The `.md` files are the source of truth (readable on GitHub, reviewable in a PR). [`render.py`](render.py) wraps each one in the branded, table-based HTML shell — the same inline-color chrome as the transactional magic-link mail — and writes a sibling `.html`:

```bash
python docs/marketing/emails/render.py          # regenerate all 9 .html files
python docs/marketing/emails/render.py --check   # verify they're up to date (no writes)
```

For each step of the Resend Automation, open the email step's **HTML / "Code"** view and paste the matching `.html`. The subject and preheader live in each file's front-matter (Resend asks for them separately). The footer already includes Resend's `{{{RESEND_UNSUBSCRIBE_URL}}}` token, so the one-click unsubscribe URL is injected per recipient. After editing any `.md`, re-run `render.py` and re-paste.

## Tracks

| Directory | `reason` value | Audience |
| --- | --- | --- |
| [`collector/`](collector/) | `collector` | Hobbyist collectors — the north star. |
| [`show-prep/`](show-prep/) | `show` | Dealers and show-goers prepping to buy/sell. |
| [`builder/`](builder/) | `builder` | Open-source contributors here for the code. |

Each track is three emails, sent on signup, +3 days, and +7 days. Every file carries front-matter the operator copies into Resend:

```yaml
track: collector        # which track (matches the directory)
reason: collector       # the contact property the automation branches on
sequence: 1             # order within the track
when: on signup         # delay step in the automation
subject: ...            # email subject
preheader: ...          # inbox preview text
```

The `reason` values are a contract shared by three places — keep them in sync: the `Literal` in [api/routes/subscribe.py](../../../api/routes/subscribe.py), the reason chips in [EmailSignup.astro](../../../site/src/components/EmailSignup.astro), and the Automation's branch conditions.

## Voice

Per [design/DESIGN_SYSTEM.md](../../../design/DESIGN_SYSTEM.md): plainspoken, on your side, quietly knowledgeable, warm. Sentence case, contractions, second person. Use the locked term **wishlist** (never "want-list"). Each email opens with the inline logo and signs off as Matt. Keep the product surface honest — describe what ships today (Swipe / Browse / Search, the Backpack, collections + wishlists, card details, exports), not what's planned.
