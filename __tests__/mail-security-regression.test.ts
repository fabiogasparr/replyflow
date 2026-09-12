import { createTransport } from "nodemailer";
import { describe, expect, it } from "vitest";

describe("installed Nodemailer security regression", () => {
  it("builds a single-recipient message using the real transport without a network connection", async () => {
    const transport = createTransport({ streamTransport: true, buffer: true });
    const result = await transport.sendMail({
      from: "ReplyFlow <login@replyflow.test>", to: { name: "", address: "tester@replyflow.test" },
      subject: "Seu acesso", text: "Teste sem envio externo", disableFileAccess: true, disableUrlAccess: true,
    });
    expect(result.envelope.to).toEqual(["tester@replyflow.test"]);
    expect(result.message.toString()).toContain("Teste sem envio externo");
  });

  it("blocks message-level raw file access before touching the filesystem", async () => {
    const transport = createTransport({ streamTransport: true, buffer: true, disableFileAccess: true });
    await expect(transport.sendMail({ raw: { path: "/replyflow-test-no-file-access" } })).rejects.toThrow(/File access rejected/i);
  });

  it("blocks message-level raw URL access before making an HTTP request", async () => {
    const transport = createTransport({ streamTransport: true, buffer: true, disableUrlAccess: true });
    await expect(transport.sendMail({ raw: { href: "https://replyflow-test.invalid/no-url-access" } })).rejects.toThrow(/Url access rejected/i);
  });
});
