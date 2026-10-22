import { describe, expect, it } from "bun:test";
import { escapeHtml, renderSignInHtml, type SignInKind } from "../utils/signin-email-html";
import { resetPasswordEmail, signInEmail } from "../utils/signin-email";

const base = { name: "Ari Putra", email: "ari@millennia21.id", password: "Abcd1234Efgh5678" };

describe("the sign-in email as a page", () => {
  for (const language of ["id", "en"] as const) {
    for (const kind of ["new", "reset", "parent"] as SignInKind[]) {
      it(`holds the email, the password and the Google button (${language}, ${kind})`, () => {
        const html = renderSignInHtml({ ...base, kind, language, parentName: "Siti Aminah" });
        expect(html).toContain("ari@millennia21.id");
        expect(html).toContain("Abcd1234Efgh5678");
        expect(html).toContain("user-select:all");
        expect(html).toContain("https://accounts.google.com/AccountChooser?Email=ari%40millennia21.id");
        expect(html).toContain(language === "id" ? "Masuk ke Google" : "Sign in to Google");
        expect(html).toContain(`<html lang="${language}">`);
      });
    }
  }

  it("is written to the parent for a student", () => {
    expect(renderSignInHtml({ ...base, kind: "parent", language: "id", parentName: "Siti Aminah" })).toContain("Yth. Bapak/Ibu Siti Aminah");
    expect(renderSignInHtml({ ...base, kind: "parent", language: "en", parentName: "Siti Aminah" })).toContain("Dear Siti Aminah");
  });

  it("puts no script or remote file in the page, and escapes what a person typed", () => {
    const html = renderSignInHtml({ ...base, kind: "new", language: "en", name: `<script>alert("x")</script> O'Neil`, password: "a<b>&\"c" });
    expect(html).not.toContain("<script");
    // The only image is the logo that travels inside the mail; nothing is fetched from a site.
    expect(html).not.toMatch(/src="(?!cid:)/);
    expect(html).not.toContain("http://");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; O&#39;Neil");
    expect(html).toContain("a&lt;b&gt;&amp;&quot;c");
    expect(escapeHtml("<&>")).toBe("&lt;&amp;&gt;");
  });

  it("goes with the plain text, which is as it was", () => {
    const mail = signInEmail("id", base);
    expect(mail.text).toContain("Halo Ari Putra");
    expect(mail.text).toContain("Abcd1234Efgh5678");
    expect(mail.html).toContain("Abcd1234Efgh5678");
    expect(signInEmail("id", { ...base, parentName: "Siti Aminah" }).text).toContain("Yth. Bapak/Ibu Siti Aminah");
    expect(resetPasswordEmail("en", base).html).toContain("was reset by an administrator");
  });

  it("carries the school logo as an inline attachment the page points to, and a dark-mode block", () => {
    const mail = signInEmail("id", base);
    expect(mail.attachments).toHaveLength(1);
    expect(mail.attachments[0]).toMatchObject({ cid: "millennia-logo", contentType: "image/png" });
    expect(mail.attachments[0].content.subarray(1, 4).toString()).toBe("PNG");
    expect(mail.html).toContain("cid:millennia-logo");
    expect(mail.html).toContain("prefers-color-scheme: dark");
    expect(resetPasswordEmail("en", base).attachments).toHaveLength(1);
  });
});
