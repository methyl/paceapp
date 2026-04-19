// Tiny Worker whose only job is to hold the send_email binding and forward
// incoming messages to env.EMAIL.send(). Invoked via service binding from
// the Pages Functions worker; not exposed to the public internet
// (workers_dev = false in wrangler.toml).

export interface Env {
  EMAIL: SendEmail;
}

interface SendEmail {
  send(message: {
    to: string | string[];
    from: string | { email: string; name?: string };
    subject: string;
    html?: string;
    text?: string;
    replyTo?: string;
  }): Promise<void>;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method !== "POST") {
      return new Response("method not allowed", { status: 405 });
    }
    const message = (await req.json()) as Parameters<SendEmail["send"]>[0];
    await env.EMAIL.send(message);
    return new Response(null, { status: 204 });
  },
};
