const SHARED = [
  {
    title: "The domain has to match",
    lines: [
      "The shared session is a cookie on the Hub's parent domain, so every application on it has to be under that same parent. With the Hub at app.mws.web.id the parent is mws.web.id, and daily.mws.web.id works. web.id alone does not count, and neither does another domain like millenniaws.sch.id.",
      "An application on another domain can be switched to Shared anyway, and Central marks it Different Domain. Nobody can sign in to it with the shared session, and signing out of the Hub does not end a session it still holds. Keep it on Hub Code & Token (Legacy) until it moves.",
    ],
  },
  {
    title: "What Central controls",
    lines: [
      "Central only tells the Hub. The Hub stops making a code for this app and leaves it out of the sign-out and session lists. It picks up a change within a minute, no restart.",
      "How the app signs in is decided by its code. Whether it counts as Shared is the setting here, never its .env.",
    ],
  },
  {
    title: "If a line is missing or wrong",
    lines: [
      "HUB_BASE_URL is the only Hub line the app reads. The address of the Hub's public key is made from it to check the hub_at cookie. If it is empty or wrong, the app cannot check anyone's session and nobody gets in.",
      "If the app still has the older code that waits for a code from the Hub, sign-in fails, because the Hub no longer makes one. Update the code first.",
    ],
  },
  {
    title: "If an old line is left in the .env",
    lines: ["HUB_INTERNAL_SECRET and HUB_SSO_JWKS_URL are not read in this way. Leaving them does no harm and does not change the mode. Remove them to keep the file tidy."],
  },
];

const RELAY = [
  {
    title: "What Central controls",
    lines: [
      "This is the older way, kept until the app's code moves to the shared session.",
      "Central only tells the Hub. The Hub makes a one time code for this app again and includes it in the sign-out and session lists. It picks up a change within a minute, no restart.",
      "How the app signs in is decided by its code. It must be the relay code (the express-relay or nextjs-relay template). Code that only reads the shared session ignores the Hub's code and still signs in from the cookie, so it looks fine while this mode is not used.",
    ],
  },
  {
    title: "If a line is missing or wrong",
    lines: [
      "HUB_INTERNAL_SECRET not copied or wrong: the app refuses the Hub's calls (401). Sign-in fails, and signing out of the Hub never reaches the app.",
      "HUB_SSO_JWKS_URL wrong: the token from the Hub cannot be checked, so sign-in fails. HUB_SSO_APP_ID wrong: the Hub does not know which app is asking.",
    ],
  },
  {
    title: "If an old line is left in the .env",
    lines: ["Nothing from the shared way is left to remove. Lines the code does not read do no harm."],
  },
];

// What each sign-in way means for the application, so nobody has to guess what a missing or old line does.
export function SignInGuide({ mode }) {
  const blocks = mode === "shared" ? SHARED : RELAY;
  return (
    <div role="note" className="space-y-3 rounded-xl border border-(--mws-line) bg-(--mws-soft) p-4">
      <p className="font-display text-sm font-bold text-(--mws-charcoal)">How This App Signs In</p>
      {blocks.map((block) => (
        <div key={block.title}>
          <p className="text-xs font-semibold text-(--mws-charcoal)">{block.title}</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-(--mws-muted)">
            {block.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
