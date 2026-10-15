# Opening apps inside the Hub: feasibility

Goal: clicking a card, for example Daily Check-in, feels like the app lives inside the Hub, the way a mobile app opens inside another app. This is a read of the repos, nothing was changed. Production headers were not checked.

## How apps open today

- Desktop: the card opens the app in a named browser window and reuses it on the next click (`AppCard.tsx` in the Hub).
- Phones: a normal link, same tab.
- Nothing is framed. The only iframes are hidden ones used to sign the user out of every app.
- Single sign-on goes through the Hub's launch route and a one time code, then the app sets its own session cookie.

## What blocks an iframe

| Check | Daily Check-in | Exima | Others |
| --- | --- | --- | --- |
| Frame headers | `helmet()` is global, so every page sends `X-Frame-Options: SAMEORIGIN`. Only `/logout-silent` removes it and allows the Hub. | No frame header is set in `next.config.ts` or `proxy.ts`, so the browser allows framing. Only `/auth/logout-silent` names the Hub in `frame-ancestors`. | Not checked (MTSS, Woko, the plain links). Plain links to outside tools such as Google Apps Script usually refuse framing. |
| Session cookie | `SameSite=Lax` | `SameSite=Lax` | Unknown |
| Domain | Separate host | `exima.mws.web.id`, the Hub is `app.mws.web.id`, Central is `db.mws.web.id` | Varies |

Two things decide whether an iframe can work:

1. The app has to allow the Hub in `frame-ancestors` on its normal pages, and drop `X-Frame-Options`. Daily Check-in needs a code change for this.
2. The session cookie has to be sent inside the frame. A `Lax` cookie is only sent when the Hub and the app are the same site (same registrable domain, for example both under `mws.web.id`). The Hub's own code notes that some apps do not share a domain with it in production. For those, the cookie would have to become `SameSite=None; Secure`, which browsers are phasing out for embedded pages. Expect broken sign-in there.

Smaller problems that follow: the app's own redirects to a sign-in page inside the frame, the back button, links that open new tabs, file downloads and camera or clipboard permissions (each needs an `allow` attribute), and the app not knowing it is framed (its own header and logout button).

## Two ways to build it

### A. Iframe inside a Hub shell

A top bar from the Hub (back, app name, reload, open in new tab) with the app below it.

- Closest to the "app in an app" feeling.
- Needs every app to allow the Hub in `frame-ancestors`, and the cookie to work inside the frame, so it can work for same-site apps only.
- Needs a fallback to a new tab for apps that refuse, which means the Hub must know which apps can be framed. Central could carry that as a setting on the application (for example `embed: true`).
- Effort: medium for the shell, plus a small change in each app that should be framed.

### B. Same tab with a Hub bar

The app opens in the same tab. The Hub is not around it, but a small shared "Back to Hub" bar (a snippet or package each app includes) gives the way back. It can also hold the app switcher.

- Works with every app, no header or cookie problem.
- Not really "inside" the Hub, but the move between apps is quick and consistent. On a phone it feels close to the real thing, especially as an installed web app.
- Effort: small for the Hub, a small include in each app.

## Recommendation

1. Start with B everywhere. It does not depend on headers or domains.
2. Try A on one app that is already same-site and has no frame header, which is Exima. Add an `embed` setting per application in Central and let the Hub frame only those.
3. Leave Daily Check-in for after its header change. Leave plain links to outside tools as new tabs.

## Questions to settle before building

- Which production domains do Daily Check-in, MTSS and Woko use? Same registrable domain as the Hub or not.
- Should the Hub keep one tab for the whole session, or is a new tab per app fine?
- Does the mobile case mean an installed web app, or just a phone browser?
